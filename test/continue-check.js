import { connect, collectLogs, login } from './harness.js';
const browser = await connect();
const page = await browser.newPage();
collectLogs(page);
try {
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await page.click('#rpg-menu-button');
    await new Promise((r) => setTimeout(r, 500));
    const items = await page.evaluate(() =>
        [...document.querySelectorAll('.rpg-menu-item')].map((el) => el.textContent.trim()));
    console.log('FRESH SESSION MENU:', JSON.stringify(items));
} finally {
    await page.close();
    await browser.disconnect();
}
