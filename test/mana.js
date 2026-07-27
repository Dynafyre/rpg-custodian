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
  // deplete mana, raise craftiness so there's headroom to refill
  await D(()=>{ const p=window.rpgCustodianDebug.player(); p.stats.craftiness=6; p.stats.mana=0; });
  console.log('mana before:', JSON.stringify(await D(()=>window.rpgCustodianDebug.mana())));
  const s = await act('I kneel at the edge of the glowing arcane spring and drink deeply from the pool of liquid mana.');
  console.log('\nmessages:');
  for (const l of await D(k=>{const c=SillyTavern.getContext().chat;return c.slice(k).map(m=>`  [${m.is_user?'Player':m.name}] ${String(m.mes).replace(/\s+/g,' ').slice(0,120)}`);}, s)) console.log(l);
  console.log('\nmana after:', JSON.stringify(await D(()=>window.rpgCustodianDebug.mana())), '(expect cur > 0)');
} finally { await page.close(); await browser.disconnect(); }
