import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A hero.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
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
  await D(()=>{ window.rpgCustodianDebug.player().stats.ruggedness=8; });
  // status with duration 3 + a condition; verify the TIMER ends it even if condition never met
  await D(()=>window.rpgCustodianDebug.addStatus('player', {name:'Lingering Chill', polarity:'negative', mods:[{stat:'ruggedness',amount:-2}], duration:3, end_condition:'when warmed by a fire'})); await wait(200);
  console.log('rug after status:', await D(()=>window.rpgCustodianDebug.effectiveStat('ruggedness')), '(expect 6)');
  console.log('status:', JSON.stringify(await D(()=>window.rpgCustodianDebug.statuses('player').map(e=>({n:e.name, expiresStep:e.expiresStep})))));
  for(let i=0;i<3;i++){ await D(()=>window.rpgCustodianDebug.tick(1)); await wait(300); }
  console.log('after 3 time periods → statuses:', JSON.stringify(await D(()=>window.rpgCustodianDebug.statuses('player').map(e=>e.name))), '| rug:', await D(()=>window.rpgCustodianDebug.effectiveStat('ruggedness')), '(expect [] and 8 — timer expired it)');
} finally { await page.close(); await browser.disconnect(); }
