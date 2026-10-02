// CUE render-desk test: the footage job loop against a mocked Higgsfield (the default engine), end to end in the browser,
// then the same desk against a mocked Sora (the retiring engine) and a mocked GPU render box.
// Proves (1) every Higgsfield create carries an exact whole-second duration within the model's range, the artist's
// direction, an Idempotency-Key and sound off, (2) a failure lands on the desk as the FULL message, (3) a clip plays at the
// rate that covers its scene, (4) RENDER on an open desk retries only the failures, (5) RETAKE re-renders exactly one
// scene, (6) STOP starts nothing new and RENDER resumes, (7) an nsfw result is not counted as spent, (8) no text is drawn
// on the picture, (9) switching engine in SETUP rebuilds the desk from that engine's cache and the RENDER key reprices,
// (10) the GPU tier shows FREE and a queue ETA.
// Run: python3 -m http.server 8766 in the checkout, then NODE_PATH=/data/pat/node_modules node tests/render.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:8766';
const clip = fs.readFileSync(new URL('../test-clip.mp4', import.meta.url));
const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], requests = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

// ---- the mocks live on the page's own origin (no CORS in the way) ----
const HF = base + '/mock-hf', SORA = base + '/mock-azure', GPU = base + '/mock-gpu';
let failOnce = new Set(['3']), nsfwOnce = new Set();
const jobs = new Map(); let nextId = 1; let pollsToFinish = 1;
await page.route(HF + '/**', async (route) => {
  const req = route.request(); const url = new URL(req.url()); const p = url.pathname.replace('/mock-hf', '');
  const hdrs = req.headers();
  if (p.startsWith('/kling-video/') && req.method() === 'POST') {
    const body = req.postDataJSON(); requests.push({ engine: 'hf', path: p, body, idem: hdrs['idempotency-key'] || null, auth: hdrs['authorization'] || null });
    if (!Number.isInteger(body.duration) || body.duration < 3 || body.duration > 15) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: `duration must be between 3 and 15, got ${body.duration}` }) });
    const sceneN = /SCENE_(\d+)/.exec(body.prompt)?.[1];
    if (sceneN && failOnce.has(sceneN)) { failOnce.delete(sceneN); return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ detail: 'Prompt was rejected by the content moderation policy: depictions of real public figures are not allowed.' }) }); }
    const id = 'hf-' + (nextId++); jobs.set(id, { polls: 0, nsfw: !!(sceneN && nsfwOnce.has(sceneN)) }); if (sceneN) nsfwOnce.delete(sceneN);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ request_id: id, status: 'queued', status_url: `${HF}/requests/${id}/status`, cancel_url: `${HF}/requests/${id}/cancel` }) });
  }
  const m = /^\/requests\/([\w-]+)\/status$/.exec(p);
  if (m && jobs.has(m[1])) { const j = jobs.get(m[1]); j.polls++; const done = j.polls >= pollsToFinish; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(done ? (j.nsfw ? { request_id: m[1], status: 'nsfw', error: null } : { request_id: m[1], status: 'completed', video: { url: `${HF}/cdn/${m[1]}.mp4` } }) : { request_id: m[1], status: 'in_progress' }) }); }
  if (/^\/cdn\/.+\.mp4$/.test(p)) return route.fulfill({ status: 200, contentType: 'video/mp4', body: clip });
  if (m) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Request not found' }) });
  return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'mock: not found ' + p }) });
});
await page.route(SORA + '/**', async (route) => {
  const req = route.request(); const p = new URL(req.url()).pathname.replace('/mock-azure/openai/v1', '');
  if (p === '/videos' && req.method() === 'POST') { const body = req.postDataJSON(); requests.push({ engine: 'sora', body }); if (!['4', '8', '12'].includes(body.seconds)) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: `Invalid value: '${body.seconds}'. Supported values are: '4', '8', and '12'.` } }) }); const id = 'video_' + (nextId++); jobs.set(id, { polls: 0 }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, status: 'queued', progress: 0 }) }); }
  const m = /^\/videos\/([\w-]+)(\/content)?$/.exec(p);
  if (m && jobs.has(m[1])) { const j = jobs.get(m[1]); if (m[2]) return route.fulfill({ status: 200, contentType: 'video/mp4', body: clip }); j.polls++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: m[1], status: j.polls >= pollsToFinish ? 'completed' : 'in_progress', progress: 50 }) }); }
  if (p === '/videos' && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' });
  return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"message":"mock"}}' });
});
await page.route(GPU + '/**', async (route) => {
  const req = route.request(); const p = new URL(req.url()).pathname.replace('/mock-gpu', ''); const auth = req.headers()['authorization'];
  if (auth !== 'Bearer gpu-token') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"bad token"}' });
  if (p === '/health') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, gpu: 'Tesla T4', queue: 0 }) });
  if (p === '/jobs' && req.method() === 'POST') { const body = req.postDataJSON(); requests.push({ engine: 'gpu', body }); if (body.seconds < 1 || body.seconds > 5) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: `seconds must be 1..5 (got ${body.seconds})` }) }); const id = 'g' + (nextId++); jobs.set(id, { polls: 0 }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, status: 'queued', position: 2, eta: 600 }) }); }
  const m = /^\/jobs\/(\w+)(\/video)?$/.exec(p);
  if (m && jobs.has(m[1])) { const j = jobs.get(m[1]); if (m[2]) return route.fulfill({ status: 200, contentType: 'video/mp4', body: clip }); j.polls++; const done = j.polls >= pollsToFinish; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: m[1], status: done ? 'done' : 'running', progress: done ? 1 : 0.4, eta: done ? 0 : 180, position: 0 }) }); }
  return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });
});

