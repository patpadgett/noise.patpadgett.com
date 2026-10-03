// CUE — footage jobs + export. Clips are rendered by whichever engine SETUP picks (js/engines.js: Kling via
// Higgsfield, Wan 2.2 on the owner's GPU, Sora until it retired), a few at once; finished clips are
// kept in IndexedDB keyed by scene so a reload or a format switch does not pay twice. Export draws every frame
// with the switcher at 30 fps and encodes with WebCodecs (H.264 MP4 via a tiny muxer) when available, else
// MediaRecorder WebM.
import { engine, loadConfig, modelFor } from './engines.js';

// ---- IndexedDB for clips ----
const DB = 'cue-clips-v1';
function db() { return new Promise((res, rej) => { const r = indexedDB.open(DB, 2); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('clips')) d.createObjectStore('clips'); if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
export async function getClip(key) { const d = await db(); return new Promise((res) => { const t = d.transaction('clips').objectStore('clips').get(key); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); }); }
export async function putClip(key, blob, meta) { const d = await db(); return new Promise((res) => { const t = d.transaction('clips', 'readwrite').objectStore('clips').put({ blob, meta, at: Date.now() }, key); t.onsuccess = () => res(); t.onerror = () => res(); }); }
export async function deleteClip(key) { const d = await db(); return new Promise((res) => { const t = d.transaction('clips', 'readwrite').objectStore('clips').delete(key); t.onsuccess = () => res(); t.onerror = () => res(); }); }
// ---- sessions: everything the desk needs to come back after a reload, keyed by song ----
// A cue sheet is minutes of listening and a paid model call; a render on the GPU box is hours. Neither may live only in
// a tab. The session is written when cues are written and whenever the desk opens; loading the same song (or RESUME on
// the load screen) brings the sheet back and, if a render was open, re-attaches to the box's jobs by their keys.
export async function saveSession(songId, data) { const d = await db(); return new Promise((res) => { const t = d.transaction('sessions', 'readwrite').objectStore('sessions').put({ ...data, songId, at: Date.now() }, songId); t.onsuccess = () => res(); t.onerror = () => res(); }); }
export async function getSession(songId) { const d = await db(); return new Promise((res) => { const t = d.transaction('sessions').objectStore('sessions').get(songId); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); }); }
export async function latestSession() { const d = await db(); return new Promise((res) => { const t = d.transaction('sessions').objectStore('sessions').getAll(); t.onsuccess = () => res((t.result || []).sort((a, b) => b.at - a.at)[0] || null); t.onerror = () => res(null); }); }
export async function deleteSession(songId) { const d = await db(); return new Promise((res) => { const t = d.transaction('sessions', 'readwrite').objectStore('sessions').delete(songId); t.onsuccess = () => res(); t.onerror = () => res(); }); }
// A clip is keyed by what produced it: song, scene, frame size, the model, and the exact prompt (shot + direction).
// Edit the shot, the direction or the model and the key changes, so the next RENDER pays for that scene again and no other.
export const clipKey = (songId, scene, size, direction = '', model = loadConfig().model) => `${songId}:${scene.n}:${size}:${model}:${hash(scene.shot + '\n' + String(direction || '').trim())}`;
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }

