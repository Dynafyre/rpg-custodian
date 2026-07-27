import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Kael','A virile young wanderer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const busy = () => page.evaluate(()=>window.rpgCustodianDebug.busy());
const chatLen = () => page.evaluate(()=>SillyTavern.getContext().chat.length);
const rel = () => page.evaluate(()=>window.rpgCustodianDebug.player().relationships?.Fern);
const stam = () => page.evaluate(()=>({stamina:window.rpgCustodianDebug.player().stats.stamina, ruggedness:window.rpgCustodianDebug.player().stats.ruggedness, virility:window.rpgCustodianDebug.player().stats.virility, unconscious:window.rpgCustodianDebug.player().stats.unconscious}));
const tailFrom = i => page.evaluate(x=>(SillyTavern.getContext().chat??[]).slice(x).map(m=>({w:m.is_user?'you':(m.is_system?'sys':m.name),mes:(m.mes??'').replace(/\s+/g,' ').trim()})),i);
async function act(text){ while(await busy())await wait(1000); const s=await chatLen(); console.log(`\n> "${text}"`); await page.type('#send_textarea',text); await page.keyboard.press('Enter'); let sb=false; for(let i=0;i<50;i++){await wait(2000);const b=await busy();if(b)sb=true;if(sb&&!b)break;if(!sb&&i>8&&(await chatLen())>s)break;} await wait(2500); for(const m of await tailFrom(s))console.log(`  [${m.w}] ${m.mes.slice(0,150)}`); const it=consoleLogs.filter(l=>l.includes('intent =')).slice(-1)[0]; console.log('  » '+(it?it.replace(/^.*intent = /,''):'(none)').slice(0,150)); }
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
  // Establish that Fern is Smitten and give the hero high virility (guaranteed fertilization for test determinism)
  await page.evaluate(()=>{ const rd=window.rpgCustodianDebug.player(); rd.stats.virility=3; rd.stats.ruggedness=4; rd.stats.stamina=4; rd.relationships=rd.relationships||{}; rd.relationships.Fern={affection:8,arousal:6,familiarity:5,pregnancies:0,pregnancy_progress:0}; });
  await page.evaluate(()=>window.rpgCustodianDebug.teleport('forest'));
  await wait(1500);
  console.log('BEFORE — Fern rel:', JSON.stringify(await rel()), '| player:', JSON.stringify(await stam()));
  console.log('STATUS BLOCK:\n'+await page.evaluate(()=>SillyTavern.getContext().extensionPrompts?.['RPG_CUSTODIAN_STATUS']?.value));
  await act('Fern, I can\'t hold back any longer. I pull you close and ask if you\'ll be mine tonight.');
  await act('We sink into the soft moss together and make love, and at the peak I finish deep inside her.');
  console.log('\nAFTER — Fern rel:', JSON.stringify(await rel()), '| player:', JSON.stringify(await stam()));
} finally { await page.close(); await browser.disconnect(); }
