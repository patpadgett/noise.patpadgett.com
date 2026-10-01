// NOISE neural-stem test: real Demucs WASM workers, a 40 s slice of the demo, model served from a
// local copy (route interception) so the test does not download 84 MB. Verifies: capability gate,
// chunk landing, region re-tune, deck takeover, LCD copy, no page errors. Takes ~5-8 minutes on 4 cores.
import { chromium } from 'playwright';
import fs from 'fs';
const base = process.env.BASE || 'http://127.0.0.1:8765/';
const shots = process.env.SHOTS || '/data/pat/.hermes/cache/scratch/noise4/shots';
const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
// serve the model from a local copy symlinked under .impeccable/build (gitignored) instead of downloading 84 MB
await page.addInitScript(() => { globalThis.NOISE_MODEL_URL = location.origin + '/.impeccable/build/model.bin'; });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(base, { waitUntil: 'networkidle' });
// feed a 40 s slice of the demo as a File so the test stays bounded
const clip = fs.readFileSync(process.env.CLIP || '/data/pat/.hermes/cache/scratch/noise4/demo40.wav');
await page.setInputFiles('#file', { name: 'demo40.wav', mimeType: 'audio/wav', buffer: clip });
await page.waitForFunction(() => document.body.dataset.stage === 'deck', null, { timeout: 180000 });
console.log('cap:', await page.evaluate(() => window.noise.cap));
console.log('lcd before:', await page.evaluate(() => document.querySelector('#lcd-stems-main').textContent + ' / ' + document.querySelector('#lcd-stems-sub').textContent));
await page.evaluate(() => window.noise.ph.stop());
const t0 = Date.now();
await page.click('#neural');
// first use asks before fetching 80 MB; the second click confirms
await page.waitForFunction(() => document.body.dataset.stems === 'confirm', null, { timeout: 10000 });
console.log('confirm step:', await page.evaluate(() => document.querySelector('#lcd-stems-main').textContent + ' / ' + document.querySelector('#lcd-stems-sub').textContent + ' / ' + document.querySelector('#neural').textContent));
await page.click('#neural');
await page.waitForFunction(() => document.body.dataset.stems === 'running', null, { timeout: 60000 });
console.log('running after', ((Date.now() - t0) / 1000).toFixed(1), 's; lcd:', await page.evaluate(() => document.querySelector('#lcd-stems-main').textContent + ' / ' + document.querySelector('#lcd-stems-sub').textContent), 'legend hidden:', await page.evaluate(() => document.querySelector('#wave-legend').hidden));
// play from the start so the lamps-per-region behaviour can be observed while regions land
await page.evaluate(() => window.noise.ph.play(0));
let last = '', sawLandedLamps = false;
const poll = setInterval(async () => { try { const s = await page.evaluate(() => { const on = document.querySelectorAll('.lamp.is-on').length, live = document.querySelectorAll('.lamp.is-live').length; return document.querySelector('#lcd-stems-main').textContent + ' / ' + document.querySelector('#lcd-stems-sub').textContent + ' / regions ' + (window.noise.regions || []).length + ' / lamps on ' + on + ' live ' + live + ' / pos ' + window.noise.ph.position().toFixed(0); }); if (/lamps on 4/.test(s) && document.body?.dataset?.stems !== 'done') sawLandedLamps = true; if (s !== last) { last = s; console.log('  ', ((Date.now() - t0) / 1000).toFixed(0) + 's', s); } } catch (e) {} }, 15000);
await page.waitForFunction(() => document.body.dataset.stems === 'done' || document.body.dataset.stems === 'error', null, { timeout: 1500000 });
clearInterval(poll);
const state = await page.evaluate(() => document.body.dataset.stems);
console.log('state:', state, 'after', ((Date.now() - t0) / 1000).toFixed(0), 's');
console.log('lcd after:', await page.evaluate(() => document.querySelector('#lcd-stems-main').textContent + ' / ' + document.querySelector('#lcd-stems-sub').textContent));
const info = await page.evaluate(() => { const n = window.noise.ph.neural; const m = window.noise.ph.melody; let voiced = 0, total = 0; for (const [, v] of m) { total++; if (v != null) voiced++; } const st = {}; for (let k = 0; k < 4; k++) { let s = 0; const d = window.noise.stemJob ? null : null; } return { chunks: n?.chunks.length, covered: n?.covered, n: n?.n, complete: n?.complete, lamps: [...document.querySelectorAll('.lamp.is-on')].length, melodySlots: total, voiced }; });
console.log('neural:', JSON.stringify(info));
// render 10 s from the neural material and pull peak + presence of the drums stem in perc bus
const r = await page.evaluate(async () => { const mix = await window.noise.ph.render(null, { from: 8, to: 20 }); let peak = 0; const d = mix.getChannelData(0); for (let i = 0; i < d.length; i += 5) peak = Math.max(peak, Math.abs(d[i])); return { dur: +mix.duration.toFixed(1), peak: +peak.toFixed(3) }; });
console.log('render from neural:', JSON.stringify(r));
await page.screenshot({ path: shots + '/desktop-neural.png', fullPage: true });
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
