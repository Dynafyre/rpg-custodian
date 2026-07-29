// Single-card architecture (supersedes portrait-test):
//  1. legacy RPGC_ copies fold into originals at init (groups re-pointed,
//     copies deleted, original's avatar art wins)
//  2. adopting + playing a world touches ONLY extensions.rpg_custodian +
//     talkativeness on the original — art, greeting, prose untouched
//  3. the group plays the original card
//  4. fresh game chats carry no auto-seeded greetings (chat-level purge)
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
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

    // pre-state: original's face + card before any RPG involvement this run
    const before = await page.evaluate(() => {
        const c = SillyTavern.getContext().characters.find(x => x.name === 'Trizel' && !x.avatar.startsWith('RPGC_'));
        return c ? { avatar: c.avatar, fm: (c.data?.first_mes || '').length, desc: (c.data?.description || '').length } : null;
    });
    check('original Trizel present', !!before, JSON.stringify(before));
    const faceBefore = await sig(before.avatar);

    // 1. migration: init has already run on this page load — any legacy copy is gone
    const legacy = await page.evaluate(() => SillyTavern.getContext().characters.filter(c => c.avatar.startsWith('RPGC_') && c.name === 'Trizel').length);
    check('legacy RPGC_Trizel folded away at init', legacy === 0, `${legacy} copies`);

    // scratch world + adoption
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        const s = ctx.extensionSettings['rpg-custodian'];
        if (s?.authoredWorlds?.['singlecard-proof']) delete s.authoredWorlds['singlecard-proof'];
        s.authoredWorlds = s.authoredWorlds || {};
        s.authoredWorlds['singlecard-proof'] = {
            worldId: 'singlecard-proof', name: 'Singlecard Proof', description: 'architecture test world',
            startingLocation: 'square',
            locations: { square: { name: 'Proof Square', description: 'A bare square.', connections: [], background: '' } },
            cast: [], castData: {},
        };
        ctx.saveSettingsDebounced();
        await window.rpgCustodianDebug.refreshWorlds();
    });
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.adoptCast('singlecard-proof', 'Trizel'));
    await page.evaluate(() => window.rpgCustodianDebug.newGame('singlecard-proof')); await wait(22000);

    // 2. only the original, now carrying the block; art/greeting/prose intact
    const after = await page.evaluate(() => {
        const all = SillyTavern.getContext().characters.filter(c => c.name === 'Trizel');
        const c = all.find(x => !x.avatar.startsWith('RPGC_'));
        return {
            count: all.length, copies: all.filter(x => x.avatar.startsWith('RPGC_')).length,
            fm: (c?.data?.first_mes || '').length, desc: (c?.data?.description || '').length,
            block: c?.data?.extensions?.rpg_custodian || null,
            talk: Number(c?.talkativeness), extTalk: Number(c?.data?.extensions?.talkativeness ?? 0),
        };
    });
    check('no copy was created by play', after.copies === 0, JSON.stringify({ count: after.count, copies: after.copies }));
    check('original carries the rpg_custodian block', !!after.block && after.block.home_location === 'square', JSON.stringify(after.block)?.slice(0, 80));
    check('greeting and prose untouched', after.fm === before.fm && after.desc === before.desc, `fm ${before.fm}→${after.fm}, desc ${before.desc}→${after.desc}`);
    check('talkativeness 0 on both surfaces', after.talk === 0 && after.extTalk === 0, `${after.talk}/${after.extTalk}`);
    const faceAfter = await sig(before.avatar);
    const d = diff(faceBefore, faceAfter);
    check('portrait art untouched (pixel-identical)', d < 2, `pixel-diff ${d.toFixed(1)}`);

    // 3. the group plays the original
    const members = await page.evaluate(() => {
        const gid = window.rpgCustodianDebug.state().groupId;
        return (SillyTavern.getContext().groups.find(g => g.id === gid)?.members) || [];
    });
    check('group membership = original card', members.includes(before.avatar) && members.every(m => !m.startsWith('RPGC_')), JSON.stringify(members));

    // 3b. RPG-C tags via the ST tag system
    const tagState = await page.evaluate((av) => {
        const ctx = SillyTavern.getContext();
        const tag = (ctx.tags || []).find(t => t.name === 'RPG-C');
        return {
            exists: !!tag,
            onCast: !!tag && (ctx.tagMap[av] || []).includes(tag.id),
            onGM: !!tag && (ctx.tagMap['Game Master.png'] || []).includes(tag.id),
        };
    }, before.avatar);
    check('RPG-C tag exists in the ST tag system', tagState.exists);
    check('cast member wears the RPG-C tag', tagState.onCast);
    check('Game Master wears the RPG-C tag', tagState.onGM);

    // 4. fresh chat: no auto-seeded greetings — engine banner only
    const chatHeads = await page.evaluate(() => (SillyTavern.getContext().chat || []).slice(0, 4).map(m => `${m.name}:${m.is_system ? 'sys' : 'live'}:${(m.mes || '').slice(0, 30)}`));
    console.log('chat head:', JSON.stringify(chatHeads));
    check('fresh game chat has no greeting spam', await page.evaluate(() => !(SillyTavern.getContext().chat || []).some(m => m.name === 'Trizel')));

    // cleanup
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        delete ctx.extensionSettings['rpg-custodian'].authoredWorlds['singlecard-proof'];
        await window.rpgCustodianDebug.refreshWorlds();
        ctx.saveSettingsDebounced();
    });

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
