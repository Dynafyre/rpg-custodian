import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A hero.','Wanderer','Drifter'];
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
  await D(()=>{ window.rpgCustodianDebug.state().currentTime=1; });
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(500);

  console.log('=== PLAYER buff via unified add_status (debug.buff) ===');
  console.log('charm before:', await D(()=>window.rpgCustodianDebug.effectiveStat('charm')));
  await D(()=>window.rpgCustodianDebug.buff('player','charm',2,'Charm Philtre')); await wait(200);
  console.log('charm after +2 (4-step):', await D(()=>window.rpgCustodianDebug.effectiveStat('charm')), '(expect 5)');
  console.log('statuses:', JSON.stringify(await D(()=>window.rpgCustodianDebug.statuses('player').map(e=>`${e.name}[${e.kind}] exp${e.expiresStep}`))));

  console.log('\n=== NPC FERTILITY buff → feeds fertilityPercent ===');
  const fBefore = await D(()=>window.rpgCustodianDebug.player() && null) ?? null;
  console.log('Fern fertility before:', await D(()=>{ return null; }).catch(()=>null));
  await D(()=>window.rpgCustodianDebug.buff('Fern','fertility',20,'Fertility Potion')); await wait(200);
  console.log('Fern statuses:', JSON.stringify(await D(()=>window.rpgCustodianDebug.statuses('Fern').map(e=>`${e.name} ${JSON.stringify(e.mods)}`))));
  // fertilityPercent is internal; check via examine or a debug. Use conceptionKind path indirectly: check npcStatMod via reproducing math
  console.log('Fern fertility mod applied (npcStatMod fertility):', await D(()=>{ const r=window.rpgCustodianDebug.rel('Fern'); return (r.customEffects||[]).flatMap(e=>e.mods||[]).filter(m=>m.stat==='fertility').reduce((a,m)=>a+m.amount,0); }), '(expect 20)');

  console.log('\n=== NPC STAMINA buff → raises max + tops up + revives ===');
  await D(()=>window.rpgCustodianDebug.hurt('Fern',99)); await wait(150);
  console.log('Fern KO:', await D(()=>window.rpgCustodianDebug.rel('Fern').npcUnconscious), '| stamina:', JSON.stringify(await D(()=>window.rpgCustodianDebug.npcStamina('Fern'))));
  await D(()=>window.rpgCustodianDebug.buff('Fern','stamina',3,'Vigor Draught')); await wait(200);
  console.log('after +3 stamina status → KO:', await D(()=>window.rpgCustodianDebug.rel('Fern').npcUnconscious), '| stamina:', JSON.stringify(await D(()=>window.rpgCustodianDebug.npcStamina('Fern'))), '(expect revived, max+3)');

  console.log('\n=== TIMER EXPIRY (4 periods) ===');
  await D(()=>window.rpgCustodianDebug.tick(4)); await wait(400);
  console.log('player statuses after 4 ticks:', JSON.stringify(await D(()=>window.rpgCustodianDebug.statuses('player').map(e=>e.name))), '| charm:', await D(()=>window.rpgCustodianDebug.effectiveStat('charm')), '(expect [] and 3)');
  console.log('Fern statuses after 4 ticks:', JSON.stringify(await D(()=>window.rpgCustodianDebug.statuses('Fern').map(e=>e.name))), '(expect [])');
} finally { await page.close(); await browser.disconnect(); }
