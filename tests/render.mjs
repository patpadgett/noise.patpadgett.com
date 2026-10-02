// CUE render-desk test: the Sora job loop against a mocked Azure, end to end in the browser.
// Proves (1) every clip request carries a length Sora accepts (4/8/12) and the artist's direction, (2) a 400
// from Azure lands on the desk as the FULL message, not a 60-character tile stub, (3) a successful clip is
// drawn by the switcher at the slowed rate that makes it cover its scene, (4) RENDER on an open desk retries
// only the failures, (5) RETAKE re-renders exactly one scene, (6) STOP starts nothing new and RENDER resumes,
// (7) no text is ever drawn on the picture.
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
const jobs = new Map(); let nextId = 1; let pollsToFinish = 1;
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
    j.polls++; const done = j.polls >= pollsToFinish;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: m[1], object: 'video', status: done ? 'completed' : 'in_progress', progress: done ? 100 : 50 }) });
  }
  return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { message: 'mock: not found ' + p } }) });
});

await page.goto(base, { waitUntil: 'networkidle' });
// keys in localStorage (never real)
await page.evaluate((mock) => localStorage.setItem('cue.azure.v1', JSON.stringify({ mode: 'direct', openaiEndpoint: mock, openaiKey: 'test', speechRegion: 'eastus', speechKey: 'test' })), MOCK);
await page.click('#try');
await page.waitForFunction(() => document.body.dataset.state === 'onair' && document.querySelectorAll('#ro-body tr').length > 10, null, { timeout: 120000 });

// ---- 0. no lyric rows, no text on the picture, direction loaded from the demo ----
const deck = await page.evaluate(() => ({ kinds: [...new Set(window.cue.tl.cues.map((c) => c.kind))], src: [...new Set([...document.querySelectorAll('#ro-body .src')].map((s) => s.textContent))], direction: window.cue.direction, dirField: document.querySelector('#direction').value, hasLyricsFn: 'lyrics' in window.cue.tl, wordsKey: document.querySelector('#edit-lyrics').textContent }));
console.log('deck:', JSON.stringify(deck));
if (deck.kinds.includes('lyric') || deck.src.includes('LYR') || deck.hasLyricsFn) errors.push('lyric cues still present in the timeline or the running order');
if (!deck.direction || deck.dirField !== deck.direction) errors.push('demo direction not loaded into the field');
// drawFrame must not call any text method on the picture once footage is present
const textCalls = await page.evaluate(async () => { const { drawFrame } = await import('./js/switcher.js'); const app = window.cue; const c = new OffscreenCanvas(640, 360); const ctx = c.getContext('2d'); let calls = 0; const ft = ctx.fillText, st = ctx.strokeText; ctx.fillText = (...a) => { calls++; return ft.apply(ctx, a); }; ctx.strokeText = (...a) => { calls++; return st.apply(ctx, a); }; const fake = new OffscreenCanvas(16, 9); for (const t of [30, 47, 65, 93, 121, 148]) drawFrame(ctx, 640, 360, t, app.tl, app.analysis, { clipFor: () => fake, palette: app.treatment.palette }); return calls; });
console.log('text draw calls over footage:', textCalls);
if (textCalls !== 0) errors.push('text was drawn over footage');

// ---- 1. every planned clip length is one Sora accepts; cost line agrees ----
const plan = await page.evaluate(async () => { const { clipSeconds, estimateCost, CLIP_LENGTHS } = await import('./js/azure.js'); const a = window.cue.analysis, beat = 60 / a.bpm; return { lengths: window.cue.tl.scenes.map((s) => clipSeconds(s, beat)), est: estimateCost(window.cue.treatment, a), allowed: CLIP_LENGTHS, cost: document.querySelector('#render-cost').textContent }; });
console.log('plan:', JSON.stringify(plan));
if (!plan.lengths.every((s) => plan.allowed.includes(s))) errors.push('a planned clip length is not 4/8/12');
if (!plan.cost.startsWith('$' + plan.est.dollars.toFixed(2))) errors.push('RENDER key cost disagrees with estimateCost');
const N = plan.lengths.length;

