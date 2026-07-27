// Narrative & capping statuses — confirmed the honest way: everything is done
// to Wren in NATURAL LANGUAGE and we watch the Custodian invent the statuses
// unprompted (no debug application). Debug is only used to set the scene and
// READ resulting state.
//  1. rope-binding  → a constraint status appears (likely no mods)
//  2. "walk for me" → her reply is bound by the constraint
//  3. cutting free  → the status ends in play
//  4. slumber-dust  → her stamina pool is dragged down (cap or mod)
//  5. numbing torc  → her arousal is dragged down (cap or mod)
//  6. stolen purse  → an emotional wound lowers her effective affection
import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r => setTimeout(r, ms));
const answers = ['Reigngard', 'A virile hero.', 'Wanderer', 'Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

const say = async (text) => {
    const from = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await page.type('#send_textarea', text);
    await page.keyboard.press('Enter');
    let sb = false;
    for (let i = 0; i < 70; i++) { await wait(2000); const b = await page.evaluate(() => window.rpgCustodianDebug.busy()); if (b) sb = true; if (sb && !b) break; }
    await wait(2500);
    const intent = consoleLogs.filter(l => l.includes('intent =')).slice(-1)[0] || '';
    console.log('  intent:', intent.replace(/^.*intent = /, '').replace(/\s+/g, ' ').slice(0, 300));
    return await page.evaluate(x => (SillyTavern.getContext().chat ?? []).slice(x).filter(m => !m.is_user && !m.is_system).map(m => `${m.name}: ${m.mes}`).join('\n'), from);
};
const fx = () => page.evaluate(() => (window.rpgCustodianDebug.statuses('Wren') || []).map(e => ({ name: e.name, mods: e.mods, desc: e.desc, end: e.endCondition })));
const eff = () => page.evaluate(() => window.rpgCustodianDebug.npcEff('Wren'));

try {
    await page.setCacheEnabled(false);
    await login(page);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => SillyTavern.getContext().onlineStatus); if (s !== 'no_connection') break; await wait(2500); }
    await page.click('#rpg-menu-button'); await wait(400);
    await page.evaluate(() => [...document.querySelectorAll('.rpg-menu-item')].find(e => e.textContent.includes('Create Character'))?.click()); await wait(5000);
    await page.evaluate(() => window.rpgCustodianDebug.newGame('prototype-town')); await wait(18000);
    await page.evaluate(() => window.rpgCustodianDebug.teleport('shop')); await wait(1200);
    // scene setup only (not status application): warm baselines so drops are visible
    await page.evaluate(() => { window.rpgCustodianDebug.setArousal('Wren', 6); window.rpgCustodianDebug.setAffection('Wren', 6); });
    const base = await eff();
    console.log('baseline:', JSON.stringify(base));

    // ---- 1. done-to constraint: rope-binding, no system words used ----
    let r = await say(`"A demonstration of my knots," I grin, uncoiling a rope from my pack. Wren gamely holds out her arms, and I bind her wrists and ankles snugly together behind her back — trussed up neat as a festival goose, she couldn't so much as hop to the door.`);
    console.log('scene:', r.replace(/\s+/g, ' ').slice(0, 220));
    let effects = await fx();
    console.log('effects now:', JSON.stringify(effects));
    check('binding produced an invented status', effects.length >= 1, effects.map(e => e.name).join(', '));
    check('constraint is narrative (desc states it)', effects.some(e => /bound|tied|rope|truss|restrain|immobil|can.?not (move|walk|stand)/i.test(`${e.name} ${e.desc}`)));
    check('analyzer context carries the constraint', /ALREADY under effects/.test(await page.evaluate(() => window.rpgCustodianDebug.analyzerNpcs())));

    // ---- 2. the constraint binds her behavior ----
    r = await say(`"Comfortable? Walk to the door for me, would you?" I ask, watching her.`);
    console.log('Wren bound:', r.replace(/\s+/g, ' ').slice(0, 260));
    check('her reply is bound by the restraint', /rope|bound|tied|truss|wriggl|squirm|hop|can'?t|cannot|helpless|knot/i.test(r));

    // ---- 3. release ends it in play ----
    r = await say(`Chuckling, I draw my knife and cut Wren's ropes away, steadying her by the shoulders as she finds her feet again.`);
    console.log('release:', r.replace(/\s+/g, ' ').slice(0, 200));
    for (let i = 0; i < 10 && (await fx()).some(e => /bound|tied|rope|truss/i.test(e.name)); i++) await wait(2000);   // condition judge may land a beat later
    effects = await fx();
    check('cutting her free ended the constraint', !effects.some(e => /bound|tied|rope|truss/i.test(`${e.name} ${e.desc}`)), JSON.stringify(effects.map(e => e.name)));

    // ---- 4. stamina drag: slumber-dust ----
    r = await say(`I produce a pouch of grey slumber-dust and blow a pinch into Wren's face; a leaden weariness sinks into her limbs at once, so heavy she can barely keep her feet under her.`);
    console.log('dust:', r.replace(/\s+/g, ' ').slice(0, 200));
    let e2 = await eff();
    console.log('after dust:', JSON.stringify(e2), 'effects:', JSON.stringify(await fx()));
    check('slumber-dust dragged her stamina pool down', e2.staMax < base.staMax || (e2.sta != null && e2.sta <= 1), `staMax ${base.staMax}→${e2.staMax}, sta ${e2.sta}`);

    // ---- 5. arousal seal: numbing torc ----
    r = await say(`From my pack I take a rune-etched silver torc and clasp it around Wren's neck; a numbing chill spreads from the metal, deadening all warmth of desire in her body for as long as it stays locked.`);
    console.log('torc:', r.replace(/\s+/g, ' ').slice(0, 200));
    e2 = await eff();
    console.log('after torc:', JSON.stringify(e2), 'effects:', JSON.stringify(await fx()));
    check('torc sealed her arousal well below baseline', e2.aro < base.aro, `aro ${base.aro}→${e2.aro}`);

    // ---- 6. emotional wound: betrayal lowers effective affection ----
    r = await say(`While Wren is still off-balance I snatch the coin purse from her counter — her week's takings — and pocket it in front of her, daring her with a look to do anything about it.`);
    console.log('betrayal:', r.replace(/\s+/g, ' ').slice(0, 240));
    e2 = await eff();
    const wound = (await fx()).filter(e => (e.mods || []).some(m => m.stat === 'affection'));
    console.log('after betrayal:', JSON.stringify(e2), 'wound statuses:', JSON.stringify(wound));
    check('betrayal wounded her (affection status or drop)', wound.length >= 1 || e2.aff < base.aff, `aff ${base.aff}→${e2.aff}`);
    if (wound.length) check('the wound has an amends-style end', wound.some(w => !!w.end), JSON.stringify(wound.map(w => w.end)));

    const intents = consoleLogs.filter(l => l.includes('intent =')).join('\n');
    check('Custodian reached for add_status unprompted', /"type":\s*"add_status"/.test(intents));

    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
} finally { await page.close(); await browser.disconnect(); }
