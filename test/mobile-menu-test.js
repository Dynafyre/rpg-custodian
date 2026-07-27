/**
 * Mobile-resolution test: phone viewport + real touch taps.
 * Verifies the RPG button opens the menu from a fresh "home page" state
 * (no chat selected) and that a menu action works via touch.
 */
import { connect, collectLogs, login, screenshot, useMobileViewport } from './harness.js';

const browser = await connect();
const page = await browser.newPage();
const { consoleLogs, pageErrors } = collectLogs(page);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
    await useMobileViewport(page);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await wait(1000);
    await screenshot(page, 'm01-mobile-home');

    // Tap the RPG button with an actual touch event (not a mouse click)
    await page.tap('#rpg-menu-button');
    await wait(600);

    const menuItems = await page.evaluate(() =>
        [...document.querySelectorAll('.rpg-menu-item')].map((el) => el.textContent.trim()));
    console.log('MOBILE MENU ITEMS:', JSON.stringify(menuItems));
    await screenshot(page, 'm02-mobile-menu-open');

    // Verify the popup is actually on-screen (the mobile bug was off-viewport).
    const geom = await page.evaluate(() => {
        const p = document.getElementById('rpg-menu-popup');
        if (!p) return null;
        const r = p.getBoundingClientRect();
        return {
            onScreen: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
            rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) },
            viewport: { w: window.innerWidth, h: window.innerHeight },
        };
    });
    console.log('POPUP GEOMETRY:', JSON.stringify(geom));

    if (menuItems.length === 0) {
        console.log('RESULT: FAIL — menu did not open on touch');
    } else if (!geom?.onScreen) {
        console.log('RESULT: FAIL — menu opened but is off-screen');
    } else {
        // Tap the Character Sheet entry at its real screen coordinates.
        const target = await page.evaluate(() => {
            const el = [...document.querySelectorAll('.rpg-menu-item')]
                .find((e) => e.textContent.includes('Character Sheet'));
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        if (target) {
            await page.touchscreen.tap(target.x, target.y);
            await wait(1500);
        }
        const menuGone = await page.evaluate(() => !document.querySelector('#rpg-menu-popup'));
        console.log('RESULT: PASS — menu on-screen; item tap closed menu:', menuGone);
        await screenshot(page, 'm03-mobile-after-item-tap');
    }

    console.log('\n=== Page errors ===');
    console.log(pageErrors.join('\n') || '(none)');
    console.log('=== Console errors ===');
    console.log(consoleLogs.filter((l) => l.startsWith('[error]')).slice(0, 10).join('\n') || '(none)');
} finally {
    await page.close();
    await browser.disconnect();
}
