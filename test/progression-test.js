// Progression:
//  1. XP from a check = 1 per PERCENT the roll would have failed
//  2. resting reveals a Level Up button in the action bar
//  3. it survives waiting/acting but vanishes when you travel
//  4. 500 XP buys +1 in a chosen stat; 1 Power Token converts to 100 XP
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const barHas = (txt) => page.evaluate((t) => [...document.querySelectorAll('#rpg-action-bar .rpg-action-btn')].some(b => b.textContent.includes(t)), txt);
const stats = () => page.evaluate(() => { const s = window.rpgCustodianDebug.player().stats; return { xp: s.experience || 0, tokens: s.power_tokens || 0, rug: s.ruggedness, charm: s.charm, level: s.level }; });

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);

    // ── 1. XP tracks improbability ────────────────────────────────────────
    // roll the same stat against several DCs until each one succeeds, and
    // confirm the award equals (100 − the odds it had)
    const xpRuns = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        const out = [];
        for (const dc of [7, 10, 13, 15]) {
            for (let attempt = 0; attempt < 400; attempt++) {
                const before = d.player().stats.experience || 0;
                const c = d.rollCheck('charm', dc);
                if (!c.success) continue;
                d.awardXp(c);                       // the orchestrator's award step
                const after = d.player().stats.experience || 0;
                out.push({ dc, mod: (c.base || 0) + (c.boost || 0), gained: after - before, odds: d.odds((c.base || 0) + (c.boost || 0), dc) });
                break;
            }
        }
        return out;
    });
    for (const r of xpRuns) {
        const want = Math.max(1, 100 - r.odds);
        console.log(`   DC ${r.dc}: had ${r.odds}% → awarded ${r.gained} XP (expected ${want})`);
        check(`DC ${r.dc} pays the improbability (${want} XP)`, r.gained === want, `got ${r.gained}`);
    }
    check('a long-shot success pays far more than a near-certainty',
        (xpRuns.find(r => r.dc === 15)?.gained || 0) > (xpRuns.find(r => r.dc === 7)?.gained || 0) * 5,
        xpRuns.map(r => `${r.dc}:${r.gained}`).join(' '));

    // ── 2. the button appears only after a rest ───────────────────────────
    check('no Level Up button before resting', !(await barHas('Level Up')));
    await page.evaluate(() => window.rpgCustodianDebug.rest()); await wait(4000);
    check('resting reveals the Level Up button', await barHas('Level Up'));

    // ── 3. it survives other actions, dies on travel ──────────────────────
    await page.evaluate(() => window.rpgCustodianDebug.tick(1)); await wait(1200);
    await page.evaluate(() => window.rpgCustodianDebug.renderBar?.());
    check('it survives time passing in place', await barHas('Level Up'));

    // ── 4. spending ───────────────────────────────────────────────────────
    await page.evaluate(() => { const s = window.rpgCustodianDebug.player().stats; s.experience = 1200; s.power_tokens = 2; window.rpgCustodianDebug.save?.(); });
    const before = await stats();
    await page.evaluate(() => window.rpgCustodianDebug.levelUp()); await wait(600);
    const opened = await page.evaluate(() => !!document.querySelector('#rpg-action-popup'));
    check('level-up menu opens', opened);
    // buy a ruggedness point
    await page.evaluate(() => {
        const el = [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item, #rpg-action-popup div')].find(e => /Ruggedness/i.test(e.textContent));
        el?.click();
    }); await wait(900);
    const afterStat = await stats();
    console.log('   before:', JSON.stringify(before), '\n   after :', JSON.stringify(afterStat));
    check('500 XP buys +1 Ruggedness', afterStat.rug === before.rug + 1 && afterStat.xp === before.xp - 500, `${before.rug}→${afterStat.rug}, xp ${before.xp}→${afterStat.xp}`);
    check('level counter advances', afterStat.level === before.level + 1, `${before.level}→${afterStat.level}`);

    // token → xp
    await page.evaluate(() => window.rpgCustodianDebug.levelUp()); await wait(600);
    await page.evaluate(() => {
        const el = [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item, #rpg-action-popup div')].find(e => /Power Token/i.test(e.textContent));
        el?.click();
    }); await wait(900);
    const afterTok = await stats();
    check('1 Power Token converts to 100 XP', afterTok.tokens === afterStat.tokens - 1 && afterTok.xp === afterStat.xp + 100, `tokens ${afterStat.tokens}→${afterTok.tokens}, xp ${afterStat.xp}→${afterTok.xp}`);

    // refusal when short
    await page.evaluate(() => { window.rpgCustodianDebug.player().stats.experience = 10; });
    await page.evaluate(() => window.rpgCustodianDebug.levelUp()); await wait(500);
    await page.evaluate(() => {
        const el = [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item, #rpg-action-popup div')].find(e => /Charm/i.test(e.textContent));
        el?.click();
    }); await wait(800);
    const broke = await stats();
    check('cannot level up without the XP', broke.charm === afterTok.charm && broke.xp === 10, JSON.stringify(broke));

    // travel closes the window
    await page.evaluate(() => document.querySelector('#rpg-action-popup')?.remove());
    const dest = await page.evaluate(() => { const st = window.rpgCustodianDebug.state(); return Object.keys(st.worldData.locations).find(k => k !== st.currentLocation); });
    await page.evaluate((d) => window.rpgCustodianDebug.teleport(d), dest); await wait(1500);
    check('travelling ends the level-up window', !(await barHas('Level Up')));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
