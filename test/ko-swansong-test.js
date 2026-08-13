// A newly-felled NPC owes the scene ONE reply — the collapse itself — before
// unconsciousness means silence. Repro of the live buzzkill: breach-climax
// spends her last Stamina, and the old guard answered the payoff moment with
// "💤 cannot respond".
import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A bold adventurer.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn, ...a) => page.evaluate(fn, ...a);
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; };
const chatLen = () => D(() => SillyTavern.getContext().chat.length);
const tail = (n) => D((n) => SillyTavern.getContext().chat.slice(n).map(m => `${m.name}${m.is_system ? '·sys' : ''}: ${m.mes}`).join('\n'), n);
const idle = async (max = 60) => { for (let i = 0; i < max; i++) { await wait(2000); if (!(await D(() => window.rpgCustodianDebug.busy()))) break; } await wait(1500); };
const act = async (t) => { await D((t) => window.rpgCustodianDebug.act(t), t); await idle(); };

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
  await wait(5000);
  await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
  await D(() => window.rpgCustodianDebug.teleport('inn')); await wait(600);

  // Clean slate, then the exact live scenario: her last Stamina spent by the breach climax.
  await D(() => { window.rpgCustodianDebug.removeStatus('Marta', 'Sanctuary Breached'); window.rpgCustodianDebug.heal('Marta', 'full'); });
  const eff = await D(() => { const c = window.rpgCustodianDebug.rollCheck('ruggedness', 8); return c.eff; });
  await D((amt) => window.rpgCustodianDebug.buff('player', 'ruggedness', amt, 'Test Might'), 12 - eff);
  await D(() => { window.rpgCustodianDebug.rel('Marta').npcStamina = 1; });
  await D(() => window.rpgCustodianDebug.armRomance('cervix_press'));
  let before = await chatLen();
  await act('I press deeper, claiming her final gate for my own.');
  let t = await tail(before);
  check('the breach landed and spent her last Stamina', t.includes('Sanctuary Breached') && (await D(() => window.rpgCustodianDebug.rel('Marta').npcStamina)) === 0, t.slice(0, 120));
  check('she is unconscious after the collapse', await D(() => window.rpgCustodianDebug.rel('Marta').npcUnconscious));
  check('NO buzzkill — the 💤 line never appeared', !t.includes('cannot respond'));
  check('she played her swan song (a real reply)', await D((n) => SillyTavern.getContext().chat.slice(n).some(m => m.name === 'Marta' && !m.is_system && (m.mes || '').length > 40), before));
  check('the swan song is spent', !(await D(() => window.rpgCustodianDebug.rel('Marta').koReplyOwed)));

  // Now that the song is sung, unconsciousness means silence.
  before = await chatLen();
  await act('"Marta? Stay with me, love — are you there?"');
  t = await tail(before);
  check('a second address meets the 💤 guard', t.includes('unconscious and cannot respond'));
  check('and no new reply from her', !(await D((n) => SillyTavern.getContext().chat.slice(n).some(m => m.name === 'Marta' && !m.is_system), before)));

  // Flag hygiene: combat KO owes a song too; waking clears an unsung one.
  await D(() => window.rpgCustodianDebug.heal('Marta', 'full'));
  await D(() => window.rpgCustodianDebug.hurt('Marta', 99));
  check('a combat KO owes the swan song', await D(() => window.rpgCustodianDebug.rel('Marta').koReplyOwed === true));
  await D(() => window.rpgCustodianDebug.tick(3)); await wait(800);
  check('waking on her own clears the unsung song', await D(() => { const r = window.rpgCustodianDebug.rel('Marta'); return !r.npcUnconscious && !r.koReplyOwed; }));
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Test Might'));
  await D(() => window.rpgCustodianDebug.removeStatus('Marta', 'Sanctuary Breached'));

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
