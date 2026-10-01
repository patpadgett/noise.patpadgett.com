// NOISE — the phonk kit. Everything synthesized against any BaseAudioContext so the same code
// plays live and renders offline. No samples ship with the site.

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

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
export function reverbIR(ctx, seconds = 2.2) {
  if (irCache.has(ctx)) return irCache.get(ctx);
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (c ? 0.92 : 1); }
  }
  irCache.set(ctx, buf);
  return buf;
}
const curveCache = new Map();
export function driveCurve(amount) {
  const k = 'd' + amount.toFixed(3);
  if (curveCache.has(k)) return curveCache.get(k);
  const n = 2048, c = new Float32Array(n), a = 1 + amount * 40;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * a) / Math.tanh(a); }
  curveCache.set(k, c); return c;
}
export function clipCurve(th) {
  const k = 'h' + th.toFixed(3);
  if (curveCache.has(k)) return curveCache.get(k);
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    c[i] = a <= th ? x : Math.sign(x) * (th + (1 - th) * Math.tanh((a - th) / (1 - th) * 2.5) / Math.tanh(2.5));
  }
  curveCache.set(k, c); return c;
}
export function tapeCurve(amount) {
  const k = 't' + amount.toFixed(3);
  if (curveCache.has(k)) return curveCache.get(k);
  const n = 2048, c = new Float32Array(n), a = 0.6 + amount * 2.4;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = amount < 0.005 ? x : Math.tanh(x * a) / Math.tanh(a) * (1 - amount * 0.15) + x * amount * 0.15; }
  curveCache.set(k, c); return c;
}
export function crushCurve(levels) {
  const k = 'c' + Math.round(levels);
  if (curveCache.has(k)) return curveCache.get(k);
  const n = 4096, c = new Float32Array(n), step = 2 / Math.max(2, levels);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.round(x / step) * step; }
  curveCache.set(k, c); return c;
}
function env(param, t, peak, attack, decay, floor = 0.0001) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(floor, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(floor, t + attack + decay);
}
function noiseSource(ctx, t, dur) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx); s.loop = true;
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  return s;
}

