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
  await D(()=>{ window.rpgCustodianDebug.state().currentTime=3; }); // Night
  await D(()=>window.rpgCustodianDebug.teleport('inn')); await wait(900);
  console.log('present @ inn (Night):', JSON.stringify(await D(()=>window.rpgCustodianDebug.presence())));
  console.log('\n=== STATUS BLOCK (scene anchor first) ===\n'+(await D(()=>window.rpgCustodianDebug.statusText())).split('\n').slice(0,4).join('\n'));
  // examine a present NPC — description should be at the inn, not a forest
  const who = (await D(()=>window.rpgCustodianDebug.presence()))[0];
  const s = await D(()=>SillyTavern.getContext().chat.length);
  while(await busy())await wait(600);
  await D(n=>window.rpgCustodianDebug.act(`I look ${n} over.`), who);
  for(let i=0;i<40;i++){await wait(1500); if(!(await busy()))break;} await wait(1500);
  const msgs = await D(k=>{const c=SillyTavern.getContext().chat;return c.slice(k).filter(m=>String(m.mes).includes('👁️')).map(m=>m.mes);}, s);
  console.log(`\n=== examine ${who} description (should be INN, not forest) ===\n`+(msgs[0]||'(no description)'));
} finally { await page.close(); await browser.disconnect(); }
