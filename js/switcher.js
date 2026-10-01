// CUE — the switcher. Executes a cue sheet against the song clock on a canvas: cuts between clips
// at bar boundaries, runs light cues (strobe/pulse/flash/wash/blackout/flicker) locked to the beat
// grid, burns lyrics in. Pure function of (time, cues, assets) so the same code draws the live
// PGM monitor, the PVW thumbnails (at a future time) and every frame of the export.

export function barTime(analysis, bar, beat = 1) {
  // bar is 1-based; returns seconds. Past the last measured bar, extrapolate at the tempo.
  const bs = analysis.barStarts, beatSec = 60 / analysis.bpm;
  const i = bar - 1;
  const start = i < bs.length ? bs[i] : bs[bs.length - 1] + (i - (bs.length - 1)) * beatSec * 4;
  return start + (beat - 1) * beatSec;
}
export function barAt(analysis, t) {
  const bs = analysis.barStarts; let lo = 0, hi = bs.length - 1;
  if (t < bs[0]) return { bar: 1, beat: 1, frac: 0, before: true };
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bs[mid] <= t) lo = mid; else hi = mid - 1; }
  const beatSec = 60 / analysis.bpm, next = lo + 1 < bs.length ? bs[lo + 1] : bs[lo] + 4 * beatSec;
  const within = (t - bs[lo]) / Math.max(0.001, next - bs[lo]);
  return { bar: lo + 1, beat: Math.min(4, Math.floor(within * 4) + 1), frac: within, beatFrac: (within * 4) % 1 };
}
export function cueStart(analysis, c) { return barTime(analysis, c.in, c.beat || 1); }
export function cueEnd(analysis, c) { return barTime(analysis, c.in + Math.floor(c.bars), 1 + ((c.bars % 1) * 4)); }

export function timeline(treatment, analysis) {
  const cues = treatment.cues.map((c) => ({ ...c, start: cueStart(analysis, c), end: cueEnd(analysis, c) })).sort((a, b) => a.start - b.start || a.n - b.n);
  const scenes = cues.filter((c) => c.kind === 'scene');
  return { cues, scenes, lights: cues.filter((c) => c.kind === 'light'), lyrics: cues.filter((c) => c.kind === 'lyric') };
}
export function sceneAt(tl, t) { let s = null; for (const c of tl.scenes) { if (c.start <= t) s = c; else break; } return s; }
export function nextCue(tl, t) { for (const c of tl.cues) if (c.start > t + 0.001) return c; return null; }
export function activeAt(list, t) { return list.filter((c) => c.start <= t && t < c.end); }

// ---- light cue envelope: 0..1 intensity for cue c at song time t, given the beat grid ----
export function lightLevel(c, t, analysis, noStrobe) {
  const beatSec = 60 / analysis.bpm, el = t - c.start, len = c.end - c.start;
  if (el < 0 || el >= len) return 0;
  const beatPos = (t - analysis.barStarts[0]) / beatSec; // beats since the first downbeat
  const eff = noStrobe && c.effect === 'strobe' ? 'pulse' : c.effect;
  switch (eff) {
    case 'strobe': { const rate = Math.max(1, c.rate || 4); const ph = (beatPos * rate) % 1; return ph < 0.5 ? 1 : 0; } // square, N hits per beat
    case 'pulse': { const rate = Math.max(0.25, Math.min(noStrobe ? 1 : 4, c.rate || 1)); const ph = (beatPos * rate) % 1; return Math.pow(1 - ph, 2); } // decaying per hit
    case 'flash': return Math.max(0, 1 - el / Math.min(len, beatSec * 1.5)); // one hit on the IN, decays over ~1.5 beats
    case 'wash': { const a = Math.min(1, el / (beatSec * 2)), r = Math.min(1, (len - el) / (beatSec * 2)); return 0.55 * Math.min(a, r); } // fades in and out over 2 beats
    case 'blackout': return 1;
    case 'flicker': { const x = Math.sin(t * 97.3) * Math.sin(t * 31.7 + 1) * Math.sin(t * 13.1); return x > 0.15 ? 0.9 : x > -0.3 ? 0.2 : 0; }
    default: return 0;
  }
}

