// 8-day fertility cycle (moon phases):
//  1. cycle step derives from a stable age+name seed and advances each day
//  2. fertilityPercent = cycle % + card mod + status mods, clamped 0-100
//  3. examine/Look prints phase + % (mechanical block)
//  4. peak/anti-peak rides the NPC context block (guarded variant at low aff)
//  5. cast editor: fertile-days/peak calc (debounced), womb type, pregnancies,
//     progress — saved, seeded into a fresh game, ⚡-applied live
//  6. overdue mothers nag EVERY time step
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const PCT = [0, 10, 20, 30, 40, 30, 20, 10];

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }

    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

    // 1+2. derivation: step advances daily; fert = clamp(cycle + mod)
    const c1 = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const npc = d.state().npcRoster.find(n => n.name === 'Bryony');
        return { day: d.state().dayCount, mod: Number(npc.fertility) || 0, c: d.cycle('Bryony') };
    });
    check('cycle pct matches step table', c1.c.pct === PCT[c1.c.step], JSON.stringify(c1.c));
    check('fertility = cycle + card mod (clamped)', c1.c.fert === Math.max(0, Math.min(100, c1.c.pct + c1.mod)), `fert ${c1.c.fert} = ${c1.c.pct} + ${c1.mod}`);
    const c2 = await page.evaluate(() => { window.rpgCustodianDebug.tick(4); return window.rpgCustodianDebug.cycle('Bryony'); });
    check('new day advances the cycle one step', c2.step === (c1.c.step + 1) % 8, `${c1.c.step} → ${c2.step}`);
    const stable = await page.evaluate((day) => window.rpgCustodianDebug.cycle('Bryony', day).step, c1.day);
    check('seed is stable (same day → same step)', stable === c1.c.step);

    // status mod folds in
    const buffed = await page.evaluate(() => { window.rpgCustodianDebug.buff('Bryony', 'fertility', 20, 'test tonic'); return window.rpgCustodianDebug.cycle('Bryony').fert; });
    check('status fertility mod folds into the cycle', buffed === Math.max(0, Math.min(100, c2.pct + c1.mod + 20)), `${buffed}`);
    await page.evaluate(() => { const r = window.rpgCustodianDebug.player().relationships['Bryony']; r.customEffects = []; });

    // 3. Look/examine prints phase + % (mechanical, with the moon emoji)
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1200);
    await page.evaluate(() => window.rpgCustodianDebug.examineNpc?.('Bryony') ?? window.rpgCustodianDebug.act('I look Bryony over closely.'));
    for (let i = 0; i < 30; i++) { if (!(await page.evaluate(() => window.rpgCustodianDebug.busy()))) break; await wait(3000); }
    await wait(2000);
    const exa = await page.evaluate(() => [...SillyTavern.getContext().chat].reverse().find(m => (m.mes || '').includes('🌱 Fertility'))?.mes || '');
    const exLine = exa.split('\n').find(l => l.includes('🌱')) || '';
    check('examine prints fertility % + moon phase', /🌱 Fertility: \d+% — [🌑🌒🌓🌔🌕🌖🌗🌘]/u.test(exLine), exLine);

    // 4. peak/anti-peak context: force Bryony to peak by picking the day
    const peakInfo = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const cur = d.cycle('Bryony').step;
        const delta = ((4 - cur) % 8 + 8) % 8;
        if (delta) d.tick(delta * 4);            // whole days to reach 🌕 (tick(0) would still tick once)
        d.player().relationships['Bryony'].affection = 2;   // guarded band
        return { step: d.cycle('Bryony').step, txt: d.statusText() };
    });
    check('reached full-moon peak', peakInfo.step === 4, `step ${peakInfo.step}`);
    check('peak note in her context block', peakInfo.txt.includes('full-moon peak of its fertile cycle'), '');
    check('low affection → guarded phrasing', peakInfo.txt.includes('keep from a man she barely trusts'), '');
    const openInfo = await page.evaluate(() => {
        window.rpgCustodianDebug.player().relationships['Bryony'].affection = 7;
        return window.rpgCustodianDebug.statusText();
    });
    check('high affection → open phrasing', openInfo.includes('may speak of it or act on it as she wishes'), '');
    const ebbInfo = await page.evaluate(() => {
        window.rpgCustodianDebug.tick(4 * 4);    // 4 more days: 🌕 → 🌑
        return { step: window.rpgCustodianDebug.cycle('Bryony').step, txt: window.rpgCustodianDebug.statusText() };
    });
    check('anti-peak (dark-moon) note appears', ebbInfo.step === 0 && ebbInfo.txt.includes('dark-moon ebb'), `step ${ebbInfo.step}`);

    // 6. overdue nag EVERY step
    await page.evaluate(() => window.rpgCustodianDebug.setPreg('Bryony', 1, 100, 'live'));
    const nags = await page.evaluate(async () => {
        const chatLen = () => SillyTavern.getContext().chat.length;
        let count = 0;
        for (let i = 0; i < 2; i++) {
            const before = chatLen();
            window.rpgCustodianDebug.tick(1);
            await new Promise(r => setTimeout(r, 800));
            const msgs = SillyTavern.getContext().chat.slice(before).map(m => m.mes || '');
            if (msgs.some(t => t.includes('overdue'))) count++;
        }
        return count;
    });
    check('overdue nag fires on EVERY time step', nags === 2, `${nags}/2 steps nagged`);
    await page.evaluate(() => window.rpgCustodianDebug.setPreg('Bryony', 0, 0, null));

    // 5. cast editor on a scratch authored world
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        const s = ctx.extensionSettings['rpg-custodian'];
        if (s?.authoredWorlds?.['cycle-proof']) delete s.authoredWorlds['cycle-proof'];
        s.authoredWorlds['cycle-proof'] = {
            worldId: 'cycle-proof', name: 'Cycle Proof', description: 'fertility cycle test world',
            startingLocation: 'nest',
            locations: { nest: { name: 'The Nest', description: 'A quiet nest.', connections: [], background: '' } },
            cast: [], castData: {},
        };
        ctx.saveSettingsDebounced();
        await window.rpgCustodianDebug.refreshWorlds();
    });
    await page.evaluate(() => window.rpgCustodianDebug.adoptCast('cycle-proof', 'Trizel'));
    await page.evaluate(() => window.rpgCustodianDebug.castForm('cycle-proof', 'Trizel')); await wait(600);

    // debounced fertile-days/peak calc
    await page.evaluate(() => { $('#cf-fert').val(-10).trigger('input'); }); await wait(700);
    const calcNeg = await page.evaluate(() => document.querySelector('#cf-fert-calc')?.textContent || '');
    check('calc: mod −10 → 5 fertile days, peak 30%', calcNeg.includes('5 of 8') && calcNeg.includes('peak 30%'), calcNeg.slice(0, 60));
    await page.evaluate(() => { $('#cf-fert').val(25).trigger('input'); }); await wait(700);
    const calcPos = await page.evaluate(() => document.querySelector('#cf-fert-calc')?.textContent || '');
    check('calc: mod +25 → 8 fertile days, peak 65%', calcPos.includes('8 of 8') && calcPos.includes('peak 65%'), calcPos.slice(0, 60));

    // womb/pregnancy fields save into the world block
    await page.evaluate(() => {
        $('#cf-womb').val('egg'); $('#cf-pregs').val(2); $('#cf-prog').val(60);
        $('#cf-save').trigger('click');
    }); await wait(800);
    const saved = await page.evaluate(() => {
        const w = SillyTavern.getContext().extensionSettings['rpg-custodian'].authoredWorlds['cycle-proof'];
        const rc = w.castData['Trizel'].extensions.rpg_custodian;
        return { womb: rc.womb_type, fert: rc.fertility, pregs: rc.base_stats.pregnancies, prog: rc.base_stats.pregnancy_progress };
    });
    check('editor saves womb/fert-mod/pregnancies/progress', saved.womb === 'egg' && saved.fert === 25 && saved.pregs === 2 && saved.prog === 60, JSON.stringify(saved));

    // fresh game seeds the authored pregnancy + womb kind (drop any stale
    // relationship record from earlier test runs — seeding is first-meeting)
    await page.evaluate(() => { delete window.rpgCustodianDebug.player().relationships['Trizel']; });
    await page.evaluate(() => window.rpgCustodianDebug.newGame('cycle-proof')); await wait(20000);
    const seeded = await page.evaluate(() => {
        const r = window.rpgCustodianDebug.player().relationships['Trizel'];
        return { pregs: r?.pregnancies, prog: r?.pregnancy_progress, kind: r?.conceptionKind };
    });
    check('fresh game seeds pregnancies/progress/womb kind', seeded.pregs === 2 && seeded.prog === 60 && seeded.kind === 'egg', JSON.stringify(seeded));

    // ⚡ apply pushes new values into the RUNNING game
    await page.evaluate(() => window.rpgCustodianDebug.castForm('cycle-proof', 'Trizel')); await wait(600);
    await page.evaluate(() => { $('#cf-pregs').val(3); $('#cf-prog').val(110); $('#cf-apply').trigger('click'); }); await wait(1200);
    const applied = await page.evaluate(() => {
        const r = window.rpgCustodianDebug.player().relationships['Trizel'];
        const npc = window.rpgCustodianDebug.state().npcRoster.find(n => n.name === 'Trizel');
        return { pregs: r?.pregnancies, prog: r?.pregnancy_progress, kind: r?.conceptionKind, womb: npc?.wombType };
    });
    check('⚡ apply updates live pregnancy + womb type', applied.pregs === 3 && applied.prog === 110 && applied.kind === 'egg' && applied.womb === 'egg', JSON.stringify(applied));

    // cleanup
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        delete ctx.extensionSettings['rpg-custodian'].authoredWorlds['cycle-proof'];
        await window.rpgCustodianDebug.refreshWorlds();
        ctx.saveSettingsDebounced();
    });

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