// ---------- 808 ----------
// pre-gain -> tanh -> clip -> lowpass. Envelope decays to a sustain floor and holds for the note.
export class Bass808 {
  constructor(ctx, dest, { drive = 0.6, tone = 1500, sub = 0.4, level = 0.9 } = {}) {
    this.ctx = ctx; this.p = { drive, tone, sub, level };
    this.pre = ctx.createGain(); this.pre.gain.value = 1 + drive * 3;
    this.shaper = ctx.createWaveShaper(); this.shaper.curve = driveCurve(drive); this.shaper.oversample = '4x';
    this.clip = ctx.createWaveShaper(); this.clip.curve = clipCurve(0.85 - drive * 0.25); this.clip.oversample = '2x';
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = tone; this.lp.Q.value = 1.1;
    this.out = ctx.createGain(); this.out.gain.value = level / (1 + drive * 0.8);
    this.pre.connect(this.shaper); this.shaper.connect(this.clip); this.clip.connect(this.lp); this.lp.connect(this.out); this.out.connect(dest);
    this.voice = null;
  }
  set(k, v) {
    this.p[k] = v; const t = this.ctx.currentTime;
    if (k === 'drive') { this.pre.gain.setTargetAtTime(1 + v * 3, t, 0.02); this.shaper.curve = driveCurve(v); this.clip.curve = clipCurve(0.85 - v * 0.25); this.out.gain.setTargetAtTime(this.p.level / (1 + v * 0.8), t, 0.02); }
    if (k === 'tone') this.lp.frequency.setTargetAtTime(v, t, 0.02);
    if (k === 'level') this.out.gain.setTargetAtTime(v / (1 + this.p.drive * 0.8), t, 0.02);
  }
  shape(g, t, vel, dur, decay) {
    const floor = 0.22 * vel, tau = Math.max(0.05, decay * 0.5), hold = Math.max(0.06, dur);
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(vel, t + 0.004);
    g.setTargetAtTime(floor, t + 0.004, tau);
    const atEnd = floor + (vel - floor) * Math.exp(-(hold - 0.004) / tau);
    g.setValueAtTime(atEnd, t + hold);
    g.exponentialRampToValueAtTime(0.0001, t + hold + 0.05);
    return t + hold + 0.06;
  }
  note(t, midi, vel = 1, dur = 0.5, { slide = false, glide = 0.12, decay = 0.6 } = {}) {
    const ctx = this.ctx, f = midiToHz(midi);
    if (slide && this.voice && this.voice.until > t) {
      const v = this.voice;
      for (const o of v.oscs) { o.osc.frequency.cancelScheduledValues(t); o.osc.frequency.setValueAtTime(o.osc.frequency.value, t); o.osc.frequency.exponentialRampToValueAtTime(f * o.mult, t + Math.max(0.02, glide)); }
      const until = this.shape(v.gain.gain, t, 0.95 * vel, dur, decay);
      for (const o of v.oscs) o.osc.stop(until);
      v.until = until; return;
    }
    if (this.voice && this.voice.until > t) {
      const v = this.voice;
      v.gain.gain.cancelScheduledValues(t); v.gain.gain.setValueAtTime(v.gain.gain.value, t); v.gain.gain.linearRampToValueAtTime(0.0001, t + 0.008);
      for (const o of v.oscs) o.osc.stop(t + 0.01);
    }
    const gain = ctx.createGain(); gain.gain.value = 0.0001;
    const oscs = [];
    const mk = (type, mult, g) => {
      const osc = ctx.createOscillator(); osc.type = type;
      const og = ctx.createGain(); og.gain.value = g; osc.connect(og); og.connect(gain);
      osc.frequency.setValueAtTime(f * mult * 2.6, t); osc.frequency.exponentialRampToValueAtTime(f * mult, t + 0.035);
      osc.start(t); oscs.push({ osc, mult });
    };
    mk('sine', 1, 1); mk('triangle', 1, 0.25); if (this.p.sub > 0.01) mk('sine', 0.5, this.p.sub * 0.8);
    const until = this.shape(gain.gain, t, vel, dur, decay);
    gain.connect(this.pre);
    for (const o of oscs) o.osc.stop(until);
    this.voice = { oscs, gain, until };
  }
}

