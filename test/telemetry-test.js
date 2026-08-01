// Turn telemetry: the clock starts when the send button is pressed and stops
// when the last judge of the chain finishes. Every stage and every model round
// trip is recorded, timestamped and cross-referenced to the chat log, so a
// human playtest can be parsed afterwards.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const turn = async (text) => {
    await page.type('#send_textarea', text);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 60; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2500);
};

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(22000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('outskirts')); await wait(1500);
    await page.evaluate(() => window.rpgCustodianDebug.perfClear());

    // the chip must appear WHILE the engine is working
    await page.type('#send_textarea', `"Bryony, what's the road like north of here?"`);
    await page.keyboard.press('Enter');
    await wait(2500);
    const chip = await page.evaluate(() => {
        const el = document.querySelector('#rpg-perf-chip');
        return el ? { visible: el.offsetParent !== null, text: el.textContent } : null;
    });
    console.log('chip mid-turn:', JSON.stringify(chip));
    check('a chip shows what the engine is doing', !!chip && chip.visible, JSON.stringify(chip));
    check('and it names the stage and elapsed time', !!chip && /\d+\.\d+s/.test(chip.text), chip?.text);
    for (let i = 0; i < 60; i++) { await wait(2000); if (!(await page.evaluate(() => window.rpgCustodianDebug.busy()))) break; }
    await wait(2500);
    const gone = await page.evaluate(() => { const el = document.querySelector('#rpg-perf-chip'); return !el || el.offsetParent === null; });
    check('the chip clears when the turn is done', gone);

    await turn(`"And is the pass still open this time of year?"`);

    const rows = await page.evaluate(() => window.rpgCustodianDebug.perf());
    const raw = await page.evaluate(() => window.rpgCustodianDebug.perfRaw());
    console.log('\nturn summary:');
    for (const r of rows) console.log(`   ${r.at} · mes ${r.mes} · total ${r.total}ms · visible ${r.visible}ms · judge tail ${r.judgeTail}ms · ${r.calls} calls · slowest "${r.slowest}"`);
    check('turns were recorded', rows.length >= 2, `${rows.length}`);
    const t = raw[raw.length - 1];
    check('total is measured from send to the last judge', typeof t.totalMs === 'number' && t.totalMs > 0, `${t.totalMs}ms`);
    check('visible (her words on the page) is measured separately', typeof t.visibleMs === 'number' && t.visibleMs <= t.totalMs, `${t.visibleMs} <= ${t.totalMs}`);
    check('the judge tail is priced — this is what pitch 1 would buy', typeof t.judgeTailMs === 'number', `${t.judgeTailMs}ms`);
    check('every stage is timed', t.stages.length > 0 && t.stages.every(s => typeof s.at === 'number'), JSON.stringify(t.stages.map(s => `${s.label}:${s.ms}ms`)));
    check('every model round trip is timed and sized', t.calls.length > 0 && t.calls.every(c => typeof c.ms === 'number' && c.inChars > 0),
        JSON.stringify(t.calls.map(c => `${c.kind}:${c.ms}ms in~${c.estInTokens}t out~${c.estOutTokens}t`)));
    check('it cross-references the chat log', typeof t.chatIndex === 'number', `mes ${t.chatIndex}`);
    check('and stamps wall-clock time', /^\d{4}-\d{2}-\d{2}T/.test(t.startedAt), t.startedAt);
    console.log('\nstages:', JSON.stringify(t.stages.map(s => `${s.label} @${s.at}ms took ${s.ms}ms`), null, 0));
    console.log('calls  :', JSON.stringify(t.calls.map(c => `${c.kind} @${c.at}ms took ${c.ms}ms in~${c.estInTokens}t out~${c.estOutTokens}t`), null, 0));

    // survives a reload, so a long human playtest accumulates
    await page.reload({ waitUntil: 'domcontentloaded' }); await wait(9000);
    const after = await page.evaluate(() => (window.rpgCustodianDebug?.perf() || []).length);
    check('records persist across a reload', after >= rows.length, `${after} turns`);

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
