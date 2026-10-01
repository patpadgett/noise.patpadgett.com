// CUE — the controller. One screen, three states: nosource → onair → render.
import { loadConfig, saveConfig, configured, probe, transcribe, writeTreatment, estimateCost } from './azure.js';
import { alignLyrics, flattenWords, stanzas } from './align.js';
import { timeline, sceneAt, nextCue, drawFrame, barAt, barTime, fmtTC, fmtIn, fmtCountdown, clipRate, clipTime } from './switcher.js';
import { FootageJob, exportVideo, download, getClip, clipKey } from './footage.js';
import { DEMO_TITLE, DEMO_LYRICS } from './demo-lyrics.js';

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const DEMO_URL = 'assets/demo/fare-thee-honey-blues-1920.mp3', DEMO_CUES = 'assets/demo/cues.json';

class App {
  constructor() {
    this.ctx = null; this.buffer = null; this.analysis = null; this.title = ''; this.lyrics = ''; this.aligned = []; this.treatment = null; this.tl = null;
    this.playing = false; this.t0 = 0; this.startAt = 0; this.src = null; this.pausedAt = 0; this.songId = null;
    this.clips = new Map(); // scene.n -> { url, video }
    this.job = null; this.size = '1280x720';
    this.screen = $('#screen'); this.sctx = this.screen.getContext('2d');
    const rm = matchMedia('(prefers-reduced-motion: reduce)'); this.reducedMotion = rm.matches; rm.addEventListener('change', () => { this.reducedMotion = rm.matches; });
    this.pvwCanvases = $$('.mon--pvw canvas').map((c) => ({ c, ctx: c.getContext('2d') }));
    this.bind(); this.loop = this.loop.bind(this); requestAnimationFrame(this.loop);
    this.setState('nosource');
    if (location.hash === '#demo') this.loadDemo();
  }
  setState(s) { document.body.dataset.state = s; this.state = s; }
  toast(msg, warn = false) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('is-warn', warn); t.classList.add('is-on'); clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('is-on'), warn ? 7000 : 3600); }
  hideToast() { clearTimeout(this._tt); $('#toast').classList.remove('is-on'); }

  bind() {
    $('#file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) this.loadFile(f); e.target.value = ''; });
    $('#try').addEventListener('click', () => this.loadDemo());
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('is-dropping'); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('is-dropping'); } });
    window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('is-dropping'); const f = e.dataTransfer.files[0]; if (f) this.loadFile(f); });
    $('#play').addEventListener('click', () => this.togglePlay());
    document.addEventListener('keydown', (e) => { if (e.code === 'Space' && this.buffer && !/input|textarea|button|td/i.test(e.target.tagName) && !e.target.isContentEditable) { e.preventDefault(); this.togglePlay(); } });
    $('#go').addEventListener('click', () => this.writeCues());
    $('#lyrics').addEventListener('input', () => { const n = stanzas($('#lyrics').value).flat().length; $('#lyrics-count').textContent = `${n} line${n === 1 ? '' : 's'}`; });
    $('#edit-lyrics').addEventListener('click', () => { const b = $('#lyrics-box'); b.hidden = !b.hidden; });
    $('#rewrite').addEventListener('click', () => this.writeCues());
    $('#another').addEventListener('click', () => this.reset());
    $('#render').addEventListener('click', () => this.render());
    $('#render-cancel').addEventListener('click', () => { this.job?.cancel(); $('#render-line').textContent = 'Stopped. Finished clips are kept.'; });
    $('#export').addEventListener('click', () => this.export());
    $$('input[name=fmt]').forEach((r) => r.addEventListener('change', () => this.setFormat(r.value)));
    $('#nostrobe').addEventListener('change', () => this.updateCost());
    // setup dialog
    $('#setup').addEventListener('click', () => this.openSetup());
    $('#setup-test').addEventListener('click', async () => { this.readSetupForm(); $('#probe').textContent = 'Testing…'; const r = await probe(); $('#probe').textContent = `OpenAI: ${r.openai} · Speech: ${r.speech}`; });
    $('#setup-forget').addEventListener('click', () => { localStorage.removeItem('cue.azure.v1'); $('#setupdlg').close(); this.toast('Keys forgotten.'); });
    $('#setupdlg').addEventListener('close', () => { if ($('#setupdlg').returnValue === 'save') { this.readSetupForm(); this.toast('Saved in this browser only.'); } });
    $$('input[name=mode]').forEach((r) => r.addEventListener('change', () => { $('#setup-direct').hidden = r.value === 'proxy' && r.checked; }));
    // running order: click a row to seek; edit a cue sentence inline
    $('#ro-body').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-start]'); if (!tr || e.target.isContentEditable) return; this.seek(+tr.dataset.start); });
    $('#ro-body').addEventListener('input', (e) => { const td = e.target.closest('.cue[contenteditable]'); if (!td) return; const c = this.treatment.cues.find((x) => x.n === +td.closest('tr').dataset.n); if (c) c.cue = td.textContent.trim(); });
    $('#pvw').addEventListener('click', (e) => { const fig = e.target.closest('.mon--pvw'); if (fig && fig.dataset.start) this.seek(+fig.dataset.start); });
  }

  // ---------- setup ----------
  openSetup() { const cfg = loadConfig(); const f = $('#setupdlg form'); for (const el of f.elements) if (el.name && el.name !== 'mode') el.value = cfg[el.name] || ''; f.elements.mode.value = cfg.mode || 'direct'; $('#setup-direct').hidden = cfg.mode === 'proxy'; $('#probe').textContent = configured(cfg) ? 'Configured.' : 'Not configured: the demo works without keys; your own songs need them.'; $('#setupdlg').showModal(); }
  readSetupForm() { const f = $('#setupdlg form'); const cfg = { mode: f.elements.mode.value }; for (const el of f.elements) if (el.name && el.name !== 'mode' && el.value) cfg[el.name] = el.value.trim(); saveConfig(cfg); }

  // ---------- load ----------
  ensureCtx() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
  async loadFile(f) {
    if (!/^(audio|video)\//.test(f.type) && !/\.(mp3|wav|m4a|aac|ogg|flac|webm|mp4|aif|aiff)$/i.test(f.name)) return this.toast('That is not an audio file.', true);
    this.title = f.name.replace(/\.[^.]+$/, '');
    try { await this.loadAudio(await f.arrayBuffer(), f.name); } catch (e) { console.error(e); this.toast('Could not read that file: ' + e.message, true); }
  }
  async loadDemo() {
    this.title = DEMO_TITLE;
    try {
      this.progress('LOADING THE DEMO', 0.05);
      const [ab, cues] = await Promise.all([fetch(DEMO_URL).then((r) => r.arrayBuffer()), fetch(DEMO_CUES).then((r) => r.json())]);
      this.demo = cues; await this.loadAudio(ab, 'demo', cues);
    } catch (e) { console.error(e); this.toast('Could not load the demo: ' + e.message, true); this.progress(null); }
  }
  progress(label, p) { const w = $('#prog-wrap'); if (label == null) { w.hidden = true; return; } w.hidden = false; $('#prog-k').textContent = label; $('#prog').style.width = Math.round(p * 100) + '%'; }
  async loadAudio(arrayBuffer, name, demo = null) {
    this.stop(); this.setState('nosource'); this.treatment = null; this.tl = null; this.analysis = null; this.clips.clear(); this.job = null; $('#renderdesk').hidden = true;
    this.progress('DECODING', 0.1);
    const ctx = this.ensureCtx();
    this.buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    this.songId = await songId(this.buffer);
    if (this.buffer.duration > 12 * 60) { this.toast('That is over 12 minutes. Trim it first.', true); return this.progress(null); }
    this.progress('LISTENING · TEMPO, BARS, KEY', 0.2);
    const a = await this.analyze(this.buffer, (p) => this.progress('LISTENING · TEMPO, BARS, KEY', 0.2 + p * 0.5));
    if (!a.beats || a.beats.length < 8) { this.toast('Could not find a beat in that. Try a song with drums.', true); return this.progress(null); }
    const bars = []; for (let i = a.phase; i + 3 < a.beats.length; i += 4) bars.push(a.beats[i]);
    const barLoud = []; for (let i = a.phase, k = 0; i + 3 < a.beats.length; i += 4, k++) barLoud.push(+(a.beatLoud.slice(i, i + 4).reduce((s, v) => s + v, 0) / 4).toFixed(2));
    this.analysis = { bpm: +a.bpm.toFixed(2), key: a.key, keyName: NOTE[a.key.root] + ' ' + a.key.mode, duration: +this.buffer.duration.toFixed(2), barStarts: bars, barLoud };
    this.progress(null);
    $('#pgm-label').textContent = this.title; $('#rundown-title').textContent = 'RUNNING ORDER';
    $('#play').disabled = false; $('#another').hidden = false; $('#edit-lyrics').hidden = false;
    if (demo) { this.lyrics = demo.lyrics; this.aligned = demo.aligned; $('#lyrics').value = demo.lyrics; $('#lyrics').dispatchEvent(new Event('input')); this.setTreatment(demo.treatment); this.toast('Demo cue sheet loaded. Press play; the footage renders on RENDER.'); }
    else { this.setState('onair'); $('#lyrics-box').hidden = false; $('#lyrics').value = ''; $('#lyrics').focus(); this.renderRundown(); this.toast(`Found ${Math.round(this.analysis.bpm)} BPM in ${this.analysis.keyName}, ${bars.length} bars. Paste the lyrics.`); }
    this.drawPVW(true);
  }
  analyze(buffer, onProgress) {
    return new Promise((res, rej) => {
      const w = new Worker('js/analyze.worker.js'); const id = 1;
      const sr = 22050, n = Math.ceil(buffer.duration * sr), pcm = new Float32Array(n);
      const off = new OfflineAudioContext(1, n, sr); const s = off.createBufferSource(); s.buffer = buffer; s.connect(off.destination); s.start(0);
      off.startRendering().then((mono) => { pcm.set(mono.getChannelData(0)); w.postMessage({ id, pcm, sampleRate: sr }, [pcm.buffer]); });
      w.onmessage = (e) => { if (e.data.progress != null) onProgress(e.data.progress); if (e.data.result) { res(e.data.result); w.terminate(); } if (e.data.error) { rej(new Error(e.data.error)); w.terminate(); } };
    });
  }

  // ---------- cues ----------
  async writeCues() {
    this.lyrics = $('#lyrics').value.trim();
    if (!this.lyrics) return this.toast('Paste the lyrics first.', true);
    if (!configured()) { this.openSetup(); return this.toast('Your own songs need Azure keys (SETUP). The demo works without.', true); }
    const ctl = new AbortController(); this.abort = ctl;
    try {
      this.progress('LISTENING TO THE SINGER', 0.15);
      const wav = await toWav16k(this.buffer);
      let words = [];
      try { const tr = await transcribe(wav, { signal: ctl.signal }); words = flattenWords(tr); } catch (e) { console.warn(e); this.toast('Could not hear the words (' + e.message + '); timing the lines by stanza instead.', true); }
      this.aligned = alignLyrics(this.lyrics, words);
      this.progress('WRITING THE CUES', 0.6);
      const { treatment } = await writeTreatment({ title: this.title, analysis: this.analysis, lyrics: this.lyrics, aligned: this.aligned }, { signal: ctl.signal });
      this.progress(null); $('#lyrics-box').hidden = true;
      this.setTreatment(treatment); this.toast(`${treatment.cues.length} cues written.`);
    } catch (e) { console.error(e); this.progress(null); this.toast('Could not write the cues: ' + e.message, true); }
  }
  setTreatment(tr) {
    this.treatment = tr; this.tl = timeline(tr, this.analysis); $('#lyrics-box').hidden = true;
    $('#treatment').textContent = tr.title_treatment; $('#rewrite').hidden = false;
    $('#strobe-warn').hidden = !tr.strobe_warning && !tr.cues.some((c) => c.kind === 'light' && c.effect === 'strobe');
    this.renderRundown(); this.updateCost(); this.setState('onair'); $('#render').disabled = false;
    this.drawPVW(true);
  }
  updateCost() { if (!this.treatment) return; const est = estimateCost(this.treatment, this.analysis); $('#render-cost').textContent = `$${est.dollars.toFixed(2)} · ${est.clips} clips`; this.est = est; }
  renderRundown() {
    const body = $('#ro-body'); body.replaceChildren();
    if (!this.tl) return;
    const sections = (this.treatment.sections || []).slice().sort((a, b) => a.bar - b.bar);
    const secFor = (bar) => { let s = null; for (const x of sections) if (x.bar <= bar) s = x; return s; };
    let lastSec = null;
    const frag = document.createDocumentFragment();
    for (const c of this.tl.cues) {
      const sec = secFor(c.in);
      if (sec && sec !== lastSec) { lastSec = sec; const st = document.createElement('tr'); st.className = 'ro__section'; st.dataset.start = barTime(this.analysis, sec.bar).toFixed(3); st.innerHTML = `<td colspan="6">${esc(sec.name)}<small>from bar ${sec.bar} · ${fmtIn(barTime(this.analysis, sec.bar))}</small></td>`; frag.appendChild(st); }
      const tr = document.createElement('tr'); tr.dataset.n = c.n; tr.dataset.start = c.start.toFixed(3);
      const dur = c.end - c.start;
      const src = c.kind === 'scene' ? 'VT' : c.kind === 'light' ? 'LX' : 'LYR';
      tr.innerHTML = `<td class="ro__n">${String(c.n).padStart(2, '0')}</td>
        <td class="ro__in"><span class="in-t">${fmtIn(c.start)}</span><span class="in-b">bar ${c.in}${c.beat > 1 ? '.' + c.beat : ''}</span></td>
        <td class="ro__cue"><div class="cue" contenteditable="plaintext-only" spellcheck="false">${esc(c.cue)}</div><span class="anchor">${esc(c.anchor)}${c.kind === 'light' ? ` · ${c.effect}${c.rate ? ' ×' + c.rate + '/beat' : ''}` : c.kind === 'lyric' ? ` · ${c.style}` : ''}</span></td>
        <td class="ro__src"><span class="src src--${src.toLowerCase()}">${src}</span></td>
        <td class="ro__dur">${dur.toFixed(1)}s<span class="seg">${c.bars} bar${c.bars === 1 ? '' : 's'}</span></td>
        <td class="ro__tally"><i class="tally"></i></td>`;
      frag.appendChild(tr);
    }
    body.appendChild(frag);
  }

  // ---------- transport ----------
  position() { if (!this.buffer) return 0; return this.playing ? Math.min(this.buffer.duration, this.startAt + (this.ctx.currentTime - this.t0)) : this.pausedAt; }
  play(from = this.pausedAt) {
    if (!this.buffer) return; this.stop(false);
    const ctx = this.ensureCtx(); const s = ctx.createBufferSource(); s.buffer = this.buffer; s.connect(ctx.destination);
    this.t0 = ctx.currentTime + 0.05; this.startAt = Math.max(0, Math.min(this.buffer.duration - 0.01, from)); s.start(this.t0, this.startAt);
    s.onended = () => { if (this.src === s) { this.playing = false; this.pausedAt = 0; this.src = null; this.syncPlayKey(); this.pauseClips(); } };
    this.src = s; this.playing = true; this.syncPlayKey(); this.hideToast();
  }
  stop(keepPos = true) { if (this.src) { try { this.src.onended = null; this.src.stop(); } catch {} } if (keepPos && this.playing) this.pausedAt = this.position(); this.src = null; this.playing = false; this.syncPlayKey(); this.pauseClips(); }
  togglePlay() { if (this.playing) this.stop(); else this.play(); }
  seek(t) { if (this.playing) this.play(t); else { this.pausedAt = t; } }
  syncPlayKey() { const k = $('#play'); k.classList.toggle('is-on', this.playing); k.setAttribute('aria-pressed', this.playing); k.querySelector('.lbl').textContent = this.playing ? 'ON AIR' : 'PLAY'; }
  pauseClips() { for (const { video } of this.clips.values()) video.pause(); }

  // the switcher's clip accessor: a <video> positioned at the right media time for the scene. Clips are
  // 4/8/12 s and scenes are not: a shorter clip plays slowed (clipRate) so it lasts the whole scene.
  clipFor(scene, t = this.position(), live = true) {
    const c = this.clips.get(scene.n); if (!c) return null;
    const dur = c.video.duration || 12, rate = clipRate(scene, dur), mt = clipTime(scene, dur, t);
    if (live) {
      if (c.video.playbackRate !== rate) c.video.playbackRate = rate;
      if (this.playing) { if (c.video.paused) c.video.play().catch(() => {}); if (Math.abs(c.video.currentTime - mt) > 0.25) c.video.currentTime = mt; } else if (Math.abs(c.video.currentTime - mt) > 0.05) c.video.currentTime = mt;
    }
    return c.video.readyState >= 2 ? c.video : null;
  }

  // ---------- frame loop: PGM, clock, tally handoff ----------
  loop() {
    requestAnimationFrame(this.loop);
    if (!this.buffer || !this.analysis) return;
    if (!this.tl) { const t = this.position(); $('#tc').textContent = fmtTC(t); const b = barAt(this.analysis, t); $('#bar').textContent = `${String(b.bar).padStart(3, '0')}.${b.beat}`; return; }
    const t = this.position();
    const scene = drawFrame(this.sctx, this.screen.width, this.screen.height, t, this.tl, this.analysis, { clipFor: (s) => this.clipFor(s, t), noStrobe: $('#nostrobe').checked, freezeLights: this.reducedMotion, palette: this.treatment.palette });
    // clock
    $('#tc').textContent = fmtTC(t);
    const b = barAt(this.analysis, t); $('#bar').textContent = `${String(b.bar).padStart(3, '0')}.${b.beat}`;
    const nx = nextCue(this.tl, t); const nxt = $('#next'); nxt.textContent = nx ? fmtCountdown(nx.start - t, 60 / this.analysis.bpm) : 'END';
    const sections = this.treatment.sections || []; let sec = null; for (const s of sections) if (s.bar <= b.bar) sec = s; $('#section').textContent = sec ? sec.name.toUpperCase() : '—';
    // PGM caption + tally
    const pgm = $('#pgm'); pgm.classList.toggle('is-air', this.playing);
    $('#pgm-scene').textContent = scene ? `SCENE ${String(scene.n).padStart(2, '0')} · ${scene.anchor}` : '—';
    $('#pgm-src').textContent = scene ? (this.clips.has(scene.n) ? 'VT' : 'VT · NOT RENDERED') : '—';
    // running order tally: air / next / done
    if (this._lastTallyT == null || Math.abs(t - this._lastTallyT) > 0.08) {
      this._lastTallyT = t;
      for (const tr of $('#ro-body').children) { if (!tr.dataset.n) continue; const c = this.tl.cues.find((x) => x.n === +tr.dataset.n); const air = c && c.start <= t && t < c.end; tr.classList.toggle('is-air', !!air); tr.classList.toggle('is-next', !!nx && c === nx); tr.classList.toggle('is-done', !!c && t >= c.end); }
      if (this.playing && nx !== this._lastNext) { this._lastNext = nx; const row = nx && $(`#ro-body tr[data-n="${nx.n}"]`); if (row && document.activeElement?.tagName !== 'TEXTAREA' && !document.activeElement?.isContentEditable) row.scrollIntoView({ block: 'nearest', behavior: 'auto' }); }
      this.drawPVW(false, t, scene);
    }
  }
  // PVW wall: the next four scenes, drawn at their own IN time (first frame of their clip, or the placeholder)
  drawPVW(force, t = this.position(), current = sceneAt(this.tl, t)) {
    if (!this.tl) return;
    const upcoming = this.tl.scenes.filter((s) => s.start > t - 0.001 && s !== current).slice(0, 4);
    const figs = $$('.mon--pvw');
    figs.forEach((fig, i) => {
      const s = upcoming[i]; const slot = this.pvwCanvases[i];
      fig.classList.toggle('is-next', i === 0 && !!s);
      if (!s) { fig.dataset.start = ''; fig.querySelector('.mon__tally span').textContent = '—'; fig.querySelectorAll('.mon__cap span')[0].textContent = '—'; fig.querySelectorAll('.mon__cap span')[1].textContent = '—'; slot.ctx.fillStyle = '#000'; slot.ctx.fillRect(0, 0, slot.c.width, slot.c.height); return; }
      const key = `${s.n}:${this.clips.has(s.n)}`; if (!force && fig.dataset.key === key) return; fig.dataset.key = key; fig.dataset.start = s.start.toFixed(3);
      fig.querySelector('.mon__tally span').textContent = `SCENE ${String(s.n).padStart(2, '0')}`; fig.querySelector('.mon__tally span').dataset.short = String(s.n).padStart(2, '0');
      fig.querySelectorAll('.mon__cap span')[0].textContent = s.anchor.replace(/^Bar \d+ /, ''); fig.querySelectorAll('.mon__cap span')[1].textContent = fmtIn(s.start);
      drawFrame(slot.ctx, slot.c.width, slot.c.height, s.start + 0.02, this.tl, this.analysis, { clipFor: (sc) => this.clipFor(sc, s.start + 0.02, false), palette: this.treatment.palette, showLyrics: false, showShot: false });
    });
  }

  // ---------- render: footage ----------
  setFormat(v) { this.size = v === '9:16' ? '720x1280' : '1280x720'; this.screen.width = v === '9:16' ? 720 : 1280; this.screen.height = v === '9:16' ? 1280 : 720; document.documentElement.style.setProperty('--mon-ratio', v === '9:16' ? '9 / 16' : '16 / 9'); this.drawPVW(true); if (this.state === 'render' && this.job?.done) this.loadClipsFromCache(); }
  async render() {
    if (!this.treatment) return;
    if (!configured()) { this.openSetup(); return this.toast('Rendering footage needs Azure keys (SETUP).', true); }
    this.setState('render'); $('#renderdesk').hidden = false; $('#export').disabled = true;
    const est = this.est; $('#render-line').textContent = `${est.clips} clips · ${est.seconds}s of footage · about $${est.dollars.toFixed(2)} on your Azure. Two render at a time; a 3-minute song takes 10–20 minutes. Keep listening.`;
    this.job?.cancel();
    this.job = new FootageJob({ songId: this.songId, scenes: this.tl.scenes, analysis: this.analysis, size: this.size, onUpdate: (j) => this.onJob(j) });
    this.renderJobs(); await this.job.start();
    $('#renderdesk').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  renderJobs() {
    const ol = $('#jobs'); ol.replaceChildren();
    for (const it of this.job.items) {
      const li = document.createElement('li'); li.className = 'job'; li.dataset.n = it.scene.n;
      li.innerHTML = `<div class="job__thumb"><canvas width="320" height="180"></canvas></div><div class="job__meta"><span class="job__n">SCENE ${String(it.scene.n).padStart(2, '0')}</span><span class="job__state">queued</span><span class="job__len">${it.seconds}s</span><div class="job__bar"><b></b></div></div>`;
      // clips come in 4/8/12 s; say so when the clip will play slowed to cover a longer scene
      const sceneLen = it.scene.end - it.scene.start, rate = clipRate(it.scene, it.seconds);
      li.querySelector('.job__len').title = rate < 0.995 ? `${it.seconds} s clip over a ${sceneLen.toFixed(1)} s scene · plays at ${rate.toFixed(2)}×` : `${it.seconds} s clip · ${sceneLen.toFixed(1)} s scene`;
      ol.appendChild(li);
      const cv = li.querySelector('canvas'); drawFrame(cv.getContext('2d'), 320, 180, it.scene.start + 0.02, this.tl, this.analysis, { clipFor: () => null, palette: this.treatment.palette, showLyrics: false });
    }
  }
  onJob(j) {
    for (const it of j.items) {
      const li = $(`#jobs li[data-n="${it.scene.n}"]`); if (!li) continue;
      li.className = 'job' + (it.state === 'running' || it.state === 'creating' || it.state === 'downloading' ? ' is-running' : it.state === 'done' ? ' is-done' : it.state === 'failed' ? ' is-failed' : '');
      const st = li.querySelector('.job__state');
      st.textContent = it.state === 'failed' ? 'failed' : it.state === 'running' ? `rendering ${Math.round(it.progress * 100)}%` : it.cached ? 'done · cached' : it.state;
      // the whole reason, where a tile cannot: on the tile's tooltip and in the desk line below
      if (it.state === 'failed') { li.title = it.error || 'failed'; st.title = it.error || 'failed'; } else { li.removeAttribute('title'); st.removeAttribute('title'); }
      li.querySelector('.job__bar b').style.width = Math.round(it.progress * 100) + '%';
      if (it.state === 'done' && !this.clips.has(it.scene.n)) {
        const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = it.url; video.load();
        this.clips.set(it.scene.n, { url: it.url, video });
        const thumb = li.querySelector('.job__thumb'); const v2 = document.createElement('video'); v2.muted = true; v2.playsInline = true; v2.src = it.url; v2.loop = true; v2.autoplay = true; thumb.replaceChildren(v2);
        this.drawPVW(true);
      }
    }
    const done = j.items.filter((i) => i.state === 'done').length, failedItems = j.items.filter((i) => i.state === 'failed'), failed = failedItems.length;
    // one line of truth: progress while running; on finish, the count and — if anything failed — the first full reason, so it is never cut to a tile
    const reasons = [...new Set(failedItems.map((i) => i.error).filter(Boolean))];
    const why = failed ? ` ${reasons.length > 1 ? `${reasons.length} reasons, first: ` : ''}${reasons[0] || 'no reason given'}` : '';
    $('#render-line').textContent = j.done ? `${done} of ${j.items.length} clips in${failed ? `, ${failed} failed — ${why.trim()} (press RETRY FAILED to try those again)` : ''}. $${(j.spent * 0.10).toFixed(2)} spent.` : `${done} of ${j.items.length} clips in · ${j.inflight} rendering${failed ? ` · ${failed} failed:${why}` : ''} · $${(j.spent * 0.10).toFixed(2)} committed so far`;
    $('#export').disabled = !(done > 0);
    if (j.done) $('#render').textContent = failed ? 'RETRY FAILED' : 'RE-RENDER';
  }
  async loadClipsFromCache() { this.clips.clear(); for (const s of this.tl.scenes) { const c = await getClip(clipKey(this.songId, s, this.size)); if (c) { const url = URL.createObjectURL(c.blob); const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url; this.clips.set(s.n, { url, video }); } } this.drawPVW(true); }

  // ---------- export ----------
  async export() {
    if (!this.tl) return; this.stop();
    const vertical = this.size === '720x1280'; const W = vertical ? 1080 : 1920, H = vertical ? 1920 : 1080;
    const btn = $('#export'); btn.disabled = true; const note = $('#export-note');
    // the export draws from seekable <video> clones so the live monitor is not disturbed
    const vids = new Map(); for (const [n, c] of this.clips) { const v = document.createElement('video'); v.muted = true; v.src = c.url; v.preload = 'auto'; await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; }); vids.set(n, v); }
    const seekTo = (v, mt) => new Promise((r) => { if (Math.abs(v.currentTime - mt) < 0.001) return r(); v.onseeked = () => r(); v.currentTime = mt; });
    const drawAt = async (ctx, w, h, t) => {
      const scene = sceneAt(this.tl, t); let src = null;
      if (scene && vids.has(scene.n)) { const v = vids.get(scene.n); await seekTo(v, clipTime(scene, v.duration || 12, t)); src = v; }
      drawFrame(ctx, w, h, t, this.tl, this.analysis, { clipFor: () => src, noStrobe: $('#nostrobe').checked, palette: this.treatment.palette });
    };
    try {
      const { blob, ext } = await exportVideo({ W, H, duration: this.buffer.duration, drawAt, audioBuffer: this.buffer, onProgress: (p) => { note.textContent = `Exporting ${Math.round(p * 100)}%`; } });
      download(blob, safeName(this.title) + (vertical ? '-9x16' : '-16x9') + '.' + ext); note.textContent = `Saved ${ext.toUpperCase()} · ${(blob.size / 1048576).toFixed(1)} MB`;
    } catch (e) { console.error(e); note.textContent = 'Export failed: ' + e.message; }
    btn.disabled = false;
  }

  reset() { this.stop(); this.job?.cancel(); this.buffer = null; this.treatment = null; this.tl = null; this.clips.clear(); $('#ro-body').replaceChildren(); $('#treatment').textContent = ''; $('#lyrics-box').hidden = true; $('#renderdesk').hidden = true; $('#play').disabled = true; $('#render').disabled = true; $('#render').textContent = 'RENDER '; $('#render').appendChild(Object.assign(document.createElement('small'), { id: 'render-cost' })); $('#pgm-label').textContent = 'NO SOURCE'; $('#pgm-scene').textContent = '—'; $('#pgm-src').textContent = '—'; $('#tc').textContent = '00:00.0'; $('#bar').textContent = '—'; $('#next').textContent = '—'; $('#section').textContent = '—'; $('#another').hidden = true; $('#rewrite').hidden = true; $('#edit-lyrics').hidden = true; $('#strobe-warn').hidden = true; this.setState('nosource'); }
}

