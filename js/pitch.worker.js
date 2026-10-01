// NOISE — pitch worker. One streaming STFT pass does three jobs on a region of the song:
//   • (quick mode) harmonic/percussive split of the mix by median filtering (Fitzgerald 2010), so
//     the song's own drums stay unpitched while its music is re-tuned;
//   • melody reading: a harmonic-sum salience over G2..C6 per frame, from the harmonic part (quick)
//     or from the separated vocals (+ a little of "other") once Demucs stems exist;
//   • re-tuning into the minor key: a per-bin phase vocoder (Bernsee's true-frequency method) moves
//     only the partials whose pitch class is in `flats` down one semitone; every other bin is copied
//     verbatim with its original phase, so in-scale material is untouched.
// Both channels ride one complex FFT (Z = L + iR), unpacked and repacked around the processing.

importScripts('fft.js');
const { fft, ifft } = NoiseFFT;
const N = 4096, HOP = 1024, BINS = N / 2 + 1, OSAMP = N / HOP;
const WIN = new Float32Array(N); for (let i = 0; i < N; i++) WIN[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
const OLA_NORM = 1.5; // Σ hann² over the 4 overlapping hops
const TMED = 17, FMED = 17; // HPSS median windows: frames (≈0.4 s) and bins (≈180 Hz)
const SEMI = Math.pow(2, -1 / 12);
const TWO_PI = 2 * Math.PI, EXPCT = TWO_PI * HOP / N;
const MLO = 43, MHI = 84; // melody candidates G2..C6
const HW = [1, 0.8, 0.6, 0.45, 0.3]; // harmonic weights

self.onmessage = (e) => {
  const d = e.data;
  try {
    const out = run(d);
    const transfer = [out.tonal[0].buffer, out.tonal[1].buffer, out.f0.midi.buffer, out.f0.sal.buffer, out.f0.energy.buffer];
    if (out.perc) transfer.push(out.perc[0].buffer, out.perc[1].buffer);
    self.postMessage({ id: d.id, type: 'done', ...out }, transfer);
  } catch (err) {
    self.postMessage({ id: d.id, type: 'error', error: String(err && err.stack || err) });
  }
};

function run({ id, L, R, sr, flats, hpss, melL, melR, fmax = 6000 }) {
  const n = L.length, total = n + 2 * N;
  const F = Math.floor((total - N) / HOP) + 1;
  const half = (TMED - 1) / 2, fh = (FMED - 1) / 2;
  const freqPerBin = sr / N;
  const anyFlat = flats && Array.from(flats).some((v) => v);
  const tonalL = new Float32Array(total), tonalR = new Float32Array(total);
  const percL = hpss ? new Float32Array(total) : null, percR = hpss ? new Float32Array(total) : null;
  const f0midi = new Float32Array(F), f0sal = new Float32Array(F), f0energy = new Float32Array(F);
  // rings over the last TMED frames
  const ringRe = new Float32Array(TMED * N), ringIm = new Float32Array(TMED * N);
  const ringMag = new Float32Array(TMED * BINS);
  const sorted = new Float32Array(BINS * TMED); // per bin: the ring's magnitudes kept sorted (time median)
  const melRing = melL ? new Float32Array(TMED * BINS) : null;
  // scratch
  const re = new Float32Array(N), im = new Float32Array(N), mre = new Float32Array(N), mim = new Float32Array(N);
  const Lre = new Float32Array(BINS), Lim = new Float32Array(BINS), Rre = new Float32Array(BINS), Rim = new Float32Array(BINS);
  const mH = new Float32Array(BINS), mP = new Float32Array(BINS), fmed = new Float32Array(BINS), fwin = new Float32Array(FMED);
  const lastPhase = new Float32Array(BINS), monoMag = new Float32Array(BINS), monoPh = new Float32Array(BINS);
  const peaks = new Int32Array(BINS), accPhase = new Float32Array(BINS), accActive = new Int32Array(BINS).fill(-9);
  const XLr = new Float32Array(BINS), XLi = new Float32Array(BINS), XRr = new Float32Array(BINS), XRi = new Float32Array(BINS);
  const A = new Float32Array(BINS), salience = new Float32Array(MHI - MLO + 1);
  const harmBins = [];
  for (let m = MLO; m <= MHI; m++) { const f0 = 440 * Math.pow(2, (m - 69) / 12); const arr = []; for (let h = 1; h <= 5; h++) { const b = Math.round(h * f0 / freqPerBin); if (b >= 1 && b < BINS - 1) arr.push(b); } harmBins.push(arr); }
  const eLo = Math.round(80 / freqPerBin), eHi = Math.min(BINS - 1, Math.round(1200 / freqPerBin));
  const sample = (x, idx) => (idx < N || idx >= N + n) ? 0 : x[idx - N];
  const ratioOf = (fHz) => {
    if (!anyFlat || fHz < 30 || fHz > fmax) return 1;
    const midi = Math.round(69 + 12 * Math.log2(fHz / 440));
    return flats[((midi % 12) + 12) % 12] ? SEMI : 1;
  };
  let lastProgress = 0;

  // keep sorted[base..base+TMED) ascending while swapping oldV for newV
  const insertSorted = (base, oldV, newV) => {
    let i = 0; while (i < TMED - 1 && sorted[base + i] !== oldV) i++;
    if (newV >= oldV) { while (i < TMED - 1 && sorted[base + i + 1] < newV) { sorted[base + i] = sorted[base + i + 1]; i++; } }
    else { while (i > 0 && sorted[base + i - 1] > newV) { sorted[base + i] = sorted[base + i - 1]; i--; } }
    sorted[base + i] = newV;
  };

  // inverse of a packed pair: Z[k] = XL[k] + i·XR[k] for k < BINS, Hermitian halves rebuilt from XL/XR
  const overlapAdd = (off, outL, outR) => {
    for (let k = 0; k < BINS; k++) { re[k] = XLr[k] - XRi[k]; im[k] = XLi[k] + XRr[k]; }
    for (let k = 1; k < BINS - 1; k++) { const j = N - k; re[j] = XLr[k] + XRi[k]; im[j] = XRr[k] - XLi[k]; }
    ifft(re, im);
    for (let i = 0; i < N; i++) { const w = WIN[i] / OLA_NORM; outL[off + i] += re[i] * w; outR[off + i] += im[i] * w; }
  };

  const processCenter = (c) => {
    const slot = c % TMED, mb = slot * BINS, sb = slot * N;
    if (hpss) {
      for (let k = 0; k < BINS; k++) {
        for (let j = 0; j < FMED; j++) { let kk = k + j - fh; if (kk < 0) kk = -kk; if (kk >= BINS) kk = 2 * BINS - 2 - kk; fwin[j] = ringMag[mb + kk]; }
        for (let a = 1; a < FMED; a++) { const v = fwin[a]; let b = a - 1; while (b >= 0 && fwin[b] > v) { fwin[b + 1] = fwin[b]; b--; } fwin[b + 1] = v; }
        fmed[k] = fwin[fh];
      }
      for (let k = 0; k < BINS; k++) { const h = sorted[k * TMED + half], p = fmed[k]; const h2 = h * h, p2 = p * p, den = h2 + p2 + 1e-12; mH[k] = h2 / den; mP[k] = p2 / den; }
    }
    // unpack the center frame
    for (let k = 0; k < BINS; k++) {
      const k2 = (N - k) & (N - 1);
      const ar = ringRe[sb + k], ai = ringIm[sb + k], br = ringRe[sb + k2], bi = ringIm[sb + k2];
      Lre[k] = 0.5 * (ar + br); Lim[k] = 0.5 * (ai - bi); Rre[k] = 0.5 * (ai + bi); Rim[k] = -0.5 * (ar - br);
    }
    // melody salience
    if (melRing) { for (let k = 0; k < BINS; k++) A[k] = melRing[mb + k]; }
    else { for (let k = 0; k < BINS; k++) A[k] = ringMag[mb + k] * (hpss ? mH[k] : 1); }
    let bestM = -1, bestS = 0, energy = 0;
    for (let k = eLo; k <= eHi; k++) energy += A[k];
    for (let mi = 0; mi < harmBins.length; mi++) {
      const hb = harmBins[mi]; let s = 0;
      for (let h = 0; h < hb.length; h++) { const b = hb[h]; s += HW[h] * Math.max(A[b - 1], A[b], A[b + 1]); }
      salience[mi] = s; if (s > bestS) { bestS = s; bestM = mi; }
    }
    if (bestM >= 0 && bestM + 12 < salience.length && salience[bestM + 12] > 0.8 * bestS) bestM += 12; // the octave above wins ties with its sub-harmonic
    f0midi[c] = bestM >= 0 ? MLO + bestM : 0; f0sal[c] = bestS; f0energy[c] = energy;
    // tonal: the masked spectrum through a phase-locked, partial-wise shifter (Laroche & Dolson
    // identity phase locking). Peaks are picked on the mono magnitude; each peak's true frequency
    // decides, for the whole region of bins it owns, whether that partial drops a semitone. A
    // dropped region is moved to bins k·r and rotated by one common angle so the partial's shape
    // and the two channels stay coherent; its phase advances at the new frequency from frame to
    // frame, so a held note continues smoothly and an onset copies the original phases exactly.
    for (let k = 0; k < BINS; k++) {
      const m = hpss ? mH[k] : 1;
      const mr = 0.5 * (Lre[k] + Rre[k]) * m, mi = 0.5 * (Lim[k] + Rim[k]) * m;
      monoMag[k] = Math.sqrt(mr * mr + mi * mi); monoPh[k] = Math.atan2(mi, mr);
      XLr[k] = 0; XLi[k] = 0; XRr[k] = 0; XRi[k] = 0;
    }
    let np = 0;
    for (let k = 2; k < BINS - 2; k++) { const v = monoMag[k]; if (v > 1e-6 && v >= monoMag[k - 1] && v >= monoMag[k - 2] && v > monoMag[k + 1] && v > monoMag[k + 2]) peaks[np++] = k; }
    let regionStart = 0;
    for (let pi = 0; pi < np; pi++) {
      const p = peaks[pi];
      const regionEnd = pi + 1 < np ? ((p + peaks[pi + 1]) >> 1) : BINS; // bins [regionStart, regionEnd) belong to this partial
      // true frequency of the peak from its phase advance
      let tmp = monoPh[p] - lastPhase[p];
      tmp -= p * EXPCT;
      let qpd = (tmp / Math.PI) | 0; if (qpd >= 0) qpd += qpd & 1; else qpd -= qpd & 1; tmp -= Math.PI * qpd;
      const fTrue = (p + OSAMP * tmp / TWO_PI) * freqPerBin;
      const r = ratioOf(fTrue);
      if (r === 1) {
        for (let k = regionStart; k < regionEnd; k++) { const m = hpss ? mH[k] : 1; XLr[k] += Lre[k] * m; XLi[k] += Lim[k] * m; XRr[k] += Rre[k] * m; XRi[k] += Rim[k] * m; }
      } else {
        const pt = Math.round(p * r);
        const psi = accActive[pt] === c - 1 ? accPhase[pt] + TWO_PI * fTrue * r * HOP / sr : monoPh[p];
        accPhase[pt] = psi; accActive[pt] = c;
        const theta = psi - monoPh[p], cs = Math.cos(theta), sn = Math.sin(theta);
        for (let k = regionStart; k < regionEnd; k++) {
          const kt = Math.round(k * r); if (kt >= BINS) break;
          const m = hpss ? mH[k] : 1;
          const lr = Lre[k] * m, li = Lim[k] * m, rr = Rre[k] * m, ri = Rim[k] * m;
          XLr[kt] += lr * cs - li * sn; XLi[kt] += lr * sn + li * cs;
          XRr[kt] += rr * cs - ri * sn; XRi[kt] += rr * sn + ri * cs;
        }
      }
      regionStart = regionEnd;
    }
    if (np === 0) for (let k = 0; k < BINS; k++) { const m = hpss ? mH[k] : 1; XLr[k] = Lre[k] * m; XLi[k] = Lim[k] * m; XRr[k] = Rre[k] * m; XRi[k] = Rim[k] * m; }
    for (let k = 0; k < BINS; k++) lastPhase[k] = monoPh[k];
    overlapAdd(c * HOP, tonalL, tonalR);
    if (hpss) {
      for (let k = 0; k < BINS; k++) { const m = mP[k]; XLr[k] = Lre[k] * m; XLi[k] = Lim[k] * m; XRr[k] = Rre[k] * m; XRi[k] = Rim[k] * m; }
      overlapAdd(c * HOP, percL, percR);
    }
  };

  for (let i = 0; i < F + half; i++) {
    const slot = i % TMED, mb = slot * BINS, sb = slot * N, off = i * HOP;
    if (i < F) { for (let j = 0; j < N; j++) { re[j] = sample(L, off + j) * WIN[j]; im[j] = sample(R, off + j) * WIN[j]; } fft(re, im); }
    else { re.fill(0); im.fill(0); }
    for (let k = 0; k < BINS; k++) {
      const k2 = (N - k) & (N - 1);
      const ar = re[k], ai = im[k], br = re[k2], bi = im[k2];
      const lr = 0.5 * (ar + br), li = 0.5 * (ai - bi), rr = 0.5 * (ai + bi), ri = -0.5 * (ar - br);
      const mag = 0.5 * (Math.sqrt(lr * lr + li * li) + Math.sqrt(rr * rr + ri * ri));
      if (hpss) insertSorted(k * TMED, ringMag[mb + k], mag);
      ringMag[mb + k] = mag; ringRe[sb + k] = ar; ringIm[sb + k] = ai;
      if (k > 0 && k < BINS - 1) { ringRe[sb + k2] = br; ringIm[sb + k2] = bi; }
    }
    if (melRing) {
      if (i < F) { for (let j = 0; j < N; j++) { mre[j] = (sample(melL, off + j) + sample(melR, off + j)) * 0.5 * WIN[j]; mim[j] = 0; } fft(mre, mim); for (let k = 0; k < BINS; k++) melRing[mb + k] = Math.sqrt(mre[k] * mre[k] + mim[k] * mim[k]); }
      else melRing.fill(0, mb, mb + BINS);
    }
    if (i >= half) processCenter(i - half);
    if (i - lastProgress > 150) { lastProgress = i; self.postMessage({ id, type: 'progress', p: i / (F + half) }); }
  }

  const crop = (a) => a.slice(N, N + n);
  return {
    tonal: [crop(tonalL), crop(tonalR)],
    perc: hpss ? [crop(percL), crop(percR)] : null,
    // frame c is centred on sample c·HOP − N/2 of the region
    f0: { midi: f0midi, sal: f0sal, energy: f0energy, hop: HOP, t0: -N / 2, sr, frames: F },
  };
}