// ---- the render job: every scene → one clip, a few in flight ----
// stopped = start nothing new; clips already in flight finish (paid engines bill the moment a job is accepted,
// so abandoning them would only lose footage). detach() hands the pool off silently when the desk is replaced.
// Pool width: Higgsfield's default account limit is 4 concurrent; Sora's preview is 2; a GPU box queues
// everything itself, so the pool just keeps a few status polls going.
export class FootageJob {
  constructor({ songId, scenes, analysis, size, direction = '', onUpdate, retakes = {} }) {
    Object.assign(this, { songId, scenes, analysis, size, direction, onUpdate });
    this.cfg = loadConfig(); this.model = modelFor(this.cfg); this.engine = engine(this.cfg);
    const beat = 60 / analysis.bpm;
    // retakes: scene n → take count from a saved session, so a re-attached desk asks the box for the SAME attempt (same key)
    this.items = scenes.map((s) => { const p = this.engine.plan(s, beat); return { scene: s, state: 'queued', progress: 0, id: null, blob: null, url: null, error: null, cached: false, retake: retakes[s.n] || 0, seconds: p.seconds, price: p.price, eta: null, position: null }; });
    this.stopped = false; this.inflight = 0; this.MAX = this.engine.name === 'sora' ? 2 : this.engine.name === 'gpu' ? 3 : 4;
  }
  // what a saved session needs to rebuild this desk: which take each scene is on
  get retakes() { const r = {}; for (const it of this.items) if (it.retake) r[it.scene.n] = it.retake; return r; }
  async start() {
    // anything already in the cache lands instantly
    for (const it of this.items) { const c = await getClip(this.key(it)); if (c) { it.blob = c.blob; it.url = URL.createObjectURL(c.blob); it.state = 'done'; it.progress = 1; it.cached = true; } }
    this.emit(); this.pump();
  }
  // A GPU render box keeps its own persistent queue, so the whole sheet is submitted at once (idempotent keys: re-sending
  // after a reload or a restart re-attaches to the same jobs) and the pool's width only bounds how many status polls run.
  // Paid engines are submitted a few at a time so STOP can actually stop spending.
  get submitAll() { return this.engine.name === 'gpu'; }
  pump() {
    if (!this.stopped) {
      if (this.submitAll) { for (const it of this.items) if (it.state === 'queued') this.run(it); }
      else while (this.inflight < this.MAX) { const next = this.items.find((i) => i.state === 'queued'); if (!next) break; this.run(next); }
    }
    if (this.done || (this.stopped && !this.inflight)) this.emit();
  }
  key(it) { return clipKey(this.songId, it.scene, this.size, this.direction, this.cfg.model); }
  emit() { this.onUpdate && this.onUpdate(this); }
  get done() { return this.items.every((i) => i.state === 'done' || i.state === 'failed'); }
  get queued() { return this.items.filter((i) => i.state === 'queued').length; }
  // what the engine has been asked to generate, every attempt counted: a create that got a job id is billed, a create
  // rejected with a 400 is not; a retake of a finished scene bills again. In seconds, and in dollars at the model's rate.
  get spent() { return this.items.reduce((s, i) => s + (i.billed || 0), 0); }
  get spentDollars() { return +this.items.reduce((s, i) => s + (i.billedDollars || 0), 0).toFixed(2); }
  get attempted() { return this.items.some((i) => i.state !== 'queued' && !i.cached); }
  // RENDER again on the same desk: failures go back in the queue, the pool resumes. Done clips are not touched.
  resume() { for (const it of this.items) if (it.state === 'failed') Object.assign(it, { state: 'queued', progress: 0, id: null, error: null }); this.stopped = false; this.emit(); this.pump(); }
  // Another take of ONE scene: forget its cached clip and queue it again; nothing else is touched or paid for.
  // On a running pool it joins the queue; on a finished pool it restarts the pump; on a stopped pool it runs alone.
  async retake(n) {
    const it = this.items.find((i) => i.scene.n === n); if (!it || busy(it)) return false;
    await deleteClip(this.key(it));
    if (it.url) URL.revokeObjectURL(it.url);
    Object.assign(it, { state: 'queued', progress: 0, id: null, blob: null, url: null, error: null, cached: false, retake: it.retake + 1 });
    this.emit();
    if (this.stopped) { while (!this.submitAll && this.inflight >= this.MAX) await sleep(500); if (it.state === 'queued') this.run(it); } else this.pump();
    return true;
  }
  async run(it) {
    this.inflight++; it.state = 'creating'; this.emit();
    try {
      const prompt = soraPrompt(it.scene, this.size, this.direction);
      // the idempotency key names this exact attempt: a network retry of the same create never makes a second job
      const v = await this.engine.create({ prompt, size: this.size, seconds: it.seconds, key: `${this.key(it)}:${it.retake}` });
      it.id = v.id; if (v.secPerSec) { this.secPerSec = v.secPerSec; try { localStorage.setItem('cue.gpu.secPerSec', String(v.secPerSec)); } catch {} } it.billed = (it.billed || 0) + it.seconds; it.billedDollars = (it.billedDollars || 0) + it.price; it.state = 'running'; this.emit();
      for (;;) {
        // a GPU box renders one clip at a time and a whole sheet is queued on it: poll the ones far back in the line slowly
        await sleep(this.submitAll && it.position > 1 ? 15000 : 4000);
        const s = await this.engine.status(it.id);
        it.progress = s.progress || 0; it.eta = s.eta ?? null; it.position = s.position ?? null; this.emit();
        if (s.status === 'done') { it.statusResult = s; break; }
        if (s.status === 'failed') { if (/not charged|nsfw|content filter/i.test(s.error || '')) { it.billed -= it.seconds; it.billedDollars -= it.price; } throw new Error(s.error || 'job failed'); }
      }
      it.state = 'downloading'; this.emit();
      const blob = await this.engine.fetch(it.id, it.statusResult);
      await putClip(this.key(it), blob, { id: it.id, prompt, seconds: it.seconds, size: this.size, model: this.cfg.model, at: Date.now() });
      // 'done' means everything is done, cache included; the emit in finally follows with no await between
      it.blob = blob; it.url = URL.createObjectURL(blob); it.state = 'done'; it.progress = 1;
    } catch (e) {
      it.state = 'failed'; it.error = e.message;
    } finally { this.inflight--; this.emit(); this.pump(); }
  }
  stop() { this.stopped = true; this.emit(); }
  cancel() { this.stop(); }
  detach() { this.stopped = true; this.onUpdate = null; }
}
export const busy = (it) => it.state === 'creating' || it.state === 'running' || it.state === 'downloading';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every engine's content rules bind the prompt the same way: no real people, brands or copyrighted characters, no text.
// The treatment prompt already writes shots that way; this adds the artist's direction, the frame and the house style.
export function soraPrompt(scene, size, direction = '') {
  const frame = size === '720x1280' ? 'vertical 9:16 frame composed for a phone screen' : 'cinematic 16:9 frame';
  const dir = String(direction || '').trim();
  return `${scene.shot}${dir ? ` Setting and look: ${dir}.` : ''} ${frame}, no on-screen text, no captions, no logos, no real people's faces in close-up.`;
}

