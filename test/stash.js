import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A bold adventurer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
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
  // Fern in party at grotto (Day), seen, then KO'd, then left unconscious
  await D(()=>{ const st=window.rpgCustodianDebug.state(); st.currentTime=1; });
  await D(()=>window.rpgCustodianDebug.addParty('Fern')); await wait(500);
  await D(()=>window.rpgCustodianDebug.teleport('forbidden-grotto')); await wait(700);
  await D(()=>window.rpgCustodianDebug.rel('Fern')); await D(()=>{ const r=window.rpgCustodianDebug.rel('Fern'); r.lastSeenStep=window.rpgCustodianDebug.state().timeStep; });
  await D(()=>window.rpgCustodianDebug.hurt('Fern',99)); await wait(200); // KO
  console.log('KO at grotto → stashedAt=', await D(()=>window.rpgCustodianDebug.rel('Fern').stashedAt), 'KO=', await D(()=>window.rpgCustodianDebug.rel('Fern').npcUnconscious));
  await D(()=>window.rpgCustodianDebug.removeParty('Fern')); await wait(500);
  console.log('after leaving her → party=', JSON.stringify(await D(()=>window.rpgCustodianDebug.state().party)), '| leftUnconscious=', await D(()=>window.rpgCustodianDebug.rel('Fern').leftUnconscious), '| leftAt=', await D(()=>window.rpgCustodianDebug.rel('Fern').leftAt));
  // Fern pinned at grotto? present here yes, at her Day-schedule (forest) no
  console.log('present @ forbidden-grotto:', JSON.stringify(await D(()=>window.rpgCustodianDebug.presence('forbidden-grotto'))));
  console.log('present @ forest (her Day sched):', JSON.stringify(await D(()=>window.rpgCustodianDebug.presence('forest'))));
  // Leave: player travels away to forest
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(600);
  // one period passes (KO age 1 < 2): still stashed at grotto, still KO
  await D(()=>window.rpgCustodianDebug.tick(1)); await wait(400);
  console.log('\nafter 1 period away → Fern KO=', await D(()=>window.rpgCustodianDebug.rel('Fern').npcUnconscious), '| stashedAt=', await D(()=>window.rpgCustodianDebug.rel('Fern').stashedAt), '| still pinned @grotto:', JSON.stringify(await D(()=>window.rpgCustodianDebug.presence('forbidden-grotto'))));
  // second period (KO age 2 >= 2): wakes ALONE at grotto (player is at forest)
  await D(()=>window.rpgCustodianDebug.tick(1)); await wait(400);
  console.log('after 2 periods → Fern KO=', await D(()=>window.rpgCustodianDebug.rel('Fern').npcUnconscious), '| stashedAt=', await D(()=>window.rpgCustodianDebug.rel('Fern').stashedAt), '| wokeAloneAt=', await D(()=>window.rpgCustodianDebug.rel('Fern').wokeAloneAt));
  console.log('\n=== REUNION NOTE (should mention left unconscious + woke alone) ===\n'+await D(()=>window.rpgCustodianDebug.reunionNote2('Fern')));
} finally { await page.close(); await browser.disconnect(); }
