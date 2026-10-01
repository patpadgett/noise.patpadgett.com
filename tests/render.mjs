// CUE render-desk test: the Sora job loop against a mocked Azure, end to end in the browser.
// Proves (1) every clip request carries a length Sora accepts (4/8/12), (2) a 400 from Azure lands on
// the desk as the FULL message, not a 60-character tile stub, (3) a successful clip is drawn by the
// switcher at the slowed rate that makes it cover its scene, (4) RETRY FAILED only re-pays the failures.
// Run: python3 -m http.server 8766 in the checkout, then NODE_PATH=/data/pat/node_modules node tests/render.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:8766';
const clip = fs.readFileSync(new URL('../test-clip.mp4', import.meta.url));
const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], requests = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

// ---- the mock: a fake Azure OpenAI v1 videos API on the page's own origin (no CORS in the way).
// Scene 3 fails once with a real Sora moderation message; anything but 4/8/12 s gets Sora's real 400. ----
const MOCK = base + '/mock-azure';
let failOnce = new Set(['3']);
const jobs = new Map(); let nextId = 1;
await page.route(MOCK + '/**', async (route) => {
  const req = route.request(); const url = new URL(req.url()); const p = url.pathname.replace('/mock-azure/openai/v1', '');
  if (p === '/videos' && req.method() === 'POST') {
    const body = req.postDataJSON(); requests.push(body);
    if (!['4', '8', '12'].includes(body.seconds)) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: `Invalid value: '${body.seconds}'. Supported values are: '4', '8', and '12'.`, type: 'invalid_request_error', param: 'seconds', code: 'invalid_value' } }) });
    const sceneN = /SCENE_(\d+)/.exec(body.prompt)?.[1];
    if (sceneN && failOnce.has(sceneN)) { failOnce.delete(sceneN); return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: "Your request was rejected by our moderation system because it may violate our content policy regarding depictions of real people.", type: 'invalid_request_error', code: 'moderation_blocked' } }) }); }
    const id = 'video_mock_' + (nextId++); jobs.set(id, { polls: 0, seconds: body.seconds });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, object: 'video', status: 'queued', progress: 0, seconds: body.seconds, size: body.size }) });
  }
  const m = /^\/videos\/([\w-]+)(\/content)?$/.exec(p);
  if (m && jobs.has(m[1])) {
    const j = jobs.get(m[1]);
    if (m[2]) return route.fulfill({ status: 200, contentType: 'video/mp4', body: clip });
    j.polls++; const done = j.polls >= 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: m[1], object: 'video', status: done ? 'completed' : 'in_progress', progress: done ? 100 : 50 }) });
  }
  return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { message: 'mock: not found ' + p } }) });
});

await page.goto(base, { waitUntil: 'networkidle' });
// keys in localStorage (never real), and a 0.2 s poll so the test runs in seconds
await page.evaluate((mock) => localStorage.setItem('cue.azure.v1', JSON.stringify({ mode: 'direct', openaiEndpoint: mock, openaiKey: 'test', speechRegion: 'eastus', speechKey: 'test' })), MOCK);
await page.click('#try');
await page.waitForFunction(() => document.body.dataset.state === 'onair' && document.querySelectorAll('#ro-body tr').length > 10, null, { timeout: 120000 });

// ---- 1. every planned clip length is one Sora accepts; cost line agrees ----
const plan = await page.evaluate(async () => { const { clipSeconds, estimateCost, CLIP_LENGTHS } = await import('./js/azure.js'); const a = window.cue.analysis, beat = 60 / a.bpm; return { lengths: window.cue.tl.scenes.map((s) => clipSeconds(s, beat)), est: estimateCost(window.cue.treatment, a), allowed: CLIP_LENGTHS, cost: document.querySelector('#render-cost').textContent }; });
console.log('plan:', JSON.stringify(plan));
if (!plan.lengths.every((s) => plan.allowed.includes(s))) errors.push('a planned clip length is not 4/8/12');
if (!plan.cost.startsWith('$' + plan.est.dollars.toFixed(2))) errors.push('RENDER key cost disagrees with estimateCost');

