import assert from 'node:assert/strict';
import os from 'node:os';
import {chromium} from 'playwright-core';

const browser = await chromium.launch({
  headless: true,
  executablePath: os.homedir() + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
  args: ['--no-sandbox'],
});
try {
  for (const viewport of [{width:1280,height:800},{width:800,height:600},{width:390,height:844}]) {
    const page = await browser.newPage({viewport});
    await page.goto('http://127.0.0.1:4757/', {waitUntil:'domcontentloaded'});
    await page.locator('.native-toggle').click();
    await page.locator('[role=tab]').nth(1).click();
    await page.waitForTimeout(200);
    for (const zoom of [1,1.25,1.5]) {
      const geometry = await page.evaluate(zoom => {
        document.body.style.zoom = String(zoom);
        const panel = document.querySelector('.native-panel');
        const box = document.querySelector('[aria-label="Conversa Gemini"]');
        const history = box.querySelector('.native-history');
        const form = box.querySelector('form');
        if (history.dataset.layoutFixture !== '1') { history.dataset.layoutFixture='1'; for (let i=0;i<60;i++) {
          const article = document.createElement('article');
          article.className = 'native-item';
          const pre = document.createElement('pre');
          pre.textContent = 'Long Gemini reply with text and code. '.repeat(150);
          article.append(pre); history.append(article);
        }}
        const bounds = element => {const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}};
        return {viewport:innerHeight,panel:bounds(panel),box:bounds(box),history:bounds(history),form:bounds(form),historyScrolls:history.scrollHeight>history.clientHeight,documentWide:document.documentElement.scrollWidth>innerWidth};
      },zoom);
      const label=`${viewport.width}x${viewport.height} at ${zoom*100}%`;
      assert.ok(geometry.panel.bottom<=geometry.viewport+1,`${label}: panel exceeds viewport: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.box.bottom<=geometry.panel.bottom+1,`${label}: Gemini box exceeds panel: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.form.bottom<=geometry.panel.bottom+1,`${label}: composer outside panel: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.history.height>=40 && geometry.historyScrolls,`${label}: history is not usable: ${JSON.stringify(geometry)}`);
      assert.ok(!geometry.documentWide,`${label}: horizontal page overflow`);
      console.log(`PASS ${label}`);
      if (zoom === 1.5) {
        await page.locator('.native-gemini-options summary').click();
        const expanded = await page.evaluate(() => {
          const history=document.querySelector('.native-gemini-chat .native-history').getBoundingClientRect();
          const form=document.querySelector('.native-gemini-chat form').getBoundingClientRect();
          const panel=document.querySelector('.native-panel').getBoundingClientRect();
          return {historyHeight:history.height,formBottom:form.bottom,panelBottom:panel.bottom};
        });
        assert.ok(expanded.historyHeight >= 40 && expanded.formBottom <= expanded.panelBottom + 1, `${label}: expanded options crowd out chat: ${JSON.stringify(expanded)}`);
        console.log(`PASS ${label} expanded options`);
      }
    }
    await page.close();
  }
} finally {await browser.close();}