// ---------- drums ----------
// Per-lane filters and shapers are built once and shared; each hit only adds short-lived sources
// and gains. That keeps a 4-minute offline render to a few thousand nodes instead of tens of thousands.
export class Drums {
  constructor(ctx, dest, { memphis = 0.5, level = 0.95 } = {}) {
    this.ctx = ctx; this.p = { memphis, level };
    this.crush = ctx.createWaveShaper(); this.crush.curve = crushCurve(256 - memphis * 220);
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 16000 - memphis * 9000; this.lp.Q.value = 0.6;
    this.out = ctx.createGain(); this.out.gain.value = level;
    this.crush.connect(this.lp); this.lp.connect(this.out); this.out.connect(dest);
    this.bus = this.crush;
    // shared lane chains
    this.kickShaper = ctx.createWaveShaper(); this.kickShaper.curve = driveCurve(0.3); this.kickShaper.connect(this.bus);
    this.kickClick = ctx.createBiquadFilter(); this.kickClick.type = 'highpass'; this.kickClick.frequency.value = 1800; this.kickClick.connect(this.bus);
    this.snareBp = ctx.createBiquadFilter(); this.snareBp.type = 'bandpass'; this.snareBp.frequency.value = 3200; this.snareBp.Q.value = 0.6; this.snareBp.connect(this.bus);
    this.clapBp = ctx.createBiquadFilter(); this.clapBp.type = 'bandpass'; this.clapBp.frequency.value = 1600; this.clapBp.Q.value = 1.0; this.clapBp.connect(this.bus);
    this.hatBp = ctx.createBiquadFilter(); this.hatBp.type = 'bandpass'; this.hatBp.frequency.value = 10000; this.hatBp.Q.value = 0.5;
    this.hatHp = ctx.createBiquadFilter(); this.hatHp.type = 'highpass'; this.hatHp.frequency.value = 5500;
    this.hatBp.connect(this.hatHp); this.hatHp.connect(this.out);
    this.rimBp = ctx.createBiquadFilter(); this.rimBp.type = 'bandpass'; this.rimBp.frequency.value = 1700; this.rimBp.Q.value = 7; this.rimBp.connect(this.bus);
    this.crashHp = ctx.createBiquadFilter(); this.crashHp.type = 'highpass'; this.crashHp.frequency.value = 4000; this.crashHp.connect(this.bus);
  }
  set(k, v) {
    this.p[k] = v; const t = this.ctx.currentTime;
    if (k === 'memphis') { this.crush.curve = crushCurve(256 - v * 220); this.lp.frequency.setTargetAtTime(16000 - v * 9000, t, 0.02); }
    if (k === 'level') this.out.gain.setTargetAtTime(v, t, 0.02);
  }
  hit(t, lane, vel = 1, tune = 0) {
    const ctx = this.ctx, ratio = Math.pow(2, tune / 12);
    switch (lane) {
      case 'kick': {
        const o = ctx.createOscillator(); o.type = 'sine';
        const g = ctx.createGain();
        o.frequency.setValueAtTime(190 * ratio, t); o.frequency.exponentialRampToValueAtTime(46 * ratio, t + 0.04);
        env(g.gain, t, 1.5 * vel, 0.0015, 0.3);
        o.connect(g); g.connect(this.kickShaper); o.start(t); o.stop(t + 0.45);
        const n = noiseSource(ctx, t, 0.01); const ng = ctx.createGain(); env(ng.gain, t, 0.5 * vel, 0.001, 0.009); n.connect(ng); ng.connect(this.kickClick);
        break;
      }
      case 'snare': {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(240 * ratio, t); o.frequency.exponentialRampToValueAtTime(170 * ratio, t + 0.06);
        const g = ctx.createGain(); env(g.gain, t, 0.7 * vel, 0.001, 0.09); o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + 0.2);
        const n = noiseSource(ctx, t, 0.22); const ng = ctx.createGain(); env(ng.gain, t, 1.4 * vel, 0.001, 0.2); n.connect(ng); ng.connect(this.snareBp);
        break;
      }
      case 'clap': {
        for (let i = 0; i < 3; i++) { const tt = t + i * 0.011; const n = noiseSource(ctx, tt, 0.03); const g = ctx.createGain(); env(g.gain, tt, 0.55 * vel, 0.001, 0.025); n.connect(g); g.connect(this.clapBp); }
        const n = noiseSource(ctx, t + 0.03, 0.2); const g = ctx.createGain(); env(g.gain, t + 0.03, 0.7 * vel, 0.001, 0.18); n.connect(g); g.connect(this.clapBp);
        break;
      }
      case 'hat': case 'ohat': {
        const open = lane === 'ohat';
        const g = ctx.createGain(); env(g.gain, t, 1.6 * vel, 0.001, open ? 0.32 : 0.06);
        for (const f of [562, 830, 1175]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * ratio; o.connect(g); o.start(t); o.stop(t + (open ? 0.4 : 0.08)); }
        const n = noiseSource(ctx, t, open ? 0.35 : 0.06); const ng = ctx.createGain(); ng.gain.value = 2.0; n.connect(ng); ng.connect(g);
        g.connect(this.hatBp);
        break;
      }
      case 'rim': {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1700 * ratio;
        const g = ctx.createGain(); env(g.gain, t, 0.5 * vel, 0.001, 0.035); o.connect(g); g.connect(this.rimBp); o.start(t); o.stop(t + 0.1);
        break;
      }
      case 'crash': {
        const n = noiseSource(ctx, t, 1.6); const g = ctx.createGain(); env(g.gain, t, 0.35 * vel, 0.002, 1.5); n.connect(g); g.connect(this.crashHp);
        break;
      }
    }
  }
}

