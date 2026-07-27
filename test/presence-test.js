// Witness-scoping via the SillyTavern-Presence extension (Dyna's scenario):
// spread a rumor to Bryony at the outskirts, then ask Wren at the shop about
// the (unspecific) exciting news. BEFORE (Presence disabled) the rumor leaks
// into Wren's context; AFTER (enabled + our stamps) she can't have heard it.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
// NOTE: mutate the settings object IN PLACE — Presence holds a module-level
// reference to it; replacing the object silently disconnects the extension.
const setPresence = (on) => page.evaluate(v => { const c = SillyTavern.getContext(); const s = c.extensionSettings['Presence'] || (c.extensionSettings['Presence'] = {}); Object.assign(s, { location: 'top', debugMode: false, seeLast: true, includeMuted: false, universalTrackerOn: false, disableTransition: false, debug: false, enabled: v }); c.saveSettingsDebounced(); }, on);
const act = async (text, settleMs = 2000) => {
    const s = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await page.type('#send_textarea', text); await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 55; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(settleMs);
    return page.evaluate(x => (SillyTavern.getContext().chat ?? []).slice(x).map(m => ({ who: m.is_user ? 'you' : (m.is_system ? 'sys' : m.name), mes: (m.mes || ''), present: m.present || null })), s);
};
const runScenario = async () => {
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(18000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1200);
    const rumorTail = await act('"Bryony — big news, keep it to yourself," I whisper to the warden. "The King himself is coming to town next week. The King! Not a word to anyone."');
    await page.evaluate(() => window.rpgCustodianDebug.nlMove('General Store')); await wait(2500);
    const askTail = await act('"Wren! Have you heard the exciting news?" I ask the merchant eagerly.');
    const wren = askTail.filter(m => m.who === 'Wren').map(m => m.mes).join(' ');
    return { rumorTail, askTail, wren };
};

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);

    // Presence binds its settings object at MODULE LOAD (const at import
    // time) — toggles only take effect after a page reload. Set → save →
    // reload for each phase.
    const reloadWith = async (enabled) => {
        await setPresence(enabled); await wait(2500);   // let the debounced save land
        await login(page);
        await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
        await wait(2500);
    };

    // ---- BEFORE: Presence disabled (Dyna's current state) ----
    await reloadWith(false);
    const before = await runScenario();
    const leakedBefore = /\bking\b/i.test(before.wren);
    console.log('BEFORE — Wren:', before.wren.replace(/\s+/g, ' ').slice(0, 220));
    console.log(`BEFORE: rumor ${leakedBefore ? 'LEAKED into' : 'not surfaced in'} Wren's reply (context was unfiltered either way)`);

    // ---- AFTER: Presence enabled + engine stamps ----
    await reloadWith(true);
    const after = await runScenario();
    console.log('AFTER — Wren:', after.wren.replace(/\s+/g, ' ').slice(0, 220));
    check('AFTER: Wren has NOT heard about the King', !/\bking\b/i.test(after.wren), after.wren.slice(0, 80));

    // Stamp assertions on the AFTER chat
    const rumorMsg = after.rumorTail.find(m => m.who === 'you');
    check('rumor stamped with witnesses', Array.isArray(rumorMsg?.present) && rumorMsg.present.some(a => /Bryony/.test(a)) && !rumorMsg.present.some(a => /Wren/.test(a)), JSON.stringify(rumorMsg?.present));
    const gmAll = await page.evaluate(() => (SillyTavern.getContext().chat || []).filter(m => !m.is_user && m.name === 'Game Master').map(m => ({ mes: (m.mes || '').slice(0, 50), ok: Array.isArray(m.present) && m.present.includes('Game Master.png') })));
    for (const g of gmAll.filter(g => !g.ok)) console.log('UNSTAMPED GM msg:', g.mes);
    check('engine-pushed GM messages carry stamps (whole chat)', gmAll.length > 0 && gmAll.every(g => g.ok), `${gmAll.length} GM msgs`);
    const bryonyReply = after.rumorTail.find(m => m.who === 'Bryony');
    check('Bryony replied to the rumor (flow intact)', !!bryonyReply);

    // restore test account default (other suites push unstamped messages)
    await setPresence(false); await wait(500);

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
