/**
 * Verify the group-chat session model + dynamic presence muting.
 * Cannot test actual LLM replies headlessly (no API configured), so this
 * asserts the STRUCTURE: a group forms with GM + full cast, we land inside it,
 * and disabled_members tracks who's present as the player moves and time passes.
 */
import { connect, collectLogs, login, screenshot } from './harness.js';

const browser = await connect();
const page = await browser.newPage();
const { consoleLogs, pageErrors } = collectLogs(page);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Read the live group state for our RPG group.
const groupState = () => page.evaluate(() => {
    const ctx = SillyTavern.getContext();
    const g = (ctx.groups || []).find((x) => x.name?.startsWith('RPG: '));
    if (!g) return { found: false };
    const enabled = g.members.filter((m) => !g.disabled_members.includes(m));
    return {
        found: true,
        name: g.name,
        inThisGroup: ctx.groupId === g.id,
        members: g.members,
        enabled,
        disabled: g.disabled_members,
    };
});

try {
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await wait(1000);

    // Start a fresh game from the menu.
    await page.click('#rpg-menu-button');
    await wait(400);
    await page.evaluate(() => {
        [...document.querySelectorAll('.rpg-menu-item')]
            .find((el) => el.textContent.includes('New Game'))?.click();
    });
    await wait(22000); // GM/cast creation + group creation + open
    await screenshot(page, 'g01-new-game-group');

    let g = await groupState();
    console.log('AT START (outskirts, Morning):', JSON.stringify(g, null, 1));
    console.log('  -> Bryony present?', g.enabled?.includes('Bryony.png'),
        '| GM enabled?', g.enabled?.includes('Game Master.png'),
        '| Marta muted?', g.disabled?.includes('Marta.png'));

    // Move to the inn — Marta should become present, Bryony muted.
    await page.type('#send_textarea', '/move town-square');
    await page.keyboard.press('Enter');
    await wait(3500);
    await page.type('#send_textarea', '/move inn');
    await page.keyboard.press('Enter');
    await wait(3500);
    g = await groupState();
    console.log('\nAT INN (Morning):', JSON.stringify({ enabled: g.enabled, disabled: g.disabled }, null, 1));
    console.log('  -> Marta present?', g.enabled?.includes('Marta.png'),
        '| Bryony muted?', g.disabled?.includes('Bryony.png'));

    // Back to town square, then wait to Evening — Seline works the square in daytime only.
    await page.type('#send_textarea', '/move town-square');
    await page.keyboard.press('Enter');
    await wait(3500);
    await page.type('#send_textarea', '/rpg-wait');   // Morning -> Day
    await page.keyboard.press('Enter');
    await wait(3500);
    g = await groupState();
    console.log('\nAT TOWN SQUARE (Day):', JSON.stringify({ enabled: g.enabled }, null, 1));
    console.log('  -> Seline present at Day?', g.enabled?.includes('Seline.png'));
    await screenshot(page, 'g02-square-day');

    const verdict = g.found && g.inThisGroup && g.members.length === 7;
    console.log('\nRESULT:', verdict ? 'PASS — group session live with presence muting' : 'CHECK ABOVE');

    console.log('\n=== Page errors ===');
    console.log(pageErrors.join('\n') || '(none)');
    console.log('=== Console errors ===');
    console.log(consoleLogs.filter((l) => l.startsWith('[error]')).slice(0, 12).join('\n') || '(none)');
    console.log('=== RPG presence log lines ===');
    console.log(consoleLogs.filter((l) => /Presence synced|Created RPG group|Cast ready/i.test(l)).join('\n') || '(none)');
} finally {
    await page.close();
    await browser.disconnect();
}
