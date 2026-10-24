import {it,expect} from 'vitest';
import {CliReply, cliArgs} from './cli';
it('uses official safe stdin protocol and resumes only an explicit conversation',()=>{
 const args=cliArgs('12345678-1234-1234-1234-123456789abc');
 expect(args).toContain('--sandbox'); expect(args).toContain('plan');
 expect(args).toContain('--conversation');expect(args).not.toContain('--dangerously-skip-permissions');expect(args).not.toContain('--continue');
});
it('assembles real deltas and replaces the final result without duplication',()=>{
 const r=new CliReply();r.accept({event:'init',conversation_id:'12345678-1234-4234-8234-123456789abc',init:{model:'gemini-4-argon-medium'}});
 r.accept({event:'step_update',step_update:{step_type:'agent_response',text_delta:'OK'}});
 r.accept({event:'result',result:{conversation_id:'12345678-1234-4234-8234-123456789abc',status:'SUCCESS',response:'OK',usage:{total_tokens:12}}});
 expect(r.text).toBe('OK');expect(r.nativeId).toBe('12345678-1234-4234-8234-123456789abc');expect(r.done).toBe(true);expect(r.usage.total_tokens).toBe(12);
});
it('requires a native successful result, not just stdout or exit zero',()=>{
 const r=new CliReply();expect(()=>r.finish()).toThrow();
 expect(()=>r.accept({event:'result',result:{status:'ERROR',error:'quota exhausted'}})).toThrow('quota exhausted');
});

it('não combina modelo Gemini com esforço incompatível', () => {
  const args = cliArgs();
  expect(args).toContain('--model');
  expect(args).toContain('gemini-4-argon-medium');
  expect(args).not.toContain('--effort');
  expect(args).toContain('--mode');
  expect(args).toContain('plan');
  expect(args).toContain('--sandbox');
});

it('rejects a native ID that changes while resuming a conversation',()=>{
 const expected='12345678-1234-4234-8234-123456789abc';
 const other='22345678-1234-4234-8234-123456789abc';
 const r=new CliReply(()=>{},()=>{},expected);
 expect(()=>r.accept({event:'init',conversation_id:other,init:{model:'gemini-4-argon-medium'}})).toThrow();
});

it('rejects an oversized final response even when no deltas were emitted',()=>{
 const id='12345678-1234-4234-8234-123456789abc';
 const r=new CliReply();
 r.accept({event:'init',conversation_id:id,init:{model:'gemini-4-argon-medium'}});
 expect(()=>r.accept({event:'result',result:{conversation_id:id,status:'SUCCESS',response:'x'.repeat(64001)}})).toThrow();
});

it.skipIf(process.platform==='win32')('times out and reaps only its own unresponsive child',async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,rmSync,chmodSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {createAntigravityLauncher}=await import('./cli');
 const root=mkdtempSync(join(tmpdir(),'agy-timeout-'));
 try{
  const pidFile=join(root,'child.pid'),script=join(root,'fake-agy');
  writeFileSync(script,'#!/usr/bin/env node\nrequire("fs").writeFileSync('+JSON.stringify(pidFile)+',String(process.pid));process.on("SIGTERM",()=>{});process.stdin.resume();setInterval(()=>{},1000);\n');chmodSync(script,0o700);
  const launch=createAntigravityLauncher(script,{timeoutMs:200,killGraceMs:100});
  const session={id:'12345678-1234-4234-8234-123456789abc',cwd:root,status:'idle' as const,createdAt:0};
  await expect(launch(session,'short')).rejects.toThrow('tempo limite');
  const pid=Number(readFileSync(pidFile,'utf8'));
  expect(()=>process.kill(pid,0)).toThrow();
 }finally{rmSync(root,{recursive:true,force:true});}
});

it.skipIf(process.platform==='win32')('aborts only the launched child when its managed turn is cancelled',async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,rmSync,chmodSync,existsSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {createAntigravityLauncher}=await import('./cli');
 const root=mkdtempSync(join(tmpdir(),'agy-cancel-'));
 try{
  const pidFile=join(root,'child.pid'),script=join(root,'fake-agy');
  writeFileSync(script,'#!/usr/bin/env node\nrequire("fs").writeFileSync('+JSON.stringify(pidFile)+',String(process.pid));process.on("SIGTERM",()=>{});process.stdin.resume();setInterval(()=>{},1000);\n');chmodSync(script,0o700);
  const controller=new AbortController();
  const launch=createAntigravityLauncher(script,{timeoutMs:3000,killGraceMs:100});
  const session={id:'12345678-1234-4234-8234-123456789abc',cwd:root,status:'idle' as const,createdAt:0};
  const pending=launch(session,'short',undefined,undefined,controller.signal);
  for(let n=0;n<40&&!existsSync(pidFile);n++)await new Promise(resolve=>setTimeout(resolve,10));
  expect(existsSync(pidFile)).toBe(true);
  controller.abort();
  await expect(pending).rejects.toThrow('cancelada');
  expect(()=>process.kill(Number(readFileSync(pidFile,'utf8')),0)).toThrow();
 }finally{rmSync(root,{recursive:true,force:true});}
});
