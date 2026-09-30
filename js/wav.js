// WAV encode/decode + base64 helpers. Everything the song file needs to carry audio
// in a form every browser can read back with decodeAudioData.

export function encodeWav(buffer, { forceMono = false } = {}) {
  const channels = forceMono ? 1 : Math.min(buffer.numberOfChannels, 2);
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = len * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const v = new DataView(ab);
  let p = 0;
  const str = (s) => { for (let i = 0; i < s.length; i++) v.setUint8(p++, s.charCodeAt(i)); };
  const u32 = (n) => { v.setUint32(p, n, true); p += 4; };
  const u16 = (n) => { v.setUint16(p, n, true); p += 2; };
  str('RIFF'); u32(36 + dataSize); str('WAVE');
  str('fmt '); u32(16); u16(1); u16(channels); u32(sr); u32(sr * blockAlign); u16(blockAlign); u16(16);
  str('data'); u32(dataSize);
  const chans = [];
  for (let c = 0; c < channels; c++) chans.push(buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)));
  if (forceMono && buffer.numberOfChannels > 1) {
    const mix = new Float32Array(len);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < len; i++) mix[i] += d[i] / buffer.numberOfChannels;
    }
    chans[0] = mix;
  }
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < channels; c++) {
      let s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      p += 2;
    }
  }
  return ab;
}

export function arrayBufferToBase64(ab) {
  const bytes = new Uint8Array(ab);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function bufferToDataUri(buffer, opts) {
  return 'data:audio/wav;base64,' + arrayBufferToBase64(encodeWav(buffer, opts));
}

export async function dataUriToBuffer(ctx, uri) {
  const comma = uri.indexOf(',');
  const ab = base64ToArrayBuffer(uri.slice(comma + 1));
  return await ctx.decodeAudioData(ab);
}

export function sliceBuffer(ctx, buffer, startSec, endSec) {
  const sr = buffer.sampleRate;
  const s = Math.max(0, Math.floor(startSec * sr));
  const e = Math.min(buffer.length, Math.floor(endSec * sr));
  const len = Math.max(1, e - s);
  const out = ctx.createBuffer(buffer.numberOfChannels, len, sr);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.copyToChannel(buffer.getChannelData(c).slice(s, s + len), c);
  }
  // 2ms fade at both ends so chops never click
  const fade = Math.min(Math.floor(sr * 0.002), Math.floor(len / 2));
  for (let c = 0; c < out.numberOfChannels; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      d[i] *= g;
      d[len - 1 - i] *= g;
    }
  }
  return out;
}

export function reverseBuffer(ctx, buffer) {
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = Float32Array.from(buffer.getChannelData(c));
    d.reverse();
    out.copyToChannel(d, c);
  }
  return out;
}

export function monoData(buffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const len = buffer.length;
  const mix = new Float32Array(len);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mix[i] += d[i] / buffer.numberOfChannels;
  }
  return mix;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

export function safeFilename(s) {
  return (s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
}
