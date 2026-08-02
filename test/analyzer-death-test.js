// A dead Custodian must not look like a quiet turn.
//
// When both attempts in analyzeIntent fail it returns a bare {mechanical:false}
// — no check, no effects, nothing on screen — which is EXACTLY the shape of "the
// player said something stakeless". Turns that silently lost their mechanics were
// therefore invisible in the very telemetry collected to find them, and an empty
// reply was logged as a fast, healthy round trip because only a THROWN call was
// ever flagged.
//
// The generation endpoint is intercepted at the network layer so the failure is
// deterministic and no production code needs a test seam.
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

const ACTION = `I draw my knife and lunge at the wolf.`;
const settle = async () => { for (let i = 0; i < 40; i++) { if (!(await page.evaluate(() => window.rpgCustodianDebug.busy()))) return; await wait(1500); } };

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

    // ── 1. a healthy turn is stamped as such ──────────────────────────────
    await page.evaluate(async (t) => { await window.rpgCustodianDebug.act(t); }, ACTION);
    await settle();
    const good = await page.evaluate(() => window.rpgCustodianDebug.perf().slice(-1)[0]);
    console.log('   healthy turn:', JSON.stringify({ custodian: good?.custodian, calls: good?.calls }));
    check('a healthy turn records the Custodian as answering', good?.custodian === 'ok' || good?.custodian === 'recovered', String(good?.custodian));
    check('and is NOT counted among the dead', (await page.evaluate(() => window.rpgCustodianDebug.perfDead().length)) === 0);

    // ── 2. kill every generation, then act ────────────────────────────────
    await page.setRequestInterception(true);
    const killer = (req) => {
        if (/\/api\/backends\/.*\/generate|\/api\/.*generate/.test(req.url())) {
            return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '' } }] }) });
        }
        req.continue();
    };
    page.on('request', killer);
    await page.evaluate(() => window.rpgCustodianDebug.perfClear());
    await page.evaluate(async (t) => { await window.rpgCustodianDebug.act(t); }, ACTION);
    await settle();

    const dead = await page.evaluate(() => window.rpgCustodianDebug.perf().slice(-1)[0]);
    const deadList = await page.evaluate(() => window.rpgCustodianDebug.perfDead());
    const rawTurn = await page.evaluate(() => window.rpgCustodianDebug.perfRaw().slice(-1)[0]);
    console.log('   killed turn:', JSON.stringify({ custodian: dead?.custodian, why: deadList[0]?.why }));

    check('a dead Custodian is stamped on the turn', dead?.custodian === 'dead', String(dead?.custodian));
    check('perfDead() lists the lost turn with its cause', deadList.length === 1 && !!deadList[0].why, JSON.stringify(deadList[0] || null));
    check('the lost turn keeps the action that was thrown away', deadList[0]?.action?.includes('lunge'), deadList[0]?.action);

    // the whole point: an empty reply must be logged as a FAILED call, not a fast one
    const analyzerCalls = (rawTurn?.calls || []).filter(c => String(c.kind).startsWith('analyzer'));
    console.log('   analyzer calls:', JSON.stringify(analyzerCalls.map(c => ({ kind: c.kind, ms: c.ms, failed: c.failed }))));
    check('both analyzer attempts are recorded', analyzerCalls.length === 2, `${analyzerCalls.length}`);
    check('an empty reply is flagged FAILED, not logged as a healthy call', analyzerCalls.every(c => !!c.failed), JSON.stringify(analyzerCalls.map(c => c.failed)));

    // and the live face
    const chip = await page.evaluate(() => { const el = document.querySelector('#rpg-perf-chip'); return el ? { text: el.textContent, shown: el.offsetParent !== null, warn: el.classList.contains('rpg-perf-stall') } : null; });
    console.log('   chip:', JSON.stringify(chip));
    check('the chip says so out loud instead of fading away', !!chip?.shown && /Custodian never answered/i.test(chip.text || ''), JSON.stringify(chip));
    check('the console shouts it', consoleLogs.some(l => /THE CUSTODIAN NEVER ANSWERED/.test(l)));

    page.off('request', killer);

    // ── 3. the other death: a reply that ARRIVES but is not JSON ──────────
    // This one never throws, so before the fix it closed as an ordinary
    // healthy call — a prompt, cheap round trip that happened to apply nothing.
    const babbler = (req) => {
        if (/\/api\/backends\/.*\/generate|\/api\/.*generate/.test(req.url())) {
            return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'Certainly! The hero lunges bravely at the wolf, blade flashing.' } }] }) });
        }
        req.continue();
    };
    page.on('request', babbler);
    await page.evaluate(() => window.rpgCustodianDebug.perfClear());
    await page.evaluate(async (t) => { await window.rpgCustodianDebug.act(t); }, ACTION);
    await settle();
    const babble = await page.evaluate(() => window.rpgCustodianDebug.perfRaw().slice(-1)[0]);
    const babbleCalls = (babble?.calls || []).filter(c => String(c.kind).startsWith('analyzer'));
    console.log('   prose-instead-of-JSON:', JSON.stringify(babbleCalls.map(c => ({ ms: c.ms, failed: c.failed }))));
    check('prose instead of JSON is also stamped dead', babble?.analyzer === 'dead', String(babble?.analyzer));
    check('and each unparseable reply is flagged, not logged as healthy', babbleCalls.length > 0 && babbleCalls.every(c => /unparseable/.test(String(c.failed))), JSON.stringify(babbleCalls.map(c => c.failed)));
    page.off('request', babbler);
    await page.setRequestInterception(false);

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
