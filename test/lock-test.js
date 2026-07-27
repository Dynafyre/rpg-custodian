import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Dyna','A hero.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const fern = () => page.evaluate(()=>window.rpgCustodianDebug.player().relationships?.Fern);
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
  // Case A: EARLY pregnancy (Implantation 15%) — another internal finish CAN add fetuses
  await page.evaluate(()=>{ const rd=window.rpgCustodianDebug.player(); rd.stats.virility=5; rd.stats.ruggedness=8; rd.stats.stamina=8; rd.relationships={Fern:{affection:7,arousal:5,familiarity:5,pregnancies:1,pregnancy_progress:15}}; });
  const a0=(await fern()).pregnancies;
  await page.evaluate(()=>window.rpgCustodianDebug.orgasm('Fern', true, 1)); await wait(600);
  const a1=(await fern()).pregnancies;
  console.log(`EARLY (Implantation 15%): pregnancies ${a0} → ${a1}  (${a1>a0?'✅ can still conceive':'—'})`);
  // Case B: FETAL (30%) — another internal finish must be BLOCKED
  await page.evaluate(()=>{ const rd=window.rpgCustodianDebug.player(); rd.stats.stamina=8; rd.relationships.Fern.pregnancy_progress=30; rd.relationships.Fern.pregnancies=2; });
  const b0=(await fern()).pregnancies;
  await page.evaluate(()=>window.rpgCustodianDebug.orgasm('Fern', true, 1)); await wait(600);
  const b1=(await fern()).pregnancies;
  console.log(`FETAL (30%): pregnancies ${b0} → ${b1}  (${b1===b0?'✅ locked, no new conception':'❌ LOCK FAILED'})`);
} finally { await page.close(); await browser.disconnect(); }
