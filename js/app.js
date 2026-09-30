// NOISE — main window. Builds the dash, wires the engine, hosts (or detaches) the editor.
import { Engine, detectSlices, sliceEven, normalizeBuffer, trimBuffer, peaks } from './engine.js';
import { demoSong, emptySong, validateSong, DEVICE_TYPES, MASTER_PARAMS, History, findDevice, findPattern, STEPS_PER_BAR } from './song.js';
import { applyOp } from './ops.js';
import { Editor } from './editor.js';
import { Knob, Counter, fmtValue } from './knob.js';
import { noteName, BREAKER_LANES, VOWEL_NAMES } from './synth.js';
import { downloadBlob, safeFilename, sliceBuffer, dataUriToBuffer } from './wav.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

const AUTOSAVE_KEY = 'noise.autosave.v1';
const CHANNEL = 'noise-editor';

class App {
  constructor() {
    this.song = demoSong();
    this.engine = new Engine(this.song);
    this.history = new History();
    this.history.snapshot(this.song);
    this.knobs = new Map();       // `${deviceId}.${param}` -> Knob
    this.lit = false;
    this.detachedWin = null;
    this.channel = ('BroadcastChannel' in window) ? new BroadcastChannel(CHANNEL) : null;
    this.editorBus = this.makeBus();
    this.dirty = false;
    this.build();
    this.bind();
    this.restoreAutosave();
    requestAnimationFrame(() => this.tick());
  }

  // ---------- DOM ----------
  build() {
    this.cabinet = $('#cabinet');
    this.renderTransport();
    this.renderRack();
    this.renderLathe();
    this.renderMaster();
    this.editorRoot = $('#editor');
    this.editor = new Editor(this.editorRoot, this.editorBus);
    $('#song-title').textContent = this.song.title;
    this.setLit(false);
    this.placePlate();
    window.addEventListener('resize', () => this.placePlate());
  }

  // The hero art carries a generated plate with gibberish on it; the PHONK plate covers it exactly.
  // Source plate box (incl. the two badges beside it) in the 1216x832 render: x 254-424, y 421-462.
  placePlate() {
    const img = $('.hero__art img'), plate = $('.hero__plate'), hero = $('.hero');
    if (!img || !plate || !hero) return;
    const hw = hero.clientWidth, hh = hero.clientHeight;
    const iw = 1216, ih = 832;
    const scale = Math.max(hw / iw, hh / ih);            // object-fit: cover
    const dw = iw * scale, dh = ih * scale;
    const ox = (hw - dw) * 0.5, oy = (hh - dh) * 0.62;   // object-position: 50% 62%
    const cx = ox + 339 * scale, cy = oy + 441.5 * scale;
    const w = 176 * scale;
    plate.style.setProperty('--plate-x', (cx / hw * 100).toFixed(2) + '%');
    plate.style.setProperty('--plate-y', (cy / hh * 100).toFixed(2) + '%');
    plate.style.setProperty('--plate-w', (w / hw * 100).toFixed(2) + '%');
  }

  renderTransport() {
    const t = $('#transport');
    t.innerHTML = '';
    // ignition + transport keys
    const ign = el('div', 'ignition');
    ign.innerHTML = `
      <button class="ignition__key" id="coin" aria-label="Turn the key: switch the dash on and play">
        <svg class="ignition__barrel" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="56" fill="#0a0514"/>
          <circle cx="60" cy="60" r="50" fill="none" stroke="url(#kchrome)" stroke-width="5"/>
          <circle cx="60" cy="60" r="44" fill="#150c2a"/>
          <g class="ignition__pos" font-family="Michroma, sans-serif" font-size="8.5" fill="#dbe2f4" text-anchor="middle">
            <text x="28" y="42">OFF</text><text x="60" y="27">ACC</text><text x="93" y="42">ON</text><text x="60" y="104" class="ignition__start">START</text>
          </g>
          <g class="ignition__blade">
            <rect x="53" y="40" width="14" height="46" rx="3" fill="#05030c"/>
            <rect x="57" y="44" width="6" height="40" rx="2" fill="url(#kchrome)"/>
            <circle cx="60" cy="46" r="9" fill="none" stroke="url(#kchrome)" stroke-width="4"/>
            <rect x="63" y="70" width="5" height="4" rx="1" fill="url(#kchrome)"/><rect x="63" y="77" width="4" height="4" rx="1" fill="url(#kchrome)"/>
          </g>
        </svg>
        <span class="ignition__text">TURN KEY</span>
      </button>
      <div class="ignition__keys">
        <button class="key key--big" id="play" aria-label="Play" aria-pressed="false"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg></button>
        <button class="key key--big" id="stop" aria-label="Stop"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor"/></svg></button>
        <button class="key key--big" id="rewind" aria-label="Return to start"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 5h2v14H6zM19 5v14L9 12z" fill="currentColor"/></svg></button>
        <button class="key key--big" id="loop" aria-label="Loop the selection" aria-pressed="false"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M17 7H7a4 4 0 0 0 0 8h1v-2H7a2 2 0 1 1 0-4h10v3l4-4-4-4zM7 17h10a4 4 0 0 0 0-8h-1v2h1a2 2 0 1 1 0 4H7v-3l-4 4 4 4z" fill="currentColor"/></svg></button>
      </div>`;
    t.appendChild(ign);
    // tachometer: BPM as RPM
    const gauges = el('div', 'gauges');
    gauges.innerHTML = `
      <div class="tach" aria-hidden="true">
        <svg viewBox="0 0 200 130">
          <path class="tach__arc" d="M 20 110 A 80 80 0 0 1 180 110" fill="none" stroke="#2a1d4a" stroke-width="6"/>
          <path class="tach__hot" d="M 152 51 A 80 80 0 0 1 180 110" fill="none" stroke="#ff2bd6" stroke-width="6" opacity=".9"/>
          <g class="tach__ticks"></g>
          <g class="tach__needle" transform="rotate(-90 100 110)"><path d="M 100 110 L 100 38" stroke="#19e6ff" stroke-width="3" stroke-linecap="round"/><circle cx="100" cy="110" r="7" fill="#dbe2f4"/></g>
          <text x="100" y="126" text-anchor="middle" class="tach__lbl">TEMPO</text>
        </svg>
      </div>
      <div class="odometers"></div>`;
    t.appendChild(gauges);
    const ticks = $('.tach__ticks', gauges);
    for (let i = 0; i <= 10; i++) {
      const a = (-90 + i * 18) * Math.PI / 180;
      const r0 = 80, r1 = i % 2 ? 72 : 66;
      const x0 = 100 + Math.sin(a) * r0, y0 = 110 - Math.cos(a) * r0, x1 = 100 + Math.sin(a) * r1, y1 = 110 - Math.cos(a) * r1;
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', x0); l.setAttribute('y1', y0); l.setAttribute('x2', x1); l.setAttribute('y2', y1);
      l.setAttribute('stroke', i >= 8 ? '#ff2bd6' : '#dbe2f4'); l.setAttribute('stroke-width', i % 2 ? 1 : 2);
      ticks.appendChild(l);
      if (i === 0 || i === 2 || i === 5 || i === 8 || i === 10) {
        const tx = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        tx.setAttribute('x', 100 + Math.sin(a) * 52); tx.setAttribute('y', 110 - Math.cos(a) * 52 + 4); tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('class', 'tach__num');
        tx.textContent = 60 + i * 14;
        ticks.appendChild(tx);
      }
    }
    this.tachNeedle = $('.tach__needle', gauges);
    const odos = $('.odometers', gauges);
    this.cBpm = new Counter('BPM', 3, { onStep: (d) => this.commit({ type: 'setBpm', bpm: this.song.bpm + d }, true) });
    this.cBar = new Counter('BAR', 3, { speed: '.16s' });
    this.cStep = new Counter('STEP', 2, { speed: '.05s' });
    odos.append(this.cBpm.el, this.cBar.el, this.cStep.el);
    // screw + swing levers (gear-shift style)
    const levers = el('div', 'levers');
    levers.innerHTML = `
      <div class="lever" id="screw">
        <div class="lever__label">SCREW</div>
        <div class="lever__track"><input type="range" min="-7" max="3" step="1" value="0" aria-label="Screw: slow and pitch every device down, in semitones" orient="vertical"></div>
        <div class="lever__val">0 st</div>
      </div>
      <div class="lever">
        <div class="lever__label">SWING</div>
        <div class="lever__track"><input type="range" min="0" max="0.5" step="0.01" value="0.04" id="swing" aria-label="Swing" orient="vertical"></div>
        <div class="lever__val" id="swing-val">4%</div>
      </div>`;
    t.appendChild(levers);
    // deck: title + file keys
    const file = el('div', 'filestrip');
    file.innerHTML = `
      <div class="lcd lcd--song">
        <button class="lcd__title" id="song-title" title="Rename song"></button>
        <span class="lcd__lbl">NOW LOADED · PRESS THE TITLE TO RENAME</span>
      </div>
      <div class="filestrip__keys">
        <button class="key" id="new">NEW</button>
        <button class="key" id="open">OPEN</button>
        <button class="key key--hot" id="save">SAVE JSON</button>
        <button class="key" id="export">WAV</button>
        <button class="key" id="undo" title="Undo (Ctrl+Z)">UNDO</button>
        <button class="key" id="redo" title="Redo (Ctrl+Shift+Z)">REDO</button>
        <button class="key" id="demo" title="Reload the built-in demo song">DEMO</button>
      </div>
      <input type="file" id="file-input" accept=".json,application/json" hidden>`;
    t.appendChild(file);
  }

