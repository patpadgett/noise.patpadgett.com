// NOISE — one screen. Drop a song, it comes back phonk.
//
// Flow: intake → analysis (beat/key worker) → quick split (pitch worker: harmonic/percussive +
// minor re-tune + melody) → the deck plays within seconds. Then, on a computer, the neural stems
// (Demucs v4 in WASM workers) land region by region; each landed region is re-tuned by the pitch
// worker and takes over at the next bar. SAVE renders whatever material is complete.

import { Phonker, PRESETS, Material, flatsFor } from './phonker.js';
import { parseLink, spotifyMeta, youtubeMeta, TabRecorder, MicRecorder, monoOf, measure } from './input.js';
import { encodeWav, encodeMp3, renderVideo, download, safeName } from './export.js';
import { NOTE_NAMES, ignition } from './kit.js';
import { neuralCapability, estimateSeconds, ensureModel, modelCached, StemJob, to44k, MODEL_BYTES, CHUNK_CORE } from './stems.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const DEMO_URL = 'assets/demo/fare-thee-honey-blues-1920.mp3';
const DEMO_TITLE = 'Fare Thee Honey Blues — Mamie Smith & Her Jazz Hounds (1920)';
const SR = 44100;
const fmtMin = (s) => { s = Math.max(0, Math.round(s)); if (s < 60) return s + ' s'; const m = Math.floor(s / 60); return m + ' min' + (s % 60 >= 30 && m < 10 ? ' ' + (s % 60) + ' s' : ''); };

