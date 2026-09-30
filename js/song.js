// Song model: the whole workstation state as plain JSON, plus the demo track.
// File format `.noise.json`: { format: "noise-song", version: 1, ... }. Audio rides inside as
// base64 WAV data URIs so the file opens anywhere without a codec.

export const FORMAT = 'noise-song';
export const VERSION = 1;
export const STEPS_PER_BAR = 16;

export const DEVICE_TYPES = {
  hearse: {
    name: 'TRUNK', tag: '808 · SLIDES · RATTLES THE PLATE', kind: 'melodic', color: 'magenta',
    rows: { low: 24, high: 48 }, // C1..C3
    params: [
      { id: 'decay', label: 'DECAY', min: 0.15, max: 2.5, def: 0.6, unit: 's' },
      { id: 'glide', label: 'GLIDE', min: 0.02, max: 0.6, def: 0.12, unit: 's' },
      { id: 'coffin', label: 'DRIVE', min: 0, max: 1, def: 0.62, unit: '%' },
      { id: 'tone', label: 'TONE', min: 120, max: 4000, def: 1600, unit: 'Hz', log: true },
      { id: 'rumble', label: 'SUB', min: 0, max: 1, def: 0.4, unit: '%' },
      { id: 'level', label: 'LEVEL', min: 0, max: 1, def: 0.86, unit: '%' },
    ],
  },
  cathedral: {
    name: 'LAZERBELL', tag: 'COWBELL LEAD · THE HOOK', kind: 'melodic', color: 'cyan',
    rows: { low: 55, high: 84 }, // G3..C6
    params: [
      { id: 'decay', label: 'DECAY', min: 0.05, max: 1.2, def: 0.38, unit: 's' },
      { id: 'bell', label: 'BELL', min: 1.2, max: 2.2, def: 1.48, unit: '×' },
      { id: 'choir', label: 'STACK', min: 0, max: 1, def: 0.55, unit: '%' },
      { id: 'grit', label: 'GRIT', min: 0, max: 1, def: 0.55, unit: '%' },
      { id: 'nave', label: 'HALL', min: 0, max: 1, def: 0.28, unit: '%' },
      { id: 'level', label: 'LEVEL', min: 0, max: 1, def: 0.92, unit: '%' },
    ],
  },
  preacher: {
    name: 'TALKBOX', tag: 'FORMANT CHANTS · HEY', kind: 'melodic', color: 'magenta',
    rows: { low: 40, high: 64 }, // E2..E4
    params: [
      { id: 'vowel', label: 'VOWEL', min: 0, max: 4, def: 0.5, unit: 'vowel' },
      { id: 'throat', label: 'THROAT', min: 0, max: 1, def: 0.7, unit: '%' },
      { id: 'grit', label: 'GRIT', min: 0, max: 1, def: 0.6, unit: '%' },
      { id: 'sermon', label: 'WOBBLE', min: 0, max: 1, def: 0.15, unit: '%' },
      { id: 'tail', label: 'TAIL', min: 0, max: 1, def: 0.18, unit: '%' },
      { id: 'octave', label: 'OCTAVE', min: -1, max: 1, def: 0, unit: 'oct', step: 1 },
      { id: 'level', label: 'LEVEL', min: 0, max: 1, def: 0.5, unit: '%' },
    ],
  },
  breaker: {
    name: 'V12', tag: 'DRUM MACHINE · TWELVE CYLINDERS', kind: 'drums', color: 'cyan',
    lanes: ['KICK', 'SNARE', 'CLAP', 'HAT', 'OPEN HAT', 'RIM', 'TOM', 'CRASH'],
    params: [
      { id: 'memphis', label: 'MEMPHIS', min: 0, max: 1, def: 0.55, unit: '%' },
      { id: 'decay', label: 'DECAY', min: 0.4, max: 2, def: 1, unit: '×' },
      { id: 'level', label: 'LEVEL', min: 0, max: 1, def: 0.95, unit: '%' },
    ],
  },
  carousel: {
    name: 'TAPE DECK', tag: 'SLICE PLAYER · CHOPPED CASSETTE', kind: 'slices', color: 'cyan',
    params: [
      { id: 'pitch', label: 'PITCH', min: -12, max: 12, def: -2, unit: 'st', step: 1 },
      { id: 'gate', label: 'GATE', min: 0.1, max: 1, def: 0.9, unit: '%' },
      { id: 'tape', label: 'TAPE', min: 800, max: 16000, def: 5500, unit: 'Hz', log: true },
      { id: 'wobble', label: 'WOBBLE', min: 0, max: 1, def: 0.18, unit: '%' },
      { id: 'level', label: 'LEVEL', min: 0, max: 1, def: 0.72, unit: '%' },
    ],
  },
};

