// Chrome rotary knob: pointer drag, wheel, keyboard, double-click to reset. ARIA slider.
import { clamp } from './synth.js';

export function fmtValue(p, v) {
  switch (p.unit) {
    case '%': return Math.round(v * 100) + '%';
    case 's': return v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's';
    case 'Hz': return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : Math.round(v) + '';
    case '×': return v.toFixed(2) + '×';
    case 'st': return (v > 0 ? '+' : '') + Math.round(v);
    case 'oct': return (v > 0 ? '+' : '') + Math.round(v);
    case 'vowel': { const names = ['AH', 'EH', 'EE', 'OH', 'OO']; const i = Math.round(v); return names[clamp(i, 0, 4)]; }
    default: return typeof v === 'number' ? v.toFixed(2) : String(v);
  }
}

const toNorm = (p, v) => p.log ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min);
const fromNorm = (p, n) => {
  n = clamp(n, 0, 1);
  let v = p.log ? p.min * Math.pow(p.max / p.min, n) : p.min + (p.max - p.min) * n;
  if (p.step) v = Math.round(v / p.step) * p.step;
  return clamp(v, p.min, p.max);
};

export class Knob {
  constructor(p, value, onChange, onCommit) {
    this.p = p;
    this.value = value;
    this.onChange = onChange;
    this.onCommit = onCommit;
    const el = document.createElement('div');
    el.className = 'knob';
    el.innerHTML = `
      <div class="knob__cap" role="slider" tabindex="0" aria-label="${p.label}" aria-valuemin="${p.min}" aria-valuemax="${p.max}" aria-valuenow="${value}" aria-valuetext="${fmtValue(p, value)}">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <path class="knob__arc-bg" d="" fill="none" stroke="#231d19" stroke-width="3" stroke-linecap="round"/>
          <path class="knob__arc" d="" fill="none" stroke="var(--bulb)" stroke-width="3" stroke-linecap="round"/>
          <circle cx="32" cy="32" r="21" fill="url(#kchrome)"/>
          <circle cx="32" cy="32" r="17" fill="url(#kcap)" stroke="#0b0908" stroke-width=".8"/>
          <g class="knob__ptr"><rect x="31" y="16.5" width="2" height="9" rx="1" fill="var(--cream)"/></g>
        </svg>
      </div>
      <div class="knob__label">${p.label}</div>
      <div class="knob__val"></div>`;
    this.el = el;
    this.cap = el.querySelector('.knob__cap');
    this.ptr = el.querySelector('.knob__ptr');
    this.arc = el.querySelector('.knob__arc');
    this.arcBg = el.querySelector('.knob__arc-bg');
    this.val = el.querySelector('.knob__val');
    this.arcBg.setAttribute('d', arcPath(0, 1));
    this.render();
    this.bind();
  }
  render() {
    const n = toNorm(this.p, this.value);
    const deg = -135 + n * 270;
    this.ptr.setAttribute('transform', `rotate(${deg} 32 32)`);
    this.arc.setAttribute('d', arcPath(0, Math.max(n, 0.001)));
    this.val.textContent = fmtValue(this.p, this.value);
    this.cap.setAttribute('aria-valuenow', this.value);
    this.cap.setAttribute('aria-valuetext', fmtValue(this.p, this.value));
  }
  set(v, fire = false) {
    this.value = clamp(v, this.p.min, this.p.max);
    this.render();
    if (fire) this.onChange?.(this.value);
  }
  setNorm(n, fire = true) { this.set(fromNorm(this.p, n), fire); }
  bind() {
    const cap = this.cap;
    let startY = 0, startN = 0, dragging = false, moved = false;
    cap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      cap.setPointerCapture(e.pointerId);
      dragging = true; moved = false;
      startY = e.clientY; startN = toNorm(this.p, this.value);
      cap.classList.add('is-dragging');
    });
    cap.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      const fine = e.shiftKey ? 0.25 : 1;
      const n = startN + (dy / 160) * fine;
      moved = true;
      this.setNorm(n);
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      cap.classList.remove('is-dragging');
      try { cap.releasePointerCapture(e.pointerId); } catch (err) {}
      if (moved) this.onCommit?.(this.value);
    };
    cap.addEventListener('pointerup', end);
    cap.addEventListener('pointercancel', end);
    cap.addEventListener('dblclick', () => { this.set(this.p.def, true); this.onCommit?.(this.value); });
    cap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const n = toNorm(this.p, this.value) + (e.deltaY < 0 ? 0.03 : -0.03);
      this.setNorm(n);
      clearTimeout(this._wt);
      this._wt = setTimeout(() => this.onCommit?.(this.value), 300);
    }, { passive: false });
    cap.addEventListener('keydown', (e) => {
      const n = toNorm(this.p, this.value);
      const big = e.shiftKey ? 0.1 : 0.02;
      let nn = null;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') nn = n + big;
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') nn = n - big;
      if (e.key === 'Home') nn = 0;
      if (e.key === 'End') nn = 1;
      if (nn == null) return;
      e.preventDefault();
      this.setNorm(nn);
      this.onCommit?.(this.value);
    });
  }
}

function arcPath(from, to) {
  const a0 = (-135 + from * 270 - 90) * Math.PI / 180;
  const a1 = (-135 + to * 270 - 90) * Math.PI / 180;
  const r = 27, cx = 32, cy = 32;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const large = (to - from) * 270 > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// Mechanical drum counter: fixed digit boxes, reels that roll.
export class Counter {
  constructor(label, digits, opts = {}) {
    this.digits = digits;
    const el = document.createElement('div');
    el.className = 'counter';
    if (opts.speed) el.style.setProperty('--roll', opts.speed);
    el.innerHTML = `<div class="counter__label">${label}</div><div class="counter__drums" role="status" aria-live="off" aria-label="${label}">${
      Array.from({ length: digits }, () => `<span class="drum"><span class="reel">${'0123456789'.split('').map((d) => `<i>${d}</i>`).join('')}</span></span>`).join('')
    }</div>`;
    this.el = el;
    this.reels = [...el.querySelectorAll('.reel')];
    this.drumsEl = el.querySelector('.counter__drums');
    this.last = null;
    if (opts.onStep) {
      const btns = document.createElement('div');
      btns.className = 'counter__btns';
      btns.innerHTML = `<button class="pb pb--tiny" aria-label="${label} down">−</button><button class="pb pb--tiny" aria-label="${label} up">+</button>`;
      const [down, up] = btns.querySelectorAll('button');
      const hold = (btn, dir) => {
        let t1, t2;
        const fire = () => opts.onStep(dir);
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); fire(); t1 = setTimeout(() => { t2 = setInterval(fire, 60); }, 400); });
        const stop = () => { clearTimeout(t1); clearInterval(t2); };
        btn.addEventListener('pointerup', stop); btn.addEventListener('pointerleave', stop); btn.addEventListener('pointercancel', stop);
        btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); } });
      };
      hold(down, -1); hold(up, 1);
      el.appendChild(btns);
    }
  }
  set(n) {
    n = Math.max(0, Math.round(n));
    if (n === this.last) return;
    this.last = n;
    const s = String(n).padStart(this.digits, '0').slice(-this.digits);
    for (let i = 0; i < this.digits; i++) {
      this.reels[i].style.setProperty('--d', s[i]);
    }
    this.drumsEl.setAttribute('aria-label', this.drumsEl.getAttribute('aria-label').split(':')[0] + ': ' + n);
  }
}
