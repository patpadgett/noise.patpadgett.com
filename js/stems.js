// NOISE — neural stems. Fetches the Demucs v4 model once into Cache Storage, runs a pool of
// separate.worker.js instances over the song in ~12 s chunks with 0.75 s overlaps, crossfades the
// chunks back into four whole stems and reports progress region by region.
//
// Memory: each worker holds a ~1.9 GB WASM heap while demixing, so the pool is sized from
// navigator.deviceMemory / hardwareConcurrency and phones are told plainly that this needs a computer.

export const MODEL_URL = (typeof globalThis !== 'undefined' && globalThis.NOISE_MODEL_URL) || 'https://huggingface.co/datasets/Retrobear/demucs.cpp/resolve/main/ggml-model-htdemucs-4s-f16.bin';
export const MODEL_BYTES = 83994361;
const CACHE = 'noise-demucs-v1';
const SR = 44100;
const SEG = 7.8, STRIDE = SEG * 0.75, PAD = 0.75; // demucs.cpp's internal segment, its stride, and our chunk overlap
export const CHUNK_CORE = SEG + STRIDE - 2 * PAD; // 12.15 s: two internal segments per chunk, nothing wasted
export const STEM_NAMES = ['drums', 'bass', 'other', 'vocals'];

export function neuralCapability() {
  const cores = navigator.hardwareConcurrency || 2;
  const mem = navigator.deviceMemory; // Chrome only, capped at 8
  const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 700;
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || phone;
  if (typeof WebAssembly !== 'object' || typeof Worker !== 'function') return { ok: false, why: 'This browser cannot run the separation model.', workers: 0 };
  if (mobile) return { ok: false, why: 'Neural stems need a computer: the model takes about 2 GB of memory per worker, which phones will not give a web page.', workers: 0 };
  if (mem && mem < 4) return { ok: false, why: `Neural stems need about 2 GB of free memory and this device reports ${mem} GB.`, workers: 0 };
  const byMem = mem ? Math.floor(mem / 2.5) : 2;
  const workers = Math.max(1, Math.min(4, cores - 1, byMem));
  return { ok: true, workers, cores, mem };
}

// Per-worker speed: a single worker runs ~10–13× slower than real time on a laptop core; several
// workers contend for memory bandwidth and each slows further (3 workers measured at ~25×). Report
// the honest number for the pool size and let the measured per-chunk rate replace it.
export function perWorkerRate(workers) { return 12 * (1 + 0.35 * (Math.max(1, workers) - 1)); }
export function estimateSeconds(durationSec, workers, measuredRate) {
  const rate = measuredRate || perWorkerRate(workers);
  return Math.ceil(durationSec * rate / Math.max(1, workers));
}

export async function modelCached() {
  try { const c = await caches.open(CACHE); const r = await c.match(MODEL_URL); return !!r; } catch (e) { return false; }
}

// Ensure the model is in Cache Storage; onProgress(bytes, total). Returns the ArrayBuffer only when
// the cache is unusable (then it is posted to each worker instead of fetched from the cache).
export async function ensureModel(onProgress, signal) {
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(MODEL_URL); if (hit) { onProgress?.(MODEL_BYTES, MODEL_BYTES); return null; } } catch (e) { cache = null; }
  const res = await fetch(MODEL_URL, { signal, mode: 'cors' });
  if (!res.ok) throw new Error('Model download failed (HTTP ' + res.status + ')');
  const total = +res.headers.get('content-length') || MODEL_BYTES;
  const reader = res.body.getReader(); const parts = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.byteLength; onProgress?.(got, total); }
  const blob = new Blob(parts);
  if (cache) { try { await cache.put(MODEL_URL, new Response(blob, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(blob.size) } })); return null; } catch (e) { /* quota: fall through and hand the bytes over directly */ } }
  return await blob.arrayBuffer();
}

