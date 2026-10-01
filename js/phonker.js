// NOISE — the phonker. Given a song, its analysis and its material (the song's own music re-tuned
// into the minor key, and the song's own drums), build a phonk arrangement and play it (live) or
// render it (offline). The kit is drums and bells only; every melodic sound is the record itself.
//
// Material arrives twice: a quick split within seconds (harmonic/percussive), then the neural
// stems region by region. The live scheduler looks a couple of seconds ahead, so the better
// material takes over at the next bar without a restart.

import { Drums, Cowbell, Tape, clamp } from './kit.js';

export const PRESETS = {
  drift:     { name: 'DRIFT',     slow: 0.86, kit: 0.9,  bells: 0.8,  grit: 0.5,  chop: 0.15, swing: 0.02, sens: 0.5 },
  memphis:   { name: 'MEMPHIS',   slow: 0.90, kit: 1.0,  bells: 0.95, grit: 0.8,  chop: 0.4,  swing: 0.08, sens: 0.65 },
  brazilian: { name: 'BRAZILIAN', slow: 0.96, kit: 1.1,  bells: 0.6,  grit: 0.65, chop: 0.1,  swing: 0.0,  sens: 0.4 },
};
export const DEFAULTS = { ...PRESETS.drift };
export const MINOR_PCS = [0, 2, 3, 5, 7, 8, 10]; // natural minor relative to the root
const HOP = 1024, SR = 44100;

// Which pitch classes drop a semitone to reach the parallel minor: the major 3rd, 6th and 7th.
export function flatsFor(key) {
  const t = new Uint8Array(12);
  if (key.mode === 'major') for (const d of [4, 9, 11]) t[(key.root + d) % 12] = 1;
  return t;
}

// ---------- material: chunks of re-tuned song + the song's own drums ----------
export class Material {
  constructor(ctx, n, label) {
    this.ctx = ctx; this.n = n; this.label = label;
    this.chunks = []; // {s, e, tonal: AudioBuffer, perc: AudioBuffer}
    const frames = Math.ceil(n / HOP) + 1;
    this.f0 = { midi: new Float32Array(frames), sal: new Float32Array(frames), energy: new Float32Array(frames), frames };
    this.covered = 0; this._rev = new WeakMap();
  }
  // add a processed region: core [s,e) in samples, arrays cover the padded region [a,b)
  add({ a, s, e, tonal, perc, f0 }) {
    const len = e - s, off = s - a;
    const mk = (pair) => { const b = this.ctx.createBuffer(2, len, SR); b.copyToChannel(pair[0].subarray(off, off + len), 0); b.copyToChannel(pair[1].subarray(off, off + len), 1); return b; };
    const chunk = { s, e, tonal: mk(tonal), perc: perc ? mk(perc) : null };
    this.chunks.push(chunk); this.chunks.sort((x, y) => x.s - y.s);
    if (f0) {
      for (let c = 0; c < f0.frames; c++) {
        const g = a + c * f0.hop + f0.t0; if (g < s || g >= e) continue;
        const gi = Math.round(g / HOP); if (gi < 0 || gi >= this.f0.frames) continue;
        this.f0.midi[gi] = f0.midi[c]; this.f0.sal[gi] = f0.sal[c]; this.f0.energy[gi] = f0.energy[c];
      }
    }
    this.covered += len;
  }
  get complete() { return this.covered >= this.n - 2; }
  chunkAt(sample) { for (const c of this.chunks) if (sample >= c.s && sample < c.e) return c; return null; }
  covers(from, to) { // samples
    let p = from;
    for (const c of this.chunks) { if (c.e <= p) continue; if (c.s > p) return false; p = c.e; if (p >= to) return true; }
    return p >= to;
  }
  reversed(buf) {
    let r = this._rev.get(buf); if (r) return r;
    r = this.ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) { const a = buf.getChannelData(ch), b = r.getChannelData(ch); for (let i = 0, n = a.length; i < n; i++) b[i] = a[n - 1 - i]; }
    this._rev.set(buf, r); return r;
  }
}

