// Two features: one-tap PREMADE status chips in the effect requesters (side-
// filtered, Crystal Curse toggles), and the sustenance verb — eating or
// drinking refills exactly 1 Stamina when below max, silently nothing at max.
import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A bold adventurer.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn, ...a) => page.evaluate(fn, ...a);
let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; };
const chatLen = () => D(() => SillyTavern.getContext().chat.length);

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
  await wait(5000);
  await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

  // ── Sustenance: +1 below max, silent at max ──
  await D(() => window.rpgCustodianDebug.hurt('player', 2));
  let sta = await D(() => window.rpgCustodianDebug.stamina());
  const max = await D(() => window.rpgCustodianDebug.maxStamina());
  let before = await chatLen();
  await D(() => window.rpgCustodianDebug.eat()); await wait(300);
  check('eating refills exactly 1 stamina', (await D(() => window.rpgCustodianDebug.stamina())) === sta + 1, `${sta} → ${sta + 1}/${max}`);
  check('refreshment announces itself', await D((n) => SillyTavern.getContext().chat.slice(n).some(m => (m.mes || '').includes('🍖')), before));
  await D(() => window.rpgCustodianDebug.eat()); await wait(300);
  check('second bite refills the rest', (await D(() => window.rpgCustodianDebug.stamina())) === max);
  before = await chatLen();
  await D(() => window.rpgCustodianDebug.eat()); await wait(300);
  check('eating at full stamina does nothing, silently', (await D(() => window.rpgCustodianDebug.stamina())) === max && (await chatLen()) === before);

  // The effect verb routes through applyEffects too.
  await D(() => window.rpgCustodianDebug.hurt('player', 1));
  await D(() => window.rpgCustodianDebug.applyEffects({ type: 'sustenance' })); await wait(300);
  check('sustenance effect verb heals through applyEffects', (await D(() => window.rpgCustodianDebug.stamina())) === max);

  // ── Presets: engine path ──
  await D(() => window.rpgCustodianDebug.addStatus('player', { preset: 'pent_up' }));
  const pent = (await D(() => window.rpgCustodianDebug.statuses('player'))).find(s => s.name === 'Pent Up');
  check('pent_up preset resolves on the player', !!pent && pent.mods?.[0]?.stat === 'virility' && pent.mods[0].amount === 1, JSON.stringify(pent?.mods));
  await D(() => window.rpgCustodianDebug.addStatus('Marta', { preset: 'cum_plugged' }));
  check('cum_plugged preset resolves on an NPC', (await D(() => window.rpgCustodianDebug.statuses('Marta'))).some(s => s.name === 'Cum Plugged'));
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Pent Up'));
  await D(() => window.rpgCustodianDebug.removeStatus('Marta', 'Cum Plugged'));

  // ── Presets: chips in the Edit Character panel ──
  await D(() => { $('#rpg-menu-popup').remove(); document.getElementById('rpg-menu-button').click(); }); await wait(300);
  await D(() => [...document.querySelectorAll('#rpg-menu-popup .rpg-menu-item')].find(r => r.textContent.includes('Edit Character'))?.click()); await wait(800);
  check('player editor opens', await D(() => !!document.getElementById('rpg-player-overlay')));
  const chips = await D(() => [...document.querySelectorAll('#pe-presets .rpg-map-btn')].map(b => b.textContent.trim()));
  check('player chips: Pent Up + Crystal Curse', chips.includes('Pent Up') && chips.some(c => c.includes('Crystal Curse')), JSON.stringify(chips));
  check('player chips exclude her-side presets', !chips.includes('Cum Plugged') && !chips.includes('Stimulated Ovaries'));
  const ref = await D(() => [...document.querySelectorAll('#rpg-player-overlay .pe-preset-ref-row')].map(r => r.textContent));
  check('reference list describes the player-side premades', ref.some(t => t.includes('Pent Up') && t.includes('unspent too long')) && ref.some(t => t.includes('Crystal Curse') && t.includes('soulgem')), JSON.stringify(ref.map(t => t.slice(0, 40))));
  check('reference list is side-filtered too', !ref.some(t => t.includes('Cum Plugged')));
  await D(() => { [...document.querySelectorAll('#pe-presets .rpg-map-btn')].find(b => b.textContent.trim() === 'Pent Up')?.click(); }); await wait(300);
  check('chip applies Pent Up', (await D(() => window.rpgCustodianDebug.statuses('player'))).some(s => s.name === 'Pent Up'));
  await D(() => { [...document.querySelectorAll('#pe-presets .rpg-map-btn')].find(b => b.textContent.includes('Crystal Curse'))?.click(); }); await wait(300);
  check('curse chip applies the Crystal Curse', await D(() => window.rpgCustodianDebug.isCursed('player')));
  await D(() => { [...document.querySelectorAll('#pe-presets .rpg-map-btn')].find(b => b.textContent.includes('Crystal Curse'))?.click(); }); await wait(300);
  check('curse chip toggles it off again', !(await D(() => window.rpgCustodianDebug.isCursed('player'))));
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Pent Up'));
  await D(() => { $('#rpg-player-overlay').remove(); });

  // ── Presets: chips + reference in the NPC live-effects panel ──
  await D(() => window.rpgCustodianDebug.npcFx('Marta')); await wait(600);
  check('NPC effects panel opens', await D(() => !!document.getElementById('rpg-cast-overlay')));
  const nChips = await D(() => [...document.querySelectorAll('#ne-presets .rpg-map-btn')].map(b => b.textContent.trim()));
  check('NPC chips: her-side presets + curse', nChips.includes('Cum Plugged') && nChips.includes('Stimulated Ovaries') && nChips.some(c => c.includes('Crystal Curse')), JSON.stringify(nChips));
  check('NPC chips exclude player-side presets', !nChips.includes('Pent Up'));
  const nRef = await D(() => [...document.querySelectorAll('#rpg-cast-overlay .pe-preset-ref-row')].map(r => r.textContent));
  check('NPC reference list describes her premades', nRef.some(t => t.includes('Cum Plugged')) && nRef.some(t => t.includes('Stimulated Ovaries')) && !nRef.some(t => t.includes('Pent Up')), JSON.stringify(nRef.map(t => t.slice(0, 30))));
  await D(() => { [...document.querySelectorAll('#ne-presets .rpg-map-btn')].find(b => b.textContent.trim() === 'Cum Plugged')?.click(); }); await wait(300);
  check('NPC chip applies Cum Plugged to her', (await D(() => window.rpgCustodianDebug.statuses('Marta'))).some(s => s.name === 'Cum Plugged'));
  await D(() => window.rpgCustodianDebug.removeStatus('Marta', 'Cum Plugged'));
  await D(() => { $('#rpg-cast-overlay').remove(); });

  // ── Custodian judgment: eating emits sustenance, small talk does not ──
  const RUNS = 3;
  for (const [label, want, text] of [
    ['eating bread and ale', true, 'I tear off a hunk of bread, wolf it down, and wash it back with a swig of ale.'],
    ['plain small talk', false, 'I lean on the bar and chat with Marta about the weather.'],
  ]) {
    let hit = 0, died = 0;
    for (let r = 0; r < RUNS; r++) {
      const res = await D(async (t) => {
        const i = await window.rpgCustodianDebug.analyze(t);
        return { died: !i || i.analyzerFailed, has: [...(i?.effects_on_success || []), ...(i?.effects_on_failure || [])].some(e => e.type === 'sustenance') };
      }, text);
      if (res.died) { died++; continue; }
      if (res.has === want) hit++;
    }
    check(`${label} → sustenance ${want ? 'emitted' : 'NOT emitted'}`, hit > (RUNS - died) / 2, `${hit}/${RUNS - died}${died ? ` (died ${died}x)` : ''}`);
  }

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
