import { connect, collectLogs, login, screenshot } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A brave wanderer seeking fortune.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const busy = () => page.evaluate(()=>window.rpgCustodianDebug.busy());
const chatLen = () => page.evaluate(()=>SillyTavern.getContext().chat.length);
const tailFrom = i => page.evaluate(x=>(SillyTavern.getContext().chat??[]).slice(x).map(m=>({w:m.is_user?'you':(m.is_system?'sys':m.name),mes:(m.mes??'').replace(/\s+/g,' ').trim()})),i);
async function act(text){
  while(await busy()) await wait(1000);
  const start=await chatLen();
  console.log(`\n> "${text}"`);
  await page.type('#send_textarea',text); await page.keyboard.press('Enter');
  let sawBusy=false;
  for(let i=0;i<50;i++){await wait(2000);const b=await busy();if(b)sawBusy=true;if(sawBusy&&!b)break;if(!sawBusy&&i>8&&(await chatLen())>start)break;}
  await wait(2500);
  for(const m of await tailFrom(start)) console.log(`  [${m.w}] ${m.mes.slice(0,170)}`);
  const intent=consoleLogs.filter(l=>l.includes('intent =')).slice(-1)[0];
  console.log('  » '+(intent?intent.replace(/^.*intent = /,''):'(none)').slice(0,200));
}
try {
  await login(page);
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
  let st='no_connection'; for(let i=0;i<12;i++){st=await page.evaluate(()=>SillyTavern.getContext().onlineStatus); if(st!=='no_connection')break; await wait(2500);}
  console.log('connection:', st, '(reasoning model)');
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('Create Character'))?.click());
  await wait(6000);
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('New Game'))?.click());
  await wait(20000);
  await page.evaluate(()=>{window.RPGC_LOG_PROMPT=true;});
  await act('Look around the trees for a sturdy branch that could be a good candidate to carve into a javelin.');
  await act('Bryony, is there any dangerous work around here that pays coin?');
  console.log('\n--- ANALYZER RAW samples (reasoning-model output) ---');
  console.log(consoleLogs.filter(l=>l.includes('ANALYZER RAW')).slice(0,2).join('\n'));
  await screenshot(page,'reasoning-test');
} finally { await page.close(); await browser.disconnect(); }
