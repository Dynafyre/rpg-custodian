/**
 * FULL NATURAL-LANGUAGE PLAYTHROUGH with a fresh low-level character.
 * Everything is typed NL — no mechanical buttons (only New Game / teleport for
 * setup). Logs, for each action, what the analyzer decided (roll or not, DC,
 * effects) so we can judge calibration, trivial-skip behavior, and edge cases.
 */
import { connect, collectLogs, login, screenshot } from './harness.js';

const browser = await connect();
const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const promptAnswers = ['Kael', 'A green but game young wanderer, quick of tongue and light of purse.', 'Wanderer', 'Drifter'];
page.on('dialog', async (d) => { await d.accept(promptAnswers.shift() ?? ''); });

const player = () => page.evaluate(() => window.rpgCustodianDebug?.player() ?? null);
const chatLen = () => page.evaluate(() => SillyTavern.getContext().chat.length);
const tailFrom = (idx) => page.evaluate((i) => (SillyTavern.getContext().chat ?? []).slice(i)
    .map((m) => ({ name: m.name, u: !!m.is_user, s: !!m.is_system, mes: (m.mes ?? '').replace(/\s+/g, ' ').trim() })), idx);

const busy = () => page.evaluate(() => window.rpgCustodianDebug.busy());
// Fire one NL action, wait for orchestration to complete, print what happened.
async function act(label, text, { teleport = null } = {}) {
    while (await busy()) await wait(1000);
    if (teleport) { await page.evaluate((l) => window.rpgCustodianDebug.teleport(l), teleport); await wait(1200); }
    const start = await chatLen();
    console.log(`\n──────── ${label} ────────\n> "${text}"`);
    await page.type('#send_textarea', text);
    await page.keyboard.press('Enter');
    let sawBusy = false;
    for (let i = 0; i < 45; i++) {
        await wait(2000);
        const b = await busy();
        if (b) sawBusy = true;
        if (sawBusy && !b) break;
        if (!sawBusy && i > 6 && (await chatLen()) > start) break;
    }
    await wait(2500);
    const msgs = await tailFrom(start);
    for (const m of msgs) {
        const who = m.s ? 'sys' : m.u ? 'you' : m.name;
        console.log(`  [${who}] ${m.mes.slice(0, 200)}`);
    }
    // surface the analyzer decision for this action
    const intent = consoleLogs.filter((l) => l.includes('intent =')).slice(-1)[0];
    if (intent) console.log(`  » ${intent.replace(/^.*intent = /, 'intent ')}`.slice(0, 260));
    return msgs;
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
    let p = await player();
    console.log(`fresh character: rugged ${p.stats.ruggedness} charm ${p.stats.charm} craft ${p.stats.craftiness}, gold ${p.inventory.currency}`);

    // === TRIVIAL / borderline (should NOT roll) ===
    await act('TRIVIAL: idle observation', 'I take a slow look around the town outskirts, breathing in the mountain air.');
    await act('TRIVIAL: pick up a pebble', 'I bend down and pick a small loose pebble off the path.');
    await act('BORDERLINE: grab a stick', 'I snap a sturdy fallen branch off the ground to use as a walking stick.');

    // === OFF-SCRIPT edge cases ===
    await act('OFF-SCRIPT: absurd feat', 'I flap my arms hard and try to fly up over the mountains!');
    await act('OFF-SCRIPT: climb', 'I scramble up the tallest pine at the treeline to scout the land.', { teleport: 'forest' });

    // === QUEST via NL ===
    await act('QUEST: ask for work', 'Bryony, you have the look of someone with problems that need solving. Any work for coin?', { teleport: 'outskirts' });
    await act('QUEST: accept', 'Aye, I\'ll take the job. Consider those wolves dealt with.');
    await act('QUEST: do it', 'I track the frostfang wolves through the woods and fight the pack to drive them off.', { teleport: 'forest' });
    await act('QUEST: turn in', 'Bryony — it\'s done. The frostfang pack won\'t trouble the road again. I\'ll take my pay.', { teleport: 'outskirts' });

    // === SHOP via NL ===
    await act('SHOP: browse', 'Wren, what have you got for sale? I might have coin to spend.', { teleport: 'shop' });
    await act('SHOP: buy', 'I\'ll buy the Potion of Ruggedness. Here\'s your coin.');
    await act('USE: drink', 'I uncork the potion of ruggedness and drink it down in one gulp.');

    // === SEDUCTION (modest) ===
    await act('SEDUCE: modest flirt', 'I catch Marta\'s eye with a warm, teasing smile and tell her the inn is lucky to have someone so lovely running it.', { teleport: 'inn' });

    // === CHALLENGE ===
    await act('CHALLENGE: wrestle dragon', 'I square up against Sylvara, grab her and try to wrestle the great dragoness to the ground.', { teleport: 'forbidden-grotto', maxWait: 110 });

    p = await player();
    console.log(`\n=== FINAL: gold ${p.inventory.currency}, xp ${p.stats.experience}, items [${p.inventory.items.map((i) => i.name)}], quests ${JSON.stringify(p.quests)}`);
    await screenshot(page, 'playthrough-final');
} finally {
    await page.close();
    await browser.disconnect();
}
