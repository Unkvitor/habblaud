import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import {chromium} from 'playwright-core';
const record='.preview-data/gemini-real-validation.json';
if(existsSync(record))throw new Error('A real Gemini validation attempt is already recorded; refusing to resend.');
const browser=await chromium.launch({headless:true,executablePath:os.homedir()+'/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--no-sandbox']});
let sessionId='';
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 await page.addInitScript(()=>{
  window.__geminiEvents={delta:0,completed:0,errors:0};
  const Original=window.EventSource;
  window.EventSource=class extends Original{
   constructor(url,options){super(url,options);if(String(url).includes('/api/native-gemini/events'))this.addEventListener('message',e=>{try{const x=JSON.parse(e.data);if(x.method==='message/delta')window.__geminiEvents.delta++;if(x.method==='message/completed')window.__geminiEvents.completed++;if(x.method==='session/error')window.__geminiEvents.errors++;}catch{}});}
  };
 });
 await page.goto('http://127.0.0.1:4757/',{waitUntil:'domcontentloaded'});
 await page.screenshot({path:'.preview-data/gemini-real-office-final.png'});
 await page.locator('.native-toggle').click();await page.locator('[role=tab]').nth(1).click();
 await page.waitForFunction(()=>document.querySelector('.gemini-server-mode')?.dataset.mode==='real');
 await page.locator('.native-gemini-options summary').click();
 await page.locator('.native-gemini-options input').fill('/home/joo_vitor/projetos/qa-agents/.habblaud-gemini-validation');
 await page.locator('.native-gemini-chat > .native-toolbar button').click();
 await page.waitForFunction(()=>document.querySelector('.native-gemini-chat select')?.value);
 sessionId=await page.locator('.native-gemini-chat select').inputValue();
 await page.locator('.native-gemini-options summary').click();
 const input=page.locator('.native-gemini-chat textarea');
 await input.fill('Responda somente OK.');
 writeFileSync(record,JSON.stringify({state:'sent',sessionId,at:new Date().toISOString()}),{mode:0o600});
 const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/native-gemini/send'),{timeout:145000});
 await page.locator('.native-gemini-chat button[type=submit]').click();
 const response=await responsePromise;
 const payload=await response.json();
 const sessions=(await (await page.request.get('http://127.0.0.1:4757/api/native-gemini/sessions')).json()).data;
 const session=sessions.find(s=>s.id===sessionId);
 const messages=(await (await page.request.get('http://127.0.0.1:4757/api/native-gemini/history?id='+sessionId)).json()).data;
 const events=await page.evaluate(()=>window.__geminiEvents);
 const result={state:response.ok()?'completed':'error',httpStatus:response.status(),sessionId,nativeId:session?.nativeId,status:session?.status,model:session?.model,usage:session?.usage,messageCount:messages.length,assistantComplete:messages.at(-1)?.role==='assistant'&&messages.at(-1)?.complete===true,responseText:messages.at(-1)?.role==='assistant'?messages.at(-1).text.slice(0,80):'',events};
 writeFileSync(record,JSON.stringify(result,null,2),{mode:0o600});
 console.log(JSON.stringify(result));
 if(!response.ok())throw new Error('Real CLI turn failed: '+JSON.stringify(payload));
 assert.equal(session.model,'gemini-4-argon-medium');assert.ok(session.nativeId);assert.equal(session.status,'idle');assert.ok(result.assistantComplete);assert.ok(events.delta>=1);assert.ok(events.completed>=1);
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('.native-toggle').click();await page.locator('[role=tab]').nth(1).click();
 await page.waitForFunction(id=>document.querySelector('.native-gemini-chat select')?.value===id,sessionId);
 await page.waitForFunction(()=>document.querySelectorAll('[data-gemini-message]').length>=2);
 assert.equal(await page.locator('[data-gemini-message]').count(),messages.length);
 await page.screenshot({path:'.preview-data/gemini-real-chat-final.png'});
 console.log('PASS real Gemini UI response, SSE, native ID, history reload');
 await page.close();
} catch(error) {
 if(!existsSync(record))writeFileSync(record,JSON.stringify({state:'aborted-before-send',sessionId,error:String(error)}),{mode:0o600});
 throw error;
} finally {await browser.close();}
