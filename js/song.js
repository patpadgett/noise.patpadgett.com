// Song model: the whole workstation state as plain JSON, plus the demo track.
// File format `.noise.json`: { format: "noise-song", version: 1, ... }. Audio rides inside as
// base64 WAV data URIs so the file opens anywhere without a codec.

export const FORMAT = 'noise-song';
export const VERSION = 1;
export const STEPS_PER_BAR = 16;

export const DEVICE_TYPES = {
  hearse: {
    name: 'HEARSE', tag: '808 · SLIDES', kind: 'melodic', color: 'red',
    rows: { low: 24, high: 48 }, // C1..C3
    params: [
      { id: 'decay', label: 'DECAY', min: 0.15, max: 2.5, def: 0.9, unit: 's' },
      { id: 'glide', label: 'GLIDE', min: 0.02, max: 0.6, def: 0.14, unit: 's' },
      { id: 'coffin', label: 'COFFIN', min: 0, max: 1, def: 0.22, unit: '%' },
      { id: 'tone', label: 'TONE', min: 120, max: 4000, def: 900, unit: 'Hz', log: true },
      { id: 'rumble', label: 'RUMBLE', min: 0, max: 1, def: 0.35, unit: '%' },
      { id: 'level', label: 'LEVEL', min: 0, max: 1, def: 0.9, unit: '%' },
    ],
  },
  cathedral: {
    name: 'COWBELL CATHEDRAL', tag: 'BELL MELODY · NAVE', kind: 'melodic', color: 'blue',
    rows: { low: 55, high: 84 }, // G3..C6
    params: [
      { id: 'decay', label: 'DECAY', min: 0.05, max: 1.2, def: 0.28, unit: 's' },
      { id: 'bell', label: 'BELL', min: 1.2, max: 2.2, def: 1.48, unit: '×' },
      { id: 'choir', label: 'CHOIR', min: 0, max: 1, def: 0.35, unit: '%' },
      { id: 'nave', label: 'NAVE', min: 0, max: 1, def: 0.42, unit: '%' },
      { id: 'level', label: 'LEVEL', min: 0, max: 1, def: 0.55, unit: '%' },
    ],
  },
  preacher: {
    name: 'PREACHER', tag: 'FORMANT STABS', kind: 'melodic', color: 'red',
    rows: { low: 40, high: 64 }, // E2..E4
    params: [
      { id: 'vowel', label: 'VOWEL', min: 0, max: 4, def: 0.6, unit: 'vowel' },
      { id: 'throat', label: 'THROAT', min: 0, max: 1, def: 0.5, unit: '%' },
      { id: 'grit', label: 'GRIT', min: 0, max: 1, def: 0.35, unit: '%' },
      { id: 'sermon', label: 'SERMON', min: 0, max: 1, def: 0.3, unit: '%' },
      { id: 'tail', label: 'TAIL', min: 0, max: 1, def: 0.25, unit: '%' },
      { id: 'octave', label: 'OCTAVE', min: -1, max: 1, def: 0, unit: 'oct', step: 1 },
      { id: 'level', label: 'LEVEL', min: 0, max: 1, def: 0.5, unit: '%' },
    ],
  },
  breaker: {
    name: 'BREAKER', tag: 'DRUM MACHINE · MEMPHIS', kind: 'drums', color: 'blue',
    lanes: ['KICK', 'SNARE', 'CLAP', 'HAT', 'OPEN HAT', 'RIM', 'TOM', 'CRASH'],
    params: [
      { id: 'memphis', label: 'MEMPHIS', min: 0, max: 1, def: 0.45, unit: '%' },
      { id: 'decay', label: 'DECAY', min: 0.4, max: 2, def: 1, unit: '×' },
      { id: 'level', label: 'LEVEL', min: 0, max: 1, def: 0.9, unit: '%' },
    ],
  },
  carousel: {
    name: 'CAROUSEL', tag: 'SLICE PLAYER · 45s', kind: 'slices', color: 'red',
    params: [
      { id: 'pitch', label: 'PITCH', min: -12, max: 12, def: 0, unit: 'st', step: 1 },
      { id: 'gate', label: 'GATE', min: 0.1, max: 1, def: 1, unit: '%' },
      { id: 'tape', label: 'TAPE', min: 800, max: 16000, def: 7000, unit: 'Hz', log: true },
      { id: 'wobble', label: 'WOBBLE', min: 0, max: 1, def: 0.12, unit: '%' },
      { id: 'level', label: 'LEVEL', min: 0, max: 1, def: 0.85, unit: '%' },
    ],
  },
};

