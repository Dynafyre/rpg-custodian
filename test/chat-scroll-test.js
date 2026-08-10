// On page load the chat must settle at the BOTTOM, even though late content
// (avatars, images, long history) keeps growing it after ST's own scroll.
// A deliberate user scroll-up must cancel the pin, never be fought.
// The chat must genuinely OVERFLOW for any of this to mean anything — an
// earlier draft passed vacuously on a short chat (full == client).
import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r => setTimeout(r, ms));
const D = (fn, ...a) => page.evaluate(fn, ...a);
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; };

const scrollState = () => D(() => { const c = document.getElementById('chat'); return { top: c.scrollTop, client: c.clientHeight, full: c.scrollHeight }; });
const atBottom = (s) => s.top + s.client >= s.full - 60;
const settle = async () => { await page.waitForSelector('#chat', { timeout: 45000 }); await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close())); await wait(6500); };

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  // Open the RPG group chat and make sure it overflows, then persist it so a
  // reload reopens this same long chat.
  await D((w) => window.rpgCustodianDebug.continueGame(w), 'prototype-town'); await wait(15000);
  for (let i = 0; i < 25; i++) await D(() => window.rpgCustodianDebug.look());
  await D(() => SillyTavern.getContext().saveChat()); await wait(1500);
  await wait(6000);
  let s = await scrollState();
  check('the chat genuinely overflows', s.full > s.client * 2, JSON.stringify(s));
  check('chat sits at the bottom after opening the long chat', atBottom(s), JSON.stringify(s));

  // Reload, then reopen the long RPG chat (the headless profile does not
  // restore the group on its own) — the pin must land it at the bottom.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle();
  await D((w) => window.rpgCustodianDebug.continueGame(w), 'prototype-town'); await wait(15000);
  s = await scrollState();
  check('still overflowing after reload + reopen', s.full > s.client * 2, JSON.stringify(s));
  check('chat sits at the bottom after reload + reopen', atBottom(s), JSON.stringify(s));

  // A deliberate scroll-up during the pin window must stick. Unit-drive the
  // pin (no ST messages arriving to muddy it): start a fresh pin, scroll up
  // with a wheel event mid-window, and the pin must stand down.
  await D(() => window.rpgCustodianDebug.pinChat(4000)); await wait(300);
  await D(() => { const c = document.getElementById('chat'); c.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true })); c.scrollTop = 0; });
  await wait(2500);   // pin window still open — must have been cancelled
  s = await scrollState();
  check('a user scroll-up is respected, not fought', s.top < s.full - s.client - 200, JSON.stringify(s));
  // And with no interaction, a pin from that same spot re-bottoms the chat.
  await D(() => window.rpgCustodianDebug.pinChat(2000)); await wait(800);
  s = await scrollState();
  check('an undisturbed pin returns to the bottom', atBottom(s), JSON.stringify(s));

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
