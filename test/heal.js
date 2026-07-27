import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Dyna','A hero.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = fn => page.evaluate(fn);
try {
  await login(page);
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
  for(let i=0;i<12;i++){const s=await page.evaluate(()=>SillyTavern.getContext().onlineStatus); if(s!=='no_connection')break; await wait(2500);}
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('Create Character'))?.click());
  await wait(6000);
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('New Game'))?.click());
  await wait(20000);
  // Raise ruggedness so we have a bigger pool to observe (max=6)
  await D(()=>window.rpgCustodianDebug.boost('ruggedness',3));
  await D(()=>{ window.rpgCustodianDebug.player().stats.stamina = 6; }); // full at 6
  console.log('max='+await D(()=>window.rpgCustodianDebug.maxStamina()));
  // knock down to 1
  await D(()=>window.rpgCustodianDebug.hurt('player',5)); await wait(150);
  console.log('after hurt 5: cur='+await D(()=>window.rpgCustodianDebug.stamina()));
  // partial heal +2
  await D(()=>window.rpgCustodianDebug.heal('player',2)); await wait(150);
  console.log('after heal +2: cur='+await D(()=>window.rpgCustodianDebug.stamina())+'  (expect 3)');
  // knock unconscious
  await D(()=>window.rpgCustodianDebug.hurt('player',9)); await wait(150);
  console.log('after hurt 9: cur='+await D(()=>window.rpgCustodianDebug.stamina())+' KO='+await D(()=>!!window.rpgCustodianDebug.player().stats.unconscious));
  // full heal revives
  await D(()=>window.rpgCustodianDebug.heal('player','full')); await wait(150);
  console.log('after heal full: cur='+await D(()=>window.rpgCustodianDebug.stamina())+' KO='+await D(()=>!!window.rpgCustodianDebug.player().stats.unconscious)+'  (expect 6, KO false)');
  // NPC heal path (teleport to Fern, hurt then heal)
  await D(()=>{ window.rpgCustodianDebug.state().currentTime=1; });
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(800);
  await D(()=>window.rpgCustodianDebug.hurt('Fern',99)); await wait(150);
  const b = await D(()=>window.rpgCustodianDebug.npcStamina('Fern'));
  await D(()=>window.rpgCustodianDebug.heal('Fern','full')); await wait(150);
  const a = await D(()=>window.rpgCustodianDebug.npcStamina('Fern'));
  console.log(`Fern: KO'd → ${JSON.stringify(b)}, after full heal → ${JSON.stringify(a)}, KO=${await D(()=>!!window.rpgCustodianDebug.player().relationships?.Fern?.npcUnconscious)}`);
} finally { await page.close(); await browser.disconnect(); }