  renderRack() {
    const rack = $('#rack');
    rack.innerHTML = '';
    for (const dev of this.song.devices) rack.appendChild(this.renderDevice(dev));
  }

  renderDevice(dev) {
    const T = DEVICE_TYPES[dev.type];
    const d = el('section', `device device--${dev.type} device--${T.color}`);
    d.dataset.device = dev.id;
    d.setAttribute('aria-label', T.name);
    d.innerHTML = `
      <header class="device__head">
        <div class="badge">
          <span class="badge__name">${T.name}</span>
          <span class="badge__tag">${T.tag}</span>
        </div>
        <div class="device__keys">
          <button class="key js-edit" title="Open in the editor">EDIT</button>
          <button class="key js-mute ${dev.muted ? 'is-on' : ''}" aria-pressed="${!!dev.muted}" title="Mute">MUTE</button>
        </div>
        <div class="lamp ${dev.muted ? '' : 'is-armed'}" aria-hidden="true"></div>
      </header>
      <div class="device__body">
        <div class="device__face"></div>
        <div class="device__knobs"></div>
      </div>
      <div class="device__screws" aria-hidden="true"></div>`;
    const knobs = $('.device__knobs', d);
    knobs.dataset.count = T.params.length;
    for (const p of T.params) {
      const k = new Knob(p, dev.params[p.id] ?? p.def,
        (v) => this.engine.setParam(dev.id, p.id, v),
        (v) => this.commit({ type: 'setParam', deviceId: dev.id, param: p.id, value: v }, false));
      this.knobs.set(dev.id + '.' + p.id, k);
      knobs.appendChild(k.el);
    }
    const face = $('.device__face', d);
    if (dev.type === 'breaker') this.faceBreaker(face, dev);
    else if (dev.type === 'carousel') this.faceCarousel(face, dev);
    else if (dev.type === 'hearse') this.faceHearse(face, dev);
    else if (dev.type === 'cathedral') this.faceCathedral(face, dev);
    else if (dev.type === 'preacher') this.facePreacher(face, dev);
    $('.js-edit', d).addEventListener('click', () => this.openEditor(dev.id));
    $('.js-mute', d).addEventListener('click', () => this.commit({ type: 'setMuted', deviceId: dev.id, muted: !dev.muted }, true));
    return d;
  }