// ---- export: draw every frame, encode ----
// drawAt(ctx, W, H, t) is provided by the app (it knows the switcher + clips). audioBuffer is the song.
export async function exportVideo({ W, H, fps = 30, duration, drawAt, audioBuffer, onProgress }) {
  const frames = Math.ceil(duration * fps);
  // MP4 path: WebCodecs + a vendored muxer (vendor/mp4-muxer.mjs, MIT). Until the muxer ships, the
  // probe fails quietly and the MediaRecorder path below produces WebM; both are real exports.
  let mp4 = null; try { if ('VideoEncoder' in window && 'AudioEncoder' in window) mp4 = await import('../vendor/mp4-muxer.mjs'); } catch { mp4 = null; }
  if (mp4) {
    const canvas = new OffscreenCanvas(W, H); const ctx = canvas.getContext('2d');
    const { Muxer, ArrayBufferTarget } = mp4;
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, audio: { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 }, fastStart: 'in-memory' });
    const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { throw e; } });
    venc.configure({ codec: W >= 1280 || H >= 1280 ? 'avc1.640028' : 'avc1.4d401f', width: W, height: H, bitrate: 8_000_000, framerate: fps });
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { throw e; } });
    aenc.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192_000 });
    // audio: resample to 48k stereo with an OfflineAudioContext, feed in 1024-frame chunks
    const off = new OfflineAudioContext(2, Math.ceil(duration * 48000), 48000); const src = off.createBufferSource(); src.buffer = audioBuffer; src.connect(off.destination); src.start(0);
    const ab = await off.startRendering(); const L = ab.getChannelData(0), R = ab.getChannelData(1); const CH = 1024;
    for (let i = 0; i < ab.length; i += CH) { const n = Math.min(CH, ab.length - i); const data = new Float32Array(n * 2); data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n); const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / 48000 * 1e6), data }); aenc.encode(ad); ad.close(); }
    await aenc.flush();
    for (let f = 0; f < frames; f++) {
      const t = f / fps; await drawAt(ctx, W, H, t);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: f % (fps * 2) === 0 }); frame.close();
      if (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
      if (f % 15 === 0) { onProgress && onProgress(f / frames); await new Promise((r) => setTimeout(r, 0)); }
    }
    await venc.flush(); muxer.finalize();
    onProgress && onProgress(1);
    return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), ext: 'mp4' };
  }
  // fallback: MediaRecorder in real time
  const vis = document.createElement('canvas'); vis.width = W; vis.height = H; const vctx = vis.getContext('2d');
  const actx = new AudioContext(); const dest = actx.createMediaStreamDestination(); const s = actx.createBufferSource(); s.buffer = audioBuffer; s.connect(dest);
  const stream = new MediaStream([...vis.captureStream(fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 }); const parts = []; rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const t0 = actx.currentTime + 0.1; s.start(t0); rec.start(500);
  await new Promise((res) => { const tick = async () => { const t = actx.currentTime - t0; if (t >= duration) { rec.stop(); s.stop(); return res(); } await drawAt(vctx, W, H, Math.max(0, t)); onProgress && onProgress(t / duration); requestAnimationFrame(tick); }; tick(); });
  await new Promise((r) => { rec.onstop = r; });
  return { blob: new Blob(parts, { type: mime }), ext: 'webm' };
}
export function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
