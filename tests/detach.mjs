import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('main: ' + e.message));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.click('#coin'); await page.waitForTimeout(1500);
const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('.js-detach')]);
popup.on('pageerror', (e) => errs.push('popup: ' + e.message));
await popup.waitForLoadState('networkidle'); await popup.waitForTimeout(600);
console.log('popup title:', await popup.title());
console.log('main hides docked editor:', await page.evaluate(() => document.body.classList.contains('is-detached') && getComputedStyle(document.getElementById('editor')).display === 'none'));
// add a note from the popup, check main got it
const before = await page.evaluate(() => window.noise.song.devices.find(d => d.type === 'hearse').patterns[0].notes.length);
await popup.selectOption('.js-device', 'hearse'); await popup.waitForTimeout(200);
const box = await popup.locator('.editor__canvas').boundingBox();
await popup.mouse.click(box.x + 84 + 16 * 3 + 6, box.y + 22 + 18 * 4 + 6);
await popup.waitForTimeout(300);
const after = await page.evaluate(() => window.noise.song.devices.find(d => d.type === 'hearse').patterns[0].notes.length);
console.log('note added via popup:', before, '->', after);
// step sync
await popup.waitForTimeout(500);
console.log('popup sees step:', await popup.evaluate(() => window.__step ?? 'n/a'));
await popup.click('.js-detach'); await page.waitForTimeout(800);
console.log('returned:', await page.evaluate(() => !document.body.classList.contains('is-detached')));
console.log('errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