class App {
  constructor() {
    this.ph = new Phonker();
    this.worker = new Worker('js/analyze.worker.js');
    this.jobs = new Map(); this.jobId = 0;
    this.worker.onmessage = (e) => { const j = this.jobs.get(e.data.id); if (!j) return; if (e.data.progress != null) j.progress?.(e.data.progress); if (e.data.result) { j.resolve(e.data.result); this.jobs.delete(e.data.id); } if (e.data.error) { j.reject(new Error(e.data.error)); this.jobs.delete(e.data.id); } };
    this.pitchWorker = new Worker('js/pitch.worker.js');
    this.pitchJobs = new Map(); this.pitchId = 0;
    this.pitchWorker.onmessage = (e) => { const j = this.pitchJobs.get(e.data.id); if (!j) return; if (e.data.type === 'progress') j.progress?.(e.data.p); else if (e.data.type === 'done') { j.resolve(e.data); this.pitchJobs.delete(e.data.id); } else if (e.data.type === 'error') { j.reject(new Error(e.data.error)); this.pitchJobs.delete(e.data.id); } };
    this.title = ''; this.stemJob = null; this.cap = neuralCapability(); this.session = 0;
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
    $('#another').addEventListener('click', () => { this.ph.stop(); this.cancelStems(); this.show('intake'); });
    $('#play').addEventListener('click', () => this.togglePlay());
    $('#neural').addEventListener('click', () => this.startStems());
    document.addEventListener('keydown', (e) => { if (e.code === 'Space' && document.body.dataset.stage === 'deck' && !/input|textarea|button/i.test(e.target.tagName)) { e.preventDefault(); this.togglePlay(); } });
    for (const inp of $$('.sliders input, .knob input')) {
      inp.addEventListener('input', () => { const k = inp.dataset.param, v = +inp.value; this.ph.setParam(k, v); this.showVal(k, v); $$('.chip[data-preset]').forEach((c) => c.classList.remove('is-on')); if (k === 'chop' || k === 'sens') { this.drawFlags(); this.buildPads(); } });
    }
    for (const chip of $$('.chip[data-preset]')) chip.addEventListener('click', () => { this.ph.setPreset(chip.dataset.preset); this.syncSliders(); $$('.chip[data-preset]').forEach((c) => c.classList.toggle('is-on', c === chip)); this.updateMeta(); this.drawFlags(); });
    for (const key of $$('.slotkey')) key.addEventListener('click', () => { this.ph.setSlot(+key.dataset.slot); $$('.slotkey').forEach((k) => { const on = k === key; k.classList.toggle('is-on', on); k.setAttribute('aria-checked', on); }); this.drawFlags(); this.buildPads(); });
    $('#save').addEventListener('click', () => this.save());
    const saveLabel = () => { const f = $('input[name=fmt]:checked').value; $('#save').textContent = f === 'video' ? 'SAVE VIDEO' : 'SAVE ' + f.toUpperCase(); };
    $$('input[name=fmt]').forEach((r) => r.addEventListener('change', saveLabel)); saveLabel();
    const seek = $('#seek');
    const seekTo = (clientX) => { const r = seek.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width)); const pos = f * this.ph.source.duration; if (this.ph.playing) this.ph.play(pos); else { this.ph._pausedAt = pos; this.drawSeek(); } };
    seek.addEventListener('pointerdown', (e) => { seekTo(e.clientX); const mv = (ev) => seekTo(ev.clientX); const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); });
    seek.addEventListener('keydown', (e) => { const d = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0; if (d) { e.preventDefault(); const pos = Math.max(0, Math.min(this.ph.source.duration, this.ph.position() + d)); if (this.ph.playing) this.ph.play(pos); else this.ph._pausedAt = pos; } });
    this.ph.onstate = (s) => { $('#play').classList.toggle('is-on', s === 'playing'); $('#play').setAttribute('aria-pressed', s === 'playing'); if (s === 'ended') this.ph._pausedAt = 0; };
    window.addEventListener('resize', () => { this._wave = null; this.drawFlags(); });
  }
  showVal(k, v) {
    const inp = $(`.sliders input[data-param="${k}"], .knob input[data-param="${k}"]`);
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
  syncSliders() { for (const inp of $$('.sliders input, .knob input')) { const k = inp.dataset.param; inp.value = this.ph.params[k]; this.showVal(k, this.ph.params[k]); } }
  keyLabel() {
    const a = this.analysis; if (!a) return '';
    const from = NOTE_NAMES[a.key.root] + (a.key.mode === 'minor' ? ' minor' : ' major');
    const to = NOTE_NAMES[a.key.root] + ' minor';
    return a.key.mode === 'minor' ? `${from} · already minor` : `${from} → ${to}`;
  }
  updateMeta() {
    const a = this.analysis; if (!a || !this.ph.source) return;
    $('#now-meta').textContent = `${Math.round(a.bpm)} BPM slowed to ${Math.round(a.bpm * this.ph.params.slow)} · ${this.keyLabel()} · ${fmtTime(this.ph.source.duration / this.ph.params.slow)}`;
    $('#lcd-key-main').textContent = NOTE_NAMES[a.key.root] + 'm';
    $('#lcd-key-sub').textContent = a.key.mode === 'minor' ? 'was already minor' : `was ${NOTE_NAMES[a.key.root]} major`;
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
    const session = ++this.session;
    this.cancelStems();
    if (buffer.duration > 12 * 60) { this.toast('That is over 12 minutes. Trim it first.', true); return this.show('intake'); }
    const m = measure(buffer);
    if (m.peak < 0.01) { this.toast('That audio is silent — nothing to phonk.', true); return this.show('intake'); }
    this.work('LISTENING…', 'finding the beat and the key', 0.05);
    buffer = await to44k(buffer);
    const pcm = monoOf(buffer);
    const analysis = await this.analyze(pcm, buffer.sampleRate, (p) => this.work(null, p < 0.7 ? 'finding the beat' : p < 0.9 ? 'locking the grid' : 'reading the key', 0.05 + p * 0.45));
    if (session !== this.session) return;
    if (!analysis.beats || analysis.beats.length < 8) { this.toast('Could not find a beat in that. Try a song with drums.', true); return this.show('intake'); }
    this.analysis = analysis;
    // quick split: the whole song through the pitch worker (music/drums, minor re-tune, melody)
    const flats = flatsFor(analysis.key);
    const keyMsg = analysis.key.mode === 'major' ? `${NOTE_NAMES[analysis.key.root]} major → ${NOTE_NAMES[analysis.key.root]} minor` : `${NOTE_NAMES[analysis.key.root]} minor, reading the melody`;
    this.work('RE-TUNING…', keyMsg, 0.5);
    const quick = new Material(this.ph.ensure(), buffer.length, 'quick');
    const L = buffer.getChannelData(0), R = buffer.getChannelData(1);
    const res = await this.pitch({ L: L.slice(), R: R.slice(), sr: SR, flats, hpss: true }, (p) => this.work(null, keyMsg, 0.5 + p * 0.45));
    if (session !== this.session) return;
    quick.add({ a: 0, s: 0, e: buffer.length, tonal: res.tonal, perc: res.perc, f0: res.f0 });
    this.ph.load(buffer, analysis, quick);
    this.ph.setPreset('drift'); $$('.chip[data-preset]').forEach((c) => c.classList.toggle('is-on', c.dataset.preset === 'drift'));
    $$('.slotkey').forEach((k) => { const on = k.dataset.slot === '0'; k.classList.toggle('is-on', on); k.setAttribute('aria-checked', on); });
    this.ph.setSlot(0);
    this.syncSliders();
    $('#now-title').textContent = this.title || 'Untitled';
    this.updateMeta();
    this._wave = null; this.neuralState('quick');
    this.buildPads(); this.drawFlags();
    this.work('BUILDING THE PHONK VERSION', 'drums, bells, chops, tape', 0.98);
    await new Promise((r) => setTimeout(r, 200));
    if (session !== this.session) return;
    this.show('deck');
    this.drawFlags();
    const ctx = this.ph.ensure();
    if (ctx.state !== 'running') {
      this.toast('Press play to hear it.');
      const kick = () => { ctx.resume().then(() => { if (!this.ph.playing) this.ph.play(0); }); document.removeEventListener('pointerdown', kick); };
      document.addEventListener('pointerdown', kick);
    } else {
      try { ignition(ctx, ctx.destination); } catch (e) {}
      setTimeout(() => { if (session === this.session) this.ph.play(0); }, 900);
    }
    // neural stems start on their own on a capable machine once the model is cached; otherwise it is one press
    if (this.cap.ok && await modelCached()) this.startStems();
  }
  analyze(pcm, sampleRate, progress) {
    const id = ++this.jobId;
    return new Promise((resolve, reject) => { this.jobs.set(id, { resolve, reject, progress }); this.worker.postMessage({ id, pcm, sampleRate }, [pcm.buffer]); });
  }
  pitch(job, progress) {
    const id = ++this.pitchId;
    const transfer = [job.L.buffer, job.R.buffer]; if (job.melL) transfer.push(job.melL.buffer, job.melR.buffer);
    return new Promise((resolve, reject) => { this.pitchJobs.set(id, { resolve, reject, progress }); this.pitchWorker.postMessage({ id, ...job }, transfer); });
  }
  togglePlay() { if (!this.ph.source) return; if (this.ph.playing) this.ph.stop(); else this.ph.play(this.ph._pausedAt || 0); }

  // ---------- neural stems ----------
  // Lamp semantics: off = quick split only; blinking = that stem is being computed; on = that stem has
  // landed for the region under the playhead (so lamps come on bar by bar as regions arrive, not at the end).
  neuralState(state, info = {}) {
    const main = $('#lcd-stems-main'), sub = $('#lcd-stems-sub'), btn = $('#neural');
    const lamps = $$('.lamp');
    document.body.dataset.stems = state;
    $('#wave-legend').hidden = !(state === 'running' || state === 'done');
    if (state === 'quick') {
      main.textContent = 'QUICK SPLIT'; sub.textContent = 'music / drums · playing now';
      lamps.forEach((l) => l.classList.remove('is-on', 'is-live'));
      if (!this.cap.ok) { btn.hidden = true; sub.textContent = this.cap.why.startsWith('Neural') ? 'music / drums · real stems need a computer' : 'music / drums · no model in this browser'; }
      else { btn.hidden = false; btn.disabled = false; const est = estimateSeconds(this.ph.source.duration, this.cap.workers); btn.textContent = 'GET THE REAL STEMS'; sub.textContent = `playing now · real stems ≈ ${fmtMin(est)}`; }
    } else if (state === 'confirm') {
      main.textContent = 'REAL STEMS?'; sub.textContent = `${Math.round(MODEL_BYTES / 1048576)} MB model, once · then ≈ ${fmtMin(info.est)} of work · keep listening meanwhile`;
      btn.disabled = false; btn.textContent = 'YES, FETCH IT';
    } else if (state === 'download') {
      main.textContent = 'FETCHING MODEL'; sub.textContent = `${Math.round(info.got / 1048576)} / ${Math.round(MODEL_BYTES / 1048576)} MB · once, then cached`;
      btn.disabled = false; btn.textContent = 'CANCEL';
    } else if (state === 'running') {
      main.textContent = `STEMS ${Math.round(info.frac * 100)}%`;
      sub.textContent = info.secondsLeft == null ? (info.firstIn > 0 ? `quick split playing · first stems in ≈ ${fmtMin(info.firstIn)}` : 'quick split playing · measuring speed…') : `quick split playing · ≈ ${fmtMin(info.secondsLeft)} left`;
      btn.disabled = false; btn.textContent = 'STOP';
      lamps.forEach((l) => { if (!l.classList.contains('is-on')) l.classList.add('is-live'); });
    } else if (state === 'done') {
      main.textContent = 'NEURAL STEMS'; sub.textContent = `four stems · took ${fmtMin(info.elapsed)}`;
      btn.hidden = true;
      lamps.forEach((l) => { l.classList.remove('is-live'); l.classList.add('is-on'); });
    } else if (state === 'error') {
      main.textContent = 'QUICK SPLIT'; sub.textContent = info.msg || 'stems failed';
      btn.disabled = false; btn.textContent = 'TRY STEMS AGAIN'; btn.hidden = false;
      lamps.forEach((l) => l.classList.remove('is-on', 'is-live'));
    }
  }
  // called from the frame loop: light the lamps for the region under the playhead
  lampsAt(pos) {
    if (document.body.dataset.stems !== 'running') return;
    const landed = (this.regions || []).some(([s, e]) => pos >= s && pos < e);
    if (landed === this._lampsLanded) return; this._lampsLanded = landed;
    $$('.lamp').forEach((l) => { l.classList.toggle('is-on', landed); l.classList.toggle('is-live', !landed); });
  }
  cancelStems() { if (this.stemJob) { this.stemJob.cancel(); this.stemJob = null; } this.stemAbort?.abort(); this.stemAbort = null; this._lampsLanded = undefined; }
  async startStems() {
    if (!this.ph.source) return;
    if (this.stemJob) { this.cancelStems(); this.neuralState('quick'); this.toast('Stopped. The quick split stays.'); return; }
    if (this.stemAbort) { this.cancelStems(); this.neuralState('quick'); this.toast('Download cancelled. The quick split stays.'); return; }
    if (!this.cap.ok) return this.toast(this.cap.why, true);
    const session = this.session, buffer = this.ph.source, analysis = this.analysis;
    // first use on this browser: say what it costs before fetching 80 MB; the second click confirms
    if (!(await modelCached()) && document.body.dataset.stems !== 'confirm') { this.neuralState('confirm', { est: estimateSeconds(buffer.duration, this.cap.workers) }); return; }
    this.stemAbort = new AbortController();
    let modelBytes = null;
    try {
      modelBytes = await ensureModel((got) => this.neuralState('download', { got }), this.stemAbort.signal);
    } catch (err) { if (session !== this.session || !this.stemAbort) return; this.stemAbort = null; return this.neuralState('error', { msg: 'model download failed · check the connection' }); }
    if (session !== this.session || !this.stemAbort) return;
    this.stemAbort = null;
    const neural = new Material(this.ph.ensure(), buffer.length, 'neural');
    const flats = flatsFor(analysis.key);
    const regions = []; let pending = 0;
    const job = new StemJob(buffer, {
      workers: this.cap.workers,
      onProgress: (p) => { if (session === this.session) this.neuralState('running', p); },
      onRegion: async (r) => {
        if (session !== this.session) return;
        // re-tune this landed region: tonal = bass + other + vocals, drums pass through; melody read from the vocals + a little "other"
        const s = Math.round(r.start * SR), e = Math.round(r.end * SR);
        const pad = Math.round(0.75 * SR), a = Math.max(0, s - pad), b = Math.min(buffer.length, e + pad), len = b - a;
        const st = job.stems, L = new Float32Array(len), R = new Float32Array(len), dL = new Float32Array(len), dR = new Float32Array(len), mL = new Float32Array(len), mR = new Float32Array(len);
        for (let i = 0; i < len; i++) { const j = a + i; L[i] = st[1][0][j] + st[2][0][j] + st[3][0][j]; R[i] = st[1][1][j] + st[2][1][j] + st[3][1][j]; dL[i] = st[0][0][j]; dR[i] = st[0][1][j]; mL[i] = st[3][0][j] + 0.35 * st[2][0][j]; mR[i] = st[3][1][j] + 0.35 * st[2][1][j]; }
        pending++;
        try {
          const res = await this.pitch({ L, R, sr: SR, flats, hpss: false, melL: mL, melR: mR });
          if (session !== this.session) return;
          neural.add({ a, s, e, tonal: res.tonal, perc: [dL, dR], f0: res.f0 });
          regions.push([r.start, r.end]); this.regions = regions; this._wave = null;
          this.ph.setNeural(neural);
          if (neural.complete) { this.ph.rearrange(); this.buildPads(); this.drawFlags(); }
        } finally { pending--; }
      },
      onDone: async (d) => {
        if (session !== this.session) return;
        while (pending > 0) await new Promise((r) => setTimeout(r, 50));
        this.stemJob = null;
        this.ph.rearrange(); this.buildPads(); this.drawFlags();
        this.neuralState('done', d);
        this.toast('Real stems are in. The deck switched over.');
      },
      onError: (err) => { if (session !== this.session) return; console.error(err); this.stemJob = null; this.neuralState('error', { msg: 'the model ran out of memory or crashed · quick split stays' }); },
    });
    this.stemJob = job; this.regions = []; this._lampsLanded = undefined;
    this.neuralState('running', { frac: 0, secondsLeft: null });
    job.start(modelBytes);
  }

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

  // ---------- CHOP SHOP: waveform + slice flags ----------
  // Two stacked waveforms: the re-tuned music (magenta) over the drums (cyan); where they overlap
  // the colours multiply. Quick-split regions draw as hairlines, neural regions solid.
  wavePeaks(w) {
    if (this._wave && this._wave.w === w) return this._wave;
    const n = this.ph.source.length, per = Math.max(1, Math.floor(n / w));
    const ton = new Float32Array(w), per_ = new Float32Array(w), solid = new Uint8Array(w);
    const q = this.ph.quick, nu = this.ph.neural;
    for (let i = 0; i < w; i++) {
      const s0 = i * per, s1 = Math.min(n, s0 + per);
      const m = (nu && nu.covers(s0, s1)) ? nu : q; if (!m) continue;
      solid[i] = m === nu ? 1 : 0;
      const c = m.chunkAt(s0 + 1); if (!c) continue;
      const t = c.tonal.getChannelData(0), p = c.perc ? c.perc.getChannelData(0) : null, off = s0 - c.s;
      let mt = 0, mp = 0; for (let k = 0; k < per && off + k < t.length; k += 4) { const a = Math.abs(t[off + k]); if (a > mt) mt = a; if (p) { const b = Math.abs(p[off + k]); if (b > mp) mp = b; } }
      ton[i] = mt; per_[i] = mp;
    }
    // normalise to the 98th percentile (a 78's surface click must not flatten the song) and lift the quiet parts
    const all = Float32Array.from([...ton, ...per_]).sort(); const ref = all[Math.floor(all.length * 0.98)] || 1;
    for (let i = 0; i < w; i++) { ton[i] = Math.pow(Math.min(1, ton[i] / ref), 0.7); per_[i] = Math.pow(Math.min(1, per_[i] / ref), 0.7); }
    this._wave = { w, ton, per: per_, solid }; return this._wave;
  }
  drawWave() {
    const cv = $('#wave'); const r = cv.getBoundingClientRect(); const w = Math.floor(r.width), h = Math.floor(r.height);
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const pk = this.wavePeaks(w); const mid = h / 2;
    // The re-tuned music draws as a filled magenta band and the record's own drums as cyan spikes over
    // it, lighter where both are loud ('screen'). Quick-split regions keep a dim fill with a bright
    // hairline edge; neural regions draw fully solid, so the strip itself shows which bars have landed.
    c.globalCompositeOperation = 'screen';
    for (let i = 0; i < w; i++) {
      const a = pk.ton[i] * (h * 0.46), b = pk.per[i] * (h * 0.46);
      if (pk.solid[i]) { c.fillStyle = 'rgba(255,43,214,.9)'; c.fillRect(i, mid - a, 1, a * 2); c.fillStyle = 'rgba(25,230,255,.95)'; c.fillRect(i, mid - b, 1, b * 2); }
      else {
        c.fillStyle = 'rgba(255,43,214,.42)'; c.fillRect(i, mid - a, 1, a * 2);
        c.fillStyle = 'rgba(25,230,255,.75)'; c.fillRect(i, mid - b, 1, b * 2);
        c.fillStyle = 'rgba(255,120,235,.95)'; c.fillRect(i, mid - a, 1, 1.5); c.fillRect(i, mid + a - 1.5, 1, 1.5);
      }
    }
    c.globalCompositeOperation = 'source-over';
    const dur = this.ph.source.duration;
    c.fillStyle = 'rgba(244,241,255,.35)';
    for (const bar of this.ph.arr.bars) { const x = bar.start / dur * w; c.fillRect(Math.round(x), h - 6, 1, 6); }
  }
  // Slice flags, ReCycle style: one flag per slice point the slicer found (bar starts always; the
  // other beats and half-beats when their attack cleared SENSITIVITY). Numbered flags for bar starts,
  // short unnumbered ticks for the inner points; thinned so a numbered flag always has room to read.
  drawFlags() {
    const host = $('#flags'); if (!host || !this.ph.arr) return;
    const dur = this.ph.source.duration, bars = this.ph.arr.bars;
    const w = host.getBoundingClientRect().width || 700;
    const maxFlags = Math.max(8, Math.floor((w - 24) / 52)); // a numbered flag needs ~52 px to read; keep the last one off the edge
    const step = Math.max(1, Math.ceil(bars.length / maxFlags));
    const pxPerSec = w / dur, minTickGap = 5; // inner ticks thinner than 5 px apart are noise
    const frag = document.createDocumentFragment();
    let lastTickX = -1e9;
    for (const bar of bars) {
      const x0 = bar.start * pxPerSec;
      const numbered = bar.idx % step === 0 && x0 < w - 30; // a numbered flag needs ~30 px to its right
      if (numbered) {
        const f = document.createElement('i'); f.className = 'flag' + (bar.plan ? ' flag--chop' : '') + (bar.tapeStop ? ' flag--stop' : '');
        f.style.left = (bar.start / dur * 100).toFixed(3) + '%'; f.dataset.n = String(bar.idx + 1).padStart(2, '0');
        frag.appendChild(f); lastTickX = x0;
      }
      for (const k of bar.slicePoints || []) {
        if (k === 0) continue;
        const t = k % 2 === 0 ? bar.beats[k / 2] : bar.beats[(k - 1) / 2] + (bar.beats[(k + 1) / 2] !== undefined ? (bar.beats[(k + 1) / 2] - bar.beats[(k - 1) / 2]) / 2 : this.ph.arr.beatSec / 2);
        const x = t * pxPerSec; if (x - lastTickX < minTickGap || x > w - 4) continue; lastTickX = x;
        const tk = document.createElement('i'); tk.className = 'tick' + (k % 2 ? ' tick--half' : '');
        tk.style.left = (t / dur * 100).toFixed(3) + '%'; frag.appendChild(tk);
      }
    }
    host.replaceChildren(frag);
  }
  // ---------- REX DECK: 16 pads = the 16 eighth-notes of the two bars under the playhead ----------
  buildPads() {
    const host = $('#pads'); if (!host || !this.ph.arr) return;
    if (host.children.length !== 16) {
      host.replaceChildren();
      for (let i = 0; i < 16; i++) {
        const p = document.createElement('button'); p.className = 'pad'; p.type = 'button'; p.dataset.i = i;
        p.innerHTML = `<b>${String(i + 1).padStart(2, '0')}</b><small><span class="pad__src"></span><svg class="pad__glyph pad__glyph--rev" viewBox="0 0 10 10" aria-hidden="true"><path d="M8 1v8L1.5 5z"/></svg><svg class="pad__glyph pad__glyph--oct" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 2h8L5 8.5z"/></svg></small>`;
        p.addEventListener('pointerdown', () => this.hitPad(i));
        p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.hitPad(i); } });
        host.appendChild(p);
      }
    }
    this.labelPads(this.ph.barAt(this.ph.position()) || this.ph.arr.bars[0]);
  }
  padSlice(bar, i) {
    const b = bar.idx % 2 === 0 ? bar : (this.ph.arr.bars[bar.idx - 1] || bar); // pads cover an even/odd bar pair
    const pair = [b, this.ph.arr.bars[b.idx + 1] || b];
    const bar2 = pair[i >> 3], k = i & 7, beat = k >> 1;
    const bb = bar2.beats, half = bb[beat] + (bb[beat + 1] !== undefined ? (bb[beat + 1] - bb[beat]) / 2 : this.ph.arr.beatSec / 2);
    const at = k & 1 ? half : bb[beat];
    const sl = bar2.plan ? bar2.plan[k] : null;
    const srcK = sl ? (sl.srcK ?? sl.srcBeat * 2) : k, srcBeat = sl ? sl.srcBeat : beat;
    // origin label in musician's count: 1.3 is bar 1 beat 3, 1.3+ is the "and" after it
    return { bar: bar2, k, at, from: sl ? sl.from : at, len: this.ph.arr.beatSec / 2, reverse: !!sl?.reverse, rate: sl?.rate || 1, chopped: !!sl, srcBeat, label: `${bar2.idx + 1}.${srcBeat + 1}${srcK & 1 ? '+' : ''}` };
  }
  labelPads(bar) {
    if (!bar) return; const pads = $$('.pad'); if (pads.length !== 16) return;
    this._padBar = bar;
    for (let i = 0; i < 16; i++) {
      const s = this.padSlice(bar, i), p = pads[i];
      p.querySelector('.pad__src').textContent = s.label;
      p.classList.toggle('pad--rev', s.reverse); p.classList.toggle('pad--oct', s.rate < 1);
      p.classList.toggle('pad--chop', s.chopped); p.classList.toggle('pad--melody', !!s.bar.melodyBar);
      p.setAttribute('aria-label', `Pad ${i + 1}: bar ${s.label}${s.reverse ? ', reversed' : ''}${s.rate < 1 ? ', octave down' : ''}`);
    }
  }
  hitPad(i) {
    if (!this.ph.source) return;
    const bar = this._padBar || this.ph.arr.bars[0]; const s = this.padSlice(bar, i);
    this.ph.audition(s.from, s.len, { reverse: s.reverse, rate: s.rate });
    const p = $$('.pad')[i]; p.classList.remove('is-hit'); void p.offsetWidth; p.classList.add('is-hit');
  }

  // ---------- visuals ----------
  loop() {
    requestAnimationFrame(this.loop);
    if (document.body.dataset.stage !== 'deck' || !this.ph.source) return;
    this.drawSeek();
    this.drawWave();
    const g = this.ph.live;
    let bass = 0;
    if (g) { const f = g.tape.spectrum(); for (let i = 2; i < 10; i++) bass += f[i]; bass /= 8 * 255; }
    document.documentElement.style.setProperty('--bass', bass.toFixed(3));
    // REX: light the pad under the playhead; LCD shows bar / section / bells (paused: the bar under the head)
    const pos = this.ph.position(), bar = this.ph.barAt(pos) || this.ph.arr.bars[0];
    this.lampsAt(pos);
    if (bar) {
      if (!this._padBar || (bar.idx >> 1) !== (this._padBar.idx >> 1)) this.labelPads(bar);
      const pair0 = bar.idx % 2 === 0 ? bar : this.ph.arr.bars[bar.idx - 1] || bar;
      const within = (pos - bar.start) / Math.max(0.001, bar.end - bar.start);
      const live = (bar.idx - pair0.idx) * 8 + Math.min(7, Math.floor(within * 8));
      if (live !== this._livePad) { $$('.pad').forEach((p, i) => p.classList.toggle('is-live', i === live && this.ph.playing)); this._livePad = live; }
      const lcdBar = `BAR ${String(bar.idx + 1).padStart(3, '0')}`;
      if ($('#lcd-bar').textContent !== lcdBar) $('#lcd-bar').textContent = lcdBar;
      const sec = { intro: 'INTRO · HATS', A: 'DROP A · HALF-TIME', B: 'DROP B · HOOK', turn: 'TURNAROUND' }[bar.section] + (bar.plan ? ' · CHOP' : '') + (bar.tapeStop ? ' · STOP' : '');
      if ($('#lcd-section').textContent !== sec) $('#lcd-section').textContent = sec;
      const slotK = Math.min(7, Math.floor(within * 8)); const m = this.ph.melody?.get(bar.idx + ':' + slotK);
      const note = bar.melodyBar ? (m != null ? `BELLS · ${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1} · from the song` : 'BELLS · rest') : (bar.section === 'B' || bar.section === 'turn' ? 'BELLS · minor hook' : 'BELLS · tacet');
      if ($('#lcd-note').textContent !== note) $('#lcd-note').textContent = note;
    }
  }
  drawSeek() {
    if (!this.ph.source) return;
    const pos = this.ph.position(), f = pos / this.ph.source.duration;
    $('#wave-head').style.left = (f * 100).toFixed(3) + '%';
    $('#seek').setAttribute('aria-valuenow', Math.round(f * 100));
  }
}
function fmtTime(s) { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

window.noise = new App();
