// NOISE — sound engine. Every instrument here is synthesized: no samples ship with the app.
// Devices are constructed against any BaseAudioContext so the same code renders live and offline.

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// ---------- shared resources (cached per context) ----------
const noiseCache = new WeakMap();
export function noiseBuffer(ctx, seconds = 2) {
  let buf = noiseCache.get(ctx);
  if (buf) return buf;
  const len = Math.floor(ctx.sampleRate * seconds);
  buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

const irCache = new WeakMap();
export function reverbIR(ctx, seconds = 2.6, key = 'nave') {
  let map = irCache.get(ctx);
  if (!map) { map = new Map(); irCache.set(ctx, map); }
  if (map.has(key)) return map.get(key);
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // early reflections dense, then exponential tail; slight stereo decorrelation
      const env = Math.pow(1 - t, 2.4) * (i < ctx.sampleRate * 0.03 ? 0.6 : 1);
      d[i] = (Math.random() * 2 - 1) * env * (c ? 0.92 : 1);
    }
  }
  map.set(key, buf);
  return buf;
}

const curveCache = new Map();
export function driveCurve(amount) {
  const k = 'd' + amount.toFixed(3);
  if (curveCache.has(k)) return curveCache.get(k);
  const n = 2048, c = new Float32Array(n);
  const a = 1 + amount * 40;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * a) / Math.tanh(a);
  }
  curveCache.set(k, c);
  return c;
}
// hard clipper with a small knee; threshold 0.5..1
export function clipCurve(th) {
  const k = 'h' + th.toFixed(3);
  if (curveCache.has(k)) return curveCache.get(k);
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = a <= th ? x : Math.sign(x) * (th + (1 - th) * Math.tanh((a - th) / (1 - th) * 2.5) / Math.tanh(2.5));
  }
  curveCache.set(k, c);
  return c;
}
// gentle tape curve: unity slope at zero, soft knee toward ±1; amount 0 is a straight line
export function tapeCurve(amount) {
  const k = 't' + amount.toFixed(3);
  if (curveCache.has(k)) return curveCache.get(k);
  const n = 2048, c = new Float32Array(n);
  const a = 0.6 + amount * 2.4;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = amount < 0.005 ? x : Math.tanh(x * a) / Math.tanh(a) * (1 - amount * 0.15) + x * amount * 0.15;
  }
  curveCache.set(k, c);
  return c;
}
export function crushCurve(levels) {
  const k = 'c' + Math.round(levels);
  if (curveCache.has(k)) return curveCache.get(k);
  const n = 4096, c = new Float32Array(n);
  const step = 2 / Math.max(2, levels);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.round(x / step) * step;
  }
  curveCache.set(k, c);
  return c;
}

function env(param, t, peak, attack, decay, floor = 0.0001) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(floor, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(floor, t + attack + decay);
}

function noiseSource(ctx, t, dur) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  s.loop = true;
  s.start(t, Math.random() * 1.5);
  s.stop(t + dur + 0.05);
  return s;
}

// ---------- base ----------
class Device {
  constructor(ctx, dest, def, engine) {
    this.ctx = ctx;
    this.engine = engine;
    this.def = def;
    this.params = { ...def.params };
    this.out = ctx.createGain();
    this.level = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.2;
    this.out.connect(this.level);
    this.level.connect(this.analyser);
    this.analyser.connect(dest);
    this.level.gain.value = def.muted ? 0 : (this.params.level ?? 0.8);
    this.active = new Set();
    this.scopeData = new Uint8Array(this.analyser.fftSize);
  }
  scope() { this.analyser.getByteTimeDomainData(this.scopeData); return this.scopeData; }
  ratio() { return this.engine ? this.engine.pitchRatio : 1; }
  set(name, value) {
    this.params[name] = value;
    if (name === 'level') this.level.gain.setTargetAtTime(this.def.muted ? 0 : value, this.ctx.currentTime, 0.02);
    this.onParam?.(name, value);
  }
  setMuted(m) {
    this.def.muted = m;
    this.level.gain.setTargetAtTime(m ? 0 : (this.params.level ?? 0.8), this.ctx.currentTime, 0.02);
  }
  track(node, until) {
    this.active.add(node);
    node.onended = () => this.active.delete(node);
  }
  stopAll(t = this.ctx.currentTime) {
    for (const n of this.active) { try { n.stop(t + 0.02); } catch (e) { /* already stopped */ } }
    this.active.clear();
  }
  dispose() { this.stopAll(); try { this.analyser.disconnect(); } catch (e) {} }
}