export const MASTER_PARAMS = [
  { id: 'saturation', label: 'SATURATE', min: 0, max: 1, def: 0.4, unit: '%' },
  { id: 'tone', label: 'TONE', min: 2000, max: 18000, def: 11000, unit: 'Hz', log: true },
  { id: 'wow', label: 'WOW', min: 0, max: 1, def: 0.25, unit: '%' },
  { id: 'hiss', label: 'HISS', min: 0, max: 1, def: 0.3, unit: '%' },
  { id: 'level', label: 'OUT', min: 0, max: 1, def: 0.9, unit: '%' },
];

export function defaultParams(type) {
  const o = {};
  for (const p of DEVICE_TYPES[type].params) o[p.id] = p.def;
  if (type === 'breaker') o.tune = [0, 0, 0, 0, 0, 0, 0, 0];
  return o;
}

let uid = 1;
export const id = (p = 'p') => p + (Date.now().toString(36)) + (uid++).toString(36);

// note: { s: step, n: pitch|lane|slice, l: length (steps), v: velocity 0..1, g: glide (hearse), r: reverse (carousel) }
export function makePattern(name, steps, notes = []) {
  return { id: id('pat'), name, steps, notes };
}

// ---------- the demo song: an original phonk track ----------
function N(s, n, l = 1, v = 1, extra = {}) { return { s, n, l, v, ...extra }; }

