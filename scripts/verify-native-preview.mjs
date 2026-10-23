// Real read-only browser/API verification. Does not create threads, send prompts or answer approvals.
import { chromium } from 'playwright-core';
import { strict as assert } from 'node:assert';
import { homedir } from 'node:os';
const url = 'http://127.0.0.1:4757';
const browser = await chromium.launch({ executablePath: `${homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(url);
  await page.getByRole('button', { name: 'Agentes · Codex / Gemini' }).click();
  const selector = page.getByRole('combobox', { name: 'Sessão do Codex' });
  await page.waitForFunction(() => document.querySelectorAll('.native-toolbar option').length >= 2);
  await page.waitForFunction(() => document.querySelectorAll('.native-item').length > 0);
  const names = await selector.locator('option').allTextContents();
  assert(names.some(n => n.includes('Marcelo')) && names.some(n => n.includes('Henrique')));
  const id = await selector.inputValue();
  const response = await page.request.get(`${url}/api/native-codex/history?thread=${id}`);
  assert.equal(response.status(), 200);
  const history = await response.json();
  const answer = history.data.find(i => i.type === 'agentMessage' && i.text.length > 50);
  assert(answer, 'real assistant answer available');
  assert.equal(await page.locator(`[data-item-id="${answer.id}"] pre`).textContent(), answer.text);
  const countBefore = await page.locator('.native-item').count();
  if (history.nextCursor) {
    await page.getByRole('button', { name: 'Carregar histórico anterior' }).click();
    await page.waitForFunction(n => document.querySelectorAll('.native-item').length > n, countBefore);
  }
  const hubResponse = await page.request.get(`${url}/api/native-codex/hub`);
  const hub = await hubResponse.json();
  assert(hub.online);
  assert(hub.antigravity.sessions.length > 0, 'real Hub session');
  await page.waitForFunction(() => document.querySelector('.native-hub')?.textContent.includes('Antigravity'));
  await page.waitForResponse(r => r.url().endsWith('/api/native-codex/hub') && r.status() === 200);
  await page.reload();
  await page.getByRole('button', { name: 'Agentes · Codex / Gemini' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.native-item').length > 0);
  assert.equal(await selector.inputValue(), id);
  assert.equal(await page.locator(`[data-item-id="${answer.id}"] pre`).textContent(), answer.text);
  const forbidden = await page.request.post(`${url}/api/native-codex/send`, { headers: { Origin: 'https://attacker.invalid' }, data: { threadId: id, text: 'DO NOT RUN' } });
  assert.equal(forbidden.status(), 403);
  const legacy = await page.request.post(`${url}/api/native-codex/send`, { data: { threadId: id, text: 'DO NOT RUN' } });
  assert.equal(legacy.status(), 409, 'existing session cannot be taken over');
  const stale = await page.request.post(`${url}/api/native-codex/decision`, { data: { identity: { token: 'expired' }, decision: 'accept' } });
  assert.equal(stale.status(), 409);
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await page.locator('.native-panel').boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844);
  assert.equal(await page.locator('.native-panel').evaluate(e => e.scrollWidth <= e.clientWidth), true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: ['real Marcelo/Henrique', 'full answer matches native history', 'older page', 'history after reload', 'real Hub telemetry', 'CSRF denied', 'legacy takeover denied', 'stale approval denied', 'mobile bounds', 'no browser errors'], realHistoryItems: history.data.length, realHubSessions: hub.antigravity.sessions.length }));
} finally { await browser.close(); }