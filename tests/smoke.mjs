// NOISE smoke: load the demo through the real UI, confirm analysis, quick split, playback, sliders,
// pads, slots, render. Neural stems are exercised separately (tests/stems.mjs) because they take minutes.
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:8765/';
const shots = process.env.SHOTS || '/data/pat/.hermes/cache/scratch/noise4/shots';
const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', (r) => errors.push('reqfail: ' + r.url()));
await page.goto(base, { waitUntil: 'networkidle' });
console.log('title:', await page.title());
console.log('stage:', await page.evaluate(() => document.body.dataset.stage));
const t0 = Date.now();
await page.click('#try');
await page.waitForFunction(() => document.body.dataset.stage === 'deck', null, { timeout: 180000 });
console.log('analysis + quick split took', ((Date.now() - t0) / 1000).toFixed(1), 's');
const a = await page.evaluate(() => { const a = window.noise.analysis; return { bpm: +a.bpm.toFixed(2), beats: a.beats.length, key: a.key, phase: a.phase, dur: +a.duration.toFixed(1) }; });
console.log('analysis:', JSON.stringify(a));
const mel = await page.evaluate(() => { const m = window.noise.ph.melody; let voiced = 0, total = 0; const pcs = {}; for (const [, v] of m) { total++; if (v != null) { voiced++; pcs[v % 12] = (pcs[v % 12] || 0) + 1; } } const bars = window.noise.ph.arr.bars; return { slots: total, voiced, melodyBars: bars.filter((b) => b.melodyBar).length, bars: bars.length, pcs }; });
console.log('melody:', JSON.stringify(mel));
await page.waitForTimeout(2500);
const st = await page.evaluate(() => ({ playing: window.noise.ph.playing, pos: +window.noise.ph.position().toFixed(2), events: window.noise.ph.arr.events.length, bells: window.noise.ph.arr.events.filter((e) => e.kind === 'bell').length, bass: window.noise.ph.arr.events.filter((e) => e.kind === 'bass').length, drop: window.noise.ph.arr.dropBar, meta: document.querySelector('#now-meta').textContent, lcd: document.querySelector('#lcd-stems-main').textContent + ' / ' + document.querySelector('#lcd-stems-sub').textContent, key: document.querySelector('#lcd-key-main').textContent }));
console.log('playing:', JSON.stringify(st));
if (st.bass) errors.push('808 events present: ' + st.bass);
await page.evaluate(() => { const i = document.querySelector('input[data-param=chop]'); i.value = 0.6; i.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(300);
console.log('chop set:', await page.evaluate(() => ({ chop: window.noise.ph.params.chop, planned: window.noise.ph.arr.bars.filter((b) => b.plan).length, playing: window.noise.ph.playing, chopFlags: document.querySelectorAll('.flag--chop').length, chopPads: document.querySelectorAll('.pad--chop').length })));
await page.click('.chip[data-preset=memphis]');
await page.waitForTimeout(300);
console.log('preset:', await page.evaluate(() => ({ slow: window.noise.ph.params.slow, on: document.querySelector('.chip.is-on').textContent, playing: window.noise.ph.playing })));
await page.click('.slotkey[data-slot="3"]');
await page.waitForTimeout(200);
console.log('slot:', await page.evaluate(() => ({ seed: window.noise.ph.seed, slot: window.noise.ph.slot, on: document.querySelector('.slotkey.is-on').textContent })));
await page.evaluate(() => window.noise.hitPad(5));
await page.waitForTimeout(200);
console.log('pad hit ok; pads:', await page.evaluate(() => [...document.querySelectorAll('.pad small')].slice(0, 4).map((s) => s.textContent).join(' | ')));
// SENSITIVITY: low finds few slice points, high finds many; the flag rail and the chop plans follow it
const sensProbe = async (v) => page.evaluate((v) => { const i = document.querySelector('input[data-param=sens]'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); const bars = window.noise.ph.arr.bars; return { sens: window.noise.ph.params.sens, points: bars.reduce((s, b) => s + (b.slicePoints?.length || 0), 0), planned: bars.filter((b) => b.plan).length, ticks: document.querySelectorAll('.tick').length, val: document.querySelector('[data-val=sens]').textContent }; }, v);
const sLow = await sensProbe(0.05), sHigh = await sensProbe(0.95);
console.log('sensitivity low:', JSON.stringify(sLow), 'high:', JSON.stringify(sHigh));
if (!(sHigh.points > sLow.points)) errors.push('sensitivity did not change slice points');
await sensProbe(0.5);
// first-use neural click must ask before downloading (model is not cached in a fresh browser)
const confirm = await page.evaluate(async () => { document.querySelector('#neural').click(); await new Promise((r) => setTimeout(r, 300)); return { stems: document.body.dataset.stems, lcd: document.querySelector('#lcd-stems-main').textContent + ' / ' + document.querySelector('#lcd-stems-sub').textContent, btn: document.querySelector('#neural').textContent }; });
console.log('neural first click:', JSON.stringify(confirm));
if (confirm.stems !== 'confirm') errors.push('neural did not ask before downloading');
await page.evaluate(() => { window.noise.neuralState('quick'); });
await page.waitForTimeout(1500);
console.log('lcd:', await page.evaluate(() => [document.querySelector('#lcd-bar').textContent, document.querySelector('#lcd-section').textContent, document.querySelector('#lcd-note').textContent].join(' / ')));
await page.screenshot({ path: shots + '/desktop.png', fullPage: true });
await page.click('#play'); await page.waitForTimeout(200);
const paused = await page.evaluate(() => ({ playing: window.noise.ph.playing, at: +window.noise.ph._pausedAt.toFixed(2) }));
await page.click('#play'); await page.waitForTimeout(400);
console.log('pause/resume:', JSON.stringify(paused), await page.evaluate(() => window.noise.ph.playing));
const r = await page.evaluate(async () => {
  const t = performance.now();
  window.noise.ph.stop();
  const mix = await window.noise.ph.render();
  const { encodeWav, encodeMp3 } = await import('./js/export.js');
  const wav = encodeWav(mix);
  const t1 = performance.now();
  const mp3 = await encodeMp3(mix, 128);
  let peak = 0; const d = mix.getChannelData(0); for (let i = 0; i < d.length; i += 7) peak = Math.max(peak, Math.abs(d[i]));
  // stash the wav for the analysis step
  window.__wav = wav;
  return { renderSec: +((t1 - t) / 1000).toFixed(1), mp3Sec: +((performance.now() - t1) / 1000).toFixed(1), dur: +mix.duration.toFixed(1), wavKB: Math.round(wav.size / 1024), mp3KB: Math.round(mp3.size / 1024), peak: +peak.toFixed(3) };
});
console.log('render:', JSON.stringify(r));
if (process.env.PULL_WAV) {
  const fs = await import('fs');
  const n = await page.evaluate(() => window.__wav.size);
  const chunks = [];
  for (let o = 0; o < n; o += 2_000_000) {
    const b64 = await page.evaluate(async ([o, e]) => { const ab = await window.__wav.slice(o, e).arrayBuffer(); let s = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }, [o, Math.min(n, o + 2_000_000)]);
    chunks.push(Buffer.from(b64, 'base64'));
  }
  fs.writeFileSync(process.env.PULL_WAV, Buffer.concat(chunks));
  console.log('wav written', process.env.PULL_WAV, n, 'bytes');
}
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
m.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
await m.goto(base, { waitUntil: 'networkidle' });
await m.click('#try');
await m.waitForFunction(() => document.body.dataset.stage === 'deck', null, { timeout: 180000 });
await m.waitForTimeout(800);
console.log('mobile overflow:', await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), 'stems lcd:', await m.evaluate(() => document.querySelector('#lcd-stems-sub').textContent));
await m.screenshot({ path: shots + '/mobile.png', fullPage: true });
await page.click('#another'); await page.waitForTimeout(200);
await page.screenshot({ path: shots + '/desk-intake.png' });
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