await page.goto(base, { waitUntil: 'networkidle' });
// keys in localStorage (never real): Higgsfield is the engine for the first passes; Azure keys exist for the cue sheet
await page.evaluate(({ hf, sora }) => localStorage.setItem('cue.azure.v1', JSON.stringify({ mode: 'direct', model: 'kling-std', resolution: '720p', higgsfieldKey: 'id:secret', openaiEndpoint: sora, openaiKey: 'test', speechRegion: 'eastus', speechKey: 'test' })), { hf: HF, sora: SORA });
// the engine module builds Higgsfield URLs from a constant; point it at the mock
await page.addInitScript(() => {});
await page.click('#try');
await page.waitForFunction(() => document.body.dataset.state === 'onair' && document.querySelectorAll('#ro-body tr').length > 10, null, { timeout: 120000 });
// redirect api.higgsfield.ai → the mock at the fetch layer (the module hard-codes the real host, which is right for production)
await page.evaluate((hf) => { const f = window.fetch; window.fetch = (u, o) => f(String(u).replace('https://api.higgsfield.ai', hf), o); }, HF);

// ---- 0. no lyric rows, no text on the picture, direction loaded from the demo ----
const deck = await page.evaluate(() => ({ kinds: [...new Set(window.cue.tl.cues.map((c) => c.kind))], src: [...new Set([...document.querySelectorAll('#ro-body .src')].map((s) => s.textContent))], direction: window.cue.direction, dirField: document.querySelector('#direction').value, cost: document.querySelector('#render-cost').textContent, title: document.querySelector('#render').title }));
console.log('deck:', JSON.stringify(deck));
if (deck.kinds.includes('lyric') || deck.src.includes('LYR')) errors.push('lyric cues still present');
if (!deck.direction || deck.dirField !== deck.direction) errors.push('demo direction not loaded into the field');
if (!/Kling 3\.0 Standard/.test(deck.title)) errors.push('RENDER key does not name the engine');
const textCalls = await page.evaluate(async () => { const { drawFrame } = await import('./js/switcher.js'); const app = window.cue; const c = new OffscreenCanvas(640, 360); const ctx = c.getContext('2d'); let calls = 0; const ft = ctx.fillText, st = ctx.strokeText; ctx.fillText = (...a) => { calls++; return ft.apply(ctx, a); }; ctx.strokeText = (...a) => { calls++; return st.apply(ctx, a); }; const fake = new OffscreenCanvas(16, 9); for (const t of [30, 47, 65, 93, 121, 148]) drawFrame(ctx, 640, 360, t, app.tl, app.analysis, { clipFor: () => fake, palette: app.treatment.palette }); return calls; });
if (textCalls !== 0) errors.push('text was drawn over footage');

