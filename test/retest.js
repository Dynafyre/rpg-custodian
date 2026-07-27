/**
 * Focused re-test of the categories that failed with empty intents last run:
 * NL quest-do (check), turn-in, buy, drink, seduce — plus a trivial control.
 */
import { connect, collectLogs, login, screenshot } from './harness.js';

const browser = await connect();
const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const promptAnswers = ['Kael', 'A green but game young wanderer.', 'Wanderer', 'Drifter'];
page.on('dialog', async (d) => { await d.accept(promptAnswers.shift() ?? ''); });
const player = () => page.evaluate(() => window.rpgCustodianDebug?.player() ?? null);
const chatLen = () => page.evaluate(() => SillyTavern.getContext().chat.length);
const tailFrom = (i) => page.evaluate((x) => (SillyTavern.getContext().chat ?? []).slice(x)
    .map((m) => ({ w: m.is_user ? 'you' : (m.is_system ? 'sys' : m.name), mes: (m.mes ?? '').replace(/\s+/g, ' ').trim() })), i);

const busy = () => page.evaluate(() => window.rpgCustodianDebug.busy());
async function act(label, text, teleport) {
    while (await busy()) await wait(1000);              // don't overlap turns
    if (teleport) { await page.evaluate((l) => window.rpgCustodianDebug.teleport(l), teleport); await wait(1200); }
    const start = await chatLen();
    console.log(`\n──── ${label} ────\n> "${text}"`);
    await page.type('#send_textarea', text); await page.keyboard.press('Enter');
    // Wait for orchestration to start (busy true) then finish (busy false).
    let sawBusy = false;
    for (let i = 0; i < 45; i++) {
        await wait(2000);
        const b = await busy();
        if (b) sawBusy = true;
        if (sawBusy && !b) break;
        if (!sawBusy && i > 6 && (await chatLen()) > start) break; // finished very fast
    }
    await wait(2500); // let the final NPC reply render
    for (const m of await tailFrom(start)) console.log(`  [${m.w}] ${m.mes.slice(0, 180)}`);
    const intent = consoleLogs.filter((l) => l.includes('intent =')).slice(-1)[0];
    console.log('  » ' + (intent ? intent.replace(/^.*intent = /, '') : '(no intent logged)').slice(0, 220));
    await wait(3000);
}

try {
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find((el) => el.textContent.includes('Create Character'))?.click());
    await wait(6000);
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find((el) => el.textContent.includes('New Game'))?.click());
    await wait(20000);

    await act('TALK: ask for work', 'Bryony, any work going for a capable pair of hands and a bit of coin?', 'outskirts');
    await act('QUEST accept', 'Aye, I\'ll take that wolf job.');
    await act('QUEST do (check)', 'I hunt down the frostfang wolves and fight the pack until they scatter.', 'forest');
    await act('QUEST turn-in', 'Bryony, the wolves are culled. I\'ll take my pay now.', 'outskirts');
    await act('SHOP buy', 'Wren, I\'ll buy that Potion of Ruggedness. Coin\'s on the counter.', 'shop');
    await act('USE drink', 'I pop the cork and down the Potion of Ruggedness.');
    await act('SEDUCE (charm)', 'I lean in close to Marta, lower my voice and try to charm a kiss out of her.', 'inn');

    const p = await player();
    console.log(`\n=== gold ${p.inventory.currency}, xp ${p.stats.experience}, items [${p.inventory.items.map((i) => i.name)}], boosts ${JSON.stringify((p.active_boosts||[]).filter(b=>!b.consumed))}, quests ${JSON.stringify(p.quests)}`);
    await screenshot(page, 'retest-final');
} finally {
    await page.close();
    await browser.disconnect();
}