// ---------- cowbell ----------
export class Cowbell {
  constructor(ctx, dest, { stack = 0.55, grit = 0.5, hall = 0.28, level = 0.85 } = {}) {
    this.ctx = ctx; this.p = { stack, grit, hall, level };
    this.dry = ctx.createGain(); this.wet = ctx.createGain(); this.wet.gain.value = hall;
    this.conv = ctx.createConvolver(); this.conv.buffer = reverbIR(ctx);
    this.grit = ctx.createWaveShaper(); this.grit.curve = driveCurve(grit * 0.7); this.grit.oversample = '2x';
    this.gritGain = ctx.createGain(); this.gritGain.gain.value = 1 + grit * 1.5;
    this.out = ctx.createGain(); this.out.gain.value = level;
    this.pre = ctx.createGain(); this.pre.connect(this.gritGain); this.gritGain.connect(this.grit); this.grit.connect(this.dry); this.grit.connect(this.wet);
    this.wet.connect(this.conv); this.conv.connect(this.out); this.dry.connect(this.out); this.out.connect(dest);
  }
  set(k, v) {
    this.p[k] = v; const t = this.ctx.currentTime;
    if (k === 'grit') { this.grit.curve = driveCurve(v * 0.7); this.gritGain.gain.setTargetAtTime(1 + v * 1.5, t, 0.02); }
    if (k === 'hall') this.wet.gain.setTargetAtTime(v, t, 0.03);
    if (k === 'level') this.out.gain.setTargetAtTime(v, t, 0.02);
  }
  filterFor(midi) {
    this.filters = this.filters || new Map();
    let bp = this.filters.get(midi);
    if (!bp) { bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = midiToHz(midi) * 1.3; bp.Q.value = 1.6; bp.connect(this.pre); this.filters.set(midi, bp); }
    return bp;
  }
  note(t, midi, vel = 1, decay = 0.38, bell = 1.48) {
    const ctx = this.ctx, f = midiToHz(midi);
    const g = ctx.createGain(); env(g.gain, t, 0.5 * vel, 0.001, decay);
    const voices = [[1, 1], [bell, 0.7]];
    if (this.p.stack > 0.05) voices.push([1.004, this.p.stack * 0.5]);
    for (const [mult, amp] of voices) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * mult;
      const og = ctx.createGain(); og.gain.value = amp; o.connect(og); og.connect(g); o.start(t); o.stop(t + decay + 0.05);
    }
    g.connect(this.filterFor(midi));
  }
}

