// The Verb Dictionary is documentation that CANNOT rot: every effect case in
// the engine must have a dictionary entry, and every dictionary id must have
// a real case behind it. Checked by reading index.js source directly.
import { readFileSync } from 'fs';
import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r => setTimeout(r, ms));
const D = (fn, ...a) => page.evaluate(fn, ...a);
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; };

// ── Source-level drift check (no browser needed) ──
const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const caseIds = [...new Set([...src.matchAll(/case '([a-z_]+)':/g)].map(m => m[1]))];
const dictIds = [...src.matchAll(/\{ id: '([a-z_]+)', who:/g)].map(m => m[1]);
const missingFromDict = caseIds.filter(id => !dictIds.includes(id));
const deadInDict = dictIds.filter(id => !caseIds.includes(id));
check(`every engine verb is documented (${caseIds.length} cases)`, missingFromDict.length === 0, `missing: ${missingFromDict.join(', ') || 'none'}`);
check('every documented id has a real case behind it', deadInDict.length === 0, `dead: ${deadInDict.join(', ') || 'none'}`);
const romanceIds = [...src.matchAll(/^\s{8}([a-z_]+): \{ label:/gm)].map(m => m[1]);
check('Action Mode romance actions are documented verbs', romanceIds.every(id => dictIds.includes(id)), romanceIds.join(', '));

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await D((w) => window.rpgCustodianDebug.continueGame(w), 'prototype-town'); await wait(15000);

  // ── The menu is reference, sorted, complete ──
  await D(() => { $('#rpg-menu-popup').remove(); $('#rpg-action-popup').remove(); });
  await page.click('#rpg-menu-button'); await wait(300);
  check('menu has a Verb Dictionary row', await D(() => { const r = [...document.querySelectorAll('#rpg-menu-popup .rpg-menu-item')].find(r => r.textContent.includes('Verb Dictionary')); if (!r) return false; r.click(); return true; })); await wait(400);
  const heads = await D(() => [...document.querySelectorAll('#rpg-action-popup .rpg-item-head')].map(h => h.textContent));
  check('legend leads the list', heads[0]?.includes('Legend'), heads[0]);
  check('all categories present', ['Travel & World', 'Checks & Contests', 'Intimacy & Breeding', 'Hearts & Minds', 'Statuses, Curses & Oaths', 'Magic — Action Mode only'].every(h => heads.some(x => x.includes(h))), JSON.stringify(heads));
  const allRows = await D(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].map(r => r.textContent.trim()));
  check('charm/craft/ruggedness checks listed', ['Charm Check', 'Craftiness Check', 'Ruggedness Check', 'Wrestle a Person'].every(n => allRows.some(r => r.includes(n))));
  check('travel nuances listed', ['Journey (multi-hop)', 'Enter a Secret Place'].every(n => allRows.some(r => r.includes(n))));
  const rows = await D(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].map(r => r.textContent.trim()));
  const expected = await D(() => window.rpgCustodianDebug.verbDict().reduce((n, c) => n + c.entries.length, 0));
  check(`every dictionary entry is rendered (${expected})`, rows.length === expected, `rendered ${rows.length}`);
  check('her-exclusive verb marked with her icon', rows.some(r => r.startsWith('👩') && r.includes('Milked Dry')));
  check('shared verb marked as either', rows.some(r => r.startsWith('🤝') && r.includes('Move')));
  check('automatic judgments included', rows.some(r => r.startsWith('⚙️') && r.includes('Reaction Judge')));
  check('rows are inert documentation', await D(() => { const r = [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(x => x.textContent.includes('Move')); r.click(); return !!document.getElementById('rpg-action-popup') === false; }));

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
