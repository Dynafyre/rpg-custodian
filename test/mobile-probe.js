import { connect, login, useMobileViewport } from './harness.js';
const browser = await connect();
const page = await browser.newPage();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
    await useMobileViewport(page);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await wait(800);
    await page.tap('#rpg-menu-button');
    await wait(600);
    const info = await page.evaluate(() => {
        const p = document.getElementById('rpg-menu-popup');
        if (!p) return { exists: false };
        const r = p.getBoundingClientRect();
        const cs = getComputedStyle(p);
        const atCenter = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
        return {
            exists: true,
            rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) },
            viewport: { w: window.innerWidth, h: window.innerHeight },
            zIndex: cs.zIndex, position: cs.position,
            offBottom: r.bottom > window.innerHeight, offTop: r.top < 0,
            topElementTag: atCenter ? `${atCenter.tagName}#${atCenter.id}.${atCenter.className}` : null,
            popupContainsTop: p.contains(atCenter),
        };
    });
    console.log(JSON.stringify(info, null, 2));
} finally { await page.close(); await browser.disconnect(); }