export const MASTER_PARAMS = [
  { id: 'saturation', label: 'SAT', min: 0, max: 1, def: 0.6, unit: '%' },
  { id: 'tone', label: 'TONE', min: 2000, max: 18000, def: 9000, unit: 'Hz', log: true },
  { id: 'wow', label: 'WOW', min: 0, max: 1, def: 0.18, unit: '%' },
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
  // COUNTACH DRIFT: 140 BPM drift phonk in E minor with the phrygian F. Half-time trap drums, a
  // distorted 808 riding the kicks and sliding into the b2, a constant-8th cowbell hook, talkbox
  // chants on the "and" of 2 and 4, chopped cassette stabs. Four-bar intro, drop at bar 5, B at 13.
  const C1 = 24, D1 = 26, E1 = 28, F1 = 29, G1 = 31, A1 = 33;
  const trunkA = makePattern('A', 32, [
    N(0, E1, 6, 1), N(6, E1, 3, 0.95), N(10, G1, 2, 0.9, { g: 1 }), N(12, E1, 4, 1, { g: 1 }),
    N(16, E1, 6, 1), N(22, D1, 2, 0.9), N(24, E1, 2, 1, { g: 1 }), N(26, E1, 2, 0.9), N(28, A1, 2, 0.9), N(30, E1, 2, 1, { g: 1 }),
  ]);
  const trunkB = makePattern('B', 32, [
    N(0, E1, 4, 1), N(4, E1, 2, 0.9), N(6, F1, 2, 0.95, { g: 1 }), N(8, E1, 4, 1, { g: 1 }), N(13, E1, 1, 0.7), N(14, E1, 2, 0.9),
    N(16, E1, 4, 1), N(20, G1, 2, 0.9), N(22, A1, 2, 0.95, { g: 1 }), N(24, E1, 4, 1, { g: 1 }), N(28, D1, 2, 0.9), N(30, E1, 2, 1, { g: 1 }),
  ]);

  const E4 = 64, F4 = 65, G4 = 67, B4 = 71, C5 = 72, D5 = 74, E5 = 76;
  const bellA = makePattern('A', 32, [
    N(0, E4, 1, 1), N(2, E4, 1, 0.85), N(4, G4, 1, 0.95), N(6, E4, 1, 0.85), N(8, B4, 1, 1), N(10, G4, 1, 0.9), N(12, F4, 1, 0.95), N(14, E4, 1, 0.85),
    N(16, E4, 1, 1), N(18, E4, 1, 0.85), N(20, G4, 1, 0.95), N(22, E4, 1, 0.85), N(24, D5, 1, 1), N(26, B4, 1, 0.9), N(28, G4, 1, 0.9), N(30, F4, 1, 0.95), N(31, E4, 1, 0.7),
  ]);
  const bellB = makePattern('B', 32, [
    N(0, E5, 1, 1), N(1, E5, 1, 0.6), N(2, E5, 1, 0.9), N(4, D5, 1, 0.95), N(6, B4, 1, 0.9), N(8, C5, 1, 1), N(10, B4, 1, 0.9), N(12, G4, 1, 0.9), N(14, F4, 1, 0.95),
    N(16, E5, 1, 1), N(18, E5, 1, 0.85), N(20, D5, 1, 0.95), N(22, B4, 1, 0.9), N(24, E5, 1, 1), N(25, E5, 1, 0.6), N(26, D5, 1, 0.9), N(28, B4, 1, 0.9), N(30, G4, 1, 0.9), N(31, F4, 1, 0.95),
  ]);

  const E2 = 40, E3 = 52, F3 = 53, G3 = 55;
  const talkIntro = makePattern('INTRO', 32, [
    N(2, E3, 1, 0.9), N(6, E3, 1, 0.9), N(10, G3, 1, 0.85), N(14, E3, 1, 0.9), N(18, E3, 1, 0.9), N(22, F3, 1, 0.9), N(26, E3, 1, 0.9), N(29, E3, 1, 0.7), N(30, E2, 2, 1),
  ]);
  const talkA = makePattern('A', 32, [N(6, E3, 1, 0.95), N(14, E3, 1, 0.95), N(22, G3, 1, 0.9), N(30, E3, 1, 0.95)]);
  const talkB = makePattern('B', 32, [N(6, E3, 1, 0.95), N(7, E3, 1, 0.6), N(14, F3, 1, 0.95), N(22, E3, 1, 0.95), N(28, E2, 3, 1), N(31, E3, 1, 0.7)]);

  // V12 lanes: 0 KICK 1 SNARE 2 CLAP 3 HAT 4 OPEN HAT 5 RIM 6 TOM 7 CRASH
  const hats8 = (v1, v2) => Array.from({ length: 16 }, (_, i) => N(i * 2, 3, 1, i % 2 ? v2 : v1));
  const drumsIntro = makePattern('INTRO', 32, [
    ...hats8(0.8, 0.5), N(13, 3, 1, 0.45), N(15, 3, 1, 0.55), N(29, 3, 1, 0.5), N(30, 3, 1, 0.6), N(31, 3, 1, 0.7),
    N(8, 1, 1, 0.9), N(24, 1, 1, 0.95),
    N(8, 2, 1, 0.85), N(24, 2, 1, 0.85), N(30, 2, 1, 0.45),
    N(14, 4, 1, 0.65), N(30, 4, 1, 0.65),
    N(5, 5, 1, 0.4), N(21, 5, 1, 0.4),
  ]);
  const drumsA = makePattern('A', 32, [
    ...[[0, 1], [6, 0.95], [10, 0.9], [16, 1], [22, 0.95], [26, 0.9], [29, 0.55]].map(([s, v]) => N(s, 0, 1, v)),
    N(8, 1, 1, 1), N(24, 1, 1, 1), N(31, 1, 1, 0.5),
    N(8, 2, 1, 0.9), N(24, 2, 1, 0.9), N(30, 2, 1, 0.45),
    ...hats8(0.85, 0.5), N(13, 3, 1, 0.45), N(15, 3, 1, 0.55), N(27, 3, 1, 0.45), N(29, 3, 1, 0.55), N(31, 3, 1, 0.65),
    N(14, 4, 1, 0.7), N(30, 4, 1, 0.75),
    N(5, 5, 1, 0.45), N(12, 5, 1, 0.35), N(21, 5, 1, 0.45),
    N(0, 7, 1, 0.5),
  ]);
  const drumsB = makePattern('B', 32, [
    ...[[0, 1], [6, 0.95], [10, 0.9], [13, 0.6], [16, 1], [22, 0.95], [26, 0.9], [28, 0.8]].map(([s, v]) => N(s, 0, 1, v)),
    N(8, 1, 1, 1), N(24, 1, 1, 1), N(28, 1, 1, 0.7), N(30, 1, 1, 0.5),
    N(8, 2, 1, 0.9), N(24, 2, 1, 0.9), N(12, 2, 1, 0.4), N(28, 2, 1, 0.6),
    ...Array.from({ length: 32 }, (_, i) => N(i, 3, 1, i % 4 === 0 ? 0.9 : i % 2 === 0 ? 0.6 : 0.4)),
    N(6, 4, 1, 0.5), N(14, 4, 1, 0.7), N(30, 4, 1, 0.75),
    N(27, 6, 1, 0.7), N(29, 6, 1, 0.85), N(31, 6, 1, 1),
    N(0, 7, 1, 0.6),
  ]);

  // TAPE DECK: 8 slices of the baked chant tape (see Engine.bakeDemoSample)
  const chopA = makePattern('A', 32, [
    N(3, 0, 1, 0.9), N(7, 7, 1, 0.75), N(11, 1, 1, 0.9), N(15, 5, 1, 0.7), N(19, 2, 1, 0.9), N(23, 6, 1, 0.8), N(27, 3, 1, 0.9), N(30, 4, 1, 0.8, { r: 1 }),
  ]);
  const chopRise = makePattern('RISE', 32, [
    N(0, 0, 2, 1), N(2, 1, 2, 0.9), N(4, 2, 2, 1), N(6, 3, 2, 0.9), N(8, 4, 2, 1), N(10, 5, 2, 0.9), N(12, 6, 1, 1), N(13, 6, 1, 0.8), N(14, 7, 1, 1), N(15, 7, 1, 0.7),
    N(16, 0, 1, 1), N(17, 1, 1, 0.9), N(18, 2, 1, 1), N(19, 3, 1, 0.9), N(20, 4, 1, 1), N(21, 5, 1, 0.9), N(22, 6, 1, 1), N(23, 7, 1, 0.9),
    N(24, 0, 1, 1), N(25, 0, 1, 0.8), N(26, 1, 1, 1), N(27, 1, 1, 0.8), N(28, 2, 1, 1), N(29, 2, 1, 0.8), N(30, 3, 1, 1, { r: 1 }), N(31, 3, 1, 0.9, { r: 1 }),
  ]);

  const devices = [
    { id: 'breaker', type: 'breaker', params: defaultParams('breaker'), muted: false, patterns: [drumsIntro, drumsA, drumsB] },
    { id: 'hearse', type: 'hearse', params: defaultParams('hearse'), muted: false, patterns: [trunkA, trunkB] },
    { id: 'cathedral', type: 'cathedral', params: defaultParams('cathedral'), muted: false, patterns: [bellA, bellB] },
    { id: 'preacher', type: 'preacher', params: defaultParams('preacher'), muted: false, patterns: [talkIntro, talkA, talkB] },
    { id: 'carousel', type: 'carousel', params: defaultParams('carousel'), muted: false, patterns: [chopA, chopRise],
      audio: null }, // baked by the engine at ignition
  ];

  const blocks = (arr) => arr.map(([bar, bars, pat]) => ({ id: id('blk'), bar, bars, pat }));
  const arrangement = {
    bars: 16,
    tracks: {
      breaker: blocks([[0, 4, drumsIntro.id], [4, 8, drumsA.id], [12, 4, drumsB.id]]),
      hearse: blocks([[4, 8, trunkA.id], [12, 4, trunkB.id]]),
      cathedral: blocks([[0, 8, bellA.id], [8, 4, bellB.id], [12, 4, bellA.id]]),
      preacher: blocks([[0, 4, talkIntro.id], [4, 8, talkA.id], [12, 4, talkB.id]]),
      carousel: blocks([[2, 2, chopRise.id], [6, 6, chopA.id], [12, 4, chopA.id]]),
    },
  };

  return {
    format: FORMAT,
    version: VERSION,
    title: 'COUNTACH DRIFT',
    author: '',
    bpm: 140,
    swing: 0.04,
    screw: 0,
    master: Object.fromEntries(MASTER_PARAMS.map((p) => [p.id, p.def])),
    devices,
    arrangement,
    meta: { created: new Date().toISOString(), app: 'NOISE Midnight Countach', url: 'https://noise.patpadgett.com' },
  };
}

export function emptySong() {
  const devices = Object.keys(DEVICE_TYPES).map((type) => ({
    id: type, type, params: defaultParams(type), muted: false,
    patterns: [makePattern('A', 32, [])], audio: type === 'carousel' ? null : undefined,
  }));
  return {
    format: FORMAT, version: VERSION, title: 'UNTITLED', author: '', bpm: 140, swing: 0.04, screw: 0,
    master: Object.fromEntries(MASTER_PARAMS.map((p) => [p.id, p.def])),
    devices,
    arrangement: { bars: 8, tracks: Object.fromEntries(devices.map((d) => [d.id, []])) },
    meta: { created: new Date().toISOString(), app: 'NOISE Midnight Countach', url: 'https://noise.patpadgett.com' },
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
