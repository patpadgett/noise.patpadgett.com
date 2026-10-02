// CUE unit checks that need no browser: the scene-length cap, the clip planner, the prompt's numbers.
// Run: node tests/unit.mjs
import assert from 'node:assert/strict';
import { normalizeTreatment, maxSceneBars, MAX_SCENE_SECONDS, cueStart, cueEnd } from '../js/switcher.js';
import { clipSeconds, CLIP_LENGTHS, estimateCost } from '../js/azure.js';
import { treatmentUserMessage } from '../js/treatment.js';

const analysisAt = (bpm, bars = 120) => { const barSec = 4 * 60 / bpm; return { bpm, keyName: 'C major', duration: +(bars * barSec).toFixed(2), barStarts: Array.from({ length: bars }, (_, i) => +(i * barSec).toFixed(3)), barLoud: Array.from({ length: bars }, () => 0.5) }; };
let n = 0; const ok = (msg) => { n++; console.log('  ok', msg); };

// ---- the cap is one Sora clip (12 s) plus the planner's 10% slow-motion slack, in whole bars, never below 1 ----
assert.equal(MAX_SCENE_SECONDS, 12 * 1.1);
assert.equal(maxSceneBars(analysisAt(112.35)), 6);   // 2.136 s bars → 6 bars = 12.8 s
assert.equal(maxSceneBars(analysisAt(60)), 3);       // 4 s bars → 3 bars = 12 s
assert.equal(maxSceneBars(analysisAt(180)), 9);      // 1.333 s bars → 9 bars = 12 s
assert.equal(maxSceneBars(analysisAt(40)), 2);       // 6 s bars → 2 bars = 12 s
assert.equal(maxSceneBars(analysisAt(15)), 1);       // 16 s bars: one bar is already over the cap; the planner slows a 12 s clip over it
ok('maxSceneBars at 15/40/60/112/180 BPM');

// ---- an over-long scene is split into consecutive scenes of the same shot; nothing else moves ----
const a = analysisAt(112.35);
const tr = { title_treatment: 't', palette: ['#000'], sections: [], strobe_warning: false, cues: [
  { n: 1, kind: 'scene', in: 1, beat: 1, bars: 20, anchor: 'Bar 1 opening', cue: 'Hold the room', shot: 'A room.', effect: 'none', rate: 0, color: '', },
  { n: 2, kind: 'light', in: 6, beat: 1, bars: 4, anchor: 'Bar 6 lift', cue: 'Pulse', shot: '', effect: 'pulse', rate: 1, color: '#fff' },
  { n: 3, kind: 'lyric', in: 14, beat: 1, bars: 3, anchor: 'old sheet', cue: 'burn in', shot: '', effect: 'none', rate: 0, color: '', lines: 'x', style: 'burn-in' },
  { n: 4, kind: 'scene', in: 21, beat: 1, bars: 4, anchor: 'Bar 21', cue: 'Cut', shot: 'A station.', effect: 'none', rate: 0, color: '' },
] };
const norm = normalizeTreatment(tr, a);
const scenes = norm.cues.filter((c) => c.kind === 'scene'), lights = norm.cues.filter((c) => c.kind === 'light');
assert.equal(norm.cues.some((c) => c.kind === 'lyric'), false, 'lyric cues dropped');
assert.deepEqual(scenes.map((c) => [c.in, c.bars]), [[1, 6], [7, 6], [13, 6], [19, 2], [21, 4]], 'a 20-bar scene becomes 6+6+6+2, the 4-bar scene is untouched');
assert.ok(scenes.every((c) => c.bars <= maxSceneBars(a)), 'every scene within the cap');
assert.equal(scenes.reduce((s, c) => s + c.bars, 0), 24, 'bars covered are preserved');
assert.deepEqual(norm.cues.map((c) => c.n), [1, 2, 3, 4, 5, 6], 'renumbered in time order');
assert.equal(norm.cues[1].kind, 'light', 'the light at bar 6 sits after the scene that starts at bar 1 and before the one at bar 7');
assert.ok(scenes[1].cue.endsWith('(continued)') && scenes[1].shot.includes('new angle') && scenes[0].cue === 'Hold the room', 'continuations say so; the head is unchanged');
for (let i = 1; i < 4; i++) assert.ok(Math.abs(cueEnd(a, scenes[i - 1]) - cueStart(a, scenes[i])) < 1e-6, 'split pieces are contiguous');
assert.equal(normalizeTreatment(norm, a).cues.length, norm.cues.length, 'idempotent');
ok('normalizeTreatment splits, drops lyrics, renumbers, is idempotent');

// ---- the planner picks the shortest Sora length that covers the scene with ≤10% slow motion ----
const beat = 60 / 112.35;
assert.equal(clipSeconds({ bars: 1 }, beat), 4);   // 2.1 s → 4
assert.equal(clipSeconds({ bars: 2 }, beat), 4);   // 4.3 s → 4 (4.4 ≥ 4.3)
assert.equal(clipSeconds({ bars: 3 }, beat), 8);   // 6.4 s → 8
assert.equal(clipSeconds({ bars: 4 }, beat), 8);   // 8.5 s → 8 (8.8 ≥ 8.5)
assert.equal(clipSeconds({ bars: 5 }, beat), 12);  // 10.7 s → 12
assert.equal(clipSeconds({ bars: 6 }, beat), 12);  // 12.8 s → 12 (13.2 ≥ 12.8)
assert.equal(clipSeconds({ bars: 8 }, beat), 12);  // over the cap (only reachable before normalisation): still a legal length
assert.ok(CLIP_LENGTHS.every((s) => [4, 8, 12].includes(s)));
// every scene that survives normalisation plans a legal clip length, at any tempo
for (const bpm of [15, 40, 60, 90, 112.35, 140, 180]) { const an = analysisAt(bpm); const t = normalizeTreatment({ cues: [{ n: 1, kind: 'scene', in: 1, beat: 1, bars: 40, anchor: '', cue: '', shot: 's', effect: 'none', rate: 0, color: '' }] }, an); for (const c of t.cues) assert.ok([4, 8, 12].includes(clipSeconds(c, 60 / bpm)), `legal clip at ${bpm} BPM`); }
const est = estimateCost(norm, a); assert.equal(est.clips, 5); assert.equal(est.seconds, 12 + 12 + 12 + 4 + 8); assert.equal(est.dollars, 4.8);
ok('clipSeconds / estimateCost');

// ---- the prompt tells the model the same cap and an open count ----
const msg = treatmentUserMessage({ title: 'x', analysis: a, lyrics: 'la', aligned: [], direction: 'Jakarta at night' });
assert.match(msg, /MAX SCENE: 6 bars \(12\.8s; the hard cap is 13\.2s\)/);
assert.match(msg, /no upper limit/);
assert.match(msg, /DIRECTION FROM THE ARTIST \(every shot honours this\): Jakarta at night/);
assert.match(treatmentUserMessage({ title: 'x', analysis: analysisAt(60), lyrics: 'la', aligned: [] }), /MAX SCENE: 3 bars \(12\.0s/);
assert.match(treatmentUserMessage({ title: 'x', analysis: a, lyrics: 'la', aligned: [] }), /\(none given/);
ok('treatmentUserMessage states the cap, the open count and the direction');

console.log(`${n} checks passed`);
