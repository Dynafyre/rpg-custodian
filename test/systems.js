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

  console.log('=== CUSTOM STATUS with stat mods ===');
  console.log('charm before:', await D(()=>window.rpgCustodianDebug.effectiveStat('charm')));
  await D(()=>window.rpgCustodianDebug.addStatus('player', {name:"Hero's Blessing", polarity:'positive', desc:'radiant confidence', mods:[{stat:'charm',amount:2}], end_condition:'if you harm an innocent creature'})); await wait(200);
  console.log('charm after +2 blessing:', await D(()=>window.rpgCustodianDebug.effectiveStat('charm')), '(expect +2)');
  console.log('statuses:', JSON.stringify(await D(()=>window.rpgCustodianDebug.statuses('player').map(e=>e.name))));

  console.log('\n=== EQUIPMENT stat bonus (manual mod → equip) ===');
  await D(()=>window.rpgCustodianDebug.giveItem('Honed Spear')); await wait(300);
  // set mod manually to avoid depending on LLM appraise for this assertion
  await D(()=>{ const it=window.rpgCustodianDebug.player().inventory.items.find(i=>/spear/i.test(i.name)); it.mod={stat:'ruggedness',amount:1,condition:null}; it.effectText='+1 Ruggedness for combat'; it.usage='equip'; });
  console.log('ruggedness before equip:', await D(()=>window.rpgCustodianDebug.effectiveStat('ruggedness')));
  await D(()=>window.rpgCustodianDebug.act ? null : null);
  await D(()=>{ const it=window.rpgCustodianDebug.player().inventory.items.find(i=>/spear/i.test(i.name)); it.equipped=true; window.rpgCustodianDebug.player(); });
  await D(()=>window.rpgCustodianDebug.player() && null); await wait(100);
  // force save/recompute
  console.log('ruggedness after equip:', await D(()=>window.rpgCustodianDebug.effectiveStat('ruggedness')), '(expect +1)');
  console.log('items:', JSON.stringify(await D(()=>window.rpgCustodianDebug.items())));

  console.log('\n=== TASK-SATISFIED: curse broken by a loving kiss ===');
  await D(()=>{ window.rpgCustodianDebug.state().currentTime=1; });
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(400);
  await D(()=>window.rpgCustodianDebug.curseWithBreak('player','the curse is broken by a loving, true kiss')); await wait(200);
  console.log('player cursed:', await D(()=>window.rpgCustodianDebug.isCursed('player')));
  // inject a story beat where a loving kiss happens, then run the checker
  await D(()=>{ const c=SillyTavern.getContext().chat; c.push({name:'Fern', is_user:false, is_system:false, mes:'Fern cups your face and presses a slow, loving, true kiss to your lips, tears of joy on her cheeks.', send_date:'now'}); });
  while(await busy())await wait(500);
  await D(()=>window.rpgCustodianDebug.checkConditions()); await wait(2500);
  console.log('player cursed after loving kiss:', await D(()=>window.rpgCustodianDebug.isCursed('player')), '(expect false)');
  // negative control: a status that should NOT end
  await D(()=>{ const c=SillyTavern.getContext().chat; c.push({name:'Reigngard', is_user:true, is_system:false, mes:'I admire the sunset quietly.', send_date:'now'}); });
  await D(()=>window.rpgCustodianDebug.checkConditions()); await wait(2500);
  console.log("blessing still active (no innocent harmed):", JSON.stringify(await D(()=>window.rpgCustodianDebug.statuses('player').map(e=>e.name))), '(expect still has blessing)');
} finally { await page.close(); await browser.disconnect(); }
