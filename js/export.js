// NOISE — exports. WAV (PCM16), MP3 (lamejs, LGPL, bundled), and a vertical video for Reels/TikTok
// drawn on a canvas from the rendered mix with the Countach plates.

import { Mp3Encoder } from '../vendor/lamejs.js';

export function encodeWav(buffer) {
  const channels = Math.min(2, buffer.numberOfChannels), sr = buffer.sampleRate, len = buffer.length;
  const blockAlign = channels * 2, dataSize = len * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize), v = new DataView(ab);
  let p = 0;
  const str = (s) => { for (let i = 0; i < s.length; i++) v.setUint8(p++, s.charCodeAt(i)); };
  const u32 = (n) => { v.setUint32(p, n, true); p += 4; }, u16 = (n) => { v.setUint16(p, n, true); p += 2; };
  str('RIFF'); u32(36 + dataSize); str('WAVE'); str('fmt '); u32(16); u16(1); u16(channels); u32(sr); u32(sr * blockAlign); u16(blockAlign); u16(16); str('data'); u32(dataSize);
  const chans = []; for (let c = 0; c < channels; c++) chans.push(buffer.getChannelData(c));
  for (let i = 0; i < len; i++) for (let c = 0; c < channels; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); v.setInt16(p, s < 0 ? s * 32768 : s * 32767, true); p += 2; }
  return new Blob([ab], { type: 'audio/wav' });
}

export async function encodeMp3(buffer, kbps = 192, onProgress) {
  const channels = Math.min(2, buffer.numberOfChannels), sr = buffer.sampleRate;
  const enc = new Mp3Encoder(channels, sr, kbps);
  const L = buffer.getChannelData(0), R = channels > 1 ? buffer.getChannelData(1) : null;
  const block = 1152 * 8, n = buffer.length, parts = [];
  const l16 = new Int16Array(block), r16 = new Int16Array(block);
  for (let i = 0; i < n; i += block) {
    const m = Math.min(block, n - i);
    for (let k = 0; k < m; k++) { const a = Math.max(-1, Math.min(1, L[i + k])); l16[k] = a < 0 ? a * 32768 : a * 32767; if (R) { const b = Math.max(-1, Math.min(1, R[i + k])); r16[k] = b < 0 ? b * 32768 : b * 32767; } }
    const out = R ? enc.encodeBuffer(l16.subarray(0, m), r16.subarray(0, m)) : enc.encodeBuffer(l16.subarray(0, m));
    if (out.length) parts.push(new Uint8Array(out));
    if (onProgress && (i / block) % 20 === 0) { onProgress(i / n); await new Promise((r) => setTimeout(r, 0)); }
  }
  const tail = enc.flush(); if (tail.length) parts.push(new Uint8Array(tail));
  onProgress && onProgress(1);
  return new Blob(parts, { type: 'audio/mpeg' });
}

export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
export const safeName = (s) => (s || 'noise').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'noise';

