// NOISE — shared in-place radix-2 FFT for the workers (plain script, importScripts-able).
// fft(re, im): forward transform in place. ifft(re, im): inverse (scaled by 1/n).
(function (root) {
  const twid = new Map();
  function tables(n) {
    let t = twid.get(n);
    if (t) return t;
    const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) { const a = -2 * Math.PI * i / n; cos[i] = Math.cos(a); sin[i] = Math.sin(a); }
    const rev = new Uint32Array(n);
    let bits = 0; while ((1 << bits) < n) bits++;
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    t = { cos, sin, rev }; twid.set(n, t); return t;
  }
  function fft(re, im) {
    const n = re.length, { cos, sin, rev } = tables(n);
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0, w = 0; k < half; k++, w += step) {
          const a = i + k, b = a + half, cr = cos[w], ci = sin[w];
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  }
  function ifft(re, im) {
    const n = re.length;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    fft(re, im);
    const s = 1 / n;
    for (let i = 0; i < n; i++) { re[i] *= s; im[i] = -im[i] * s; }
  }
  root.NoiseFFT = { fft, ifft };
})(typeof self !== 'undefined' ? self : globalThis);
