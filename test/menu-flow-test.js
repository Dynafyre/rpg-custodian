/**
 * End-to-end test of the new RPG menu flow:
 * open menu -> New Game -> cast auto-creation -> /move -> Wait -> presence.
 */
import { connect, collectLogs, login, screenshot } from './harness.js';

const browser = await connect();
const page = await browser.newPage();
const { consoleLogs, pageErrors } = collectLogs(page);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const lastMessages = (n) => page.evaluate((count) => {
    const ctx = SillyTavern.getContext();
    return (ctx.chat ?? []).slice(-count).map((m) => `${m.name}: ${m.mes?.slice(0, 300)}`);
}, n);

try {
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await wait(1000);

    // 1. Open the RPG menu
    await page.click('#rpg-menu-button');
    await wait(500);
    const menuItems = await page.evaluate(() =>
        [...document.querySelectorAll('.rpg-menu-item')].map((el) => el.textContent.trim()));
    console.log('MENU ITEMS:', JSON.stringify(menuItems));
    await screenshot(page, '05-menu-open');

    // 2. Click "New Game: prototype-town"
    await page.evaluate(() => {
        const item = [...document.querySelectorAll('.rpg-menu-item')]
            .find((el) => el.textContent.includes('New Game'));
        item?.click();
    });
    await wait(20000); // GM switch + world load + cast creation take a moment
    await screenshot(page, '06-new-game');

    const cast = await page.evaluate(() =>
        SillyTavern.getContext().characters.map((c) => c.name));
    console.log('CHARACTERS NOW:', JSON.stringify(cast));
    console.log('START MESSAGES:', JSON.stringify(await lastMessages(2), null, 1));

    // 3. Move to town square via slash command (fallback interface)
    await page.type('#send_textarea', '/move town-square');
    await page.keyboard.press('Enter');
    await wait(4000);
    await screenshot(page, '07-moved');
    console.log('AFTER MOVE:', JSON.stringify(await lastMessages(1), null, 1));

    // 4. Advance time via the menu (Morning -> Day; Seline should appear)
    await page.click('#rpg-menu-button');
    await wait(500);
    await page.evaluate(() => {
        const item = [...document.querySelectorAll('.rpg-menu-item')]
            .find((el) => el.textContent.includes('Wait'));
        item?.click();
    });
    await wait(4000);
    await screenshot(page, '08-waited');
    console.log('AFTER WAIT:', JSON.stringify(await lastMessages(1), null, 1));

    const buttonState = await page.evaluate(() => ({
        text: document.getElementById('rpg-menu-button')?.textContent.trim(),
        title: document.getElementById('rpg-menu-button')?.title,
    }));
    console.log('BUTTON STATE:', JSON.stringify(buttonState));

    console.log('\n=== RPG console lines ===');
    console.log(consoleLogs.filter((l) => /rpg|custodian/i.test(l)).join('\n') || '(none)');
    console.log('\n=== Page errors ===');
    console.log(pageErrors.join('\n') || '(none)');
} finally {
    await page.close();
    await browser.disconnect();
}