// ---------- helpers ----------
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const safeName = (s) => (s || 'cue').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'cue';
async function toWav16k(buffer) {
  const sr = 16000, n = Math.ceil(buffer.duration * sr); const off = new OfflineAudioContext(1, n, sr); const s = off.createBufferSource(); s.buffer = buffer; s.connect(off.destination); s.start(0);
  const mono = (await off.startRendering()).getChannelData(0);
  const ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab); let p = 0;
  const str = (x) => { for (const ch of x) v.setUint8(p++, ch.charCodeAt(0)); }, u32 = (x) => { v.setUint32(p, x, true); p += 4; }, u16 = (x) => { v.setUint16(p, x, true); p += 2; };
  str('RIFF'); u32(36 + n * 2); str('WAVE'); str('fmt '); u32(16); u16(1); u16(1); u32(sr); u32(sr * 2); u16(2); u16(16); str('data'); u32(n * 2);
  for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, mono[i])); v.setInt16(p, x < 0 ? x * 32768 : x * 32767, true); p += 2; }
  return new Blob([ab], { type: 'audio/wav' });
}
async function songId(buffer) { const d = buffer.getChannelData(0); const step = Math.max(1, Math.floor(d.length / 4096)); const u = new Float32Array(4096); for (let i = 0; i < 4096; i++) u[i] = d[i * step] || 0; const h = await crypto.subtle.digest('SHA-1', u.buffer); return [...new Uint8Array(h)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join(''); }

window.cue = new App();
