// CUE — footage engines. One interface, three implementations; footage.js never knows which is in use.
//
//   engine.plan(scene, beat)          → { seconds, price }      what one clip of this scene costs, before anything is sent
//   engine.create({ prompt, size, seconds, key }) → { id }      start a job (idempotent on `key`, so a retried create never double-bills)
//   engine.status(id)                 → { status, progress, error, url }   status ∈ queued | running | done | failed
//   engine.fetch(id, status)          → Blob                    the finished MP4
//   engine.probe()                    → 'ok' | message          SETUP's TEST
//
// Engines: 'gpu'        (render/cue_render.py — Wan 2.2 5B on the owner's own GPU box, free; a second box can be added),
//          'higgsfield' (Kling 3.0 / Wan 2.6 / Seedance 2.5, one key, exact-length clips, 720p or 1080p — paid, unused by default),
//          'sora'       (Azure OpenAI Sora 2 preview — retired by Microsoft on 2026-10-15; kept until the code path is removed).
// Sora's 4/8/12 s rule is the only reason the switcher can play a clip slowed; every other engine renders exact length.
import { TREATMENT_SYSTEM, TREATMENT_SCHEMA, treatmentUserMessage } from './treatment.js';

const LS = 'cue.azure.v1'; // the storage key predates the engines; the shape grew, the name stayed so saved keys survive
const store = typeof localStorage !== 'undefined' ? localStorage : { _m: new Map(), getItem(k) { return this._m.get(k) ?? null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } }; // Node (tests, tools) has no localStorage

export function loadConfig() {
  let c = {}; try { c = JSON.parse(store.getItem(LS) || '{}'); } catch {}
  return { mode: 'direct', model: 'local', resolution: '720p', ...c };
}
export function saveConfig(cfg) { store.setItem(LS, JSON.stringify(cfg)); }
// Writing the cue sheet always needs the Azure chat + speech keys (or the proxy). Footage needs the chosen engine's key.
export function configured(cfg = loadConfig()) {
  if (cfg.mode === 'proxy') return true;
  return !!(cfg.openaiEndpoint && cfg.openaiKey && cfg.speechRegion && cfg.speechKey);
}
export function footageConfigured(cfg = loadConfig()) {
  if (cfg.mode === 'proxy') return true;
  const m = modelFor(cfg);
  if (m.engine === 'higgsfield') return !!cfg.higgsfieldKey;
  if (m.engine === 'gpu') return m.cfgKeys.every((k) => !!cfg[k]);
  return !!(cfg.openaiEndpoint && cfg.openaiKey);
}

// ---- the catalogue: what each model costs and what lengths it renders ------------------------------
// Prices are Higgsfield's published standard per-second rates (console.higgsfield.ai, read 2026-10-02); a promo
// can be lower, never higher, so the RENDER key's figure is a ceiling. The estimate endpoint gives the exact number.
export const MODELS = {
  'local':       { engine: 'gpu',        label: 'This GPU (Wan 2.2 5B)', min: 1, max: 5, price: { '720p': 0 }, resolutions: ['720p'], note: 'free · the owner\'s render box · about 5 min per second of footage on a T4', cfgKeys: ['localUrl', 'localToken'] },
  'kling-std':   { engine: 'higgsfield', label: 'Kling 3.0 Standard', path: 'kling-video/v3.0/std/text-to-video',   min: 3, max: 15, price: { '720p': 0.084, '1080p': 0.084 }, resolutions: ['720p'], note: 'best realism per dollar · 720p' },
  'kling-turbo': { engine: 'higgsfield', label: 'Kling 3.0 Turbo',    path: 'kling-video/v3.0-turbo/text-to-video', min: 3, max: 15, price: { '720p': 0.112, '1080p': 0.14 },  resolutions: ['720p', '1080p'], note: 'fast · 720p or 1080p' },
  'kling-pro':   { engine: 'higgsfield', label: 'Kling 3.0 Pro',      path: 'kling-video/v3.0/pro/text-to-video',   min: 3, max: 15, price: { '720p': 0.168, '1080p': 0.168 }, resolutions: ['1080p'], note: 'hero shots · 1080p' },
  'wan-2.6':     { engine: 'higgsfield', label: 'Wan 2.6',            path: 'wan/v2.6/text-to-video',               min: 5, max: 15, lengths: [5, 10, 15], price: { '720p': 0.10, '1080p': 0.15 }, resolutions: ['720p', '1080p'], note: 'cheap · 5/10/15 s only' },
  'seedance-2.5':{ engine: 'higgsfield', label: 'Seedance 2.5',       path: 'bytedance/seedance-2.5/text-to-video', min: 4, max: 15, price: { '720p': 0.46, '1080p': 1.14 },  resolutions: ['720p', '1080p'], note: 'top tier · expensive' },
  'box2':        { engine: 'gpu',        label: 'Another render box', min: 1, max: 5, price: { '720p': 0 }, resolutions: ['720p'], note: 'a second machine running render/cue_render.py (a friend\'s GPU, a rented one)', cfgKeys: ['box2Url', 'box2Token'] },
  'sora':        { engine: 'sora',       label: 'Sora 2 (retires Oct 15)', min: 4, max: 12, lengths: [4, 8, 12], price: { '720p': 0.10 }, resolutions: ['720p'], note: 'Azure preview · 4/8/12 s' },
};
export function modelFor(cfg = loadConfig()) { return MODELS[cfg.model] || MODELS.local; }