export function demoSong() {
  // E minor. Hearse in the sub, cowbell riding the top, preacher in the middle, chops in the gaps.
  const E1 = 28, G1 = 31, A1 = 33, B1 = 35, D1 = 26, C1 = 24, D2 = 38;
  const hearseA = makePattern('A', 32, [
    N(0, E1, 4, 1), N(6, E1, 2, 0.9), N(10, E1, 2, 0.95), N(12, G1, 2, 0.9), N(14, E1, 2, 1, { g: 1 }),
    N(16, E1, 4, 1), N(22, D1, 2, 0.9), N(24, E1, 3, 1, { g: 1 }), N(28, B1, 2, 0.9), N(30, A1, 2, 0.9, { g: 1 }),
  ]);
  const hearseB = makePattern('B', 32, [
    N(0, E1, 6, 1), N(8, G1, 3, 0.9), N(12, A1, 4, 0.95, { g: 1 }), N(16, E1, 4, 1), N(20, D1, 2, 0.9),
    N(22, C1, 2, 0.9, { g: 1 }), N(24, D1, 4, 0.95), N(28, D2, 1, 0.8), N(29, E1, 3, 1, { g: 1 }),
  ]);

  const E4 = 64, G4 = 67, A4 = 69, B4 = 71, D5 = 74, E5 = 76, D4 = 62, B3 = 59, G5 = 79, FS4 = 66;
  const cathA = makePattern('A', 32, [
    N(0, E4, 1, 1), N(2, E4, 1, 0.8), N(3, G4, 1, 0.9), N(6, E4, 1, 0.9), N(8, B4, 2, 1), N(11, A4, 1, 0.85),
    N(12, G4, 1, 0.9), N(14, E4, 1, 0.8), N(16, D4, 1, 0.9), N(18, E4, 1, 0.85), N(19, G4, 1, 0.9), N(22, E4, 1, 0.9),
    N(24, B4, 1, 1), N(26, D5, 1, 0.95), N(27, B4, 1, 0.8), N(28, A4, 1, 0.9), N(30, G4, 1, 0.9), N(31, E4, 1, 0.7),
  ]);
  const cathB = makePattern('B', 32, [
    N(0, E5, 1, 1), N(1, D5, 1, 0.8), N(2, B4, 1, 0.9), N(4, E5, 1, 1), N(6, G5, 1, 0.95), N(8, E5, 2, 1),
    N(11, D5, 1, 0.9), N(12, B4, 1, 0.9), N(14, A4, 1, 0.85), N(15, G4, 1, 0.8), N(16, E4, 1, 0.9), N(18, G4, 1, 0.9),
    N(19, A4, 1, 0.85), N(20, B4, 1, 1), N(22, D5, 1, 0.95), N(24, E5, 3, 1), N(28, B4, 1, 0.9), N(29, A4, 1, 0.8),
    N(30, G4, 1, 0.9), N(31, FS4, 1, 0.9),
  ]);

  const E3 = 52, G3 = 55, B3b = 59, D3 = 50, A2 = 45, E2 = 40;
  const preachA = makePattern('A', 32, [
    N(0, E3, 3, 1), N(6, G3, 2, 0.85), N(12, B3b, 2, 0.9), N(16, E3, 3, 1), N(22, D3, 2, 0.85), N(26, E3, 4, 0.9),
  ]);
  const preachB = makePattern('B', 32, [
    N(0, E2, 2, 1), N(2, E3, 1, 0.7), N(4, G3, 2, 0.9), N(8, A2, 2, 0.9), N(12, B3b, 4, 1),
    N(16, E3, 2, 1), N(20, G3, 1, 0.8), N(21, A2, 1, 0.8), N(24, D3, 3, 0.9), N(28, E3, 4, 1),
  ]);

  // Breaker lanes: 0 KICK 1 SNARE 2 CLAP 3 HAT 4 OPEN HAT 5 RIM 6 TOM 7 CRASH
  const drumsA = makePattern('A', 32, [
    ...[0, 7, 10, 16, 23, 26, 29].map((s) => N(s, 0, 1, s % 16 === 0 ? 1 : 0.9)),
    ...[4, 12, 20, 28].map((s) => N(s, 1, 1, 1)),
    ...[4, 12, 20, 28].map((s) => N(s, 2, 1, 0.9)), N(30, 2, 1, 0.5),
    ...Array.from({ length: 16 }, (_, i) => N(i * 2, 3, 1, i % 2 ? 0.55 : 0.9)),
    N(14, 4, 1, 0.7), N(30, 4, 1, 0.8),
    N(6, 5, 1, 0.5), N(22, 5, 1, 0.5),
    N(0, 7, 1, 0.55),
  ]);
  const drumsB = makePattern('B', 32, [
    ...[0, 7, 10, 16, 20, 23, 26].map((s) => N(s, 0, 1, 0.95)),
    ...[4, 12, 20, 28, 30].map((s) => N(s, 1, 1, s === 30 ? 0.6 : 1)),
    ...[4, 12, 20, 28].map((s) => N(s, 2, 1, 0.9)),
    ...Array.from({ length: 12 }, (_, i) => N(i * 2, 3, 1, i % 2 ? 0.55 : 0.9)),
    ...[24, 25, 26, 27, 28, 29, 30, 31].map((s, i) => N(s, 3, 1, 0.5 + i * 0.06)),
    N(14, 4, 1, 0.7),
    N(6, 5, 1, 0.5), N(13, 5, 1, 0.5), N(22, 5, 1, 0.5),
    N(27, 6, 1, 0.8), N(29, 6, 1, 0.9), N(31, 6, 1, 1),
  ]);

  // Carousel: slices of the resampled sermon. Slice indices; the demo bakes 8 slices.
  const chopA = makePattern('A', 32, [
    N(0, 0, 2, 1), N(2, 1, 2, 0.9), N(4, 2, 2, 1), N(6, 3, 2, 0.9), N(8, 4, 2, 1), N(10, 5, 2, 0.9),
    N(12, 6, 1, 1), N(13, 6, 1, 0.8), N(14, 7, 1, 1), N(15, 7, 1, 0.7),
    N(16, 0, 2, 1), N(18, 2, 2, 0.9), N(20, 4, 2, 1), N(22, 1, 2, 0.9, { r: 1 }), N(24, 6, 2, 1), N(26, 3, 2, 0.9),
    N(28, 5, 1, 1), N(29, 5, 1, 0.8), N(30, 7, 1, 1, { r: 1 }), N(31, 2, 1, 0.9),
  ]);

  const devices = [
    { id: 'breaker', type: 'breaker', params: defaultParams('breaker'), muted: false, patterns: [drumsA, drumsB] },
    { id: 'hearse', type: 'hearse', params: defaultParams('hearse'), muted: false, patterns: [hearseA, hearseB] },
    { id: 'cathedral', type: 'cathedral', params: defaultParams('cathedral'), muted: false, patterns: [cathA, cathB] },
    { id: 'preacher', type: 'preacher', params: defaultParams('preacher'), muted: false, patterns: [preachA, preachB] },
    { id: 'carousel', type: 'carousel', params: defaultParams('carousel'), muted: false, patterns: [chopA],
      audio: null }, // filled by the engine at first coin drop (bakes the resample)
  ];

  // arrangement: blocks per device: { bar, bars, pat }
  const blocks = (arr) => arr.map(([bar, bars, pat]) => ({ id: id('blk'), bar, bars, pat }));
  const arrangement = {
    bars: 16,
    tracks: {
      breaker: blocks([[0, 6, drumsA.id], [6, 2, drumsB.id], [8, 6, drumsA.id], [14, 2, drumsB.id]]),
      hearse: blocks([[0, 8, hearseA.id], [8, 6, hearseA.id], [14, 2, hearseB.id]]),
      cathedral: blocks([[4, 8, cathA.id], [12, 4, cathB.id]]),
      preacher: blocks([[0, 4, preachA.id], [8, 4, preachB.id], [12, 4, preachA.id]]),
      carousel: blocks([[4, 4, chopA.id], [10, 6, chopA.id]]),
    },
  };

  return {
    format: FORMAT,
    version: VERSION,
    title: 'HEARSE RIDE AT 2 A.M.',
    author: '',
    bpm: 136,
    swing: 0.08,
    screw: 0,
    master: Object.fromEntries(MASTER_PARAMS.map((p) => [p.id, p.def])),
    devices,
    arrangement,
    meta: { created: new Date().toISOString(), app: 'NOISE Select-O-Matic', url: 'https://noise.patpadgett.com' },
  };
}

