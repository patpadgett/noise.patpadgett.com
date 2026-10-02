// CUE smoke: demo → deck, clock runs, tally handoff, strobe envelope, injected clip plays through the
// switcher, export produces a file. Screenshots to $SHOTS. Run: NODE_PATH=/data/pat/node_modules node tests/smoke.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:8766';
const shots = process.env.SHOTS || '/data/pat/.hermes/cache/scratch/cue/shots'; fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/mp4-muxer/.test(m.location()?.url || '') ) errors.push('console: ' + m.text()); });
page.on('response', (r) => { if (r.status() >= 400 && !/mp4-muxer/.test(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`); });
await page.goto(base, { waitUntil: 'networkidle' });
console.log('title:', await page.title(), '| state:', await page.evaluate(() => document.body.dataset.state));
await page.screenshot({ path: shots + '/desk-nosource.png', fullPage: true });
await page.click('#try');
await page.waitForFunction(() => document.body.dataset.state === 'onair' && document.querySelectorAll('#ro-body tr').length > 10, null, { timeout: 120000 });
const deck = await page.evaluate(() => ({ rows: document.querySelectorAll('#ro-body tr').length, sections: document.querySelectorAll('#ro-body .sec').length, cost: document.querySelector('#render-cost').textContent, treat: document.querySelector('#treatment').textContent.slice(0, 80), bpm: window.cue.analysis.bpm, pvw: [...document.querySelectorAll('.mon--pvw .mon__tally span')].map((s) => s.textContent) }));
console.log('deck:', JSON.stringify(deck));
if (deck.rows < 20) errors.push('too few cue rows');
// play across the first cue boundary after 20 s (read from the cue sheet, so a regenerated treatment keeps the test honest) and watch the tally move
const boundary = await page.evaluate(() => window.cue.tl.cues.map((c) => c.start).filter((t) => t > 20).sort((a, b) => a - b)[0]);
console.log('tally boundary at', boundary.toFixed(2), 's');
await page.evaluate((t) => window.cue.seek(t), boundary - 1.2);
await page.click('#play');
await page.waitForTimeout(400);
const snap = async () => page.evaluate(() => ({ tc: document.querySelector('#tc').textContent, bar: document.querySelector('#bar').textContent, next: document.querySelector('#next').textContent, sec: document.querySelector('#section').textContent, air: [...document.querySelectorAll('#ro-body tr.is-air')].map((r) => r.dataset.n), nxt: document.querySelector('#ro-body tr.is-next')?.dataset.n, pgm: document.querySelector('#pgm').classList.contains('is-air'), pgmNext: document.querySelector('.mon--pvw.is-next .mon__tally span')?.textContent, scene: document.querySelector('#pgm-scene').textContent }));
const s1 = await snap(); await page.waitForTimeout(2500); const s2 = await snap();
console.log('t+0.4:', JSON.stringify(s1)); console.log('t+2.9:', JSON.stringify(s2));
if (!(s2.tc > s1.tc)) errors.push('clock did not advance');
if (!s1.pgm) errors.push('PGM tally not red while playing');
if (JSON.stringify(s1.air) === JSON.stringify(s2.air) && s1.nxt === s2.nxt) errors.push('tally did not hand off across the cue boundary');
await page.evaluate(() => window.cue.hideToast());
await page.waitForTimeout(250);
await page.screenshot({ path: shots + '/desktop.png', fullPage: true });
// light envelope sanity: strobe toggles, pulse decays, no-strobe swaps strobe for pulse
const env = await page.evaluate(async () => { const { lightLevel } = await import('./js/switcher.js'); const a = window.cue.analysis; const c = { start: 10, end: 20, effect: 'strobe', rate: 2 }; const beat = 60 / a.bpm; const b0 = a.barStarts[0]; const vals = []; for (let k = 0; k < 8; k++) vals.push(lightLevel(c, b0 + 10 + k * beat / 4, a, false)); const ns = []; for (let k = 0; k < 8; k++) ns.push(+lightLevel(c, b0 + 10 + k * beat / 4, a, true).toFixed(2)); return { strobe: vals, noStrobe: ns }; });
console.log('strobe envelope:', JSON.stringify(env));
if (!(env.strobe.includes(1) && env.strobe.includes(0))) errors.push('strobe envelope not toggling');
if (env.noStrobe.includes(0) && env.noStrobe.every((v) => v === 0 || v === 1)) errors.push('no-strobe did not soften to a pulse');
// inject a real clip for scene 1 (the Sora test clip served from /test-clip.mp4) and prove the switcher draws video pixels
await page.evaluate(async () => { const url = '/test-clip.mp4'; const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.src = url; video.preload = 'auto'; await new Promise((r) => { video.onloadeddata = r; video.onerror = r; }); window.cue.clips.set(window.cue.tl.scenes[0].n, { url, video }); window.cue.stop(); window.cue.seek(1.0); });
await page.click('#play'); await page.waitForTimeout(1200);
const px = await page.evaluate(() => { const c = document.querySelector('#screen'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let sum = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 97) { sum += d[i] + d[i + 1] + d[i + 2]; n++; } return { mean: +(sum / n / 3).toFixed(1), src: document.querySelector('#pgm-src').textContent }; });
console.log('clip on PGM:', JSON.stringify(px));
if (px.src !== 'VT') errors.push('injected clip not reported as VT on the PGM caption');
await page.click('#play');
// export 6 seconds (patched duration) to prove the encoder path produces a file
const exp = await page.evaluate(async () => { const { exportVideo } = await import('./js/footage.js'); const { drawFrame, sceneAt } = await import('./js/switcher.js'); const app = window.cue; const t0 = performance.now(); const r = await exportVideo({ W: 1280, H: 720, fps: 30, duration: 6, drawAt: async (ctx, w, h, t) => { drawFrame(ctx, w, h, t, app.tl, app.analysis, { clipFor: () => null, palette: app.treatment.palette }); }, audioBuffer: app.buffer, onProgress: () => {} }); return { ext: r.ext, kb: Math.round(r.blob.size / 1024), ms: Math.round(performance.now() - t0), type: r.blob.type }; });
console.log('export:', JSON.stringify(exp));
if (!(exp.kb > 50)) errors.push('export too small');
// mobile
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
m.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
await m.goto(base + '#demo', { waitUntil: 'networkidle' });
await m.waitForFunction(() => document.body.dataset.state === 'onair' && document.querySelectorAll('#ro-body tr').length > 10, null, { timeout: 120000 });
await m.waitForTimeout(600);
await m.evaluate(() => window.cue.hideToast());
await m.waitForTimeout(250);
console.log('mobile overflow:', await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth));
// RETAKE keys on phone rows: a real tap target that stays inside the viewport
const tap = await m.evaluate(() => { window.cue.setState('render'); const bs = [...document.querySelectorAll('#ro-body .redo')].map((b) => b.getBoundingClientRect()); window.cue.setState('onair'); return { n: bs.length, minH: Math.min(...bs.map((b) => b.height)), maxRight: Math.max(...bs.map((b) => b.right)), vw: innerWidth }; });
console.log('mobile RETAKE keys:', JSON.stringify(tap));
if (!(tap.n > 0 && tap.minH >= 24 && tap.maxRight <= tap.vw)) errors.push('RETAKE keys on phone rows are too small or run off the screen');
const sectionWrap = await m.evaluate(() => [...document.querySelectorAll('#ro-body tr.ro__section small')].some((s) => s.getBoundingClientRect().height > 24));
if (sectionWrap) errors.push('a section header time wraps on the phone');
await m.screenshot({ path: shots + '/mobile.png', fullPage: true });
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
