// NOISE — analysis worker. Takes mono PCM, returns tempo, beat grid, downbeats, key.
// Runs off the main thread so the page stays responsive while a 4-minute song is measured.
//
// Pipeline:
//   1. onset strength: log-spectral flux across 6 bands (hop 512 @ 22.05k ≈ 23 ms)
//   2. tempo: autocorrelation of the onset envelope, 60–200 BPM, octave-disambiguated to 70–100 for phonk
//   3. beats: dynamic programming (Ellis 2007) over the onset envelope with the tempo prior
//   4. downbeats: pick the phase (0..3) whose beats carry the most low-band energy
//   5. key: Krumhansl-Schmuckler on a chroma histogram
//   6. a loudness envelope at beat resolution so the remixer knows where the drops already are

self.onmessage = (e) => {
  const { id, pcm, sampleRate } = e.data;
  try {
    const result = analyze(pcm, sampleRate, (p) => self.postMessage({ id, progress: p }));
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};

function analyze(pcmIn, srIn, progress) {
  // downsample to ~22050 for speed (box filter; we only need rhythm/chroma content)
  const target = 22050;
  const factor = Math.max(1, Math.round(srIn / target));
  const sr = srIn / factor;
  const n = Math.floor(pcmIn.length / factor);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0; const b = i * factor;
    for (let k = 0; k < factor; k++) s += pcmIn[b + k];
    x[i] = s / factor;
  }
  progress(0.05);

  const N = 2048, hop = 512;
  const frames = Math.max(1, Math.floor((n - N) / hop));
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const re = new Float32Array(N), im = new Float32Array(N);
  const bins = N / 2;
  const binHz = sr / N;

  // band edges for flux + low-band for downbeats; chroma from 60..2000 Hz
  const edges = [0, 100, 250, 600, 1500, 4000, sr / 2].map((f) => Math.min(bins, Math.round(f / binHz)));
  const prevMag = new Float32Array(bins);
  const flux = new Float32Array(frames);
  const low = new Float32Array(frames);
  const loud = new Float32Array(frames);
  const chroma = new Float64Array(12);
  const chromaMap = new Int8Array(bins).fill(-1);
  for (let b = 1; b < bins; b++) {
    const f = b * binHz;
    if (f < 60 || f > 2000) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    chromaMap[b] = ((Math.round(midi) % 12) + 12) % 12;
  }
  const mag = new Float32Array(bins);
  for (let fr = 0; fr < frames; fr++) {
    const off = fr * hop;
    for (let i = 0; i < N; i++) { re[i] = x[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let lowE = 0, tot = 0;
    for (let b = 0; b < bins; b++) {
      const m = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      mag[b] = m; tot += m * m;
      if (b >= edges[0] && b < edges[2]) lowE += m * m;
      const c = chromaMap[b]; if (c >= 0) chroma[c] += m * m;
    }
    // log flux per band, half-wave rectified, summed
    let f = 0;
    for (let band = 0; band < edges.length - 1; band++) {
      let cur = 0, prev = 0;
      for (let b = edges[band]; b < edges[band + 1]; b++) { cur += mag[b]; prev += prevMag[b]; }
      const d = Math.log1p(cur * 10) - Math.log1p(prev * 10);
      if (d > 0) f += d * (band <= 1 ? 1.6 : 1); // bass transients count more (kick/808)
    }
    flux[fr] = f;
    low[fr] = lowE;
    loud[fr] = Math.sqrt(tot / bins);
    prevMag.set(mag);
    if ((fr & 63) === 0) progress(0.05 + 0.6 * fr / frames);
  }
  // smooth + normalise onset envelope, subtract local mean
  const onset = new Float32Array(frames);
  {
    const w = 8; // ~0.19s local mean
    for (let i = 0; i < frames; i++) {
      let s = 0, c = 0;
      for (let k = -w; k <= w; k++) { const j = i + k; if (j >= 0 && j < frames) { s += flux[j]; c++; } }
      onset[i] = Math.max(0, flux[i] - s / c);
    }
    let mx = 0; for (let i = 0; i < frames; i++) mx = Math.max(mx, onset[i]);
    if (mx > 0) for (let i = 0; i < frames; i++) onset[i] /= mx;
  }
  progress(0.7);

  const fps = sr / hop;
  // --- tempo by autocorrelation with a log-normal prior centred where phonk source material lives
  const minLag = Math.floor(fps * 60 / 200), maxLag = Math.ceil(fps * 60 / 60);
  const ac = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < frames; i++) s += onset[i] * onset[i - lag];
    ac[lag] = s / (frames - lag);
  }
  // combine lag with its double and half (meter evidence) and weight by a prior around 85 BPM (sigma 0.9 octaves)
  let bestLag = minLag, bestScore = -1;
  const scores = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 * fps / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 110) / 1.0, 2));
    let s = ac[lag];
    const l2 = lag * 2, lh = Math.round(lag / 2);
    if (l2 <= maxLag) s += 0.5 * ac[l2];
    if (lh >= minLag) s += 0.5 * ac[lh];
    s *= prior;
    scores[lag] = s;
    if (s > bestScore) { bestScore = s; bestLag = lag; }
  }
  // refine lag with parabolic interpolation on the raw autocorrelation
  let lagF = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
    const denom = a - 2 * b + c;
    if (Math.abs(denom) > 1e-9) lagF = bestLag + 0.5 * (a - c) / denom;
  }
  let bpm = 60 * fps / lagF;
  progress(0.78);

  // --- beat tracking: dynamic programming (Ellis) with the chosen period
  const period = fps * 60 / bpm;
  const alpha = 400; // tempo-stickiness
  const cum = new Float64Array(frames);
  const back = new Int32Array(frames).fill(-1);
  const lo = Math.max(1, Math.round(period * 0.5)), hi = Math.round(period * 2);
  for (let i = 0; i < frames; i++) {
    // either start a chain here (score = onset) or extend the best predecessor one period back
    let best = 0, bi = -1;
    for (let p = lo; p <= hi; p++) {
      const j = i - p; if (j < 0) break;
      const txcost = -alpha * Math.pow(Math.log(p / period), 2);
      const v = cum[j] + txcost;
      if (bi < 0 || v > best) { best = v; bi = j; }
    }
    cum[i] = onset[i] + (bi >= 0 ? best : 0);
    back[i] = bi;
  }
  // pick the best end within the last period
  let end = frames - 1, bestEnd = -Infinity;
  for (let i = Math.max(0, frames - Math.round(period * 1.2)); i < frames; i++) if (cum[i] > bestEnd) { bestEnd = cum[i]; end = i; }
  const beatsF = [];
  for (let i = end; i >= 0; i = back[i]) { beatsF.push(i); if (back[i] < 0) break; }
  beatsF.reverse();
  // the chain always reaches back to the first period; drop beats that fall in leading silence
  const beats = beatsF.map((f) => f * hop / sr);
  progress(0.88);

  // refine tempo from the median beat interval
  if (beats.length > 8) {
    const ivs = []; for (let i = 1; i < beats.length; i++) ivs.push(beats[i] - beats[i - 1]);
    ivs.sort((a, b) => a - b);
    const med = ivs[Math.floor(ivs.length / 2)];
    if (med > 0) bpm = 60 / med;
  }

  // --- downbeats: which beat phase (mod 4) carries the most low-band energy and onset strength?
  let bestPhase = 0, bestPE = -1;
  const beatLow = beatsF.map((f) => { let s = 0; for (let k = -1; k <= 1; k++) { const j = f + k; if (j >= 0 && j < frames) s += low[j] + onset[j] * 0.3; } return s; });
  for (let ph = 0; ph < 4; ph++) {
    let s = 0, c = 0;
    for (let i = ph; i < beatLow.length; i += 4) { s += beatLow[i]; c++; }
    const v = c ? s / c : 0;
    if (v > bestPE) { bestPE = v; bestPhase = ph; }
  }
  const downbeats = [];
  for (let i = bestPhase; i < beats.length; i += 4) downbeats.push(beats[i]);

  // --- key: Krumhansl-Schmuckler profiles against the chroma histogram
  const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minor = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  let keyBest = { score: -2, root: 0, mode: 'minor' };
  for (let root = 0; root < 12; root++) {
    for (const [mode, prof] of [['major', major], ['minor', minor]]) {
      const rotated = new Array(12); for (let i = 0; i < 12; i++) rotated[i] = chroma[(i + root) % 12];
      const s = pearson(rotated, prof);
      if (s > keyBest.score) keyBest = { score: s, root, mode };
    }
  }
  // the chroma histogram itself (normalised) so the remixer can pick bass notes that fit
  let cmax = 0; for (let i = 0; i < 12; i++) cmax = Math.max(cmax, chroma[i]);
  const chromaNorm = Array.from(chroma, (v) => cmax ? v / cmax : 0);

  // --- loudness per beat (for finding the song's own energy arc)
  const beatLoud = beatsF.map((f, i) => {
    const nf = beatsF[i + 1] ?? Math.min(frames, f + Math.round(period));
    let s = 0, c = 0; for (let j = f; j < nf && j < frames; j++) { s += loud[j]; c++; }
    return c ? s / c : 0;
  });
  let lmax = 0; for (const v of beatLoud) lmax = Math.max(lmax, v);
  const beatLoudNorm = beatLoud.map((v) => lmax ? v / lmax : 0);

  // where does the music actually start? first frame with loudness > 10% of peak
  let startSec = 0;
  { let lm = 0; for (let i = 0; i < frames; i++) lm = Math.max(lm, loud[i]); for (let i = 0; i < frames; i++) if (loud[i] > lm * 0.1) { startSec = i * hop / sr; break; } }

  progress(1);
  return {
    bpm, beats, downbeats, phase: bestPhase,
    key: { root: keyBest.root, mode: keyBest.mode, confidence: keyBest.score },
    chroma: chromaNorm, beatLoud: beatLoudNorm, startSec,
    duration: pcmIn.length / srIn,
    onset: Array.from(onset), fps,
  };
}

function pearson(a, b) {
  const n = a.length; let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// in-place radix-2 FFT
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}