export function emptySong() {
  const devices = Object.keys(DEVICE_TYPES).map((type) => ({
    id: type, type, params: defaultParams(type), muted: false,
    patterns: [makePattern('A', 32, [])], audio: type === 'carousel' ? null : undefined,
  }));
  return {
    format: FORMAT, version: VERSION, title: 'UNTITLED', author: '', bpm: 136, swing: 0.08, screw: 0,
    master: Object.fromEntries(MASTER_PARAMS.map((p) => [p.id, p.def])),
    devices,
    arrangement: { bars: 8, tracks: Object.fromEntries(devices.map((d) => [d.id, []])) },
    meta: { created: new Date().toISOString(), app: 'NOISE Select-O-Matic', url: 'https://noise.patpadgett.com' },
  };
}

export function findDevice(song, idOrType) {
  return song.devices.find((d) => d.id === idOrType) || song.devices.find((d) => d.type === idOrType);
}
export function findPattern(dev, patId) { return dev.patterns.find((p) => p.id === patId); }

export function blockAt(song, deviceId, bar) {
  const track = song.arrangement.tracks[deviceId] || [];
  return track.find((b) => bar >= b.bar && bar < b.bar + b.bars) || null;
}

// Events for one absolute step (0-based across the arrangement). Returns [{device, note}].
export function eventsAtStep(song, absStep) {
  const bar = Math.floor(absStep / STEPS_PER_BAR);
  const stepInBar = absStep % STEPS_PER_BAR;
  const out = [];
  for (const dev of song.devices) {
    const blk = blockAt(song, dev.id, bar);
    if (!blk) continue;
    const pat = findPattern(dev, blk.pat);
    if (!pat) continue;
    const local = ((bar - blk.bar) * STEPS_PER_BAR + stepInBar) % pat.steps;
    for (const n of pat.notes) if (n.s === local) out.push({ device: dev, note: n });
  }
  return out;
}

