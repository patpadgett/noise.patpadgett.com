// Live smoke against the deployed site: the demo must reach the deck with no page errors, the
// WASM module and model URL must be reachable with the headers the workers need, and the first
// neural click must stop at the confirm step (nothing is downloaded until the user says yes).
import { chromium } from 'playwright';
const base = process.env.BASE || 'https://noise.patpadgett.com';
const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
await page.goto(base, { waitUntil: 'networkidle' });
console.log('title:', await page.title());
await page.click('#try');
await page.waitForFunction(() => document.body.dataset.stage === 'deck', null, { timeout: 240000 });
await page.waitForTimeout(1500);
console.log('deck:', await page.evaluate(() => ({ playing: window.noise.ph.playing, bass: window.noise.ph.arr.events.filter((e) => e.kind === 'bass').length, bells: window.noise.ph.arr.events.filter((e) => e.kind === 'bell').length, lcd: document.querySelector('#lcd-stems-sub').textContent, key: document.querySelector('#lcd-key-main').textContent, pinup: getComputedStyle(document.querySelector('.bg__pinup')).opacity, sens: document.querySelector('[data-val=sens]').textContent })));
await page.evaluate(() => document.querySelector('#neural').click()); await page.waitForTimeout(400);
console.log('neural first click:', await page.evaluate(() => document.body.dataset.stems + ' / ' + document.querySelector('#lcd-stems-sub').textContent));
const wasm = await page.evaluate(async (b) => { const r = await fetch(b + '/vendor/demucs_free.wasm', { method: 'HEAD' }); return { status: r.status, type: r.headers.get('content-type'), len: r.headers.get('content-length') }; }, base);
console.log('wasm:', JSON.stringify(wasm));
const model = await page.evaluate(async () => { const { MODEL_URL } = await import('./js/stems.js'); const r = await fetch(MODEL_URL, { headers: { Range: 'bytes=0-15' } }); return { status: r.status, cors: r.headers.get('access-control-allow-origin'), range: r.headers.get('content-range') }; });
console.log('model:', JSON.stringify(model));
if (model.status !== 206 && model.status !== 200) errors.push('model not reachable from the live origin');
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
