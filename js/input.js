// NOISE — getting a song in. File drop, YouTube tab capture, Spotify metadata, microphone.

export function parseLink(text) {
  const s = (text || '').trim();
  let m;
  if ((m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/))) return { kind: 'youtube', id: m[1], url: s };
  if ((m = s.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|episode)\/([A-Za-z0-9]+)/))) return { kind: 'spotify', type: m[1], id: m[2], url: `https://open.spotify.com/${m[1]}/${m[2]}` };
  if (/^https?:\/\//i.test(s) && /\.(mp3|wav|m4a|ogg|flac|aac|webm)(\?|$)/i.test(s)) return { kind: 'audio-url', url: s };
  if (/^https?:\/\//i.test(s)) return { kind: 'unknown-url', url: s };
  return null;
}

// Spotify gives title/artist/cover through its public oEmbed endpoint, never the audio.
export async function spotifyMeta(link) {
  const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(link.url)}`);
  if (!r.ok) throw new Error('Spotify did not answer');
  const j = await r.json();
  return { title: j.title, thumb: j.thumbnail_url, provider: 'Spotify' };
}
export async function youtubeMeta(link) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + link.id)}&format=json`);
    if (!r.ok) throw new Error();
    const j = await r.json();
    return { title: j.title, author: j.author_name, thumb: j.thumbnail_url, provider: 'YouTube' };
  } catch (e) { return { title: 'YouTube video', thumb: `https://i.ytimg.com/vi/${link.id}/hqdefault.jpg`, provider: 'YouTube' }; }
}

// Tab capture: the user shares THIS tab (with audio) while the embedded video plays; we record the
// stream to PCM through a ScriptProcessor (works everywhere getDisplayMedia does) and stop at the
// end of the video or when the user presses stop.
export class TabRecorder {
  constructor(ctx) { this.ctx = ctx; this.chunks = []; this.length = 0; this.stream = null; this.proc = null; this.active = false; }
  async start(onLevel) {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('This browser cannot capture tab audio. Use Chrome or Edge, or drop the file instead.');
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 320, height: 180, frameRate: 1 }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'include',
    });
    if (!stream.getAudioTracks().length) { stream.getTracks().forEach((t) => t.stop()); throw new Error('No audio in the shared tab. Tick "Share tab audio" in the dialog and try again.'); }
    this.stream = stream;
    const src = this.ctx.createMediaStreamSource(stream);
    const proc = this.ctx.createScriptProcessor(4096, 2, 2);
    const sink = this.ctx.createGain(); sink.gain.value = 0;
    proc.onaudioprocess = (e) => {
      if (!this.active) return;
      const L = e.inputBuffer.getChannelData(0), R = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : L;
      this.chunks.push([new Float32Array(L), new Float32Array(R)]); this.length += L.length;
      if (onLevel) { let s = 0; for (let i = 0; i < L.length; i += 16) s += L[i] * L[i]; onLevel(Math.sqrt(s / (L.length / 16))); }
    };
    src.connect(proc); proc.connect(sink); sink.connect(this.ctx.destination);
    this.src = src; this.proc = proc; this.active = true;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => this.onended?.());
    stream.getAudioTracks()[0]?.addEventListener('ended', () => this.onended?.());
  }
  stop() {
    this.active = false;
    try { this.proc?.disconnect(); this.src?.disconnect(); } catch (e) {}
    this.stream?.getTracks().forEach((t) => t.stop());
    const buf = this.ctx.createBuffer(2, Math.max(1, this.length), this.ctx.sampleRate);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let o = 0; for (const [l, r] of this.chunks) { L.set(l, o); R.set(r, o); o += l.length; }
    this.chunks = []; this.length = 0;
    return trimSilence(buf);
  }
}

export class MicRecorder {
  constructor(ctx) { this.ctx = ctx; this.chunks = []; this.length = 0; }
  async start(onLevel) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    this.stream = stream;
    const src = this.ctx.createMediaStreamSource(stream);
    const proc = this.ctx.createScriptProcessor(4096, 1, 1);
    const sink = this.ctx.createGain(); sink.gain.value = 0;
    proc.onaudioprocess = (e) => { const d = e.inputBuffer.getChannelData(0); this.chunks.push(new Float32Array(d)); this.length += d.length; if (onLevel) { let s = 0; for (let i = 0; i < d.length; i += 16) s += d[i] * d[i]; onLevel(Math.sqrt(s / (d.length / 16))); } };
    src.connect(proc); proc.connect(sink); sink.connect(this.ctx.destination);
    this.src = src; this.proc = proc;
  }
  stop() {
    try { this.proc?.disconnect(); this.src?.disconnect(); } catch (e) {}
    this.stream?.getTracks().forEach((t) => t.stop());
    const buf = this.ctx.createBuffer(1, Math.max(1, this.length), this.ctx.sampleRate);
    const d = buf.getChannelData(0); let o = 0; for (const c of this.chunks) { d.set(c, o); o += c.length; }
    this.chunks = []; this.length = 0;
    return trimSilence(buf);
  }
}

export function trimSilence(buf, thresh = 0.004) {
  const n = buf.length, ch = buf.numberOfChannels;
  let s = 0, e = n - 1;
  const loud = (i) => { for (let c = 0; c < ch; c++) if (Math.abs(buf.getChannelData(c)[i]) > thresh) return true; return false; };
  while (s < n && !loud(s)) s++;
  while (e > s && !loud(e)) e--;
  s = Math.max(0, s - Math.floor(buf.sampleRate * 0.05)); e = Math.min(n - 1, e + Math.floor(buf.sampleRate * 0.3));
  if (e - s < buf.sampleRate * 2) return buf;
  const out = new AudioBuffer({ numberOfChannels: ch, length: e - s, sampleRate: buf.sampleRate });
  for (let c = 0; c < ch; c++) out.copyToChannel(buf.getChannelData(c).subarray(s, e), c);
  return out;
}

export function monoOf(buf) {
  const n = buf.length, ch = buf.numberOfChannels, m = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) m[i] += d[i] / ch; }
  return m;
}
