// Diagnose the renderer crash: 1 worker, crash listeners, full console.
import { chromium } from 'playwright';
import fs from 'fs';
const base = process.env.BASE || 'http://127.0.0.1:8765/';
const workers = +(process.env.WORKERS || 1);
const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=4096'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
await page.addInitScript(() => { globalThis.NOISE_MODEL_URL = location.origin + '/.impeccable/build/model.bin'; });
page.on('crash', () => console.log('PAGE CRASHED'));
page.on('close', () => console.log('page closed'));
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 200)));
page.on('worker', (w) => { console.log('worker started', w.url()); w.on('close', () => console.log('worker closed', w.url())); });
await page.goto(base, { waitUntil: 'networkidle' });
const clip = fs.readFileSync('/data/pat/.hermes/cache/scratch/noise4/demo40.wav');
await page.setInputFiles('#file', { name: 'demo40.wav', mimeType: 'audio/wav', buffer: clip });
await page.waitForFunction(() => document.body.dataset.stage === 'deck', null, { timeout: 180000 });
await page.evaluate((w) => { window.noise.ph.stop(); window.noise.cap.workers = w; }, workers);
const t0 = Date.now();
await page.click('#neural');
for (let i = 0; i < 400; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  try {
    const s = await page.evaluate(() => ({ st: document.body.dataset.stems, lcd: document.querySelector('#lcd-stems-main').textContent + ' / ' + document.querySelector('#lcd-stems-sub').textContent, regions: (window.noise.regions || []).length, mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }));
    console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(s));
    if (s.st === 'done' || s.st === 'error') break;
  } catch (e) { console.log('evaluate failed:', e.message.split('\n')[0]); break; }
}
await browser.close();
