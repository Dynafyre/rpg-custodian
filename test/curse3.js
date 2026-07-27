import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A bold adventurer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
try {
  await login(page);
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
  for(let i=0;i<12;i++){const s=await page.evaluate(()=>SillyTavern.getContext().onlineStatus); if(s!=='no_connection')break; await wait(2500);}
  await wait(3000);
  console.log('=== LOREBOOK BOUND TO GM ===');
  console.log('GM world:', await D(()=>window.rpgCustodianDebug.gmWorld()));
  const lb = await D(()=>window.rpgCustodianDebug.lorebook());
  console.log('entries:', JSON.stringify((lb?Object.values(lb.entries):[]).map(e=>e.comment)));

  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('Create Character'))?.click());
  await wait(6000);
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('New Game'))?.click());
  await wait(20000);
  await D(()=>{ window.rpgCustodianDebug.state().currentTime=1; });
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(400);

  console.log('\n=== CURSE CONTEST: player casts on Fern (high craft → lands) ===');
  await D(()=>{ window.rpgCustodianDebug.player().stats.craftiness=12; });
  await D(()=>window.rpgCustodianDebug.castCurse({target:'Fern'})); await wait(200);
  console.log('Fern cursed:', await D(()=>window.rpgCustodianDebug.isCursed('Fern')), '(expect true)');

  console.log('\n=== CURSE CONTEST: trap power 0 vs tough player (→ resisted) ===');
  await D(()=>{ window.rpgCustodianDebug.player().stats.ruggedness=10; });
  await D(()=>window.rpgCustodianDebug.castCurse({target:'player', power:0, source:'a weak glyph-trap'})); await wait(200);
  console.log('player cursed:', await D(()=>window.rpgCustodianDebug.isCursed('player')), '(expect false — resisted)');

  console.log('\n=== FORCED curse (contest:false) ===');
  await D(()=>window.rpgCustodianDebug.castCurse({target:'player', contest:false})); await wait(200);
  console.log('player cursed:', await D(()=>window.rpgCustodianDebug.isCursed('player')), '(expect true)');
  await D(()=>window.rpgCustodianDebug.uncurse('player')); await wait(150);

  console.log('\n=== SOUL CRYSTAL → +1 MANA ===');
  await D(()=>{ window.rpgCustodianDebug.player().stats.craftiness=3; window.rpgCustodianDebug.player().stats.mana=0; });
  console.log('mana before:', JSON.stringify(await D(()=>window.rpgCustodianDebug.mana())));
  await D(()=>window.rpgCustodianDebug.giveItem('soul crystal')); await wait(150);
  await D(()=>window.rpgCustodianDebug.useItemNamed('soul crystal')); await wait(200);
  console.log('mana after crushing crystal:', JSON.stringify(await D(()=>window.rpgCustodianDebug.mana())), '(expect cur 1)');
  console.log('crystal consumed (inventory has soul crystal?):', await D(()=>(window.rpgCustodianDebug.player().inventory.items||[]).some(i=>/soul/i.test(i.name))), '(expect false)');
} finally { await page.close(); await browser.disconnect(); }
