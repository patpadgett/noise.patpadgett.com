// Edit operations: one reducer both windows run. The main window is authoritative; the detached
// editor applies ops optimistically and then accepts the main window's snapshot.
import { findDevice, findPattern, id as mkId, STEPS_PER_BAR } from './song.js';

export function applyOp(song, op) {
  switch (op.type) {
    case 'addNote': {
      const pat = pat_(song, op);
      if (!pat) return false;
      const n = { s: op.note.s | 0, n: op.note.n | 0, l: Math.max(1, op.note.l | 0 || 1), v: op.note.v ?? 1 };
      if (op.note.g) n.g = 1;
      if (op.note.r) n.r = 1;
      pat.notes = pat.notes.filter((x) => !(x.n === n.n && overlaps(x.s, x.s + x.l, n.s, n.s + n.l)));
      pat.notes.push(n);
      pat.notes.sort((a, b) => a.s - b.s || a.n - b.n);
      return true;
    }
    case 'removeNote': {
      const pat = pat_(song, op);
      if (!pat) return false;
      const before = pat.notes.length;
      pat.notes = pat.notes.filter((x) => !(x.s === op.s && x.n === op.n));
      return pat.notes.length !== before;
    }
    case 'updateNote': {
      const pat = pat_(song, op);
      if (!pat) return false;
      const note = pat.notes.find((x) => x.s === op.s && x.n === op.n);
      if (!note) return false;
      const c = op.changes || {};
      const next = { ...note, ...c };
      next.s = Math.max(0, Math.min(pat.steps - 1, next.s | 0));
      next.l = Math.max(1, Math.min(pat.steps - next.s, next.l | 0 || 1));
      next.v = Math.max(0.05, Math.min(1, +next.v || 1));
      if (!next.g) delete next.g;
      if (!next.r) delete next.r;
      pat.notes = pat.notes.filter((x) => x !== note && !(x.n === next.n && overlaps(x.s, x.s + x.l, next.s, next.s + next.l)));
      pat.notes.push(next);
      pat.notes.sort((a, b) => a.s - b.s || a.n - b.n);
      return true;
    }
    case 'clearPattern': {
      const pat = pat_(song, op);
      if (!pat) return false;
      pat.notes = [];
      return true;
    }
    case 'setPatternSteps': {
      const pat = pat_(song, op);
      if (!pat) return false;
      const steps = [16, 32, 64].includes(op.steps) ? op.steps : 32;
      if (steps < pat.steps) pat.notes = pat.notes.filter((n) => n.s < steps).map((n) => ({ ...n, l: Math.min(n.l, steps - n.s) }));
      pat.steps = steps;
      return true;
    }
    case 'addPattern': {
      const dev = findDevice(song, op.deviceId);
      if (!dev) return false;
      const src = op.copyFrom ? findPattern(dev, op.copyFrom) : null;
      const p = { id: op.pattern?.id || mkId('pat'), name: op.pattern?.name || nextName(dev), steps: src ? src.steps : (op.pattern?.steps || 32), notes: src ? src.notes.map((n) => ({ ...n })) : [] };
      dev.patterns.push(p);
      return true;
    }
    case 'renamePattern': {
      const pat = pat_(song, op);
      if (!pat) return false;
      pat.name = String(op.name || '').slice(0, 12) || pat.name;
      return true;
    }
    case 'removePattern': {
      const dev = findDevice(song, op.deviceId);
      if (!dev || dev.patterns.length < 2) return false;
      dev.patterns = dev.patterns.filter((p) => p.id !== op.patId);
      const fallback = dev.patterns[0].id;
      song.arrangement.tracks[dev.id] = (song.arrangement.tracks[dev.id] || []).map((b) => b.pat === op.patId ? { ...b, pat: fallback } : b);
      return true;
    }
    case 'addBlock': {
      const dev = findDevice(song, op.deviceId);
      if (!dev) return false;
      const track = song.arrangement.tracks[dev.id] || (song.arrangement.tracks[dev.id] = []);
      const b = { id: op.block.id || mkId('blk'), bar: Math.max(0, op.block.bar | 0), bars: Math.max(1, op.block.bars | 0 || 1), pat: op.block.pat || dev.patterns[0].id };
      resolveBlocks(track, b);
      track.push(b);
      track.sort((x, y) => x.bar - y.bar);
      growBars(song, b);
      return true;
    }
    case 'updateBlock': {
      const dev = findDevice(song, op.deviceId);
      if (!dev) return false;
      const track = song.arrangement.tracks[dev.id] || [];
      const b = track.find((x) => x.id === op.id);
      if (!b) return false;
      Object.assign(b, op.changes);
      b.bar = Math.max(0, b.bar | 0);
      b.bars = Math.max(1, b.bars | 0 || 1);
      resolveBlocks(track, b);
      track.sort((x, y) => x.bar - y.bar);
      growBars(song, b);
      return true;
    }
    case 'removeBlock': {
      const dev = findDevice(song, op.deviceId);
      if (!dev) return false;
      const track = song.arrangement.tracks[dev.id] || [];
      const before = track.length;
      song.arrangement.tracks[dev.id] = track.filter((x) => x.id !== op.id);
      return song.arrangement.tracks[dev.id].length !== before;
    }
    case 'setBars': {
      song.arrangement.bars = Math.max(1, Math.min(128, op.bars | 0));
      for (const k of Object.keys(song.arrangement.tracks)) {
        song.arrangement.tracks[k] = song.arrangement.tracks[k].filter((b) => b.bar < song.arrangement.bars).map((b) => ({ ...b, bars: Math.min(b.bars, song.arrangement.bars - b.bar) }));
      }
      return true;
    }
    case 'setBpm': song.bpm = Math.max(60, Math.min(200, +op.bpm || song.bpm)); return true;
    case 'setSwing': song.swing = Math.max(0, Math.min(0.5, +op.swing || 0)); return true;
    case 'setTitle': song.title = String(op.title || '').slice(0, 40) || 'UNTITLED'; return true;
    case 'setParam': {
      const dev = findDevice(song, op.deviceId);
      if (!dev) return false;
      dev.params[op.param] = op.value;
      return true;
    }
    case 'setMuted': {
      const dev = findDevice(song, op.deviceId);
      if (!dev) return false;
      dev.muted = !!op.muted;
      return true;
    }
    case 'setMaster': song.master[op.param] = op.value; return true;
    case 'setScrew': song.screw = Math.max(-7, Math.min(3, op.screw | 0)); return true;
    default: return false;
  }
}

