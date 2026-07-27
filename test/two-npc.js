import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Dyna','A hero.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const busy = () => page.evaluate(()=>window.rpgCustodianDebug.busy());
const chatLen = () => page.evaluate(()=>SillyTavern.getContext().chat.length);
const tailFrom = i => page.evaluate(x=>(SillyTavern.getContext().chat??[]).slice(x).map(m=>({w:m.is_user?'you':(m.is_system?'sys':m.name),mes:(m.mes||'').replace(/\s+/g,' ').trim().slice(0,95)})),i);
async function say(text){ while(await busy())await wait(1000); const s=await chatLen(); console.log(`\n> "${text}"`); await page.type('#send_textarea',text); await page.keyboard.press('Enter'); let sb=false; for(let i=0;i<45;i++){await wait(2000);const b=await busy();if(b)sb=true;if(sb&&!b)break;if(!sb&&i>8&&(await chatLen())>s)break;} await wait(2500); for(const m of await tailFrom(s)) console.log(`  [${m.w}] ${m.mes}`); const it=consoleLogs.filter(l=>l.includes('intent =')).slice(-1)[0]; if(it) console.log('  » target: '+((it.match(/"target_npc":"?([^",}]+)/)||[])[1]||'null')); }
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
  await page.evaluate(()=>{ window.rpgCustodianDebug.state().currentTime=2; }); // Evening
  await page.evaluate(()=>window.rpgCustodianDebug.teleport('outskirts')); await wait(1200);
  const present = await page.evaluate(()=>{const c=SillyTavern.getContext().chat; return null;});
  console.log('Present at outskirts (Evening): Bryony + Fern');
  await say('Bryony, how has the watch been today?');
  await say('Fern, and you — did the woods give up any good herbs?');
  await say('It warms me to see you two getting along out here.');
} finally { await page.close(); await browser.disconnect(); }