// ---------- TRUNK (class Hearse) : the 808 that slides and distorts ----------
export class Hearse extends Device {
  constructor(ctx, dest, def, engine) {
    super(ctx, dest, def, engine);
    // pre-gain -> tanh drive -> hard clip -> tone: the phonk 808 is distorted, not polite
    this.pre = ctx.createGain();
    this.pre.gain.value = 1 + this.params.coffin * 3;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = driveCurve(this.params.coffin);
    this.shaper.oversample = '4x';
    this.clip = ctx.createWaveShaper();
    this.clip.curve = clipCurve(0.85 - this.params.coffin * 0.25);
    this.clip.oversample = '2x';
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = this.params.tone;
    this.lp.Q.value = 1.1;
    this.post = ctx.createGain();
    this.post.gain.value = 1 / (1 + this.params.coffin * 0.8);
    this.pre.connect(this.shaper);
    this.shaper.connect(this.clip);
    this.clip.connect(this.lp);
    this.lp.connect(this.post);
    this.post.connect(this.out);
    this.voice = null;
  }
  onParam(n, v) {
    if (n === 'coffin') {
      this.pre.gain.setTargetAtTime(1 + v * 3, this.ctx.currentTime, 0.02);
      this.shaper.curve = driveCurve(v);
      this.clip.curve = clipCurve(0.85 - v * 0.25);
      this.post.gain.setTargetAtTime(1 / (1 + v * 0.8), this.ctx.currentTime, 0.02);
    }
    if (n === 'tone') this.lp.frequency.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
  // 808 envelope: 4ms attack, natural decay toward a sustain floor, then hold until the note ends
  // and release. The note's length is musical (durSec), so a long note keeps the room shaking.
  shape(gainParam, t, vel, durSec) {
    const p = this.params;
    const floor = 0.42 * vel, tau = Math.max(0.05, p.decay * 0.55);
    const hold = Math.max(0.06, durSec);
    gainParam.cancelScheduledValues(t);
    gainParam.setValueAtTime(Math.max(0.0001, gainParam.value), t);
    gainParam.linearRampToValueAtTime(vel, t + 0.004);
    gainParam.setTargetAtTime(floor, t + 0.004, tau);
    const atEnd = floor + (vel - floor) * Math.exp(-(hold - 0.004) / tau);
    gainParam.setValueAtTime(atEnd, t + hold);
    gainParam.exponentialRampToValueAtTime(0.0001, t + hold + 0.09);
    return t + hold + 0.1;
  }
  noteOn(t, midi, vel = 1, durSec = 0.5, opts = {}) {
    const ctx = this.ctx;
    const f = midiToHz(midi) * this.ratio();
    const p = this.params;
    this.lastMidi = midi;
    if (opts.slide && this.voice && this.voice.until > t) {
      const v = this.voice;
      const glide = Math.max(0.02, p.glide);
      for (const o of v.oscs) {
        o.osc.frequency.cancelScheduledValues(t);
        o.osc.frequency.setValueAtTime(o.osc.frequency.value, t);
        o.osc.frequency.exponentialRampToValueAtTime(f * o.mult, t + glide);
      }
      const until = this.shape(v.gain.gain, t, 0.95 * vel, durSec);
      for (const o of v.oscs) o.osc.stop(until);
      v.until = until;
      return;
    }
    if (this.voice && this.voice.until > t) {
      const v = this.voice;
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0.0001, t + 0.008);
      for (const o of v.oscs) o.osc.stop(t + 0.01);
    }
    const gain = ctx.createGain();
    const oscs = [];
    const mk = (type, mult, g) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      const og = ctx.createGain();
      og.gain.value = g;
      osc.connect(og);
      og.connect(gain);
      // pitch snap: the 808 "click" comes from a fast pitch drop
      osc.frequency.setValueAtTime(f * mult * 2.6, t);
      osc.frequency.exponentialRampToValueAtTime(f * mult, t + 0.035);
      osc.start(t);
      oscs.push({ osc, mult });
      this.track(osc);
      return osc;
    };
    mk('sine', 1, 1);
    mk('triangle', 1, 0.25);
    if (p.rumble > 0.01) mk('sine', 0.5, p.rumble * 0.8);
    gain.gain.value = 0.0001;
    const until = this.shape(gain.gain, t, vel, durSec);
    gain.connect(this.pre);
    for (const o of oscs) o.osc.stop(until);
    this.voice = { oscs, gain, until };
  }
}

