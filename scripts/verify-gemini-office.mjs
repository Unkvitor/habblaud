// Read-only verification against real Hub, backend SSE and canvas. Never launches or messages an AI CLI.
import { chromium } from 'playwright-core';
import { strict as assert } from 'node:assert';
import { homedir } from 'node:os';
const base = 'http://127.0.0.1:4757';
const browser = await chromium.launch({executablePath:`${homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,headless:true,args:['--no-sandbox']});
const page = await browser.newPage({viewport:{width:1440,height:1000},locale:'pt-BR'});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(() => {
  window.__geminiPaints=0;
  const original=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(...args){if(args[0]==='Gemini')window.__geminiPaints++; return original.apply(this,args);};
});
try {
  const response=await page.request.get(base+'/api/snapshot'); const snap=await response.json();
  const gemini=snap.agents.find(a=>a.provider==='antigravity');
  assert(gemini); assert.equal(gemini.model,'gemini-4-argon-medium'); assert.equal(gemini.status,'idle');
  assert.equal(gemini.telemetry.event,'Stop'); assert.equal(gemini.telemetry.connected,true);
  assert(snap.agents.some(a=>a.provider==='codex' && a.name.includes('Marcelo') && a.roomId===gemini.roomId));
  assert(snap.agents.some(a=>a.provider==='codex' && a.name.includes('Henrique') && a.roomId===gemini.roomId));
  const hub=await (await page.request.get('http://127.0.0.1:4748/api/status')).json();
  assert(hub.antigravity.sessions.some(s=>s.session===gemini.sessionId && s.workspace===gemini.roomId));
  await page.goto(base);
  await page.waitForFunction(id=>window.habblaud?.store.liveSnapshot?.agents.some(a=>a.id===id),gemini.id);
  await page.evaluate(id=>window.habblaud.world.select({type:'agent',id},{focus:true}),gemini.id);
  await page.waitForFunction(()=>window.__geminiPaints>0);
  assert(await page.getByText('Antigravity',{exact:true}).isVisible());
  assert(await page.getByText('Ocioso · sem_sinal',{exact:true}).isVisible());
  assert(await page.getByText(/Modelo: gemini-4-argon-medium/).last().isVisible());
  assert.equal(await page.getByRole('button',{name:/Abrir terminal/}).count(),0);
  // Wait for the source's next real poll/SSE snapshot without injecting events.
  await page.waitForFunction(id=>window.habblaud?.store.liveSnapshot?.agents.some(a=>a.id===id && a.status==='idle'),gemini.id);
  await page.screenshot({path:'.preview-data/gemini-office-real.png'});
  await page.reload();
  await page.waitForFunction(id=>window.habblaud?.store.liveSnapshot?.agents.some(a=>a.id===id && a.provider==='antigravity'),gemini.id);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({realSession:gemini.sessionId,model:gemini.model,status:gemini.status,observation:gemini.telemetry.status,sameCodexRoom:true,backendSSE:true,canvasPaintedGemini:true,reload:true,errors:0,screenshot:'.preview-data/gemini-office-real.png'}));
}finally{await browser.close();}