// ---------- melody: f0 frames -> one note per 8th-note slot (the song's beat), snapped to minor ----------
export function readMelody(f0, bars, root) {
  if (!f0) return new Map();
  const notes = new Map(); // key "barIdx:k" -> midi (60..83) or null
  const energies = Array.from(f0.energy).filter((v) => v > 0).sort((a, b) => a - b);
  const sals = Array.from(f0.sal).filter((v) => v > 0).sort((a, b) => a - b);
  if (!energies.length) return notes;
  const eRef = energies[Math.floor(energies.length * 0.9)], sRef = sals[Math.floor(sals.length * 0.9)];
  const inScale = (m) => MINOR_PCS.includes((((m - root) % 12) + 12) % 12);
  const snap = (m) => { if (inScale(m)) return m; if (inScale(m - 1)) return m - 1; if (inScale(m + 1)) return m + 1; return m; };
  for (const bar of bars) {
    const b = bar.beats;
    for (let k = 0; k < 8; k++) {
      const beat = k >> 1, t0 = b[beat] + (k & 1 ? (b[beat + 1] !== undefined ? (b[beat + 1] - b[beat]) / 2 : 0.25) : 0);
      const t1 = (k & 1) ? (b[beat + 1] ?? (b[beat] + 0.5)) : t0 + ((b[beat + 1] ?? (b[beat] + 0.5)) - b[beat]) / 2;
      const c0 = Math.max(0, Math.round(t0 * SR / HOP)), c1 = Math.min(f0.frames, Math.round(t1 * SR / HOP));
      const hist = new Map(); let e = 0, s = 0, n = 0;
      for (let c = c0; c < c1; c++) { const m = f0.midi[c]; if (!m) continue; const w = f0.sal[c]; hist.set(m, (hist.get(m) || 0) + w); e += f0.energy[c]; s += f0.sal[c]; n++; }
      if (!n || e / n < 0.3 * eRef || s / n < 0.28 * sRef) { notes.set(bar.idx + ':' + k, null); continue; }
      let best = 0, bm = 0; for (const [m, w] of hist) if (w > best) { best = w; bm = m; }
      let m = snap(Math.round(bm));
      while (m < 60) m += 12; while (m > 83) m -= 12;
      notes.set(bar.idx + ':' + k, m);
    }
  }
  return notes;
}