// The clip for a scene: exact length rounded up to the next whole second (or the model's next allowed length),
// clamped to what the model renders. A scene shorter than the minimum gets the minimum and is cut at its OUT like
// any music video; a scene longer than the maximum gets the maximum and plays slowed (clipRate in switcher.js) —
// normalizeTreatment caps scenes at 12 s so only the 5 s local tier ever slows, and it says so on the tile.
export function planClip(scene, beat, model = modelFor(), resolution = loadConfig().resolution) {
  const need = scene.bars * 4 * beat;
  let seconds;
  if (model.lengths) seconds = model.lengths.find((s) => s * 1.1 >= need) ?? model.lengths[model.lengths.length - 1];
  else seconds = Math.min(model.max, Math.max(model.min, Math.ceil(need - 0.05)));
  const res = model.resolutions.includes(resolution) ? resolution : model.resolutions[0];
  return { seconds, price: +(seconds * (model.price[res] ?? 0)).toFixed(3), resolution: res };
}
export function estimateCost(treatment, analysis, cfg = loadConfig()) {
  const beat = 60 / analysis.bpm, model = modelFor(cfg);
  let seconds = 0, clips = 0, dollars = 0;
  for (const c of treatment.cues) if (c.kind === 'scene') { const p = planClip(c, beat, model, cfg.resolution); clips++; seconds += p.seconds; dollars += p.price; }
  return { clips, seconds, dollars: +dollars.toFixed(2), model: model.label, free: model.engine === 'gpu' };
}
// kept for the switcher/tests that still import the Sora planner by its old name
export const CLIP_LENGTHS = [4, 8, 12];
export function clipSeconds(cue, beat) { return planClip(cue, beat, MODELS.sora).seconds; }
export const PRICE_PER_SECOND = 0.10;

async function j(res) { const t = await res.text(); let d; try { d = JSON.parse(t); } catch { d = { raw: t }; } if (!res.ok) throw new Error(d.error?.message || d.detail || d.message || `${res.status} ${res.statusText}`); return d; }