// ---- 0b. the cap is on length, never on count ----
const capCheck = await page.evaluate(async () => { const { normalizeTreatment, maxSceneBars } = await import('./js/switcher.js'); const a = window.cue.analysis; const t = normalizeTreatment({ cues: [{ n: 1, kind: 'scene', in: 1, beat: 1, bars: 40, anchor: 'x', cue: 'y', shot: 'z', effect: 'none', rate: 0, color: '' }] }, a); return { pieces: t.cues.length, bars: t.cues.map((c) => c.bars), maxBars: maxSceneBars(a) }; });
console.log('cap:', JSON.stringify(capCheck));
if (!(capCheck.pieces === Math.ceil(40 / capCheck.maxBars) && capCheck.bars.every((b) => b <= capCheck.maxBars) && capCheck.bars.reduce((s, b) => s + b, 0) === 40)) errors.push('over-long scene not split to the cap');

// ---- 1. the plan: exact lengths within Kling's range; the RENDER key agrees with estimateCost; count is open ----
const plan = await page.evaluate(async () => { const { planClip, estimateCost, MODELS } = await import('./js/engines.js'); const { maxSceneBars } = await import('./js/switcher.js'); const a = window.cue.analysis, beat = 60 / a.bpm; const m = MODELS['kling-std']; const byN = Object.fromEntries(window.cue.tl.scenes.map((s) => [s.n, planClip(s, beat, m, '720p')])); return { lengths: Object.values(byN).map((p) => p.seconds), byN, est: estimateCost(window.cue.treatment, a), cost: document.querySelector('#render-cost').textContent, maxBars: maxSceneBars(a), longestBars: Math.max(...window.cue.tl.scenes.map((s) => s.bars)), barsCovered: window.cue.tl.scenes.reduce((s, c) => s + c.bars, 0), bars: a.barStarts.length, exact: window.cue.tl.scenes.map((s) => ({ need: s.end - s.start, got: byN[s.n].seconds })) }; });
console.log('plan:', JSON.stringify({ scenes: plan.lengths.length, est: plan.est, cost: plan.cost, maxBars: plan.maxBars, longestBars: plan.longestBars, covered: `${plan.barsCovered}/${plan.bars}` }));
if (!plan.lengths.every((s) => Number.isInteger(s) && s >= 3 && s <= 15)) errors.push('a planned clip length is outside Kling\'s 3–15 whole seconds');
if (!plan.exact.every((x) => x.got >= x.need - 0.05 && x.got < Math.max(3, x.need) + 1.01)) errors.push('clip lengths are not exact (ceil to the second, min 3)');
if (!plan.cost.startsWith('$' + plan.est.dollars.toFixed(2))) errors.push('RENDER key cost disagrees with estimateCost');
if (plan.longestBars > plan.maxBars) errors.push('a scene is longer than the cap');
if (plan.barsCovered < plan.bars) errors.push('scenes do not cover every bar');
if (plan.lengths.length < 20) errors.push(`only ${plan.lengths.length} scenes: the count must not be capped`);
const N = plan.lengths.length, FAIL_PRICE = plan.byN[3].price;