// ---------- arrangement ----------
// Returns bars + kit events in SOURCE-TIME seconds; the player stretches time by 1/slow.
export function arrange(analysis, params, seed = 7, melody = null) {
  const rnd = mulberry(seed);
  const { beats, key, beatLoud } = analysis;
  if (!beats || beats.length < 8) return null;
  const beatSec = 60 / analysis.bpm;
  const phaseIdx = analysis.phase || 0;
  const bars = [];
  for (let i = phaseIdx; i + 3 < beats.length; i += 4) bars.push({ start: beats[i], beats: beats.slice(i, i + 4), idx: bars.length });
  if (!bars.length) return null;
  for (const bar of bars) bar.end = bars[bar.idx + 1]?.start ?? (bar.start + beatSec * 4);
  const barLoud = bars.map((b, i) => { const a = beatLoud.slice(i * 4 + phaseIdx, i * 4 + phaseIdx + 4); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; });
  const root = key.root;
  const bellBase = 60 + root;
  const events = [];
  const chop = params.chop;
  // SENSITIVITY (ReCycle's slicer knob): which points of the record the slicer is allowed to cut at.
  // The analysis worker's onset envelope says how hard each 23 ms frame attacks; a slice point is
  // "found" when its attack clears a threshold that falls as sensitivity rises. Low: only the hard
  // hits (downbeats, snares). High: every 8th and the softer 16ths between them become slice points.
  const sens = params.sens ?? 0.5;
  const onset = analysis.onset, fps = analysis.fps || 1;
  let omax = 0; if (onset) for (let i = 0; i < onset.length; i++) if (onset[i] > omax) omax = onset[i];
  const attackAt = (t) => { if (!onset || !omax) return 1; const c = Math.round(t * fps); let m = 0; for (let k = -2; k <= 2; k++) { const v = onset[c + k]; if (v > m) m = v; } return m / omax; };
  const threshold = 0.55 - sens * 0.5; // 1.0 sens → anything over 5 % attacks counts; 0 sens → only the top 55 %
  const cuts = (t) => attackAt(t) >= threshold;
  const E = (t, kind, extra) => events.push({ t, kind, ...extra });
  let dropBar = bars.findIndex((b, i) => barLoud[i] > 0.45);
  if (dropBar < 0 || dropBar > 4) dropBar = Math.min(2, bars.length - 1);
  const motifA = [0, 0, 3, 0, 7, 3, 2, 0], motifB = [0, 0, 3, 0, 10, 7, 3, 2]; // minor-scale motifs
  const firstDown = bars[0].start;

  for (const bar of bars) {
    const i = bar.idx, b = bar.beats;
    const half = (k) => b[k] + (b[k + 1] !== undefined ? (b[k + 1] - b[k]) / 2 : beatSec / 2);
    const q = (k, f) => b[k] + beatSec * f;
    const slot = (k) => k % 2 === 0 ? b[k / 2] : half((k - 1) / 2);
    const inDrop = i >= dropBar;
    const since = i - dropBar;
    const fill = inDrop && since % 8 === 7;
    const variation = rnd();
    bar.section = !inDrop ? 'intro' : fill ? 'turn' : (Math.floor(since / 8) % 2 ? 'B' : 'A');
    // --- drums: half-time, kick on 1, snare+clap on 3 ---
    if (inDrop) {
      E(b[0], 'kick', { v: 1 });
      if (variation < 0.6) E(q(1, 0.5), 'kick', { v: 0.9 }); else E(q(0, 0.75), 'kick', { v: 0.85 });
      if (variation > 0.3) E(q(2, 0.5), 'kick', { v: 0.9 });
      if (fill) E(q(3, 0.5), 'kick', { v: 0.8 });
      E(b[2], 'snare', { v: 1 }); E(b[2], 'clap', { v: 0.9 });
      if (fill) { E(q(3, 0.5), 'snare', { v: 0.7 }); E(q(3, 0.75), 'snare', { v: 0.5 }); }
      for (let k = 0; k < 4; k++) { E(b[k], 'hat', { v: 0.85 }); E(half(k), 'hat', { v: 0.5 }); }
      if (fill || variation > 0.75) { E(q(3, 0.25), 'hat', { v: 0.45 }); E(q(3, 0.75), 'hat', { v: 0.55 }); }
      E(q(3, 0.5), 'ohat', { v: 0.7 });
      if (variation < 0.5) E(q(1, 0.25), 'rim', { v: 0.45 });
      if (since % 8 === 0) E(b[0], 'crash', { v: 0.5 });
    } else {
      for (let k = 0; k < 4; k++) E(b[k], 'hat', { v: 0.6 });
      if (i === dropBar - 1) { E(q(3, 0), 'snare', { v: 0.6 }); E(q(3, 0.5), 'snare', { v: 0.8 }); }
    }
    // --- bells: the song's own melody, read from the record. Section A outlines it on quarter notes
    // (repeated notes held), section B and the turnaround ride it on every 8th: the hook answers
    // the song instead of doubling it. Bars without a readable melody get the minor motif in B only.
    let voiced = 0;
    if (melody) for (let k = 0; k < 8; k++) if (melody.get(i + ':' + k) != null) voiced++;
    bar.melodyBar = voiced >= 3;
    const sectionB = inDrop && (Math.floor(since / 8) % 2 === 1);
    const bellsOn = inDrop || i === dropBar - 1;
    if (bar.melodyBar && bellsOn) {
      let last = null;
      for (let k = 0; k < 8; k++) {
        const m = melody.get(i + ':' + k);
        if (m == null) { last = null; continue; }
        const ride = sectionB || fill || i === dropBar - 1;
        if (!ride && (k % 2 === 1 || m === last)) { last = m; continue; } // A: outline on quarters, hold repeats
        const accent = k % 2 === 0 ? 1 : 0.78;
        E(slot(k), 'bell', { n: m, v: accent * (m === last ? 0.85 : 1), melody: true });
        last = m;
      }
    } else if (bellsOn && (sectionB || fill || i === dropBar - 1)) {
      const motif = (Math.floor(since / 2) % 2 === 0) ? motifA : motifB;
      for (let k = 0; k < 8; k++) E(slot(k), 'bell', { n: bellBase + motif[k] + (fill && k >= 6 ? 12 : 0), v: k % 2 === 0 ? 0.95 : 0.75 });
    }
    // --- the record: straight, or re-chopped from its own slice points (the Rex deck) ---
    // Slice points are the beats and half-beats of this bar that the slicer found (see SENSITIVITY).
    // A bar with fewer than two found points cannot be chopped; the record plays through.
    const points = [];
    for (let k = 0; k < 8; k++) { const t = slot(k); if (k % 2 === 0 ? (k === 0 || cuts(t)) : (sens > 0.3 && cuts(t))) points.push({ k, t, beat: k >> 1 }); }
    bar.slicePoints = points.map((p) => p.k);
    const doChop = inDrop && chop > 0.05 && points.length >= 2 && rnd() < chop * 0.9;
    if (doChop) {
      const plan = [];
      for (let k = 0; k < 8; k++) {
        const r = rnd();
        // pick a found slice point to play here: mostly the one under this slot, sometimes another, sometimes the downbeat
        const under = points.reduce((best, p) => (p.k <= k && p.k > (best?.k ?? -1)) ? p : best, null) || points[0];
        const src = r < 0.5 ? under : r < 0.8 ? points[Math.floor(rnd() * points.length)] : points[0];
        const deep = chop > 0.3 && rnd() < chop * 0.3; // octave-down chop of the record's own voice
        plan.push({ at: slot(k), from: src.t, len: beatSec / 2, reverse: !deep && rnd() < chop * 0.25, rate: deep ? 0.5 : 1, srcBeat: src.beat, srcK: src.k });
      }
      bar.plan = plan;
    } else if (fill && chop > 0.02) {
      bar.plan = [0, 1, 2, 3].map((k) => ({ at: b[k], from: b[0], len: beatSec / 2 * (k === 3 ? 0.5 : 1), reverse: false, rate: 1, srcBeat: 0, srcK: 0 }));
      bar.plan.push({ at: half(3), from: b[0], len: beatSec / 4, reverse: false, rate: 1, srcBeat: 0, srcK: 0 }, { at: q(3, 0.75), from: b[0], len: beatSec / 4, reverse: false, rate: 1, srcBeat: 0, srcK: 0 });
    }
    bar.tapeStop = inDrop && since % 16 === 15 && chop > 0.08; // every 16th bar the tape dies before the section
  }
  events.sort((a, b) => a.t - b.t);
  return { bars, events, beatSec, root, dropBar, firstDown, barLoud, minor: true };
}

