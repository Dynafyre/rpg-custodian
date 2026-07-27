import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Dyna','A hero.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const fern = () => page.evaluate(()=>window.rpgCustodianDebug.player().relationships?.Fern);
const newestStage = () => page.evaluate(()=>{const c=(SillyTavern.getContext().chat??[]).filter(m=>m.is_system&&/enters the|at term/.test(m.mes||'')); return c.length?c[c.length-1].mes.replace(/\s+/g,' ').trim():null;});
const clickWait = async()=>{ await page.evaluate(()=>{ const b=[...document.querySelectorAll('#rpg-action-bar .rpg-action-btn')].find(x=>x.textContent.includes('Wait')); b&&b.click(); }); await wait(2200); };
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
  await page.evaluate(()=>{ const rel=(window.rpgCustodianDebug.player().relationships={}).Fern={affection:7,arousal:5,familiarity:5,pregnancies:2,pregnancy_progress:5}; });
  let lastStage=null;
  for(let k=0;k<21;k++){
    await clickWait();
    const f=await fern(); const st=await newestStage();
    if(st && st!==lastStage){ console.log(`${f.pregnancy_progress}% → ${st.slice(0,110)}`); lastStage=st; }
    if(f.pregnancy_progress>=120) break;
  }
  // Fetal lock check: at 30% (Fetal), a conception attempt must be blocked
  await page.evaluate(()=>{ const rd=window.rpgCustodianDebug.player(); rd.stats.virility=5; rd.stats.stamina=8; rd.relationships.Fern.pregnancy_progress=30; rd.relationships.Fern.pregnancies=2; });
  const before = (await fern()).pregnancies;
  await page.evaluate(()=>window.rpgCustodianDebug.act('I make love to Fern and finish deep inside her once more.'));
  await wait(9000);
  const after = (await fern()).pregnancies;
  console.log(`\nFETAL LOCK: pregnancies before=${before}, after another internal finish=${after} (should be UNCHANGED at 2)`);
} finally { await page.close(); await browser.disconnect(); }
