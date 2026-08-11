// ACTION MODE: menu declares WHAT, the Action Judge reads WHO/HOW, the
// freeform pipeline is bypassed for exactly one armed message. Spellcasting
// lives only here. First spell: Summon Lover (4 mana, escort-pin in reverse).
import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A bold adventurer.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn, ...a) => page.evaluate(fn, ...a);
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; };
const chatLen = () => D(() => SillyTavern.getContext().chat.length);
const tail = (n) => D((n) => SillyTavern.getContext().chat.slice(n).map(m => m.mes).join('\n'), n);
const idle = async (max = 60) => { for (let i = 0; i < max; i++) { await wait(2000); if (!(await D(() => window.rpgCustodianDebug.busy()))) break; } await wait(1500); };
const act = async (t) => { await D((t) => window.rpgCustodianDebug.act(t), t); await idle(); };
const openMenu = async () => { await D(() => { $('#rpg-menu-popup').remove(); $('#rpg-action-popup').remove(); }); await page.click('#rpg-menu-button'); await wait(300); };
const clickMenuRow = (text) => D((t) => { const r = [...document.querySelectorAll('#rpg-menu-popup .rpg-menu-item')].find(r => r.textContent.includes(t)); if (!r) return false; r.click(); return true; }, text);
const clickPopupRow = (text) => D((t) => { const r = [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(r => r.textContent.includes(t)); if (!r) return false; r.click(); return true; }, text);
const popupRows = () => D(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].map(r => r.textContent.trim()));

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
  await wait(5000);
  await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
  await D(() => window.rpgCustodianDebug.teleport('inn')); await wait(600);
  await D(() => window.rpgCustodianDebug.rel('Sylvara'));   // he has met the dragoness

  // ── Menu flow + arming UI ──
  await openMenu();
  check('menu has an Action Mode row', await clickMenuRow('Action Mode')); await wait(300);
  let rows = await popupRows();
  check('categories: Spell / Romance / Combat', rows.some(r => r.includes('Cast a Spell')) && rows.some(r => r.includes('Romance')) && rows.some(r => r.includes('Combat')), JSON.stringify(rows));
  check('spell row shows the mana pool', rows.some(r => /Mana \d+\/\d+/.test(r)));
  await clickPopupRow('Romance'); await wait(300);
  rows = await popupRows();
  check('romance lists both contests', rows.some(r => r.includes('Ovary Stimulation')) && rows.some(r => r.includes('Cervix Press')), JSON.stringify(rows));
  await clickPopupRow('Ovary Stimulation'); await wait(300);
  check('arming tints the input yellow', await D(() => document.getElementById('send_textarea')?.classList.contains('rpg-armed')));
  check('reminder text sits in the input background', await D(() => (document.getElementById('send_textarea')?.getAttribute('placeholder') || '').includes('Ovary Stimulation')));
  await openMenu();
  check('menu row shows the armed action', (await D(() => [...document.querySelectorAll('#rpg-menu-popup .rpg-menu-item')].map(r => r.textContent))).some(r => r.includes('armed: Ovary Stimulation')));
  await clickMenuRow('Action Mode'); await wait(300);
  check('Cancel row offered while armed', await clickPopupRow('Cancel')); await wait(300);
  check('cancel disarms and clears the tint', !(await D(() => window.rpgCustodianDebug.armed())) && !(await D(() => document.getElementById('send_textarea')?.classList.contains('rpg-armed'))));

  // ── Interception: conversational words still fire EXACTLY the armed action ──
  const eff = await D(() => { const c = window.rpgCustodianDebug.rollCheck('craftiness', 8); return c.eff; });
  await D((amt) => window.rpgCustodianDebug.buff('player', 'craftiness', amt, 'Test Butterfingers'), 0 - eff);
  await D(() => { window.rpgCustodianDebug.rel('Marta').npcStamina = 12; });   // DC 19 ±2 judge nudge → still > max 15
  await D(() => window.rpgCustodianDebug.armRomance('belly_massage'));
  let before = await chatLen();
  await act('I hum an old road song and let my hands wander over her, easy as anything.');
  let t = await tail(before);
  check('armed action fired despite conversational words', t.includes('Knowing hands'), t.slice(0, 120));
  check('forced miss holds even with the judge nudge', t.includes('A pleasant kneading, no more'));
  check('no freeform analyzer artifacts on the armed turn', !t.includes('📦') && !t.includes('✔️'));
  check('arm is one-shot — disarmed after firing', !(await D(() => window.rpgCustodianDebug.armed())));
  check('she replied to the armed action', await D((n) => SillyTavern.getContext().chat.slice(n).some(m => m.name === 'Marta' && !m.is_system), before));
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Test Butterfingers'));
  await D(() => window.rpgCustodianDebug.heal('Marta', 'full'));

  // ── Spell menu gating: not enough mana → ⛔, no arm ──
  await D(() => window.rpgCustodianDebug.setMana(0));
  await openMenu(); await clickMenuRow('Action Mode'); await wait(300);
  await clickPopupRow('Cast a Spell'); await wait(300);
  rows = await popupRows();
  check('summon rows listed per known woman', rows.some(r => r.includes('Summon Lover: Sylvara')), JSON.stringify(rows));
  check('mana-short row is blocked', rows.some(r => r.includes('not enough Mana')));
  await clickPopupRow('Summon Lover: Sylvara'); await wait(300);
  check('blocked row does not arm', !(await D(() => window.rpgCustodianDebug.armed())));

  // ── Summon Lover end-to-end ──
  await D((amt) => window.rpgCustodianDebug.buff('player', 'craftiness', amt, 'Test Attunement'), 6 - eff);   // maxMana 6
  await D(() => window.rpgCustodianDebug.setMana(6));
  await D(() => window.rpgCustodianDebug.setAffection('Sylvara', 8));
  check('Sylvara is elsewhere before the summon', !(await D(() => window.rpgCustodianDebug.presence())).includes('Sylvara'));
  await openMenu(); await clickMenuRow('Action Mode'); await wait(300);
  await clickPopupRow('Cast a Spell'); await wait(300);
  check('affordable summon row arms', (await clickPopupRow('Summon Lover: Sylvara'), await wait(300), !!(await D(() => window.rpgCustodianDebug.armed()))));
  const gmBefore = await D(() => SillyTavern.getContext().chat.filter(m => m.name === 'Game Master' && !m.is_system).length);
  before = await chatLen();
  await act('I carve her sigil into the air with two fingers and speak her name into the folding dark.');
  t = await tail(before);
  check('the spell announces itself and its cost', t.includes('Summon Lover') && t.includes('4 Mana'), t.slice(0, 140));
  check('mana was spent', (await D(() => window.rpgCustodianDebug.mana())).cur === 2);
  check('Sylvara stands at his side', (await D(() => window.rpgCustodianDebug.presence())).includes('Sylvara'));
  check('the summon pin holds her here', await D((l) => { const r = window.rpgCustodianDebug.rel('Sylvara'); return r.partedAt === l && r.partedStep === (window.rpgCustodianDebug.state().timeStep || 0); }, 'inn'));
  check('the GM narrated the arrival', (await D(() => SillyTavern.getContext().chat.filter(m => m.name === 'Game Master' && !m.is_system).length)) > gmBefore);
  check('she answered her own summons', await D((n) => SillyTavern.getContext().chat.slice(n).some(m => m.name === 'Sylvara' && !m.is_system), before));

  // Summoning someone already present fizzles without spending.
  await D(() => window.rpgCustodianDebug.setMana(6));   // rule out the mana fizzle masking this one
  await D(() => window.rpgCustodianDebug.armSummon('Sylvara'));
  before = await chatLen();
  await act('I trace the sigil again, just to see.');
  check('already-present summon fizzles, nothing spent', (await tail(before)).includes('already at your side') && (await D(() => window.rpgCustodianDebug.mana())).cur === 6);

  // ── Freeform play untouched after all this ──
  before = await chatLen();
  await act('"Marta, how fares the inn this morning?"');
  t = await tail(before);
  check('freeform turn runs the normal pipeline', !t.includes('Knowing hands') && !t.includes('Summon Lover'));
  check('and Marta simply answers', await D((n) => SillyTavern.getContext().chat.slice(n).some(m => m.name === 'Marta' && !m.is_system), before));

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
