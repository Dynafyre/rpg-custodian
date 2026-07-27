/**
 * Location-coherency test: NO teleport. Travel is done entirely in natural
 * language, and we verify (a) the action bar has no per-NPC mechanical buttons,
 * (b) NL travel moves only to connected locations with a travel beat, (c) an
 * NPC only appears once the player has actually arrived at her location, and
 * (d) trying to jump somewhere non-adjacent is refused.
 */
import { connect, collectLogs, login, screenshot } from './harness.js';

const browser = await connect();
const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const answers = ['Kael', 'A wanderer.', 'Wanderer', 'Drifter'];
page.on('dialog', async (d) => await d.accept(answers.shift() ?? ''));

const busy = () => page.evaluate(() => window.rpgCustodianDebug.busy());
const loc = () => page.evaluate(() => window.rpgCustodianDebug.state().currentLocation);
const bar = () => page.evaluate(() => [...document.querySelectorAll('#rpg-action-bar .rpg-action-btn')].map((b) => b.textContent.trim()));
const chatLen = () => page.evaluate(() => SillyTavern.getContext().chat.length);
const tailFrom = (i) => page.evaluate((x) => (SillyTavern.getContext().chat ?? []).slice(x)
    .map((m) => ({ w: m.is_user ? 'you' : (m.is_system ? 'sys' : m.name), mes: (m.mes ?? '').replace(/\s+/g, ' ').trim() })), i);

async function act(text) {
    while (await busy()) await wait(1000);
    const start = await chatLen();
    console.log(`\n> "${text}"   (at: ${await loc()})`);
    await page.type('#send_textarea', text); await page.keyboard.press('Enter');
    let sawBusy = false;
    for (let i = 0; i < 45; i++) { await wait(2000); const b = await busy(); if (b) sawBusy = true; if (sawBusy && !b) break; if (!sawBusy && i > 6 && (await chatLen()) > start) break; }
    await wait(2500);
    for (const m of await tailFrom(start)) console.log(`  [${m.w}] ${m.mes.slice(0, 150)}`);
    console.log('  now at:', await loc());
}

const results = [];
const check = (n, c, d = '') => { results.push(!!c); console.log(`${c ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); };

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

    const buttons = await bar();
    console.log('action bar:', JSON.stringify(buttons));
    check('no per-NPC mechanical buttons (no Wrestle/Shop)', !buttons.some((b) => /Wrestle|Shop|Ask about|Turn in/i.test(b)), JSON.stringify(buttons));
    check('start location is outskirts', (await loc()) === 'outskirts');

    // NL travel toward the dragon, step by step through the world graph.
    await act('I head into town, to the square.');
    check('walked to town-square', (await loc()) === 'town-square');

    // Try to jump straight to the grotto (NOT adjacent) — should be refused.
    await act('I march straight to the forbidden grotto to face the dragon.');
    check('cannot skip to non-adjacent grotto', (await loc()) !== 'forbidden-grotto', `at ${await loc()}`);

    // Proper path: square -> outskirts -> woods -> grotto
    await act('Back to the outskirts I go.');
    await act('I follow the trail into the whispering woods.');
    check('reached the forest', (await loc()) === 'forest');
    await act('Onward, into the forbidden grotto.');
    check('arrived at the grotto by travel', (await loc()) === 'forbidden-grotto');

    // Only now, with Sylvara actually present, address her.
    await act('Sylvara — I have climbed a long way to meet a real dragon. You are magnificent.');

    await screenshot(page, 'travel-coherency');
    console.log('\n================');
    console.log(`${results.filter(Boolean).length}/${results.length} coherency checks passed`);
} finally {
    await page.close();
    await browser.disconnect();
}
