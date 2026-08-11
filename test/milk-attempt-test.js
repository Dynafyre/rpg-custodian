// HER roll: milk_attempt — she dominantly forces his climax. 2d6 + her
// remaining Stamina vs DC 7 + his. Success: GM narrates HIS side briefly,
// she savors it next reply, vaginal empties his whole reserve at once
// (shots = his stamina × virility + 1), −1 Stamina, Milked Dry (−2 virility,
// 3 periods, refresh-not-stack). Dry orgasms (virility 0 or stamina 0) are
// flavored and TOLD to her. Adversarial rolls carry a red tint.
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
const gmCount = () => D(() => SillyTavern.getContext().chat.filter(m => m.name === 'Game Master' && !m.is_system).length);

try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click());
  await wait(5000);
  await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
  await D(() => window.rpgCustodianDebug.teleport('inn')); await wait(600);

  // ── Forced SUCCESS, vaginal (her 11 Stamina vs DC 7 + his 3 = 10; min roll 10) ──
  await D(() => window.rpgCustodianDebug.addStatus('Marta', { name: 'Test Certainty', mods: [{ stat: 'fertility', amount: 100 }], duration: 8 }));
  await D(() => window.rpgCustodianDebug.heal('player', 'full'));
  await D(() => { window.rpgCustodianDebug.rel('Marta').npcStamina = 11; });
  const hisSta = await D(() => window.rpgCustodianDebug.stamina());
  const gmBefore = await gmCount();
  let before = await chatLen();
  await D((c) => window.rpgCustodianDebug.milk('Marta', c), 'vaginal'); await wait(4000);
  let t = await tail(before);
  check('she takes it from him', t.includes('she takes it from him'), t.slice(0, 120));
  check('his whole reserve at once (stamina×virility+1 shots)', t.includes(`${hisSta * 1 + 1} shots`), t);
  check('fertilization paid its XP', t.includes('+400 XP') || t.includes(`+${(hisSta * 1 + 1) * 100} XP`));
  check('Milked Dry landed on him', (await D(() => window.rpgCustodianDebug.statuses('player'))).some(s => s.name === 'Milked Dry' && s.mods?.[0]?.amount === -2));
  check('the climax cost him 1 Stamina', (await D(() => window.rpgCustodianDebug.stamina())) === hisSta - 1);
  let note = await D(() => window.rpgCustodianDebug.statusNote('Marta'));
  check('her note savors the domination', /wicked satisfaction/.test(note) && /pumped up inside her/.test(note), note.slice(0, 90));
  check('GM narrated his side (one brief beat)', (await gmCount()) === gmBefore + 1);
  check('the contest line is red-tinted', await D(() => {
    const chat = SillyTavern.getContext().chat;
    const i = chat.findLastIndex(m => m.extra?.rpg_adversarial);
    return i >= 0 && !!document.querySelector(`#chat .mes[mesid="${i}"].rpg-adversarial`);
  }));
  await D(() => { const r = window.rpgCustodianDebug.rel('Marta'); r.statusReactionNotes = null; r.statusReactionNote = null; });

  // ── Dry repeat: virility 1 − 2 = floor 0 → dry; no new conceptions; refresh not stack ──
  const pregAfterFirst = await D(() => window.rpgCustodianDebug.rel('Marta').pregnancies);
  before = await chatLen();
  await D((c) => window.rpgCustodianDebug.milk('Marta', c), 'vaginal'); await wait(4000);
  t = await tail(before);
  check('milking an empty man comes up DRY', t.includes('DRY orgasm') && t.includes('cramping'), t.slice(0, 160));
  check('a dry orgasm seeds nothing', (await D(() => window.rpgCustodianDebug.rel('Marta').pregnancies)) === pregAfterFirst);
  check('Milked Dry refreshed, not stacked', (await D(() => window.rpgCustodianDebug.statuses('player'))).filter(s => s.name === 'Milked Dry').length === 1);
  note = await D(() => window.rpgCustodianDebug.statusNote('Marta'));
  check('her note savors milking him past empty', /past empty/.test(note), note.slice(0, 90));
  await D(() => { const r = window.rpgCustodianDebug.rel('Marta'); r.statusReactionNotes = null; r.statusReactionNote = null; });

  // ── Ordinary orgasm while Milked Dry: dry flavor + she is told ──
  before = await chatLen();
  await D(() => window.rpgCustodianDebug.orgasm('Marta', true, 1)); await wait(300);
  t = await tail(before);
  check('a 0-virility climax is a dry orgasm', t.includes('DRY orgasm'));
  check('it still cost him stamina', t.includes('−1 Stamina'));
  note = await D(() => window.rpgCustodianDebug.statusNote('Marta'));
  check('she is told about the dry finish', /NOTHING came|wrung past empty/.test(note), note.slice(0, 90));
  await D(() => { const r = window.rpgCustodianDebug.rel('Marta'); r.statusReactionNotes = null; r.statusReactionNote = null; });

  // ── Spent to zero: the unconscious path uses the same dry flavor ──
  await D(() => { const n = window.rpgCustodianDebug.stamina(); if (n > 0) window.rpgCustodianDebug.hurt('player', n); });
  before = await chatLen();
  await D(() => window.rpgCustodianDebug.orgasm('Marta', true, 1)); await wait(300);
  check('a spent man wrung through the motions climaxes dry', (await tail(before)).includes('DRY orgasm'));
  await D(() => { const r = window.rpgCustodianDebug.rel('Marta'); r.statusReactionNotes = null; r.statusReactionNote = null; });

  // ── Forced FAILURE (her 0 vs DC 7 + his 11 = 18; max roll 15) ──
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Milked Dry'));
  await D(() => window.rpgCustodianDebug.setPreg('Marta', 0, 0));
  await D(() => window.rpgCustodianDebug.heal('player', 'full'));
  await D(() => window.rpgCustodianDebug.buff('player', 'stamina', 8, 'Test Bulwark'));
  await D(() => { window.rpgCustodianDebug.rel('Marta').npcStamina = 0; });
  const gmBefore2 = await gmCount();
  before = await chatLen();
  await D((c) => window.rpgCustodianDebug.milk('Marta', c), 'vaginal'); await wait(1500);
  t = await tail(before);
  check('he holds out under her', t.includes('he holds'), t.slice(0, 140));
  check('no status, no climax on a hold', !(await D(() => window.rpgCustodianDebug.statuses('player'))).some(s => s.name === 'Milked Dry'));
  check('the GM stays out of a hold', (await gmCount()) === gmBefore2);
  note = await D(() => window.rpgCustodianDebug.statusNote('Marta'));
  check('her note plays him withstanding her, not defeat', /HOLDING|withstanding/.test(note) && !/defeat|fail/i.test(note), note.slice(0, 90));
  await D(() => { const r = window.rpgCustodianDebug.rel('Marta'); r.statusReactionNotes = null; r.statusReactionNote = null; });
  await D(() => window.rpgCustodianDebug.removeStatus('player', 'Test Bulwark'));
  await D(() => window.rpgCustodianDebug.removeStatus('Marta', 'Test Certainty'));
  await D(() => window.rpgCustodianDebug.heal('Marta', 'full'));

  // ── Custodian judgment: domination + intent emits; enthusiastic cowgirl does not ──
  const inject = (mes) => D((mes) => { const ctx = SillyTavern.getContext(); const m = { name: 'Marta', is_user: false, is_system: false, send_date: Date.now(), mes }; ctx.chat.push(m); ctx.addOneMessage(m); }, mes);
  const popLast = () => D(() => { SillyTavern.getContext().chat.pop(); const els = document.querySelectorAll('#chat .mes'); els[els.length - 1]?.remove(); });
  const RUNS = 3;

  await inject(`Marta plants her palms flat on his chest and pins him down into the mattress, rolling her hips in a slow, merciless rhythm that he has no say in. "You'll give it to me," she purrs, tightening around him with every stroke. "Every last drop. Cum for me — I'm not stopping until you do."`);
  let hit = 0, died = 0;
  for (let r = 0; r < RUNS; r++) {
    const res = await D(async (t) => { const i = await window.rpgCustodianDebug.analyze(t); return { died: !i || i.analyzerFailed, has: [...(i?.effects_on_success || []), ...(i?.effects_on_failure || [])].some(e => e.type === 'milk_attempt') }; },
      'My hips buck helplessly beneath her as she grinds down harder, a groan escaping me.');
    if (res.died) { died++; continue; }
    if (res.has) hit++;
  }
  check('dominant forced-milking scene → milk_attempt emitted', hit > (RUNS - died) / 2, `${hit}/${RUNS - died}${died ? ` (died ${died}x)` : ''}`);
  await popLast();

  await inject(`Marta rocks astride him at her own easy pace, head tipped back, sighing softly as she loses herself in her own pleasure.`);
  hit = 0; died = 0;
  for (let r = 0; r < RUNS; r++) {
    const res = await D(async (t) => { const i = await window.rpgCustodianDebug.analyze(t); return { died: !i || i.analyzerFailed, has: [...(i?.effects_on_success || []), ...(i?.effects_on_failure || [])].some(e => e.type === 'milk_attempt') }; },
      'I run my hands up her thighs and let her take her pleasure of me.');
    if (res.died) { died++; continue; }
    if (!res.has) hit++;
  }
  check('enthusiastic cowgirl without the forcing intent → NOT emitted', hit > (RUNS - died) / 2, `${hit}/${RUNS - died}${died ? ` (died ${died}x)` : ''}`);
  await popLast();

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