// ---- Azure (cue sheet: Speech + Responses; footage: Sora until it retires) ------------------------------
function oai(cfg, path) {
  if (cfg.mode === 'proxy') return [`/api/openai${path}`, {}];
  const base = cfg.openaiEndpoint.replace(/\/+$/, '');
  return [`${base}/openai/v1${path}`, { 'api-key': cfg.openaiKey }];
}
function speech(cfg) {
  if (cfg.mode === 'proxy') return ['/api/speech/transcribe', {}];
  return [`https://${cfg.speechRegion}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, { 'Ocp-Apim-Subscription-Key': cfg.speechKey }];
}
export async function transcribe(audioBlob, { signal } = {}) {
  const cfg = loadConfig(); const [url, headers] = speech(cfg);
  const fd = new FormData();
  fd.append('audio', audioBlob, 'song.wav');
  fd.append('definition', JSON.stringify({ locales: ['en-US'], profanityFilterMode: 'None', wordLevelTimestampsEnabled: true }));
  return j(await fetch(url, { method: 'POST', headers, body: fd, signal }));
}
export async function writeTreatment({ title, analysis, lyrics, aligned, direction = '' }, { signal } = {}) {
  const cfg = loadConfig(); const [url, headers] = oai(cfg, '/responses');
  const body = {
    model: cfg.chatDeployment || 'gpt-6-astra',
    reasoning: { effort: 'low' },
    max_output_tokens: 32768, // a long song with one-bar scenes is 80+ cues at ~200 tokens each; never let the default cut the sheet short
    input: [{ role: 'system', content: TREATMENT_SYSTEM }, { role: 'user', content: treatmentUserMessage({ title, analysis, lyrics, aligned, direction }) }],
    text: { format: { type: 'json_schema', name: 'treatment', strict: true, schema: TREATMENT_SCHEMA } },
  };
  const d = await j(await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }));
  if (d.status === 'incomplete') throw new Error(`The treatment was cut off before the end (${d.incomplete_details?.reason || 'incomplete'}). Press REWRITE TREATMENT to try again.`);
  const text = (d.output || []).flatMap((o) => o.content || []).find((c) => c.type === 'output_text')?.text;
  if (!text) throw new Error('The treatment came back empty.');
  return { treatment: JSON.parse(text), usage: d.usage };
}

const sora = {
  name: 'sora',
  plan: (scene, beat) => planClip(scene, beat, MODELS.sora, '720p'),
  async create({ prompt, size, seconds }) {
    const cfg = loadConfig(); const [url, headers] = oai(cfg, '/videos');
    const d = await j(await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: cfg.videoDeployment || 'sora-2', prompt, size, seconds: String(seconds) }) }));
    return { id: d.id };
  },
  async status(id) {
    const cfg = loadConfig(); const [url, headers] = oai(cfg, `/videos/${id}`);
    const s = await j(await fetch(url, { headers }));
    const status = s.status === 'completed' ? 'done' : s.status === 'failed' || s.status === 'cancelled' ? 'failed' : s.status === 'queued' ? 'queued' : 'running';
    return { status, progress: (s.progress || 0) / 100, error: s.error?.message || (status === 'failed' ? `job ${s.status}` : null) };
  },
  async fetch(id) {
    const cfg = loadConfig(); const [url, headers] = oai(cfg, `/videos/${id}/content`);
    const res = await fetch(url, { headers }); if (!res.ok) throw new Error(`download ${res.status}`); return await res.blob();
  },
  async probe() { try { const cfg = loadConfig(); const [url, headers] = oai(cfg, '/videos?limit=1'); const r = await fetch(url, { headers }); return r.ok ? 'ok' : `${r.status}`; } catch (e) { return e.message; } },
};

// ---- Higgsfield: POST model path → { request_id, status_url } → poll → video.url -----------------------
// Direct mode sends the owner's "Key id:secret" from the browser (their API answers CORS for this origin; keys stay
// in localStorage). Proxy mode goes through /api/higgsfield/* with the key server-side and the daily caps.
function hf(cfg, path) {
  if (cfg.mode === 'proxy') return [`/api/higgsfield/${path}`, {}];
  return [`https://api.higgsfield.ai/${path}`, { Authorization: `Key ${cfg.higgsfieldKey}` }];
}
const higgsfield = {
  name: 'higgsfield',
  plan: (scene, beat) => planClip(scene, beat),
  async create({ prompt, size, seconds, key }) {
    const cfg = loadConfig(), model = modelFor(cfg); const [url, headers] = hf(cfg, model.path);
    const aspect = size === '720x1280' ? '9:16' : '16:9', res = model.resolutions.includes(cfg.resolution) ? cfg.resolution : model.resolutions[0];
    const body = { prompt, duration: seconds, aspect_ratio: aspect };
    if (model.resolutions.length > 1 || /seedance|wan/.test(cfg.model)) body.resolution = res; // Kling Standard/Pro have no resolution field
    if (/^kling/.test(cfg.model)) body.sound = 'off';          // the song is the soundtrack
    if (/seedance/.test(cfg.model)) body.generate_audio = false;
    if (/wan-2\.6/.test(cfg.model)) delete body.aspect_ratio;  // Wan 2.6 has no aspect field; 16:9 only
    const d = await j(await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) }));
    return { id: d.request_id, statusUrl: d.status_url };
  },
  async status(id) {
    const cfg = loadConfig(); const [url, headers] = hf(cfg, `requests/${id}/status`);
    const s = await j(await fetch(url, { headers }));
    const status = s.status === 'completed' ? 'done' : s.status === 'failed' || s.status === 'canceled' || s.status === 'nsfw' ? 'failed' : s.status === 'queued' ? 'queued' : 'running';
    return { status, progress: status === 'done' ? 1 : status === 'running' ? 0.5 : 0, error: status === 'failed' ? (s.error || (s.status === 'nsfw' ? 'Flagged by the model\'s content filter (not charged). Reword the shot and RETAKE.' : `request ${s.status}`)) : null, url: s.video?.url || null };
  },
  async fetch(id, st) {
    if (!st?.url) throw new Error('finished without a video URL');
    const cfg = loadConfig();
    // the CDN URL is public and short-lived; in proxy mode fetch it through the function so the browser never needs the CDN's CORS
    const res = await fetch(cfg.mode === 'proxy' ? `/api/higgsfield/fetch?url=${encodeURIComponent(st.url)}` : st.url);
    if (!res.ok) throw new Error(`download ${res.status}`); return await res.blob();
  },
  async probe() { try { const cfg = loadConfig(); const [url, headers] = hf(cfg, `requests/00000000-0000-0000-0000-000000000000/status`); const r = await fetch(url, { headers }); return r.status === 404 ? 'ok' : r.status === 401 ? 'bad key' : `${r.status}`; } catch (e) { return e.message; } },
};

