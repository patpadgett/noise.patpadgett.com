// NOISE mix gate: render the same 20 s three ways (song only, kit only, both) and pull the WAVs out
// so measure_stems.py can check that the song leads the midrange. Usage: BASE=... node tests/stems.mjs <outdir>
import { chromium } from 'playwright';
import fs from 'fs';
const base = process.env.BASE || 'http://127.0.0.1:8765/';
const out = process.argv[2] || '/data/pat/.hermes/cache/scratch/noise4/stems';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(base, { waitUntil: 'networkidle' });
await page.click('#try');
await page.waitForFunction(() => document.body.dataset.stage === 'deck', null, { timeout: 180000 });
await page.evaluate(() => window.noise.ph.stop());
const pull = async (name) => {
  const n = await page.evaluate(() => window.__wav.size);
  const chunks = [];
  for (let o = 0; o < n; o += 2_000_000) {
    const b64 = await page.evaluate(async ([o, e]) => { const ab = await window.__wav.slice(o, e).arrayBuffer(); let s = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }, [o, Math.min(n, o + 2_000_000)]);
    chunks.push(Buffer.from(b64, 'base64'));
  }
  fs.writeFileSync(`${out}/${name}.wav`, Buffer.concat(chunks));
};
for (const solo of ['src', 'kit', 'both']) {
  const info = await page.evaluate(async (solo) => {
    const { encodeWav } = await import('./js/export.js');
    const mix = await window.noise.ph.render(null, { from: 40, to: 60, solo: solo === 'both' ? null : solo });
    window.__wav = encodeWav(mix);
    let peak = 0; const d = mix.getChannelData(0); for (let i = 0; i < d.length; i += 5) peak = Math.max(peak, Math.abs(d[i]));
    return { dur: +mix.duration.toFixed(2), peak: +peak.toFixed(3), slow: window.noise.ph.params.slow };
  }, solo);
  await pull(solo);
  console.log(solo, JSON.stringify(info));
}
await browser.close();
