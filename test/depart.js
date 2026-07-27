import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A bold adventurer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
const busy = () => D(()=>window.rpgCustodianDebug.busy());
const lastFern = async () => D(()=>{const c=SillyTavern.getContext().chat;for(let i=c.length-1;i>=0;i--){if(c[i].name==='Fern'&&!c[i].is_user)return c[i].mes;}return '(none)';});
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
  // Evening: Fern's schedule = outskirts. Put her in party at town-square, then dismiss.
  await D(()=>{ window.rpgCustodianDebug.state().currentTime=2; }); // Evening
  await D(()=>window.rpgCustodianDebug.teleport('town-square')); await wait(600);
  await D(()=>window.rpgCustodianDebug.addParty('Fern')); await wait(700);
  console.log('Fern scheduled (Evening) →', await D(()=>window.rpgCustodianDebug.sched('Fern')));
  console.log('dismissing conscious Fern...');
  await D(()=>window.rpgCustodianDebug.removeParty('Fern'));
  for(let i=0;i<40;i++){ await wait(1500); if(!(await busy()))break; }
  await wait(1500);
  console.log('\n=== Fern farewell ===\n'+(await lastFern()));
} finally { await page.close(); await browser.disconnect(); }
