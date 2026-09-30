// The block / piano-roll editor. Runs docked in the main window or detached in editor.html.
// Talks to the song only through `bus`: getSong(), dispatch(op), audition(), currentStep(), on().
import { DEVICE_TYPES, STEPS_PER_BAR, findDevice, findPattern } from './song.js';
import { noteName } from './synth.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class Editor {
  constructor(root, bus, opts = {}) {
    this.root = root;
    this.bus = bus;
    this.detached = !!opts.detached;
    this.mode = 'pattern';
    this.deviceId = 'breaker';
    this.patId = null;
    this.penLen = 1;
    this.penVel = 1;
    this.sel = null;          // {s, n} in pattern mode, block id in song mode
    this.scroll = { x: 0, y: 0 };
    this.cursor = { s: 0, row: 0 };
    this.drag = null;
    this.hover = null;
    this.lastStep = -1;
    this.build();
    this.bind();
    this.syncFromSong();
    this.resize();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.wrap);
  }

  // ---------- DOM ----------
  build() {
    this.root.classList.add('editor');
    this.root.innerHTML = `
      <div class="editor__bar">
        <div class="tabs" role="tablist" aria-label="Editor mode">
          <button class="tab is-on" role="tab" data-mode="pattern" aria-selected="true">PATTERN</button>
          <button class="tab" role="tab" data-mode="song" aria-selected="false">SONG</button>
        </div>
        <div class="editor__right">
          <button class="pb pb--small js-help" aria-haspopup="dialog">HOW</button>
          <button class="pb pb--small js-detach">${this.detached ? 'RETURN' : 'DETACH ⇗'}</button>
        </div>
        <div class="editor__ctl editor__ctl--pattern">
          <label class="strip-select"><span>DEVICE</span><select class="js-device" aria-label="Device"></select></label>
          <div class="patstrips" role="group" aria-label="Patterns"></div>
          <label class="strip-select"><span>STEPS</span><select class="js-steps" aria-label="Pattern length"><option>16</option><option selected>32</option><option>64</option></select></label>
          <label class="strip-select"><span>PEN</span><select class="js-pen" aria-label="Pen length in steps"><option value="1">1/16</option><option value="2">1/8</option><option value="4">1/4</option><option value="8">1/2</option><option value="16">BAR</option></select></label>
          <button class="pb pb--small js-clear" title="Clear all notes in this pattern">CLEAR</button>
          <div class="notetools" hidden>
            <span class="notetools__lbl js-nt-lbl"></span>
            <button class="pb pb--small js-nt-flag" aria-pressed="false" hidden>SLIDE</button>
            <button class="pb pb--small js-nt-tune" data-dir="-1" hidden aria-label="Tune lane down">TUNE −</button>
            <button class="pb pb--small js-nt-tune" data-dir="1" hidden aria-label="Tune lane up">TUNE +</button>
            <button class="pb pb--small js-nt-del" hidden>DELETE</button>
          </div>
        </div>
        <div class="editor__ctl editor__ctl--song" hidden>
          <label class="strip-select"><span>BARS</span><select class="js-bars" aria-label="Song length in bars">${[4, 8, 12, 16, 24, 32, 48, 64].map((b) => `<option>${b}</option>`).join('')}</select></label>
          <span class="editor__hint">Drag on empty space to lay a block · double-click a block to change its pattern · drag the ruler to loop</span>
        </div>
      </div>
      <div class="editor__wrap">
        <canvas class="editor__canvas" tabindex="0" role="application" aria-label="Note grid. Arrow keys move, Enter toggles a note, Delete removes, plus and minus change length."></canvas>
      </div>
      <div class="editor__help" hidden role="dialog" aria-label="Editor help">
        <div class="help__strip">
          <b>PATTERN</b> Click a cell to write a note, click a note to select, click again or press Delete to remove. Drag a note to move it, drag its right edge to stretch it. Alt-drag up/down for velocity, or drag in the velocity lane. Shift-click toggles <i>slide</i> on HEARSE notes and <i>reverse</i> on CAROUSEL slices. Keyboard: arrows move the cursor, Enter writes or removes, + / − change length.<br>
          <b>SONG</b> Rows are devices, columns are bars. Drag on empty space to lay a block, drag a block to move it, drag its right edge to stretch, double-click to cycle its pattern, Delete to remove. Drag along the bar ruler to set a loop; click the ruler to jump there.
          <button class="pb pb--small js-help-close">CLOSE</button>
        </div>
      </div>`;
    this.canvas = this.root.querySelector('canvas');
    this.ctx2d = this.canvas.getContext('2d');
    this.wrap = this.root.querySelector('.editor__wrap');
    this.deviceSel = this.root.querySelector('.js-device');
    this.patStrips = this.root.querySelector('.patstrips');
    this.stepsSel = this.root.querySelector('.js-steps');
    this.penSel = this.root.querySelector('.js-pen');
    this.barsSel = this.root.querySelector('.js-bars');
    this.help = this.root.querySelector('.editor__help');
    this.ctlPattern = this.root.querySelector('.editor__ctl--pattern');
    this.ctlSong = this.root.querySelector('.editor__ctl--song');
    this.nt = { box: this.root.querySelector('.notetools'), lbl: this.root.querySelector('.js-nt-lbl'), flag: this.root.querySelector('.js-nt-flag'), tune: [...this.root.querySelectorAll('.js-nt-tune')], del: this.root.querySelector('.js-nt-del') };
  }
  // touch-friendly equivalents of shift-click (slide/reverse) and right-click (tune)
  selectedNote() {
    const pat = this.pattern();
    if (!pat) return null;
    if (this.sel && typeof this.sel === 'object') return pat.notes.find((x) => x.s === this.sel.s && x.n === this.sel.n) || null;
    return null;
  }
  updateNoteTools() {
    const nt = this.nt;
    if (!nt) return;
    const dev = this.device();
    const T = DEVICE_TYPES[dev.type];
    const inPattern = this.mode === 'pattern';
    nt.box.hidden = !inPattern;
    if (!inPattern) return;
    const note = this.selectedNote();
    const row = this.geom?.rows[this.cursor.row];
    if (T.kind === 'drums') {
      const lane = note ? note.n : row?.n ?? 0;
      const t = (dev.params.tune || [])[lane] || 0;
      nt.lbl.textContent = `${T.lanes[lane]} · ${t > 0 ? '+' : ''}${t} st`;
      nt.tune.forEach((b) => { b.hidden = false; });
      nt.flag.hidden = true;
      nt.del.hidden = !note;
      return;
    }
    nt.tune.forEach((b) => { b.hidden = true; });
    if (!note) { nt.lbl.textContent = 'TAP A NOTE'; nt.flag.hidden = true; nt.del.hidden = true; return; }
    nt.lbl.textContent = T.kind === 'slices' ? `SLICE ${String(note.n + 1).padStart(2, '0')} · STEP ${note.s + 1}` : `${noteName(note.n)} · STEP ${note.s + 1}`;
    const flagKey = dev.type === 'hearse' ? 'g' : dev.type === 'carousel' ? 'r' : null;
    nt.flag.hidden = !flagKey;
    if (flagKey) { nt.flag.textContent = flagKey === 'g' ? 'SLIDE' : 'REVERSE'; nt.flag.setAttribute('aria-pressed', !!note[flagKey]); nt.flag.classList.toggle('is-on', !!note[flagKey]); }
    nt.del.hidden = false;
  }

  bind() {
    this.root.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => this.setMode(t.dataset.mode)));
    this.deviceSel.addEventListener('change', () => { this.deviceId = this.deviceSel.value; this.patId = null; this.sel = null; this.scroll.y = 0; this.syncFromSong(); this.focusPattern(); });
    this.stepsSel.addEventListener('change', () => this.bus.dispatch({ type: 'setPatternSteps', deviceId: this.deviceId, patId: this.patId, steps: +this.stepsSel.value }));
    this.penSel.addEventListener('change', () => { this.penLen = +this.penSel.value; });
    this.barsSel.addEventListener('change', () => this.bus.dispatch({ type: 'setBars', bars: +this.barsSel.value }));
    this.root.querySelector('.js-clear').addEventListener('click', () => {
      if (confirm('Clear every note in this pattern?')) this.bus.dispatch({ type: 'clearPattern', deviceId: this.deviceId, patId: this.patId });
    });
    this.root.querySelector('.js-help').addEventListener('click', () => { this.help.hidden = !this.help.hidden; });
    this.root.querySelector('.js-help-close').addEventListener('click', () => { this.help.hidden = true; });
    this.root.querySelector('.js-detach').addEventListener('click', () => this.bus.detach?.());
    this.nt.flag.addEventListener('click', () => {
      const note = this.selectedNote(); const dev = this.device();
      const flag = dev.type === 'hearse' ? 'g' : dev.type === 'carousel' ? 'r' : null;
      if (!note || !flag) return;
      this.bus.dispatch({ type: 'updateNote', deviceId: this.deviceId, patId: this.patId, s: note.s, n: note.n, changes: { [flag]: note[flag] ? 0 : 1 } });
      this.updateNoteTools();
    });
    this.nt.tune.forEach((b) => b.addEventListener('click', () => {
      const dev = this.device(); if (DEVICE_TYPES[dev.type].kind !== 'drums') return;
      const note = this.selectedNote(); const lane = note ? note.n : this.geom.rows[this.cursor.row]?.n ?? 0;
      const tune = [...(dev.params.tune || [0, 0, 0, 0, 0, 0, 0, 0])];
      tune[lane] = Math.max(-12, Math.min(12, tune[lane] + (+b.dataset.dir)));
      this.bus.dispatch({ type: 'setParam', deviceId: this.deviceId, param: 'tune', value: tune });
      this.bus.audition(this.deviceId, lane);
      this.updateNoteTools();
    }));
    this.nt.del.addEventListener('click', () => {
      const note = this.selectedNote(); if (!note) return;
      this.bus.dispatch({ type: 'removeNote', deviceId: this.deviceId, patId: this.patId, s: note.s, n: note.n });
      this.sel = null; this.updateNoteTools();
    });
    this.patStrips.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'add') this.bus.dispatch({ type: 'addPattern', deviceId: this.deviceId, copyFrom: e.shiftKey ? this.patId : null });
      else if (b.dataset.act === 'del') { if (confirm('Remove this pattern? Blocks using it fall back to the first pattern.')) this.bus.dispatch({ type: 'removePattern', deviceId: this.deviceId, patId: this.patId }); }
      else if (b.dataset.pat) {
        if (b.dataset.pat === this.patId && e.detail === 2) {
          const name = prompt('Pattern name', b.textContent.trim());
          if (name) this.bus.dispatch({ type: 'renamePattern', deviceId: this.deviceId, patId: this.patId, name });
        } else { this.patId = b.dataset.pat; this.sel = null; this.syncFromSong(); this.focusPattern(); }
      }
    });
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointerup', () => this.updateNoteTools());
    c.addEventListener('keyup', () => this.updateNoteTools());
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('dblclick', (e) => this.onDbl(e));
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onContext(e); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.shiftKey) this.scroll.x += e.deltaY; else { this.scroll.x += e.deltaX; this.scroll.y += e.deltaY; }
      this.clampScroll();
    }, { passive: false });
    c.addEventListener('keydown', (e) => this.onKey(e));
    this.bus.on('song', () => { this.syncFromSong(); this.updateNoteTools(); });
  }

  setMode(m) {
    this.mode = m;
    this.sel = null;
    this.root.querySelectorAll('.tab').forEach((t) => { const on = t.dataset.mode === m; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', on); });
    this.ctlPattern.hidden = m !== 'pattern';
    this.ctlSong.hidden = m !== 'song';
    this.scroll = { x: 0, y: 0 };
    this.bus.setMode?.(m, m === 'pattern' ? { deviceId: this.deviceId, patId: this.patId } : null);
    this.syncFromSong();
  }
  focusPattern() { this.bus.setMode?.(this.mode, this.mode === 'pattern' ? { deviceId: this.deviceId, patId: this.patId } : null); }
  focusDevice(deviceId, patId) {
    this.deviceId = deviceId;
    this.patId = patId || null;
    this.sel = null;
    this.scroll.y = 0;
    if (this.mode !== 'pattern') this.setMode('pattern'); else { this.syncFromSong(); this.focusPattern(); }
  }

  // ---------- model access ----------
  song() { return this.bus.getSong(); }
  device() { return findDevice(this.song(), this.deviceId) || this.song().devices[0]; }
  pattern() {
    const dev = this.device();
    if (!dev) return null;
    let p = this.patId && findPattern(dev, this.patId);
    if (!p) { p = dev.patterns[0]; this.patId = p?.id || null; }
    return p;
  }
  rows() {
    const dev = this.device();
    const T = DEVICE_TYPES[dev.type];
    if (T.kind === 'drums') return T.lanes.map((name, i) => ({ n: i, label: name }));
    if (T.kind === 'slices') {
      const count = Math.max(1, dev.audio?.slices?.length || dev.audio?.sliceCount || 8);
      return Array.from({ length: count }, (_, i) => ({ n: count - 1 - i, label: 'SLICE ' + String(count - i).padStart(2, '0') }));
    }
    const out = [];
    for (let m = T.rows.high; m >= T.rows.low; m--) out.push({ n: m, label: noteName(m), black: [1, 3, 6, 8, 10].includes(m % 12) });
    return out;
  }

  syncFromSong() {
    const song = this.song();
    if (!song) return;
    // device select
    const cur = this.deviceSel.value;
    this.deviceSel.innerHTML = song.devices.map((d) => `<option value="${d.id}">${DEVICE_TYPES[d.type].name}</option>`).join('');
    if (!findDevice(song, this.deviceId)) this.deviceId = song.devices[0].id;
    this.deviceSel.value = this.deviceId;
    const dev = this.device();
    const pat = this.pattern();
    this.patStrips.innerHTML = dev.patterns.map((p) => `<button class="strip-btn ${p.id === pat?.id ? 'is-on' : ''}" data-pat="${p.id}" aria-pressed="${p.id === pat?.id}">${p.name}</button>`).join('') +
      `<button class="strip-btn strip-btn--ghost" data-act="add" title="Add pattern (shift: duplicate current)">+</button>` +
      (dev.patterns.length > 1 ? `<button class="strip-btn strip-btn--ghost" data-act="del" title="Remove pattern">×</button>` : '');
    if (pat) this.stepsSel.value = String(pat.steps);
    this.barsSel.value = String(song.arrangement.bars);
    if (![...this.barsSel.options].some((o) => o.value === String(song.arrangement.bars))) {
      const o = document.createElement('option'); o.textContent = song.arrangement.bars; this.barsSel.appendChild(o); this.barsSel.value = String(song.arrangement.bars);
    }
    if (cur !== this.deviceId) this.scroll.y = 0;
    this.resize();
    this.updateNoteTools();
  }

  // ---------- geometry ----------
  resize() {
    const r = this.wrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(200, Math.floor(r.width));
    this.h = Math.max(120, Math.floor(r.height));
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.geom = this.computeGeom();
    this.clampScroll();
  }
  computeGeom() {
    const touch = matchMedia('(pointer: coarse)').matches || this.w < 700;
    const labelW = this.mode === 'pattern' ? (touch ? 76 : 100) : (touch ? 96 : 132);
    const rulerH = 22;
    if (this.mode === 'pattern') {
      const pat = this.pattern();
      const steps = pat?.steps || 32;
      const rows = this.rows();
      const dev = this.device();
      const kind = DEVICE_TYPES[dev.type].kind;
      const velH = 46;
      const availW = this.w - labelW;
      const sb = touch ? 18 : 12;
      const cellW = Math.max(touch ? 34 : (kind === 'drums' ? 22 : 16), Math.floor(availW / steps));
      const hbar = cellW * steps > availW ? sb : 0;
      const availH = this.h - rulerH - velH - hbar;
      const rowH = kind === 'drums' ? Math.max(touch ? 36 : 22, Math.floor(availH / rows.length)) : (kind === 'slices' ? Math.max(touch ? 34 : 20, Math.min(30, Math.floor(availH / rows.length))) : (touch ? 28 : 18));
      return { labelW, rulerH, velH, cellW, rowH, steps, rows, kind, touch, sb, hbar, gridW: cellW * steps, gridH: rowH * rows.length, viewW: availW, viewH: availH };
    }
    const song = this.song();
    const bars = Math.max(song.arrangement.bars + 2, 8);
    const rows = song.devices.map((d) => ({ id: d.id, label: DEVICE_TYPES[d.type].name, color: DEVICE_TYPES[d.type].color, dev: d }));
    const availW = this.w - labelW;
    const sb = touch ? 18 : 12;
    const cellW = Math.max(touch ? 44 : 30, Math.floor(availW / bars));
    const hbar = cellW * bars > availW ? sb : 0;
    const availH = this.h - rulerH - hbar;
    const rowH = Math.max(touch ? 48 : 34, Math.floor(availH / rows.length));
    return { labelW, rulerH, velH: 0, cellW, rowH, bars, rows, touch, sb, hbar, gridW: cellW * bars, gridH: rowH * rows.length, viewW: availW, viewH: availH };
  }
  clampScroll() {
    const g = this.geom;
    if (!g) return;
    this.scroll.x = Math.max(0, Math.min(Math.max(0, g.gridW - g.viewW), this.scroll.x));
    this.scroll.y = Math.max(0, Math.min(Math.max(0, g.gridH - g.viewH), this.scroll.y));
  }
  hit(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const g = this.geom;
    const inRuler = y < g.rulerH && x >= g.labelW;
    const inLabels = x < g.labelW && y >= g.rulerH;
    const gx = x - g.labelW + this.scroll.x, gy = y - g.rulerH + this.scroll.y;
    const inVel = this.mode === 'pattern' && y >= this.h - g.velH && x >= g.labelW;
    const col = Math.floor(gx / g.cellW);
    const row = Math.floor(gy / g.rowH);
    const sb = g.sb;
    const gridBottom = g.rulerH + g.viewH;
    const inVScroll = g.gridH > g.viewH && x >= this.w - sb && y >= g.rulerH && y < gridBottom;
    const inHScroll = g.hbar > 0 && y >= gridBottom && y < gridBottom + g.hbar && x >= g.labelW && !inVScroll;
    const inGrid = !inVScroll && !inHScroll && x >= g.labelW && y >= g.rulerH && !inVel && col >= 0 && row >= 0 && row < g.rows.length && col < (this.mode === 'pattern' ? g.steps : g.bars);
    return { x, y, gx, gy, col, row, inRuler, inLabels, inVel, inGrid, inVScroll, inHScroll, fracX: (gx % g.cellW) / g.cellW };
  }
  noteAt(col, rowIdx) {
    const pat = this.pattern();
    const rowN = this.geom.rows[rowIdx]?.n;
    return pat?.notes.find((n) => n.n === rowN && col >= n.s && col < n.s + n.l) || null;
  }
  blockAt(col, rowIdx) {
    const song = this.song();
    const dev = this.geom.rows[rowIdx]?.dev;
    if (!dev) return null;
    return (song.arrangement.tracks[dev.id] || []).find((b) => col >= b.bar && col < b.bar + b.bars) || null;
  }

  // ---------- pointer ----------
  onDown(e) {
    if (e.button === 2) return;
    this.canvas.focus({ preventScroll: true });
    const h = this.hit(e);
    const g = this.geom;
    this.canvas.setPointerCapture(e.pointerId);
    if (h.inVScroll || h.inHScroll) {
      this.drag = { kind: h.inVScroll ? 'vscroll' : 'hscroll', startX: h.x, startY: h.y, sx: this.scroll.x, sy: this.scroll.y };
      return;
    }
    if (h.inRuler) {
      const col = Math.floor((h.x - g.labelW + this.scroll.x) / g.cellW);
      if (this.mode === 'song') this.drag = { kind: 'loop', start: col, end: col, moved: false };
      else this.drag = { kind: 'seek', col };
      return;
    }
    if (h.inLabels) {
      const row = g.rows[h.row];
      if (row && this.mode === 'pattern') this.bus.audition(this.deviceId, row.n, { len: 2 });
      return;
    }
    if (h.inVel && this.mode === 'pattern') {
      this.drag = { kind: 'vel' };
      this.velAt(h);
      return;
    }
    if (!h.inGrid) return;
    if (this.mode === 'pattern') {
      const note = this.noteAt(h.col, h.row);
      const row = g.rows[h.row];
      if (note) {
        if (e.shiftKey) {
          const dev = this.device();
          const flag = dev.type === 'hearse' ? 'g' : dev.type === 'carousel' ? 'r' : null;
          if (flag) this.bus.dispatch({ type: 'updateNote', deviceId: this.deviceId, patId: this.patId, s: note.s, n: note.n, changes: { [flag]: note[flag] ? 0 : 1 } });
          return;
        }
        const wasSel = this.sel && this.sel.s === note.s && this.sel.n === note.n;
        this.sel = { s: note.s, n: note.n };
        const edge = h.fracX > 0.65 && h.col === note.s + note.l - 1;
        this.drag = { kind: e.altKey ? 'notevel' : edge ? 'resize' : 'move', note: { ...note }, startCol: h.col, startRow: h.row, startY: h.y, wasSel, moved: false };
      } else {
        const len = g.kind === 'drums' ? 1 : this.penLen;
        this.bus.dispatch({ type: 'addNote', deviceId: this.deviceId, patId: this.patId, note: { s: h.col, n: row.n, l: Math.min(len, g.steps - h.col), v: this.penVel } });
        this.bus.audition(this.deviceId, row.n, { len, v: this.penVel });
        this.sel = { s: h.col, n: row.n };
        this.drag = { kind: 'paint', row: h.row, last: h.col, len };
      }
    } else {
      const blk = this.blockAt(h.col, h.row);
      const row = g.rows[h.row];
      if (blk) {
        this.sel = blk.id;
        const edge = h.fracX > 0.6 && h.col === blk.bar + blk.bars - 1;
        this.drag = { kind: edge ? 'bresize' : 'bmove', block: { ...blk }, deviceId: row.dev.id, startCol: h.col, startRow: h.row, moved: false };
      } else {
        this.sel = null;
        this.drag = { kind: 'lay', row: h.row, start: h.col, end: h.col, deviceId: row.dev.id };
      }
    }
  }
  onMove(e) {
    const h = this.hit(e);
    this.hover = h;
    const g = this.geom;
    const d = this.drag;
    if (!d) {
      // cursor affordance
      let cur = 'default';
      if (h.inGrid) {
        if (this.mode === 'pattern') { const n = this.noteAt(h.col, h.row); cur = n ? (h.fracX > 0.65 && h.col === n.s + n.l - 1 ? 'ew-resize' : 'grab') : 'cell'; }
        else { const b = this.blockAt(h.col, h.row); cur = b ? (h.fracX > 0.6 && h.col === b.bar + b.bars - 1 ? 'ew-resize' : 'grab') : 'cell'; }
      } else if (h.inRuler) cur = 'pointer';
      else if (h.inVel) cur = 'ns-resize';
      else if (h.inLabels) cur = 'pointer';
      this.canvas.style.cursor = cur;
      return;
    }
    switch (d.kind) {
      case 'vscroll': this.scroll.y = d.sy + (h.y - d.startY) * (g.gridH / g.viewH); this.clampScroll(); break;
      case 'hscroll': this.scroll.x = d.sx + (h.x - d.startX) * (g.gridW / g.viewW); this.clampScroll(); break;
      case 'paint': {
        if (g.kind !== 'drums' || !h.inGrid || h.row !== d.row) return;
        if (h.col !== d.last) {
          d.last = h.col;
          const row = g.rows[d.row];
          if (!this.noteAt(h.col, d.row)) this.bus.dispatch({ type: 'addNote', deviceId: this.deviceId, patId: this.patId, note: { s: h.col, n: row.n, l: 1, v: this.penVel } });
        }
        break;
      }
      case 'move': {
        const dc = h.col - d.startCol, dr = h.row - d.startRow;
        if (!dc && !dr) return;
        d.moved = true;
        const rowIdx = Math.max(0, Math.min(g.rows.length - 1, d.startRow + dr));
        const rowN = g.rows[rowIdx].n;
        const s = Math.max(0, Math.min(g.steps - d.note.l, d.note.s + dc));
        if (s !== d.cur?.s || rowN !== d.cur?.n) {
          d.cur = { s, n: rowN };
          this.preview = { note: { ...d.note, s, n: rowN } };
        }
        break;
      }
      case 'resize': {
        const l = Math.max(1, Math.min(g.steps - d.note.s, h.col - d.note.s + 1));
        d.moved = true;
        this.preview = { note: { ...d.note, l } };
        d.cur = { l };
        break;
      }
      case 'notevel': {
        const dv = (d.startY - h.y) / 80;
        d.moved = true;
        const v = Math.max(0.05, Math.min(1, d.note.v + dv));
        this.preview = { note: { ...d.note, v } };
        d.cur = { v };
        break;
      }
      case 'vel': this.velAt(h); break;
      case 'loop': d.end = Math.max(0, Math.floor((h.x - g.labelW + this.scroll.x) / g.cellW)); d.moved = d.moved || d.end !== d.start; break;
      case 'lay': d.end = Math.max(0, Math.min(g.bars - 1, h.col)); break;
      case 'bmove': {
        const dc = h.col - d.startCol, dr = h.row - d.startRow;
        if (!dc && !dr) return;
        d.moved = true;
        const rowIdx = Math.max(0, Math.min(g.rows.length - 1, d.startRow + dr));
        d.cur = { bar: Math.max(0, d.block.bar + dc), deviceId: g.rows[rowIdx].dev.id, rowIdx };
        this.preview = { block: { ...d.block, bar: d.cur.bar }, rowIdx };
        break;
      }
      case 'bresize': {
        d.moved = true;
        const bars = Math.max(1, h.col - d.block.bar + 1);
        d.cur = { bars };
        this.preview = { block: { ...d.block, bars }, rowIdx: d.startRow };
        break;
      }
    }
  }
  onUp(e) {
    const d = this.drag;
    this.drag = null;
    this.preview = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    if (!d) return;
    const g = this.geom;
    switch (d.kind) {
      case 'seek': this.bus.seekStep?.(d.col); break;
      case 'move':
        if (d.moved && d.cur) this.bus.dispatch({ type: 'updateNote', deviceId: this.deviceId, patId: this.patId, s: d.note.s, n: d.note.n, changes: { s: d.cur.s, n: d.cur.n } }), this.sel = { s: d.cur.s, n: d.cur.n };
        else if (!d.moved && d.wasSel) this.bus.dispatch({ type: 'removeNote', deviceId: this.deviceId, patId: this.patId, s: d.note.s, n: d.note.n }), this.sel = null;
        else if (!d.moved) this.bus.audition(this.deviceId, d.note.n, { len: d.note.l, v: d.note.v, g: d.note.g, r: d.note.r });
        break;
      case 'resize': if (d.cur) this.bus.dispatch({ type: 'updateNote', deviceId: this.deviceId, patId: this.patId, s: d.note.s, n: d.note.n, changes: { l: d.cur.l } }); break;
      case 'notevel': if (d.cur) this.bus.dispatch({ type: 'updateNote', deviceId: this.deviceId, patId: this.patId, s: d.note.s, n: d.note.n, changes: { v: d.cur.v } }); break;
      case 'loop': {
        if (d.moved) { const a = Math.min(d.start, d.end), b = Math.max(d.start, d.end) + 1; this.bus.setLoop?.(a, b); }
        else this.bus.seekBar?.(d.start);
        break;
      }
      case 'lay': {
        const a = Math.min(d.start, d.end), b = Math.max(d.start, d.end);
        const dev = findDevice(this.song(), d.deviceId);
        const pat = (d.deviceId === this.deviceId && this.patId) ? this.patId : dev.patterns[0].id;
        this.bus.dispatch({ type: 'addBlock', deviceId: d.deviceId, block: { bar: a, bars: b - a + 1, pat } });
        break;
      }
      case 'bmove':
        if (d.moved && d.cur) {
          if (d.cur.deviceId === d.deviceId) this.bus.dispatch({ type: 'updateBlock', deviceId: d.deviceId, id: d.block.id, changes: { bar: d.cur.bar } });
          else {
            // moving across devices: re-lay with the target device's first pattern
            const target = findDevice(this.song(), d.cur.deviceId);
            this.bus.dispatch({ type: 'removeBlock', deviceId: d.deviceId, id: d.block.id });
            this.bus.dispatch({ type: 'addBlock', deviceId: d.cur.deviceId, block: { bar: d.cur.bar, bars: d.block.bars, pat: target.patterns[0].id } });
          }
        }
        break;
      case 'bresize': if (d.cur) this.bus.dispatch({ type: 'updateBlock', deviceId: d.deviceId, id: d.block.id, changes: { bars: d.cur.bars } }); break;
    }
  }
  onDbl(e) {
    const h = this.hit(e);
    if (this.mode === 'song' && h.inGrid) {
      const blk = this.blockAt(h.col, h.row);
      if (!blk) return;
      const dev = this.geom.rows[h.row].dev;
      const i = dev.patterns.findIndex((p) => p.id === blk.pat);
      const next = dev.patterns[(i + 1) % dev.patterns.length];
      this.bus.dispatch({ type: 'updateBlock', deviceId: dev.id, id: blk.id, changes: { pat: next.id } });
    }
    if (this.mode === 'song' && h.inLabels) {
      const dev = this.geom.rows[h.row]?.dev;
      if (dev) this.focusDevice(dev.id);
    }
  }
  onContext(e) {
    const h = this.hit(e);
    if (!h.inGrid) return;
    if (this.mode === 'pattern') {
      const n = this.noteAt(h.col, h.row);
      if (n) this.bus.dispatch({ type: 'removeNote', deviceId: this.deviceId, patId: this.patId, s: n.s, n: n.n });
    } else {
      const b = this.blockAt(h.col, h.row);
      if (b) this.bus.dispatch({ type: 'removeBlock', deviceId: this.geom.rows[h.row].dev.id, id: b.id });
    }
  }
  velAt(h) {
    const g = this.geom;
    const col = Math.floor((h.x - g.labelW + this.scroll.x) / g.cellW);
    const v = Math.max(0.05, Math.min(1, (this.h - h.y) / g.velH));
    const pat = this.pattern();
    for (const n of pat.notes) if (n.s === col) this.bus.dispatch({ type: 'updateNote', deviceId: this.deviceId, patId: this.patId, s: n.s, n: n.n, changes: { v } });
  }
  onKey(e) {
    const g = this.geom;
    const max = this.mode === 'pattern' ? g.steps : g.bars;
    const k = e.key;
    if (k === 'ArrowLeft') this.cursor.s = Math.max(0, this.cursor.s - 1);
    else if (k === 'ArrowRight') this.cursor.s = Math.min(max - 1, this.cursor.s + 1);
    else if (k === 'ArrowUp') this.cursor.row = Math.max(0, this.cursor.row - 1);
    else if (k === 'ArrowDown') this.cursor.row = Math.min(g.rows.length - 1, this.cursor.row + 1);
    else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      if (this.mode === 'pattern') {
        const n = this.noteAt(this.cursor.s, this.cursor.row);
        const row = g.rows[this.cursor.row];
        if (n) this.bus.dispatch({ type: 'removeNote', deviceId: this.deviceId, patId: this.patId, s: n.s, n: n.n });
        else { this.bus.dispatch({ type: 'addNote', deviceId: this.deviceId, patId: this.patId, note: { s: this.cursor.s, n: row.n, l: g.kind === 'drums' ? 1 : this.penLen, v: this.penVel } }); this.bus.audition(this.deviceId, row.n, { len: this.penLen }); }
      } else {
        const b = this.blockAt(this.cursor.s, this.cursor.row);
        const dev = g.rows[this.cursor.row].dev;
        if (b) this.bus.dispatch({ type: 'removeBlock', deviceId: dev.id, id: b.id });
        else this.bus.dispatch({ type: 'addBlock', deviceId: dev.id, block: { bar: this.cursor.s, bars: 1, pat: dev.patterns[0].id } });
      }
      return;
    } else if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      if (this.mode === 'pattern') {
        const n = this.sel ? this.pattern().notes.find((x) => x.s === this.sel.s && x.n === this.sel.n) : this.noteAt(this.cursor.s, this.cursor.row);
        if (n) { this.bus.dispatch({ type: 'removeNote', deviceId: this.deviceId, patId: this.patId, s: n.s, n: n.n }); this.sel = null; }
      } else if (this.sel) {
        for (const r of g.rows) { const b = (this.song().arrangement.tracks[r.dev.id] || []).find((x) => x.id === this.sel); if (b) { this.bus.dispatch({ type: 'removeBlock', deviceId: r.dev.id, id: b.id }); break; } }
        this.sel = null;
      }
      return;
    } else if (k === '+' || k === '=' || k === '-' || k === '_') {
      e.preventDefault();
      const dir = (k === '+' || k === '=') ? 1 : -1;
      if (this.mode === 'pattern') {
        const n = this.sel ? this.pattern().notes.find((x) => x.s === this.sel.s && x.n === this.sel.n) : this.noteAt(this.cursor.s, this.cursor.row);
        if (n) this.bus.dispatch({ type: 'updateNote', deviceId: this.deviceId, patId: this.patId, s: n.s, n: n.n, changes: { l: n.l + dir } });
      }
      return;
    } else if (k === 'Escape') { this.sel = null; return; }
    else return;
    e.preventDefault();
    // keep cursor visible
    const cx = this.cursor.s * g.cellW, cy = this.cursor.row * g.rowH;
    if (cx < this.scroll.x) this.scroll.x = cx;
    if (cx + g.cellW > this.scroll.x + g.viewW) this.scroll.x = cx + g.cellW - g.viewW;
    if (cy < this.scroll.y) this.scroll.y = cy;
    if (cy + g.rowH > this.scroll.y + g.viewH) this.scroll.y = cy + g.rowH - g.viewH;
    this.clampScroll();
  }

  // ---------- drawing ----------
  loop() {
    if (!this.root.isConnected) return;
    if (!this.root.hidden && this.wrap.offsetParent !== null) this.draw();
    requestAnimationFrame(this.loop);
  }
  colors() {
    if (this._colors) return this._colors;
    this._colors = {
      // synthwave: lacquer = night ground, cream = chrome key face, bulb = laser magenta, blue = cyan accent
      lacquer: css('--night') || '#0a0514', panel: css('--panel') || '#150c2a', cream: css('--chrome') || '#dbe2f4',
      red: css('--mag-deep') || '#a5127f', blue: css('--cyan') || '#19e6ff', bulb: css('--mag') || '#ff2bd6',
      chrome: '#8b94ad', ink: '#1a1230', dim: 'rgba(25,230,255,.14)', dim2: 'rgba(219,226,244,.06)',
    };
    return this._colors;
  }
  draw() {
    const c = this.ctx2d, g = this.geom, C = this.colors();
    if (!g) return;
    const song = this.song();
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = C.lacquer;
    c.fillRect(0, 0, this.w, this.h);
    const step = this.bus.currentStep?.() ?? -1;
    if (this.mode === 'pattern') this.drawPattern(c, g, C, song, step); else this.drawSong(c, g, C, song, step);
    this.drawScrollbars(c, g, C);
    // focus ring on cursor when canvas focused
    if (document.activeElement === this.canvas) {
      const x = g.labelW + this.cursor.s * g.cellW - this.scroll.x, y = g.rulerH + this.cursor.row * g.rowH - this.scroll.y;
      c.save(); c.beginPath(); c.rect(g.labelW, g.rulerH, g.viewW, g.viewH); c.clip();
      c.strokeStyle = C.bulb; c.lineWidth = 2; c.setLineDash([3, 3]);
      c.strokeRect(x + 1, y + 1, g.cellW - 2, g.rowH - 2);
      c.restore();
    }
  }
  drawScrollbars(c, g, C) {
    const sb = g.sb, pad = 3;
    const gridBottom = g.rulerH + g.viewH;
    if (g.hbar > 0) {
      const trackX = g.labelW, trackW = g.viewW - (g.gridH > g.viewH ? sb : 0);
      const thumbW = Math.max(28, trackW * (g.viewW / g.gridW));
      const thumbX = trackX + (this.scroll.x / (g.gridW - g.viewW)) * (trackW - thumbW);
      c.fillStyle = C.panel; c.fillRect(0, gridBottom, this.w, g.hbar);
      c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(trackX, gridBottom + 1, trackW, g.hbar - 2);
      c.fillStyle = '#8a8985'; roundRect(c, thumbX, gridBottom + pad, thumbW, g.hbar - pad * 2, 3); c.fill();
      c.fillStyle = '#d8d7d2'; c.fillRect(thumbX + 2, gridBottom + pad + 1, thumbW - 4, 1);
    }
    if (g.gridH > g.viewH) {
      const trackY = g.rulerH, trackH = g.viewH - (g.gridW > g.viewW ? sb : 0);
      const thumbH = Math.max(28, trackH * (g.viewH / g.gridH));
      const thumbY = trackY + (this.scroll.y / (g.gridH - g.viewH)) * (trackH - thumbH);
      c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(this.w - sb, trackY, sb, trackH);
      c.fillStyle = '#8a8985'; roundRect(c, this.w - sb + pad, thumbY, sb - pad * 2, thumbH, 3); c.fill();
    }
  }
  drawPattern(c, g, C, song, absStep) {
    const pat = this.pattern();
    if (!pat) return;
    const dev = this.device();
    const T = DEVICE_TYPES[dev.type];
    const accent = T.color === 'red' ? C.red : C.blue;
    const sx = this.scroll.x, sy = this.scroll.y;
    const x0 = g.labelW, y0 = g.rulerH;
    // local playhead
    let ph = -1;
    if (absStep >= 0) {
      const mode = this.bus.transportMode?.() || 'song';
      if (mode === 'pattern') ph = absStep % pat.steps;
      else {
        const bar = Math.floor(absStep / STEPS_PER_BAR);
        const blk = (song.arrangement.tracks[dev.id] || []).find((b) => bar >= b.bar && bar < b.bar + b.bars);
        if (blk && blk.pat === pat.id) ph = ((bar - blk.bar) * STEPS_PER_BAR + absStep % STEPS_PER_BAR) % pat.steps;
      }
    }
    // grid
    c.save();
    c.beginPath(); c.rect(x0, y0, g.viewW, g.viewH); c.clip();
    for (let r = 0; r < g.rows.length; r++) {
      const y = y0 + r * g.rowH - sy;
      if (y > this.h || y + g.rowH < y0) continue;
      const row = g.rows[r];
      c.fillStyle = row.black ? 'rgba(0,0,0,.35)' : (r % 2 ? 'rgba(255,255,255,.015)' : 'transparent');
      c.fillRect(x0, y, g.viewW, g.rowH);
    }
    for (let s = 0; s <= g.steps; s++) {
      const x = x0 + s * g.cellW - sx;
      if (x < x0 - 1 || x > this.w) continue;
      c.fillStyle = s % 16 === 0 ? 'rgba(241,230,200,.32)' : s % 4 === 0 ? C.dim : C.dim2;
      c.fillRect(Math.round(x), y0, s % 16 === 0 ? 2 : 1, g.viewH);
    }
    for (let r = 0; r <= g.rows.length; r++) {
      const y = y0 + r * g.rowH - sy;
      c.fillStyle = C.dim2; c.fillRect(x0, Math.round(y), g.viewW, 1);
    }
    // playhead column glow
    if (ph >= 0) {
      const x = x0 + ph * g.cellW - sx;
      c.fillStyle = 'rgba(255,43,214,.10)'; c.fillRect(x, y0, g.cellW, g.viewH);
    }
    // notes
    const drawNote = (n, ghost) => {
      const r = g.rows.findIndex((row) => row.n === n.n);
      if (r < 0) return;
      const x = x0 + n.s * g.cellW - sx, y = y0 + r * g.rowH - sy;
      const w = n.l * g.cellW, hgt = g.rowH;
      const on = ph >= n.s && ph < n.s + n.l;
      const isSel = this.sel && this.sel.s === n.s && this.sel.n === n.n;
      c.globalAlpha = ghost ? 0.5 : 1;
      c.fillStyle = on ? C.bulb : C.cream;
      const pad = g.kind === 'drums' ? 3 : 2;
      roundRect(c, x + 1, y + pad, w - 2, hgt - pad * 2, 3);
      c.fill();
      // velocity as an ink bar on the strip
      c.fillStyle = accent;
      const vh = Math.max(2, (hgt - pad * 2) * n.v);
      roundRect(c, x + 1, y + hgt - pad - vh, Math.min(w - 2, 5), vh, 1.5); c.fill();
      if (isSel && !ghost) { c.strokeStyle = C.bulb; c.lineWidth = 2; roundRect(c, x + 1, y + pad, w - 2, hgt - pad * 2, 3); c.stroke(); }
      if (n.g || n.r) {
        c.fillStyle = C.ink; c.font = `700 ${Math.min(11, hgt - 6)}px Michroma, "Arial Narrow", sans-serif`;
        c.textBaseline = 'middle'; c.textAlign = 'left';
        if (w > 22) c.fillText(n.g ? 'SLIDE' : 'REV', x + 9, y + hgt / 2 + 0.5);
      }
      if (g.kind === 'drums' && w > 30 && !n.g) {
        c.fillStyle = 'rgba(26,18,48,.75)'; c.font = `500 9px Michroma, "Arial Narrow", sans-serif`; c.textBaseline = 'middle'; c.textAlign = 'right';
        c.fillText(Math.round(n.v * 100), x + w - 5, y + hgt / 2 + 1);
      }
      c.globalAlpha = 1;
    };
    for (const n of pat.notes) {
      if (this.preview?.note && this.drag?.note && n.s === this.drag.note.s && n.n === this.drag.note.n) continue;
      drawNote(n, false);
    }
    if (this.preview?.note) drawNote(this.preview.note, true);
    if (this.drag?.kind === 'paint') { /* live */ }
    // hover cell
    if (this.hover?.inGrid && !this.drag && this.hover.row < g.rows.length) {
      const x = x0 + this.hover.col * g.cellW - sx, y = y0 + this.hover.row * g.rowH - sy;
      c.fillStyle = 'rgba(241,230,200,.08)'; c.fillRect(x, y, g.cellW, g.rowH);
    }
    // playhead line
    if (ph >= 0) {
      const x = x0 + ph * g.cellW - sx;
      c.fillStyle = C.bulb; c.fillRect(Math.round(x), y0, 2, g.viewH);
    }
    c.restore();
    // velocity lane
    const vy = this.h - g.velH;
    c.fillStyle = '#080706'; c.fillRect(0, vy, this.w, g.velH);
    c.fillStyle = C.dim; c.fillRect(0, vy, this.w, 1);
    c.save(); c.beginPath(); c.rect(x0, vy, g.viewW, g.velH); c.clip();
    for (const n of pat.notes) {
      const x = x0 + n.s * g.cellW - sx;
      const hgt = Math.max(2, (g.velH - 6) * n.v);
      c.fillStyle = (ph === n.s) ? C.bulb : accent;
      c.fillRect(x + 2, vy + g.velH - 3 - hgt, Math.max(2, g.cellW - 4), hgt);
    }
    c.restore();
    c.fillStyle = 'rgba(219,226,244,.55)'; c.font = `700 10px Michroma, "Arial Narrow", sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('VELOCITY', 8, vy + g.velH / 2);
    // labels
    c.fillStyle = C.panel; c.fillRect(0, y0, g.labelW, g.viewH);
    c.save(); c.beginPath(); c.rect(0, y0, g.labelW, g.viewH); c.clip();
    for (let r = 0; r < g.rows.length; r++) {
      const y = y0 + r * g.rowH - sy;
      if (y > this.h || y + g.rowH < y0) continue;
      const row = g.rows[r];
      const isC = g.kind === 'melodic' && row.n % 12 === 0;
      // chrome key per row
      c.fillStyle = row.black ? '#1c1038' : C.cream;
      roundRect(c, 6, y + 1.5, g.labelW - 12, g.rowH - 3, 2); c.fill();
      c.fillStyle = row.black ? 'rgba(241,230,200,.7)' : C.ink;
      c.font = `${g.kind === 'melodic' ? 500 : 500} ${Math.min(12, g.rowH - 6)}px Michroma, "Arial Narrow", sans-serif`;
      c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText((g.touch || g.labelW < 112) && row.label === 'OPEN HAT' ? 'O.HAT' : row.label, 12, y + g.rowH / 2 + 1);
      if (isC || g.kind !== 'melodic') { c.fillStyle = accent; c.fillRect(g.labelW - 10, y + 3, 2, g.rowH - 6); }
    }
    c.restore();
    // ruler
    c.fillStyle = C.panel; c.fillRect(0, 0, this.w, g.rulerH);
    c.fillStyle = C.dim; c.fillRect(0, g.rulerH - 1, this.w, 1);
    c.save(); c.beginPath(); c.rect(x0, 0, g.viewW, g.rulerH); c.clip();
    c.font = `700 11px Michroma, "Arial Narrow", sans-serif`; c.textBaseline = 'middle'; c.textAlign = 'left';
    for (let s = 0; s < g.steps; s++) {
      const x = x0 + s * g.cellW - sx;
      if (s % 4 === 0) { c.fillStyle = s % 16 === 0 ? C.cream : 'rgba(219,226,244,.5)'; c.fillText(s % 16 === 0 ? `BAR ${s / 16 + 1}` : `${(s % 16) / 4 + 1}`, x + 4, g.rulerH / 2 + 1); }
      if (ph === s) { c.fillStyle = C.bulb; c.beginPath(); c.moveTo(x + g.cellW / 2 - 5, 2); c.lineTo(x + g.cellW / 2 + 5, 2); c.lineTo(x + g.cellW / 2, 9); c.fill(); }
    }
    c.restore();
    // corner: device + pattern name strip
    c.fillStyle = accent; c.fillRect(0, 0, g.labelW, g.rulerH);
    c.fillStyle = C.ink; c.font = `700 10px Michroma, "Arial Narrow", sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.save(); c.beginPath(); c.rect(0, 0, g.labelW - 4, g.rulerH); c.clip();
    let chip = `${T.name.split(' ')[0]} · ${pat.name}`;
    while (chip.length > 3 && c.measureText(chip).width > g.labelW - 12) chip = chip.slice(0, -2) + '…';
    c.fillText(chip, 6, g.rulerH / 2 + 1);
    c.fillStyle = C.panel; c.fillRect(g.labelW - 3, 0, 3, g.rulerH);
    c.restore();
  }
  drawSong(c, g, C, song, absStep) {
    const sx = this.scroll.x, sy = this.scroll.y, x0 = g.labelW, y0 = g.rulerH;
    const curBar = absStep >= 0 ? Math.floor(absStep / STEPS_PER_BAR) : -1;
    const loop = this.bus.getLoop?.() || { on: false };
    c.save(); c.beginPath(); c.rect(x0, y0, g.viewW, g.viewH); c.clip();
    // beyond-length shading
    const endX = x0 + song.arrangement.bars * g.cellW - sx;
    c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(endX, y0, this.w - endX, g.viewH);
    for (let r = 0; r < g.rows.length; r++) {
      const y = y0 + r * g.rowH - sy;
      c.fillStyle = r % 2 ? 'rgba(255,255,255,.015)' : 'transparent'; c.fillRect(x0, y, g.viewW, g.rowH);
      c.fillStyle = C.dim2; c.fillRect(x0, Math.round(y + g.rowH) - 1, g.viewW, 1);
    }
    for (let b = 0; b <= g.bars; b++) {
      const x = x0 + b * g.cellW - sx;
      c.fillStyle = b % 4 === 0 ? 'rgba(241,230,200,.3)' : C.dim2; c.fillRect(Math.round(x), y0, b % 4 === 0 ? 2 : 1, g.viewH);
    }
    if (loop.on) {
      const lx = x0 + loop.startBar * g.cellW - sx, lw = (loop.endBar - loop.startBar) * g.cellW;
      c.fillStyle = 'rgba(240,169,58,.07)'; c.fillRect(lx, y0, lw, g.viewH);
    }
    if (curBar >= 0) { c.fillStyle = 'rgba(240,169,58,.10)'; c.fillRect(x0 + curBar * g.cellW - sx, y0, g.cellW, g.viewH); }
    // blocks
    for (let r = 0; r < g.rows.length; r++) {
      const row = g.rows[r];
      const accent = row.color === 'red' ? C.red : C.blue;
      const y = y0 + r * g.rowH - sy;
      const track = song.arrangement.tracks[row.dev.id] || [];
      for (const b of track) {
        if (this.preview?.block && this.drag?.block?.id === b.id) continue;
        drawBlock(c, C, g, row, b, x0 + b.bar * g.cellW - sx, y, accent, this.sel === b.id, curBar >= b.bar && curBar < b.bar + b.bars, false);
      }
    }
    if (this.preview?.block) {
      const row = g.rows[this.preview.rowIdx];
      const b = this.preview.block;
      drawBlock(c, C, g, row, b, x0 + b.bar * g.cellW - sx, y0 + this.preview.rowIdx * g.rowH - sy, row.color === 'red' ? C.red : C.blue, false, false, true);
    }
    if (this.drag?.kind === 'lay') {
      const a = Math.min(this.drag.start, this.drag.end), bb = Math.max(this.drag.start, this.drag.end);
      const y = y0 + this.drag.row * g.rowH - sy;
      c.globalAlpha = 0.5; c.fillStyle = C.cream; roundRect(c, x0 + a * g.cellW - sx + 2, y + 5, (bb - a + 1) * g.cellW - 4, g.rowH - 10, 4); c.fill(); c.globalAlpha = 1;
    }
    if (this.hover?.inGrid && !this.drag) {
      c.fillStyle = 'rgba(241,230,200,.06)'; c.fillRect(x0 + this.hover.col * g.cellW - sx, y0 + this.hover.row * g.rowH - sy, g.cellW, g.rowH);
    }
    if (absStep >= 0) {
      const x = x0 + (absStep / STEPS_PER_BAR) * g.cellW - sx;
      c.fillStyle = C.bulb; c.fillRect(Math.round(x), y0, 2, g.viewH);
    }
    c.restore();
    // labels
    c.fillStyle = C.panel; c.fillRect(0, y0, g.labelW, g.viewH);
    for (let r = 0; r < g.rows.length; r++) {
      const row = g.rows[r];
      const y = y0 + r * g.rowH - sy;
      const accent = row.color === 'red' ? C.red : C.blue;
      c.fillStyle = C.cream; roundRect(c, 6, y + 4, g.labelW - 12, g.rowH - 8, 2); c.fill();
      c.fillStyle = accent; c.fillRect(6, y + 4, 4, g.rowH - 8);
      c.fillStyle = row.dev.muted ? 'rgba(26,18,48,.4)' : C.ink; c.font = `700 ${Math.min(15, g.rowH - 14)}px Michroma, "Arial Narrow", sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText(row.label + (row.dev.muted ? '  (MUTED)' : ''), 16, y + g.rowH / 2 + 1);
    }
    // ruler
    c.fillStyle = C.panel; c.fillRect(0, 0, this.w, g.rulerH);
    c.fillStyle = C.dim; c.fillRect(0, g.rulerH - 1, this.w, 1);
    c.save(); c.beginPath(); c.rect(x0, 0, g.viewW, g.rulerH); c.clip();
    if (loop.on) { c.fillStyle = 'rgba(240,169,58,.35)'; c.fillRect(x0 + loop.startBar * g.cellW - sx, 0, (loop.endBar - loop.startBar) * g.cellW, g.rulerH - 1); }
    if (this.drag?.kind === 'loop' && this.drag.moved) { const a = Math.min(this.drag.start, this.drag.end), bb = Math.max(this.drag.start, this.drag.end) + 1; c.fillStyle = 'rgba(240,169,58,.5)'; c.fillRect(x0 + a * g.cellW - sx, 0, (bb - a) * g.cellW, g.rulerH - 1); }
    c.font = `700 11px Michroma, "Arial Narrow", sans-serif`; c.textBaseline = 'middle'; c.textAlign = 'left';
    for (let b = 0; b < g.bars; b++) {
      const x = x0 + b * g.cellW - sx;
      c.fillStyle = b >= song.arrangement.bars ? 'rgba(219,226,244,.25)' : (b % 4 === 0 ? C.cream : 'rgba(219,226,244,.5)');
      c.fillText(String(b + 1), x + 4, g.rulerH / 2 + 1);
    }
    if (curBar >= 0) { const x = x0 + (absStep / STEPS_PER_BAR) * g.cellW - sx; c.fillStyle = C.bulb; c.beginPath(); c.moveTo(x - 5, 2); c.lineTo(x + 5, 2); c.lineTo(x, 9); c.fill(); }
    c.restore();
    c.fillStyle = C.bulb; c.fillRect(0, 0, g.labelW, g.rulerH);
    c.fillStyle = C.ink; c.font = `700 12px Michroma, "Arial Narrow", sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(`${song.title || 'UNTITLED'}`.slice(0, 22), 8, g.rulerH / 2 + 1);
  }
}

