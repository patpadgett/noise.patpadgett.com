// Engine: AudioContext, device instances, look-ahead scheduler, offline rendering, chopper.
import * as S from './synth.js';
import { STEPS_PER_BAR, eventsAtStep, findDevice, findPattern } from './song.js';
import { bufferToDataUri, dataUriToBuffer, monoData, reverseBuffer, encodeWav } from './wav.js';

const DEVICE_CLASSES = {
  hearse: S.Hearse, cathedral: S.Cathedral, preacher: S.Preacher, breaker: S.Breaker, carousel: S.Carousel,
};

export class Engine extends EventTarget {
  constructor(song) {
    super();
    this.song = song;
    this.ctx = null;
    this.devices = new Map();
    this.master = null;
    this.playing = false;
    this.step = 0;           // next step to schedule
    this.nextTime = 0;
    this.lookahead = 0.12;
    this.timer = null;
    this.loop = { on: false, startBar: 0, endBar: 0 };
    this.uiQueue = [];       // [{time, step}]
    this.displayStep = -1;
    this.pitchRatio = 1;
    this.reverseCache = new WeakMap();
    this.mode = 'song';      // 'song' | 'pattern'
    this.patternFocus = null; // { deviceId, patId }
  }

  get ready() { return !!this.ctx; }