// ---- 2. render against the Higgsfield mock ----
await page.evaluate(() => { for (const s of window.cue.tl.scenes) s.shot = `SCENE_${s.n} ` + s.shot; });
await page.evaluate(() => { const st = window.setTimeout; window.setTimeout = (fn, ms, ...a) => st(fn, ms >= 4000 ? 50 : ms, ...a); });
await page.click('#render');
await page.waitForFunction(() => window.cue.job && window.cue.job.done, null, { timeout: 60000 });
const after1 = await page.evaluate(() => ({ line: document.querySelector('#render-line').textContent, why: document.querySelector('#render-why').textContent, whyHidden: document.querySelector('#render-why').hidden, key: document.querySelector('#render').textContent.trim(), states: [...document.querySelectorAll('#jobs .job')].map((li) => ({ n: li.dataset.n, state: li.querySelector('.job__state').textContent, title: li.title, redoEnabled: !li.querySelector('.job__redo').disabled, redoLabel: li.querySelector('.job__redo').textContent, stateClipped: li.querySelector('.job__state').scrollWidth > li.querySelector('.job__state').clientWidth })), clips: window.cue.clips.size, spent: window.cue.job.spentDollars, MAX: window.cue.job.MAX, tileHeights: [...new Set([...document.querySelectorAll('#jobs .job')].map((li) => Math.round(li.getBoundingClientRect().height)))] }));
console.log('after render:', JSON.stringify({ line: after1.line, why: after1.why, key: after1.key, clips: after1.clips, spent: after1.spent, MAX: after1.MAX, failedTile: after1.states.find((s) => s.n === '3') }));
const hfReqs = requests.filter((r) => r.engine === 'hf');
console.log('durations sent:', hfReqs.map((r) => r.body.duration).join(','));
if (after1.MAX !== 4) errors.push('Higgsfield pool should run 4 at a time');
if (!hfReqs.every((r) => r.path === '/kling-video/v3.0/std/text-to-video')) errors.push('wrong model path');
if (!hfReqs.every((r) => Number.isInteger(r.body.duration) && r.body.duration >= 3 && r.body.duration <= 15)) errors.push('sent a duration Kling rejects');
if (!hfReqs.every((r) => r.body.sound === 'off')) errors.push('Kling sound not turned off (the song is the soundtrack)');
if (!hfReqs.every((r) => r.body.aspect_ratio === '16:9')) errors.push('aspect ratio not 16:9 for the landscape desk');
if (!hfReqs.every((r) => r.idem && r.idem.length > 10)) errors.push('Idempotency-Key missing from a create');
if (new Set(hfReqs.map((r) => r.idem)).size !== hfReqs.length) errors.push('Idempotency-Keys are not unique per attempt');
if (!hfReqs.every((r) => r.auth === 'Key id:secret')) errors.push('Authorization header wrong');
if (!hfReqs.every((r) => r.body.prompt.includes('Setting and look: ' + deck.direction))) errors.push('direction missing from a prompt');
if (!hfReqs.every((r) => /no on-screen text/.test(r.body.prompt))) errors.push('no-text rule missing from a prompt');
if (!after1.why.includes('content moderation policy') || after1.whyHidden) errors.push('full failure reason not on the desk');
if (!/1 failed/.test(after1.line)) errors.push('status line does not count the failure');
if (!after1.states.find((s) => s.n === '3')?.title.includes('public figures')) errors.push('failure reason missing from the tile tooltip');
if (after1.key !== 'RETRY FAILED') errors.push('key did not become RETRY FAILED');
if (after1.clips !== N - 1) errors.push(`expected ${N - 1} clips, got ${after1.clips}`);
if (Math.abs(after1.spent - (plan.est.dollars - FAIL_PRICE)) > 0.011) errors.push(`spent $${after1.spent}; a create rejected with a 400 costs nothing, so expected $${(plan.est.dollars - FAIL_PRICE).toFixed(2)}`);
if (!after1.states.every((s) => s.redoEnabled)) errors.push('RETAKE key not lit on a finished or failed tile');
if (!after1.states.every((s) => /RETAKE · \$\d/.test(s.redoLabel))) errors.push('RETAKE key does not show the clip price');
if (after1.states.some((s) => s.stateClipped)) errors.push('a tile state label is truncated');
if (after1.tileHeights.length > 1) errors.push('job tiles are not one height');

// ---- 3. the clip is drawn at the rate that covers its scene (exact clips → rate ≈ 1 or just under) ----
const rateCheck = await page.evaluate(async () => { const { clipRate, clipTime } = await import('./js/switcher.js'); const s = window.cue.tl.scenes[0]; const c = window.cue.clips.get(s.n); await new Promise((r) => { if (c.video.readyState >= 1) r(); else c.video.onloadedmetadata = r; }); const len = s.end - s.start; const rate = clipRate(s, c.video.duration); window.cue.seek(s.start + len / 2); window.cue.clipFor(s, s.start + len / 2); return { sceneLen: +len.toFixed(2), clipDur: +c.video.duration.toFixed(2), rate: +rate.toFixed(3), playbackRate: c.video.playbackRate, mtEnd: +clipTime(s, c.video.duration, s.end).toFixed(2) }; });
console.log('rate:', JSON.stringify(rateCheck));
if (Math.abs(rateCheck.playbackRate - rateCheck.rate) > 0.001) errors.push('video playbackRate not set to clipRate');
if (!(rateCheck.mtEnd <= rateCheck.clipDur + 0.001)) errors.push('clip runs past its end');
await page.click('#play'); await page.waitForTimeout(700);
const px = await page.evaluate(() => ({ src: document.querySelector('#pgm-src').textContent }));
await page.click('#play');
if (px.src !== 'VT') errors.push('PGM caption does not say VT with a clip present');

