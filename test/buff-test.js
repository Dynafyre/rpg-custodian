import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A virile hero.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const busy = () => page.evaluate(()=>window.rpgCustodianDebug.busy());
const chatLen = () => page.evaluate(()=>SillyTavern.getContext().chat.length);
const snap = () => page.evaluate(()=>{const rd=window.rpgCustodianDebug.player(); return {vir:window.rpgCustodianDebug.effectiveStat('virility'), buffs:rd.buffs, fernBuffs:rd.relationships?.Fern?.buffs, fernFert:null, step:window.rpgCustodianDebug.state().timeStep, time:['Morning','Day','Evening','Night'][window.rpgCustodianDebug.state().currentTime]};});
const tailFrom = i => page.evaluate(x=>(SillyTavern.getContext().chat??[]).slice(x).map(m=>({w:m.is_user?'you':(m.is_system?'sys':m.name),mes:(m.mes??'').replace(/\s+/g,' ').trim()})),i);
const clickWait = async()=>{ await page.evaluate(()=>{ const b=[...document.querySelectorAll('#rpg-action-bar .rpg-action-btn')].find(x=>x.textContent.includes('Wait')); b&&b.click(); }); await wait(3000); };
async function act(text){ while(await busy())await wait(1000); const s=await chatLen(); console.log(`\n> "${text}"`); await page.type('#send_textarea',text); await page.keyboard.press('Enter'); let sb=false; for(let i=0;i<50;i++){await wait(2000);const b=await busy();if(b)sb=true;if(sb&&!b)break;if(!sb&&i>8&&(await chatLen())>s)break;} await wait(2000); for(const m of await tailFrom(s))console.log(`  [${m.w}] ${m.mes.slice(0,140)}`); const it=consoleLogs.filter(l=>l.includes('intent =')).slice(-1)[0]; console.log('  » '+(it?it.replace(/^.*intent = /,''):'(none)').slice(0,180)); }
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
  await page.evaluate(()=>window.rpgCustodianDebug.teleport('forest'));
  await wait(1500);
  console.log('BEFORE:', JSON.stringify(await snap()));
  await act('Fern hands me a glowing emerald fertility potion and we each drink one down. "If this can augment my virility, and your fertility, all the better."');
  console.log('AFTER DRINK:', JSON.stringify(await snap()));
  console.log('\n-- passing 4 time steps to expire buffs --');
  for(let k=0;k<4;k++){ await clickWait(); }
  console.log('AFTER 4 WAITS:', JSON.stringify(await snap()));
} finally { await page.close(); await browser.disconnect(); }
