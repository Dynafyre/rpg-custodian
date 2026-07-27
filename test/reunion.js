import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A bold adventurer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
const busy = () => D(()=>window.rpgCustodianDebug.busy());
const T = () => D(()=>window.rpgCustodianDebug.state().timeStep);
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
  await D(()=>{ window.rpgCustodianDebug.state().currentTime=1; });
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(900);

  console.log('Fern schedule summary:', await D(()=>window.rpgCustodianDebug.sched('Fern')));
  console.log('\n--- STATUS BLOCK (what NPCs see) ---\n'+await D(()=>window.rpgCustodianDebug.statusText()));

  // 1) First meeting: no reunion note (never seen)
  console.log('\nreunionNote before ever meeting:', await D(()=>window.rpgCustodianDebug.reunionNote('Fern')));
  // simulate her having replied by marking seen at t=0
  await D(()=>window.rpgCustodianDebug.rel('Fern')); // ensure rel exists
  await D(()=>{ const r=window.rpgCustodianDebug.rel('Fern'); r.lastSeenStep = window.rpgCustodianDebug.state().timeStep; });
  console.log('lastSeenStep set to', await T());

  // 2) Together: wait in place → still seen → no reunion
  await D(()=>window.rpgCustodianDebug.state()); 
  for(let i=0;i<2;i++){ await D(()=>window.rpgCustodianDebug.state()); }
  // advance time IN PLACE via Wait (Fern present at forest morning/day/night)
  await D(()=>{ window.rpgCustodianDebug.state().currentTime=0; }); // Morning (Fern at forest)
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-action-btn')].find(b=>/Wait/i.test(b.textContent))?.click());
  await wait(1500);
  console.log('after waiting IN PLACE with Fern (t='+await T()+'), reunionNote:', await D(()=>window.rpgCustodianDebug.reunionNote('Fern')));

  // 3) Leave her, let days pass while away, return
  await D(()=>window.rpgCustodianDebug.teleport('town-square')); await wait(600);
  for(let i=0;i<10;i++){ await page.evaluate(()=>[...document.querySelectorAll('.rpg-action-btn')].find(b=>/Wait/i.test(b.textContent))?.click()); await wait(900); }
  console.log('\nafter leaving + 10 waits away (t='+await T()+'), Fern lastSeenStep still', await D(()=>window.rpgCustodianDebug.rel('Fern').lastSeenStep));
  await D(()=>{ window.rpgCustodianDebug.state().currentTime=1; });
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(700);
  const note = await D(()=>window.rpgCustodianDebug.reunionNote('Fern'));
  console.log('\n=== REUNION NOTE on return ===\n'+note);
} finally { await page.close(); await browser.disconnect(); }