// ---- 4. RENDER on the open desk retries only the failed scene ----
let before = requests.length;
await page.click('#render');
await page.waitForFunction(() => window.cue.job && window.cue.job.done, null, { timeout: 60000 });
const after2 = await page.evaluate(() => ({ whyHidden: document.querySelector('#render-why').hidden, key: document.querySelector('#render').textContent.trim(), clips: window.cue.clips.size, spent: window.cue.job.spentDollars }));
console.log('after retry:', JSON.stringify(after2), '· new requests:', requests.length - before);
if (!after2.whyHidden) errors.push('failure reason still shown after the retry succeeded');
if (requests.length - before !== 1) errors.push('retry re-requested clips that were already done');
if (after2.clips !== N) errors.push('retry did not complete the set');
if (after2.key !== 'RENDER AGAIN') errors.push('key did not return to RENDER AGAIN');
if (Math.abs(after2.spent - plan.est.dollars) > 0.011) errors.push(`spent after retry $${after2.spent}, expected $${plan.est.dollars}`);

// ---- 5. RETAKE from the running order: exactly one new request, a new Idempotency-Key, nothing else touched ----
before = requests.length;
const target = await page.evaluate(() => { const n = window.cue.tl.scenes[2].n; return { n, urlBefore: window.cue.clips.get(n).url, otherUrls: [...window.cue.clips.entries()].filter(([k]) => k !== n).map(([, c]) => c.url) }; });
await page.click(`#ro-body tr[data-n="${target.n}"] .redo`);
await page.waitForFunction((n) => { const it = window.cue.job.items.find((i) => i.scene.n === n); return it.retake === 1 && it.state === 'done' && window.cue.job.done && window.cue.clips.has(n); }, target.n, { timeout: 60000 });
const after3 = await page.evaluate((t) => { const it = window.cue.job.items.find((i) => i.scene.n === t.n); return { urlAfter: window.cue.clips.get(t.n).url, otherSame: [...window.cue.clips.entries()].filter(([k]) => k !== t.n).every(([, c], i) => c.url === t.otherUrls[i]), take: it.retake, state: document.querySelector(`#jobs li[data-n="${t.n}"] .job__state`).textContent, line: document.querySelector('#render-line').textContent, spent: window.cue.job.spentDollars }; }, target);
console.log('after retake:', JSON.stringify(after3), '· new requests:', requests.length - before);
if (requests.length - before !== 1) errors.push('retake made more than one request');
if (!requests[requests.length - 1].body.prompt.startsWith(`SCENE_${target.n} `)) errors.push('retake rendered the wrong scene');
if (requests[requests.length - 1].idem === hfReqs.find((r) => r.body.prompt.startsWith(`SCENE_${target.n} `))?.idem) errors.push('retake reused the first attempt\'s Idempotency-Key (the engine would dedupe it)');
if (after3.urlAfter === target.urlBefore) errors.push('retake did not replace the clip');
if (!after3.otherSame) errors.push('retake disturbed another scene\'s clip');
if (after3.take !== 1 || !/take 2/.test(after3.state)) errors.push('tile does not say take 2');
if (Math.abs(after3.spent - (plan.est.dollars + plan.byN[target.n].price)) > 0.011) errors.push(`spent did not add the retake: $${after3.spent}`);

// ---- 6. nsfw: the engine refunds; the desk must not count it as spent ----
before = requests.length; const nsfwN = await page.evaluate(() => window.cue.tl.scenes[4].n); nsfwOnce.add(String(nsfwN));
await page.click(`#jobs li[data-n="${nsfwN}"] .job__redo`);
await page.waitForFunction((n) => { const it = window.cue.job.items.find((i) => i.scene.n === n); return it.state === 'failed' && window.cue.job.done; }, nsfwN, { timeout: 60000 });
const nsfw = await page.evaluate((n) => ({ err: window.cue.job.items.find((i) => i.scene.n === n).error, spent: window.cue.job.spentDollars, why: document.querySelector('#render-why').textContent }), nsfwN);
console.log('nsfw:', JSON.stringify(nsfw));
if (!/content filter/.test(nsfw.err) || !/not charged/.test(nsfw.err)) errors.push('nsfw result not explained as a filtered, unbilled clip');
if (Math.abs(nsfw.spent - (plan.est.dollars + plan.byN[target.n].price)) > 0.011) errors.push('an nsfw (refunded) clip was counted as spent');
await page.click('#render'); await page.waitForFunction(() => window.cue.job.done && window.cue.job.items.every((i) => i.state === 'done'), null, { timeout: 60000 });