// ---------- LAZERBELL (class Cathedral) : the cowbell hook ----------
export class Cathedral extends Device {
  constructor(ctx, dest, def, engine) {
    super(ctx, dest, def, engine);
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.conv = ctx.createConvolver();
    this.conv.buffer = reverbIR(ctx, 2.8, 'nave');
    this.dry.connect(this.out);
    this.wet.connect(this.conv);
    this.conv.connect(this.out);
    this.dry.gain.value = 1;
    this.wet.gain.value = this.params.nave;
    this.grit = ctx.createWaveShaper();
    this.grit.curve = driveCurve((this.params.grit ?? 0) * 0.7);
    this.grit.oversample = '2x';
    this.gritGain = ctx.createGain();
    this.gritGain.gain.value = 1 + (this.params.grit ?? 0) * 1.5;
    this.pre = ctx.createGain();
    this.pre.connect(this.gritGain);
    this.gritGain.connect(this.grit);
    this.grit.connect(this.dry);
    this.grit.connect(this.wet);
  }
  onParam(n, v) {
    if (n === 'nave') this.wet.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
    if (n === 'grit') { this.grit.curve = driveCurve(v * 0.7); this.gritGain.gain.setTargetAtTime(1 + v * 1.5, this.ctx.currentTime, 0.02); }
  }
  noteOn(t, midi, vel = 1, durSec = 0.25) {
    const ctx = this.ctx, p = this.params;
    const f = midiToHz(midi) * this.ratio();
    this.rung = (this.rung || 0) + 1;
    const g = ctx.createGain();
    // the cowbell is two pulse waves at a fixed non-integer ratio through a bandpass
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = clamp(f * 3.2, 300, 9000);
    bp.Q.value = 1.6;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = clamp(f * 0.9, 100, 4000);
    g.connect(bp); bp.connect(hp); hp.connect(this.pre);
    const voices = 1 + Math.round(p.choir * 2);
    for (let v = 0; v < voices; v++) {
      const det = voices > 1 ? (v - (voices - 1) / 2) * p.choir * 14 : 0; // cents
      const mults = [1, p.bell];
      for (const m of mults) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f * m;
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 0.35 / voices;
        o.connect(og); og.connect(g);
        o.start(t);
        o.stop(t + p.decay + 0.1);
        this.track(o);
      }
    }
    const peak = 0.9 * vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(peak * 0.35, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + p.decay);
  }
}

