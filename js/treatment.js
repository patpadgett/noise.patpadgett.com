// CUE — the treatment prompt. Shared verbatim by the browser client (js/azure.js) and the demo
// cue-sheet generator, so the demo is exactly what a visitor's song would get.
export const TREATMENT_SYSTEM = `You are a music-video director and lighting designer writing a running order (cue sheet) for a song.
You receive: the song's measured facts (tempo, bar start times, per-bar loudness 0..1, key, duration), the lyrics the artist pasted (stanzas separated by blank lines), where the singer sings each line (word timestamps from speech recognition; they may be noisy or missing), and sometimes the artist's DIRECTION: a few words on where and when the video lives, its look, or things every shot must include.

Write a treatment as cues. Rules:
- Every cue is anchored to a musical event you can name from the facts: a bar number, a section start (intro, verse 1, chorus 2, bridge, outro), a drop or lift (a jump in bar loudness), a specific lyric line landing. Name that anchor in "anchor". Never anchor to a bare timestamp.
- "in" is the bar number (1-based) the cue starts on; "beat" is 1..4 within it (1 if unsure); "bars" is its length in bars.
- Two cue kinds: "scene" (a new piece of footage: write "shot" as a 1-2 sentence Sora 2 video prompt in the music's style and the lyrics' tone: subject, setting, camera move, light, film stock; never real people, celebrities, brand names, copyrighted characters, or on-screen text; no faces in close-up), "light" (strobes, flashes, pulses, washes, blackouts, tied to the beat: write "effect" as one of strobe|pulse|flash|wash|blackout|flicker plus "rate" in hits per beat for strobe/pulse and "color" as a hex).
- The lyrics are for you, not for the screen: read them for mood, story and the exact lines to anchor on. Never put lyrics, words, letters, captions or titles in any shot; the video carries no text of any kind.
- If the artist gave a DIRECTION, every scene's shot honours it literally (a place is that place, a time of day is that time of day, a named look is that look), the palette follows it, and the title treatment says how.
- The "cue" field is the sentence a director would call, in plain English with the anchor inside it, e.g. "Bass drop into the second chorus — strobes pulse with the hats for 14 seconds, white." Timings in that sentence are in seconds or bars, derived from the facts.
- Cover the whole song with scenes (every bar is inside some scene; prefer 4- or 8-bar scenes). Footage comes in 4, 8 or 12 second clips and a clip plays slowed to fill a longer scene, so a scene over 12 seconds is slow motion; use that on purpose or keep the scene shorter. Lights layer on top.
- Match the tone: read the lyrics for mood (grief, swagger, longing, rage, joy) and the music for energy; the shots, colours and effects must come from those, not from a generic "music video" look.
- If the treatment uses strobes, set the top-level "strobe_warning": true.
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
      required: ['n', 'kind', 'in', 'beat', 'bars', 'anchor', 'cue', 'shot', 'effect', 'rate', 'color'],
      properties: {
        n: { type: 'integer' }, kind: { type: 'string', enum: ['scene', 'light'] },
        in: { type: 'integer' }, beat: { type: 'integer' }, bars: { type: 'number' },
        anchor: { type: 'string' }, cue: { type: 'string' },
        shot: { type: 'string' }, effect: { type: 'string', enum: ['strobe', 'pulse', 'flash', 'wash', 'blackout', 'flicker', 'none'] }, rate: { type: 'number' }, color: { type: 'string' },
      } } },
    strobe_warning: { type: 'boolean' },
  },
};

export function treatmentUserMessage({ title, analysis, lyrics, aligned, direction = '' }) {
  const bars = analysis.barStarts.map((t, i) => `${i + 1}:${t.toFixed(1)}s:${analysis.barLoud[i]}`).join(' ');
  return `SONG: ${title}
DIRECTION FROM THE ARTIST (every shot honours this): ${String(direction || '').trim() || '(none given — take the setting and look from the lyrics and the music)'}
TEMPO: ${analysis.bpm} BPM · KEY: ${analysis.keyName} · DURATION: ${analysis.duration}s · ${analysis.barStarts.length} bars (4/4)
BARS (number:start seconds:loudness 0-1): ${bars}

LYRICS AS PASTED (for mood and anchors only; never shown on screen):
${lyrics}

WHERE THE SINGER SINGS (line → seconds, from speech recognition; blank if not found):
${aligned.map((l) => `${l.text} → ${l.start == null ? '' : l.start.toFixed(1) + 's'}`).join('\n')}`;
}
