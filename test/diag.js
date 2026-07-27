import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const answers = ['Kael','A wanderer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
try {
  await login(page);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
  for (let i=0;i<12;i++){const s=await page.evaluate(()=>SillyTavern.getContext().onlineStatus); if(s!=='no_connection')break; await wait(2500);}
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('Create Character'))?.click());
  await wait(6000);
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('New Game'))?.click());
  await wait(20000);
  await page.evaluate(()=>{ window.RPGC_LOG_PROMPT = true; });
  await page.evaluate(()=>window.rpgCustodianDebug.forceQuest('cull-frostfang-wolves','active'));
  await page.evaluate(()=>window.rpgCustodianDebug.teleport('forest'));
  await wait(1500);
  await page.type('#send_textarea','I hunt down the frostfang wolves and fight the whole pack until they scatter.');
  await page.keyboard.press('Enter');
  let sawBusy=false;
  for(let i=0;i<30;i++){ await wait(2000); const b=await page.evaluate(()=>window.rpgCustodianDebug.busy()); if(b)sawBusy=true; if(sawBusy&&!b)break; }
  await wait(2000);
  console.log('\n=== PROMPT+RESPONSE ===');
  console.log(consoleLogs.filter(l=>l.includes('ANALYZER PROMPT')||l.includes('ANALYZER RAW')||l.includes('intent =')||l.includes('ACTIVE QUEST')).join('\n---\n'));
} finally { await page.close(); await browser.disconnect(); }