// ---------- TALKBOX (class Preacher) : formant chants ----------
const VOWELS = [
  { f: [800, 1150, 2900], g: [1, 0.5, 0.25], q: [8, 10, 12] },   // A
  { f: [400, 1600, 2700], g: [1, 0.35, 0.2], q: [9, 10, 12] },   // E
  { f: [350, 1700, 2700], g: [1, 0.25, 0.2], q: [10, 10, 12] },  // I
  { f: [450, 800, 2830], g: [1, 0.6, 0.15], q: [8, 8, 12] },     // O
  { f: [325, 700, 2530], g: [1, 0.4, 0.1], q: [8, 8, 12] },      // U
];
export const VOWEL_NAMES = ['AH', 'EH', 'EE', 'OH', 'OO'];
export function vowelAt(x) {
  const i = Math.floor(clamp(x, 0, 3.999));
  const t = x - i;
  const a = VOWELS[i], b = VOWELS[Math.min(4, i + 1)];
  return {
    f: a.f.map((v, k) => lerp(v, b.f[k], t)),
    g: a.g.map((v, k) => lerp(v, b.g[k], t)),
    q: a.q.map((v, k) => lerp(v, b.q[k], t)),
  };
}
export class Preacher extends Device {
  constructor(ctx, dest, def, engine) {
    super(ctx, dest, def, engine);
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = driveCurve(this.params.grit * 0.6);
    this.shaper.oversample = '2x';
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 6500;
    this.shaper.connect(this.lp);
    this.lp.connect(this.out);
  }
  onParam(n, v) {
    if (n === 'grit') this.shaper.curve = driveCurve(v * 0.6);
  }
  noteOn(t, midi, vel = 1, durSec = 0.25) {
    const ctx = this.ctx, p = this.params;
    const f = midiToHz(midi + p.octave * 12) * this.ratio();
    const vw = vowelAt(p.vowel);
    const g = ctx.createGain();
    g.connect(this.shaper);
    const src = ctx.createGain();
    const oscs = [['sawtooth', 0, 0.5], ['sawtooth', 9, 0.4], ['square', -7, 0.18]];
    for (const [type, det, amp] of oscs) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og); og.connect(src);
      o.start(t);
      o.stop(t + durSec + 0.3);
      this.track(o);
    }
    for (let k = 0; k < 3; k++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = vw.f[k];
      bp.Q.value = vw.q[k] * (0.6 + p.throat * 0.8);
      const fg = ctx.createGain();
      fg.gain.value = vw.g[k] * 1.3;
      src.connect(bp); bp.connect(fg); fg.connect(g);
      // a little "sermon" wobble on the formants
      if (p.sermon > 0.01) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5.5;
        const lg = ctx.createGain();
        lg.gain.value = vw.f[k] * 0.06 * p.sermon;
        lfo.connect(lg); lg.connect(bp.frequency);
        lfo.start(t); lfo.stop(t + durSec + 0.3);
      }
    }
    const peak = 0.8 * vel;
    const hold = Math.max(0.03, durSec);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.006);
    g.gain.setValueAtTime(peak, t + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + hold + 0.06 + p.tail * 0.6);
  }
}

