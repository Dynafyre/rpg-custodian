import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Dyna','A wanderer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const busy = () => page.evaluate(()=>window.rpgCustodianDebug.busy());
const chatLen = () => page.evaluate(()=>SillyTavern.getContext().chat.length);
const snap = () => page.evaluate(()=>{const rd=window.rpgCustodianDebug.player(); const s=window.rpgCustodianDebug.state(); return {time:['Morning','Day','Evening','Night'][s.currentTime],day:s.dayCount,stam:rd.stats.stamina,unc:!!rd.stats.unconscious,fernStam:rd.relationships?.Fern?.npcStamina};});
const clickWait = async()=>{ await page.evaluate(()=>{ const b=[...document.querySelectorAll('#rpg-action-bar .rpg-action-btn')].find(x=>x.textContent.includes('Wait')); b&&b.click(); }); await wait(3000); };
async function act(text){ while(await busy())await wait(1000); const s=await chatLen(); console.log(`\n> "${text}"`); await page.type('#send_textarea',text); await page.keyboard.press('Enter'); let sb=false; for(let i=0;i<50;i++){await wait(2000);const b=await busy();if(b)sb=true;if(sb&&!b)break;if(!sb&&i>8&&(await chatLen())>s)break;} await wait(2000); const it=consoleLogs.filter(l=>l.includes('intent =')).slice(-1)[0]; console.log('  » '+(it?it.replace(/^.*intent = /,''):'(none)').slice(0,150)); }
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
  await page.evaluate(()=>{ const rd=window.rpgCustodianDebug.player(); rd.stats.ruggedness=4; rd.stats.stamina=1; rd.relationships={Fern:{affection:5,arousal:1,familiarity:2,pregnancies:0,pregnancy_progress:0,npcStamina:0}}; window.rpgCustodianDebug.state().currentTime=2; });
  console.log('DRAINED (Evening):', JSON.stringify(await snap()));
  await clickWait(); await clickWait();
  console.log('after Wait x2 → Morning (should STILL be drained):', JSON.stringify(await snap()));
  await act('I find a quiet hollow, curl up, and rest a while to recover my strength.');
  console.log('after REST (restored + 1 period):', JSON.stringify(await snap()));
} finally { await page.close(); await browser.disconnect(); }