function drawBlock(c, C, g, row, b, x, y, accent, sel, on, ghost) {
  const w = b.bars * g.cellW;
  const pat = row.dev.patterns.find((p) => p.id === b.pat);
  c.globalAlpha = ghost ? 0.5 : row.dev.muted ? 0.45 : 1;
  c.fillStyle = on ? C.bulb : C.cream;
  roundRect(c, x + 2, y + 5, w - 4, g.rowH - 10, 4); c.fill();
  // red/blue ruling like a title strip
  c.fillStyle = accent; c.fillRect(x + 2, y + 5, w - 4, 3);
  c.fillStyle = accent === C.red ? C.blue : C.red; c.fillRect(x + 2, y + g.rowH - 8, w - 4, 3);
  if (sel) { c.strokeStyle = C.bulb; c.lineWidth = 2; roundRect(c, x + 2, y + 5, w - 4, g.rowH - 10, 4); c.stroke(); }
  c.fillStyle = C.ink; c.font = `700 ${Math.min(16, g.rowH - 18)}px Michroma, "Arial Narrow", sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillText(pat ? pat.name : '?', x + 9, y + g.rowH / 2 + 1);
  // mini note density
  if (pat && w > 40) {
    c.fillStyle = 'rgba(26,21,18,.35)';
    const span = pat.steps;
    const innerX = x + 26, innerW = w - 34;
    for (const n of pat.notes) {
      const nx = innerX + (n.s / span) * innerW;
      c.fillRect(nx, y + g.rowH / 2 - 4 + (1 - n.v) * 6, Math.max(1.5, (n.l / span) * innerW - 1), 3);
    }
  }
  c.globalAlpha = 1;
}

function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}
