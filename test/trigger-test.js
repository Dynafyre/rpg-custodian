import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Dyna','A hero.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const busy = () => page.evaluate(()=>window.rpgCustodianDebug.busy());
const chatLen = () => page.evaluate(()=>SillyTavern.getContext().chat.length);
const tailFrom = i => page.evaluate(x=>(SillyTavern.getContext().chat??[]).slice(x).map(m=>({w:m.is_user?'you':(m.is_system?'sys':m.name),mes:(m.mes||'').replace(/\s+/g,' ').trim().slice(0,70)})),i);
const toasts = [];
page.on('console', m=>{ if(/generating|trigger/i.test(m.text())) toasts.push(m.text()); });
async function say(text){ while(await busy())await wait(1000); const s=await chatLen(); await page.type('#send_textarea',text); await page.keyboard.press('Enter'); let sb=false; for(let i=0;i<45;i++){await wait(2000);const b=await busy();if(b)sb=true;if(sb&&!b)break;if(!sb&&i>8&&(await chatLen())>s)break;} await wait(2500); const t=await tailFrom(s); const npc=t.find(m=>!m.u&&!m.s&&m.w!=='Game Master'); console.log(`> "${text.slice(0,45)}" → ${npc?`[${npc.w}] ${npc.mes}`:'(no NPC reply)'}`); }
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
  const strat = await page.evaluate(()=>{const g=(SillyTavern.getContext().groups||[]).find(x=>x.name?.startsWith('RPG:')); return g?.activation_strategy;});
  console.log('group activation_strategy (2=MANUAL):', strat, '\n');
  // Rapid multi-turn conversation with Bryony (outskirts)
  await say('Bryony, well met on this fine morning.');
  await say('Any dangerous work about that pays well?');
  await say('I like the sound of that. Tell me more.');
  await say('You have keen eyes, warden. Have you always lived out here?');
  console.log('\n"generating/trigger" console lines:', toasts.length ? JSON.stringify(toasts.slice(0,4)) : '(none — clean!)');
} finally { await page.close(); await browser.disconnect(); }
