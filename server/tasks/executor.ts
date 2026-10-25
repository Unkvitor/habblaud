import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type ExecutionState = 'queued'|'awaiting_authorization'|'ready'|'running'|'cancel_requested'|'cancelled'|'failed'|'completed'|'interrupted';
export type ExecutionEventType = 'created'|'authorized'|'started'|'checkpoint'|'cancel_requested'|'cancelled'|'completed'|'failed'|'interrupted';
export interface ExecutionEvent { at:number; type:ExecutionEventType; detail?:string; }
export interface SupervisedExecution { id:string; taskId:string; executorId:string; threadId:string; idempotencyKey:string; planHash:string; mode?:'simulated'|'real'; scope?:string; state:ExecutionState; checkpoint?:string; result?:string; error?:string; authorizedBy?:string; authorizationKind?:'simulated'|'human'; startedAt?:number; updatedAt:number; events:ExecutionEvent[]; }
type Persisted={version:1;executions:SupervisedExecution[]};
const ACTIVE=new Set<ExecutionState>(['queued','awaiting_authorization','ready','running','cancel_requested']); const FINAL=new Set<ExecutionState>(['cancelled','failed','completed','interrupted']);
export class ExecutionError extends Error { constructor(readonly code:'duplicate'|'invalid'|'conflict'|'corrupt',message:string){super(message);} }
/** Fila persistida sem transporte. So o simulador pode termina-la nesta versao. */
export class SupervisedExecutor {
  private byId=new Map<string,SupervisedExecution>(); private byKey=new Map<string,string>(); private corrupt=false;
  constructor(private readonly opts:{file?:string|null;maxConcurrency?:number;maxPerAgent?:number;now?:()=>number}={}){}
  private get now(){return this.opts.now??Date.now;} private get max(){return this.opts.maxConcurrency??1;} private get perAgent(){return this.opts.maxPerAgent??1;}
  load():void { const file=this.opts.file;if(!file)return;try{const raw=JSON.parse(readFileSync(file,'utf8')) as Partial<Persisted>;if(raw.version!==1||!Array.isArray(raw.executions))throw Error('bad');for(const x of raw.executions){if(!this.valid(x))throw Error('bad');this.byId.set(x.id,this.copy(x));this.byKey.set(x.idempotencyKey,x.id);}this.recover();}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')this.corrupt=true;} }
  list():SupervisedExecution[]{return [...this.byId.values()].map(x=>this.copy(x));}
  enqueue(input:Pick<SupervisedExecution,'taskId'|'executorId'|'threadId'|'idempotencyKey'|'planHash'> & Pick<Partial<SupervisedExecution>,'mode'|'scope'>):SupervisedExecution{
    this.writable();
    const prior=this.byKey.get(input.idempotencyKey);
    if(prior){
      const existing=this.byId.get(prior)!;
      if(existing.taskId!==input.taskId || existing.executorId!==input.executorId || existing.threadId!==input.threadId ||
         existing.planHash!==input.planHash || (existing.mode??'simulated')!==(input.mode??'simulated') ||
         (existing.scope??'')!==(input.scope??'')) throw new ExecutionError('conflict','chave de idempotencia reutilizada com plano diferente');
      return this.copy(existing);
    }
if(this.list().some(x=>x.threadId===input.threadId&&ACTIVE.has(x.state)))throw new ExecutionError('conflict','thread ja possui execucao ativa');const at=this.now();const x:SupervisedExecution={id:`exec-${randomUUID()}`,...input,state:'awaiting_authorization',updatedAt:at,events:[{at,type:'created'}]};this.byId.set(x.id,x);this.byKey.set(x.idempotencyKey,x.id);this.save();return this.copy(x);}
  authorize(id:string,actor:string,planHash:string):SupervisedExecution{this.authorizeWith(id,actor,planHash,'simulated');return this.copy(this.required(id));}
  authorizeHuman(id:string,actor:string,planHash:string):SupervisedExecution{this.authorizeWith(id,actor,planHash,'human');return this.copy(this.required(id));}
  start(id:string):SupervisedExecution{this.writable();const x=this.required(id);if(x.state!=='ready')throw new ExecutionError('invalid','execucao nao esta pronta');const live=this.list().filter(y=>y.state==='running');if(live.length>=this.max||live.filter(y=>y.executorId===x.executorId).length>=this.perAgent)throw new ExecutionError('conflict','limite de concorrencia atingido');x.state='running';x.startedAt=x.updatedAt=this.now();this.event(x,'started');this.save();return this.copy(x);}
  checkpoint(id:string,value:string):SupervisedExecution{this.writable();const x=this.required(id);if(x.state!=='running')throw new ExecutionError('invalid','checkpoint fora de execucao');x.checkpoint=value;x.updatedAt=this.now();this.event(x,'checkpoint',value);this.save();return this.copy(x);}
  cancel(id:string):SupervisedExecution{this.writable();const x=this.required(id);if(!['awaiting_authorization','ready','running'].includes(x.state))throw new ExecutionError('invalid','cancelamento invalido');x.state=x.state==='running'?'cancel_requested':'cancelled';x.updatedAt=this.now();this.event(x,x.state==='cancel_requested'?'cancel_requested':'cancelled');this.save();return this.copy(x);}
  finish(id:string,state:'completed'|'failed'|'cancelled'|'interrupted',detail?:string):SupervisedExecution{this.writable();const x=this.required(id);if(FINAL.has(x.state)||(x.state!=='running'&&!(x.state==='cancel_requested'&&state==='cancelled')))throw new ExecutionError('invalid','transicao de execucao invalida');x.state=state;x.updatedAt=this.now();if(state==='completed')x.result=detail;else x.error=detail;this.event(x,state,detail);this.save();return this.copy(x);}
  recover():void{let changed=false;for(const x of this.byId.values())if(x.state==='running'||x.state==='cancel_requested'){x.state='interrupted';x.error='interrompida por reinicializacao; sem repeticao automatica';x.updatedAt=this.now();this.event(x,'interrupted',x.error);changed=true;}if(changed&&!this.corrupt)this.save();}
  private valid(x:any):x is SupervisedExecution{return !!x&&Array.isArray(x.events)&&x.events.every((event:any)=>event&&typeof event.at==='number'&&['created','authorized','started','checkpoint','cancel_requested','cancelled','completed','failed','interrupted'].includes(event.type))&&typeof x.id==='string'&&typeof x.taskId==='string'&&typeof x.executorId==='string'&&typeof x.threadId==='string'&&typeof x.idempotencyKey==='string'&&typeof x.planHash==='string'&&typeof x.updatedAt==='number'&&['queued','awaiting_authorization','ready','running','cancel_requested','cancelled','failed','completed','interrupted'].includes(x.state);}
  private authorizeWith(id:string,actor:string,planHash:string,kind:'simulated'|'human'):void{this.writable();const x=this.required(id);const validActor=kind==='simulated'?/^simulated:[\w.-]+$/.test(actor):/^human:[\w.-]+$/.test(actor);if(!validActor||x.planHash!==planHash||x.state!=='awaiting_authorization'||(kind==='simulated'&&x.mode==='real')||(kind==='human'&&x.mode!=='real'))throw new ExecutionError('invalid','autorizacao invalida ou plano alterado');x.authorizedBy=actor;x.authorizationKind=kind;x.state='ready';x.updatedAt=this.now();this.event(x,'authorized');this.save();}
  private required(id:string){const x=this.byId.get(id);if(!x)throw new ExecutionError('invalid','execucao desconhecida');return x;}
  private copy(x:SupervisedExecution):SupervisedExecution{return {...x,events:x.events.map(event=>({...event}))};}
  private event(x:SupervisedExecution,type:ExecutionEventType,detail?:string):void{x.events.push({at:x.updatedAt,type,...(detail?{detail}:{})});}
  private writable(){if(this.corrupt)throw new ExecutionError('corrupt','fila de execucoes corrompida; gravacoes bloqueadas');}
  private save(){const file=this.opts.file;if(!file)return;mkdirSync(dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.tmp`;writeFileSync(tmp,JSON.stringify({version:1,executions:this.list()}),{mode:0o600});renameSync(tmp,file);}
}
/** Adaptador de teste deterministico; nao inicia processos nem toca em provedores reais. */
export class DeterministicSimulator { constructor(private readonly queue:SupervisedExecutor){} run(id:string,outcome:'success'|'failure'|'timeout'|'cancelled'='success'){this.queue.start(id);this.queue.checkpoint(id,'simulated:checkpoint');if(outcome==='success')return this.queue.finish(id,'completed','simulated:ok');if(outcome==='cancelled'){this.queue.cancel(id);return this.queue.finish(id,'cancelled','simulated:cancelled');}return this.queue.finish(id,'failed',`simulated:${outcome}`);} }