export class StemJob {
  // buffer: stereo AudioBuffer at 44.1 kHz (resampled by the caller if not)
  constructor(buffer, { workers = 2, onRegion, onProgress, onDone, onError } = {}) {
    this.buffer = buffer; this.n = buffer.length; this.workers = workers;
    this.onRegion = onRegion || (() => {}); this.onProgress = onProgress || (() => {}); this.onDone = onDone || (() => {}); this.onError = onError || (() => {});
    this.stems = STEM_NAMES.map(() => [new Float32Array(this.n), new Float32Array(this.n)]);
    this.weight = new Float32Array(this.n); // crossfade bookkeeping
    const core = Math.round(CHUNK_CORE * SR), pad = Math.round(PAD * SR);
    this.chunks = [];
    for (let s = 0; s < this.n; s += core) { const e = Math.min(this.n, s + core); this.chunks.push({ id: this.chunks.length, s, e, a: Math.max(0, s - pad), b: Math.min(this.n, e + pad), done: false, started: 0 }); }
    this.queue = this.chunks.slice(); this.doneCount = 0; this.cancelled = false; this.pool = []; this.rate = perWorkerRate(workers); this.measured = []; this.startedAt = 0; this.secondsDone = 0;
  }
  async start(modelBytes /* ArrayBuffer or null when cached */) {
    this.startedAt = performance.now();
    const L = this.buffer.getChannelData(0), R = this.buffer.numberOfChannels > 1 ? this.buffer.getChannelData(1) : L;
    const model = modelBytes || await (async () => { const c = await caches.open(CACHE); const r = await c.match(MODEL_URL); return await r.arrayBuffer(); })();
    const spawn = (i) => {
      const w = new Worker('js/separate.worker.js');
      const me = { w, busy: null };
      w.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'ready') { this.feed(me, L, R); }
        else if (d.type === 'chunk-progress') { if (me.busy) me.busy.p = Math.max(me.busy.p || 0, d.p); this.tick(); }
        else if (d.type === 'chunk-done') { this.land(d); me.busy = null; this.feed(me, L, R); }
        else if (d.type === 'error') { this.fail(new Error(d.error)); }
      };
      w.onerror = (e) => this.fail(new Error(e.message || 'separation worker crashed'));
      // the model bytes are copied into each worker (structured clone); ~84 MB each, transient
      w.postMessage({ type: 'init', model });
      this.pool.push(me);
    };
    for (let i = 0; i < this.workers; i++) spawn(i);
  }
  feed(me, L, R) {
    if (this.cancelled) return;
    const c = this.queue.shift();
    if (!c) { if (this.pool.every((p) => !p.busy)) this.finish(); return; }
    me.busy = c; c.started = performance.now(); c.p = 0;
    const l = L.slice(c.a, c.b), r = R.slice(c.a, c.b);
    me.w.postMessage({ type: 'chunk', id: c.id, start: c.a, pad: c.s - c.a, L: l, R: r }, [l.buffer, r.buffer]);
  }
  land(d) {
    const c = this.chunks[d.id]; c.done = true; this.doneCount++;
    const len = d.stems[0][0].length, a = c.a;
    const padL = c.s - c.a, padR = c.b - c.e;
    for (let k = 0; k < 4; k++) {
      for (let ch = 0; ch < 2; ch++) {
        const src = d.stems[k][ch], dst = this.stems[k][ch];
        for (let i = 0; i < len; i++) {
          // triangular weight across the overlaps, flat in the core
          let w = 1;
          if (i < padL) w = (i + 1) / (padL + 1); else if (i >= len - padR) w = (len - i) / (padR + 1);
          dst[a + i] += src[i] * w;
        }
      }
    }
    for (let i = 0; i < len; i++) { let w = 1; if (i < padL) w = (i + 1) / (padL + 1); else if (i >= len - padR) w = (len - i) / (padR + 1); this.weight[a + i] += w; }
    this.secondsDone += (c.e - c.s) / SR;
    // measured per-worker rate: wall seconds this chunk took (padded length) per audio second
    this.measured.push((d.ms / 1000) / ((c.b - c.a) / SR));
    this.rate = this.measured.reduce((s, v) => s + v, 0) / this.measured.length;
    this.onRegion({ start: c.s / SR, end: c.e / SR, index: c.id, total: this.chunks.length, done: this.doneCount });
    this.tick();
  }
  tick() {
    const el = (performance.now() - this.startedAt) / 1000;
    const total = this.n / SR;
    // progress: finished seconds plus each in-flight chunk's own reported progress
    let inflight = 0, firstP = 0;
    for (const p of this.pool) if (p.busy) { inflight += (p.busy.e - p.busy.s) / SR * Math.min(0.99, p.busy.p || 0); firstP = Math.max(firstP, p.busy.p || 0); }
    const doneSec = Math.min(total, this.secondsDone + inflight);
    // the estimate is a guess until a chunk has landed; before that the first chunk's own progress is the only honest signal
    const measured = this.measured.length > 0;
    const left = Math.max(0, (total - doneSec) * this.rate / this.workers);
    const chunkSec = this.chunks[0] ? (this.chunks[0].b - this.chunks[0].a) / SR : CHUNK_CORE;
    const firstIn = measured ? 0 : (firstP > 0.05 && el > 5) ? Math.max(0, el / firstP - el) : chunkSec * this.rate;
    this.onProgress({ frac: doneSec / total, secondsLeft: measured ? left : (firstP > 0.05 && el > 5 ? left : null), firstIn, elapsed: el, rate: this.rate, measured });
  }
  finish() {
    if (this.cancelled || this.finished) return; this.finished = true;
    // normalise the overlaps (weights sum to ~1 already; this removes rounding)
    for (let k = 0; k < 4; k++) for (let ch = 0; ch < 2; ch++) { const d = this.stems[k][ch]; for (let i = 0; i < this.n; i++) { const w = this.weight[i]; if (w > 0 && Math.abs(w - 1) > 1e-3) d[i] /= w; } }
    this.terminate();
    this.onDone({ stems: this.stems, names: STEM_NAMES, elapsed: (performance.now() - this.startedAt) / 1000 });
  }
  fail(err) { if (this.cancelled) return; this.terminate(); this.cancelled = true; this.onError(err); }
  cancel() { this.cancelled = true; this.terminate(); }
  terminate() { for (const p of this.pool) { try { p.w.terminate(); } catch (e) {} } this.pool = []; }
}

// Resample any AudioBuffer to stereo 44.1 kHz with an OfflineAudioContext (Demucs is 44.1k-only).
export async function to44k(buffer) {
  if (buffer.sampleRate === SR && buffer.numberOfChannels === 2) return buffer;
  const len = Math.ceil(buffer.duration * SR);
  const off = new OfflineAudioContext(2, len, SR);
  const src = off.createBufferSource(); src.buffer = buffer; src.connect(off.destination); src.start(0);
  return await off.startRendering();
}
