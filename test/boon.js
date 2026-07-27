import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A bold adventurer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
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
  await D(()=>{ window.rpgCustodianDebug.state().currentTime=1; });
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(1000);
  const rugBefore = await D(()=>window.rpgCustodianDebug.effectiveStat('ruggedness'));
  // Seed the scene: Fern offers a blessing of Ruggedness
  await D(()=>{ const c=SillyTavern.getContext().chat; c.push({name:'Fern', is_user:false, is_system:false, mes:"Ruggedness, you say. I can grant this, mortal. But know what you ask. Kneel, and accept my blessing — the strength of ancient wyrms will settle into your bones, and when your new might takes hold, you will return to test it against me.", send_date:'now'}); });
  // Player kneels to accept
  while(await busy())await wait(600);
  await D(()=>window.rpgCustodianDebug.act('I kneel before Fern and bow my head to accept her blessing of strength.'));
  for(let i=0;i<40;i++){ await wait(1500); if(!(await busy()))break; }
  await wait(1500);
  const buffs = await D(()=>window.rpgCustodianDebug.player().buffs || []);
  const rugAfter = await D(()=>window.rpgCustodianDebug.effectiveStat('ruggedness'));
  console.log('Ruggedness before:', rugBefore, '→ after accepting blessing:', rugAfter);
  console.log('Buffs:', JSON.stringify(buffs));
} finally { await page.close(); await browser.disconnect(); }
