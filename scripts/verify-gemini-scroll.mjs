import assert from 'node:assert/strict';
import os from 'node:os';
import {chromium} from 'playwright-core';
const id1='11111111-1111-4111-8111-111111111111';
const id2='22222222-2222-4222-8222-222222222222';
const browser=await chromium.launch({headless:true,executablePath:os.homedir()+'/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:900,height:650}});
 await page.addInitScript(()=>{
  const Original=window.EventSource;
  window.EventSource=function(url){
   if(String(url).includes('/api/native-gemini/events')){
    const fake={closed:false,onmessage:null,onerror:null,close(){this.closed=true}};
    window.__geminiSource=fake;
    return fake;
   }
   return new Original(url);
  };
 });
 await page.route('**/api/native-gemini/sessions',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{id:id1,cwd:'/tmp',status:'idle',model:'gemini-4-argon-medium'},{id:id2,cwd:'/tmp',status:'idle',model:'gemini-4-argon-medium'}]})}));
 await page.route('**/api/native-gemini/history?*',route=>{
  const id=new URL(route.request().url()).searchParams.get('id');
  const data=id===id1?Array.from({length:30},(_,i)=>({id:'old-'+i,role:'assistant',text:('Gemini response '+i+' ').repeat(80),complete:true})): [{id:'session-2',role:'assistant',text:'**Second session**\n\n```js\nconst ok = true;\n```',complete:true}];
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data})});
 });
 await page.goto('http://127.0.0.1:4757/',{waitUntil:'domcontentloaded'});
 await page.locator('.native-toggle').click();await page.locator('[role=tab]').nth(1).click();
 const history=page.locator('[aria-label="Conversa Gemini"] .native-history');
 await page.waitForFunction(()=>document.querySelectorAll('[data-gemini-message^="old-"]').length===30);
 await page.waitForTimeout(100);
 const nearBottom=()=>history.evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight<3);
 assert.ok(await nearBottom(),'initial history should follow bottom');
 await history.evaluate(e=>{e.scrollTop=0;e.dispatchEvent(new Event('scroll'))});await page.waitForTimeout(60);
 const emit=async(text,sessionId=id1)=>page.evaluate(({text,sessionId})=>window.__geminiSource.onmessage({data:JSON.stringify({method:'message/delta',sessionId,message:{id:'stream-1',role:'assistant',text,complete:false}})}),{text,sessionId});
 await emit('A'.repeat(3000));await page.waitForTimeout(60);
 assert.ok((await history.evaluate(e=>e.scrollTop))<3,'manual reading position should stay at top');
 await history.evaluate(e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'))});await page.waitForTimeout(60);
 await emit('B'.repeat(5000));await page.waitForTimeout(60);
 assert.ok(await nearBottom(),'returning to end should resume following');
 await emit('C'.repeat(5100));await page.waitForTimeout(60);
 assert.equal(await page.locator('[data-gemini-message="stream-1"]').count(),1,'streaming should update one item');
 assert.equal(await page.locator('[data-gemini-message="stream-1"] pre').textContent(),'C'.repeat(5100));
 await page.locator('[aria-label="Sessao Gemini"], [aria-label="Sess\u00e3o Gemini"]').selectOption(id2);
 await page.waitForFunction(()=>document.querySelector('[data-gemini-message="session-2"]'));
 assert.equal(await page.locator('[data-gemini-message="session-2"] .ui-md__block').count(),1,'completed Markdown code should render');
 assert.equal(await page.locator('[data-gemini-message="session-2"] .native-gemini-copy').count(),2,'reply and code should be copyable');
 await emit('stale from first',id1);
 assert.equal(await page.locator('[data-gemini-message="stream-1"]').count(),0,'stream from another session must stay isolated');
 let sends=0;
 await page.route('**/api/native-gemini/send',route=>{sends++;return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Test send failed'})});});
 const input=page.locator('[aria-label="Mensagem ao Gemini"]');
 await input.fill('draft');
 await input.evaluate(e=>e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));
 await input.press('Shift+Enter');
 assert.equal(sends,0,'IME and Shift+Enter must not submit');
 await input.press('Enter');
 await page.waitForFunction(()=>document.querySelector('[aria-label="Mensagem ao Gemini"]').value.includes('draft'));
 assert.equal(sends,1,'Enter should submit once');
 await page.locator('.native-panel > header button').click();
 assert.equal(await page.evaluate(()=>window.__geminiSource.closed),true,'SSE should close with panel');
 await page.locator('.native-toggle').click();
 assert.equal(await page.evaluate(()=>window.__geminiSource.closed),false,'SSE should reopen with panel');
 console.log('PASS real DOM scroll, SSE isolation, reconnect and deduplication (fixture events; no model call)');
 await page.close();
}finally{await browser.close()}
