// CUE — lyric alignment. Pins each pasted lyric line to the second the singer sings it, using the
// word timestamps from Azure fast transcription. Sung vocals transcribe badly, so the matcher is
// forgiving: normalised tokens, a banded dynamic-programming alignment of the lyric word sequence
// against the recognised word sequence (match / substitute / skip either side), then each line
// takes the time of its first matched word. Lines with no confident match get interpolated from
// their neighbours and flagged, so the UI can say "estimated" instead of pretending.
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '').replace(/in'$/, 'ing');
const sim = (a, b) => { if (a === b) return 1; if (!a || !b) return 0; if (a.length > 3 && b.length > 3 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)))) return 0.7; let d = 0; const n = Math.max(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++; return d <= 1 && n > 3 ? 0.6 : 0; };

export function stanzas(lyrics) {
  return lyrics.replace(/\r/g, '').split(/\n\s*\n/).map((s) => s.split('\n').map((l) => l.trim()).filter(Boolean)).filter((s) => s.length);
}

// words: [{text, offsetMilliseconds}] from the transcript's phrases, flattened
export function alignLyrics(lyrics, words) {
  const lines = stanzas(lyrics).flatMap((s, si) => s.map((text, li) => ({ text, stanza: si, line: li })));
  const L = []; lines.forEach((ln, i) => ln.text.split(/\s+/).map(norm).filter(Boolean).forEach((w) => L.push({ w, line: i })));
  const R = words.map((w) => ({ w: norm(w.text), t: w.offsetMilliseconds / 1000 })).filter((x) => x.w);
  const n = L.length, m = R.length;
  if (!n || !m) return lines.map((l) => ({ ...l, start: null, estimated: true }));
  // Needleman–Wunsch style with local skips, O(n*m) is fine (hundreds × hundreds)
  const S = new Float32Array((n + 1) * (m + 1)), B = new Uint8Array((n + 1) * (m + 1));
  const idx = (i, j) => i * (m + 1) + j; const gap = -0.4;
  for (let i = 1; i <= n; i++) S[idx(i, 0)] = i * gap;
  for (let j = 1; j <= m; j++) S[idx(0, j)] = j * gap;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const s = sim(L[i - 1].w, R[j - 1].w);
    const diag = S[idx(i - 1, j - 1)] + (s > 0 ? s : -0.6), up = S[idx(i - 1, j)] + gap, left = S[idx(i, j - 1)] + gap;
    let best = diag, b = 0; if (up > best) { best = up; b = 1; } if (left > best) { best = left; b = 2; }
    S[idx(i, j)] = best; B[idx(i, j)] = b;
  }
  const firstT = new Array(lines.length).fill(null), matches = new Array(lines.length).fill(0);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const b = B[idx(i, j)];
    if (b === 0) { if (sim(L[i - 1].w, R[j - 1].w) > 0) { const ln = L[i - 1].line; firstT[ln] = R[j - 1].t; matches[ln]++; } i--; j--; }
    else if (b === 1) i--; else j--;
  }
  const out = lines.map((l, k) => ({ ...l, start: matches[k] >= 2 ? firstT[k] : null, estimated: matches[k] < 2 }));
  // monotonic repair + interpolation for unmatched lines
  let last = -1; for (const l of out) { if (l.start != null && l.start < last) { l.start = null; l.estimated = true; } if (l.start != null) last = l.start; }
  for (let k = 0; k < out.length; k++) if (out[k].start == null) {
    let p = k - 1; while (p >= 0 && out[p].start == null) p--;
    let q = k + 1; while (q < out.length && out[q].start == null) q++;
    const a = p >= 0 ? out[p].start : null, b = q < out.length ? out[q].start : null;
    if (a != null && b != null) out[k].start = a + (b - a) * (k - p) / (q - p);
    else if (a != null) out[k].start = a + 3.5 * (k - p);
    else if (b != null) out[k].start = Math.max(0, b - 3.5 * (q - k));
  }
  return out;
}

export function flattenWords(transcript) { return (transcript.phrases || []).flatMap((p) => p.words || []); }
