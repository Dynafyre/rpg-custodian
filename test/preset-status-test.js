// Two preset statuses, authored in the engine so the Custodian only names them:
//   Cum Plugged        — seals his seed in; every time period it gets another
//                        go at her womb. Ends when the plug comes out.
//   Stimulated Ovaries — +10 fertility for one time period, from working her
//                        lower belly. Ends when it wears off.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1500);

    // ── Stimulated Ovaries: a fertility mod that expires on its own ───────
    const ov = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const before = d.player().relationships['Bryony'] ? null : null;
        const base = d.fertility ? d.fertility('Bryony') : null;
        const pctBefore = d.fertilityOf('Bryony');
        d.addStatus('Bryony', { preset: 'stimulated_ovaries' });
        const st = d.statuses('Bryony').find(e => e.name === 'Stimulated Ovaries');
        const pctAfter = d.fertilityOf('Bryony');
        return { pctBefore, pctAfter, name: st?.name, mods: st?.mods, kind: st?.kind, dur: st?.expiresStep - d.state().timeStep, desc: st?.desc };
    });
    console.log('   stimulated ovaries:', JSON.stringify(ov));
    check('the preset fills in its own name and mods', ov.name === 'Stimulated Ovaries' && ov.mods?.[0]?.stat === 'fertility' && ov.mods[0].amount === 10, JSON.stringify(ov.mods));
    check('it raises her fertility by 10 points', ov.pctAfter === Math.min(100, ov.pctBefore + 10), `${ov.pctBefore}% → ${ov.pctAfter}%`);
    check('it lasts one time period', ov.dur === 1, `${ov.dur}`);

    const worn = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        d.tick(1);
        return { pct: d.fertilityOf('Bryony'), still: d.statuses('Bryony').some(e => e.name === 'Stimulated Ovaries' && e.active !== false) };
    });
    check('it wears off after that period', !worn.still && worn.pct === ov.pctBefore, JSON.stringify(worn));

    // ── Cum Plugged: a fresh conception roll every time period ────────────
    const plug = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const rel = d.player().relationships['Bryony'] || d.rel('Bryony');
        rel.pregnancies = 0; rel.pregnancy_progress = 0; rel.conceptionKind = null;
        d.player().stats.virility = 3;
        d.addStatus('Bryony', { preset: 'cum_plugged' });
        const st = d.statuses('Bryony').find(e => e.name === 'Cum Plugged');
        return { name: st?.name, refertilizes: !!st?.refertilizes, endCondition: st?.endCondition, mods: st?.mods, desc: st?.desc };
    });
    console.log('   cum plugged:', JSON.stringify(plug));
    check('the plug preset is authored with its end condition', plug.name === 'Cum Plugged' && !!plug.endCondition, plug.endCondition);
    check('it carries the re-roll flag the engine ticks on', plug.refertilizes === true);

    // force her fertile so the re-roll is observable, then pass time
    const rolled = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const npc = d.state().npcRoster.find(n => n.name === 'Bryony');
        npc.fertility = 100;                       // guarantee a take
        const before = d.rel('Bryony').pregnancies || 0;
        d.tick(1);
        return { before, after: d.rel('Bryony').pregnancies || 0, progress: d.rel('Bryony').pregnancy_progress, kind: d.rel('Bryony').conceptionKind };
    });
    console.log('   after one period plugged:', JSON.stringify(rolled));
    check('a plugged period re-rolls conception', rolled.after > rolled.before, `${rolled.before} → ${rolled.after}`);
    check('a conception from the plug sets her progress and kind', rolled.progress > 0 && !!rolled.kind, JSON.stringify(rolled));

    // once she is far enough along, the plug must stop conceiving
    const locked = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const rel = d.rel('Bryony'); rel.pregnancy_progress = 40;   // Fetal onward
        const before = rel.pregnancies;
        d.tick(1);
        return { before, after: d.rel('Bryony').pregnancies };
    });
    check('a committed womb cannot be taken again by the plug', locked.after === locked.before, JSON.stringify(locked));

    // removing it stops the ticking
    const removed = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const rel = d.rel('Bryony'); rel.pregnancy_progress = 0; rel.pregnancies = 0;
        d.removeStatus ? d.removeStatus('Bryony', 'Cum Plugged') : (rel.customEffects.find(e => e.name === 'Cum Plugged').active = false);
        const before = d.rel('Bryony').pregnancies || 0;
        d.tick(1);
        return { before, after: d.rel('Bryony').pregnancies || 0 };
    });
    check('once the plug is out, time stops re-rolling', removed.after === removed.before, JSON.stringify(removed));

    // ── does the Custodian reach for the presets on its own? ──────────────
    console.log('\nnatural-language triggers:');
    const NL = [
        ['stimulated_ovaries', `I press my palm flat to Bryony's lower belly and knead slow circles into it, working her womb through the skin.`],
        ['stimulated_ovaries', `I rub Bryony's tummy where her ovaries would be, massaging in slow firm strokes.`],
        ['cum_plugged', `Still buried in her, I ease out and quickly work the smooth stopper into her cunt before a drop of my cum can escape.`],
        ['cum_plugged', `I push the plug into Bryony to seal my seed inside her, holding it there until it seats.`],
    ];
    for (const [want, text] of NL) {
        const got = await page.evaluate(async (t) => {
            const i = await window.rpgCustodianDebug.analyze(t);
            return [...(i?.effects_on_success || []), ...(i?.effects_on_failure || [])]
                .filter(e => e.type === 'add_status')
                .map(e => ({ preset: e.preset || null, name: e.name || null, target: e.target }));
        }, text);
        const hit = got.some(g => String(g.preset || '').replace(/[\s-]+/g, '_') === want);
        check(`"${text.slice(0, 52)}…" → ${want}`, hit, JSON.stringify(got));
    }

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