// ---------- V12 (class Breaker) : the drum machine ----------
export const BREAKER_LANES = ['KICK', 'SNARE', 'CLAP', 'HAT', 'OPEN HAT', 'RIM', 'TOM', 'CRASH'];
export class Breaker extends Device {
  constructor(ctx, dest, def, engine) {
    super(ctx, dest, def, engine);
    this.crush = ctx.createWaveShaper();
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.12;
    this.crush.connect(this.lp);
    this.lp.connect(this.comp);
    this.comp.connect(this.out);
    this.applyMemphis(this.params.memphis);
  }
  applyMemphis(v) {
    const levels = Math.round(lerp(4096, 18, Math.pow(v, 1.6)));
    this.crush.curve = v < 0.02 ? null : crushCurve(levels);
    this.lp.frequency.setTargetAtTime(lerp(16000, 3800, v), this.ctx.currentTime, 0.02);
  }
  onParam(n, v) { if (n === 'memphis') this.applyMemphis(v); }
  laneTune(i) { return Math.pow(2, ((this.params.tune?.[i] ?? 0) / 12)) * this.ratio(); }
  hit(t, lane, vel = 1) {
    const ctx = this.ctx, p = this.params, out = this.crush;
    const tune = this.laneTune(lane);
    const dec = p.decay;
    switch (lane) {
      case 0: { // KICK
        const o = ctx.createOscillator(); o.type = 'sine';
        const g = ctx.createGain();
        o.frequency.setValueAtTime(190 * tune, t);
        o.frequency.exponentialRampToValueAtTime(46 * tune, t + 0.04);
        env(g.gain, t, 1.5 * vel, 0.0015, 0.24 * dec + 0.06);
        const sh = ctx.createWaveShaper(); sh.curve = driveCurve(0.3);
        o.connect(g); g.connect(sh); sh.connect(out);
        o.start(t); o.stop(t + 0.5 * dec + 0.2); this.track(o);
        const n = noiseSource(ctx, t, 0.01);
        const ng = ctx.createGain(); env(ng.gain, t, 0.5 * vel, 0.001, 0.009);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
        n.connect(hp); hp.connect(ng); ng.connect(out); this.track(n);
        break;
      }
      case 1: { // SNARE
        const o = ctx.createOscillator(); o.type = 'triangle';
        o.frequency.setValueAtTime(240 * tune, t);
        o.frequency.exponentialRampToValueAtTime(170 * tune, t + 0.04);
        const g = ctx.createGain(); env(g.gain, t, 0.6 * vel, 0.001, 0.09 * dec + 0.02);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.3); this.track(o);
        const n = noiseSource(ctx, t, 0.3);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900 * tune; bp.Q.value = 0.8;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
        const ng = ctx.createGain(); env(ng.gain, t, 0.9 * vel, 0.001, 0.19 * dec + 0.03);
        n.connect(bp); bp.connect(hp); hp.connect(ng); ng.connect(out); this.track(n);
        break;
      }
      case 2: { // CLAP
        const n = noiseSource(ctx, t, 0.45);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1150 * tune; bp.Q.value = 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        for (let k = 0; k < 4; k++) {
          const tk = t + k * 0.011;
          g.gain.setValueAtTime(0.9 * vel, tk);
          g.gain.exponentialRampToValueAtTime(0.15 * vel, tk + 0.01);
        }
        g.gain.setValueAtTime(0.7 * vel, t + 0.044);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.044 + 0.2 * dec + 0.05);
        n.connect(bp); bp.connect(g); g.connect(out); this.track(n);
        break;
      }
      case 3: case 4: { // HAT / OPEN HAT — six square oscillators, the classic recipe
        const open = lane === 4;
        const ratios = [263, 400, 421, 474, 587, 845];
        const mix = ctx.createGain(); mix.gain.value = 0.16;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 9500 * Math.sqrt(tune); bp.Q.value = 1.1;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6800;
        const g = ctx.createGain();
        const d = open ? 0.32 * dec + 0.1 : 0.045 * dec + 0.015;
        env(g.gain, t, 0.85 * vel, 0.001, d);
        mix.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out);
        for (const r of ratios) {
          const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = r * tune;
          o.connect(mix); o.start(t); o.stop(t + d + 0.05); this.track(o);
        }
        break;
      }
      case 5: { // RIM
        const g = ctx.createGain(); env(g.gain, t, 0.8 * vel, 0.001, 0.03 * dec + 0.01);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
        g.connect(hp); hp.connect(out);
        for (const [f, type] of [[1760, 'triangle'], [440, 'square']]) {
          const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * tune;
          const og = ctx.createGain(); og.gain.value = type === 'square' ? 0.4 : 0.7;
          o.connect(og); og.connect(g); o.start(t); o.stop(t + 0.1); this.track(o);
        }
        break;
      }
      case 6: { // TOM
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(190 * tune, t);
        o.frequency.exponentialRampToValueAtTime(95 * tune, t + 0.12);
        const g = ctx.createGain(); env(g.gain, t, 0.9 * vel, 0.002, 0.3 * dec + 0.05);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.6); this.track(o);
        const n = noiseSource(ctx, t, 0.05);
        const ng = ctx.createGain(); env(ng.gain, t, 0.2 * vel, 0.001, 0.03);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200;
        n.connect(bp); bp.connect(ng); ng.connect(out); this.track(n);
        break;
      }
      case 7: { // CRASH
        const n = noiseSource(ctx, t, 1.6);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3200 * tune;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 7000 * tune; bp.Q.value = 0.4;
        const g = ctx.createGain(); env(g.gain, t, 0.55 * vel, 0.004, 1.1 * dec + 0.3);
        n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out); this.track(n);
        const mix = ctx.createGain(); mix.gain.value = 0.08;
        for (const r of [263, 400, 474, 845, 1290]) {
          const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = r * 1.9 * tune;
          o.connect(mix); o.start(t); o.stop(t + 1.5); this.track(o);
        }
        const mg = ctx.createGain(); env(mg.gain, t, 0.5 * vel, 0.002, 0.9 * dec + 0.2);
        mix.connect(hp); // shares the highpass
        break;
      }
    }
  }
}

