import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Dyna','A hero.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const busy = () => page.evaluate(()=>window.rpgCustodianDebug.busy());
const chatLen = () => page.evaluate(()=>SillyTavern.getContext().chat.length);
const tailFrom = i => page.evaluate(x=>(SillyTavern.getContext().chat??[]).slice(x).filter(m=>!m.is_user).map(m=>m.is_system?'sys':m.name),i);
async function say(text){ while(await busy())await wait(1000); const s=await chatLen(); await page.type('#send_textarea',text); await page.keyboard.press('Enter'); let sb=false; for(let i=0;i<50;i++){await wait(2000);const b=await busy();if(b)sb=true;if(sb&&!b)break;if(!sb&&i>8&&(await chatLen())>s)break;} await wait(2500); const replies=(await tailFrom(s)).filter(n=>n!=='sys'&&n!=='Game Master'); console.log(`> "${text.slice(0,42)}"  → repliers: ${JSON.stringify(replies)}`); }
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
  await page.evaluate(()=>{ window.rpgCustodianDebug.state().currentTime=1; }); // Day
  await page.evaluate(()=>window.rpgCustodianDebug.teleport('forest')); await wait(1200);
  console.log('Present: Bryony + Fern (Day @ forest)\n');
  await say('Bryony, how goes the hunt out here today?');
  await say('Fern, and you — found any rare herbs?');
  await say('You two clearly know these woods well.');
} finally { await page.close(); await browser.disconnect(); }
