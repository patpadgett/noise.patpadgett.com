// The desk survives the tab. A song (not the demo) is loaded, given a cue sheet, RENDER is pressed on a GPU box (mocked),
// and the tab is closed mid-render. A fresh tab must show RESUME on the load screen; pressing it must bring back the song,
// the sheet, the direction and the desk, and re-attach to the SAME jobs (idempotent keys: no new creates, the box's
// progress shown), then finish the set. Also: loading the same file again resumes; a new cue sheet forgets the old desk.
// Run: NODE_PATH=/data/pat/node_modules BASE=http://127.0.0.1:8768 node tests/resume.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:8766', GPU = base + '/mock-gpu';
const errors = [];
const song = readFileSync(new URL('../assets/demo/fare-thee-honey-blues-1920.mp3', import.meta.url));
const sheet = JSON.parse(readFileSync(new URL('../assets/demo/cues.json', import.meta.url), 'utf8'));
const clip = readFileSync(new URL('../test-clip.mp4', import.meta.url));
// the mock box: jobs persist across tabs (module scope), finish after a few polls, dedupe on key like the real one
const jobs = new Map(), byKey = new Map(), creates = []; let nextId = 1, pollsToFinish = 4;
async function mockBox(context) {
  await context.route(GPU + '/**', async (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname.replace('/mock-gpu', '');
    if (req.headers()['authorization'] !== 'Bearer gpu-token') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"bad token"}' });
    if (p === '/health') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, gpu: 'Tesla T4', queue: jobs.size, model: 'Wan 2.2 TI2V-5B Turbo', secPerSec: 75 }) });
    if (p === '/jobs' && req.method() === 'POST') {
      const body = req.postDataJSON(); creates.push(body.key);
      if (byKey.has(body.key)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: byKey.get(body.key), deduped: true, secPerSec: 75 }) });
      const id = 'g' + (nextId++); jobs.set(id, { polls: 0 }); byKey.set(body.key, id);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, status: 'queued', position: jobs.size, eta: 300, secPerSec: 75 }) });
    }
    const m = /^\/jobs\/(\w+)(\/video)?$/.exec(p);
    if (m && jobs.has(m[1])) { const j = jobs.get(m[1]); if (m[2]) return route.fulfill({ status: 200, contentType: 'video/mp4', body: clip }); j.polls++; const done = j.polls >= pollsToFinish; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: m[1], status: done ? 'done' : 'running', progress: done ? 1 : Math.min(0.9, j.polls / pollsToFinish), eta: done ? 0 : 120, position: 0 }) }); }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });
  });
}
const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
// one persistent profile so IndexedDB and localStorage outlive the tab, like a real browser
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await mockBox(context);
let page = await context.newPage(); page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(base, { waitUntil: 'networkidle' });
await page.evaluate((gpu) => localStorage.setItem('cue.azure.v1', JSON.stringify({ mode: 'direct', model: 'local', resolution: '720p', localUrl: gpu, localToken: 'gpu-token', openaiEndpoint: 'https://x.invalid', openaiKey: 'x', speechRegion: 'eastus', speechKey: 'x' })), GPU);
const resumeAtStart = await page.evaluate(() => document.querySelector('#resume').hidden);
if (!resumeAtStart) errors.push('RESUME offered with nothing saved');

// ---- 1. a real song: load the file (not the demo), analyse, then hand it a sheet as if the model had written it ----
await page.setInputFiles('#file', { name: 'my-song.mp3', mimeType: 'audio/mpeg', buffer: song });
await page.waitForFunction(() => document.body.dataset.state === 'onair' && window.cue.analysis, null, { timeout: 180000 });
await page.fill('#lyrics', sheet.lyrics); await page.fill('#direction', 'Jakarta at night, 1970s Kodachrome');
await page.evaluate((tr) => { window.cue.lyrics = document.querySelector('#lyrics').value; window.cue.direction = document.querySelector('#direction').value; window.cue.setTreatment(tr); }, sheet.treatment);
const N = await page.evaluate(() => window.cue.tl.scenes.length);
await page.waitForFunction(() => document.querySelector('#render-cost').textContent.includes('FREE'), null, { timeout: 10000 });
// ---- 2. RENDER, wait until the whole sheet is submitted and something is mid-flight, then kill the tab ----
await page.click('#render');
await page.waitForFunction((n) => window.cue.job && window.cue.job.items.filter((i) => i.id).length === n, N, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 4500)); // a poll or two: some jobs have progress, none finished (pollsToFinish 4 × 4 s)
const before = await page.evaluate(() => ({ done: window.cue.job.items.filter((i) => i.state === 'done').length, ids: window.cue.job.items.map((i) => i.id), line: document.querySelector('#render-line').textContent }));
console.log('before the tab dies:', JSON.stringify({ submitted: before.ids.filter(Boolean).length, done: before.done, creates: creates.length }));
if (creates.length !== N) errors.push(`expected ${N} creates before the crash, saw ${creates.length}`);
await page.close();
await new Promise((r) => setTimeout(r, 500));
const createsAtCrash = creates.length;

