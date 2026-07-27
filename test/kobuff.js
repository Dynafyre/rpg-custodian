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
  // KO the player
  await D(()=>window.rpgCustodianDebug.hurt('player',99)); await wait(150);
  console.log('KO: cur='+await D(()=>window.rpgCustodianDebug.stamina())+' KO='+await D(()=>!!window.rpgCustodianDebug.player().stats.unconscious));
  // apply stamina buff +2 → should revive
  await D(()=>window.rpgCustodianDebug.buff('player','stamina',2,"Fern's breastmilk")); await wait(200);
  console.log('after +2 stamina buff: cur='+await D(()=>window.rpgCustodianDebug.stamina())+' KO='+await D(()=>!!window.rpgCustodianDebug.player().stats.unconscious)+'  (expect cur 2, KO false)');
  // stale-flag self-heal: force an invalid state then read
  await D(()=>{ const p=window.rpgCustodianDebug.player(); p.stats.stamina=3; p.stats.unconscious=true; });
  const cur = await D(()=>window.rpgCustodianDebug.stamina());
  console.log('stale flag (3 stamina, KO=true) → after getStamina read: cur='+cur+' KO='+await D(()=>!!window.rpgCustodianDebug.player().stats.unconscious)+'  (expect KO false)');
} finally { await page.close(); await browser.disconnect(); }
