// Explicit opt-in: drives ONE already-created real test thread. Each phase is submitted at most once.
// Never creates a thread and never approves a command outside the fixed harmless printf probes.
import {chromium} from 'playwright-core';
import {strict as assert} from 'node:assert';
import {readFileSync,writeFileSync,globSync} from 'node:fs';
import {homedir} from 'node:os';
const file='.preview-data/bidirectional-real.json';
const state=JSON.parse(readFileSync(file)); const phase=process.argv[2];
assert(state.id && state.creationStatus===201,'one real test thread must already exist');
if(phase==='verify'){
 const paths=globSync(`${homedir()}/.codex/sessions/**/*${state.id}*.jsonl`);assert.equal(paths.length,1);
 const raw=readFileSync(paths[0],'utf8').trim().split('\n').map(l=>JSON.parse(l));
 const starts=raw.filter(j=>j.type==='event_msg' && j.payload?.type==='task_started');assert.equal(starts.length,3,'exactly three authorized prompts');
 const outputs=raw.filter(j=>j.payload?.type==='custom_tool_call_output');
 assert(JSON.stringify(outputs.at(-1)?.payload.output).includes('rejected by user'));
 const browser=await chromium.launch({executablePath:`${homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1280,height:900},locale:'pt-BR'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  const history=await(await page.request.get('http://127.0.0.1:4757/api/native-codex/history?thread='+state.id)).json();
  assert(!history.data.some(i=>i.type==='commandExecution' && i.text.includes('HAB_DECLINE_MARKER')));
  const p=state.phases.decline;assert.equal(p.decision,'decline');assert.equal(p.completed,true);
  assert(p.events.some(e=>e.method==='serverRequest/resolved'));assert(p.events.some(e=>e.method==='turn/completed'));
  p.streamingDeltas=p.events.filter(e=>e.method==='item/agentMessage/delta').length;assert(p.streamingDeltas>0);
  await page.goto('http://127.0.0.1:4757');await page.getByRole('button',{name:'Agentes · Codex / Gemini'}).click();
  await page.getByRole('combobox',{name:'Sessão do Codex'}).selectOption(state.id);
  for(const phase of ['message','approve','decline']){
   const answer=history.data.find(i=>i.type==='agentMessage' && i.text===state.phases[phase].answer);assert(answer);
   await page.waitForFunction(id=>document.querySelector(`[data-item-id="${id}"] pre`),answer.id);
   assert.equal(await page.locator(`[data-item-id="${answer.id}"] pre`).textContent(),answer.text);
  }
  await page.reload();await page.getByRole('button',{name:'Agentes · Codex / Gemini'}).click();
  const final=history.data.find(i=>i.type==='agentMessage' && i.text===p.answer);
  await page.waitForFunction(id=>document.querySelector(`[data-item-id="${id}"] pre`),final.id);
  assert.equal(await page.locator(`[data-item-id="${final.id}"] pre`).textContent(),p.answer);
  assert.deepEqual(errors,[]);p.initialAssertion=p.error;delete p.error;p.reload=true;p.nativeRejection=true;p.browserErrors=errors;
  const threads=await(await page.request.get('http://127.0.0.1:4757/api/native-codex/threads')).json();
  assert.equal(threads.data.filter(t=>t.managed).length,1);assert.equal(threads.data.find(t=>t.id===state.id)?.status?.type,'idle');
  const approvals=await(await page.request.get('http://127.0.0.1:4757/api/native-codex/approvals')).json();assert.equal(approvals.data.length,0);
  state.evidence={realTurns:starts.length,managedSessions:1,approvedStdout:'HAB_APPROVE_OK',deniedNativeResult:'rejected by user',streamingDeltas:{approve:state.phases.approve.streamingDeltas,decline:p.streamingDeltas},reload:true,browserErrors:0,pendingApprovals:0};
  writeFileSync(file,JSON.stringify(state,null,2));console.log(JSON.stringify(state.evidence));
 }finally{await browser.close();}
 process.exit(0);
}assert(['message','approve','decline'].includes(phase));
assert(!state.phases[phase]?.attempted,'this phase was already attempted: inspect history, never resend blindly');
const prompts={
 message:'Sem usar ferramentas, responda apenas HAB_BIDI_OK.',
 approve:'Use exec_command uma unica vez: cmd="printf HAB_APPROVE_OK", login=false, sandbox_permissions="require_escalated", justification="Teste inofensivo do Habblaud". Aguarde minha decisao. Nenhuma outra ferramenta, agente ou tentativa alternativa. Depois responda em uma linha.',
 decline:'Use exec_command uma unica vez: cmd="printf HAB_DECLINE_MARKER", login=false, sandbox_permissions="require_escalated", justification="Teste inofensivo de recusa do Habblaud". Aguarde minha decisao. Se recusado, nao execute nem tente alternativa. Nenhuma outra ferramenta ou agente. Depois responda em uma linha.',
};
const browser=await chromium.launch({executablePath:`${homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900},locale:'pt-BR'});const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 window.__bidiEvents=[];
 const Original=window.EventSource;
 window.EventSource=class extends Original{
  constructor(url,...args){super(url,...args);if(String(url).includes('/api/native-codex/events'))this.addEventListener('message',e=>{const j=JSON.parse(e.data);window.__bidiEvents.push(j);});}
 };
});
try{
 await page.goto('http://127.0.0.1:4757');
 await page.getByRole('button',{name:'Agentes · Codex / Gemini'}).click();
 const select=page.getByRole('combobox',{name:'Sessão do Codex'});
 await page.waitForFunction(id=>[...document.querySelectorAll('.native-toolbar option')].some(o=>o.value===id),state.id);
 await select.selectOption(state.id);
 const input=page.getByRole('textbox',{name:'Mensagem ao agente'});await input.fill(prompts[phase]);
 state.phases[phase]={attempted:true,at:new Date().toISOString()};writeFileSync(file,JSON.stringify(state,null,2));
 const sendResponse=page.waitForResponse(r=>r.url().endsWith('/api/native-codex/send') && r.request().method()==='POST');
 await page.getByRole('button',{name:'Enviar',exact:true}).click();
 const sent=await sendResponse;state.phases[phase].sendStatus=sent.status();state.phases[phase].sendResult=await sent.json();
 assert.equal(sent.status(),202,JSON.stringify(state.phases[phase].sendResult));
 console.log('submitted once',phase,'202',state.id);
 if(phase!=='message'){
  const button=page.getByRole('button',{name:phase==='approve'?'Aprovar uma vez':'Recusar',exact:true});
  await button.waitFor({state:'visible',timeout:90000});
  const approvals=await(await page.request.get('http://127.0.0.1:4757/api/native-codex/approvals')).json();
  const rows=approvals.data.filter(a=>a.threadId===state.id);assert.equal(rows.length,1);
  const a=rows[0], command=a.detail.command, marker=phase==='approve'?'HAB_APPROVE_OK':'HAB_DECLINE_MARKER';
  assert.equal(a.method,'item/commandExecution/requestApproval');
  assert(typeof command==='string' && command.includes('printf') && command.includes(marker) && !/[;&|`$><\r\n]/.test(command),'only the harmless fixed printf can be decided');
  state.phases[phase].approval={threadId:a.threadId,turnId:a.turnId,itemId:a.itemId,method:a.method,command};
  writeFileSync(file,JSON.stringify(state,null,2));
  const response=page.waitForResponse(r=>r.url().endsWith('/api/native-codex/decision') && r.request().method()==='POST');
  await button.click();const decision=await response;assert.equal(decision.status(),200);
  state.phases[phase].decision=phase==='approve'?'accept':'decline';
  console.log('real decision',state.phases[phase].decision,command);
 }
 await page.waitForFunction(id=>window.__bidiEvents.some(e=>e.threadId===id && e.method==='turn/completed'),state.id,{timeout:90000});
 state.phases[phase].completed=true;
 const history=await(await page.request.get('http://127.0.0.1:4757/api/native-codex/history?thread='+state.id)).json();
 const answer=history.data.find(i=>i.type==='agentMessage');assert(answer);
 state.phases[phase].answer=answer.text;
 if(phase==='message')assert.equal(answer.text.trim(),'HAB_BIDI_OK');
 if(phase==='approve')assert(history.data.some(i=>i.type==='commandExecution' && i.text.endsWith('HAB_APPROVE_OK')),'approved command really produced stdout');
 if(phase==='decline'){
  // Codex 0.163 custom-tool refusal is persisted as custom_tool_call_output, without a CommandExecution item.
  const paths=globSync(`${homedir()}/.codex/sessions/**/*${state.id}*.jsonl`);assert.equal(paths.length,1);
  const raw=readFileSync(paths[0],'utf8').trim().split('\n').map(l=>JSON.parse(l));
  const outputs=raw.filter(j=>j.payload?.type==='custom_tool_call_output');
  assert(JSON.stringify(outputs.at(-1)?.payload.output).includes('rejected by user'),'native user rejection required');
  assert(!history.data.some(i=>i.type==='commandExecution' && i.text.includes('HAB_DECLINE_MARKER')),'denied printf must not execute');
  state.phases[phase].nativeRejection=true;
 }
 const liveEvents=await page.evaluate(()=>window.__bidiEvents??[]);
 state.phases[phase].events=liveEvents.filter(e=>e.threadId===state.id).map(e=>({method:e.method,itemId:e.itemId,text:e.text,item:e.item}));
 state.phases[phase].streamingDeltas=state.phases[phase].events.filter(e=>e.method==='item/agentMessage/delta').length;
 assert(state.phases[phase].streamingDeltas>0,'real native streaming deltas required');
 await page.reload();await page.getByRole('button',{name:'Agentes · Codex / Gemini'}).click();
 await page.waitForFunction(id=>document.querySelectorAll(`[data-item-id="${id}"] pre`).length>0,answer.id);
 assert.equal(await page.locator(`[data-item-id="${answer.id}"] pre`).textContent(),answer.text);
 state.phases[phase].reload=true;state.phases[phase].browserErrors=errors;assert.deepEqual(errors,[]);
 console.log('real completion and persisted answer',phase,JSON.stringify(answer.text));
}catch(e){state.phases[phase]??={};state.phases[phase].error=e.message;console.log('validation stopped:',e.message);process.exitCode=1;}
finally{
 const events=await page.evaluate(()=>window.__bidiEvents??[]).catch(()=>[]);
 state.phases[phase].events??=events.filter(e=>e.threadId===state.id).map(e=>({method:e.method,itemId:e.itemId,text:e.text,item:e.item}));
 writeFileSync(file,JSON.stringify(state,null,2));await browser.close();
}