// ---------- player / renderer ----------
export class Phonker {
  constructor() {
    this.ctx = null; this.live = null; this.playing = false; this.params = { ...DEFAULTS };
    this.source = null; this.analysis = null; this.arr = null; this.onstate = () => {}; this.onbar = () => {};
    this.quick = null; this.neural = null; this.seed = 7; this.melody = null;
  }
  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback', sampleRate: SR });
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  async decode(arrayBuffer) { return await this.ensure().decodeAudioData(arrayBuffer.slice(0)); }
  get key() { return this.analysis ? { root: this.analysis.key.root, mode: 'minor', from: this.analysis.key.mode } : null; }
  load(buffer, analysis, quick) {
    this.stop();
    this.source = buffer; this.analysis = analysis; this.quick = quick; this.neural = null;
    // loudness-normalise the record: its loud parts to about -14 dBFS so a 1920 78 and a 2024 master meet the kit at the same level
    const d = buffer.getChannelData(0), n = d.length, win = Math.floor(buffer.sampleRate * 0.4), rms = [];
    for (let i = 0; i + win <= n; i += win) { let s = 0; for (let k = i; k < i + win; k += 4) s += d[k] * d[k]; rms.push(Math.sqrt(s / (win / 4))); }
    rms.sort((a, b) => a - b);
    const loud = rms[Math.floor(rms.length * 0.9)] || 0.1;
    this.srcGain = clamp(0.2 / loud, 0.5, 6);
    this.rearrange();
  }
  setNeural(material) { this.neural = material; }
  rearrange() {
    const mat = (this.neural && this.neural.complete) ? this.neural : this.quick;
    const bars = arrange(this.analysis, this.params, this.seed).bars; // grid first, then the melody on it
    this.melody = readMelody(mat?.f0, bars, this.analysis.key.root);
    this.arr = arrange(this.analysis, this.params, this.seed, this.melody);
  }
  setParam(k, v) {
    this.params[k] = v;
    if (k === 'chop' || k === 'swing' || k === 'sens') { this.rearrange(); return; } // the look-ahead scheduler picks the new plan up at the next bar
    if (k === 'slow' && this.playing) { this.restart(); return; }
    if (this.live) this.applyMix(this.live);
  }
  setPreset(name) { Object.assign(this.params, PRESETS[name]); this.rearrange(); if (this.live) this.applyMix(this.live); if (this.playing) this.restart(); }
  setSlot(i) { this.seed = 7 + i * 131; this.rearrange(); }
  get slot() { return Math.round((this.seed - 7) / 131); }

