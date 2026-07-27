import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Dyna','A hero.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const fern = () => page.evaluate(()=>window.rpgCustodianDebug.player().relationships?.Fern);
const chatCount = () => page.evaluate(()=>SillyTavern.getContext().chat.length);
const newMsgsSince = (n) => page.evaluate(x=>(SillyTavern.getContext().chat??[]).slice(x).map(m=>(m.mes||'').replace(/\s+/g,' ').trim().slice(0,90)), n);
const clickWait = async()=>{ await page.evaluate(()=>{ const b=[...document.querySelectorAll('#rpg-action-bar .rpg-action-btn')].find(x=>x.textContent.includes('Wait')); b&&b.click(); }); await wait(2500); };
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
  await page.evaluate(()=>window.rpgCustodianDebug.teleport('forest')); await wait(1000);
  // Pregnancy STUCK at 0% (the reported bug): pregnancies>0 but progress 0
  await page.evaluate(()=>{ window.rpgCustodianDebug.player().relationships={Fern:{affection:7,arousal:3,familiarity:5,pregnancies:1,pregnancy_progress:0}}; });
  console.log('stuck-at-0 pregnancy:', JSON.stringify(await fern()));
  await clickWait();
  console.log('after 1 Wait (should be 5%, Zygote):', JSON.stringify(await fern()));
  await clickWait();
  console.log('after 2 Waits (should be 10%):', JSON.stringify(await fern()));
  // Multi-day skip: 12 periods (3 days) via advance_time — should be ONE summary, no spam
  await page.evaluate(()=>window.rpgCustodianDebug.player().relationships.Fern.pregnancy_progress=20);
  const before = await chatCount();
  await page.evaluate(()=>window.rpgCustodianDebug.act && null);
  await page.evaluate(async ()=>{ await SillyTavern.getContext(); });
  // call advanceTimeBy(12) directly via a debug-ish path: use the act pipeline is LLM; instead trigger via internal — use waitCommand 0? no.
  // Expose via a quick eval of the module isn't possible; simulate "wait 3 days" by calling advance through 12 waits vs one skip:
  await page.evaluate(()=>{ window.__t = SillyTavern.getContext().chat.length; });
  // Use the NL path minimally: type "I wait here for three full days."
  await page.type('#send_textarea','I settle in and wait here for three full days.'); await page.keyboard.press('Enter');
  for(let i=0;i<40;i++){ await wait(2000); const b=await page.evaluate(()=>window.rpgCustodianDebug.busy()); if(!b && (await chatCount())>before) { await wait(2500); break; } }
  const after = await chatCount();
  console.log('\nMULTI-DAY SKIP — new messages:', JSON.stringify(await newMsgsSince(before)));
  console.log('final pregnancy:', JSON.stringify(await fern()));
} finally { await page.close(); await browser.disconnect(); }