// ---- 3. a fresh tab: RESUME is offered, names the song, says a render is in progress ----
page = await context.newPage(); page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !document.querySelector('#resume').hidden, null, { timeout: 10000 });
const offer = await page.evaluate(() => document.querySelector('#resume').textContent);
console.log('offer:', offer);
if (!/my-song/.test(offer) || !/render in progress/.test(offer)) errors.push('RESUME key does not name the song and the open render: ' + offer);
const t0 = Date.now();
await page.click('#resume');
await page.waitForFunction(() => document.body.dataset.state === 'render' && window.cue.job && window.cue.job.items.every((i) => i.id || i.state === 'done'), null, { timeout: 60000 });
const back = await page.evaluate(() => ({ title: document.querySelector('#pgm-label').textContent, scenes: window.cue.tl.scenes.length, direction: window.cue.direction, dirField: document.querySelector('#direction').value, lyricsLen: document.querySelector('#lyrics').value.length, ids: window.cue.job.items.map((i) => i.id), states: window.cue.job.items.map((i) => i.state), line: document.querySelector('#render-line').textContent, renderKey: document.querySelector('#render').textContent.trim(), cancel: document.querySelector('#render-cancel').disabled }));
console.log('back on the desk in', Math.round((Date.now() - t0) / 1000), 's:', JSON.stringify({ title: back.title, scenes: back.scenes, direction: back.direction, states: [...new Set(back.states)], line: back.line.slice(0, 90), key: back.renderKey }));
if (back.title !== 'my-song') errors.push('song title not restored');
if (back.scenes !== N) errors.push('cue sheet not restored');
if (back.direction !== 'Jakarta at night, 1970s Kodachrome' || back.dirField !== back.direction || back.lyricsLen < 100) errors.push('direction/lyrics not restored');
if (!(await page.evaluate(() => window.cue.analysis && window.cue.analysis.barStarts.length > 10))) errors.push('analysis not restored (would have re-analysed)');
// the proof of re-attachment: the ids are the ones the first tab got, and the box saw NO new jobs
const sameIds = back.ids.every((id, i) => id === before.ids[i]);
console.log('re-attached:', JSON.stringify({ sameIds, newCreates: creates.length - createsAtCrash, dedupedResubmits: creates.length - createsAtCrash }));
if (!sameIds) errors.push('the resumed desk did not get the same job ids back');
if (byKey.size !== N) errors.push(`the box has ${byKey.size} distinct jobs for ${N} scenes: the resume created new ones`);
if (!/RENDERING/.test(back.renderKey) || back.cancel) errors.push('resumed desk is not in the rendering state (RENDER key / STOP)');
await page.waitForFunction(() => window.cue.job.done, null, { timeout: 120000 });
const finished = await page.evaluate(() => ({ done: window.cue.job.items.filter((i) => i.state === 'done').length, clips: window.cue.clips.size, exportOn: !document.querySelector('#export').disabled, line: document.querySelector('#render-line').textContent }));
console.log('finished:', JSON.stringify(finished));
if (finished.done !== N || finished.clips !== N || !finished.exportOn) errors.push('resumed render did not finish the set');
if (!/GPU time/.test(finished.line) || /\d+s of GPU time/.test(finished.line)) errors.push('desk line does not quote GPU time in minutes/hours');

// ---- 4. the same file loaded again (no RESUME key) also comes back on the desk, all cached, nothing submitted ----
const createsBefore = creates.length;
await page.click('#another');
await page.setInputFiles('#file', { name: 'my-song.mp3', mimeType: 'audio/mpeg', buffer: song });
await page.waitForFunction(() => document.body.dataset.state === 'render' && window.cue.job && window.cue.job.items.every((i) => i.state === 'done'), null, { timeout: 60000 });
const again = await page.evaluate(() => ({ cached: window.cue.job.items.filter((i) => i.cached).length, scenes: window.cue.tl.scenes.length }));
console.log('same file again:', JSON.stringify(again), '· new creates:', creates.length - createsBefore);
if (again.cached !== N || creates.length !== createsBefore) errors.push('reloading the same file did not come back from the cache alone');

// ---- 5. a new cue sheet replaces the session: the next resume has no desk ----
await page.evaluate((tr) => { const t = structuredClone(tr); t.title_treatment = 'A different cut'; t.cues = t.cues.slice(0, 8); window.cue.setTreatment(t); }, sheet.treatment);
await new Promise((r) => setTimeout(r, 800));
await page.click('#another');
await page.waitForFunction(() => !document.querySelector('#resume').hidden, null, { timeout: 10000 });
const offer2 = await page.evaluate(() => document.querySelector('#resume').textContent);
console.log('after a rewrite:', offer2);
if (!/cue sheet/.test(offer2) || /render in progress/.test(offer2)) errors.push('a new treatment should drop the old desk from the session: ' + offer2);
await page.click('#resume');
await page.waitForFunction(() => document.body.dataset.state === 'onair' && window.cue.tl, null, { timeout: 60000 });
const rewritten = await page.evaluate(() => ({ treat: document.querySelector('#treatment').textContent, scenes: window.cue.tl.scenes.length }));
if (rewritten.treat !== 'A different cut') errors.push('the rewritten sheet was not the one restored');

// ---- 6. the demo is never saved as a session ----
await page.click('#another'); await page.click('#try');
await page.waitForFunction(() => document.body.dataset.state === 'onair' && window.cue.tl, null, { timeout: 120000 });
await page.click('#another');
await page.waitForFunction(() => !document.querySelector('#resume').hidden, null, { timeout: 10000 });
const offer3 = await page.evaluate(() => document.querySelector('#resume').textContent);
if (!/my-song/.test(offer3)) errors.push('the demo overwrote the saved session: ' + offer3);

console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
