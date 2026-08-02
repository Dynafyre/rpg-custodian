// Exhausted carries −2 Ruggedness, and max Stamina is derived from Ruggedness.
// So the ORDER of restoring matters: fill first and the ceiling is still
// penalised, then the status clears and the ceiling jumps — leaving the player
// permanently short by the size of the penalty. Rest and healing both had it.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

// Drop him to 0 so the engine applies Exhausted, and report the state.
const exhaust = () => page.evaluate(() => {
    const d = window.rpgCustodianDebug, rd = d.player();
    rd.stats.ruggedness = 5;
    rd.stats.stamina = 1; rd.stats.unconscious = false;
    d.hurt('player', 1);                       // → 0, engine applies Exhausted
    return {
        stamina: rd.stats.stamina,
        exhausted: (rd.customEffects || []).some(e => e.engineManaged === 'exhausted' && e.active !== false),
        ruggedness: d.effectiveStat('ruggedness'),
        max: d.maxStamina(),
    };
});
const state = () => page.evaluate(() => {
    const d = window.rpgCustodianDebug, rd = d.player();
    return {
        stamina: rd.stats.stamina, max: d.maxStamina(),
        ruggedness: d.effectiveStat('ruggedness'),
        exhausted: (rd.customEffects || []).some(e => e.engineManaged === 'exhausted' && e.active !== false),
    };
});

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1500);

    // ── resting ──────────────────────────────────────────────────────────
    const down = await exhaust();
    console.log('   spent:', JSON.stringify(down));
    check('at 0 Stamina he is Exhausted', down.exhausted && down.stamina === 0, JSON.stringify(down));
    check('and the penalty is really biting his ceiling', down.max === 3 && down.ruggedness === 3, `max ${down.max}, rugged ${down.ruggedness}`);

    await page.evaluate(() => window.rpgCustodianDebug.rest()); await wait(3000);
    const rested = await state();
    console.log('   rested:', JSON.stringify(rested));
    check('resting clears the exhaustion', !rested.exhausted);
    check('and fills him to the FULL, unpenalised maximum', rested.stamina === 5 && rested.max === 5, JSON.stringify(rested));
    check('he is not left short of his own ceiling', rested.stamina === rested.max, `${rested.stamina}/${rested.max}`);

    // ── a full restoration draught ───────────────────────────────────────
    await exhaust();
    await page.evaluate(() => window.rpgCustodianDebug.heal('player', 'full')); await wait(500);
    const healed = await state();
    console.log('   healed full:', JSON.stringify(healed));
    check('a full restoration also fills to the real maximum', healed.stamina === 5 && healed.max === 5, JSON.stringify(healed));

    // ── a partial heal must not be clipped by the penalised ceiling ──────
    await exhaust();
    await page.evaluate(() => window.rpgCustodianDebug.heal('player', 4)); await wait(500);
    const partial = await state();
    console.log('   healed +4 from 0:', JSON.stringify(partial));
    check('a +4 heal from 0 is not clipped to the penalised ceiling', partial.stamina === 4, JSON.stringify(partial));

    // ── a heal that leaves him still spent keeps the status ──────────────
    await exhaust();
    const stillOut = await page.evaluate(() => {
        const d = window.rpgCustodianDebug;
        d.heal('player', 0);                    // a no-op tending
        const rd = d.player();
        return { stamina: rd.stats.stamina, exhausted: (rd.customEffects || []).some(e => e.engineManaged === 'exhausted' && e.active !== false) };
    });
    check('a heal of nothing leaves him spent and still Exhausted', stillOut.stamina === 0 && stillOut.exhausted, JSON.stringify(stillOut));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
