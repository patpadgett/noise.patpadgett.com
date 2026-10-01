// NOISE — one screen. Drop a song, it comes back phonk.

import { Phonker, PRESETS } from './phonker.js';
import { parseLink, spotifyMeta, youtubeMeta, TabRecorder, MicRecorder, monoOf, measure } from './input.js';
import { encodeWav, encodeMp3, renderVideo, download, safeName } from './export.js';
import { NOTE_NAMES, ignition } from './kit.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const DEMO_URL = 'assets/demo/fare-thee-honey-blues-1920.mp3';
const DEMO_TITLE = 'Fare Thee Honey Blues — Mamie Smith & Her Jazz Hounds (1920)';

class App {
  constructor() {
    this.ph = new Phonker();
    this.worker = new Worker('js/analyze.worker.js');
    this.jobs = new Map(); this.jobId = 0;
    this.worker.onmessage = (e) => { const j = this.jobs.get(e.data.id); if (!j) return; if (e.data.progress != null) j.progress?.(e.data.progress); if (e.data.result) { j.resolve(e.data.result); this.jobs.delete(e.data.id); } if (e.data.error) { j.reject(new Error(e.data.error)); this.jobs.delete(e.data.id); } };
    this.title = '';
    this.bind();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.show('intake');
    const q = new URLSearchParams(location.search).get('u'); if (q) { $('#link').value = q; this.handleLink(q); }
  }
  // ---------- stages ----------
  show(stage) {
    for (const id of ['intake', 'landed', 'work', 'deck']) $('#' + id).hidden = id !== stage;
    document.body.dataset.stage = stage;
    if (stage !== 'deck' && this.ph.playing) this.ph.stop();
  }
  toast(msg, warn = false) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('is-warn', warn); t.classList.add('is-on');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('is-on'), warn ? 6000 : 3200);
  }
  work(title, msg, p) {
    this.show('work');
    if (title) $('#work-title').textContent = title;
    if (msg) $('#work-msg').textContent = msg;
    if (p != null) $('#work-fill').style.width = Math.round(p * 100) + '%';
  }
  // ---------- bind ----------
  bind() {
    const file = $('#file');
    file.addEventListener('change', () => { if (file.files[0]) this.handleFile(file.files[0]); file.value = ''; });
    let dragDepth = 0;
    document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('is-dropping'); });
    document.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('is-dropping'); } });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault(); dragDepth = 0; document.body.classList.remove('is-dropping');
      const f = e.dataTransfer?.files?.[0]; if (f) return this.handleFile(f);
      const txt = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain'); if (txt) { $('#link').value = txt.trim(); this.handleLink(txt); }
    });
    document.addEventListener('paste', (e) => {
      if (document.body.dataset.stage !== 'intake') return;
      if (e.target === $('#link')) return;
      const txt = e.clipboardData?.getData('text'); if (txt && parseLink(txt)) { $('#link').value = txt.trim(); this.handleLink(txt); }
    });
    $('#linkform').addEventListener('submit', (e) => { e.preventDefault(); this.handleLink($('#link').value); });
    $('#mic').addEventListener('click', () => this.recordRoom());
    $('#try').addEventListener('click', () => this.loadDemo());
    $('#landed-back').addEventListener('click', () => { this.teardownYT(); this.show('intake'); });
    $('#yt-go').addEventListener('click', () => this.captureYouTube());
    $('#yt-stop').addEventListener('click', () => this.stopCapture());
    $('#work-stop').addEventListener('click', () => this.stopCapture());
    $('#another').addEventListener('click', () => { this.ph.stop(); this.show('intake'); });
    $('#play').addEventListener('click', () => this.togglePlay());
    document.addEventListener('keydown', (e) => { if (e.code === 'Space' && document.body.dataset.stage === 'deck' && !/input|textarea|button/i.test(e.target.tagName)) { e.preventDefault(); this.togglePlay(); } });
    for (const inp of $$('.sliders input')) {
      inp.addEventListener('input', () => { const k = inp.dataset.param, v = +inp.value; this.ph.setParam(k, v); this.showVal(k, v); $$('.chip[data-preset]').forEach((c) => c.classList.remove('is-on')); });
    }
    for (const chip of $$('.chip[data-preset]')) chip.addEventListener('click', () => { this.ph.setPreset(chip.dataset.preset); this.syncSliders(); $$('.chip[data-preset]').forEach((c) => c.classList.toggle('is-on', c === chip)); this.updateMeta(); });
    $('#reroll').addEventListener('click', () => { this.ph.reroll(); this.toast('New pattern'); });
    $('#save').addEventListener('click', () => this.save());
    const saveLabel = () => { const f = $('input[name=fmt]:checked').value; $('#save').textContent = f === 'video' ? 'SAVE VIDEO' : 'SAVE ' + f.toUpperCase(); };
    $$('input[name=fmt]').forEach((r) => r.addEventListener('change', saveLabel)); saveLabel();
    const seek = $('#seek');
    const seekTo = (clientX) => { const r = seek.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width)); const pos = f * this.ph.source.duration; if (this.ph.playing) this.ph.play(pos); else { this.ph._pausedAt = pos; this.drawSeek(); } };
    seek.addEventListener('pointerdown', (e) => { seekTo(e.clientX); const mv = (ev) => seekTo(ev.clientX); const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); });
    seek.addEventListener('keydown', (e) => { const d = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0; if (d) { e.preventDefault(); const pos = Math.max(0, Math.min(this.ph.source.duration, this.ph.position() + d)); if (this.ph.playing) this.ph.play(pos); else this.ph._pausedAt = pos; } });
    this.ph.onstate = (s) => { $('#play').classList.toggle('is-on', s === 'playing'); $('#play').setAttribute('aria-pressed', s === 'playing'); if (s === 'ended') this.ph._pausedAt = 0; };
  }
  showVal(k, v) {
    const inp = $(`.sliders input[data-param="${k}"]`);
    const frac = inp ? (v - +inp.min) / (+inp.max - +inp.min) : v;
    const el = $(`[data-val="${k}"]`);
    if (el) {
      if (k === 'slow' && this.analysis) el.textContent = Math.round(this.analysis.bpm * v) + ' BPM';
      else if (k === 'slow') el.textContent = Math.round(v * 100) + '%';
      else el.textContent = Math.round(frac * 100) + '%';
    }
    if (inp) inp.style.setProperty('--p', (frac * 100).toFixed(1) + '%');
    if (k === 'slow') this.updateMeta();
  }
  syncSliders() { for (const inp of $$('.sliders input')) { const k = inp.dataset.param; inp.value = this.ph.params[k]; this.showVal(k, this.ph.params[k]); } }
  updateMeta() {
    const a = this.analysis; if (!a || !this.ph.source) return;
    const key = NOTE_NAMES[a.key.root] + (a.key.mode === 'minor' ? 'm' : '');
    $('#now-meta').textContent = `${Math.round(a.bpm)} BPM slowed to ${Math.round(a.bpm * this.ph.params.slow)} · ${key} · ${fmtTime(this.ph.source.duration / this.ph.params.slow)}`;
  }

  // ---------- inputs ----------
  async handleFile(f) {
    if (!/^(audio|video)\//.test(f.type) && !/\.(mp3|wav|m4a|aac|ogg|flac|webm|mp4|aif|aiff)$/i.test(f.name)) return this.toast('That is not an audio file.', true);
    this.title = f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
    this.work('READING…', f.name, 0.05);
    try {
      const ab = await f.arrayBuffer();
      const buf = await this.ph.decode(ab);
      await this.phonkify(buf);
    } catch (err) { console.error(err); this.toast('Could not read that file: ' + err.message, true); this.show('intake'); }
  }
  async handleLink(text) {
    const link = parseLink(text);
    if (!link) return this.toast('Paste a YouTube or Spotify link, or an audio URL.', true);
    if (link.kind === 'youtube') return this.landYouTube(link);
    if (link.kind === 'spotify') return this.landSpotify(link);
    if (link.kind === 'audio-url') {
      this.title = decodeURIComponent(link.url.split('/').pop().replace(/\.[^.]+$/, ''));
      this.work('FETCHING…', link.url, 0.05);
      try { const r = await fetch(link.url); if (!r.ok) throw new Error('HTTP ' + r.status); const buf = await this.ph.decode(await r.arrayBuffer()); await this.phonkify(buf); }
      catch (err) { this.toast('Could not fetch that URL (the site may block cross-origin requests). Download it and drop the file instead.', true); this.show('intake'); }
      return;
    }
    this.toast('That link is not YouTube, Spotify or a direct audio file. Drop the file instead.', true);
  }
  async landSpotify(link) {
    this.show('landed');
    $('#landed-kind').textContent = 'SPOTIFY';
    $('#landed-title').textContent = 'Looking it up…';
    $('#landed-how').textContent = '';
    $('#landed-thumb').hidden = true;
    $('#yt').hidden = true;
    try {
      const m = await spotifyMeta(link);
      this.title = m.title;
      $('#landed-title').textContent = m.title;
      if (m.thumb) { $('#landed-thumb').src = m.thumb; $('#landed-thumb').hidden = false; }
    } catch (e) { $('#landed-title').textContent = 'Spotify track'; }
    const how = $('#landed-how');
    how.innerHTML = 'Spotify does not let a website pull the audio. Two ways in: play it on your phone or speaker and press <b>RECORD THE ROOM</b>, or drop the file if you own it.<br>';
    const btn = document.createElement('button'); btn.className = 'btn btn--hot'; btn.textContent = 'RECORD THE ROOM'; btn.style.marginTop = '12px';
    btn.addEventListener('click', () => this.recordRoom()); how.appendChild(btn);
  }
  async landYouTube(link) {
    this.show('landed');
    this.ytId = link.id;
    $('#landed-kind').textContent = 'YOUTUBE';
    $('#landed-title').textContent = 'Loading…';
    $('#landed-how').textContent = '';
    $('#landed-thumb').hidden = true;
    $('#yt').hidden = false;
    $('#yt-stop').hidden = true; $('#yt-go').hidden = false; $('#yt-go').disabled = false;
    const canCapture = !!navigator.mediaDevices?.getDisplayMedia;
    if (!canCapture) $('#yt-hint').innerHTML = 'This browser cannot record a tab (Chrome or Edge on a computer can). Download the audio another way and drop the file, or play it out loud and press <b>RECORD THE ROOM</b>.';
    const m = await youtubeMeta(link);
    this.title = m.title;
    $('#landed-title').textContent = m.title;
    await this.loadYTApi();
    this.teardownYT();
    $('#yt-hint').innerHTML = canCapture ? 'Press <b>PHONK IT</b>. In the browser\'s dialog pick <b>this tab</b> and tick <b>Share tab audio</b>. NOISE records the video as it plays — a 4-minute video takes 4 minutes — then builds the phonk version. Press STOP RECORDING any time to use what it has.' : $('#yt-hint').innerHTML;
    $('#yt-go').disabled = true; $('#yt-go').textContent = 'LOADING VIDEO…';
    this.yt = new YT.Player('yt-player', { videoId: link.id, width: '100%', height: '100%', playerVars: { rel: 0, modestbranding: 1, playsinline: 1, controls: 1, origin: location.origin },
      events: {
        onReady: () => { if (canCapture) { $('#yt-go').disabled = false; $('#yt-go').textContent = 'PHONK IT'; } },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.ENDED && this.capturing) this.stopCapture();
          if (e.data === YT.PlayerState.PLAYING) this.ytPlaying = true;
        },
        onError: (e) => {
          // 101/150 = owner disallows embedding; 100 = removed/private; 2/5 = bad id or player error
          const why = (e.data === 101 || e.data === 150) ? 'The owner of this video does not allow it to play on other sites' : e.data === 100 ? 'That video is private or removed' : 'YouTube could not load that video';
          $('#yt-hint').innerHTML = `<b>${why}.</b> Open it on YouTube, play it out loud and press <b>RECORD THE ROOM</b>, or drop the audio file instead.`;
          $('#yt-go').disabled = true;
          this.toast(why + '.', true);
        },
      } });
  }
  loadYTApi() {
    if (window.YT?.Player) return Promise.resolve();
    return new Promise((resolve) => { window.onYouTubeIframeAPIReady = resolve; const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s); });
  }
  teardownYT() {
    try { this.yt?.destroy(); } catch (e) {}
    this.yt = null; this.ytPlaying = false;
    if (!$('#yt-player')) { const d = document.createElement('div'); d.id = 'yt-player'; $('.yt__frame').appendChild(d); }
  }
  async captureYouTube() {
    const ctx = this.ph.ensure();
    const rec = new TabRecorder(ctx);
    try { await rec.start((lvl) => this.level(lvl)); }
    catch (err) { return this.toast(err.message, true); }
    this.recorder = rec; this.capturing = true;
    rec.onended = () => { if (this.capturing) this.stopCapture(); };
    this.ytPlaying = false;
    try { this.yt.seekTo(0, true); this.yt.setVolume(100); this.yt.unMute(); this.yt.playVideo(); } catch (e) {}
    const dur = (() => { try { return this.yt.getDuration() || 0; } catch (e) { return 0; } })();
    this.work('RECORDING THE VIDEO…', 'starting the video…', 0);
    $('#level').hidden = false; $('#work-stop').hidden = false;
    const t0 = performance.now();
    this.capTimer = setInterval(() => {
      const el = (performance.now() - t0) / 1000;
      const playing = (() => { try { return this.yt.getPlayerState() === 1; } catch (e) { return this.ytPlaying; } })();
      if (!playing && el > 6) { this.work(null, 'The video is not playing. Go back and press play on it, then PHONK IT again.', 0); return; }
      const quiet = el > 8 && rec.peak < 0.01;
      const left = dur ? `${Math.max(0, Math.round(dur - el))}s to go` : `${Math.round(el)}s recorded`;
      this.work(null, quiet ? `${left} — hearing nothing yet: did you tick "Share tab audio"?` : `${left} — keep this tab open`, dur ? Math.min(0.98, el / dur) : 0);
    }, 500);
  }
  level(v) { const i = $('#level i'); if (i) i.style.transform = `scaleX(${Math.min(1, v * 6)})`; }
  async stopCapture() {
    if (!this.capturing) return;
    this.capturing = false; clearInterval(this.capTimer);
    $('#level').hidden = true; $('#work-stop').hidden = true;
    try { this.yt?.pauseVideo(); } catch (e) {}
    const rec = this.recorder; this.recorder = null;
    this.work(null, 'finishing the recording…', 0.99);
    let buf;
    try { buf = await rec.stop(); } catch (err) { this.toast('Recording failed: ' + err.message, true); return this.show(this.yt ? 'landed' : 'intake'); }
    if (buf.duration < 4) { this.toast('Recorded less than 4 seconds. Try again and let it play.', true); return this.show(this.yt ? 'landed' : 'intake'); }
    const m = measure(buf);
    if (m.peak < 0.01) { this.toast('That recording is silent. Pick THIS TAB in the share dialog and tick "Share tab audio" (or let the video play unmuted).', true); return this.show(this.yt ? 'landed' : 'intake'); }
    console.info(`NOISE recorded ${buf.duration.toFixed(1)}s, peak ${(20 * Math.log10(m.peak)).toFixed(1)} dBFS, rms ${(20 * Math.log10(m.rms || 1e-6)).toFixed(1)} dBFS`);
    await this.phonkify(buf);
  }
  async recordRoom() {
    const ctx = this.ph.ensure();
    const rec = new MicRecorder(ctx);
    try { await rec.start((lvl) => this.level(lvl)); } catch (err) { return this.toast('Microphone blocked: ' + err.message, true); }
    this.recorder = rec; this.capturing = true;
    if (!this.title || this.title === DEMO_TITLE) this.title = 'Room recording';
    this.work('RECORDING THE ROOM…', 'play the song near your device, press STOP when it ends', 0);
    $('#level').hidden = false; $('#work-stop').hidden = false;
    const t0 = performance.now();
    this.capTimer = setInterval(() => { const el = (performance.now() - t0) / 1000; this.work(null, `${Math.round(el)}s recorded — press STOP RECORDING when the song ends`, Math.min(0.98, el / 240)); if (el > 600) this.stopCapture(); }, 500);
  }
  async loadDemo() {
    this.title = DEMO_TITLE;
    this.work('FETCHING THE 78…', 'Mamie Smith & Her Jazz Hounds, Okeh 1920', 0.05);
    try { const r = await fetch(DEMO_URL); const buf = await this.ph.decode(await r.arrayBuffer()); await this.phonkify(buf); }
    catch (err) { this.toast('Could not load the demo: ' + err.message, true); this.show('intake'); }
  }

  // ---------- the whole point ----------
  async phonkify(buffer) {
    try { await this._phonkify(buffer); }
    catch (err) { console.error(err); this.toast('Something broke while building the phonk version: ' + err.message, true); this.show('intake'); }
  }
  async _phonkify(buffer) {
    if (buffer.duration > 12 * 60) { this.toast('That is over 12 minutes. Trim it first.', true); return this.show('intake'); }
    const m = measure(buffer);
    if (m.peak < 0.01) { this.toast('That audio is silent — nothing to phonk.', true); return this.show('intake'); }
    this.work('LISTENING…', 'finding the beat and the key', 0.1);
    const pcm = monoOf(buffer);
    const analysis = await this.analyze(pcm, buffer.sampleRate, (p) => this.work(null, p < 0.7 ? 'finding the beat' : p < 0.9 ? 'locking the grid' : 'reading the key', 0.1 + p * 0.8));
    if (!analysis.beats || analysis.beats.length < 8) { this.toast('Could not find a beat in that. Try a song with drums.', true); return this.show('intake'); }
    this.analysis = analysis;
    this.ph.load(buffer, analysis);
    this.ph.setPreset('drift'); $$('.chip[data-preset]').forEach((c) => c.classList.toggle('is-on', c.dataset.preset === 'drift'));
    this.syncSliders();
    $('#now-title').textContent = this.title || 'Untitled';
    this.updateMeta();
    this.work('BUILDING THE PHONK VERSION', 'drums, 808, cowbell, tape', 0.97);
    await new Promise((r) => setTimeout(r, 250));
    this.show('deck');
    // the deck is reached from a click (file/link/try) so the context is normally running; if the
    // browser still has it suspended, the big play button is the way in and we say so
    const ctx = this.ph.ensure();
    if (ctx.state !== 'running') {
      this.toast('Press play to hear it.');
      const kick = () => { ctx.resume().then(() => { if (!this.ph.playing) this.ph.play(0); }); document.removeEventListener('pointerdown', kick); };
      document.addEventListener('pointerdown', kick);
      return;
    }
    try { ignition(ctx, ctx.destination); } catch (e) {}
    setTimeout(() => this.ph.play(0), 900);
  }
  analyze(pcm, sampleRate, progress) {
    const id = ++this.jobId;
    return new Promise((resolve, reject) => { this.jobs.set(id, { resolve, reject, progress }); this.worker.postMessage({ id, pcm, sampleRate }, [pcm.buffer]); });
  }
  togglePlay() { if (!this.ph.source) return; if (this.ph.playing) this.ph.stop(); else this.ph.play(this.ph._pausedAt || 0); }

  // ---------- save ----------
  async save() {
    if (!this.ph.source) return;
    const fmt = $('input[name=fmt]:checked').value;
    const btn = $('#save'); const prog = $('#save-prog'); const bar = $('#save-prog i');
    btn.disabled = true; prog.hidden = false; bar.style.width = '0%';
    const wasPlaying = this.ph.playing; if (wasPlaying) this.ph.stop();
    const setP = (p, label) => { bar.style.width = Math.round(p * 100) + '%'; btn.textContent = label; };
    const name = safeName(this.title) + '-phonk';
    try {
      setP(0.02, 'RENDERING…');
      const mix = await this.ph.render((p) => setP(p * 0.6, 'RENDERING ' + Math.round(p * 100) + '%'));
      if (fmt === 'wav') { setP(0.9, 'WRITING WAV…'); download(encodeWav(mix), name + '.wav'); }
      else if (fmt === 'mp3') { const blob = await encodeMp3(mix, 192, (p) => setP(0.6 + p * 0.4, 'ENCODING MP3 ' + Math.round(p * 100) + '%')); download(blob, name + '.mp3'); }
      else {
        setP(0.62, 'FILMING… (plays through once)');
        const [art, pin] = await Promise.all([loadImg('assets/art/countach.jpg'), loadImg('assets/art/pinup.jpg')]);
        const { blob, ext } = await renderVideo({ buffer: mix, title: this.title, artImg: art, pinupImg: pin, onProgress: (p) => setP(0.62 + p * 0.38, 'FILMING ' + Math.round(p * 100) + '%') });
        download(blob, name + '.' + ext);
      }
      setP(1, 'SAVED');
      this.toast('Saved ' + name + (fmt === 'video' ? ' video' : '.' + fmt));
    } catch (err) { console.error(err); this.toast('Save failed: ' + err.message, true); }
    setTimeout(() => { btn.disabled = false; btn.textContent = fmt === 'video' ? 'SAVE VIDEO' : 'SAVE ' + fmt.toUpperCase(); prog.hidden = true; }, 1200);
    if (wasPlaying) this.ph.play(this.ph._pausedAt || 0);
  }

  // ---------- visuals ----------
  loop() {
    requestAnimationFrame(this.loop);
    if (document.body.dataset.stage !== 'deck') return;
    this.drawSeek();
    const cv = $('#scope'); const g = this.ph.live;
    const r = cv.getBoundingClientRect(); const w = Math.floor(r.width), h = Math.floor(r.height);
    if (!w || !h) return;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const c = cv.getContext('2d'); c.clearRect(0, 0, w, h);
    if (!g) {
      document.documentElement.style.setProperty('--bass', 0);
      const pk = this.peaks(w); c.fillStyle = 'rgba(219,226,244,.28)';
      for (let i = 8; i < w - 8; i += 3) { const v = pk[i] * (h - 8); c.fillRect(i, h / 2 - v / 2, 2, Math.max(2, v)); }
      return;
    }
    const f = g.tape.spectrum(); const bars = 64; const inset = 8; const bw = (w - inset * 2) / bars;
    let bass = 0; for (let i = 2; i < 10; i++) bass += f[i]; bass /= 8 * 255;
    document.documentElement.style.setProperty('--bass', bass.toFixed(3));
    for (let i = 0; i < bars; i++) {
      const v = Math.pow(f[Math.floor(Math.pow(i / bars, 1.6) * f.length * 0.5)] / 255, 0.7);
      const bh = Math.max(3, v * (h - 4));
      c.fillStyle = i % 2 ? '#19e6ff' : '#ff2bd6'; c.globalAlpha = 0.5 + v * 0.5;
      c.fillRect(inset + i * bw + 1, (h - bh) / 2, bw - 2, bh); // grow from the center line, like a VU
    }
    c.globalAlpha = 1;
  }
  peaks(w) {
    if (this._peaks && this._peaks.w === w && this._peaks.src === this.ph.source) return this._peaks.v;
    const d = this.ph.source.getChannelData(0), n = d.length, v = new Float32Array(w), per = Math.max(1, Math.floor(n / w));
    for (let i = 0; i < w; i++) { let m = 0; const b = i * per; for (let k = 0; k < per; k += 8) m = Math.max(m, Math.abs(d[b + k] || 0)); v[i] = m; }
    this._peaks = { w, src: this.ph.source, v }; return v;
  }
  drawSeek() {
    if (!this.ph.source) return;
    const pos = this.ph.position(), f = pos / this.ph.source.duration;
    $('#seek-fill').style.width = (f * 100).toFixed(2) + '%';
    $('#seek').setAttribute('aria-valuenow', Math.round(f * 100));
  }
}
function fmtTime(s) { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

window.noise = new App();
