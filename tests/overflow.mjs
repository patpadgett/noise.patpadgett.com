// Which elements poke past the viewport on a phone? Prints the offenders.
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:8766';
const b = await chromium.launch({ args: ['--no-sandbox'] });
const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await m.goto(base + '/#demo', { waitUntil: 'networkidle' });
await m.waitForFunction(() => document.body.dataset.state === 'onair' && document.querySelectorAll('#ro-body tr').length > 10, null, { timeout: 120000 });
const wide = await m.evaluate(() => { const vw = document.documentElement.clientWidth; const out = []; for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.right > vw + 1 && r.width > 0) out.push(el.tagName + '.' + [...el.classList].join('.') + ' right=' + Math.round(r.right) + ' w=' + Math.round(r.width)); } return { vw, sw: document.documentElement.scrollWidth, out: out.slice(0, 14) }; });
console.log(JSON.stringify(wide, null, 1));
await b.close();
