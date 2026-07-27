import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Dyna','A hero.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const busy = () => page.evaluate(()=>window.rpgCustodianDebug.busy());
const tail = () => page.evaluate(()=>(SillyTavern.getContext().chat??[]).slice(-4).map(m=>({w:m.is_user?'you':(m.is_system?'sys':m.name),mes:(m.mes||'').replace(/\s+/g,' ').trim()})));
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
  await page.evaluate(()=>window.rpgCustodianDebug.teleport('forest')); await wait(1200);
  await page.evaluate(()=>{ const rd=window.rpgCustodianDebug.player(); rd.relationships={Fern:{affection:7,arousal:6,familiarity:6,pregnancies:2,pregnancy_progress:65,buffs:[{stat:'fertility',amount:20,source:'fertility elixir',expiresStep:99}]}}; });
  // Look button popup
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#rpg-action-bar .rpg-action-btn')].find(x=>x.textContent.includes('Look')); b&&b.click(); });
  await wait(500);
  const items = await page.evaluate(()=>[...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].map(b=>b.textContent.trim().slice(0,40)));
  console.log('LOOK POPUP:', JSON.stringify(items));
  // Click "Look at Fern"
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#rpg-action-popup .rpg-menu-item')].find(x=>x.textContent.includes('Fern')); b&&b.click(); });
  for(let i=0;i<20;i++){ await wait(2000); const t=await tail(); if(t.some(m=>m.name==='Game Master'&&m.mes.startsWith('👁️'))) break; }
  console.log('\n=== EXAMINE OUTPUT ===');
  for(const m of await tail()) console.log(`[${m.w}] ${m.mes.slice(0,260)}`);
} finally { await page.close(); await browser.disconnect(); }
