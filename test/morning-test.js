import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Dyna','A wanderer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const snap = () => page.evaluate(()=>{const rd=window.rpgCustodianDebug.player(); return {time:['Morning','Day','Evening','Night'][window.rpgCustodianDebug.state().currentTime], day:window.rpgCustodianDebug.state().dayCount, stamina:rd.stats.stamina, maxStam:rd.stats.ruggedness, unconscious:!!rd.stats.unconscious, fern:rd.relationships?.Fern};});
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
  // Drain the player and Fern; set to Evening so 2 ticks reach next Morning
  await page.evaluate(()=>{ const rd=window.rpgCustodianDebug.player(); rd.stats.ruggedness=4; rd.stats.stamina=0; rd.stats.unconscious=true; rd.relationships={Fern:{affection:5,arousal:1,familiarity:2,pregnancies:0,pregnancy_progress:0,npcStamina:0,npcUnconscious:true}}; window.rpgCustodianDebug.state().currentTime=2; });
  console.log('DRAINED (Evening):', JSON.stringify(await snap()));
  // advance: Evening -> Night
  await page.evaluate(()=>window.rpgCustodianDebug.state()); // noop
  await page.evaluate(async ()=>{ await window.rpgCustodianDebug.act; }); // ensure debug present
  // pass time twice via the engine (Evening->Night->Morning)
  await page.evaluate(()=>{ window.__adv = null; });
  for (let k=0;k<2;k++){ await page.evaluate(()=>{ /* advance via wait command path */ }); }
  // call advanceTimeBy via a small hook: use the Wait button twice
  await page.evaluate(()=>document.querySelector('#rpg-action-bar')); 
  // Simplest: click Wait button twice
  const clickWait = async()=>{ await page.evaluate(()=>{ const b=[...document.querySelectorAll('#rpg-action-bar .rpg-action-btn')].find(x=>x.textContent.includes('Wait')); b&&b.click(); }); await wait(3000); };
  await clickWait(); console.log('after wait 1:', JSON.stringify(await snap()));
  await clickWait(); console.log('after wait 2 (should be Morning, restored):', JSON.stringify(await snap()));
} finally { await page.close(); await browser.disconnect(); }
