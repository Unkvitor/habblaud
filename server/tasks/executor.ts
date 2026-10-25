import { randomUUID } from 'node:crypto';

export type ExecutionState = 'queued' | 'awaiting_authorization' | 'ready' | 'running' | 'cancel_requested' | 'cancelled' | 'failed' | 'completed' | 'interrupted';
export interface SupervisedExecution { id: string; taskId: string; executorId: string; threadId: string; idempotencyKey: string; planHash: string; state: ExecutionState; checkpoint?: string; result?: string; error?: string; authorizedBy?: string; startedAt?: number; updatedAt: number; }
const NEXT: Record<ExecutionState, readonly ExecutionState[]> = {
  queued:['awaiting_authorization','cancelled'], awaiting_authorization:['ready','cancelled'], ready:['running','cancelled'], running:['cancel_requested','completed','failed','interrupted'], cancel_requested:['cancelled','interrupted'], cancelled:[], failed:[], completed:[], interrupted:[],
};
export class ExecutionError extends Error { constructor(readonly code: 'duplicate'|'invalid'|'conflict', message: string) { super(message); } }
/** Máquina de estados sem transporte: adaptadores reais não existem neste módulo. */
export class SupervisedExecutor {
  private byId = new Map<string, SupervisedExecution>();
  private byKey = new Map<string, string>();
  constructor(private readonly maxConcurrency = 1, private readonly now: () => number = Date.now) {}
  list(): SupervisedExecution[] { return [...this.byId.values()].map((x) => ({ ...x })); }
  enqueue(input: Pick<SupervisedExecution, 'taskId'|'executorId'|'threadId'|'idempotencyKey'|'planHash'>): SupervisedExecution {
    const existing = this.byKey.get(input.idempotencyKey); if (existing) return { ...this.byId.get(existing)! };
    if (this.list().some((x) => x.threadId === input.threadId && ['running','ready','awaiting_authorization','queued','cancel_requested'].includes(x.state))) throw new ExecutionError('conflict', 'já existe execução ativa para esta thread');
    const x: SupervisedExecution = { id:`exec-${randomUUID()}`, ...input, state:'awaiting_authorization', updatedAt:this.now() }; this.byId.set(x.id,x); this.byKey.set(x.idempotencyKey,x.id); return { ...x };
  }
  authorize(id: string, actor: string, planHash: string): SupervisedExecution { const x=this.required(id); if (!actor || x.planHash !== planHash || x.state !== 'awaiting_authorization') throw new ExecutionError('invalid','autorização inválida ou plano alterado'); x.authorizedBy=actor; x.state='ready'; x.updatedAt=this.now(); return {...x}; }
  start(id: string): SupervisedExecution { const x=this.required(id); if(x.state!=='ready') throw new ExecutionError('invalid','execução não está pronta'); if(this.list().filter(y=>y.state==='running').length>=this.maxConcurrency) throw new ExecutionError('conflict','limite de concorrência atingido'); x.state='running'; x.startedAt=x.updatedAt=this.now(); return {...x}; }
  finish(id:string, state:'completed'|'failed'|'cancelled'|'interrupted', detail?:string):SupervisedExecution { const x=this.required(id); if(!NEXT[x.state].includes(state)) throw new ExecutionError('invalid','transição de execução inválida'); x.state=state;x.updatedAt=this.now(); if(state==='completed')x.result=detail; else x.error=detail; return {...x}; }
  recover(): void { for(const x of this.byId.values()) if(x.state==='running'||x.state==='cancel_requested'){x.state='interrupted';x.updatedAt=this.now();} }
  private required(id:string):SupervisedExecution { const x=this.byId.get(id); if(!x)throw new ExecutionError('invalid','execução desconhecida');return x; }
}
