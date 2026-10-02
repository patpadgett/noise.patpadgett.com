// CUE — the one module that talks to Azure. Two modes behind one interface:
//   direct: the owner's endpoints + keys, entered once in SETUP and kept in localStorage (never in the repo)
//   proxy:  the same calls through /api/* (Azure Static Web Apps + Functions, see api/), keys server-side
// Every request shape here was exercised against the live endpoints before being written down.
import { TREATMENT_SYSTEM, TREATMENT_SCHEMA, treatmentUserMessage } from './treatment.js';

const LS = 'cue.azure.v1';
export const PRICE_PER_SECOND = 0.10; // Sora 2, GlobalStandard, 720p, per generated second (Azure pricing page, preview)

export function loadConfig() {
  try { return { mode: 'direct', ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { mode: 'direct' }; }
}
export function saveConfig(cfg) { localStorage.setItem(LS, JSON.stringify(cfg)); }
export function configured(cfg = loadConfig()) {
  if (cfg.mode === 'proxy') return true;
  return !!(cfg.openaiEndpoint && cfg.openaiKey && cfg.speechRegion && cfg.speechKey);
}

// ---- URL + header builders -------------------------------------------------------------
function oai(cfg, path) {
  if (cfg.mode === 'proxy') return [`/api/openai${path}`, {}];
  const base = cfg.openaiEndpoint.replace(/\/+$/, '');
  return [`${base}/openai/v1${path}`, { 'api-key': cfg.openaiKey }];
}
function speech(cfg) {
  if (cfg.mode === 'proxy') return ['/api/speech/transcribe', {}];
  return [`https://${cfg.speechRegion}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, { 'Ocp-Apim-Subscription-Key': cfg.speechKey }];
}
async function j(res) { const t = await res.text(); let d; try { d = JSON.parse(t); } catch { d = { raw: t }; } if (!res.ok) throw new Error(d.error?.message || d.message || `${res.status} ${res.statusText}`); return d; }

// ---- 1. Where the singer sings: fast transcription with word timestamps -----------------
// audio: a Blob (16 kHz mono WAV keeps the upload small; Speech accepts MP3/WAV/FLAC/OGG too)
export async function transcribe(audioBlob, { signal } = {}) {
  const cfg = loadConfig(); const [url, headers] = speech(cfg);
  const fd = new FormData();
  fd.append('audio', audioBlob, 'song.wav');
  fd.append('definition', JSON.stringify({ locales: ['en-US'], profanityFilterMode: 'None', wordLevelTimestampsEnabled: true }));
  return j(await fetch(url, { method: 'POST', headers, body: fd, signal }));
}

// ---- 2. The treatment: gpt-6-astra via the Responses API with a strict JSON schema -----
// direction: the artist's own words (place, time of day, look) that every shot must honour
export async function writeTreatment({ title, analysis, lyrics, aligned, direction = '' }, { signal } = {}) {
  const cfg = loadConfig(); const [url, headers] = oai(cfg, '/responses');
  const body = {
    model: cfg.chatDeployment || 'gpt-6-astra',
    reasoning: { effort: 'low' },
    input: [{ role: 'system', content: TREATMENT_SYSTEM }, { role: 'user', content: treatmentUserMessage({ title, analysis, lyrics, aligned, direction }) }],
    text: { format: { type: 'json_schema', name: 'treatment', strict: true, schema: TREATMENT_SCHEMA } },
  };
  const d = await j(await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }));
  const text = (d.output || []).flatMap((o) => o.content || []).find((c) => c.type === 'output_text')?.text;
  if (!text) throw new Error('The treatment came back empty.');
  return { treatment: JSON.parse(text), usage: d.usage };
}

// ---- 3. Footage: Sora 2 jobs. create → poll → download. Two jobs run at once on the preview. --
// size: '1280x720' | '720x1280'; seconds: 4 | 8 | 12 only (sent as a string per the API; anything
// else is a 400 "Invalid value: '18'. Supported values are: '4', '8', and '12'.")
export async function createVideo({ prompt, size, seconds }, { signal } = {}) {
  const cfg = loadConfig(); const [url, headers] = oai(cfg, '/videos');
  return j(await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: cfg.videoDeployment || 'sora-2', prompt, size, seconds: String(seconds) }), signal }));
}
export async function videoStatus(id, { signal } = {}) {
  const cfg = loadConfig(); const [url, headers] = oai(cfg, `/videos/${id}`);
  return j(await fetch(url, { headers, signal }));
}
export async function downloadVideo(id, { signal } = {}) {
  const cfg = loadConfig(); const [url, headers] = oai(cfg, `/videos/${id}/content`);
  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new Error(`download ${res.status}`);
  return await res.blob();
}

// ---- 4. A tiny probe used by SETUP: is the key right, is the deployment there? ---------
export async function probe() {
  const cfg = loadConfig(); const out = { openai: null, speech: null };
  try { const [url, headers] = oai(cfg, '/videos?limit=1'); const r = await fetch(url, { headers }); out.openai = r.ok ? 'ok' : `${r.status}`; } catch (e) { out.openai = e.message; }
  try {
    // Speech has no cheap GET; a 1-second silent WAV costs a fraction of a cent and proves the key + region
    const sr = 16000, n = sr, ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab); let p = 0;
    const str = (s) => { for (const ch of s) v.setUint8(p++, ch.charCodeAt(0)); }; const u32 = (x) => { v.setUint32(p, x, true); p += 4; }; const u16 = (x) => { v.setUint16(p, x, true); p += 2; };
    str('RIFF'); u32(36 + n * 2); str('WAVE'); str('fmt '); u32(16); u16(1); u16(1); u32(sr); u32(sr * 2); u16(2); u16(16); str('data'); u32(n * 2);
    await transcribe(new Blob([ab], { type: 'audio/wav' })); out.speech = 'ok';
  } catch (e) { out.speech = e.message; }
  return out;
}

export function estimateCost(treatment, analysis) {
  // every scene cue becomes one clip; clip length = the shortest Sora length that covers the scene (see clipSeconds)
  const beat = 60 / analysis.bpm;
  let seconds = 0, clips = 0;
  for (const c of treatment.cues) if (c.kind === 'scene') { clips++; seconds += clipSeconds(c, beat); }
  return { clips, seconds, dollars: +(seconds * PRICE_PER_SECOND).toFixed(2) };
}
// Sora 2 renders 4, 8 or 12 seconds and nothing else. Take the shortest that covers the scene, allowing
// up to 10% slow-motion so a 4.3 s scene gets a 4 s clip rather than an 8; a scene longer than 13.2 s
// takes the 12 and the switcher plays it slowed to fit (clipRate in switcher.js).
export const CLIP_LENGTHS = [4, 8, 12];
export function clipSeconds(cue, beat) { const need = cue.bars * 4 * beat; return CLIP_LENGTHS.find((s) => s * 1.1 >= need) ?? CLIP_LENGTHS[CLIP_LENGTHS.length - 1]; }
