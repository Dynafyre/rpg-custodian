import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A bold adventurer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
const busy = () => D(()=>window.rpgCustodianDebug.busy());
const items = () => D(()=>window.rpgCustodianDebug.items());
async function act(t){ while(await busy())await wait(700); await D(x=>window.rpgCustodianDebug.act(x), t); for(let i=0;i<50;i++){await wait(1500); if(!(await busy()))break;} await wait(1500); }
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
  console.log('=== AUTO-APPRAISAL: add items, Custodian invents effects ===');
  for (const nm of ['Druidic Staff','Trusty Lantern','Amulet of Charm']) await D(n=>window.rpgCustodianDebug.giveItem(n), nm);
  // wait for the appraisal queue (LLM, serialized)
  for(let i=0;i<40;i++){ await wait(1500); const it=await items(); if(it.every(x=>x.effect)) break; }
  for (const it of await items()) console.log(`  ${it.name} → "${it.effect||'(none)'}"  [usage:${it.usage||'?'}${it.mod?`, ${it.mod.amount>=0?'+':''}${it.mod.amount} ${it.mod.stat}${it.mod.condition?` (${it.mod.condition})`:''}`:''}]`);

  console.log('\n=== NL equip ===');
  const rugBefore = await D(()=>window.rpgCustodianDebug.effectiveStat('charm'));
  await act('I clasp the Amulet of Charm around my neck.');
  const amuletEquipped = (await items()).find(i=>/amulet/i.test(i.name))?.equipped;
  console.log('Amulet equipped via NL:', amuletEquipped, '| charm', rugBefore, '→', await D(()=>window.rpgCustodianDebug.effectiveStat('charm')));

  console.log('\n=== NL bespoke status ===');
  await act('I greedily drain three tankards of strong ale, head spinning, the room tilting.');
  console.log('statuses after getting drunk:', JSON.stringify(await D(()=>window.rpgCustodianDebug.statuses('player').map(e=>`${e.name}${e.polarity==='negative'?'(-)':''}${(e.mods||[]).map(m=>` ${m.amount} ${m.stat}`).join('')}${e.endCondition?` [ends: ${e.endCondition}]`:''}`))));
} finally { await page.close(); await browser.disconnect(); }
