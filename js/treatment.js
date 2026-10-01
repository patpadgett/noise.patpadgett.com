// CUE — the treatment prompt. Shared verbatim by the browser client (js/azure.js) and the demo
// cue-sheet generator, so the demo is exactly what a visitor's song would get.
export const TREATMENT_SYSTEM = `You are a music-video director and lighting designer writing a running order (cue sheet) for a song.
You receive: the song's measured facts (tempo, bar start times, per-bar loudness 0..1, key, duration), the lyrics the artist pasted (stanzas separated by blank lines), and where the singer sings each line (word timestamps from speech recognition; they may be noisy or missing).

Write a treatment as cues. Rules:
- Every cue is anchored to a musical event you can name from the facts: a bar number, a section start (intro, verse 1, chorus 2, bridge, outro), a drop or lift (a jump in bar loudness), a specific lyric line landing. Name that anchor in "anchor". Never anchor to a bare timestamp.
- "in" is the bar number (1-based) the cue starts on; "beat" is 1..4 within it (1 if unsure); "bars" is its length in bars.
- Three cue kinds: "scene" (a new piece of footage: write "shot" as a 1-2 sentence Sora 2 video prompt in the music's style and the lyrics' tone: subject, setting, camera move, light, film stock; never real people, celebrities, brand names, copyrighted characters, or on-screen text; no faces in close-up), "light" (strobes, flashes, pulses, washes, blackouts, tied to the beat: write "effect" as one of strobe|pulse|flash|wash|blackout|flicker plus "rate" in hits per beat for strobe/pulse and "color" as a hex), "lyric" (which lines appear on screen and how: write "lines" as the exact lyric text and "style" as one of burn-in|typewriter|slam|whisper).
- The "cue" field is the sentence a director would call, in plain English with the anchor inside it, e.g. "Bass drop into the second chorus — strobes pulse with the hats for 14 seconds, white." Timings in that sentence are in seconds or bars, derived from the facts.
- Cover the whole song with scenes (every bar is inside some scene; scenes are 2-20 seconds long given the tempo; prefer 4- or 8-bar scenes). Lights and lyrics layer on top.
- Match the tone: read the lyrics for mood (grief, swagger, longing, rage, joy) and the music for energy; the shots, colours and effects must come from those, not from a generic "music video" look.
- If the lyrics use strobes, add a top-level "strobe_warning": true.
- Output JSON only, matching the schema. Keep "cue" sentences under 140 characters.`;

export const TREATMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title_treatment', 'palette', 'sections', 'cues', 'strobe_warning'],
  properties: {
    title_treatment: { type: 'string', description: 'Two sentences: the look of the whole video, in the director\'s voice.' },
    palette: { type: 'array', items: { type: 'string' }, description: '3-5 hex colours the video lives in.' },
    sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'bar', 'bars'], properties: { name: { type: 'string' }, bar: { type: 'integer' }, bars: { type: 'integer' } } } },
    cues: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['n', 'kind', 'in', 'beat', 'bars', 'anchor', 'cue', 'shot', 'effect', 'rate', 'color', 'lines', 'style'],
      properties: {
        n: { type: 'integer' }, kind: { type: 'string', enum: ['scene', 'light', 'lyric'] },
        in: { type: 'integer' }, beat: { type: 'integer' }, bars: { type: 'number' },
        anchor: { type: 'string' }, cue: { type: 'string' },
        shot: { type: 'string' }, effect: { type: 'string', enum: ['strobe', 'pulse', 'flash', 'wash', 'blackout', 'flicker', 'none'] }, rate: { type: 'number' }, color: { type: 'string' },
        lines: { type: 'string' }, style: { type: 'string', enum: ['burn-in', 'typewriter', 'slam', 'whisper', 'none'] },
      } } },
    strobe_warning: { type: 'boolean' },
  },
};

export function treatmentUserMessage({ title, analysis, lyrics, aligned }) {
  const bars = analysis.barStarts.map((t, i) => `${i + 1}:${t.toFixed(1)}s:${analysis.barLoud[i]}`).join(' ');
  return `SONG: ${title}
TEMPO: ${analysis.bpm} BPM · KEY: ${analysis.keyName} · DURATION: ${analysis.duration}s · ${analysis.barStarts.length} bars (4/4)
BARS (number:start seconds:loudness 0-1): ${bars}

LYRICS AS PASTED:
${lyrics}

WHERE THE SINGER SINGS (line → seconds, from speech recognition; blank if not found):
${aligned.map((l) => `${l.text} → ${l.start == null ? '' : l.start.toFixed(1) + 's'}`).join('\n')}`;
}
