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

// Tab capture: the user shares THIS tab (with audio) while the embedded video plays. The audio
// track goes to a MediaRecorder (off the main thread, so a busy page cannot drop samples); at the
// end the blob is decoded back to PCM. An AnalyserNode on the same stream drives the level meter
// and remembers the peak, so a silent share is caught instead of being "phonked".
export class TabRecorder {
  constructor(ctx) { this.ctx = ctx; this.chunks = []; this.stream = null; this.active = false; this.peak = 0; this.startedAt = 0; }
  async start(onLevel) {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('This browser cannot capture tab audio. Use Chrome or Edge on a computer, or drop the file instead.');
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 320, height: 180, frameRate: 1 }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'include',
    });
    if (!stream.getAudioTracks().length) { stream.getTracks().forEach((t) => t.stop()); throw new Error('No audio in what you shared. Pick THIS TAB and tick "Share tab audio", then try again.'); }
    this.stream = stream;
    const audioOnly = new MediaStream(stream.getAudioTracks());
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => window.MediaRecorder?.isTypeSupported?.(m));
    if (mime) {
      this.rec = new MediaRecorder(audioOnly, { mimeType: mime, audioBitsPerSecond: 256000 });
      this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.rec.start(1000);
    } else {
      this.tap = new PcmTap(this.ctx, audioOnly); // very old browsers: ScriptProcessor fallback
    }
    this.src = this.ctx.createMediaStreamSource(audioOnly);
    this.an = this.ctx.createAnalyser(); this.an.fftSize = 1024; this.src.connect(this.an);
    const buf = new Float32Array(this.an.fftSize);
    this.meter = setInterval(() => {
      this.an.getFloatTimeDomainData(buf); let s = 0, pk = 0;
      for (let i = 0; i < buf.length; i += 2) { const v = buf[i]; s += v * v; if (v > pk) pk = v; else if (-v > pk) pk = -v; }
      this.peak = Math.max(this.peak, pk); onLevel?.(Math.sqrt(s / (buf.length / 2)));
    }, 100);
    this.active = true; this.startedAt = performance.now();
    stream.getVideoTracks()[0]?.addEventListener('ended', () => this.onended?.());
    stream.getAudioTracks()[0]?.addEventListener('ended', () => this.onended?.());
  }
  get seconds() { return this.active ? (performance.now() - this.startedAt) / 1000 : 0; }
  async stop() {
    this.active = false; clearInterval(this.meter);
    try { this.src?.disconnect(); } catch (e) {}
    let buf;
    if (this.rec) {
      if (this.rec.state !== 'inactive') await new Promise((res) => { this.rec.onstop = res; this.rec.stop(); });
      this.stream?.getTracks().forEach((t) => t.stop());
      const blob = new Blob(this.chunks, { type: this.rec.mimeType }); this.chunks = [];
      if (!blob.size) throw new Error('Nothing was recorded.');
      buf = await this.ctx.decodeAudioData(await blob.arrayBuffer());
    } else {
      this.stream?.getTracks().forEach((t) => t.stop());
      buf = this.tap.stop();
    }
    return trimSilence(buf);
  }
}

// ScriptProcessor fallback used only when MediaRecorder cannot do audio.
class PcmTap {
  constructor(ctx, stream) {
    this.ctx = ctx; this.chunks = []; this.length = 0;
    this.src = ctx.createMediaStreamSource(stream);
    this.proc = ctx.createScriptProcessor(4096, 2, 2);
    const sink = ctx.createGain(); sink.gain.value = 0;
    this.proc.onaudioprocess = (e) => { const L = e.inputBuffer.getChannelData(0), R = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : L; this.chunks.push([new Float32Array(L), new Float32Array(R)]); this.length += L.length; };
    this.src.connect(this.proc); this.proc.connect(sink); sink.connect(ctx.destination);
  }
  stop() {
    try { this.proc.disconnect(); this.src.disconnect(); } catch (e) {}
    const buf = this.ctx.createBuffer(2, Math.max(1, this.length), this.ctx.sampleRate);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let o = 0; for (const [l, r] of this.chunks) { L.set(l, o); R.set(r, o); o += l.length; }
    this.chunks = []; return buf;
  }
}

// How loud is a buffer? Peak and RMS over the whole thing (strided), used to refuse silent input.
export function measure(buf) {
  let peak = 0, s = 0, n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i += 8) { const v = d[i]; const a = v < 0 ? -v : v; if (a > peak) peak = a; s += v * v; n++; } }
  return { peak, rms: n ? Math.sqrt(s / n) : 0 };
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