  async unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    await this.ctx.resume();
    this.master = new S.Screwtape(this.ctx, this.ctx.destination, this.song.master);
    this.master.setHissAudible(false);
    this.uiBus = this.ctx.createGain();
    this.uiBus.gain.value = 0.7;
    this.uiBus.connect(this.ctx.destination);
    this.applyScrew(this.song.screw);
    this.buildDevices();
    await this.ensureCarouselAudio();
  }

  buildDevices() {
    for (const d of this.devices.values()) d.dispose();
    this.devices.clear();
    for (const def of this.song.devices) {
      const Cls = DEVICE_CLASSES[def.type];
      if (!Cls) continue;
      const inst = new Cls(this.ctx, this.master.input, def, this);
      this.devices.set(def.id, inst);
      if (def.type === 'carousel' && def.audio?.buffer) inst.setAudio(def.audio.buffer, def.audio.slices);
    }
  }

  async setSong(song) {
    const was = this.playing;
    this.stop();
    this.song = song;
    if (this.ctx) {
      for (const p of Object.keys(song.master)) this.master.set(p, song.master[p]);
      this.applyScrew(song.screw);
      this.buildDevices();
      await this.ensureCarouselAudio();
    }
    this.dispatchEvent(new Event('song'));
    if (was) this.play();
  }

  // ---- screw: the one lever that moves every device (pitch ratio + tempo) ----
  applyScrew(semis) {
    this.song.screw = semis;
    this.pitchRatio = Math.pow(2, semis / 12);
    this.dispatchEvent(new CustomEvent('screw', { detail: semis }));
  }
  effectiveBpm() { return this.song.bpm * this.pitchRatio; }
  stepSeconds() { return 60 / this.effectiveBpm() / 4; }

  // ---- carousel audio: bake or decode ----
  async ensureCarouselAudio() {
    const def = findDevice(this.song, 'carousel');
    if (!def) return;
    if (def.audio?.buffer) { this.devices.get(def.id)?.setAudio(def.audio.buffer, def.audio.slices); return; }
    if (def.audio?.wav) {
      const buf = await dataUriToBuffer(this.ctx, def.audio.wav);
      def.audio.buffer = buf;
      this.devices.get(def.id)?.setAudio(buf, def.audio.slices);
      this.dispatchEvent(new Event('audio'));
      return;
    }
    if (def.audio === null || def.audio === undefined) {
      const buf = await this.bakeDemoSample();
      const slices = sliceEven(buf, 8);
      def.audio = { name: 'HEY TAPE · SIDE A', buffer: buf, slices, origin: 'baked' };
      this.devices.get(def.id)?.setAudio(buf, slices);
      this.dispatchEvent(new Event('audio'));
    }
  }

  // The demo chop is itself synthesized: a 2-bar phrase of the Preacher and Cathedral rendered
  // offline through a tape stage, so the app ships with no sample files at all.
  async bakeDemoSample() {
    const sr = 44100;
    const bpm = 140;
    const stepSec = 60 / bpm / 4;
    const bars = 2;
    const len = Math.ceil(sr * stepSec * STEPS_PER_BAR * bars);
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OAC(2, len, sr);
    const tape = new S.Screwtape(off, off.destination, { saturation: 0.7, tone: 4800, wow: 0.3, hiss: 0.0, level: 1.0 });
    const talk = new S.Preacher(off, tape.input, { params: { vowel: 0.4, throat: 0.75, grit: 0.7, sermon: 0.1, tail: 0.3, octave: 0, level: 0.9 } }, null);
    const bell = new S.Cathedral(off, tape.input, { params: { decay: 0.45, bell: 1.62, choir: 0.7, grit: 0.6, nave: 0.5, level: 0.7 } }, null);
    const sub = new S.Hearse(off, tape.input, { params: { decay: 0.5, glide: 0.1, coffin: 0.5, tone: 900, rumble: 0.3, level: 0.6 } }, null);
    // eight distinct hits, one per slice: HEY chants, bell dings, a sub thump, a low OH
    const events = [
      [0, () => talk.noteOn(0, 52, 1, stepSec * 2)],
      [4, (t) => bell.noteOn(t, 76, 0.9, 0.3)],
      [8, (t) => talk.noteOn(t, 55, 0.95, stepSec * 2)],
      [12, (t) => sub.noteOn(t, 28, 0.9, 0.4)],
      [16, (t) => { talk.set('vowel', 3.2); talk.noteOn(t, 40, 1, stepSec * 3); }],
      [20, (t) => bell.noteOn(t, 79, 0.9, 0.3)],
      [24, (t) => { talk.set('vowel', 1.6); talk.noteOn(t, 52, 0.95, stepSec * 2); }],
      [28, (t) => { bell.noteOn(t, 71, 0.9, 0.3); bell.noteOn(t + 0.06, 76, 0.7, 0.3); }],
    ];
    for (const [step, fn] of events) fn(step * stepSec + 0.01);
    const buf = await off.startRendering();
    return buf;
  }

  // ---- chopper (LATHE) ----
  setCarouselAudio(buffer, slices, name, origin = 'user') {
    const def = findDevice(this.song, 'carousel');
    def.audio = { name, buffer, slices, origin };
    this.devices.get(def.id)?.setAudio(buffer, slices);
    this.dispatchEvent(new Event('audio'));
  }
  setSlices(slices) {
    const def = findDevice(this.song, 'carousel');
    if (!def.audio) return;
    def.audio.slices = slices;
    this.devices.get(def.id)?.setAudio(def.audio.buffer, slices);
    this.dispatchEvent(new Event('audio'));
  }
  reverseFor(buffer) {
    let r = this.reverseCache.get(buffer);
    if (!r) { r = reverseBuffer(this.ctx, buffer); this.reverseCache.set(buffer, r); }
    return r;
  }

  // ---- transport ----
  play(fromStep = null) {
    if (!this.ctx) return;
    if (this.playing) return;
    if (fromStep != null) this.step = fromStep;
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.master.setHissAudible(true);
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
    this.dispatchEvent(new Event('transport'));
  }
  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    for (const d of this.devices.values()) d.stopAll();
    this.master?.setHissAudible(false);
    this.uiQueue.length = 0;
    this.displayStep = -1;
    this.dispatchEvent(new Event('transport'));
  }
  toggle() { this.playing ? this.stop() : this.play(); }
  rewind() {
    const was = this.playing;
    this.stop();
    this.step = this.mode === 'song' && this.loop.on ? this.loop.startBar * STEPS_PER_BAR : 0;
    this.displayStep = -1;
    this.dispatchEvent(new Event('position'));
    if (was) this.play();
  }
  seekBar(bar) {
    const was = this.playing;
    this.stop();
    this.step = bar * STEPS_PER_BAR;
    this.dispatchEvent(new Event('position'));
    if (was) this.play();
  }
  totalSteps() {
    if (this.mode === 'pattern' && this.patternFocus) {
      const dev = findDevice(this.song, this.patternFocus.deviceId);
      const pat = dev && findPattern(dev, this.patternFocus.patId);
      return pat ? pat.steps : 32;
    }
    return this.song.arrangement.bars * STEPS_PER_BAR;
  }

  schedule() {
    const ctx = this.ctx;
    const horizon = ctx.currentTime + this.lookahead;
    while (this.nextTime < horizon) {
      const stepSec = this.stepSeconds();
      const total = this.totalSteps();
      if (this.mode === 'song' && this.loop.on) {
        const ls = this.loop.startBar * STEPS_PER_BAR, le = this.loop.endBar * STEPS_PER_BAR;
        if (this.step >= le || this.step < ls) this.step = ls;
      } else if (this.step >= total) {
        this.step = 0;
      }
      // swing: delay every odd 16th
      const swingOff = (this.step % 2 === 1) ? this.song.swing * stepSec : 0;
      const t = this.nextTime + swingOff;
      this.fire(this.step, t, stepSec);
      this.uiQueue.push({ time: this.nextTime, step: this.step });
      this.step++;
      this.nextTime += stepSec;
    }
  }

  fire(step, t, stepSec) {
    let events;
    if (this.mode === 'pattern' && this.patternFocus) {
      const dev = findDevice(this.song, this.patternFocus.deviceId);
      const pat = dev && findPattern(dev, this.patternFocus.patId);
      events = pat ? pat.notes.filter((n) => n.s === step % pat.steps).map((note) => ({ device: dev, note })) : [];
    } else {
      events = eventsAtStep(this.song, step);
    }
    for (const { device, note } of events) {
      if (device.muted) continue;
      const inst = this.devices.get(device.id);
      if (!inst) continue;
      const dur = Math.max(1, note.l) * stepSec * 0.98;
      switch (device.type) {
        case 'breaker': inst.hit(t, note.n, note.v ?? 1); break;
        case 'hearse': inst.noteOn(t, note.n, note.v ?? 1, dur, { slide: !!note.g }); break;
        case 'carousel': {
          const src = device.audio?.buffer;
          inst.noteOn(t, note.n, note.v ?? 1, dur, { reverse: !!note.r, reverseBuffer: (note.r && src) ? this.reverseFor(src) : null });
          break;
        }
        default: inst.noteOn(t, note.n, note.v ?? 1, dur);
      }
    }
  }

  // called from the UI's rAF loop; returns the step currently sounding
  currentStep() {
    if (!this.playing || !this.ctx) return this.displayStep;
    const now = this.ctx.currentTime;
    while (this.uiQueue.length && this.uiQueue[0].time <= now) this.displayStep = this.uiQueue.shift().step;
    return this.displayStep;
  }

  // audition a note right now (from the editor or a pad)
  audition(deviceId, n, opts = {}) {
    if (!this.ctx) return;
    const def = findDevice(this.song, deviceId);
    const inst = this.devices.get(def.id);
    if (!inst) return;
    const t = this.ctx.currentTime + 0.01;
    const dur = (opts.len || 1) * this.stepSeconds();
    if (def.type === 'breaker') inst.hit(t, n, opts.v ?? 1);
    else if (def.type === 'carousel') inst.noteOn(t, n, opts.v ?? 1, null, { reverse: !!opts.r, reverseBuffer: opts.r && def.audio?.buffer ? this.reverseFor(def.audio.buffer) : null });
    else inst.noteOn(t, n, opts.v ?? 1, Math.max(dur, 0.2), { slide: !!opts.g });
  }

  setParam(deviceId, param, value) {
    const def = findDevice(this.song, deviceId);
    if (!def) return;
    def.params[param] = value;
    this.devices.get(def.id)?.set(param, value);
  }
  setMaster(param, value) {
    this.song.master[param] = value;
    this.master?.set(param, value);
  }
  setMuted(deviceId, m) {
    const def = findDevice(this.song, deviceId);
    def.muted = m;
    this.devices.get(def.id)?.setMuted(m);
  }
  ui(kind) {
    if (!this.ctx) return;
    if (kind === 'coin') S.coinDrop(this.ctx, this.uiBus);
    if (kind === 'click') S.relayClick(this.ctx, this.uiBus);
  }

  // ---- serialization ----
  serialize() {
    const song = this.song;
    const devices = song.devices.map((d) => {
      const o = { id: d.id, type: d.type, params: d.params, muted: !!d.muted, patterns: d.patterns };
      if (d.type === 'carousel') {
        if (d.audio?.buffer) {
          o.audio = { name: d.audio.name, origin: d.audio.origin, slices: d.audio.slices,
            sampleRate: d.audio.buffer.sampleRate, duration: d.audio.buffer.duration,
            encoding: 'wav/pcm16/base64', wav: bufferToDataUri(d.audio.buffer, { forceMono: d.audio.buffer.duration > 12 }) };
        } else o.audio = null;
      }
      return o;
    });
    return {
      format: song.format, version: song.version, title: song.title, author: song.author,
      bpm: song.bpm, swing: song.swing, screw: song.screw, master: song.master,
      devices, arrangement: song.arrangement,
      meta: { ...song.meta, saved: new Date().toISOString(), app: 'NOISE Select-O-Matic', url: 'https://noise.patpadgett.com' },
    };
  }

  // Render the whole arrangement to a WAV ArrayBuffer (mixdown)
  async renderMixdown(onProgress) {
    const buf = await this.renderRange(0, this.song.arrangement.bars, { tail: 2.5, onProgress });
    return encodeWav(buf);
  }

  // Render bars [startBar, endBar) offline through the tape stage. `exclude` skips device types
  // (the CHOP SHOP resamples the song without the tape deck so chops don't chop chops).
  async renderRange(startBar, endBar, { tail = 0, exclude = [], onProgress, hiss = true } = {}) {
    const song = this.song;
    const sr = 44100;
    const stepSec = this.stepSeconds();
    const first = startBar * STEPS_PER_BAR;
    const total = (endBar - startBar) * STEPS_PER_BAR;
    const len = Math.ceil((total * stepSec + tail + 0.05) * sr);
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OAC(2, len, sr);
    const tape = new S.Screwtape(off, off.destination, { ...song.master, hiss: hiss ? song.master.hiss : 0 });
    const fake = { pitchRatio: this.pitchRatio };
    const insts = new Map();
    for (const def of song.devices) {
      if (exclude.includes(def.type)) continue;
      const Cls = DEVICE_CLASSES[def.type];
      const inst = new Cls(off, tape.input, def, fake);
      if (def.type === 'carousel' && def.audio?.buffer) inst.setAudio(def.audio.buffer, def.audio.slices);
      insts.set(def.id, inst);
    }
    let revCache = null;
    for (let i = 0; i < total; i++) {
      const step = first + i;
      const swingOff = (step % 2 === 1) ? song.swing * stepSec : 0;
      const t = 0.05 + i * stepSec + swingOff;
      for (const { device, note } of eventsAtStep(song, step)) {
        if (device.muted) continue;
        const inst = insts.get(device.id);
        if (!inst) continue;
        const dur = Math.max(1, note.l) * stepSec * 0.98;
        switch (device.type) {
          case 'breaker': inst.hit(t, note.n, note.v ?? 1); break;
          case 'hearse': inst.noteOn(t, note.n, note.v ?? 1, dur, { slide: !!note.g }); break;
          case 'carousel': {
            const src = device.audio?.buffer;
            if (note.r && src && !revCache) revCache = reverseBuffer(off, src);
            inst.noteOn(t, note.n, note.v ?? 1, dur, { reverse: !!note.r, reverseBuffer: revCache });
            break;
          }
          default: inst.noteOn(t, note.n, note.v ?? 1, dur);
        }
      }
      if (onProgress && i % 32 === 0) onProgress(i / total * 0.3);
    }
    const buf = await off.startRendering();
    onProgress?.(1);
    return buf;
  }
}

