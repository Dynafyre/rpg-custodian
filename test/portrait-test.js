// Imported cast portraits: the RPGC_ world copy must wear the ORIGINAL's
// face, not the default silhouette — at creation AND across a self-heal
// refresh. Uses Trizel (a real card on the test account) adopted into a
// minimal world, then materialized by New Game. Faces are compared by an
// 8x8 pixel signature, not dimensions — conclusive even if sizes collide.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

// 8x8 grayscale signature of a served character image (same-origin canvas)
const sig = (av) => page.evaluate(async (a) => {
    const img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = `/characters/${encodeURIComponent(a)}?r=${Math.random()}`; });
    if (!img) return null;
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data, out = [];
    for (let i = 0; i < d.length; i += 4) out.push(Math.round((d[i] + d[i + 1] + d[i + 2]) / 3));
    return { w: img.naturalWidth, h: img.naturalHeight, px: out };
}, av);
const diff = (a, b) => (!a || !b) ? 999 : a.px.reduce((s, v, i) => s + Math.abs(v - b.px[i]), 0) / a.px.length;

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }

    // clean slate: previous RPGC_Trizel + test world
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        if (ctx.characters.some(c => c.avatar === 'RPGC_Trizel.png')) {
            await fetch('/api/characters/delete', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ avatar_url: 'RPGC_Trizel.png', delete_chats: false }) });
            await ctx.getCharacters();
        }
        const s = ctx.extensionSettings['rpg-custodian'];
        if (s?.authoredWorlds?.['portrait-proof']) delete s.authoredWorlds['portrait-proof'];
        s.authoredWorlds = s.authoredWorlds || {};
        s.authoredWorlds['portrait-proof'] = {
            worldId: 'portrait-proof', name: 'Portrait Proof', description: 'portrait regression world',
            startingLocation: 'square',
            locations: { square: { name: 'Test Square', description: 'A bare little square.', connections: [], background: '' } },
            cast: [], castData: {},
        };
        ctx.saveSettingsDebounced();
        await window.rpgCustodianDebug.refreshWorlds();
    });
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);

    const orig = await sig('Trizel.png');
    check('original Trizel portrait is servable', !!orig, JSON.stringify(orig && [orig.w, orig.h]));

    const meta = await page.evaluate(() => window.rpgCustodianDebug.adoptCast('portrait-proof', 'Trizel'));
    check('adoption recorded source_avatar', meta?.source_avatar === 'Trizel.png', JSON.stringify(meta));

    await page.evaluate(() => window.rpgCustodianDebug.newGame('portrait-proof')); await wait(20000);
    const st = await page.evaluate(() => { const s = window.rpgCustodianDebug.state(); return { active: s.isActive, roster: (s.npcRoster || []).map(n => n.name) }; });
    check('world materialized with Trizel', st.active && st.roster.includes('Trizel'), JSON.stringify(st));

    let copy = await sig('RPGC_Trizel.png');
    let d = diff(orig, copy);
    console.log('creation: copy dims', JSON.stringify(copy && [copy.w, copy.h]), 'pixel-diff', d.toFixed(1));
    check('world copy wears the ORIGINAL portrait', !!copy && d < 12, `pixel-diff ${d.toFixed(1)}`);

    // self-heal refresh must KEEP the face: bump the world-side card_version
    // so materialization takes the refresh path, then start again
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        ctx.extensionSettings['rpg-custodian'].authoredWorlds['portrait-proof'].castData['Trizel'].extensions.rpg_custodian.card_version = '1.2';
        ctx.saveSettingsDebounced();
        await window.rpgCustodianDebug.refreshWorlds();
    });
    await page.evaluate(() => window.rpgCustodianDebug.newGame('portrait-proof')); await wait(20000);
    copy = await sig('RPGC_Trizel.png');
    d = diff(orig, copy);
    const ver = await page.evaluate(() => SillyTavern.getContext().characters.find(c => c.avatar === 'RPGC_Trizel.png')?.data?.extensions?.rpg_custodian?.card_version);
    check('refresh actually ran (card_version 1.2 live)', ver === '1.2', String(ver));
    check('portrait survives the refresh', !!copy && d < 12, `pixel-diff ${d.toFixed(1)}`);

    // cleanup
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        delete ctx.extensionSettings['rpg-custodian'].authoredWorlds['portrait-proof'];
        await window.rpgCustodianDebug.refreshWorlds();
        ctx.saveSettingsDebounced();
    });

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
