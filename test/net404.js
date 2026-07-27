import { connect, login } from './harness.js';
const browser = await connect();
const page = await browser.newPage();
const bad = [];
page.on('requestfailed', r => bad.push(r.url()));
page.on('response', r => { if (r.status() === 404) bad.push(`404 ${r.url()}`); });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
try {
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('New Game'))?.click());
    await wait(20000);
    console.log('FAILED/404 URLS:', [...new Set(bad)].slice(0,10).join('\n'));
} finally { await page.close(); await browser.disconnect(); }