// ---------- slicing ----------
export function sliceEven(buffer, count) {
  const d = buffer.duration;
  return Array.from({ length: count }, (_, i) => ({ start: (d * i) / count, end: (d * (i + 1)) / count }));
}

// Transient detection: onset strength from the log-energy envelope, adaptive threshold
// (mean + k·std), local-maximum picking with a minimum gap. Silence is floored so the first
// note after a gap does not dwarf every other onset.
export function detectSlices(buffer, sensitivity = 0.5, maxSlices = 32) {
  const data = monoData(buffer);
  const sr = buffer.sampleRate;
  const hop = Math.floor(sr * 0.005); // 5ms frames
  const frames = Math.floor(data.length / hop);
  if (frames < 8) return sliceEven(buffer, 2);
  const env = new Float32Array(frames);
  let envMax = 0;
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const o = f * hop;
    for (let i = 0; i < hop; i++) s += data[o + i] * data[o + i];
    env[f] = Math.sqrt(s / hop);
    if (env[f] > envMax) envMax = env[f];
  }
  if (envMax <= 1e-5) return sliceEven(buffer, 8);
  const floor = envMax * 0.02; // -34 dB relative floor
  // smooth the envelope a touch (3-frame), then take positive log differences over a 2-frame span
  const sm = new Float32Array(frames);
  for (let f = 0; f < frames; f++) sm[f] = (env[Math.max(0, f - 1)] + env[f] + env[Math.min(frames - 1, f + 1)]) / 3;
  const flux = new Float32Array(frames);
  let mean = 0;
  for (let f = 2; f < frames; f++) {
    flux[f] = Math.max(0, Math.log(sm[f] + floor) - Math.log(sm[f - 2] + floor));
    mean += flux[f];
  }
  mean /= Math.max(1, frames - 2);
  let varc = 0;
  for (let f = 2; f < frames; f++) varc += (flux[f] - mean) ** 2;
  const std = Math.sqrt(varc / Math.max(1, frames - 2));
  const k = 3.2 - sensitivity * 2.7; // sensitivity 0 => strict, 1 => loose
  const thresh = mean + k * std;
  const minGap = Math.max(4, Math.floor((0.05 + (1 - sensitivity) * 0.07) / (hop / sr))); // 50-120ms
  const onsets = [0];
  let last = -minGap;
  for (let f = 3; f < frames - 3; f++) {
    if (flux[f] <= thresh) continue;
    let isPeak = true;
    for (let d = -3; d <= 3; d++) if (d !== 0 && flux[f + d] > flux[f]) { isPeak = false; break; }
    if (!isPeak || f - last < minGap) continue;
    onsets.push(f);
    last = f;
  }
  // the onset frame is where energy has risen; step back ~1 frame to keep the attack
  const secs = onsets.map((f) => Math.max(0, ((f - 1) * hop) / sr));
  const uniq = [...new Set(secs.map((s) => +s.toFixed(4)))].sort((a, b) => a - b);
  let out = uniq.map((s, i) => ({ start: s, end: uniq[i + 1] ?? buffer.duration }));
  out = out.filter((s) => s.end - s.start > 0.02);
  if (out.length > maxSlices) {
    const scored = out.map((s) => ({ s, k: flux[Math.min(frames - 1, Math.floor(s.start * sr / hop) + 1)] || 0 }));
    scored.sort((a, b) => b.k - a.k);
    const keep = scored.slice(0, maxSlices).map((x) => x.s.start).sort((a, b) => a - b);
    if (keep[0] !== 0) keep.unshift(0);
    out = keep.map((st, i) => ({ start: st, end: keep[i + 1] ?? buffer.duration }));
  }
  if (out.length < 2) return sliceEven(buffer, 4);
  return out;
}

export function normalizeBuffer(ctx, buffer, target = 0.95) {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  }
  if (peak < 1e-4) return buffer;
  const g = target / peak;
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    const o = out.getChannelData(c);
    for (let i = 0; i < d.length; i++) o[i] = d[i] * g;
  }
  return out;
}

export function trimBuffer(ctx, buffer, maxSeconds) {
  if (buffer.duration <= maxSeconds) return buffer;
  const len = Math.floor(maxSeconds * buffer.sampleRate);
  const out = ctx.createBuffer(buffer.numberOfChannels, len, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).slice(0, len), c);
  return out;
}

// waveform peaks for drawing
export function peaks(buffer, columns) {
  const d = monoData(buffer);
  const per = d.length / columns;
  const out = new Float32Array(columns);
  for (let c = 0; c < columns; c++) {
    const a = Math.floor(c * per), b = Math.min(d.length, Math.floor((c + 1) * per));
    let m = 0;
    for (let i = a; i < b; i += 1) { const v = Math.abs(d[i]); if (v > m) m = v; }
    out[c] = m;
  }
  return out;
}
