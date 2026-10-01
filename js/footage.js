// CUE — footage jobs + export. Sora 2 jobs run through js/azure.js (two at once on the preview);
// finished clips are kept in IndexedDB keyed by scene so a reload or a format switch does not pay
// twice. Export draws every frame with the switcher at 30 fps and encodes with WebCodecs
// (H.264 MP4 via a tiny muxer) when available, else MediaRecorder WebM.
import { createVideo, videoStatus, downloadVideo, clipSeconds } from './azure.js';

// ---- IndexedDB for clips ----
const DB = 'cue-clips-v1';
function db() { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('clips'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
export async function getClip(key) { const d = await db(); return new Promise((res) => { const t = d.transaction('clips').objectStore('clips').get(key); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); }); }
export async function putClip(key, blob, meta) { const d = await db(); return new Promise((res) => { const t = d.transaction('clips', 'readwrite').objectStore('clips').put({ blob, meta, at: Date.now() }, key); t.onsuccess = () => res(); t.onerror = () => res(); }); }
export const clipKey = (songId, scene, size) => `${songId}:${scene.n}:${size}:${hash(scene.shot)}`;
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }

// ---- the render job: every scene → one clip, two in flight ----
export class FootageJob {
  constructor({ songId, scenes, analysis, size, onUpdate }) {
    Object.assign(this, { songId, scenes, analysis, size, onUpdate });
    this.items = scenes.map((s) => ({ scene: s, state: 'queued', progress: 0, id: null, blob: null, url: null, error: null, seconds: clipSeconds(s, 60 / analysis.bpm) }));
    this.cancelled = false; this.inflight = 0; this.MAX = 2;
  }
  async start() {
    // anything already in the cache lands instantly
    for (const it of this.items) { const c = await getClip(clipKey(this.songId, it.scene, this.size)); if (c) { it.blob = c.blob; it.url = URL.createObjectURL(c.blob); it.state = 'done'; it.progress = 1; it.cached = true; } }
    this.emit(); this.pump();
  }
  emit() { this.onUpdate && this.onUpdate(this); }
  get done() { return this.items.every((i) => i.state === 'done' || i.state === 'failed'); }
  get spent() { return this.items.filter((i) => i.state !== 'queued' && !i.cached).reduce((s, i) => s + i.seconds, 0); }
  pump() {
    if (this.cancelled) return;
    while (this.inflight < this.MAX) { const next = this.items.find((i) => i.state === 'queued'); if (!next) break; this.run(next); }
    if (this.done) this.emit();
  }
  async run(it) {
    this.inflight++; it.state = 'creating'; this.emit();
    try {
      const prompt = soraPrompt(it.scene, this.size);
      const v = await createVideo({ prompt, size: this.size, seconds: it.seconds });
      it.id = v.id; it.state = 'running'; this.emit();
      for (;;) {
        if (this.cancelled) return;
        await sleep(4000);
        const s = await videoStatus(it.id);
        it.progress = (s.progress || 0) / 100; this.emit();
        if (s.status === 'completed') break;
        if (s.status === 'failed' || s.status === 'cancelled') throw new Error(s.error?.message || `job ${s.status}`);
      }
      it.state = 'downloading'; this.emit();
      const blob = await downloadVideo(it.id);
      it.blob = blob; it.url = URL.createObjectURL(blob); it.state = 'done'; it.progress = 1;
      await putClip(clipKey(this.songId, it.scene, this.size), blob, { id: it.id, prompt, seconds: it.seconds, size: this.size, at: Date.now() });
    } catch (e) {
      it.state = 'failed'; it.error = e.message;
    } finally { this.inflight--; this.emit(); this.pump(); }
  }
  cancel() { this.cancelled = true; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sora 2's content rules bind the prompt: no real people, brands or copyrighted characters, no text. The
// treatment prompt already writes shots that way; this adds the frame and the house style.
export function soraPrompt(scene, size) {
  const frame = size === '720x1280' ? 'vertical 9:16 frame composed for a phone screen' : 'cinematic 16:9 frame';
  return `${scene.shot} ${frame}, no on-screen text, no captions, no logos, no real people's faces in close-up.`;
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