// Vertical 1080x1920 video: the mix plays through a MediaStreamDestination while a canvas draws
// the plates, a spectrum, and the title. Encoded by MediaRecorder (webm/vp9+opus or whatever the
// browser offers). Takes the real length of the mix.
export async function renderVideo({ buffer, title, artImg, pinupImg, onProgress }) {
  if (!window.MediaRecorder) throw new Error('This browser cannot record video.');
  const W = 1080, H = 1920, fps = 30;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  const src = ctx.createBufferSource(); src.buffer = buffer;
  const an = ctx.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0.75;
  const dest = ctx.createMediaStreamDestination();
  src.connect(an); an.connect(dest);
  const vstream = canvas.captureStream(fps);
  const stream = new MediaStream([...vstream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 192_000 });
  const chunks = []; rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const freq = new Uint8Array(an.frequencyBinCount);
  const dur = buffer.duration, start = ctx.currentTime + 0.15;
  let raf;
  const draw = () => {
    const t = ctx.currentTime - start, p = Math.max(0, Math.min(1, t / dur));
    an.getByteFrequencyData(freq);
    let bass = 0; for (let i = 2; i < 12; i++) bass += freq[i]; bass /= 10 * 255;
    c.fillStyle = '#0a0514'; c.fillRect(0, 0, W, H);
    // sun
    const sunR = 420 + bass * 60; const sg = c.createLinearGradient(0, 520 - sunR, 0, 520 + sunR); sg.addColorStop(0, '#ffd166'); sg.addColorStop(.45, '#ff7a3d'); sg.addColorStop(1, '#ff2bd6');
    c.save(); c.beginPath(); c.arc(W / 2, 560, sunR, 0, Math.PI * 2); c.clip(); c.fillStyle = sg; c.fillRect(0, 0, W, H);
    c.fillStyle = '#0a0514'; for (let i = 0; i < 7; i++) { const y = 560 + i * 36 + 20, h = 6 + i * 4; c.fillRect(0, y, W, h); } c.restore();
    // grid
    c.save(); c.globalAlpha = .35; c.strokeStyle = '#19e6ff'; c.lineWidth = 2;
    const horizon = 980; for (let i = -8; i <= 8; i++) { c.beginPath(); c.moveTo(W / 2 + i * 60, horizon); c.lineTo(W / 2 + i * 420, H); c.stroke(); }
    c.strokeStyle = '#ff2bd6'; const scroll = (t * 0.8) % 1; for (let k = 0; k < 10; k++) { const z = (k + scroll) / 10; const y = horizon + Math.pow(z, 2.2) * (H - horizon); c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); } c.restore();
    // car plate
    if (artImg) { const ar = artImg.width / artImg.height; const w = W * 1.1, h = w / ar; c.drawImage(artImg, (W - w) / 2, 1020 - h * 0.35 + bass * 8, w, h); }
    if (pinupImg) { const h = 820, w = h * (pinupImg.width / pinupImg.height); c.save(); c.globalAlpha = .95; c.drawImage(pinupImg, W - w - 24, 1080 - bass * 10, w, h); c.restore(); }
    // spectrum bars at the bottom
    const bars = 48, bw = W / bars; for (let i = 0; i < bars; i++) { const v = freq[Math.floor(i * freq.length / bars / 2)] / 255; const h = v * 320; c.fillStyle = i % 2 ? '#19e6ff' : '#ff2bd6'; c.fillRect(i * bw + 3, H - 90 - h, bw - 6, h); }
    // title block
    c.fillStyle = 'rgba(10,5,20,.72)'; c.fillRect(0, 60, W, 300);
    c.fillStyle = '#f4f1ff'; c.font = '700 150px Audiowide, Impact, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.shadowColor = '#ff2bd6'; c.shadowBlur = 40; c.fillText('NOISE', 60, 230); c.shadowBlur = 0;
    c.fillStyle = '#19e6ff'; c.font = '700 34px Michroma, sans-serif'; c.fillText('PHONK VERSION', 62, 290);
    c.fillStyle = '#f4f1ff'; c.font = '700 40px Michroma, sans-serif'; const tt = (title || '').toUpperCase().slice(0, 34); c.fillText(tt, 62, 345);
    // progress
    c.fillStyle = '#2a1d4a'; c.fillRect(0, H - 14, W, 14); c.fillStyle = '#ff2bd6'; c.fillRect(0, H - 14, W * p, 14);
    onProgress && onProgress(p);
    if (t < dur + 0.4) raf = requestAnimationFrame(draw);
  };
  const done = new Promise((resolve) => { rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] })); });
  rec.start(500);
  src.start(start);
  draw();
  await new Promise((r) => setTimeout(r, (dur + 0.6) * 1000));
  cancelAnimationFrame(raf);
  rec.stop();
  const blob = await done;
  try { src.stop(); } catch (e) {}
  ctx.close();
  return { blob, ext: mime.includes('mp4') ? 'mp4' : 'webm' };
}
