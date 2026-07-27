import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A bold adventurer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
const off = () => D(()=>window.rpgCustodianDebug.offspring().map(o=>`${o.name}[${o.kind}${o.kind==='egg'?(o.hatched?':hatched':':egg'):''}@${o.locationId}]`));
const tok = () => D(()=>window.rpgCustodianDebug.tokens());
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

  console.log('=== LIVE birth (Fern, triplets, delivered 2 then 1) ===');
  console.log('tokens before:', await tok());
  await D(()=>window.rpgCustodianDebug.setPreg('Fern',3,100));
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(500);
  await D(()=>window.rpgCustodianDebug.birth('Fern',2)); await wait(200);
  console.log('after birth x2 → tokens:', await tok(), '| Fern remaining:', await D(()=>window.rpgCustodianDebug.rel('Fern').pregnancies));
  await D(()=>window.rpgCustodianDebug.birth('Fern',1)); await wait(200);
  console.log('after birth x1 → tokens:', await tok(), '| Fern remaining:', await D(()=>window.rpgCustodianDebug.rel('Fern').pregnancies), '| progress:', await D(()=>window.rpgCustodianDebug.rel('Fern').pregnancy_progress));
  console.log('offspring:', JSON.stringify(await off()));
  console.log('forest presence footnote:', (await D(()=>window.rpgCustodianDebug.presence?.('forest'), true)) ? '' : '', '\n' + await D(()=>{ /* read presenceLine via a look */ return null; }).catch(()=>''));

  console.log('\n=== EGG birth (Sylvara dragoness) + hatch ===');
  console.log('Sylvara conceptionKind auto →', await D(()=>{ const r=window.rpgCustodianDebug.setPreg('Sylvara',2,100); return r.conceptionKind; }));
  await D(()=>window.rpgCustodianDebug.teleport('forbidden-grotto')); await wait(500);
  await D(()=>window.rpgCustodianDebug.birth('Sylvara',2)); await wait(200);
  console.log('after egg birth → tokens:', await tok(), '| offspring:', JSON.stringify(await off()));
  await D(()=>window.rpgCustodianDebug.tick(8)); await wait(400);
  console.log('after ~2 days → offspring:', JSON.stringify(await off()));

  console.log('\n=== CRYSTAL birth (soul-mage sire) ===');
  const tb = await tok();
  await D(()=>window.rpgCustodianDebug.setPreg('Marta',1,100,'crystal'));
  await D(()=>window.rpgCustodianDebug.birth('Marta',1)); await wait(200);
  console.log('tokens before/after:', tb, '/', await tok(), '(expect UNCHANGED) | offspring:', JSON.stringify((await off()).filter(o=>o.includes('crystal'))));

  console.log('\n=== OFF-SCREEN solo birth at 150% (Wren, player away) ===');
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(400); // Wren home = shop; player at forest
  await D(()=>{ const r=window.rpgCustodianDebug.setPreg('Wren',1,145); r.lastSeenStep=window.rpgCustodianDebug.state().timeStep; });
  const twb = await tok();
  await D(()=>window.rpgCustodianDebug.tick(1)); await wait(300);   // 145→150 → auto solo birth
  console.log('Wren pregnancies after:', await D(()=>window.rpgCustodianDebug.rel('Wren').pregnancies), '| bornAlone:', JSON.stringify(await D(()=>window.rpgCustodianDebug.rel('Wren').bornAlone)), '| tokens:', twb, '→', await tok());
  await D(()=>window.rpgCustodianDebug.tick(6)); await wait(300); // pass time so reunion elapsed>1
  console.log('\n--- REUNION NOTE (Wren) ---\n'+await D(()=>window.rpgCustodianDebug.reunionNote2('Wren')));
} finally { await page.close(); await browser.disconnect(); }
