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
  const before = await D(()=>({max:window.rpgCustodianDebug.maxStamina(), cur:window.rpgCustodianDebug.stamina(), rug:window.rpgCustodianDebug.effectiveStat('ruggedness')}));
  console.log('BEFORE buff:', JSON.stringify(before));
  // spend some stamina first so top-up is observable
  await D(()=>{ window.rpgCustodianDebug.player().stats.stamina = 1; });
  await D(()=>window.rpgCustodianDebug.buff('player','stamina',3,'Stamina Elixir'));
  await wait(300);
  const after = await D(()=>({max:window.rpgCustodianDebug.maxStamina(), cur:window.rpgCustodianDebug.stamina()}));
  console.log('spent to 1, then +3 stamina buff →', JSON.stringify(after), `(expect max ${before.rug+3}, cur 4)`);
  // examineSelf output
  const len = await D(()=>SillyTavern.getContext().chat.length);
  await D(()=>window.rpgCustodianDebug.examineSelf());
  await wait(400);
  const msg = await page.evaluate(l=>{const c=SillyTavern.getContext().chat; return c.slice(l).map(m=>m.mes).join('\n---\n');}, len);
  console.log('\n=== Look at yourself ===\n'+msg);
} finally { await page.close(); await browser.disconnect(); }