// ---- 2. render against the mock; tag prompts with the scene number so the mock can pick a victim ----
await page.evaluate(() => { for (const s of window.cue.tl.scenes) s.shot = `SCENE_${s.n} ` + s.shot; });
// speed: shorten the 4 s poll by monkey-patching setTimeout for long waits inside the page
await page.evaluate(() => { const st = window.setTimeout; window.setTimeout = (fn, ms, ...a) => st(fn, ms >= 4000 ? 50 : ms, ...a); });
await page.click('#render');
await page.waitForFunction(() => window.cue.job && window.cue.job.done, null, { timeout: 60000 });
const after1 = await page.evaluate(() => ({ line: document.querySelector('#render-line').textContent, why: document.querySelector('#render-why').textContent, whyHidden: document.querySelector('#render-why').hidden, key: document.querySelector('#render').textContent.trim(), states: [...document.querySelectorAll('#jobs .job')].map((li) => ({ n: li.dataset.n, cls: li.className, state: li.querySelector('.job__state').textContent, title: li.title, redoShown: getComputedStyle(li.querySelector('.job__redo')).display !== 'none', redoEnabled: !li.querySelector('.job__redo').disabled, stateClipped: li.querySelector('.job__state').scrollWidth > li.querySelector('.job__state').clientWidth })), clips: window.cue.clips.size, spent: window.cue.job.spent, rowRedo: getComputedStyle(document.querySelector('#ro-body tr[data-n] .redo')).display, tileHeights: [...new Set([...document.querySelectorAll('#jobs .job')].map((li) => Math.round(li.getBoundingClientRect().height)))], rowHeights: [...new Set([...document.querySelectorAll('#ro-body tr[data-n]')].map((tr) => Math.round(tr.getBoundingClientRect().height)))] }));
console.log('after render:', JSON.stringify({ line: after1.line, why: after1.why, key: after1.key, clips: after1.clips, spent: after1.spent, rowRedo: after1.rowRedo, failedTile: after1.states.find((s) => s.n === '3') }));
if (after1.states.some((s) => s.stateClipped)) errors.push('a tile state label is truncated: ' + after1.states.filter((s) => s.stateClipped).map((s) => s.state).join(', '));
const sent = requests.map((r) => r.seconds); console.log('seconds sent:', sent.join(','));
if (!sent.every((s) => ['4', '8', '12'].includes(s))) errors.push('sent a clip length Sora rejects');
if (!requests.every((r) => r.prompt.includes('Setting and look: ' + deck.direction))) errors.push('direction missing from a Sora prompt');
if (!requests.every((r) => /no on-screen text/.test(r.prompt))) errors.push('no-text rule missing from a Sora prompt');
if (!after1.why.includes('moderation system') || after1.whyHidden) errors.push('full failure reason not on the desk');
if (!/1 failed/.test(after1.line)) errors.push('status line does not count the failure');
if (!after1.states.find((s) => s.n === '3')?.title.includes('real people')) errors.push('failure reason missing from the tile tooltip');
if (after1.key !== 'RETRY FAILED') errors.push('key did not become RETRY FAILED');
if (after1.clips !== N - 1) errors.push(`expected ${N - 1} clips, got ${after1.clips}`);
if (after1.spent !== plan.est.seconds - 12) errors.push(`spent ${after1.spent}s; a create rejected with a 400 costs nothing, so expected ${plan.est.seconds - 12}s`);
if (!after1.states.every((s) => s.redoShown)) errors.push('RETAKE key missing from a tile');
if (!after1.states.every((s) => s.redoEnabled)) errors.push('RETAKE key not lit on a finished or failed tile');
if (after1.rowRedo === 'none') errors.push('RETAKE key not shown on running-order VT rows while the desk is open');
console.log('tile heights:', after1.tileHeights.join(','), '· row heights:', after1.rowHeights.join(','));
if (after1.tileHeights.length > 1) errors.push('job tiles are not one height');

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

// ---- 4. RENDER on the open desk retries only the failed scene; finished clips cost nothing more ----
let before = requests.length;
await page.click('#render');
await page.waitForFunction(() => window.cue.job && window.cue.job.done, null, { timeout: 60000 });
const after2 = await page.evaluate(() => ({ line: document.querySelector('#render-line').textContent, whyHidden: document.querySelector('#render-why').hidden, key: document.querySelector('#render').textContent.trim(), clips: window.cue.clips.size, spent: window.cue.job.spent }));
console.log('after retry:', JSON.stringify(after2), '· new requests:', requests.length - before);
if (!after2.whyHidden) errors.push('failure reason still shown after the retry succeeded');
if (requests.length - before !== 1) errors.push('retry re-requested clips that were already done');
if (after2.clips !== N) errors.push('retry did not complete the set');
if (after2.key !== 'RENDER AGAIN') errors.push('key did not return to RENDER AGAIN');

// ---- 5. RETAKE from the running order: exactly one new request, one new clip url, nothing else touched ----
before = requests.length;
const target = await page.evaluate(() => { const n = window.cue.tl.scenes[2].n; return { n, urlBefore: window.cue.clips.get(n).url, otherUrls: [...window.cue.clips.entries()].filter(([k]) => k !== n).map(([, c]) => c.url) }; });
await page.click(`#ro-body tr[data-n="${target.n}"] .redo`);
await page.waitForFunction((n) => { const it = window.cue.job.items.find((i) => i.scene.n === n); return it.retake === 1 && it.state === 'done' && window.cue.job.done && window.cue.clips.has(n); }, target.n, { timeout: 60000 });
const after3 = await page.evaluate((t) => { const it = window.cue.job.items.find((i) => i.scene.n === t.n); return { newReq: null, urlAfter: window.cue.clips.get(t.n).url, otherSame: [...window.cue.clips.entries()].filter(([k]) => k !== t.n).every(([, c], i) => c.url === t.otherUrls[i]), take: it.retake, state: document.querySelector(`#jobs li[data-n="${t.n}"] .job__state`).textContent, line: document.querySelector('#render-line').textContent }; }, target);
after3.newReq = requests.length - before;
console.log('after retake:', JSON.stringify(after3));
if (after3.newReq !== 1) errors.push(`retake made ${after3.newReq} requests, expected 1`);
if (!requests[requests.length - 1].prompt.startsWith(`SCENE_${target.n} `)) errors.push('retake rendered the wrong scene');
if (after3.urlAfter === target.urlBefore) errors.push('retake did not replace the clip');
if (!after3.otherSame) errors.push('retake disturbed another scene\'s clip');
if (after3.take !== 1 || !/take 2/.test(after3.state)) errors.push('tile does not say take 2');
if (!after3.line.includes(`$${((plan.est.seconds + 12) * 0.10).toFixed(2)} spent`)) errors.push(`spent line did not add the retake: ${after3.line}`);

