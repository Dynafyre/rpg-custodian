import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Dyna','A hero.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = fn => page.evaluate(fn);
const busy = () => D(()=>window.rpgCustodianDebug.busy());
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
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-action-btn')].find(b=>/Items/i.test(b.textContent))?.click());
  await wait(700);
  const popup = await D(()=>{ const p=document.getElementById('rpg-action-popup'); return p? p.innerText : '(no popup)'; });
  console.log('=== Inventory popup ===\n'+popup);
  await D(()=>document.getElementById('rpg-action-popup')?.remove());
  // buff expiry via real Wait cycles
  await D(()=>window.rpgCustodianDebug.buff('player','stamina',3,'Stamina Elixir'));
  const m1 = await D(()=>window.rpgCustodianDebug.maxStamina());
  for(let i=0;i<4;i++){ while(await busy())await wait(800);
    await page.evaluate(()=>[...document.querySelectorAll('.rpg-action-btn')].find(b=>/Wait/i.test(b.textContent))?.click());
    await wait(1500); }
  while(await busy())await wait(800);
  const m2 = await D(()=>window.rpgCustodianDebug.maxStamina());
  console.log(`\nstamina buff maxStamina: ${m1} → after 4 Waits: ${m2}  (expect 6 → 3)`);
} finally { await page.close(); await browser.disconnect(); }