// ---- GPU tiers: cue_render.py on the owner's own box ('local'), or a second box ('box2'). One job API, a bearer
// token, nothing billed by CUE.
function gpu(cfg, path) {
  const m = modelFor(cfg), [urlKey, tokKey] = m.cfgKeys;
  if (cfg.mode === 'proxy') return [`/api/${cfg.model}/${path}`, {}];
  return [`${String(cfg[urlKey] || '').replace(/\/+$/, '')}/${path}`, { Authorization: `Bearer ${cfg[tokKey]}` }];
}
const gpuEngine = {
  name: 'gpu',
  plan: (scene, beat) => planClip(scene, beat, modelFor(), '720p'),
  async create({ prompt, size, seconds, key }) {
    const cfg = loadConfig(); const [url, headers] = gpu(cfg, 'jobs');
    const d = await j(await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, size, seconds, key }) }));
    // the box's own measured rate (seconds of GPU per second of footage) rides along so the desk can quote machine time
    return { id: d.id, secPerSec: d.secPerSec };
  },
  async status(id) {
    const cfg = loadConfig(); const [url, headers] = gpu(cfg, `jobs/${id}`);
    const s = await j(await fetch(url, { headers }));
    return { status: s.status, progress: s.progress || 0, error: s.error || null, eta: s.eta ?? null, position: s.position ?? null };
  },
  async fetch(id) {
    const cfg = loadConfig(); const [url, headers] = gpu(cfg, `jobs/${id}/video`);
    const res = await fetch(url, { headers }); if (!res.ok) throw new Error(`download ${res.status}`); return await res.blob();
  },
  async probe() { try { const cfg = loadConfig(); const [url, headers] = gpu(cfg, 'health'); const r = await fetch(url, { headers }); if (!r.ok) return r.status === 401 ? 'bad token' : `${r.status}`; const h = await r.json(); return h.gpu ? `ok · ${h.gpu}${h.queue ? ` · ${h.queue} queued` : ''}` : 'ok'; } catch (e) { return e.message; } },
};

const ENGINES = { sora, higgsfield, gpu: gpuEngine };
export function engine(cfg = loadConfig()) { return ENGINES[modelFor(cfg).engine] || higgsfield; }

// ---- SETUP's TEST: the cue-sheet services and the chosen footage engine ------------------------------------
export async function probe() {
  const cfg = loadConfig(); const out = { openai: null, speech: null, footage: null, engine: modelFor(cfg).label };
  try { const [url, headers] = oai(cfg, '/responses'); const r = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: cfg.chatDeployment || 'gpt-6-astra', input: 'ok', max_output_tokens: 16 }) }); out.openai = r.ok ? 'ok' : `${r.status}`; } catch (e) { out.openai = e.message; }
  try {
    // Speech has no cheap GET; a 1-second silent WAV costs a fraction of a cent and proves the key + region
    const sr = 16000, n = sr, ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab); let p = 0;
    const str = (s) => { for (const ch of s) v.setUint8(p++, ch.charCodeAt(0)); }; const u32 = (x) => { v.setUint32(p, x, true); p += 4; }; const u16 = (x) => { v.setUint16(p, x, true); p += 2; };
    str('RIFF'); u32(36 + n * 2); str('WAVE'); str('fmt '); u32(16); u16(1); u16(1); u32(sr); u32(sr * 2); u16(2); u16(16); str('data'); u32(n * 2);
    await transcribe(new Blob([ab], { type: 'audio/wav' })); out.speech = 'ok';
  } catch (e) { out.speech = e.message; }
  out.footage = footageConfigured(cfg) ? await engine(cfg).probe() : 'no key';
  return out;
}