// ---------- TAPE DECK (class Carousel) : the slice player ----------
export class Carousel extends Device {
  constructor(ctx, dest, def, engine) {
    super(ctx, dest, def, engine);
    this.source = null; // AudioBuffer
    this.slices = [];   // [{start, end, name}]
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = this.params.tape;
    this.lp.Q.value = 0.7;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = driveCurve(0.08);
    this.lp.connect(this.shaper);
    this.shaper.connect(this.out);
    this.current = null;
  }
  onParam(n, v) {
    if (n === 'tape') this.lp.frequency.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
  setAudio(buffer, slices) {
    this.source = buffer;
    this.slices = slices.map((s) => ({ ...s }));
  }
  sliceDuration(i) {
    const s = this.slices[i];
    return s ? (s.end - s.start) : 0;
  }
  noteOn(t, sliceIndex, vel = 1, durSec = null, opts = {}) {
    if (!this.source || !this.slices.length) return;
    const ctx = this.ctx, p = this.params;
    const s = this.slices[((sliceIndex % this.slices.length) + this.slices.length) % this.slices.length];
    const rate = Math.pow(2, p.pitch / 12) * this.ratio();
    const src = ctx.createBufferSource();
    src.buffer = (opts.reverse && opts.reverseBuffer) ? opts.reverseBuffer : this.source;
    src.playbackRate.value = rate;
    if (p.wobble > 0.01) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.9 + p.wobble * 3;
      const lg = ctx.createGain();
      lg.gain.value = 0.05 * p.wobble * rate;
      lfo.connect(lg); lg.connect(src.playbackRate);
      lfo.start(t); lfo.stop(t + 6);
    }
    const g = ctx.createGain();
    src.connect(g); g.connect(this.lp);
    const sliceLen = (s.end - s.start) / rate;
    const gateLen = durSec != null ? Math.min(durSec, sliceLen) : sliceLen;
    const len = Math.max(0.02, gateLen * p.gate);
    if (this.current && this.current.until > t) {
      // monophonic like a tone arm: previous slice fades out fast
      this.current.g.gain.cancelScheduledValues(t);
      this.current.g.gain.setValueAtTime(this.current.g.gain.value, t);
      this.current.g.gain.linearRampToValueAtTime(0.0001, t + 0.006);
      try { this.current.src.stop(t + 0.01); } catch (e) {}
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.003);
    g.gain.setValueAtTime(vel, t + len);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.012);
    if (opts.reverse && opts.reverseBuffer) {
      const dur = this.source.duration;
      src.start(t, dur - s.end, (s.end - s.start));
    } else {
      src.start(t, s.start, (s.end - s.start));
    }
    src.stop(t + len + 0.03);
    this.track(src);
    this.current = { src, g, until: t + len + 0.03 };
  }
}

