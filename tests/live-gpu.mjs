// Live GPU render: the real site code against the real render box (cue_render.py on this VM), no mocks.
// Three demo scenes rendered on the T4 through the engine layer, then checked as playable clips in the switcher.
// Run: CUE_RENDER_TOKEN=$(cut -d= -f2 ~/.config/cue-render/env) NODE_PATH=/data/pat/node_modules BASE=http://127.0.0.1:8768 node tests/live-gpu.mjs
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:8766', box = process.env.RENDER_URL || 'http://127.0.0.1:8790', token = process.env.CUE_RENDER_TOKEN;
if (!token) { console.error('CUE_RENDER_TOKEN required'); process.exit(2); }
const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
// the page is on :8768 and the box on :8790: a cross-origin call, exactly as GitHub Pages → render.patpadgett.com will be
await page.goto(base, { waitUntil: 'networkidle' });
await page.evaluate(({ box, token }) => localStorage.setItem('cue.azure.v1', JSON.stringify({ mode: 'direct', model: 'local', resolution: '720p', localUrl: box, localToken: token })), { box, token });
await page.click('#try');
await page.waitForFunction(() => document.body.dataset.state === 'onair' && window.cue.tl, null, { timeout: 120000 });
// SETUP → TEST must reach the box
await page.click('#setup'); await page.click('#setup-test');
await page.waitForFunction(() => /Tesla|ok/.test(document.querySelector('#probe').textContent) && !/Testing/.test(document.querySelector('#probe').textContent), null, { timeout: 20000 });
const probe = await page.evaluate(() => document.querySelector('#probe').textContent); console.log('probe:', probe);
if (!/This GPU.*ok/.test(probe)) errors.push('SETUP TEST did not reach the render box: ' + probe);
await page.click('#setup-save');
// keep three short scenes so the proof takes minutes, not hours; the key reads FREE
await page.evaluate(() => { const keep = window.cue.tl.scenes.slice().sort((a, b) => a.bars - b.bars).slice(0, 3).map((s) => s.n); window.cue.treatment.cues = window.cue.treatment.cues.filter((c) => c.kind !== 'scene' || keep.includes(c.n)); window.cue.setTreatment(window.cue.treatment); });
const plan = await page.evaluate(() => ({ scenes: window.cue.tl.scenes.map((s) => ({ n: s.n, bars: s.bars, len: +(s.end - s.start).toFixed(1) })), cost: document.querySelector('#render-cost').textContent }));
console.log('plan:', JSON.stringify(plan));
if (!/^FREE/.test(plan.cost)) errors.push('RENDER key does not say FREE');
const t0 = Date.now();
await page.click('#render');
await page.waitForFunction(() => window.cue.job && window.cue.job.items.every((i) => i.id), null, { timeout: 30000 });
const queued = await page.evaluate(() => ({ line: document.querySelector('#render-line').textContent, tiles: [...document.querySelectorAll('#jobs .job__state')].map((s) => s.textContent) }));
console.log('queued:', JSON.stringify(queued));
// now wait for the T4. ~5 min per second of footage.
let last = '';
while (true) {
  const st = await page.evaluate(() => ({ done: window.cue.job.done, states: window.cue.job.items.map((i) => `${i.scene.n}:${i.state}${i.eta ? `:${i.eta}s` : ''}${i.error ? ':' + i.error : ''}`), line: document.querySelector('#render-line').textContent }));
  const s = st.states.join(' '); if (s !== last) { console.log(`${Math.round((Date.now() - t0) / 1000)}s`, s); last = s; }
  if (st.done) break;
  if (Date.now() - t0 > 90 * 60 * 1000) { errors.push('render did not finish in 90 minutes'); break; }
  await new Promise((r) => setTimeout(r, 15000));
}
const result = await page.evaluate(async () => {
  const items = window.cue.job.items.map((i) => ({ n: i.scene.n, state: i.state, error: i.error, bytes: i.blob?.size || 0 }));
  const vids = [];
  for (const [n, c] of window.cue.clips) { await new Promise((r) => { if (c.video.readyState >= 1) r(); else { c.video.onloadedmetadata = r; c.video.onerror = r; } }); vids.push({ n, w: c.video.videoWidth, h: c.video.videoHeight, dur: +c.video.duration.toFixed(2) }); }
  // draw a frame from each clip through the switcher and check it is not black
  const { drawFrame } = await import('./js/switcher.js'); const c = new OffscreenCanvas(320, 180); const ctx = c.getContext('2d'); const means = [];
  for (const s of window.cue.tl.scenes) { window.cue.clipFor(s, s.start + 0.5, false); await new Promise((r) => setTimeout(r, 300)); drawFrame(ctx, 320, 180, s.start + 0.5, window.cue.tl, window.cue.analysis, { clipFor: (sc) => window.cue.clipFor(sc, s.start + 0.5, false), palette: window.cue.treatment.palette, showShot: false }); const d = ctx.getImageData(0, 0, 320, 180).data; let sum = 0; for (let i = 0; i < d.length; i += 4 * 31) sum += d[i] + d[i + 1] + d[i + 2]; means.push(+(sum / (d.length / (4 * 31)) / 3).toFixed(1)); }
  return { items, vids, means, line: document.querySelector('#render-line').textContent, key: document.querySelector('#render').textContent.trim(), exportEnabled: !document.querySelector('#export').disabled };
});
console.log('result:', JSON.stringify(result));
console.log(`wall time ${Math.round((Date.now() - t0) / 60)} min`);
if (!result.items.every((i) => i.state === 'done' && i.bytes > 50000)) errors.push('a clip did not finish or is suspiciously small');
if (!result.vids.every((v) => v.w === 1280 && v.h === 704 && v.dur >= 1)) errors.push('clip is not 1280x704');
if (!result.means.every((m) => m > 8)) errors.push('a rendered clip drew black through the switcher');
if (!result.exportEnabled) errors.push('EXPORT not enabled after clips arrived');
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
