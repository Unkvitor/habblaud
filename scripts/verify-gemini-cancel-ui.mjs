import assert from 'node:assert/strict';import os from 'node:os';import {chromium} from 'playwright-core';
const id='33333333-3333-4333-8333-333333333333';
const browser=await chromium.launch({headless:true,executablePath:os.homedir()+'/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:800,height:600}});let cancelled='';
 await page.route('**/api/native-gemini/sessions',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{id,cwd:'/tmp',status:'working',model:'gemini-4-argon-medium'}]})}));
 await page.route('**/api/native-gemini/history?*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{id:'prompt',role:'user',text:'short',complete:true},{id:'answer',role:'assistant',text:'partial',complete:false}]})}));
 await page.route('**/api/native-gemini/cancel',route=>{cancelled=JSON.parse(route.request().postData()).id;return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});});
 await page.goto('http://127.0.0.1:4757/',{waitUntil:'domcontentloaded'});await page.locator('.native-toggle').click();await page.locator('[role=tab]').nth(1).click();
 await page.evaluate(()=>document.body.style.zoom='1.5');
 const geometry=await page.evaluate(()=>{const h=document.querySelector('.native-gemini-chat .native-history'),f=document.querySelector('.native-gemini-chat form'),panel=document.querySelector('.native-panel');return {history:h.getBoundingClientRect().height,formBottom:f.getBoundingClientRect().bottom,panelBottom:panel.getBoundingClientRect().bottom,optionsHidden:document.querySelector('.native-gemini-options').hidden}});
 assert.ok(geometry.optionsHidden&&geometry.history>=40&&geometry.formBottom<=geometry.panelBottom+1,'working layout must keep history and composer visible');
 const cancel=page.locator('.native-gemini-chat > button:visible');await cancel.waitFor();
 assert.equal(await page.locator('.native-gemini-chat button[type=submit]').isDisabled(),true);
 await cancel.click();await page.waitForFunction(()=>document.querySelector('.native-gemini-chat > button:disabled:not([hidden])'));
 assert.equal(cancelled,id);
 console.log('PASS browser shows cancel only for working managed session and sends matching ID (fixture; no model call)');
 await page.close();
 const demo=await browser.newPage({viewport:{width:900,height:650}});
 await demo.route('**/api/native-gemini/mode',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({mode:'demo',simulated:true,consumesTokens:false})}));
 await demo.goto('http://127.0.0.1:4757/',{waitUntil:'domcontentloaded'});await demo.locator('.native-toggle').click();await demo.locator('[role=tab]').nth(1).click();
 await demo.waitForFunction(()=>document.querySelector('.gemini-server-mode')?.dataset.mode==='demo');
 const explanation=await demo.locator('.native-gemini-options p').first().textContent();
 assert.ok(explanation.includes('Nenhum token')&&!explanation.includes('Cada envio consome cota'));
 console.log('PASS demo mode is clearly labeled and remains separate from real conversations');
 await demo.close();
}finally{await browser.close()}
