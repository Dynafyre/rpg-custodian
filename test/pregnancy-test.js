import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Dyna','A hero.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const fern = () => page.evaluate(()=>window.rpgCustodianDebug.player().relationships?.Fern);
const sysMsgs = () => page.evaluate(()=>(SillyTavern.getContext().chat??[]).filter(m=>m.is_system).slice(-4).map(m=>(m.mes||'').replace(/\s+/g,' ').trim()));
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
  await page.evaluate(()=>window.rpgCustodianDebug.teleport('forest'));
  await wait(1000);
  // Conceive twins directly via the engine (deterministic): set virility high, resolve orgasm
  await page.evaluate(()=>{ const rd=window.rpgCustodianDebug.player(); rd.stats.virility=5; rd.stats.ruggedness=8; rd.stats.stamina=8; rd.relationships={Fern:{affection:7,arousal:5,familiarity:5,pregnancies:0,pregnancy_progress:0}}; });
  // Force a conception: push fertility high + call orgasm resolution via a natural action is LLM; instead set directly then progress
  await page.evaluate(()=>{ const rel=window.rpgCustodianDebug.player().relationships.Fern; rel.pregnancies=2; rel.pregnancy_progress=5; });
  console.log('CONCEIVED (twins, Zygote):', JSON.stringify(await fern()));
  console.log('\n-- advancing time, watching stages (5%/step) --');
  for(let k=0;k<21;k++){
    await clickWait();
    const f = await fern();
    const stageMsg = (await sysMsgs()).find(m=>m.includes('stage') || m.includes('term'));
    console.log(`step ${k+1}: ${f.pregnancy_progress}%` + (stageMsg?`   << ${stageMsg.slice(0,90)}`:''));
    if(f.pregnancy_progress>=120) break;
  }
} finally { await page.close(); await browser.disconnect(); }