// ---- 6. a fresh desk (new format) + STOP: nothing new starts; RENDER THE REST resumes; RETAKE works while stopped ----
pollsToFinish = 6; // slower jobs so STOP lands mid-render
await page.click('label.fmt:has(input[value="9:16"]) span');
await page.waitForFunction(() => window.cue.job && window.cue.job.items.length > 0 && document.querySelectorAll('#jobs .job').length > 0, null, { timeout: 10000 });
await page.waitForTimeout(300);
const fresh = await page.evaluate(() => ({ stopped: window.cue.job.stopped, inflight: window.cue.job.inflight, cached: window.cue.job.items.filter((i) => i.cached).length, key: document.querySelector('#render').textContent.trim(), line: document.querySelector('#render-line').textContent }));
console.log('fresh 9:16 desk:', JSON.stringify(fresh));
if (fresh.inflight !== 0 || !fresh.stopped) errors.push('switching format started rendering on its own');
if (fresh.cached !== 0) errors.push('16:9 clips leaked into the 9:16 desk cache');
if (!/^RENDER \$/.test(fresh.key) || /Stopped/.test(fresh.line)) errors.push(`fresh desk should offer RENDER + cost, not a stopped state: ${fresh.key} / ${fresh.line}`);
before = requests.length;
await page.click('#render');
await page.waitForFunction(() => window.cue.job.inflight === 2, null, { timeout: 10000 });
await page.click('#render-cancel');
const stopped = await page.evaluate(() => ({ stopped: window.cue.job.stopped, inflight: window.cue.job.inflight, key: document.querySelector('#render').textContent.trim(), cancelDisabled: document.querySelector('#render-cancel').disabled }));
console.log('stopped:', JSON.stringify(stopped));
if (!stopped.stopped || stopped.inflight !== 2) errors.push('STOP did not hold the pool at the two in flight');
if (stopped.key !== 'RENDER THE REST') errors.push('key did not become RENDER THE REST');
await page.waitForFunction(() => window.cue.job.inflight === 0, null, { timeout: 60000 });
const held = await page.evaluate(() => ({ done: window.cue.job.items.filter((i) => i.state === 'done').length, queued: window.cue.job.queued, reqs: null, line: document.querySelector('#render-line').textContent }));
held.reqs = requests.length - before;
console.log('held:', JSON.stringify(held));
if (held.reqs !== 2) errors.push(`stopped pool made ${held.reqs} requests, expected exactly the 2 that were in flight`);
if (held.done !== 2 || held.queued !== N - 2) errors.push('stopped pool did not keep the rest queued');
if (!/Stopped/.test(held.line)) errors.push('desk line does not say Stopped');
// a retake while stopped renders only that scene
before = requests.length; const doneN = await page.evaluate(() => window.cue.job.items.find((i) => i.state === 'done').scene.n);
await page.click(`#jobs li[data-n="${doneN}"] .job__redo`);
await page.waitForFunction((n) => { const it = window.cue.job.items.find((i) => i.scene.n === n); return it.state === 'done' && it.retake === 1 && window.cue.job.inflight === 0; }, doneN, { timeout: 60000 });
const stoppedRetake = await page.evaluate(() => ({ queued: window.cue.job.queued, reqs: null }));
stoppedRetake.reqs = requests.length - before;
console.log('retake while stopped:', JSON.stringify(stoppedRetake));
if (stoppedRetake.reqs !== 1 || stoppedRetake.queued !== N - 2) errors.push('retake on a stopped desk rendered more than that scene');
// resume
pollsToFinish = 1; before = requests.length;
await page.click('#render');
await page.waitForFunction(() => window.cue.job && window.cue.job.done, null, { timeout: 60000 });
const resumed = await page.evaluate(() => ({ done: window.cue.job.items.filter((i) => i.state === 'done').length, key: document.querySelector('#render').textContent.trim(), reqs: null }));
resumed.reqs = requests.length - before;
console.log('resumed:', JSON.stringify(resumed));
if (resumed.reqs !== N - 2) errors.push(`resume made ${resumed.reqs} requests, expected ${N - 2}`);
if (resumed.done !== N) errors.push('resume did not finish the set');

console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
