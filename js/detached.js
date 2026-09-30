// Detached editor window. Mirrors the song from the main window; sends ops back.
import { Editor } from './editor.js';
import { applyOp } from './ops.js';
import { emptySong } from './song.js';

const CHANNEL = 'noise-editor';
const channel = ('BroadcastChannel' in window) ? new BroadcastChannel(CHANNEL) : null;
const main = window.opener;

let song = emptySong();
let step = -1;
let loop = { on: false, startBar: 0, endBar: 0 };
let mode = 'song';
const listeners = new Set();

function send(msg) {
  const payload = { noise: 1, ...msg };
  if (channel) channel.postMessage(payload);
  else if (main && !main.closed) main.postMessage(payload, location.origin);
}

const bus = {
  getSong: () => song,
  dispatch: (op) => { applyOp(song, op); for (const fn of listeners) fn(); send({ type: 'op', op }); },
  audition: (deviceId, n, opts) => send({ type: 'audition', deviceId, n, opts }),
  currentStep: () => step,
  transportMode: () => mode,
  on: (ev, fn) => { if (ev === 'song') listeners.add(fn); },
  setMode: (m, focus) => { mode = m; send({ type: 'mode', mode: m, focus }); },
  setLoop: (a, b) => { loop = { on: true, startBar: a, endBar: b }; send({ type: 'loop', a, b }); },
  getLoop: () => loop,
  seekBar: (bar) => send({ type: 'seekBar', bar }),
  seekStep: (s) => send({ type: 'seekStep', step: s }),
  detach: () => { send({ type: 'return' }); window.close(); },
};

const editor = new Editor(document.getElementById('editor'), bus, { detached: true });

function onMsg(msg) {
  if (!msg || !msg.noise) return;
  switch (msg.type) {
    case 'song':
      song = msg.song; loop = msg.loop || loop; mode = msg.mode || mode;
      document.title = `${song.title} — NOISE editor`;
      for (const fn of listeners) fn();
      break;
    case 'step': step = msg.step; break;
    case 'focus': editor.focusDevice(msg.deviceId); break;
  }
}
if (channel) channel.addEventListener('message', (e) => onMsg(e.data));
window.addEventListener('message', (e) => onMsg(e.data));

send({ type: 'hello' });
// if the main window is gone, say so
setInterval(() => {
  const lost = !main || main.closed;
  document.body.classList.toggle('is-orphan', lost);
}, 1000);
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); /* undo lives in the main window */ }
  if (e.key === 'Escape') { /* no-op */ }
});
