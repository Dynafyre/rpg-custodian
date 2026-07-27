import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Kael','A wanderer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const busy = () => page.evaluate(()=>window.rpgCustodianDebug.busy());
const chatLen = () => page.evaluate(()=>SillyTavern.getContext().chat.length);
const state = () => page.evaluate(()=>{const s=window.rpgCustodianDebug.state(); return {loc:s.currentLocation, time:['Morning','Day','Evening','Night'][s.currentTime], day:s.dayCount, party:s.party};});
const tailFrom = i => page.evaluate(x=>(SillyTavern.getContext().chat??[]).slice(x).map(m=>({w:m.is_user?'you':(m.is_system?'sys':m.name),mes:(m.mes??'').replace(/\s+/g,' ').trim()})),i);
async function act(text){ while(await busy())await wait(1000); const s=await chatLen(); console.log(`\n> "${text}"`); await page.type('#send_textarea',text); await page.keyboard.press('Enter'); let sb=false; for(let i=0;i<50;i++){await wait(2000);const b=await busy();if(b)sb=true;if(sb&&!b)break;if(!sb&&i>8&&(await chatLen())>s)break;} await wait(2500); for(const m of await tailFrom(s))console.log(`  [${m.w}] ${m.mes.slice(0,150)}`); const it=consoleLogs.filter(l=>l.includes('intent =')).slice(-1)[0]; console.log('  » '+(it?it.replace(/^.*intent = /,''):'(none)').slice(0,170)); }
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
  await page.evaluate(()=>window.rpgCustodianDebug.teleport('forest'));   // Fern's spot, Morning
  await wait(1500);
  console.log('START:', JSON.stringify(await state()));
  await act('Fern and I sit together among the ferns and share stories long into the evening.');
  console.log('AFTER SHARING:', JSON.stringify(await state()));
  await act('Come, Fern — walk with me back to the outskirts.');
  console.log('AFTER TRAVEL (does Fern follow?):', JSON.stringify(await state()));
} finally { await page.close(); await browser.disconnect(); }
