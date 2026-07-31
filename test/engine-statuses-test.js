// Engine-owned statuses — applied and removed by the ENGINE from hard numbers,
// never by the Custodian, but riding the normal status system so every surface
// (NPC context, GM narrator, examine, sheet) sees them for free.
//   Exhausted   player at 0 stamina: −2 rug/charm/craft. Replaces the old
//               "UNCONSCIOUS" framing — he is spent, not asleep, and plays on.
//   Unconscious NPC at 0 stamina: descriptive, clears when she regains stamina.
//   Pent Up     8+ time steps with no player orgasm: −1 craftiness, +1 virility.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const player = () => page.evaluate(() => {
    const d = window.rpgCustodianDebug, rd = d.player();
    return {
        stam: d.state().isActive ? rd.stats.stamina : null,
        statuses: (rd.customEffects || []).filter(e => e.active !== false).map(e => e.name),
        engine: (rd.customEffects || []).filter(e => e.engineManaged).map(e => e.engineManaged),
        rug: d.effectiveStat('ruggedness'), charm: d.effectiveStat('charm'),
        craft: d.effectiveStat('craftiness'), vir: d.effectiveStat('virility'),
    };
});
const sync = () => page.evaluate(() => { window.rpgCustodianDebug.save(); });

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
    // fresh slate: recently satisfied, full stamina
    await page.evaluate(() => { const rd = window.rpgCustodianDebug.player(); rd.stats.lastOrgasmStep = window.rpgCustodianDebug.state().timeStep || 0; });
    await sync(); await wait(600);
    const base = await player();
    console.log('baseline:', JSON.stringify(base));
    check('no engine statuses while rested and satisfied', base.engine.length === 0, base.statuses.join(','));

    // ── EXHAUSTED ─────────────────────────────────────────────────────────
    await page.evaluate(() => window.rpgCustodianDebug.hurt('player', 99)); await wait(800);
    const spent = await player();
    console.log('at 0 stamina:', JSON.stringify(spent));
    check('0 stamina applies Exhausted', spent.statuses.includes('Exhausted') && spent.engine.includes('exhausted'), spent.statuses.join(','));
    check('Exhausted costs −2 ruggedness/charm/craftiness',
        spent.rug === base.rug - 2 && spent.charm === base.charm - 2 && spent.craft === base.craft - 2,
        `${base.rug}/${base.charm}/${base.craft} → ${spent.rug}/${spent.charm}/${spent.craft}`);
    const sheet = await page.evaluate(() => window.rpgCustodianDebug.statusText());
    check('the scene context says EXHAUSTED, never unconscious', /EXHAUSTED/.test(sheet) && !/you (are|is) UNCONSCIOUS/i.test(sheet), (sheet.match(/Stamina [^.]*/) || [''])[0]);

    // recovering clears it
    await page.evaluate(() => window.rpgCustodianDebug.heal('player', 'full')); await wait(800);
    const healed = await player();
    check('regaining stamina clears Exhausted', !healed.statuses.includes('Exhausted'), healed.statuses.join(','));
    check('the penalty is gone with it', healed.rug === base.rug && healed.charm === base.charm, `${healed.rug}/${healed.charm}`);

    // ── PENT UP ───────────────────────────────────────────────────────────
    await page.evaluate(() => window.rpgCustodianDebug.tick(7)); await wait(1200); await sync(); await wait(400);
    const almost = await player();
    check('7 steps without release is not yet Pent Up', !almost.statuses.includes('Pent Up'), almost.statuses.join(','));
    await page.evaluate(() => window.rpgCustodianDebug.tick(2)); await wait(1000); await sync(); await wait(400);
    const pent = await player();
    console.log('after 9 steps:', JSON.stringify(pent));
    check('8+ steps applies Pent Up', pent.statuses.includes('Pent Up'), pent.statuses.join(','));
    check('Pent Up is −1 craftiness / +1 virility',
        pent.craft === healed.craft - 1 && pent.vir === healed.vir + 1,
        `craft ${healed.craft}→${pent.craft}, vir ${healed.vir}→${pent.vir}`);
    // release clears it
    await page.evaluate(() => window.rpgCustodianDebug.orgasm('Bryony', false, 1)); await wait(1200); await sync(); await wait(400);
    const after = await player();
    check('an orgasm clears Pent Up', !after.statuses.includes('Pent Up'), after.statuses.join(','));

    // ── NPC UNCONSCIOUS ───────────────────────────────────────────────────
    // time has moved on, so go wherever her schedule actually has her now
    await page.evaluate(() => window.rpgCustodianDebug.teleport(window.rpgCustodianDebug.slot('Bryony').loc)); await wait(1200);
    await page.evaluate(() => window.rpgCustodianDebug.hurt('Bryony', 99)); await wait(1000); await sync(); await wait(500);
    const npc = await page.evaluate(() => {
        const r = window.rpgCustodianDebug.player().relationships['Bryony'] || {};
        return { ko: !!r.npcUnconscious, statuses: (r.customEffects || []).filter(e => e.active !== false).map(e => e.name), engine: (r.customEffects || []).filter(e => e.engineManaged).map(e => e.engineManaged) };
    });
    console.log('KO\'d NPC:', JSON.stringify(npc));
    check('a KO\'d NPC carries the Unconscious status', npc.ko && npc.statuses.includes('Unconscious'), npc.statuses.join(','));
    // the MECHANICAL readout (🔍), not the LLM appearance blurb that follows it
    const exam = await page.evaluate(async () => {
        const before = SillyTavern.getContext().chat.length;
        await window.rpgCustodianDebug.examineNpc('Bryony');
        return (SillyTavern.getContext().chat.slice(before).map(m => m.mes || '').find(t => t.includes('🔍')) || '');
    });
    check('examine shows her state', /Unconscious|UNCONSCIOUS/.test(exam), (exam.match(/Stamina[^\n]*/) || [''])[0]);
    await page.evaluate(() => window.rpgCustodianDebug.heal('Bryony', 'full')); await wait(1000); await sync(); await wait(500);
    const woke = await page.evaluate(() => {
        const r = window.rpgCustodianDebug.player().relationships['Bryony'] || {};
        return { ko: !!r.npcUnconscious, statuses: (r.customEffects || []).filter(e => e.active !== false).map(e => e.name) };
    });
    check('reviving her clears it', !woke.ko && !woke.statuses.includes('Unconscious'), woke.statuses.join(','));

    // ── they must not pile up ─────────────────────────────────────────────
    await page.evaluate(() => { for (let i = 0; i < 5; i++) window.rpgCustodianDebug.save(); }); await wait(800);
    const dup = await player();
    check('repeated syncs never duplicate a status', new Set(dup.statuses).size === dup.statuses.length, dup.statuses.join(','));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
