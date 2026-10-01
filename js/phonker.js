// NOISE — the phonker. Given a source buffer and its analysis, build a phonk arrangement and
// play it (live) or render it (offline). One function decides everything; the sliders only
// adjust its inputs, so live tweaks and the export always agree.

import { Bass808, Drums, Cowbell, Tape, midiToHz, clamp } from './kit.js';

export const PRESETS = {
  drift:     { name: 'DRIFT',     slow: 0.86, bass: 0.9,  bell: 0.75, grit: 0.55, flip: 0.15, swing: 0.02 },
  memphis:   { name: 'MEMPHIS',   slow: 0.90, bass: 0.8,  bell: 0.95, grit: 0.8,  flip: 0.35, swing: 0.08 },
  brazilian: { name: 'BRAZILIAN', slow: 0.96, bass: 1.0,  bell: 0.6,  grit: 0.7,  flip: 0.1,  swing: 0.0 },
};
export const DEFAULTS = { ...PRESETS.drift };

// ---------- arrangement ----------
// Returns { bpm, stepSec, bars, events: [{t, kind, ...}], sourcePlan } in SOURCE-TIME seconds
// (before the slow factor); the player stretches time by 1/slow when scheduling.
export function arrange(analysis, params, seed = 7) {
  const rnd = mulberry(seed);
  const { beats, downbeats, key, chroma, beatLoud } = analysis;
  if (!beats || beats.length < 8) return null;
  const beatSec = 60 / analysis.bpm;
  // phonk is written in half-time: the song's beat becomes our 8th; two song beats = one phonk beat
  const phaseIdx = analysis.phase || 0;
  const firstDown = beats[phaseIdx] ?? beats[0];
  const bars = [];
  for (let i = phaseIdx; i + 3 < beats.length; i += 4) bars.push({ start: beats[i], beats: beats.slice(i, i + 4), idx: bars.length });
  if (!bars.length) return null;
  // energy arc of the source, per bar (0..1), smoothed; we drop where the song drops
  const barLoud = bars.map((b, i) => { const a = beatLoud.slice(i * 4 + phaseIdx, i * 4 + phaseIdx + 4); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; });
  const root = key.root; // pitch class
  const minor = key.mode === 'minor';
  // bass note choices that agree with the song: root, 5th, b7/6, b2 if present in chroma
  const degree = (semis) => (root + semis) % 12;
  const weights = [[0, 1.0], [7, 0.55], [minor ? 10 : 9, 0.35], [minor ? 3 : 4, 0.3], [5, 0.25], [1, chroma[degree(1)] > 0.5 ? 0.3 : 0.08]];
  const pick = () => { let tot = 0; for (const [, w] of weights) tot += w; let r = rnd() * tot; for (const [d, w] of weights) { r -= w; if (r <= 0) return d; } return 0; };
  const bassLow = 24 + root; // C1 = 24
  const bellBase = 60 + root; // C4 = 60

  const events = [];
  const flip = params.flip;
  const E = (t, kind, extra) => events.push({ t, kind, ...extra });

  // Section logic: first bar(s) are an intro if the song itself is quiet there; drums enter at the
  // first bar whose loudness exceeds 45% of max, or bar 2, whichever is sooner.
  let dropBar = bars.findIndex((b, i) => barLoud[i] > 0.45);
  if (dropBar < 0 || dropBar > 4) dropBar = Math.min(2, bars.length - 1);

  for (const bar of bars) {
    const i = bar.idx;
    const b = bar.beats; // 4 source beats
    const half = (k) => b[k] + (b[k + 1] !== undefined ? (b[k + 1] - b[k]) / 2 : beatSec / 2); // the 8th between beats
    const q = (k, f) => b[k] + beatSec * f; // fraction of a source beat after beat k
    const loud = barLoud[i];
    const inDrop = i >= dropBar;
    const fill = (i - dropBar) % 8 === 7; // every 8th bar is a turnaround
    const variation = rnd();
    // --- drums (half-time: kick on source beat 0, snare on source beat 2) ---
    if (inDrop) {
      E(b[0], 'kick', { v: 1 });
      if (variation < 0.6) E(q(1, 0.5), 'kick', { v: 0.9 }); else E(q(0, 0.75), 'kick', { v: 0.85 });
      if (variation > 0.3) E(q(2, 0.5), 'kick', { v: 0.9 });
      if (fill) E(q(3, 0.5), 'kick', { v: 0.8 });
      E(b[2], 'snare', { v: 1 }); E(b[2], 'clap', { v: 0.9 });
      if (fill) { E(q(3, 0.5), 'snare', { v: 0.7 }); E(q(3, 0.75), 'snare', { v: 0.5 }); }
      // hats: 8ths (every source beat and the halfway point), with 16th rolls on the turnaround
      for (let k = 0; k < 4; k++) { E(b[k], 'hat', { v: 0.85 }); E(half(k), 'hat', { v: 0.5 }); }
      if (fill || variation > 0.75) { E(q(3, 0.25), 'hat', { v: 0.45 }); E(q(3, 0.75), 'hat', { v: 0.55 }); }
      E(q(3, 0.5), 'ohat', { v: 0.7 });
      if (variation < 0.5) E(q(1, 0.25), 'rim', { v: 0.45 });
      if ((i - dropBar) % 8 === 0) E(b[0], 'crash', { v: 0.5 });
    } else {
      // intro: hats only, light
      for (let k = 0; k < 4; k++) E(b[k], 'hat', { v: 0.6 });
      if (i === dropBar - 1) { E(q(3, 0), 'snare', { v: 0.6 }); E(q(3, 0.5), 'snare', { v: 0.8 }); }
    }
    // --- 808: follows the kicks, root most of the time, slides on the second hit ---
    if (inDrop) {
      const d0 = pick(), d1 = pick();
      E(b[0], 'bass', { n: bassLow + (i % 4 === 3 ? d1 : 0), v: 1, dur: beatSec * 1.1 });
      if (variation < 0.6) E(q(1, 0.5), 'bass', { n: bassLow + d0, v: 0.95, dur: beatSec * 0.7, slide: true });
      else E(q(0, 0.75), 'bass', { n: bassLow + d0, v: 0.9, dur: beatSec * 0.9, slide: true });
      if (variation > 0.3) E(q(2, 0.5), 'bass', { n: bassLow, v: 0.95, dur: beatSec * 1.0, slide: d0 !== 0 });
      if (fill) E(q(3, 0.5), 'bass', { n: bassLow + 7, v: 0.9, dur: beatSec * 0.5, slide: true });
    } else if (i === dropBar - 1) {
      E(b[2], 'bass', { n: bassLow + 7, v: 0.8, dur: beatSec * 2, slide: false });
    }
    // --- cowbell hook: constant 8ths on a 2-bar motif in the song's key ---
    if (inDrop || i === dropBar - 1) {
      const motifA = [0, 0, 3, 0, 7, 3, 1, 0], motifB = [0, 0, 3, 0, 10, 7, 3, 1];
      const motif = (Math.floor((i - dropBar) / 2) % 2 === 0) ? motifA : motifB;
      const scaleFix = (d) => (!minor && d === 3) ? 4 : (!minor && d === 10) ? 11 : (!minor && d === 1) ? 2 : d;
      for (let k = 0; k < 8; k++) {
        const t = k % 2 === 0 ? b[k / 2] : half((k - 1) / 2);
        const deg = scaleFix(motif[k]);
        E(t, 'bell', { n: bellBase + deg + (i % 8 === 7 && k >= 6 ? 12 : 0), v: k % 2 === 0 ? 1 : 0.8 });
      }
    }
    // --- source treatment ---
    // duck under kicks; on turnarounds, stutter the source (repeat the first 8th); the FLIP amount
    // chooses between playing the bar straight and rebuilding it from its own beats.
    const chop = flip > 0.05 && rnd() < flip * 0.9;
    if (chop) {
      // pick a slice plan: which source beat plays on each of our 8 eighths
      const plan = [];
      for (let k = 0; k < 8; k++) {
        const r = rnd();
        const src = r < 0.5 ? Math.floor(k / 2) : r < 0.8 ? Math.floor(rnd() * 4) : 0;
        plan.push({ at: k % 2 === 0 ? b[k / 2] : half((k - 1) / 2), from: b[src], len: beatSec / 2, reverse: rnd() < flip * 0.25 });
      }
      bar.plan = plan;
    } else if (inDrop && fill && flip > 0.02) {
      bar.plan = [0, 1, 2, 3].map((k) => ({ at: b[k], from: b[0], len: beatSec / 2 * (k === 3 ? 0.5 : 1), reverse: false }));
      bar.plan.push({ at: half(3), from: b[0], len: beatSec / 4, reverse: false }, { at: q(3, 0.75), from: b[0], len: beatSec / 4, reverse: false });
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { bars, events, beatSec, root, minor, dropBar, firstDown, barLoud };
}

// ---------- player / renderer ----------
export class Phonker {
  constructor() {
    this.ctx = null; this.live = null; this.playing = false; this.params = { ...DEFAULTS };
    this.source = null; this.analysis = null; this.arr = null; this.onstate = () => {};
  }
  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  async decode(arrayBuffer) {
    const ctx = this.ensure();
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  }
  load(buffer, analysis) {
    this.stop();
    this.source = buffer; this.analysis = analysis;
    this.arr = arrange(analysis, this.params, this.seed = 7);
  }
  setParam(k, v) {
    this.params[k] = v;
    if (k === 'flip' || k === 'swing') { this.arr = arrange(this.analysis, this.params, this.seed); if (this.playing) this.restart(); return; }
    if (k === 'slow' && this.playing) { this.restart(); return; }
    if (this.live) this.applyMix(this.live);
  }
  setPreset(name) { Object.assign(this.params, PRESETS[name]); this.arr = arrange(this.analysis, this.params, this.seed); if (this.playing) this.restart(); }
  reroll() { this.seed = (this.seed * 7 + 3) % 1000; this.arr = arrange(this.analysis, this.params, this.seed); if (this.playing) this.restart(); }

  // build the graph on any context; returns the handles the scheduler needs
  buildGraph(ctx, dest) {
    const tape = new Tape(ctx, dest, { saturation: 0.55, tone: 9000, wow: 0.18, hiss: 0.3, level: 1 });
    const sum = ctx.createGain(); sum.gain.value = 0.42; sum.connect(tape.input);
    const srcBus = ctx.createGain(); srcBus.gain.value = 0.85;
    // source: lowpass to sit under the bass + duck gain driven by kicks
    const srcLp = ctx.createBiquadFilter(); srcLp.type = 'lowpass'; srcLp.frequency.value = 9000; srcLp.Q.value = 0.5;
    const srcHp = ctx.createBiquadFilter(); srcHp.type = 'highpass'; srcHp.frequency.value = 140; srcHp.Q.value = 0.8; // leave the sub to the 808
    const duck = ctx.createGain(); duck.gain.value = 1;
    srcBus.connect(srcHp); srcHp.connect(srcLp); srcLp.connect(duck); duck.connect(sum);
    const bass = new Bass808(ctx, sum, { drive: 0.6, tone: 1500, sub: 0.4, level: 0.9 });
    const drums = new Drums(ctx, sum, { memphis: 0.5, level: 0.95 });
    const bell = new Cowbell(ctx, sum, { stack: 0.55, grit: 0.5, hall: 0.28, level: 1.1 });
    return { ctx, dest, tape, sum, srcBus, srcHp, srcLp, duck, bass, drums, bell, nodes: new Set() };
  }
  applyMix(g) {
    const p = this.params;
    g.bass.set('level', 0.95 * p.bass); g.bass.set('drive', 0.3 + p.grit * 0.6);
    g.bell.set('level', 1.25 * p.bell); g.bell.set('grit', p.grit * 0.9);
    g.drums.set('memphis', 0.15 + p.grit * 0.6); g.drums.set('level', 1.1);
    g.tape.set('saturation', 0.3 + p.grit * 0.6); g.tape.set('tone', 18000 - p.grit * 6000); g.tape.set('hiss', p.grit * 0.5); g.tape.set('wow', 0.1 + (1 - p.slow) * 1.2);
    g.srcLp.frequency.value = 12000 - p.grit * 5000;
  }
  // Schedule everything from source time `fromSrc` onward, starting at context time `t0`.
  // Source time is stretched by 1/slow: everything plays slower and lower (tape-style).
  schedule(g, t0, fromSrc = 0, untilSrc = Infinity) {
    const { slow, swing } = this.params;
    const arr = this.arr, src = this.source;
    const T = (ts) => t0 + (ts - fromSrc) / slow; // source seconds -> context seconds
    const bars = arr.bars;
    const eighth = arr.beatSec / 2;
    const swingOf = (ts) => { const ph = ((ts - arr.firstDown) / eighth) % 2; return (Math.abs(ph - 1) < 0.25) ? swing * eighth : 0; };
    // --- source audio: either straight (per region) or sliced per bar plan ---
    const playSlice = (atSrc, fromSrcPos, lenSrc, reverse) => {
      const at = T(atSrc); if (at < g.ctx.currentTime - 0.05) return;
      const node = g.ctx.createBufferSource();
      node.buffer = reverse ? this.reversed() : src;
      node.playbackRate.value = slow;
      const env = g.ctx.createGain(); env.gain.setValueAtTime(0.0001, at); env.gain.linearRampToValueAtTime(1, at + 0.006);
      const durCtx = lenSrc / slow;
      env.gain.setValueAtTime(1, at + durCtx - 0.02); env.gain.linearRampToValueAtTime(0.0001, at + durCtx);
      node.connect(env); env.connect(g.srcBus);
      const offset = reverse ? Math.max(0, src.duration - (fromSrcPos + lenSrc)) : fromSrcPos;
      node.start(at, clamp(offset, 0, src.duration), lenSrc);
      g.nodes.add(node); node.onended = () => g.nodes.delete(node);
    };
    // straight regions: contiguous runs of bars without a plan
    let runStart = null;
    const flushRun = (endSrc) => {
      if (runStart == null) return;
      const s = Math.max(runStart, fromSrc), e = Math.min(endSrc, untilSrc);
      if (e > s) {
        const at = T(s);
        const node = g.ctx.createBufferSource(); node.buffer = src; node.playbackRate.value = slow;
        const env = g.ctx.createGain(); env.gain.setValueAtTime(0.0001, at); env.gain.linearRampToValueAtTime(1, at + 0.01);
        const durCtx = (e - s) / slow; env.gain.setValueAtTime(1, at + durCtx - 0.03); env.gain.linearRampToValueAtTime(0.0001, at + durCtx);
        node.connect(env); env.connect(g.srcBus); node.start(at, s, e - s);
        g.nodes.add(node); node.onended = () => g.nodes.delete(node);
      }
      runStart = null;
    };
    // the head of the song before the first bar plays straight
    runStart = 0;
    for (const bar of bars) {
      const barEnd = bars[bar.idx + 1]?.start ?? (bar.start + arr.beatSec * 4);
      if (barEnd < fromSrc || bar.start > untilSrc) { if (bar.plan) runStart = runStart == null ? null : runStart; continue; }
      if (bar.plan) {
        flushRun(bar.start);
        for (const sl of bar.plan) if (sl.at >= fromSrc - 0.01 && sl.at < untilSrc) playSlice(sl.at + swingOf(sl.at), sl.from, sl.len, sl.reverse);
        runStart = barEnd;
      } else if (runStart == null) runStart = bar.start;
    }
    flushRun(Math.min(src.duration, untilSrc));
    // --- kit events ---
    const bassOpts = { glide: 0.1 + (1 - slow) * 0.3, decay: 0.6 };
    for (const ev of arr.events) {
      if (ev.t < fromSrc - 0.01 || ev.t >= untilSrc) continue;
      const t = T(ev.t + swingOf(ev.t));
      if (t < g.ctx.currentTime - 0.02) continue;
      switch (ev.kind) {
        case 'kick': g.drums.hit(t, 'kick', ev.v);
          // duck the source under the kick
          g.duck.gain.setValueAtTime(1, t - 0.002); g.duck.gain.linearRampToValueAtTime(0.35, t + 0.008); g.duck.gain.setTargetAtTime(1, t + 0.05, 0.08);
          break;
        case 'snare': g.drums.hit(t, 'snare', ev.v); break;
        case 'clap': g.drums.hit(t, 'clap', ev.v); break;
        case 'hat': g.drums.hit(t, 'hat', ev.v); break;
        case 'ohat': g.drums.hit(t, 'ohat', ev.v); break;
        case 'rim': g.drums.hit(t, 'rim', ev.v); break;
        case 'crash': g.drums.hit(t, 'crash', ev.v); break;
        case 'bass': g.bass.note(t, ev.n, ev.v, Math.min(ev.dur, arr.beatSec * 0.95) / slow, { slide: ev.slide, ...bassOpts }); break;
        case 'bell': g.bell.note(t, ev.n, ev.v, 0.36 / slow * 0.9); break;
      }
    }
  }
  reversed() {
    if (this._rev && this._rev.src === this.source) return this._rev.buf;
    const s = this.source, ctx = this.ctx || new OfflineAudioContext(1, 1, s.sampleRate);
    const buf = (this.ctx || ctx).createBuffer(s.numberOfChannels, s.length, s.sampleRate);
    for (let c = 0; c < s.numberOfChannels; c++) { const a = s.getChannelData(c), b = buf.getChannelData(c); for (let i = 0, n = s.length; i < n; i++) b[i] = a[n - 1 - i]; }
    this._rev = { src: s, buf }; return buf;
  }
  // ---- live ----
  play(fromSrc = 0) {
    if (!this.source || !this.arr) return;
    const ctx = this.ensure();
    this.stop();
    const g = this.buildGraph(ctx, ctx.destination);
    this.applyMix(g); g.tape.roll(true);
    const t0 = ctx.currentTime + 0.08;
    this.live = g; this.liveT0 = t0; this.liveFrom = fromSrc; this.playing = true;
    this.schedule(g, t0, fromSrc);
    const total = (this.source.duration - fromSrc) / this.params.slow;
    this.endTimer = setTimeout(() => { if (this.playing) { this.stop(); this.onstate('ended'); } }, (total + 0.6) * 1000);
    this.onstate('playing');
  }
  position() { // source seconds now playing
    if (!this.playing || !this.live) return this._pausedAt || 0;
    return clamp(this.liveFrom + (this.live.ctx.currentTime - this.liveT0) * this.params.slow, 0, this.source?.duration || 0);
  }
  restart() { const pos = this.position(); this.play(pos); }
  stop() {
    clearTimeout(this.endTimer);
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
  // ---- offline render of the whole phonk version ----
  // Rendered in ~32-second windows (in source time) so no single OfflineAudioContext carries more
  // than a few hundred events; windows overlap by one bar and are crossfaded to hide the seam.
  async render(onProgress) {
    const slow = this.params.slow, sr = 44100;
    const src = this.source, arr = this.arr;
    const total = src.duration;
    const win = 32, overlap = Math.max(1.5, arr.beatSec * 4);
    const windows = [];
    for (let a = 0; a < total; a += win) windows.push([a, Math.min(total, a + win + overlap)]);
    const outLen = Math.ceil((total / slow + 1.5) * sr);
    const out = new AudioBuffer({ numberOfChannels: 2, length: outLen, sampleRate: sr });
    const L = out.getChannelData(0), R = out.getChannelData(1);
    const saved = this.ctx;
    for (let w = 0; w < windows.length; w++) {
      const [a, b] = windows[w];
      const isLast = w === windows.length - 1;
      const lenCtx = (b - a) / slow + (isLast ? 1.5 : 0.3);
      const off = new OfflineAudioContext(2, Math.ceil(lenCtx * sr), sr);
      const g = this.buildGraph(off, off.destination);
      this.applyMix(g); g.tape.roll(true);
      this.ctx = off; this._rev = null;
      // schedule only this window; events before `a` that are still sounding are dropped (their tails are in the previous window)
      this.schedule(g, 0.02, a, b);
      this.ctx = saved; this._rev = null;
      const buf = await off.startRendering();
      const bl = buf.getChannelData(0), br = buf.getChannelData(1);
      const startSample = Math.floor((a / slow) * sr);
      const fadeIn = w === 0 ? 0 : Math.floor(Math.min(overlap / slow, 1.0) * sr); // crossfade region at the start of this window
      for (let i = 0; i < bl.length; i++) {
        const o = startSample + i; if (o >= outLen) break;
        let gIn = 1;
        if (i < fadeIn) gIn = i / fadeIn;
        if (fadeIn && i < fadeIn) { L[o] = L[o] * (1 - gIn) + bl[i] * gIn; R[o] = R[o] * (1 - gIn) + br[i] * gIn; }
        else { L[o] = bl[i]; R[o] = br[i]; }
      }
      onProgress && onProgress((w + 1) / windows.length);
    }
    return out;
  }
}

function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