export function validateSong(obj) {
  if (!obj || obj.format !== FORMAT) throw new Error('Not a NOISE song file (missing format: noise-song).');
  if (!Array.isArray(obj.devices) || !obj.arrangement) throw new Error('Song file is missing devices or arrangement.');
  const song = { ...emptySong(), ...obj };
  song.devices = song.devices.filter((d) => DEVICE_TYPES[d.type]).map((d) => ({
    ...d,
    params: { ...defaultParams(d.type), ...(d.params || {}) },
    patterns: (d.patterns || []).map((p) => ({ id: p.id || id('pat'), name: p.name || 'A', steps: p.steps || 32, notes: (p.notes || []).map((n) => ({ s: n.s | 0, n: n.n | 0, l: Math.max(1, n.l | 0 || 1), v: n.v ?? 1, ...(n.g ? { g: 1 } : {}), ...(n.r ? { r: 1 } : {}) })) })),
  }));
  for (const type of Object.keys(DEVICE_TYPES)) {
    if (!song.devices.find((d) => d.type === type)) {
      song.devices.push({ id: type, type, params: defaultParams(type), muted: false, patterns: [makePattern('A', 32, [])], audio: type === 'carousel' ? null : undefined });
    }
  }
  song.arrangement.tracks = song.arrangement.tracks || {};
  for (const d of song.devices) {
    song.arrangement.tracks[d.id] = (song.arrangement.tracks[d.id] || []).map((b) => ({ id: b.id || id('blk'), bar: b.bar | 0, bars: Math.max(1, b.bars | 0 || 1), pat: b.pat }));
    if (!d.patterns.length) d.patterns.push(makePattern('A', 32, []));
  }
  song.arrangement.bars = Math.max(1, song.arrangement.bars | 0 || 8);
  song.bpm = Math.min(200, Math.max(60, +song.bpm || 136));
  song.swing = Math.min(0.5, Math.max(0, +song.swing || 0));
  song.screw = Math.min(3, Math.max(-7, +song.screw || 0));
  song.master = Object.fromEntries(MASTER_PARAMS.map((p) => [p.id, song.master?.[p.id] ?? p.def]));
  return song;
}

// ---------- undo ----------
export class History {
  constructor(limit = 60) { this.stack = []; this.redo = []; this.limit = limit; }
  snapshot(song) {
    const { devices, arrangement, bpm, swing, title, master, screw } = song;
    const light = JSON.stringify({ bpm, swing, title, master, screw, arrangement,
      devices: devices.map((d) => ({ ...d, audio: d.audio ? { slices: d.audio.slices, source: '@keep' } : d.audio })) });
    if (this.stack.length && this.stack[this.stack.length - 1] === light) return;
    this.stack.push(light);
    if (this.stack.length > this.limit) this.stack.shift();
    this.redo.length = 0;
  }
  restore(song, str) {
    const o = JSON.parse(str);
    Object.assign(song, { bpm: o.bpm, swing: o.swing, title: o.title, master: o.master, screw: o.screw, arrangement: o.arrangement });
    const oldAudio = Object.fromEntries(song.devices.map((d) => [d.id, d.audio]));
    song.devices = o.devices.map((d) => ({ ...d, audio: d.audio ? { ...oldAudio[d.id], slices: d.audio.slices } : d.audio }));
  }
  undo(song) {
    if (this.stack.length < 2) return false;
    this.redo.push(this.stack.pop());
    this.restore(song, this.stack[this.stack.length - 1]);
    return true;
  }
  redoStep(song) {
    if (!this.redo.length) return false;
    const s = this.redo.pop();
    this.stack.push(s);
    this.restore(song, s);
    return true;
  }
}