// ---- 7. a fresh desk (new format) + STOP: nothing new starts; RENDER THE REST resumes ----
pollsToFinish = 6;
await page.click('label.fmt:has(input[value="9:16"]) span');
await page.waitForFunction(() => window.cue.job && window.cue.job.items.length > 0 && document.querySelectorAll('#jobs .job').length > 0, null, { timeout: 10000 });
await page.waitForTimeout(300);
const fresh = await page.evaluate(() => ({ stopped: window.cue.job.stopped, inflight: window.cue.job.inflight, cached: window.cue.job.items.filter((i) => i.cached).length, key: document.querySelector('#render').textContent.trim() }));
console.log('fresh 9:16 desk:', JSON.stringify(fresh));
if (fresh.inflight !== 0 || !fresh.stopped) errors.push('switching format started rendering on its own');
if (fresh.cached !== 0) errors.push('16:9 clips leaked into the 9:16 desk cache');
before = requests.length;
await page.click('#render');
await page.waitForFunction(() => window.cue.job.inflight === 4, null, { timeout: 10000 });
await page.click('#render-cancel');
await page.waitForFunction(() => window.cue.job.inflight === 0, null, { timeout: 60000 });
const held = await page.evaluate(() => ({ done: window.cue.job.items.filter((i) => i.state === 'done').length, queued: window.cue.job.queued, line: document.querySelector('#render-line').textContent, key: document.querySelector('#render').textContent.trim() }));
console.log('held:', JSON.stringify(held), '· requests:', requests.length - before);
if (requests.length - before !== 4) errors.push(`stopped pool made ${requests.length - before} requests, expected exactly the 4 in flight`);
if (held.done !== 4 || held.queued !== N - 4) errors.push('stopped pool did not keep the rest queued');
if (!requests.slice(before).every((r) => r.body.aspect_ratio === '9:16')) errors.push('9:16 desk did not ask for 9:16');
if (held.key !== 'RENDER THE REST') errors.push('key did not become RENDER THE REST');
pollsToFinish = 1; before = requests.length;
await page.click('#render');
await page.waitForFunction(() => window.cue.job && window.cue.job.done, null, { timeout: 60000 });
const resumed = await page.evaluate(() => ({ done: window.cue.job.items.filter((i) => i.state === 'done').length, key: document.querySelector('#render').textContent.trim() }));
console.log('resumed:', JSON.stringify(resumed), '· requests:', requests.length - before);
if (requests.length - before !== N - 4) errors.push(`resume made ${requests.length - before} requests, expected ${N - 4}`);
if (resumed.done !== N) errors.push('resume did not finish the set');