  // --- faces: the part of each device that is not knobs ---
  faceBreaker(face, dev) {
    face.classList.add('face-breaker');
    // The V12 step grid: each lane's name pad is also its trigger (press to hit),
    // followed by 16 chrome letter/number pushbuttons. Pages step through longer patterns.
    const sel = el('div', 'selector');
    sel.setAttribute('role', 'grid');
    sel.setAttribute('aria-label', 'Drum steps of the current pattern');
    face.appendChild(sel);
    this.selPage = 0;
    sel.addEventListener('pointerdown', (e) => {
      const pad = e.target.closest('.lanepad');
      if (!pad || e.button !== 0) return;
      e.preventDefault();
      const i = +pad.dataset.lane;
      this.ensureAudio().then(() => { this.engine.audition(dev.id, i); this.flash(pad); });
    });
    sel.addEventListener('keydown', (e) => {
      const pad = e.target.closest('.lanepad');
      if (pad && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.ensureAudio().then(() => this.engine.audition(dev.id, +pad.dataset.lane)); }
    });
    sel.addEventListener('wheel', (e) => {
      const pad = e.target.closest('.lanepad'); if (!pad) return;
      e.preventDefault(); this.tuneLane(dev, +pad.dataset.lane, e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    sel.addEventListener('contextmenu', (e) => {
      const pad = e.target.closest('.lanepad'); if (!pad) return;
      e.preventDefault(); this.tuneLane(dev, +pad.dataset.lane, e.shiftKey ? -1 : 1);
    });
    sel.addEventListener('click', (e) => {
      const nd = e.target.closest('.js-nudge');
      if (nd) { const sc = $('.selector__scroll', sel); sc.scrollBy({ left: +nd.dataset.dir * 4 * 44, behavior: 'smooth' }); return; }
      const pg = e.target.closest('.selector__page'); if (!pg) return;
      this.selPage = +pg.dataset.page; this.selHold = performance.now(); this.drawSelector(dev);
    });
    this.breakerSel = sel;
    this.drawSelector(dev);
  }
  tuneLane(dev, i, d) {
    const tune = [...(dev.params.tune || [0, 0, 0, 0, 0, 0, 0, 0])];
    tune[i] = Math.max(-12, Math.min(12, tune[i] + d));
    this.commit({ type: 'setParam', deviceId: dev.id, param: 'tune', value: tune }, true);
    this.engine.audition(dev.id, i);
  }
  drawSelector(dev) {
    const sel = this.breakerSel;
    if (!sel) return;
    const pat = this.editorPatternFor(dev);
    const pages = Math.max(1, Math.ceil((pat?.steps || 16) / 16));
    if (this.selPage >= pages) this.selPage = 0;
    const off = this.selPage * 16;
    const tune = dev.params.tune || [];
    const laneHtml = BREAKER_LANES.map((name, lane) => {
      const t = tune[lane] || 0;
      return `<button class="lanepad" data-lane="${lane}" aria-label="${name} pad, tune ${t > 0 ? '+' : ''}${t} semitones"><span class="lanepad__name">${name}</span><span class="lanepad__tune ${t ? 'is-set' : ''}" aria-hidden="true">${t ? (t > 0 ? '+' : '') + t : ''}</span></button>`;
    }).join('');
    const rowsHtml = BREAKER_LANES.map((name, lane) => {
      const cells = Array.from({ length: 16 }, (_, k) => {
        const s = off + k;
        const on = pat?.notes.some((n) => n.n === lane && n.s === s);
        return `<button class="sel ${on ? 'is-on' : ''} ${k % 4 === 0 ? 'sel--beat' : ''}" role="gridcell" data-lane="${lane}" data-step="${s}" data-col="${k}" aria-label="${name} step ${s + 1}" aria-pressed="${!!on}"><span>${k % 4 === 0 ? k + 1 : ''}</span></button>`;
      }).join('');
      return `<div class="selector__row" role="row">${cells}</div>`;
    }).join('');
    const pageHtml = pages > 1 ? `<div class="selector__pages" role="tablist" aria-label="Pattern page">${Array.from({ length: pages }, (_, p) => `<button class="selector__page ${p === this.selPage ? 'is-on' : ''}" role="tab" data-page="${p}" aria-selected="${p === this.selPage}">BAR ${p + 1}</button>`).join('')}<span class="selector__pat">${pat?.name || 'A'} · ${pat?.steps || 16} STEPS · TAP A LANE NAME TO HIT IT · RIGHT-CLICK TO TUNE</span></div>` : `<div class="selector__pages"><span class="selector__pat">${pat?.name || 'A'} · ${pat?.steps || 16} STEPS · TAP A LANE NAME TO HIT IT · RIGHT-CLICK TO TUNE</span></div>`;
    const nudge = `<span class="selector__nudge"><button class="key js-nudge" data-dir="-1" aria-label="Scroll steps left"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="key js-nudge" data-dir="1" aria-label="Scroll steps right"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button></span>`;
    sel.innerHTML = `<div class="selector__lanes" role="rowgroup">${laneHtml}</div><div class="selector__scroll" role="rowgroup">${rowsHtml}</div>` + pageHtml.replace('</div>', nudge + '</div>');
    return;
    sel.innerHTML = rowsHtml + pageHtml;
  }
  editorPatternFor(dev) {
    if (this.editor && this.editor.deviceId === dev.id && this.editor.patId) return findPattern(dev, this.editor.patId);
    return dev.patterns[0];
  }

  faceCarousel(face, dev) {
    face.classList.add('face-deck');
    face.innerHTML = `
      <div class="deck">
        <canvas class="deck-canvas" aria-hidden="true"></canvas>
      </div>
      <div class="deck__row">
        <div class="lcd lcd--tape"><span class="lcd__title js-sample-name">—</span><span class="lcd__lbl js-sample-meta">no tape</span></div>
        <div class="slice-keys" role="group" aria-label="Slice pads"></div>
      </div>`;
    this.carouselCanvas = $('.deck-canvas', face);
    this.sliceKeys = $('.slice-keys', face);
    this.sampleName = $('.js-sample-name', face);
    this.sampleMeta = $('.js-sample-meta', face);
    this.sliceKeys.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      e.preventDefault();
      this.ensureAudio().then(() => { this.engine.audition(dev.id, +b.dataset.slice, { r: e.shiftKey }); this.flash(b); });
    });
    this.sliceKeys.addEventListener('keydown', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.ensureAudio().then(() => this.engine.audition(dev.id, +b.dataset.slice, { r: e.shiftKey })); }
    });
    this.drawSliceKeys(dev);
  }
  drawSliceKeys(dev) {
    const n = dev.audio?.slices?.length || 0;
    this.sliceKeys.innerHTML = Array.from({ length: n }, (_, i) => `<button class="sel sel--slice" data-slice="${i}" aria-label="Play slice ${i + 1} (shift: reversed)"><span>${String(i + 1).padStart(2, '0')}</span></button>`).join('');
    this.sampleName.textContent = dev.audio?.name || '—';
    this.sampleMeta.textContent = dev.audio ? `${n} SLICES · ${dev.audio.buffer ? dev.audio.buffer.duration.toFixed(2) + 's' : ''} · ${dev.audio.origin === 'baked' ? 'DUBBED IN-HOUSE' : dev.audio.origin === 'lathe' ? 'CUT IN THE CHOP SHOP' : 'YOUR TAPE'}` : 'no tape';
    this.carouselDirty = true;
  }


  // A real two-octave piano: white keys in a row, black keys floating over the seams.
  buildPiano(container, lo, hi, verb) {
    container.classList.add('piano');
    const BLACK = [1, 3, 6, 8, 10];
    const whites = []; for (let m = lo; m <= hi; m++) if (!BLACK.includes(m % 12)) whites.push(m);
    container.style.setProperty('--nw', whites.length);
    const frag = document.createDocumentFragment();
    let wi = 0;
    for (let m = lo; m <= hi; m++) {
      const black = BLACK.includes(m % 12);
      const b = el('button', `pk ${black ? 'pk--black' : 'pk--white'}`, `<span>${black ? noteName(m).replace(/-?\d+$/, '') : noteName(m)}</span>`);
      b.setAttribute('aria-label', `${verb} ${noteName(m)}`);
      b.title = noteName(m);
      b.dataset.midi = m;
      if (black) b.style.setProperty('--i', wi - 1); else { b.style.setProperty('--i', wi); wi++; }
      frag.appendChild(b);
    }
    container.appendChild(frag);
  }

  faceHearse(face, dev) {
    face.classList.add('face-hearse');
    face.innerHTML = `<div class="scope"><canvas aria-hidden="true"></canvas><div class="scope__lbl">808 · <span class="js-note">—</span></div></div>
      <div class="hearse-keys" role="group" aria-label="808 keys"></div>`;
    this.hearseScope = $('canvas', face);
    this.hearseNote = $('.js-note', face);
    const keys = $('.hearse-keys', face);
    this.buildPiano(keys, 24, 47, 'Play');
    keys.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button'); if (!b) return; e.preventDefault();
      this.ensureAudio().then(() => { this.engine.audition(dev.id, +b.dataset.midi, { len: 4, g: e.shiftKey }); this.flash(b); this.hearseNote.textContent = noteName(+b.dataset.midi); });
    });
    keys.addEventListener('keydown', (e) => { const b = e.target.closest('button'); if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.ensureAudio().then(() => this.engine.audition(dev.id, +b.dataset.midi, { len: 4 })); } });
  }
  faceCathedral(face, dev) {
    face.classList.add('face-cathedral');
    face.innerHTML = `<div class="nave"><canvas aria-hidden="true"></canvas><div class="scope__lbl">LASERS FIRED <span class="js-count">0000</span></div></div>
      <div class="bell-keys" role="group" aria-label="Cowbell keys"></div>`;
    this.naveCanvas = $('canvas', face);
    this.bellCount = $('.js-count', face);
    const keys = $('.bell-keys', face);
    this.buildPiano(keys, 60, 83, 'Ring');
    keys.addEventListener('pointerdown', (e) => { const b = e.target.closest('button'); if (!b) return; e.preventDefault(); this.ensureAudio().then(() => { this.engine.audition(dev.id, +b.dataset.midi, { len: 1 }); this.flash(b); }); });
    keys.addEventListener('keydown', (e) => { const b = e.target.closest('button'); if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.ensureAudio().then(() => this.engine.audition(dev.id, +b.dataset.midi, { len: 1 })); } });
  }
  facePreacher(face, dev) {
    face.classList.add('face-preacher');
    face.innerHTML = `<div class="mouth"><canvas aria-hidden="true"></canvas><div class="scope__lbl">MOUTH · <span class="js-vowel">EH</span></div></div>
      <div class="preach-keys" role="group" aria-label="Preacher keys"></div>`;
    this.mouthCanvas = $('canvas', face);
    this.vowelLbl = $('.js-vowel', face);
    const keys = $('.preach-keys', face);
    this.buildPiano(keys, 40, 63, 'Chant');
    keys.addEventListener('pointerdown', (e) => { const b = e.target.closest('button'); if (!b) return; e.preventDefault(); this.ensureAudio().then(() => { this.engine.audition(dev.id, +b.dataset.midi, { len: 3 }); this.flash(b); }); });
    keys.addEventListener('keydown', (e) => { const b = e.target.closest('button'); if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.ensureAudio().then(() => this.engine.audition(dev.id, +b.dataset.midi, { len: 3 })); } });
  }

  renderLathe() {
    const l = $('#lathe');
    l.innerHTML = `
      <header class="device__head">
        <div class="badge"><span class="badge__name">CHOP SHOP</span><span class="badge__tag">CASSETTE CHOPPER · CUTS TAPE FOR THE DECK</span></div>
        <div class="device__keys">
          <button class="key" id="lathe-resample" title="Render the song (bars in the loop, or the first 2) without the deck and load it here">RESAMPLE SONG</button>
          <button class="key" id="lathe-load">LOAD AUDIO</button>
          <button class="key" id="lathe-record" aria-pressed="false">RECORD MIC</button>
        </div>
        <div class="lamp is-armed" aria-hidden="true"></div>
      </header>
      <div class="device__body device__body--lathe">
        <div class="wave" id="wave">
          <canvas aria-hidden="true"></canvas>
          <div class="wave__hint" id="wave-hint">Drop a WAV, MP3, OGG or FLAC here, record the mic, or resample the song. Click the waveform to add a cut, drag a cut to move it, double-click a cut to remove it.</div>
        </div>
        <div class="lathe__ctl">
          <div class="lathe__group">
            <span class="lathe__lbl">CUT BY</span>
            <button class="key" data-cut="transient">TRANSIENTS</button>
            <button class="key" data-cut="4">4</button>
            <button class="key" data-cut="8">8</button>
            <button class="key" data-cut="16">16</button>
            <button class="key" data-cut="32">32</button>
          </div>
          <label class="lathe__group lathe__sens"><span class="lathe__lbl">SENSITIVITY</span><input type="range" min="0" max="1" step="0.01" value="0.55" id="lathe-sens" aria-label="Transient sensitivity"></label>
          <div class="lathe__group">
            <button class="key" id="lathe-normalize">NORMALIZE</button>
            <button class="key key--hot" id="lathe-commit">LOAD TO DECK</button>
            <button class="key" id="lathe-export" title="Download this chop as a .slices.json file">EXPORT SLICES</button>
          </div>
          <div class="lathe__readout lcd"><span class="lcd__title" id="lathe-name">EMPTY REEL</span><span class="lcd__lbl" id="lathe-meta">—</span></div>
        </div>
        <input type="file" id="lathe-file" accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac" hidden>
      </div>
      <div class="device__screws" aria-hidden="true"></div>`;
    this.lathe = { buffer: null, slices: [], name: '', drag: null, peaks: null, recorder: null, canvas: $('#wave canvas'), origin: 'user' };
    this.bindLathe();
  }

  renderMaster() {
    const m = $('#master');
    m.innerHTML = `
      <header class="device__head device__head--master">
        <div class="badge"><span class="badge__name">EXHAUST</span><span class="badge__tag">MASTER · TAPE SATURATION</span></div>
      </header>
      <div class="device__body device__body--master">
        <div class="device__knobs device__knobs--master"></div>
        <div class="vu" aria-hidden="true"><div class="vu__bars"></div><div class="vu__lbl">OUTPUT</div></div>
        <div class="master__strip lcd lcd--info">
          <span class="lcd__title">MASTER BUS</span>
          <span class="lcd__lbl">Every device leaves through this tape stage. SAVE JSON keeps the whole dash in one readable file, chopped tape included as WAV.</span>
        </div>
      </div>
      <div class="device__screws" aria-hidden="true"></div>`;
    const knobs = $('.device__knobs--master', m);
    for (const p of MASTER_PARAMS) {
      const k = new Knob(p, this.song.master[p.id] ?? p.def, (v) => this.engine.setMaster(p.id, v), (v) => this.commit({ type: 'setMaster', param: p.id, value: v }, false));
      this.knobs.set('master.' + p.id, k);
      knobs.appendChild(k.el);
    }
    const bars = $('.vu__bars', m);
    bars.innerHTML = Array.from({ length: 24 }, (_, i) => `<i class="${i >= 20 ? 'is-hot' : i >= 16 ? 'is-warm' : ''}"></i>`).join('');
    this.vuBars = [...bars.children];
  }

  // ---------- binding ----------
  bind() {
    $('#coin').addEventListener('click', () => this.insertCoin());
    $('#play').addEventListener('click', () => this.ensureAudio().then(() => { if (!this.engine.playing) this.engine.play(); }));
    $('#stop').addEventListener('click', () => this.engine.stop());
    $('#rewind').addEventListener('click', () => this.engine.rewind());
    $('#loop').addEventListener('click', () => { this.engine.loop.on = !this.engine.loop.on; if (this.engine.loop.on && this.engine.loop.endBar <= this.engine.loop.startBar) { this.engine.loop.startBar = 0; this.engine.loop.endBar = Math.min(4, this.song.arrangement.bars); } this.refreshTransport(); });
    $('#screw input').addEventListener('input', (e) => { this.engine.applyScrew(+e.target.value); this.cabinet.style.setProperty('--screw', (+e.target.value) / -7); });
    $('#screw input').addEventListener('change', () => this.commit({ type: 'setScrew', screw: this.song.screw }, false));
    $('#swing').addEventListener('input', (e) => { this.song.swing = +e.target.value; $('#swing-val').textContent = Math.round(this.song.swing * 100) + '%'; });
    $('#swing').addEventListener('change', () => this.commit({ type: 'setSwing', swing: this.song.swing }, false));
    $('#save').addEventListener('click', () => this.save());
    $('#export').addEventListener('click', () => this.exportWav());
    $('#open').addEventListener('click', () => $('#file-input').click());
    $('#file-input').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) this.openFile(f); e.target.value = ''; });
    $('#new').addEventListener('click', () => { if (confirm('Start an empty cabinet? Unsaved changes are lost.')) this.loadSong(emptySong()); });
    $('#demo').addEventListener('click', () => { if (confirm('Reload COUNTACH DRIFT? Unsaved changes are lost.')) this.loadSong(demoSong()); });
    $('#undo').addEventListener('click', () => this.undo());
    $('#redo').addEventListener('click', () => this.redo());
    $('#song-title').addEventListener('click', () => { const t = prompt('Song title', this.song.title); if (t != null) this.commit({ type: 'setTitle', title: t.toUpperCase() }, true); });
    this.editorRoot.addEventListener('click', (e) => {
      const b = e.target.closest('.sel'); if (!b) return;
    });
    // selector grid clicks (breaker face)
    $('#rack').addEventListener('click', (e) => {
      const b = e.target.closest('.selector .sel');
      if (!b) return;
      const dev = findDevice(this.song, 'breaker');
      const pat = this.editorPatternFor(dev);
      const lane = +b.dataset.lane, s = +b.dataset.step;
      const on = pat.notes.some((n) => n.n === lane && n.s === s);
      this.commit(on ? { type: 'removeNote', deviceId: dev.id, patId: pat.id, s, n: lane } : { type: 'addNote', deviceId: dev.id, patId: pat.id, note: { s, n: lane, l: 1, v: 1 } }, true);
      if (!on) this.ensureAudio().then(() => this.engine.audition(dev.id, lane));
    });
    // drag/drop anywhere: .json opens a song; audio goes to the lathe
    const stopEv = (e) => { e.preventDefault(); e.stopPropagation(); };
    document.addEventListener('dragover', (e) => { stopEv(e); document.body.classList.add('is-dropping'); });
    document.addEventListener('dragleave', (e) => { if (e.target === document.body || e.clientX <= 0 || e.clientY <= 0) document.body.classList.remove('is-dropping'); });
    document.addEventListener('drop', (e) => {
      stopEv(e); document.body.classList.remove('is-dropping');
      const f = e.dataTransfer.files[0]; if (!f) return;
      if (f.name.endsWith('.json') || f.type === 'application/json') this.openFile(f); else this.latheLoadFile(f);
    });
    // keyboard
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'select' || tag === 'textarea' || e.target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.save(); return; }
      if (typing) return;
      if (e.code === 'Space' && tag !== 'button' && tag !== 'canvas') { e.preventDefault(); this.ensureAudio().then(() => this.engine.toggle()); }
      if (e.key === 'Home') this.engine.rewind();
    });
    this.engine.addEventListener('transport', () => this.refreshTransport());
    this.engine.addEventListener('audio', () => { const dev = findDevice(this.song, 'carousel'); this.drawSliceKeys(dev); this.editor.syncFromSong(); this.broadcast(); });
    this.engine.addEventListener('screw', () => { const v = this.song.screw; $('#screw input').value = v; $('#screw .lever__val').textContent = (v > 0 ? '+' : '') + v + ' st'; this.cabinet.style.setProperty('--screw', v / -7); });
    window.addEventListener('beforeunload', () => { this.autosave(); if (this.detachedWin && !this.detachedWin.closed) this.detachedWin.close(); });
    window.addEventListener('resize', () => { this.carouselDirty = true; });
    // detached editor channel
    if (this.channel) this.channel.addEventListener('message', (e) => this.onChannel(e.data));
    window.addEventListener('message', (e) => { if (e.data && e.data.noise) this.onChannel(e.data); });
  }

  // ---------- audio gate ----------
  async ensureAudio() {
    if (!this.engine.ready) await this.insertCoin(false);
    return true;
  }
  async insertCoin(autoplay = true) {
    if (this.engine.ready) { if (!this.engine.playing && autoplay) this.engine.play(); return; }
    const btn = $('#coin');
    btn.classList.add('is-busy');
    await this.engine.unlock();
    this.engine.ui('coin');
    this.setLit(true);
    btn.classList.remove('is-busy');
    btn.classList.add('is-on');
    btn.setAttribute('aria-label', 'Play');
    const dev = findDevice(this.song, 'carousel');
    this.drawSliceKeys(dev);
    if (!this.lathe.buffer && dev.audio?.buffer) {
      this.lathe.buffer = dev.audio.buffer; this.lathe.name = dev.audio.name; this.lathe.origin = dev.audio.origin;
      this.lathe.slices = dev.audio.slices.map((x) => ({ ...x })); this.lathe.peaks = null;
      $('#wave-hint').hidden = true; this.drawLathe(); this.latheMeta();
    }
    if (autoplay) setTimeout(() => this.engine.play(), 700);
  }
  setLit(on) {
    this.lit = on;
    document.body.classList.toggle('is-lit', on);
    $('#coin').classList.toggle('is-on', on);
  }

  // ---------- state changes ----------
  commit(op, refreshUI) {
    const ok = applyOp(this.song, op);
    if (!ok) return false;
    this.afterChange(op, refreshUI);
    return true;
  }
  afterChange(op, refreshUI) {
    // engine side-effects
    if (op.type === 'setParam') this.engine.devices.get(op.deviceId)?.set(op.param, op.value);
    if (op.type === 'setMaster') this.engine.master?.set(op.param, op.value);
    if (op.type === 'setMuted') this.engine.setMuted(op.deviceId, op.muted);
    if (op.type === 'setScrew') this.engine.applyScrew(this.song.screw);
    this.history.snapshot(this.song);
    this.dirty = true;
    if (refreshUI) this.refreshUI(op);
    if (op.type.includes('Note') || op.type === 'clearPattern' || op.type === 'setPatternSteps' || (op.type === 'setParam' && op.param === 'tune')) { const dev = findDevice(this.song, 'breaker'); if (op.deviceId === dev.id) this.drawSelector(dev); }
    if (op.type.startsWith('add') || op.type.startsWith('remove') || op.type === 'rename' || op.type === 'setBars' || op.type === 'setPatternSteps' || op.type === 'addPattern' || op.type === 'removePattern' || op.type === 'renamePattern') this.editor.syncFromSong();
    this.broadcast();
    clearTimeout(this._as);
    this._as = setTimeout(() => this.autosave(), 1200);
  }
  refreshUI() {
    $('#song-title').textContent = this.song.title;
    if ($('#hero-title')) $('#hero-title').textContent = this.song.title;
    this.cBpm.set(this.song.bpm);
    $('#swing').value = this.song.swing; $('#swing-val').textContent = Math.round(this.song.swing * 100) + '%';
    for (const dev of this.song.devices) {
      const T = DEVICE_TYPES[dev.type];
      for (const p of T.params) this.knobs.get(dev.id + '.' + p.id)?.set(dev.params[p.id]);
      const sec = $(`[data-device="${dev.id}"]`, this.cabinet);
      if (sec) { $('.js-mute', sec).classList.toggle('is-on', !!dev.muted); $('.js-mute', sec).setAttribute('aria-pressed', !!dev.muted); $('.lamp', sec).classList.toggle('is-armed', !dev.muted); }
    }
    for (const p of MASTER_PARAMS) this.knobs.get('master.' + p.id)?.set(this.song.master[p.id]);
    this.drawSelector(findDevice(this.song, 'breaker'));
    this.refreshTransport();
  }
  refreshTransport() {
    const playing = this.engine.playing;
    $('#play').classList.toggle('is-on', playing);
    $('#play').setAttribute('aria-pressed', playing);
    $('#loop').classList.toggle('is-on', this.engine.loop.on);
    $('#loop').setAttribute('aria-pressed', this.engine.loop.on);
    document.body.classList.toggle('is-playing', playing);
  }
  undo() { if (this.history.undo(this.song)) this.afterRestore(); }
  redo() { if (this.history.redoStep(this.song)) this.afterRestore(); }
  afterRestore() {
    this.engine.song = this.song;
    for (const dev of this.song.devices) { const inst = this.engine.devices.get(dev.id); if (inst) { for (const k of Object.keys(dev.params)) inst.set(k, dev.params[k]); inst.setMuted(!!dev.muted); } }
    for (const k of Object.keys(this.song.master)) this.engine.master?.set(k, this.song.master[k]);
    this.engine.applyScrew(this.song.screw);
    this.refreshUI();
    this.editor.syncFromSong();
    this.broadcast();
  }

  async loadSong(song) {
    this.song = song;
    this.history = new History();
    this.history.snapshot(song);
    await this.engine.setSong(song);
    this.knobs.clear();
    this.renderRack();
    this.renderMaster();
    this.refreshUI();
    this.editor.deviceId = song.devices[0].id; this.editor.patId = null;
    this.editor.syncFromSong();
    this.editorBus.setMode(this.editor.mode, this.editor.mode === 'pattern' ? { deviceId: this.editor.deviceId, patId: this.editor.patId } : null);
    const dev = findDevice(this.song, 'carousel');
    this.drawSliceKeys(dev);
    this.broadcast();
    this.toast(`Loaded ${song.title}`);
  }

  // ---------- files ----------
  save() {
    const data = this.engine.ready ? this.engine.serialize() : this.serializeCold();
    const json = JSON.stringify(data, null, 1);
    downloadBlob(new Blob([json], { type: 'application/json' }), safeFilename(this.song.title) + '.noise.json');
    this.dirty = false;
    this.toast(`Saved ${safeFilename(this.song.title)}.noise.json (${(json.length / 1024).toFixed(0)} KB)`);
    $('#hero-title') && ($('#hero-title').textContent = this.song.title);
  }
  serializeCold() {
    const s = JSON.parse(JSON.stringify({ ...this.song, devices: this.song.devices.map((d) => ({ ...d, audio: d.audio ? { name: d.audio.name, slices: d.audio.slices, origin: d.audio.origin, wav: d.audio.wav || null } : d.audio })) }));
    s.meta = { ...s.meta, saved: new Date().toISOString() };
    return s;
  }
  async openFile(file) {
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      const song = validateSong(obj);
      // audio: keep the wav uri; the engine decodes it at unlock
      for (const d of song.devices) if (d.type === 'carousel' && d.audio && d.audio.wav) d.audio = { name: d.audio.name || file.name, slices: d.audio.slices || [], origin: d.audio.origin || 'file', wav: d.audio.wav };
      await this.loadSong(song);
    } catch (err) {
      console.error(err);
      this.toast('Could not open that file: ' + err.message, true);
    }
  }
  async exportWav() {
    await this.ensureAudio();
    const btn = $('#export');
    btn.disabled = true; btn.textContent = 'RENDERING…';
    try {
      const ab = await this.engine.renderMixdown((p) => { btn.textContent = `RENDER ${Math.round(p * 100)}%`; });
      downloadBlob(new Blob([ab], { type: 'audio/wav' }), safeFilename(this.song.title) + '.wav');
      this.toast('Mixdown saved as WAV');
    } catch (err) { console.error(err); this.toast('Render failed: ' + err.message, true); }
    btn.disabled = false; btn.textContent = 'WAV';
  }
  autosave() {
    if (!this.dirty) return;
    try {
      const data = this.engine.ready ? this.engine.serialize() : this.serializeCold();
      const json = JSON.stringify(data);
      if (json.length < 4.5e6) localStorage.setItem(AUTOSAVE_KEY, json);
    } catch (e) { /* storage full or unavailable */ }
  }
  restoreAutosave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (!obj || obj.format !== 'noise-song') return;
      const bar = $('#resume');
      bar.hidden = false;
      $('#resume-title').textContent = obj.title || 'UNTITLED';
      $('#resume-yes').onclick = async () => { bar.hidden = true; const song = validateSong(obj); for (const d of song.devices) if (d.type === 'carousel' && d.audio?.wav) d.audio = { name: d.audio.name, slices: d.audio.slices, origin: d.audio.origin, wav: d.audio.wav }; await this.loadSong(song); };
      $('#resume-no').onclick = () => { bar.hidden = true; localStorage.removeItem(AUTOSAVE_KEY); };
    } catch (e) { /* ignore */ }
  }

  // ---------- LATHE ----------
  bindLathe() {
    const L = this.lathe;
    $('#lathe-load').addEventListener('click', () => $('#lathe-file').click());
    $('#lathe-file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) this.latheLoadFile(f); e.target.value = ''; });
    $('#lathe-resample').addEventListener('click', () => this.latheResample());
    $('#lathe-record').addEventListener('click', () => this.latheRecord());
    $$('[data-cut]').forEach((b) => b.addEventListener('click', () => {
      if (!L.buffer) return this.toast('Put something on the reel first.', true);
      const cut = b.dataset.cut;
      L.slices = cut === 'transient' ? detectSlices(L.buffer, +$('#lathe-sens').value) : sliceEven(L.buffer, +cut);
      this.drawLathe(); this.latheMeta();
    }));
    $('#lathe-sens').addEventListener('change', () => { if (L.buffer) { L.slices = detectSlices(L.buffer, +$('#lathe-sens').value); this.drawLathe(); this.latheMeta(); } });
    $('#lathe-normalize').addEventListener('click', async () => { if (!L.buffer) return; await this.ensureAudio(); L.buffer = normalizeBuffer(this.engine.ctx, L.buffer); L.peaks = null; this.drawLathe(); this.toast('Normalized'); });
    $('#lathe-commit').addEventListener('click', async () => {
      if (!L.buffer) return this.toast('Nothing to load. Drop audio, record, or resample first.', true);
      await this.ensureAudio();
      this.engine.setCarouselAudio(L.buffer, L.slices.map((s) => ({ ...s })), L.name, L.origin);
      this.history.snapshot(this.song); this.dirty = true;
      this.toast(`Loaded ${L.slices.length} slices into the TAPE DECK`);
      $('#rack .device--carousel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('#lathe-export').addEventListener('click', async () => {
      if (!L.buffer) return;
      await this.ensureAudio();
      const { bufferToDataUri } = await import('./wav.js');
      const out = { format: 'noise-slices', version: 1, name: L.name, sampleRate: L.buffer.sampleRate, duration: L.buffer.duration, slices: L.slices, encoding: 'wav/pcm16/base64', wav: bufferToDataUri(L.buffer) };
      downloadBlob(new Blob([JSON.stringify(out)], { type: 'application/json' }), safeFilename(L.name) + '.slices.json');
    });
    // waveform interaction
    const wave = $('#wave');
    const pos = (e) => { const r = L.canvas.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
    const nearCut = (x) => {
      if (!L.buffer) return -1;
      const tol = 0.008;
      let best = -1, bd = tol;
      L.slices.forEach((s, i) => { if (i === 0) return; const d = Math.abs(s.start / L.buffer.duration - x); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    wave.addEventListener('pointerdown', (e) => {
      if (!L.buffer) return;
      const x = pos(e);
      const i = nearCut(x);
      if (i > 0) { L.drag = { i }; wave.setPointerCapture(e.pointerId); }
      else {
        // add a cut
        const t = x * L.buffer.duration;
        const idx = L.slices.findIndex((s) => t > s.start && t < s.end);
        if (idx >= 0) {
          const s = L.slices[idx];
          if (t - s.start > 0.02 && s.end - t > 0.02) { L.slices.splice(idx, 1, { start: s.start, end: t }, { start: t, end: s.end }); this.drawLathe(); this.latheMeta(); }
        }
      }
    });
    wave.addEventListener('pointermove', (e) => {
      if (!L.buffer) return;
      const x = pos(e);
      if (L.drag) {
        const i = L.drag.i;
        const t = x * L.buffer.duration;
        const lo = L.slices[i - 1].start + 0.02, hi = L.slices[i].end - 0.02;
        const nt = Math.max(lo, Math.min(hi, t));
        L.slices[i - 1].end = nt; L.slices[i].start = nt;
        this.drawLathe();
      } else wave.style.cursor = nearCut(x) > 0 ? 'ew-resize' : 'text';
    });
    const up = (e) => { if (L.drag) { L.drag = null; try { wave.releasePointerCapture(e.pointerId); } catch (err) {} this.latheMeta(); } };
    wave.addEventListener('pointerup', up); wave.addEventListener('pointercancel', up);
    wave.addEventListener('dblclick', (e) => {
      if (!L.buffer) return;
      const i = nearCut(pos(e));
      if (i > 0) { L.slices[i - 1].end = L.slices[i].end; L.slices.splice(i, 1); this.drawLathe(); this.latheMeta(); }
    });
    wave.addEventListener('click', async (e) => {
      // audition the slice under the pointer with alt
      if (!e.altKey || !L.buffer) return;
      await this.ensureAudio();
      const t = pos(e) * L.buffer.duration;
      const s = L.slices.find((s) => t >= s.start && t < s.end);
      if (!s) return;
      const src = this.engine.ctx.createBufferSource(); src.buffer = L.buffer; src.connect(this.engine.master.input); src.start(0, s.start, s.end - s.start);
    });
    new ResizeObserver(() => { L.peaks = null; this.drawLathe(); }).observe(wave);
  }
  async latheLoadFile(file) {
    await this.ensureAudio();
    const L = this.lathe;
    try {
      const ab = await file.arrayBuffer();
      let buf = await this.engine.ctx.decodeAudioData(ab);
      if (buf.duration > 30) { buf = trimBuffer(this.engine.ctx, buf, 30); this.toast('Trimmed to the first 30 seconds', true); }
      this.lathePut(buf, file.name.replace(/\.[^.]+$/, '').toUpperCase().slice(0, 28), 'user');
    } catch (err) { console.error(err); this.toast('Could not decode that audio: ' + err.message, true); }
  }
  lathePut(buffer, name, origin) {
    const L = this.lathe;
    L.buffer = buffer; L.name = name; L.origin = origin; L.peaks = null;
    L.slices = detectSlices(buffer, +$('#lathe-sens').value);
    $('#wave-hint').hidden = true;
    this.drawLathe(); this.latheMeta();
  }
  latheMeta() {
    const L = this.lathe;
    $('#lathe-name').textContent = L.name || 'EMPTY REEL';
    $('#lathe-meta').textContent = L.buffer ? `${L.buffer.duration.toFixed(2)}s · ${L.buffer.sampleRate} Hz · ${L.slices.length} CUTS` : '—';
  }
  async latheResample() {
    await this.ensureAudio();
    const btn = $('#lathe-resample');
    btn.disabled = true; btn.textContent = 'DUBBING…';
    try {
      const loop = this.engine.loop;
      const a = loop.on ? loop.startBar : 0, b = loop.on ? loop.endBar : Math.min(2, this.song.arrangement.bars);
      const buf = await this.engine.renderRange(a, b, { exclude: ['carousel'], hiss: false });
      this.lathePut(normalizeBuffer(this.engine.ctx, buf), `RESAMPLE BARS ${a + 1}–${b}`, 'lathe');
      this.toast(`Dubbed bars ${a + 1}–${b} of the song onto the reel`);
    } catch (err) { console.error(err); this.toast('Resample failed: ' + err.message, true); }
    btn.disabled = false; btn.textContent = 'RESAMPLE SONG';
  }
  async latheRecord() {
    const btn = $('#lathe-record');
    const L = this.lathe;
    if (L.recorder) {
      L.recorder.stop();
      return;
    }
    await this.ensureAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        L.recorder = null;
        btn.textContent = 'RECORD MIC'; btn.classList.remove('is-on'); btn.setAttribute('aria-pressed', 'false');
        document.body.classList.remove('is-recording');
        try {
          const blob = new Blob(chunks, { type: rec.mimeType });
          const buf = await this.engine.ctx.decodeAudioData(await blob.arrayBuffer());
          this.lathePut(normalizeBuffer(this.engine.ctx, trimBuffer(this.engine.ctx, buf, 30)), 'MIC TAKE ' + new Date().toLocaleTimeString(), 'user');
        } catch (err) { this.toast('Could not decode the recording: ' + err.message, true); }
      };
      rec.start();
      L.recorder = rec;
      btn.textContent = 'STOP (REC)'; btn.classList.add('is-on'); btn.setAttribute('aria-pressed', 'true');
      document.body.classList.add('is-recording');
      setTimeout(() => { if (L.recorder === rec && rec.state === 'recording') rec.stop(); }, 30000);
    } catch (err) { this.toast('Microphone unavailable: ' + err.message, true); }
  }
  drawLathe() {
    const L = this.lathe;
    const cv = L.canvas;
    const r = cv.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(10, Math.floor(r.width)), h = Math.max(10, Math.floor(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px'; L.peaks = null; }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    if (!L.buffer) return;
    if (!L.peaks || L.peaks.length !== w) L.peaks = peaks(L.buffer, w);
    const MAG = '#ff2bd6', CYAN = '#19e6ff', CHROME = '#dbe2f4';
    const dur = L.buffer.duration;
    // slice bands alternate magenta/cyan washes
    L.slices.forEach((s, i) => {
      const x0 = (s.start / dur) * w, x1 = (s.end / dur) * w;
      c.fillStyle = i % 2 ? 'rgba(25,230,255,.10)' : 'rgba(255,43,214,.12)';
      c.fillRect(x0, 0, x1 - x0, h);
    });
    const mid = h / 2;
    c.fillStyle = CHROME;
    for (let x = 0; x < w; x++) { const p = L.peaks[x] * (h / 2 - 8); c.fillRect(x, mid - p, 1, Math.max(1, p * 2)); }
    L.slices.forEach((s, i) => {
      const x = Math.round((s.start / dur) * w);
      c.fillStyle = i === 0 ? 'rgba(219,226,244,.4)' : MAG;
      if (i) { c.shadowColor = MAG; c.shadowBlur = 8; }
      c.fillRect(x, 0, 2, h); c.shadowBlur = 0;
      c.fillStyle = i % 2 ? CYAN : MAG; c.fillRect(x + 3, 4, 26, 16);
      c.fillStyle = '#0a0514'; c.font = '700 10px Michroma, "Arial Narrow", sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'center';
      c.fillText(String(i + 1).padStart(2, '0'), x + 16, 12.5);
    });
  }

  // ---------- editor bus (shared between docked and detached) ----------
  makeBus() {
    const app = this;
    const listeners = new Set();
    return {
      getSong: () => app.song,
      dispatch: (op) => app.commit(op, false),
      audition: (deviceId, n, opts) => app.ensureAudio().then(() => app.engine.audition(deviceId, n, opts)),
      currentStep: () => app.engine.currentStep(),
      transportMode: () => app.engine.mode,
      on: (ev, fn) => { if (ev === 'song') listeners.add(fn); },
      emitSong: () => { for (const fn of listeners) fn(); },
      setMode: (mode, focus) => { app.engine.mode = mode; app.engine.patternFocus = focus; if (mode === 'pattern' && app.engine.playing) app.engine.step = app.engine.step % (findPattern(findDevice(app.song, focus.deviceId), focus.patId)?.steps || 32); app.drawSelector(findDevice(app.song, 'breaker')); },
      setLoop: (a, b) => { app.engine.loop = { on: true, startBar: a, endBar: b }; app.refreshTransport(); app.broadcast(); },
      getLoop: () => app.engine.loop,
      seekBar: (bar) => app.engine.seekBar(bar),
      seekStep: (step) => { const was = app.engine.playing; app.engine.stop(); app.engine.step = step; if (was) app.engine.play(); },
      detach: () => app.detachEditor(),
    };
  }
  openEditor(deviceId) {
    this.editor.focusDevice(deviceId);
    if (this.detachedWin && !this.detachedWin.closed) { this.detachedWin.focus(); this.send({ type: 'focus', deviceId }); }
    else this.editorRoot.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
  detachEditor() {
    if (this.detachedWin && !this.detachedWin.closed) { this.detachedWin.focus(); return; }
    const w = window.open('editor.html', 'noise-editor', 'width=1180,height=560,menubar=no,toolbar=no,location=no,status=no');
    if (!w) return this.toast('Your browser blocked the pop-up. Allow pop-ups for this site to detach the editor.', true);
    this.detachedWin = w;
    document.body.classList.add('is-detached');
    $('#editor-dock').hidden = false;
    $('#editor-dock button').onclick = () => { this.detachedWin?.close(); };
    const poll = setInterval(() => { if (!this.detachedWin || this.detachedWin.closed) { clearInterval(poll); this.onEditorReturn(); } }, 500);
  }
  onEditorReturn() {
    this.detachedWin = null;
    document.body.classList.remove('is-detached');
    $('#editor-dock').hidden = true;
    this.editor.syncFromSong();
  }
  send(msg) {
    const payload = { noise: 1, ...msg };
    if (this.channel) this.channel.postMessage(payload);
    else if (this.detachedWin && !this.detachedWin.closed) this.detachedWin.postMessage(payload, location.origin);
  }
  broadcast() {
    this.editorBus.emitSong();
    if (this.detachedWin && !this.detachedWin.closed) this.send({ type: 'song', song: this.songForWire(), loop: this.engine.loop, mode: this.engine.mode });
  }
  songForWire() {
    // strip AudioBuffers; the editor only needs slice counts
    return { ...this.song, devices: this.song.devices.map((d) => ({ ...d, audio: d.audio ? { name: d.audio.name, sliceCount: d.audio.slices?.length || 0, slices: d.audio.slices } : d.audio })) };
  }
  onChannel(msg) {
    switch (msg.type) {
      case 'hello': this.send({ type: 'song', song: this.songForWire(), loop: this.engine.loop, mode: this.engine.mode }); break;
      case 'op': this.commit(msg.op, true); break;
      case 'audition': this.ensureAudio().then(() => this.engine.audition(msg.deviceId, msg.n, msg.opts)); break;
      case 'mode': this.editorBus.setMode(msg.mode, msg.focus); this.editor.mode = msg.mode; this.editor.deviceId = msg.focus?.deviceId || this.editor.deviceId; this.editor.patId = msg.focus?.patId || this.editor.patId; break;
      case 'loop': this.editorBus.setLoop(msg.a, msg.b); break;
      case 'seekBar': this.engine.seekBar(msg.bar); break;
      case 'seekStep': this.editorBus.seekStep(msg.step); break;
      case 'return': this.detachedWin?.close(); break;
      case 'tick-request': break;
    }
  }

  // ---------- animation ----------
  tick() {
    requestAnimationFrame(() => this.tick());
    const step = this.engine.currentStep();
    if (this.engine.playing && step >= 0) {
      const mode = this.engine.mode;
      const bar = mode === 'song' ? Math.floor(step / STEPS_PER_BAR) + 1 : Math.floor(step / STEPS_PER_BAR) + 1;
      this.cBar.set(bar);
      this.cStep.set((step % STEPS_PER_BAR) + 1);
      if (step !== this.lastStep) {
        this.lastStep = step;
        this.pulseStep(step);
      }
      if (this.detachedWin && !this.detachedWin.closed && (this._lastSent !== step)) { this._lastSent = step; this.send({ type: 'step', step }); }
    } else if (!this.engine.playing && this.lastStep !== -1) {
      this.lastStep = -1;
      $$('.selector .sel.is-now', this.cabinet).forEach((b) => b.classList.remove('is-now'));
      if (this.detachedWin && !this.detachedWin.closed) this.send({ type: 'step', step: -1 });
    }
    const ebpm = this.engine.effectiveBpm();
    this.cBpm.set(Math.round(ebpm));
    if (this.tachNeedle) { const n = Math.max(0, Math.min(1, (ebpm - 60) / 140)); this.tachNeedle.setAttribute('transform', `rotate(${-90 + n * 180} 100 110)`); }
    // meters + scopes
    if (this.engine.ready) {
      const m = this.engine.master.meter();
      const lit = Math.round(Math.min(1, m.peak * 1.15) * this.vuBars.length);
      this.vuBars.forEach((b, i) => b.classList.toggle('is-lit', i < lit));
      this.cabinet.style.setProperty('--glow', (this.engine.playing ? 0.55 + Math.min(0.45, m.rms * 1.6) : 0.25).toFixed(3));
      this.drawScopes();
    }
    this.drawCarousel(step);
  }
  pulseStep(step) {
    const s = step % 16;
    const sel = this.breakerSel;
    if (sel) {
      $$('.sel.is-now', sel).forEach((b) => b.classList.remove('is-now'));
      const local = this.selectorLocalStep(step);
      if (local >= 0) {
        const page = Math.floor(local / 16);
        $$('.selector__page', sel).forEach((b) => b.classList.toggle('is-playing', +b.dataset.page === page));
        if (page === this.selPage) $$(`.sel[data-col="${local % 16}"]`, sel).forEach((b) => b.classList.add('is-now'));
      }
    }
    const lamp = $$('.device .lamp.is-armed', this.cabinet);
    if (s % 4 === 0) lamp.forEach((l) => { l.classList.add('is-beat'); setTimeout(() => l.classList.remove('is-beat'), 90); });
  }
  // the step inside the breaker's shown pattern that is sounding now, or -1
  selectorLocalStep(step) {
    const dev = findDevice(this.song, 'breaker');
    const pat = this.editorPatternFor(dev);
    if (!pat) return -1;
    if (this.engine.mode === 'pattern') return this.engine.patternFocus?.deviceId === dev.id && this.engine.patternFocus?.patId === pat.id ? step % pat.steps : -1;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const blk = (this.song.arrangement.tracks[dev.id] || []).find((b) => bar >= b.bar && bar < b.bar + b.bars);
    if (!blk || blk.pat !== pat.id) return -1;
    return ((bar - blk.bar) * STEPS_PER_BAR + (step % STEPS_PER_BAR)) % pat.steps;
  }
  drawScopes() {
    // Each scope keeps a "memory" of the last loud waveform and lets it fade, so an idle device
    // shows what it last said instead of a dead flat line.
    this._scopeMem = this._scopeMem || new Map();
    const draw = (key, canvas, data, color, mode) => {
      if (!canvas) return;
      const r = canvas.parentElement.getBoundingClientRect();
      const w = Math.floor(r.width), h = Math.floor(r.height);
      if (w < 4 || h < 4) return;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const c = canvas.getContext('2d');
      c.clearRect(0, 0, w, h);
      const n = data.length;
      let energy = 0; for (let i = 0; i < n; i++) energy += Math.abs(data[i] - 128);
      energy /= n * 128;
      let mem = this._scopeMem.get(key);
      if (!mem) { mem = { buf: new Float32Array(n), fade: 0 }; this._scopeMem.set(key, mem); }
      if (energy > 0.01) { for (let i = 0; i < n; i++) mem.buf[i] = (data[i] - 128) / 128; mem.fade = 1; }
      else mem.fade = Math.max(0.16, mem.fade * 0.985);
      const live = energy > 0.01;
      c.strokeStyle = color; c.lineWidth = 2; c.lineJoin = 'round';
      c.globalAlpha = live ? 1 : mem.fade;
      c.shadowColor = color; c.shadowBlur = live ? 10 : 4;
      c.beginPath();
      const gain = mode === 'nave' ? 2.2 : 1.3;
      for (let i = 0; i < n; i++) {
        const v = live ? (data[i] - 128) / 128 : mem.buf[i] * (0.4 + 0.6 * mem.fade);
        const x = (i / (n - 1)) * w;
        const y = h / 2 - Math.max(-1, Math.min(1, v * gain)) * (h / 2 - 8);
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
      c.shadowBlur = 0; c.globalAlpha = 1;
    };
    const cs = this._cs || (this._cs = getComputedStyle(document.documentElement));
    const mag = cs.getPropertyValue('--mag').trim() || '#ff2bd6', cyan = cs.getPropertyValue('--cyan').trim() || '#19e6ff';
    const h = this.engine.devices.get('hearse');
    if (h) { draw('hearse', this.hearseScope, h.scope(), mag); if (h.lastMidi != null && this.hearseNote.textContent !== noteName(h.lastMidi)) this.hearseNote.textContent = noteName(h.lastMidi); }
    const c = this.engine.devices.get('cathedral');
    if (c) { draw('cathedral', this.naveCanvas, c.scope(), cyan, 'nave'); if (this.bellCount.textContent !== String(c.rung || 0)) this.bellCount.textContent = String(c.rung || 0).padStart(4, '0'); }
    const p = this.engine.devices.get('preacher');
    if (p) {
      draw('preacher', this.mouthCanvas, p.scope(), mag);
      const v = p.params.vowel; this.vowelLbl.textContent = VOWEL_NAMES[Math.round(Math.max(0, Math.min(4, v)))];
    }
  }
  drawCarousel(step) {
    const cv = this.carouselCanvas;
    if (!cv) return;
    const dev = findDevice(this.song, 'carousel');
    const r = cv.parentElement.getBoundingClientRect();
    const w = Math.floor(r.width), h = Math.floor(r.height);
    if (w < 10 || h < 10) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const n = dev.audio?.slices?.length || 0;
    const inst = this.engine.devices.get(dev.id);
    const now = this.engine.ctx ? this.engine.ctx.currentTime : performance.now() / 1000;
    let active = -1;
    if (inst?.current && inst.current.until > now && inst._lastIdx != null) active = inst._lastIdx;
    const playing = this.engine.playing;
    const MAG = '#ff2bd6', CYAN = '#19e6ff', CHROME = '#dbe2f4', DIM = 'rgba(219,226,244,.18)';
    // cassette window: two reels; tape moves from the left hub to the right while playing
    this.tapePos = Math.max(0, Math.min(1, (this.tapePos ?? 0.32) + (playing ? 0.00035 * this.engine.pitchRatio : 0)));
    if (this.tapePos >= 1) this.tapePos = 0;
    this.reelAngle = (this.reelAngle || 0) + (playing ? 0.05 * this.engine.pitchRatio : 0.003) * (active >= 0 ? 2.2 : 1);
    const hubY = h * 0.5;
    const hubL = w * 0.28, hubR = w * 0.72;
    const rBase = Math.min(h * 0.24, w * 0.11);
    const drawReel = (x, fill) => {
      const rTape = rBase * (0.55 + fill * 0.45);
      c.fillStyle = '#12091f'; c.beginPath(); c.arc(x, hubY, rTape, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(255,43,214,.22)'; c.lineWidth = 1;
      for (let g = rBase * 0.5; g < rTape; g += 3) { c.beginPath(); c.arc(x, hubY, g, 0, Math.PI * 2); c.stroke(); }
      // hub with six spokes
      c.save(); c.translate(x, hubY); c.rotate(this.reelAngle);
      c.fillStyle = '#e8ecf8'; c.beginPath(); c.arc(0, 0, rBase * 0.5, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#0a0514';
      for (let k = 0; k < 6; k++) { c.rotate(Math.PI / 3); c.fillRect(-rBase * 0.06, rBase * 0.18, rBase * 0.12, rBase * 0.26); }
      c.beginPath(); c.arc(0, 0, rBase * 0.14, 0, Math.PI * 2); c.fill();
      c.restore();
    };
    drawReel(hubL, 1 - this.tapePos);
    drawReel(hubR, this.tapePos);
    // tape path across the bottom with a head in the middle
    c.strokeStyle = '#3a1d5c'; c.lineWidth = 3;
    const ty = h * 0.86;
    c.beginPath(); c.moveTo(hubL, hubY + rBase * 1.02); c.lineTo(w * 0.42, ty); c.lineTo(w * 0.58, ty); c.lineTo(hubR, hubY + rBase * 1.02); c.stroke();
    c.fillStyle = CHROME; c.fillRect(w * 0.5 - 9, ty - 8, 18, 12);
    c.fillStyle = active >= 0 ? MAG : '#3a1d5c'; c.fillRect(w * 0.5 - 3, ty - 3, 6, 4);
    // slice segments across the top: the tape's cut map; the firing slice lights magenta
    if (n) {
      const pad = 14, segW = (w - pad * 2) / n, y = 8, sh = 8;
      for (let i = 0; i < n; i++) {
        const x = pad + i * segW;
        c.fillStyle = i === active ? MAG : (i % 2 ? 'rgba(25,230,255,.35)' : 'rgba(25,230,255,.22)');
        c.fillRect(x + 1, y, segW - 2, sh);
        if (i === active) { c.shadowColor = MAG; c.shadowBlur = 12; c.fillRect(x + 1, y, segW - 2, sh); c.shadowBlur = 0; }
        c.fillStyle = i === active ? '#fff' : 'rgba(219,226,244,.7)'; c.font = `700 ${Math.max(9, Math.min(11, segW * 0.28))}px Michroma, "Arial Narrow", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'top';
        c.fillText(String(i + 1).padStart(2, '0'), x + segW / 2, y + sh + 3);
      }
    } else {
      c.fillStyle = 'rgba(219,226,244,.75)'; c.font = '700 13px Michroma, "Arial Narrow", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('NO TAPE IN THE DECK — CUT ONE IN THE CHOP SHOP', w / 2, 16);
    }
    // counter
    const cnt = String(Math.floor(this.tapePos * 999)).padStart(3, '0');
    c.fillStyle = '#05030c'; c.fillRect(w * 0.5 - 34, hubY - 14, 68, 28);
    c.strokeStyle = DIM; c.lineWidth = 1; c.strokeRect(w * 0.5 - 34, hubY - 14, 68, 28);
    c.fillStyle = CYAN; c.font = '700 17px Michroma, "Arial Narrow", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(cnt, w * 0.5, hubY + 1);
  }
  flash(btn) { btn.classList.add('is-hit'); setTimeout(() => btn.classList.remove('is-hit'), 120); }
  toast(msg, warn = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('is-warn', warn);
    t.classList.add('is-on');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove('is-on'), 3200);
  }
}

// carousel needs to know which slice index last fired
import { Carousel } from './synth.js';
const _orig = Carousel.prototype.noteOn;
Carousel.prototype.noteOn = function (t, sliceIndex, ...rest) {
  this._lastIdx = this.slices.length ? ((sliceIndex % this.slices.length) + this.slices.length) % this.slices.length : 0;
  return _orig.call(this, t, sliceIndex, ...rest);
};

window.noise = new App();
