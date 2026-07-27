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
  await D(()=>window.rpgCustodianDebug.addGold(150)); await wait(200);
  // open the Items button
  await page.evaluate(()=>[...document.querySelectorAll('button, .menu_button, .rpg-action-btn')].find(b=>/Items/i.test(b.textContent))?.click());
  await wait(700);
  const popup = await page.evaluate(()=>{ const dlg=[...document.querySelectorAll('dialog[open], .popup')].pop(); return dlg? dlg.innerText.replace(/\n{2,}/g,'\n') : '(no popup)'; });
  console.log('=== Inventory popup ===\n'+popup+'\n');
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
  // buff expiry: apply +3 stamina, advance 4 steps, expect max back to 3
  await D(()=>window.rpgCustodianDebug.buff('player','stamina',3,'Stamina Elixir'));
  const m1 = await D(()=>window.rpgCustodianDebug.maxStamina());
  for(let i=0;i<4;i++){ await D(()=>{ window.rpgCustodianDebug.state().timeStep = (window.rpgCustodianDebug.state().timeStep||0)+1; }); }
  // trigger prune by examining self (pruneBuffs runs on advanceTime; force via a wait tick)
  await D(()=>window.rpgCustodianDebug.act('(time passes)')); await wait(1500);
  const m2 = await D(()=>window.rpgCustodianDebug.maxStamina());
  console.log(`stamina buff max: ${m1} → after 4 steps: ${m2} (expect 6 → 3)`);
} finally { await page.close(); await browser.disconnect(); }
