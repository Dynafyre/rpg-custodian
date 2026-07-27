import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A hero.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
const rug = () => D(()=>window.rpgCustodianDebug.effectiveStat('ruggedness'));
const st = () => D(()=>window.rpgCustodianDebug.statuses('player').map(e=>`${e.name}[${e.kind}] onCheck:${e.expiresOnCheck||'-'} exp:${e.expiresStep??'-'}`));
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

  console.log('=== ONE-USE PRE-BUFF (expires_on_check) ===');
  console.log('rug base:', await rug());
  await D(()=>window.rpgCustodianDebug.addStatus('player',{name:'Dragon-Wrestling Draught', kind:'buff', mods:[{stat:'ruggedness',amount:3}], expires_on_check:'ruggedness'})); await wait(200);
  console.log('after draught → rug:', await rug(), '(expect +3) | status:', JSON.stringify(await st()));
  // a CHARM check should NOT consume it
  await D(()=>window.rpgCustodianDebug.rollCheck('charm',8)); await wait(150);
  console.log('after a CHARM check → still present:', JSON.stringify(await st()), '| rug:', await rug(), '(expect still +3)');
  // a RUGGEDNESS check consumes it (and the +3 applies to THAT roll)
  const c = await D(()=>window.rpgCustodianDebug.rollCheck('ruggedness',10)); await wait(150);
  console.log('ruggedness roll used boost:', c.boost, '(expect 3) | eff in roll:', c.eff);
  console.log('after RUGGEDNESS check → status:', JSON.stringify(await st()), '| rug:', await rug(), '(expect [] and base)');

  console.log('\n=== stat_boost ITEM routes through unified system ===');
  await D(()=>window.rpgCustodianDebug.player().inventory.items.push({id:'wp1', name:'Potion of Might', effect:{type:'stat_boost', stat:'ruggedness', amount:2}}));
  await D(()=>window.rpgCustodianDebug.useItemNamed('Potion of Might')); await wait(200);
  console.log('after drinking → rug:', await rug(), '| status:', JSON.stringify(await st()), '(expect +2, expires on ruggedness check)');
  await D(()=>window.rpgCustodianDebug.rollCheck('ruggedness',8)); await wait(150);
  console.log('after next ruggedness check → status:', JSON.stringify(await st()), '(expect [])');
} finally { await page.close(); await browser.disconnect(); }
