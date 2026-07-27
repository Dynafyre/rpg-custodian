import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A hero.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
const busy = () => D(()=>window.rpgCustodianDebug.busy());
const inject = (name,mes) => D((n,m)=>{ SillyTavern.getContext().chat.push({name:n,is_user:false,is_system:false,mes:m,send_date:'now'}); }, name, mes);
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

  console.log('=== QUEST as silent status → complete with reward ===');
  console.log('gold before:', await D(()=>window.rpgCustodianDebug.gold()), '| xp:', await D(()=>window.rpgCustodianDebug.player().stats.experience));
  await D(()=>window.rpgCustodianDebug.addObjective({name:'Recover the Locket', objective:"the player returns the widow's lost silver locket into her hands", reward:{gold:50, xp:30}})); await wait(200);
  console.log('objectives:', JSON.stringify(await D(()=>window.rpgCustodianDebug.objectives().map(e=>e.name))));
  // turn 1: nothing relevant → clear justCreated, should NOT complete
  await inject('Reigngard','I walk down the road, whistling.');
  while(await busy())await wait(400);
  await D(()=>window.rpgCustodianDebug.checkConditions()); await wait(2500);
  console.log('after idle turn → objectives:', JSON.stringify(await D(()=>window.rpgCustodianDebug.objectives().map(e=>e.name))), '(expect still tracked)');
  // turn 2: fulfill it
  await inject('Game Master','You press the recovered silver locket into the old widows trembling hands. She clutches it to her chest and weeps with gratitude, thanking you over and over.');
  await D(()=>window.rpgCustodianDebug.checkConditions()); await wait(2500);
  console.log('after fulfillment → objectives:', JSON.stringify(await D(()=>window.rpgCustodianDebug.objectives().map(e=>e.name))), '| gold:', await D(()=>window.rpgCustodianDebug.gold()), '| xp:', await D(()=>window.rpgCustodianDebug.player().stats.experience), '(expect [], gold+50, xp+30)');

  console.log('\n=== FEY PACT: stat mods while active + reward on fulfil ===');
  console.log('craftiness before pact:', await D(()=>window.rpgCustodianDebug.effectiveStat('craftiness')));
  await D(()=>window.rpgCustodianDebug.addObjective({name:'The Fey Bargain', kind:'pact', objective:'the player delivers a bottle of captured moonlight to the fey', mods:[{stat:'craftiness',amount:2}], reward:{tokens:1}})); await wait(200);
  console.log('craftiness during pact (+2):', await D(()=>window.rpgCustodianDebug.effectiveStat('craftiness')), '| tokens:', await D(()=>window.rpgCustodianDebug.tokens()));
  await inject('Reigngard','I idly sharpen my knife.'); await D(()=>window.rpgCustodianDebug.checkConditions()); await wait(2000); // clear justCreated
  await inject('Game Master','You uncork the shimmering bottle of captured moonlight and pour its silver light into the fey queens waiting palms. She laughs, delighted, the bargain fulfilled.');
  await D(()=>window.rpgCustodianDebug.checkConditions()); await wait(2500);
  console.log('after fulfilling pact → objectives:', JSON.stringify(await D(()=>window.rpgCustodianDebug.objectives().map(e=>e.name))), '| craftiness:', await D(()=>window.rpgCustodianDebug.effectiveStat('craftiness')), '| tokens:', await D(()=>window.rpgCustodianDebug.tokens()), '(expect [], craft back, tokens+1)');
} finally { await page.close(); await browser.disconnect(); }