// ---------- master tape stage ----------
export class Tape {
  constructor(ctx, dest, { saturation = 0.55, tone = 9000, wow = 0.18, hiss = 0.3, level = 1 } = {}) {
    this.ctx = ctx; this.p = { saturation, tone, wow, hiss, level };
    this.input = ctx.createGain(); this.input.gain.value = 0.8;
    this.sat = ctx.createWaveShaper(); this.sat.oversample = '2x'; this.sat.curve = tapeCurve(saturation);
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = tone; this.tone.Q.value = 0.5;
    this.presence = ctx.createBiquadFilter(); this.presence.type = 'highshelf'; this.presence.frequency.value = 4500; this.presence.gain.value = 4;
    this.delay = ctx.createDelay(0.1); this.delay.delayTime.value = 0.02;
    this.wowLfo = ctx.createOscillator(); this.wowLfo.frequency.value = 0.7;
    this.wowGain = ctx.createGain(); this.wowGain.gain.value = wow * 0.0045;
    this.wowLfo.connect(this.wowGain); this.wowGain.connect(this.delay.delayTime); this.wowLfo.start();
    this.flutter = ctx.createOscillator(); this.flutter.frequency.value = 9.3;
    this.flutterGain = ctx.createGain(); this.flutterGain.gain.value = wow * 0.0005;
    this.flutter.connect(this.flutterGain); this.flutterGain.connect(this.delay.delayTime); this.flutter.start();
    this.hissSrc = ctx.createBufferSource(); this.hissSrc.buffer = noiseBuffer(ctx); this.hissSrc.loop = true;
    this.hissFilter = ctx.createBiquadFilter(); this.hissFilter.type = 'bandpass'; this.hissFilter.frequency.value = 6000; this.hissFilter.Q.value = 0.4;
    this.hissGain = ctx.createGain(); this.hissGain.gain.value = 0;
    this.hissSrc.connect(this.hissFilter); this.hissFilter.connect(this.hissGain); this.hissSrc.start();
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -12; this.comp.knee.value = 12; this.comp.ratio.value = 2.4; this.comp.attack.value = 0.022; this.comp.release.value = 0.22;
    this.master = ctx.createGain(); this.master.gain.value = level;
    this.limiter = ctx.createDynamicsCompressor(); this.limiter.threshold.value = -3; this.limiter.knee.value = 1; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.0005; this.limiter.release.value = 0.06;
    this.ceiling = ctx.createWaveShaper(); this.ceiling.curve = clipCurve(0.9); this.ceiling.oversample = '2x';
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.6;
    this.input.connect(this.sat); this.sat.connect(this.tone); this.tone.connect(this.presence); this.presence.connect(this.delay); this.delay.connect(this.comp); this.hissGain.connect(this.comp);
    this.comp.connect(this.master); this.master.connect(this.limiter); this.limiter.connect(this.ceiling); this.ceiling.connect(this.analyser); this.analyser.connect(dest);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.time = new Uint8Array(this.analyser.fftSize);
  }
  set(k, v) {
    this.p[k] = v; const t = this.ctx.currentTime;
    if (k === 'saturation') this.sat.curve = tapeCurve(v);
    if (k === 'tone') this.tone.frequency.setTargetAtTime(v, t, 0.03);
    if (k === 'wow') { this.wowGain.gain.setTargetAtTime(v * 0.0045, t, 0.05); this.flutterGain.gain.setTargetAtTime(v * 0.0005, t, 0.05); }
    if (k === 'hiss') this.hissGain.gain.setTargetAtTime(this.rolling ? v * 0.012 : 0, t, 0.05);
    if (k === 'level') this.master.gain.setTargetAtTime(v, t, 0.02);
  }
  roll(on) { this.rolling = on; this.hissGain.gain.setTargetAtTime(on ? this.p.hiss * 0.012 : 0, this.ctx.currentTime, 0.1); }
  spectrum() { this.analyser.getByteFrequencyData(this.freq); return this.freq; }
  wave() { this.analyser.getByteTimeDomainData(this.time); return this.time; }
}

// ---------- ignition sound ----------
export function ignition(ctx, dest, t = ctx.currentTime) {
  const g = ctx.createGain(); g.connect(dest); g.gain.value = 0.6;
  const st = ctx.createOscillator(); st.type = 'sawtooth'; st.frequency.setValueAtTime(140, t); st.frequency.exponentialRampToValueAtTime(520, t + 0.42);
  const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.setValueAtTime(600, t); sf.frequency.exponentialRampToValueAtTime(2600, t + 0.42); sf.Q.value = 4;
  const sg = ctx.createGain(); env(sg.gain, t, 0.22, 0.01, 0.46); st.connect(sf); sf.connect(sg); sg.connect(g); st.start(t); st.stop(t + 0.5);
  for (let i = 0; i < 3; i++) {
    const tt = t + 0.34 + i * 0.09; const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(95 - i * 8, tt); o.frequency.exponentialRampToValueAtTime(45, tt + 0.12);
    const og = ctx.createGain(); env(og.gain, tt, 0.3, 0.002, 0.12); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    o.connect(lp); lp.connect(og); og.connect(g); o.start(tt); o.stop(tt + 0.2);
  }
  const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(70, t + 0.6); sub.frequency.exponentialRampToValueAtTime(38, t + 1.0);
  const subg = ctx.createGain(); env(subg.gain, t + 0.6, 0.7, 0.004, 0.55); sub.connect(subg); subg.connect(g); sub.start(t + 0.6); sub.stop(t + 1.3);
}