// ---- 2. render against the mock; tag prompts with the scene number so the mock can pick a victim ----
await page.evaluate(async () => { const f = await import('./js/footage.js'); for (const s of window.cue.tl.scenes) s.shot = `SCENE_${s.n} ` + s.shot; window.__sleepPatched = true; });
// speed: shorten the 4 s poll by monkey-patching setTimeout for long waits inside the page
await page.evaluate(() => { const st = window.setTimeout; window.setTimeout = (fn, ms, ...a) => st(fn, ms >= 4000 ? 50 : ms, ...a); });
await page.click('#render');
await page.waitForFunction(() => window.cue.job && window.cue.job.done, null, { timeout: 60000 });
const after1 = await page.evaluate(() => ({ line: document.querySelector('#render-line').textContent, key: document.querySelector('#render').textContent.trim(), states: [...document.querySelectorAll('#jobs .job')].map((li) => ({ n: li.dataset.n, cls: li.className, state: li.querySelector('.job__state').textContent, title: li.title })), clips: window.cue.clips.size, spent: window.cue.job.spent }));
console.log('after render:', JSON.stringify(after1, null, 1));
const sent = requests.map((r) => r.seconds); console.log('seconds sent:', sent.join(','));
if (!sent.every((s) => ['4', '8', '12'].includes(s))) errors.push('sent a clip length Sora rejects');
if (!after1.line.includes('moderation system')) errors.push('full failure reason not on the desk line');
if (!after1.states.find((s) => s.n === '3')?.title.includes('real people')) errors.push('failure reason missing from the tile tooltip');
if (after1.key !== 'RETRY FAILED') errors.push('key did not become RETRY FAILED');
if (after1.clips !== plan.lengths.length - 1) errors.push(`expected ${plan.lengths.length - 1} clips, got ${after1.clips}`);
if (after1.spent !== plan.est.seconds - 12) errors.push(`spent ${after1.spent}s; a create rejected with a 400 costs nothing, so expected ${plan.est.seconds - 12}s`);

// ---- 3. the clip is drawn at the slowed rate that covers its scene ----
const rateCheck = await page.evaluate(async () => { const { clipRate, clipTime } = await import('./js/switcher.js'); const s = window.cue.tl.scenes[0]; const c = window.cue.clips.get(s.n); await new Promise((r) => { if (c.video.readyState >= 1) r(); else c.video.onloadedmetadata = r; }); const len = s.end - s.start; const rate = clipRate(s, c.video.duration); window.cue.seek(s.start + len / 2); window.cue.clipFor(s, s.start + len / 2); return { sceneLen: +len.toFixed(2), clipDur: +c.video.duration.toFixed(2), rate: +rate.toFixed(3), playbackRate: c.video.playbackRate, mtMid: +clipTime(s, c.video.duration, s.start + len / 2).toFixed(2), mtEnd: +clipTime(s, c.video.duration, s.end).toFixed(2) }; });
console.log('rate:', JSON.stringify(rateCheck));
if (Math.abs(rateCheck.playbackRate - rateCheck.rate) > 0.001) errors.push('video playbackRate not set to clipRate');
if (!(rateCheck.mtEnd <= rateCheck.clipDur && rateCheck.mtEnd > rateCheck.clipDur - 0.2)) errors.push('clip does not run out exactly at the scene OUT');
if (Math.abs(rateCheck.mtMid - rateCheck.clipDur / 2) > 0.1) errors.push('clip midpoint does not land on the scene midpoint');
// the PGM really shows video pixels, not the slate
await page.click('#play'); await page.waitForTimeout(900);
const px = await page.evaluate(() => { const c = document.querySelector('#screen'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let sum = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 97) { sum += d[i] + d[i + 1] + d[i + 2]; n++; } return { mean: +(sum / n / 3).toFixed(1), src: document.querySelector('#pgm-src').textContent }; });
await page.click('#play');
console.log('PGM:', JSON.stringify(px));
if (px.src !== 'VT') errors.push('PGM caption does not say VT with a clip present');

// ---- 4. RETRY FAILED renders only the failed scene; cached clips cost nothing more ----
const before = requests.length;
await page.click('#render');
await page.waitForFunction(() => window.cue.job && window.cue.job.done, null, { timeout: 60000 });
const after2 = await page.evaluate(() => ({ line: document.querySelector('#render-line').textContent, key: document.querySelector('#render').textContent.trim(), clips: window.cue.clips.size, cached: window.cue.job.items.filter((i) => i.cached).length, spent: window.cue.job.spent }));
console.log('after retry:', JSON.stringify(after2));
console.log('new requests on retry:', requests.length - before);
if (requests.length - before !== 1) errors.push('retry re-requested clips that were already cached');
if (after2.clips !== plan.lengths.length) errors.push('retry did not complete the set');
if (after2.key !== 'RE-RENDER') errors.push('key did not return to RE-RENDER');

console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