function pat_(song, op) {
  const dev = findDevice(song, op.deviceId);
  return dev && findPattern(dev, op.patId);
}
const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
function nextName(dev) {
  const letters = 'ABCDEFGHIJKLMNOP';
  for (const l of letters) if (!dev.patterns.find((p) => p.name === l)) return l;
  return 'P' + (dev.patterns.length + 1);
}
function resolveBlocks(track, b) {
  for (let i = track.length - 1; i >= 0; i--) {
    const o = track[i];
    if (o === b || o.id === b.id) continue;
    const o0 = o.bar, o1 = o.bar + o.bars, b0 = b.bar, b1 = b.bar + b.bars;
    if (!overlaps(o0, o1, b0, b1)) continue;
    if (b0 <= o0 && b1 >= o1) { track.splice(i, 1); continue; }
    if (o0 < b0 && o1 > b1) { // split: keep the left part, add right part
      o.bars = b0 - o0;
      track.push({ id: mkId('blk'), bar: b1, bars: o1 - b1, pat: o.pat });
      continue;
    }
    if (o0 < b0) o.bars = b0 - o0;
    else { o.bar = b1; o.bars = o1 - b1; }
  }
}
function growBars(song, b) {
  const end = b.bar + b.bars;
  if (end > song.arrangement.bars) song.arrangement.bars = Math.min(128, end);
}

export { STEPS_PER_BAR };