  buildGraph(ctx, dest) {
    const tape = new Tape(ctx, dest, { saturation: 0.55, tone: 9000, wow: 0.18, hiss: 0.3, level: 1 });
    const sum = ctx.createGain(); sum.gain.value = 0.7; sum.connect(tape.input);
    // the record leads: the re-tuned music full, its own drums tucked under the kit
    const srcBus = ctx.createGain(); srcBus.gain.value = this.srcGain || 1;
    const srcLp = ctx.createBiquadFilter(); srcLp.type = 'lowpass'; srcLp.frequency.value = 14000; srcLp.Q.value = 0.5;
    const srcHp = ctx.createBiquadFilter(); srcHp.type = 'highpass'; srcHp.frequency.value = 40; srcHp.Q.value = 0.7;
    const duck = ctx.createGain(); duck.gain.value = 1;
    const tonalBus = ctx.createGain(); tonalBus.gain.value = 1; tonalBus.connect(srcBus);
    const percBus = ctx.createGain(); percBus.gain.value = 0.5; percBus.connect(srcBus);
    srcBus.connect(srcHp); srcHp.connect(srcLp); srcLp.connect(duck); duck.connect(sum);
    const kit = ctx.createGain(); kit.gain.value = 0.25; kit.connect(sum);
    const drums = new Drums(ctx, kit, { memphis: 0.5, level: 1.1 });
    const bell = new Cowbell(ctx, kit, { stack: 0.55, grit: 0.5, hall: 0.28, level: 1.1 });
    return { ctx, dest, tape, sum, srcBus, srcHp, srcLp, duck, tonalBus, percBus, kit, drums, bell, nodes: new Set() };
  }
  applyMix(g) {
    const p = this.params;
    g.drums.set('memphis', 0.1 + p.grit * 0.5); g.drums.set('level', 1.1 * p.kit);
    g.percBus.gain.setTargetAtTime(clamp(0.7 - p.kit * 0.35, 0.2, 0.7), g.ctx.currentTime, 0.05);
    g.bell.set('level', 0.8 * p.bells); g.bell.set('grit', p.grit * 0.9);
    g.tape.set('saturation', 0.08 + p.grit * 0.35); g.tape.set('tone', 18000 - p.grit * 5000); g.tape.set('hiss', p.grit * 0.2); g.tape.set('wow', 0.05 + (1 - p.slow) * 0.5);
    g.srcLp.frequency.value = 15000 - p.grit * 5000;
  }
  materialFor(fromSample, toSample) {
    if (this.neural && this.neural.covers(fromSample, toSample)) return this.neural;
    return this.quick;
  }
  // Play material [fromSrc, fromSrc+len) at context time `at`, bus-wise (tonal + perc), splitting at
  // chunk boundaries. `rate` multiplies the tape speed (0.5 = the record an octave down).
  playRegion(g, at, fromSrc, len, { reverse = false, rate = 1, slow, fade = 0.006, tapeStop = false } = {}) {
    if (len <= 0.0005) return;
    const mat = this.materialFor(Math.floor(fromSrc * SR), Math.ceil((fromSrc + len) * SR));
    if (!mat) return;
    let pos = fromSrc, t = at;
    const speed = slow * rate;
    while (pos < fromSrc + len - 1e-4) {
      const chunk = mat.chunkAt(Math.floor(pos * SR) + 1);
      if (!chunk) { pos += 0.05; t += 0.05 / speed; continue; }
      const segEnd = Math.min(fromSrc + len, chunk.e / SR);
      const segLen = segEnd - pos; if (segLen <= 0) break;
      const durCtx = segLen / speed;
      for (const [buf, bus] of [[chunk.tonal, g.tonalBus], [chunk.perc, g.percBus]]) {
        if (!buf) continue;
        const node = g.ctx.createBufferSource();
        node.buffer = reverse ? mat.reversed(buf) : buf; node.playbackRate.value = speed;
        const env = g.ctx.createGain();
        env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(1, t + fade);
        env.gain.setValueAtTime(1, t + durCtx); env.gain.linearRampToValueAtTime(0.0001, t + durCtx + fade);
        if (tapeStop) { const stopLen = Math.min(0.55, durCtx * 0.45); node.playbackRate.setValueAtTime(speed, t + durCtx - stopLen); node.playbackRate.exponentialRampToValueAtTime(speed * 0.04, t + durCtx + fade); }
        node.connect(env); env.connect(bus);
        const local = pos - chunk.s / SR; // offset inside the chunk
        const offset = reverse ? Math.max(0, buf.duration - (local + segLen)) : local;
        node.start(t, clamp(offset, 0, buf.duration), segLen + fade * speed);
        g.nodes.add(node); node.onended = () => g.nodes.delete(node);
      }
      pos = segEnd; t += durCtx;
    }
  }
  // Schedule bars whose start lies in [winFrom, winTo), clipping their slices to [clipFrom, clipTo).
  scheduleWindow(g, T, winFrom, winTo, clipFrom, clipTo) {
    const { slow, swing } = this.params, arr = this.arr, dur = this.source.duration;
    const eighth = arr.beatSec / 2;
    const swingOf = (ts) => { const ph = ((ts - arr.firstDown) / eighth) % 2; return (Math.abs(ph - 1) < 0.25) ? swing * eighth : 0; };
    const first = arr.bars[0], last = arr.bars[arr.bars.length - 1];
    const region = (s, e, opts) => { s = Math.max(s, clipFrom); e = Math.min(e, clipTo); if (e > s + 0.001) this.playRegion(g, T(s), s, e - s, { slow, ...opts }); };
    // the head of the song before the first bar
    if (winFrom <= 0 && 0 < winTo) region(0, first.start, {});
    for (const bar of arr.bars) {
      if (bar.start < winFrom || bar.start >= winTo) continue;
      if (bar.plan) {
        for (const sl of bar.plan) {
          const at = sl.at + swingOf(sl.at); if (at < clipFrom - 0.01 || at >= clipTo) continue;
          const len = Math.min(sl.len, clipTo - at);
          this.playRegion(g, T(at), sl.from, len, { slow, reverse: sl.reverse, rate: sl.rate });
        }
      } else region(bar.start, bar.end, { tapeStop: bar.tapeStop });
    }
    if (last.end >= winFrom && last.end < winTo) region(last.end, dur, {});
    // kit events
    for (const ev of arr.events) {
      if (ev.t < winFrom || ev.t >= winTo) continue;
      const ts = ev.t + swingOf(ev.t); if (ts < clipFrom - 0.01 || ts >= clipTo) continue;
      const t = T(ts); if (t < g.ctx.currentTime - 0.02) continue;
      switch (ev.kind) {
        case 'kick': g.drums.hit(t, 'kick', ev.v);
          g.duck.gain.setValueAtTime(1, t - 0.002); g.duck.gain.linearRampToValueAtTime(0.62, t + 0.008); g.duck.gain.setTargetAtTime(1, t + 0.04, 0.06);
          break;
        case 'snare': case 'clap': case 'hat': case 'ohat': case 'rim': case 'crash': g.drums.hit(t, ev.kind, ev.v); break;
        case 'bell': g.bell.note(t, ev.n, ev.v, (ev.melody ? 0.42 : 0.36) / slow * 0.9, 1.48, slow); break; // detuned with the tape so the bells stay in the record's (slowed) key
      }
    }
  }
  // ---- live: look-ahead scheduler ----
  play(fromSrc = 0) {
    if (!this.source || !this.arr) return;
    const ctx = this.ensure();
    this.stop();
    const g = this.buildGraph(ctx, ctx.destination);
    this.applyMix(g); g.tape.roll(true);
    const t0 = ctx.currentTime + 0.08;
    this.live = g; this.liveT0 = t0; this.liveFrom = fromSrc; this.playing = true;
    this.schedTo = fromSrc;
    this.tickSchedule();
    this.schedTimer = setInterval(() => this.tickSchedule(), 150);
    const total = (this.source.duration - fromSrc) / this.params.slow;
    this.endTimer = setTimeout(() => { if (this.playing) { this.stop(); this.onstate('ended'); } }, (total + 0.6) * 1000);
    this.onstate('playing');
  }
  tickSchedule() {
    const g = this.live; if (!g) return;
    const slow = this.params.slow, dur = this.source.duration;
    const T = (ts) => this.liveT0 + (ts - this.liveFrom) / slow;
    const horizon = Math.min(dur + 0.01, this.position() + 1.6 * slow + 0.4); // ~1.6 s of context time ahead
    if (horizon <= this.schedTo) return;
    this.scheduleWindow(g, T, this.schedTo, horizon, this.liveFrom, Infinity);
    this.schedTo = horizon;
  }
  position() {
    if (!this.playing || !this.live) return this._pausedAt || 0;
    return clamp(this.liveFrom + (this.live.ctx.currentTime - this.liveT0) * this.params.slow, 0, this.source?.duration || 0);
  }
  barAt(src) { const bars = this.arr?.bars; if (!bars) return null; for (const b of bars) if (src >= b.start && src < b.end) return b; return null; }
  restart() { const pos = this.position(); this.play(pos); }
  stop() {
    clearTimeout(this.endTimer); clearInterval(this.schedTimer);
    if (this.live) {
      this._pausedAt = this.position();
      const g = this.live; this.live = null;
      const t = g.ctx.currentTime;
      try { g.tape.master.gain.setTargetAtTime(0, t, 0.02); } catch (e) {}
      setTimeout(() => { for (const n of g.nodes) { try { n.stop(); } catch (e) {} } try { g.tape.analyser.disconnect(); g.tape.wowLfo.stop(); g.tape.flutter.stop(); g.tape.hissSrc.stop(); } catch (e) {} }, 120);
    }
    this.playing = false;
    this.onstate('stopped');
  }
  // one slice from the deck, now (pad press)
  audition(fromSrc, len, opts = {}) {
    const ctx = this.ensure();
    const g = this.live || this._aud || (this._aud = (() => { const gg = this.buildGraph(ctx, ctx.destination); this.applyMix(gg); return gg; })());
    this.playRegion(g, ctx.currentTime + 0.02, fromSrc, len, { slow: this.params.slow, ...opts });
  }
  // ---- offline render in ~32 s source-time windows, crossfaded ----
  // opts.from / opts.to clip the render to a source-time range; opts.solo = 'src' | 'kit' mutes the
  // other side (used by the mix gate in tests, never by the UI).
  async render(onProgress, opts = {}) {
    const slow = this.params.slow, sr = SR;
    const src = this.source, arr = this.arr;
    const from = Math.max(0, opts.from || 0), total = Math.min(src.duration, opts.to ?? src.duration);
    const win = 32, overlap = Math.max(1.5, arr.beatSec * 4);
    const windows = [];
    for (let a = from; a < total; a += win) windows.push([a, Math.min(total, a + win + overlap)]);
    const outLen = Math.ceil(((total - from) / slow + 1.5) * sr);
    const out = new AudioBuffer({ numberOfChannels: 2, length: outLen, sampleRate: sr });
    const L = out.getChannelData(0), R = out.getChannelData(1);
    for (let w = 0; w < windows.length; w++) {
      const [a, b] = windows[w];
      const isLast = w === windows.length - 1;
      const lenCtx = (b - a) / slow + (isLast ? 1.5 : 0.3);
      const off = new OfflineAudioContext(2, Math.ceil(lenCtx * sr), sr);
      const g = this.buildGraph(off, off.destination);
      this.applyMix(g); g.tape.roll(true);
      if (opts.solo === 'src') g.kit.gain.value = 0; else if (opts.solo === 'kit') g.srcBus.gain.value = 0;
      const T = (ts) => 0.02 + (ts - a) / slow;
      // bars that overlap the window, clipped to it; a bar that began before `a` is clipped at `a`
      const firstBar = arr.bars.find((bb) => bb.end > a);
      const winFrom = Math.min(a, firstBar ? firstBar.start : a);
      this.scheduleWindow(g, T, winFrom, b, a, b);
      const buf = await off.startRendering();
      const bl = buf.getChannelData(0), br = buf.getChannelData(1);
      const startSample = Math.floor(((a - from) / slow) * sr);
      const fadeIn = w === 0 ? 0 : Math.floor(Math.min(overlap / slow, 1.0) * sr);
      for (let i = 0; i < bl.length; i++) {
        const o = startSample + i; if (o >= outLen) break;
        if (fadeIn && i < fadeIn) { const gIn = i / fadeIn; L[o] = L[o] * (1 - gIn) + bl[i] * gIn; R[o] = R[o] * (1 - gIn) + br[i] * gIn; }
        else { L[o] = bl[i]; R[o] = br[i]; }
      }
      onProgress && onProgress((w + 1) / windows.length);
    }
    return out;
  }
}

function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