function hex(h, a = 1) { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return `rgba(255,255,255,${a})`; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

// ---- draw one frame -------------------------------------------------------------------------
// ctx: 2d context sized to W×H. clipFor(scene) returns a drawable (HTMLVideoElement/ImageBitmap/null)
// positioned at the right media time by the caller. palette from the treatment colours the fallback.
export function drawFrame(ctx, W, H, t, tl, analysis, { clipFor, noStrobe = false, palette = ['#222'], stanzas = [], showLyrics = true, showShot = true, fontClock = "'Barlow Condensed'", fontText = 'Archivo' }) {
  const scene = sceneAt(tl, t);
  const src = scene ? clipFor(scene) : null;
  ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (src && (src.videoWidth || src.width)) {
    const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
    const s = Math.max(W / sw, H / sh), dw = sw * s, dh = sh * s; // cover
    ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    // no footage yet: the scene's own placeholder, a slow tonal field in the treatment palette with the shot text
    const col = palette[scene ? (scene.n % palette.length) : 0] || '#222';
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, hex(col, 0.9)); g.addColorStop(1, hex(palette[(palette.indexOf(col) + 1) % palette.length] || '#000', 0.9));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (scene && showShot && W >= 640) {
      // the slate: what a gallery shows when the VT has not arrived. Scene number large, the anchor, the cost of the wait.
      ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.fillRect(0, 0, W, H);
      const pad = W * 0.06;
      ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.font = `700 ${Math.round(H * 0.19)}px ${fontClock}`; const numW = ctx.measureText(String(scene.n).padStart(2, '0')).width; ctx.fillText(String(scene.n).padStart(2, '0'), pad, H * 0.30);
      ctx.font = `700 ${Math.round(H * 0.045)}px ${fontClock}`; ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillText('SCENE', pad + numW + W * 0.02, H * 0.30);
      ctx.font = `500 ${Math.round(H * 0.034)}px ${fontText}`; ctx.fillStyle = 'rgba(255,255,255,.88)';
      wrapText(ctx, scene.cue, pad, H * 0.40, W * 0.62, Math.round(H * 0.048), 3);
      ctx.font = `700 ${Math.round(H * 0.03)}px ${fontClock}`; ctx.fillStyle = '#f0b429'; ctx.fillText('FOOTAGE PENDING · RENDER TO GENERATE', pad, H * 0.30 + H * 0.4);
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = Math.max(1, H * 0.003); ctx.beginPath(); ctx.moveTo(pad, H * 0.335); ctx.lineTo(W - pad, H * 0.335); ctx.stroke();
    }
  }
  // lights, in cue order; additive, blackout wins
  let black = 0;
  for (const c of activeAt(tl.lights, t)) {
    const lv = lightLevel(c, t, analysis, noStrobe); if (lv <= 0) continue;
    if (c.effect === 'blackout') { black = Math.max(black, lv); continue; }
    ctx.globalCompositeOperation = c.effect === 'wash' ? 'overlay' : 'screen';
    ctx.fillStyle = hex(c.color || '#ffffff', c.effect === 'wash' ? lv : lv * 0.95); ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (black > 0) { ctx.fillStyle = `rgba(0,0,0,${black})`; ctx.fillRect(0, 0, W, H); }
  // lyrics
  if (showLyrics) for (const c of activeAt(tl.lyrics, t)) {
    const el = t - c.start, len = c.end - c.start, lines = String(c.lines || '').split('\n').filter(Boolean);
    const size = Math.round(H * (c.style === 'slam' ? 0.085 : c.style === 'whisper' ? 0.034 : 0.05));
    ctx.font = `${c.style === 'slam' ? 700 : c.style === 'whisper' ? 400 : 600} ${size}px ${c.style === 'slam' ? fontClock : fontText}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    let alpha = 1; if (c.style === 'whisper') alpha = 0.72; const fadeOut = Math.min(1, (len - el) / 0.4); alpha *= Math.min(1, fadeOut);
    lines.forEach((line, i) => {
      let text = line;
      if (c.style === 'typewriter') { const chars = Math.floor(Math.min(1, el / Math.min(len * 0.6, 2.2)) * line.length); text = line.slice(0, chars); }
      if (c.style === 'slam' && el < 0.12) { ctx.save(); const k = 1 + (0.12 - el) * 2.5; ctx.translate(W / 2, H * 0.5); ctx.scale(k, k); ctx.translate(-W / 2, -H * 0.5); }
      const y = c.style === 'slam' ? H * 0.5 + (i - (lines.length - 1) / 2) * size * 1.1 : H * 0.84 + i * size * 1.25;
      ctx.lineWidth = Math.max(2, size * 0.08); ctx.strokeStyle = `rgba(0,0,0,${0.55 * alpha})`; ctx.lineJoin = 'round';
      ctx.strokeText(text, W / 2, y); ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.fillText(text, W / 2, y);
      if (c.style === 'slam' && el < 0.12) ctx.restore();
    });
    ctx.textAlign = 'left';
  }
  ctx.restore();
  return scene;
}
function wrapText(ctx, text, x, y, maxW, lh, maxLines) {
  const words = String(text).split(/\s+/); let line = '', n = 0;
  for (const w of words) { const test = line ? line + ' ' + w : w; if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y + n * lh); line = w; n++; if (n >= maxLines - 1) break; } else line = test; }
  if (n < maxLines) { while (ctx.measureText(line + '…').width > maxW && line.length > 4) line = line.replace(/\s*\S+$/, ''); ctx.fillText(line + (n >= maxLines - 1 && words.join(' ').length > line.length + 1 ? '…' : ''), x, y + n * lh); }
}

export function fmtTC(t) { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60), d = Math.floor((t % 1) * 10); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`; }
export function fmtIn(t) { const m = Math.floor(t / 60), s = (t % 60); return `${m}:${s.toFixed(1).padStart(4, '0')}`; }
export function fmtCountdown(dt) { if (dt <= 0) return 'GO'; return `−${fmtIn(dt).replace(/^0:/, '0:')}`; }
