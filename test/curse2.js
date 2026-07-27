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
  await wait(2500);
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('Create Character'))?.click());
  await wait(6000);
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('New Game'))?.click());
  await wait(20000);
  await D(()=>{ window.rpgCustodianDebug.state().currentTime=1; });
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(400);
  const tokBefore = await D(()=>window.rpgCustodianDebug.tokens());
  // curse player, conceive with Fern, birth → crystals, no tokens
  await D(()=>window.rpgCustodianDebug.curse('player')); await wait(150);
  await D(()=>{ window.rpgCustodianDebug.player().stats.virility=3; const r=window.rpgCustodianDebug.rel('Fern'); r.affection=8; });
  await D(()=>window.rpgCustodianDebug.orgasm('Fern', true, 3)); await wait(300);
  const preg = await D(()=>window.rpgCustodianDebug.rel('Fern').pregnancies);
  const kind = await D(()=>window.rpgCustodianDebug.rel('Fern').conceptionKind);
  console.log('Fern preg:', preg, '| conceptionKind:', kind);
  await D(()=>{ window.rpgCustodianDebug.rel('Fern').pregnancy_progress=100; });
  await D(c=>window.rpgCustodianDebug.birth('Fern', c), preg); await wait(300);
  console.log('offspring:', JSON.stringify(await D(()=>window.rpgCustodianDebug.offspring().map(o=>`${o.name}(${o.kind})`))));
  console.log('tokens before/after crystal birth:', tokBefore, '/', await D(()=>window.rpgCustodianDebug.tokens()), '(expect unchanged)');
  console.log('character-sheet curse line present:', await D(()=>window.rpgCustodianDebug.isCursed('player')));
  // timed curse expiry on an NPC
  await D(()=>window.rpgCustodianDebug.curse('Bryony', 4)); await wait(150);
  console.log('\nBryony cursed:', await D(()=>window.rpgCustodianDebug.isCursed('Bryony')));
  await D(()=>window.rpgCustodianDebug.tick(4)); await wait(300);
  console.log('Bryony cursed after 4 ticks:', await D(()=>window.rpgCustodianDebug.isCursed('Bryony')), '(expect false)');
} finally { await page.close(); await browser.disconnect(); }
