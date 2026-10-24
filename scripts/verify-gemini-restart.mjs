import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import os from 'node:os';import {chromium} from 'playwright-core';
const previous=JSON.parse(readFileSync('.preview-data/gemini-resume-validation.json','utf8'));
const base='http://127.0.0.1:4757';
const mode=await (await fetch(base+'/api/native-gemini/mode')).json();assert.equal(mode.mode,'real');
const sessions=(await (await fetch(base+'/api/native-gemini/sessions')).json()).data;
const session=sessions.find(s=>s.id===previous.sessionId);assert.ok(session);assert.equal(session.nativeId,previous.nativeId);assert.equal(session.title,'QA Gemini validado');assert.equal(session.status,'idle');
const messages=(await (await fetch(base+'/api/native-gemini/history?id='+session.id)).json()).data;
assert.equal(messages.length,4);assert.deepEqual(messages.filter(m=>m.role==='assistant').map(m=>m.text.trim()),['OK','OK']);assert.ok(messages.every(m=>m.complete));
const browser=await chromium.launch({headless:true,executablePath:os.homedir()+'/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--no-sandbox']});
try{const page=await browser.newPage({viewport:{width:1280,height:800}});await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('.native-toggle').click();await page.locator('[role=tab]').nth(1).click();await page.waitForFunction(id=>document.querySelector('.native-gemini-chat select')?.value===id,session.id);await page.waitForFunction(()=>document.querySelectorAll('[data-gemini-message]').length===4);assert.equal(await page.locator('[data-gemini-message]').count(),4);await page.close();}finally{await browser.close()}
console.log('PASS preview restart preserved real Gemini native ID, title and four complete messages; no model call');