// ---------- EXHAUST (class Screwtape) : master tape stage ----------
export class Screwtape {
  constructor(ctx, dest, params) {
    this.ctx = ctx;
    this.params = { ...params };
    this.input = ctx.createGain();
    this.input.gain.value = 0.32; // five devices sum here; trim before tape
    this.sat = ctx.createWaveShaper();
    this.sat.oversample = '2x';
    this.sat.curve = tapeCurve(this.params.saturation);
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = this.params.tone;
    this.tone.Q.value = 0.5;
    this.delay = ctx.createDelay(0.1);
    this.delay.delayTime.value = 0.02;
    this.wowLfo = ctx.createOscillator();
    this.wowLfo.frequency.value = 0.7;
    this.wowGain = ctx.createGain();
    this.wowGain.gain.value = this.params.wow * 0.0045;
    this.wowLfo.connect(this.wowGain);
    this.wowGain.connect(this.delay.delayTime);
    this.wowLfo.start();
    this.flutter = ctx.createOscillator();
    this.flutter.frequency.value = 9.3;
    this.flutterGain = ctx.createGain();
    this.flutterGain.gain.value = this.params.wow * 0.0005;
    this.flutter.connect(this.flutterGain);
    this.flutterGain.connect(this.delay.delayTime);
    this.flutter.start();
    this.hissSrc = ctx.createBufferSource();
    this.hissSrc.buffer = noiseBuffer(ctx);
    this.hissSrc.loop = true;
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'bandpass';
    this.hissFilter.frequency.value = 6000;
    this.hissFilter.Q.value = 0.4;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = this.params.hiss * 0.012;
    this.hissSrc.connect(this.hissFilter);
    this.hissFilter.connect(this.hissGain);
    this.hissSrc.start();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 2.4;
    this.comp.attack.value = 0.022; // let the kick's first 20ms through untouched
    this.comp.release.value = 0.22;
    this.master = ctx.createGain();
    this.master.gain.value = this.params.level;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.08;

    this.input.connect(this.sat);
    this.sat.connect(this.tone);
    this.tone.connect(this.delay);
    this.delay.connect(this.comp);
    this.hissGain.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(dest);
    this.meterData = new Uint8Array(this.analyser.fftSize);
  }
  set(name, v) {
    this.params[name] = v;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'saturation': this.sat.curve = tapeCurve(v); break;
      case 'tone': this.tone.frequency.setTargetAtTime(v, t, 0.03); break;
      case 'wow':
        this.wowGain.gain.setTargetAtTime(v * 0.0045, t, 0.05);
        this.flutterGain.gain.setTargetAtTime(v * 0.0005, t, 0.05);
        break;
      case 'hiss': this.hissGain.gain.setTargetAtTime(v * 0.012, t, 0.05); break;
      case 'level': this.master.gain.setTargetAtTime(v, t, 0.02); break;
    }
  }
  setHissAudible(on) {
    this.hissGain.gain.setTargetAtTime(on ? this.params.hiss * 0.012 : 0, this.ctx.currentTime, 0.2);
  }
  meter() {
    this.analyser.getByteTimeDomainData(this.meterData);
    let peak = 0, sum = 0;
    for (let i = 0; i < this.meterData.length; i++) {
      const v = (this.meterData[i] - 128) / 128;
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
    return { peak, rms: Math.sqrt(sum / this.meterData.length) };
  }
}

// ---------- UI sounds: the coin drop ----------
export function coinDrop(ctx, dest, t = ctx.currentTime) {
  // ignition: starter whine rising, the engine catching (three low pulses), then a sub thump as the dash lights
  const g = ctx.createGain();
  g.connect(dest);
  g.gain.value = 0.7;
  const st = ctx.createOscillator(); st.type = 'sawtooth';
  st.frequency.setValueAtTime(140, t); st.frequency.exponentialRampToValueAtTime(520, t + 0.42);
  const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.setValueAtTime(600, t); sf.frequency.exponentialRampToValueAtTime(2600, t + 0.42); sf.Q.value = 4;
  const sg = ctx.createGain(); env(sg.gain, t, 0.22, 0.01, 0.46);
  st.connect(sf); sf.connect(sg); sg.connect(g); st.start(t); st.stop(t + 0.5);
  for (let i = 0; i < 3; i++) {
    const tt = t + 0.34 + i * 0.09;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(95 - i * 8, tt); o.frequency.exponentialRampToValueAtTime(45, tt + 0.12);
    const og = ctx.createGain(); env(og.gain, tt, 0.3, 0.002, 0.12);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    o.connect(lp); lp.connect(og); og.connect(g); o.start(tt); o.stop(tt + 0.2);
  }
  const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(70, t + 0.6); sub.frequency.exponentialRampToValueAtTime(38, t + 1.0);
  const subg = ctx.createGain(); env(subg.gain, t + 0.6, 0.7, 0.004, 0.55);
  sub.connect(subg); subg.connect(g); sub.start(t + 0.6); sub.stop(t + 1.3);
  const n = noiseSource(ctx, t + 0.6, 0.05);
  const ng = ctx.createGain(); env(ng.gain, t + 0.6, 0.18, 0.001, 0.04);
  const bp = ctx.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = 3000;
  n.connect(bp); bp.connect(ng); ng.connect(g);
}

export function relayClick(ctx, dest, t = ctx.currentTime) {
  const n = noiseSource(ctx, t, 0.03);
  const g = ctx.createGain(); env(g.gain, t, 0.35, 0.001, 0.02);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 3;
  n.connect(bp); bp.connect(g); g.connect(dest);
}