// ---- 8. switch engine in SETUP → the desk is rebuilt for that engine's cache (empty), the key reprices, nothing renders ----
await page.click('label.fmt:has(input[value="16:9"]) span');
await page.waitForFunction(() => window.cue.job && window.cue.job.items.every((i) => i.cached), null, { timeout: 10000 });
await page.click('#setup');
await page.selectOption('#setup-model', 'local');
await page.fill('input[name=localUrl]', GPU); await page.fill('input[name=localToken]', 'gpu-token');
const setupLocal = await page.evaluate(() => ({ note: document.querySelector('#setup-model-note').textContent, shown: [...document.querySelectorAll('#setup-direct .setup__grid[data-engine].is-on')].map((g) => g.dataset.engine), res1080: document.querySelector('#setup-res option[value="1080p"]').disabled }));
console.log('setup local:', JSON.stringify(setupLocal));
if (!setupLocal.shown.includes('local') || setupLocal.shown.length !== 1) errors.push('SETUP does not show only the chosen engine\'s fields');
if (!/free/i.test(setupLocal.note) || !setupLocal.res1080) errors.push('SETUP note/resolution not honest for the GPU tier');
await page.click('#setup-test'); await page.waitForFunction(() => /Tesla T4/.test(document.querySelector('#probe').textContent), null, { timeout: 10000 });
await page.click('#setup-save');
await page.waitForFunction(() => window.cue.job && window.cue.job.items.every((i) => !i.cached) && /FREE/.test(document.querySelector('#render-cost').textContent), null, { timeout: 10000 });
const switched = await page.evaluate(() => ({ cost: document.querySelector('#render-cost').textContent, cached: window.cue.job.items.filter((i) => i.cached).length, inflight: window.cue.job.inflight, lengths: window.cue.job.items.map((i) => i.seconds), MAX: window.cue.job.MAX }));
console.log('switched to GPU tier:', JSON.stringify({ ...switched, lengths: [...new Set(switched.lengths)] }));
if (!/^FREE/.test(switched.cost)) errors.push('RENDER key does not say FREE on the own-GPU tier');
if (switched.cached !== 0 || switched.inflight !== 0) errors.push('engine switch reused another engine\'s clips or started rendering');
if (!switched.lengths.every((s) => s >= 1 && s <= 5)) errors.push('GPU tier planned a clip over 5 s');
if (switched.MAX !== 3) errors.push('GPU pool width should be 3');
// render on the GPU mock via RENDER: the whole sheet is submitted at once (position/eta shown), the bearer token is sent
pollsToFinish = 3; before = requests.length;
await page.click('#render');
await page.waitForFunction((n) => window.cue.job.items.filter((i) => i.state === 'running').length === n, N, { timeout: 15000 });
const gpuMid = await page.evaluate(() => ({ inflight: window.cue.job.inflight, submitted: window.cue.job.items.filter((i) => i.id).length, tile: document.querySelector('#jobs li[data-n="1"] .job__state').textContent, line: document.querySelector('#render-line').textContent }));
await page.waitForFunction(() => window.cue.job.done, null, { timeout: 90000 });
console.log('gpu mid-render:', JSON.stringify(gpuMid), '· requests:', requests.length - before);
if (gpuMid.submitted !== N || requests.length - before !== N) errors.push(`GPU tier should submit the whole sheet at once (${gpuMid.submitted}/${N} submitted, ${requests.length - before} requests)`);
if (!/left|ahead|rendering|queued on the GPU/.test(gpuMid.tile)) errors.push('GPU tile shows no queue/ETA state while rendering');
if (!/GPU time/.test(gpuMid.line) || /\d+s of GPU time/.test(gpuMid.line)) errors.push('GPU desk line should count GPU time in minutes or hours, not dollars or footage seconds');
if (!requests.slice(before).every((r) => r.engine === 'gpu' && r.body.key && r.body.seconds >= 1 && r.body.seconds <= 5 && r.body.size === '1280x720')) errors.push('a GPU create is missing its key/size or has a bad length');
const gpuDone = await page.evaluate(() => ({ done: window.cue.job.items.filter((i) => i.state === 'done').length, clips: window.cue.clips.size, key: document.querySelector('#render').textContent.trim() }));
if (gpuDone.done !== N || gpuDone.clips !== N) errors.push('GPU render did not complete the set');

// ---- 9. the retiring Sora path still works: 4/8/12 and the slowed playback ----
await page.click('#setup'); await page.selectOption('#setup-model', 'sora'); await page.click('#setup-save');
await page.waitForFunction(() => window.cue.job && window.cue.job.cfg.model === 'sora' && window.cue.job.items.every((i) => !i.cached) && /\$/.test(document.querySelector('#render').textContent), null, { timeout: 10000 });
pollsToFinish = 1; before = requests.length;
await page.click('#render');
await page.waitForFunction(() => window.cue.job.done, null, { timeout: 60000 });
const soraReqs = requests.slice(before);
console.log('sora:', JSON.stringify({ n: soraReqs.length, seconds: [...new Set(soraReqs.map((r) => r.body.seconds))], model: soraReqs[0]?.body.model }));
if (soraReqs.length !== N || !soraReqs.every((r) => r.engine === 'sora' && ['4', '8', '12'].includes(r.body.seconds) && r.body.model === 'sora-2')) errors.push('Sora path broken');

console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
