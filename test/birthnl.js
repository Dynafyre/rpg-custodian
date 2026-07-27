import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A bold adventurer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
const busy = () => D(()=>window.rpgCustodianDebug.busy());
async function act(t){ const s=await D(()=>SillyTavern.getContext().chat.length); while(await busy())await wait(700); await D(x=>window.rpgCustodianDebug.act(x), t); for(let i=0;i<50;i++){await wait(1500); if(!(await busy()))break;} await wait(1500); return s; }
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
  await D(()=>window.rpgCustodianDebug.addParty('Fern')); await wait(400);
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(500);
  await D(()=>{ const r=window.rpgCustodianDebug.setPreg('Fern',2,105); r.affection=8; });
  console.log('tokens before:', await D(()=>window.rpgCustodianDebug.tokens()), '| Fern carrying:', await D(()=>window.rpgCustodianDebug.rel('Fern').pregnancies), 'at', await D(()=>window.rpgCustodianDebug.rel('Fern').pregnancy_progress+'%'));
  const s = await act("I kneel beside Fern and grip her hand as she bears down, breathing with her — and with two final cries, she brings our twins squalling into the world.");
  console.log('\nghost/GM msgs:');
  for (const l of await D(k=>{const c=SillyTavern.getContext().chat;return c.slice(k).map(m=>`  [${m.is_user?'Player':m.name}] ${String(m.mes).replace(/\s+/g,' ').slice(0,110)}`);}, s)) console.log(l);
  console.log('\ntokens after:', await D(()=>window.rpgCustodianDebug.tokens()), '| Fern carrying:', await D(()=>window.rpgCustodianDebug.rel('Fern').pregnancies));
  console.log('offspring:', JSON.stringify(await D(()=>window.rpgCustodianDebug.offspring().map(o=>`${o.name}(${o.kind}@${o.locationId})`))));
  // Look at the area → footnote
  const s2 = await D(()=>SillyTavern.getContext().chat.length);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-action-btn')].find(b=>/Look/i.test(b.textContent))?.click()); await wait(500);
  await page.evaluate(()=>[...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(e=>/surroundings/i.test(e.textContent))?.click()); await wait(1500);
  const look = await D(k=>{const c=SillyTavern.getContext().chat;return c.slice(k).map(m=>m.mes).join('\n');}, s2);
  console.log('\n--- LOOK footnote ---\n'+look.split('\n').filter(l=>/About the area|🏠|👶/.test(l)).join('\n'));
} finally { await page.close(); await browser.disconnect(); }
