import {spawn} from 'node:child_process';
import {NdjsonParser} from './protocol';
import type {AntigravityLauncher} from './managed';
import {maskSecrets} from '../../shared/activity';
export const GEMINI_MODEL='gemini-4-argon-medium';
export function cliArgs(nativeId?: string): string[]{
 if(nativeId && !/^[a-f0-9-]{36}$/i.test(nativeId))throw new Error('ID nativo Antigravity inválido.');
 return ['--input-format','stream-json','--output-format','stream-json','--model',GEMINI_MODEL,'--effort','low','--mode','plan','--sandbox','--disable-slash-commands',...(nativeId?['--conversation',nativeId]:[])];
}
export class CliReply{
 nativeId='';text='';done=false;usage:Record<string,number>={};
 constructor(private chunk:(s:string)=>void=()=>{},private meta:(m:any)=>void=()=>{}){}
 accept(raw:unknown):void{
  const j=raw as any;
  if(j?.event==='init'){
   this.nativeId=j.conversation_id || '';this.meta({nativeId:this.nativeId,model:j.init?.model||GEMINI_MODEL,permissionMode:j.init?.permission_mode});
   if(j.init?.permission_mode==='always-proceed')throw new Error('CLI configurado com aprovação automática; execução bloqueada.');
  }
  if(j?.event==='step_update'){
   const step=j.step_update;
   if(step?.step_type==='agent_response' && typeof step.text_delta==='string'){
    this.text+=step.text_delta;this.chunk(step.text_delta);
   }else if(step?.step_type==='tool')this.meta({progress:{type:'tool',name:String(step.tool_name||'ferramenta'),state:String(step.state||'')}});
  }
  if(j?.event==='result'){
   const r=j.result;this.nativeId=r?.conversation_id||this.nativeId;
   if(r?.status!=='SUCCESS')throw new Error(maskSecrets(String(r?.error||`Antigravity: ${r?.status||'resultado inválido'}`)));
   this.text=typeof r.response==='string'?r.response:this.text;
   this.usage=r.usage||{};this.done=true;this.meta({nativeId:this.nativeId,usage:this.usage});
  }
 }
 finish():void{if(!this.done || !this.nativeId)throw new Error('CLI terminou sem resultado nativo confirmado; confira o histórico antes de repetir.');}
}
export function createAntigravityLauncher(bin:string):AntigravityLauncher{
 return (session,text,onChunk,onMeta)=>new Promise((resolve,reject)=>{
  const parser=new NdjsonParser(8*1024*1024);const reply=new CliReply(onChunk,onMeta);
  const child=spawn(bin,cliArgs(session.nativeId),{cwd:session.cwd,stdio:'pipe',windowsHide:true});
  let failure:Error|undefined;let stderr='';
  const fail=(e:unknown)=>{failure=e instanceof Error?e:new Error(String(e));child.stdin.destroy();child.kill('SIGTERM');};
  const timer=setTimeout(()=>fail(new Error('Antigravity excedeu 120s; sem reenvio automático.')),120000);
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',s=>{try{for(const j of parser.push(s))reply.accept(j);}catch(e){fail(e);}});
  child.stderr.on('data',s=>{stderr=(stderr+s).slice(-4096);});
  child.stdin.on('error',e=>{failure??=e;});child.on('error',e=>{failure=e;});
  child.on('close',code=>{
   clearTimeout(timer);
   try{
    if(failure)throw failure;for(const j of parser.finish())reply.accept(j);
    if(code!==0)throw new Error(/quota|rate.limit|resource.exhausted/i.test(stderr)?'Cota Gemini indisponível; nenhum reenvio automático.':'Antigravity terminou com erro; verifique autenticação e permissões no terminal.');
    reply.finish();resolve({nativeId:reply.nativeId,text:maskSecrets(reply.text),usage:reply.usage});
   }catch(e){reject(e);}
  });
  child.stdin.end(JSON.stringify({event:'user',message:{content:text}})+'\n');
 });
}