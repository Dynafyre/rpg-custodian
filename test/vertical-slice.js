/**
 * VERTICAL SLICE playthrough, driven as a user (buttons + natural language),
 * with the PROPER flow: create an RPG character from the menu, select it, play.
 *   0. Create + select an RPG character (persona with stats)
 *   1. Accept + complete + turn in Bryony's bounty  → earn 50 gold
 *   2. Buy Potion of Ruggedness from Wren's shop     → spend 40 gold
 *   3. Drink it                                      → +8 ruggedness boost
 *   4. Wrestle Sylvara the dragon and win using it
 */
import { connect, collectLogs, login, screenshot } from './harness.js';

const browser = await connect();
const page = await browser.newPage();
const { consoleLogs, pageErrors } = collectLogs(page);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Answer the Create Character prompts in order.
const promptAnswers = ['Dyna Testhero', 'A rugged wandering adventurer seeking coin and glory.', 'Adventurer', 'Traveler'];
page.on('dialog', async (d) => { await d.accept(promptAnswers.shift() ?? ''); });

const player = () => page.evaluate(() => window.rpgCustodianDebug?.player() ?? null);
const summary = async () => {
    const p = await player();
    if (!p) return 'no player';
    const boosts = (p.active_boosts || []).filter((b) => !b.consumed).map((b) => `${b.stat}+${b.amount}`);
    return `gold=${p.inventory.currency} items=[${p.inventory.items.map((i) => i.name)}] rugged=${p.stats.ruggedness} boosts=[${boosts}] xp=${p.stats.experience}`;
};
const barButtons = () => page.evaluate(() => [...document.querySelectorAll('#rpg-action-bar .rpg-action-btn')].map((b) => b.textContent.trim()));
const clickBar = (c) => page.evaluate((x) => { const b = [...document.querySelectorAll('#rpg-action-bar .rpg-action-btn')].find((e) => e.textContent.includes(x)); if (b) { b.click(); return true; } return false; }, c);
const popupItems = () => page.evaluate(() => [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].map((b) => b.textContent.trim().slice(0, 60)));
const clickPopup = (c) => page.evaluate((x) => { const b = [...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find((e) => e.textContent.includes(x)); if (b) { b.click(); return true; } return false; }, c);
const say = async (t) => { await page.type('#send_textarea', t); await page.keyboard.press('Enter'); };
async function moveTo(name) { await clickBar('Move'); await wait(500); const ok = await clickPopup(name); await wait(3500); return ok; }

const results = [];
const check = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

try {
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    let st = 'no_connection';
    for (let i = 0; i < 12; i++) { st = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (st !== 'no_connection') break; await wait(2500); }
    console.log('connection:', st);

    // --- Beat 0: create & select an RPG character ---
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find((el) => el.textContent.includes('Create Character'))?.click());
    await wait(6000);
    const created = await page.evaluate(() => ({ avatar: window.rpgCustodianDebug?.avatar(), name: SillyTavern.getContext().powerUserSettings?.personas?.[window.rpgCustodianDebug?.avatar()] }));
    console.log('active persona:', JSON.stringify(created));
    let p = await player();
    check('RPG character created & selected', p && created.name === 'Dyna Testhero', p ? `rugged=${p.stats.ruggedness}` : 'no rpg_data');

    // --- New Game ---
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find((el) => el.textContent.includes('New Game'))?.click());
    await wait(22000);
    console.log('start bar:', JSON.stringify(await barButtons()), '|', await summary());

    // --- Beat 1: quest for the guard ---
    await say('Bryony, the warden pays for hard work, they say. Have you a job for a capable pair of hands?');
    await wait(14000);
    await clickBar('Ask about work'); await wait(700);
    console.log('quest popup:', JSON.stringify(await popupItems()));
    await clickPopup('Accept'); await wait(1500);
    p = await player();
    check('quest accepted', p.quests['cull-frostfang-wolves']?.state === 'active');

    await moveTo('Whispering Woods');
    for (let i = 0; i < 6; i++) { p = await player(); if (p.quests['cull-frostfang-wolves']?.state === 'completed') break; await clickBar('Frostfang'); await wait(2500); }
    check('quest completed', (await player()).quests['cull-frostfang-wolves']?.state === 'completed');

    await moveTo('Town Outskirts');
    await clickBar('Turn in'); await wait(2000);
    p = await player();
    check('earned gold from the guard', p.inventory.currency >= 50, `gold=${p.inventory.currency}`);

    // --- Beat 2: buy potion ---
    await moveTo('Town Square'); await moveTo('General Store');
    console.log('shop bar:', JSON.stringify(await barButtons()));
    await clickBar('Shop'); await wait(700);
    console.log('shop popup:', JSON.stringify(await popupItems()));
    await clickPopup('Potion of Ruggedness'); await wait(2000);
    p = await player();
    check('bought Potion of Ruggedness', p.inventory.items.some((i) => i.name === 'Potion of Ruggedness'));
    check('gold deducted (50-40=10)', p.inventory.currency === 10, `gold=${p.inventory.currency}`);

    // --- Beat 3: drink it ---
    await clickBar('Items'); await wait(700);
    await clickPopup('Potion of Ruggedness'); await wait(1500);
    p = await player();
    const boosted = await page.evaluate(() => window.rpgCustodianDebug.effectiveStat('ruggedness'));
    check('potion boost active (eff ruggedness 11)', boosted === 11, `eff=${boosted}`);

    // --- Beat 4: wrestle the dragon ---
    // Path from the General Store: shop -> town-square -> outskirts -> forest -> grotto
    await moveTo('Town Square'); await moveTo('Town Outskirts'); await moveTo('Whispering Woods'); await moveTo('Forbidden Grotto');
    console.log('grotto bar:', JSON.stringify(await barButtons()));
    for (let i = 0; i < 4; i++) {
        p = await player();
        if (p.stats.experience >= 100) break;
        const hasBoost = (p.active_boosts || []).some((b) => b.stat === 'ruggedness' && !b.consumed);
        if (!hasBoost && i > 0) break;
        await clickBar('Wrestle'); await wait(3000);
    }
    p = await player();
    check('beat the dragon in a wrestle', p.stats.experience >= 100, `xp=${p.stats.experience}`);

    await screenshot(page, 'slice-final');
    console.log('\nfinal:', await summary());
    console.log('\n================ SLICE RESULT ================');
    const passed = results.filter(Boolean).length;
    console.log(`${passed}/${results.length} checks passed  ${passed === results.length ? '🎉 VERTICAL SLICE COMPLETE' : '⚠️ SOME FAILED'}`);

    console.log('\n=== errors ===');
    console.log(pageErrors.join('\n') || '(none)');
    console.log(consoleLogs.filter((l) => l.startsWith('[error]') && !l.includes('backgrounds/')).slice(0, 10).join('\n') || '(no error logs)');
} finally {
    await page.close();
    await browser.disconnect();
}
