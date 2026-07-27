import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A bold adventurer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
try {
  await login(page);
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
  for(let i=0;i<12;i++){const s=await page.evaluate(()=>SillyTavern.getContext().onlineStatus); if(s!=='no_connection')break; await wait(2500);}
  await wait(3000); // let init finish (lorebook)

  console.log('=== LOREBOOK ===');
  console.log('enabled worlds:', JSON.stringify(await D(()=>window.rpgCustodianDebug.worldsEnabled())));
  const lb = await D(()=>window.rpgCustodianDebug.lorebook());
  const entries = lb ? Object.values(lb.entries||{}) : [];
  const cc = entries.find(e=>e.comment==='Crystal Curse');
  console.log('Crystal Curse entry keys:', JSON.stringify(cc?.key));
  console.log('content head:', (cc?.content||'').slice(0,90));

  // start a game for curse mechanics
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('Create Character'))?.click());
  await wait(6000);
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('New Game'))?.click());
  await wait(20000);

  console.log('\n=== CURSE ON PLAYER ===');
  console.log('conceptionKind(Fern) before:', await D(()=>window.rpgCustodianDebug.conceptionKind('Fern')), '(expect live)');
  await D(()=>window.rpgCustodianDebug.curse('player')); await wait(200);
  console.log('player cursed:', await D(()=>window.rpgCustodianDebug.isCursed('player')), '| conceptionKind(Fern):', await D(()=>window.rpgCustodianDebug.conceptionKind('Fern')), '(expect crystal)');
  await D(()=>window.rpgCustodianDebug.uncurse('player')); await wait(200);
  console.log('after uncurse → cursed:', await D(()=>window.rpgCustodianDebug.isCursed('player')), '| conceptionKind(Fern):', await D(()=>window.rpgCustodianDebug.conceptionKind('Fern')), '(expect live)');

  console.log('\n=== CURSE ON NPC (Fern) ===');
  await D(()=>window.rpgCustodianDebug.curse('Fern', 4)); await wait(200); // timed 4 periods
  console.log('Fern cursed:', await D(()=>window.rpgCustodianDebug.isCursed('Fern')), '| conceptionKind(Fern):', await D(()=>window.rpgCustodianDebug.conceptionKind('Fern')), '(expect crystal)');

  console.log('\n=== CURSED CONCEPTION → CRYSTAL BIRTH ===');
  await D(()=>{ window.rpgCustodianDebug.state().currentTime=1; });
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(400);
  await D(()=>{ window.rpgCustodianDebug.player().stats.virility=3; }); // ensure conception
  await D(()=>{ const r=window.rpgCustodianDebug.rel('Fern'); r.affection=8; });
  const oc = await D(()=>window.rpgCustodianDebug.orgasm('Fern', true, 3)); await wait(300);
  const rel = await D(()=>window.rpgCustodianDebug.rel('Fern'));
  console.log('Fern preg:', rel.pregnancies, '| conceptionKind stored:', rel.conceptionKind, '(expect crystal)');
  if (rel.pregnancies>0) {
    await D(()=>{ window.rpgCustodianDebug.rel('Fern').pregnancy_progress=100; });
    await D(()=>window.rpgCustodianDebug.birth('Fern', rel.pregnancies)); await wait(300);
    console.log('offspring:', JSON.stringify(await D(()=>window.rpgCustodianDebug.offspring().map(o=>`${o.name}(${o.kind})`))));
    console.log('tokens (crystals award none):', await D(()=>window.rpgCustodianDebug.tokens()));
  }
  // timed curse expiry
  console.log('\n=== TIMED CURSE EXPIRY (Fern, 4 periods) ===');
  console.log('Fern cursed before ticks:', await D(()=>window.rpgCustodianDebug.isCursed('Fern')));
  await D(()=>window.rpgCustodianDebug.tick(4)); await wait(300);
  console.log('Fern cursed after 4 ticks:', await D(()=>window.rpgCustodianDebug.isCursed('Fern')), '(expect false)');
} finally { await page.close(); await browser.disconnect(); }
