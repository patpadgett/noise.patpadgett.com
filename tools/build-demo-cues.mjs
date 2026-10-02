// Build the demo cue sheet: align the demo lyrics to the Azure transcript, then ask gpt-6-astra
// (Azure Foundry, responses API, structured output) for the treatment. Output -> assets/demo/cues.json
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { alignLyrics, flattenWords } from '../js/align.js';
import { TREATMENT_SYSTEM, TREATMENT_SCHEMA, treatmentUserMessage } from '../js/treatment.js';
import { DEMO_TITLE, DEMO_LYRICS } from '../js/demo-lyrics.js';
// The demo's own direction — the same field a visitor fills in. A 1920 record gets a 1920 world.
const DEMO_DIRECTION = 'A rented room and a small-town railway station, 1920, late afternoon into dusk; hand-tinted 35mm, no modern objects';
const S = '/data/pat/.hermes/cache/scratch/cue';
const transcript = JSON.parse(fs.readFileSync(S + '/transcript.json', 'utf8'));
const analysis = JSON.parse(fs.readFileSync(S + '/analysis.json', 'utf8'));
const NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
analysis.keyName = NOTE[analysis.key.root] + ' ' + analysis.key.mode;
const aligned = alignLyrics(DEMO_LYRICS, flattenWords(transcript));
console.log(aligned.map((l) => `${(l.start ?? 0).toFixed(1).padStart(6)}s ${l.estimated ? '~' : ' '} ${l.text}`).join('\n'));
const key = execSync('az cognitiveservices account keys list -n patm-moil89iq-eastus2 -g rg-openclaw-pat --query key1 -o tsv').toString().trim();
const body = {
  model: 'gpt-6-astra',
  reasoning: { effort: 'low' },
  input: [{ role: 'system', content: TREATMENT_SYSTEM }, { role: 'user', content: treatmentUserMessage({ title: DEMO_TITLE, analysis, lyrics: DEMO_LYRICS, aligned, direction: DEMO_DIRECTION }) }],
  text: { format: { type: 'json_schema', name: 'treatment', strict: true, schema: TREATMENT_SCHEMA } },
};
const t0 = Date.now();
const res = await fetch('https://patm-moil89iq-eastus2.openai.azure.com/openai/v1/responses', { method: 'POST', headers: { 'api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const j = await res.json();
if (!res.ok) { console.error(JSON.stringify(j).slice(0, 800)); process.exit(1); }
const text = j.output.flatMap((o) => o.content || []).find((c) => c.type === 'output_text')?.text;
const treatment = JSON.parse(text);
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s · ${j.usage?.input_tokens} in / ${j.usage?.output_tokens} out · ${treatment.cues.length} cues · strobe_warning=${treatment.strobe_warning}`);
console.log(treatment.title_treatment); console.log(treatment.palette.join(' '));
for (const s of treatment.sections) console.log(`  section ${s.name} bar ${s.bar} +${s.bars}`);
for (const c of treatment.cues) console.log(`  #${String(c.n).padStart(2)} ${c.kind.padEnd(5)} bar ${String(c.in).padStart(2)}.${c.beat} +${c.bars} [${c.anchor}] ${c.cue}`);
fs.mkdirSync('assets/demo', { recursive: true });
fs.writeFileSync('assets/demo/cues.json', JSON.stringify({ title: DEMO_TITLE, analysis: { bpm: analysis.bpm, keyName: analysis.keyName, duration: analysis.duration, barStarts: analysis.barStarts, barLoud: analysis.barLoud }, lyrics: DEMO_LYRICS, direction: DEMO_DIRECTION, aligned, treatment, generated: { model: 'gpt-6-astra', at: new Date().toISOString() } }, null, 1));
