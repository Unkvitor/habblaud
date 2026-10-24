import {spawn} from 'node:child_process';
import {NdjsonParser} from './protocol';
import type {AntigravityLauncher,AntigravitySession} from './managed';
import {maskSecrets} from '../../shared/activity';
import {tr} from '../../shared/i18n';
export const GEMINI_MODEL='gemini-4-argon-medium';
const MAX_RESPONSE=64000;
type CliPayload={
 event?:unknown;conversation_id?:unknown;
 init?:{model?:unknown;permission_mode?:unknown};
 step_update?:{step_type?:unknown;text_delta?:unknown;tool_name?:unknown;state?:unknown};
 result?:{conversation_id?:unknown;status?:unknown;error?:unknown;response?:unknown;usage?:unknown};
};
const NATIVE_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function cliArgs(nativeId?: string): string[]{
 if(nativeId && !NATIVE_ID.test(nativeId))throw new Error('ID nativo Antigravity inválido.');
 return ['--input-format','stream-json','--output-format','stream-json','--model',GEMINI_MODEL,'--mode','plan','--sandbox','--disable-slash-commands',...(nativeId?['--conversation',nativeId]:[])];
}
export class CliReply{
 nativeId='';text='';done=false;usage:Record<string,number>={};
 constructor(private chunk:(s:string)=>void=()=>{},private meta:(m:Partial<AntigravitySession>&{progress?:unknown})=>void=()=>{},private expectedNativeId?:string){}
 private acceptId(value:unknown):void{
  if(typeof value!=='string'||!NATIVE_ID.test(value)||this.expectedNativeId&&value!==this.expectedNativeId||this.nativeId&&value!==this.nativeId)throw new Error('ID nativo Antigravity divergente.');
  this.nativeId=value;
 }
 accept(raw:unknown):void{
  const j=raw as CliPayload|null;
  if(j?.event==='init'){
   this.acceptId(j.conversation_id);this.meta({nativeId:this.nativeId,model:typeof j.init?.model==='string'?j.init.model:GEMINI_MODEL,permissionMode:typeof j.init?.permission_mode==='string'?j.init.permission_mode:undefined});
   if(j.init?.permission_mode==='always-proceed')throw new Error('CLI configurado com aprovação automática; execução bloqueada.');
  }
  if(j?.event==='step_update'){
   const step=j.step_update;
   if(step?.step_type==='agent_response' && typeof step.text_delta==='string'){
    if(this.text.length+step.text_delta.length>MAX_RESPONSE)throw new Error('Resposta excede o limite permitido.');
    this.text+=step.text_delta;this.chunk(step.text_delta);
   }else if(step?.step_type==='tool')this.meta({progress:{type:'tool',name:String(step.tool_name||'ferramenta'),state:String(step.state||'')}});
  }
  if(j?.event==='result'){
   const r=j.result;if(r?.conversation_id)this.acceptId(r.conversation_id);
   if(r?.status!=='SUCCESS')throw new Error(maskSecrets(String(r?.error||`Antigravity: ${r?.status||'resultado inválido'}`)));
   this.text=typeof r.response==='string'&&r.response.trim()?r.response:this.text;
   if(this.text.length>MAX_RESPONSE)throw new Error('Resposta excede o limite permitido.');
   const usage=r.usage&&typeof r.usage==='object'&&!Array.isArray(r.usage)?r.usage:{};
   this.usage=Object.fromEntries(Object.entries(usage).filter(([,v])=>typeof v==='number'&&Number.isFinite(v)&&v>=0)) as Record<string,number>;this.done=true;this.meta({nativeId:this.nativeId,usage:this.usage});
  }
 }
 finish():void{if(!this.done || !this.nativeId)throw new Error('CLI terminou sem resultado nativo confirmado; confira o histórico antes de repetir.');if(!this.text.trim())throw new Error('CLI terminou sem resposta visível; confira a conversa e as permissões no terminal antes de repetir.');}
}
export function createAntigravityLauncher(bin:string,opts:{timeoutMs?:number;killGraceMs?:number}={}):AntigravityLauncher{
 const timeoutMs=opts.timeoutMs??120000;const killGraceMs=opts.killGraceMs??2000;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000||!Number.isSafeInteger(killGraceMs)||killGraceMs<1||killGraceMs>30000)throw new RangeError('Timeout Antigravity invalido.');
 return (session,text,onChunk,onMeta,signal)=>new Promise((resolve,reject)=>{
  const parser=new NdjsonParser(8*1024*1024);const reply=new CliReply(onChunk,onMeta,session.nativeId);
  const child=spawn(bin,cliArgs(session.nativeId),{cwd:session.cwd,stdio:'pipe',windowsHide:true});
  let failure:Error|undefined;let stderr='';let closed=false;
  let forceKill:ReturnType<typeof setTimeout>|undefined;
  const fail=(e:unknown)=>{
   if(failure||closed)return;
   failure=e instanceof Error?e:new Error(String(e));
   child.stdin.destroy();
   child.kill('SIGTERM');
   forceKill=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},killGraceMs);
  };
  const timer=setTimeout(()=>fail(new Error(tr('Antigravity excedeu o tempo limite; sem reenvio autom\u00e1tico.'))),timeoutMs);
  const abort=()=>fail(new Error(tr('Execu\u00e7\u00e3o Gemini cancelada pelo usu\u00e1rio.')));
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',s=>{if(failure)return;try{for(const j of parser.push(s))reply.accept(j);}catch(e){fail(e);}});
  child.stderr.on('data',s=>{stderr=(stderr+s).slice(-4096);});
  child.stdin.on('error',fail);child.on('error',fail);
  child.on('close',code=>{
   closed=true;clearTimeout(timer);if(forceKill)clearTimeout(forceKill);signal?.removeEventListener('abort',abort);
   try{
    if(failure)throw failure;for(const j of parser.finish())reply.accept(j);
    if(code!==0)throw new Error(/quota|rate.limit|resource.exhausted/i.test(stderr)?'Cota Gemini indisponível; nenhum reenvio automático.':'Antigravity terminou com erro; verifique autenticação e permissões no terminal.');
    reply.finish();resolve({nativeId:reply.nativeId,text:maskSecrets(reply.text),usage:reply.usage});
   }catch(e){reject(e);}
  });
  if(!failure)child.stdin.end(JSON.stringify({event:'user',message:{content:text}})+'\n');
 });
}
