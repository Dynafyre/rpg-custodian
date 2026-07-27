import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A seasoned wandering warrior.','Warrior','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
const busy = () => D(()=>window.rpgCustodianDebug.busy());
const rug = () => D(()=>window.rpgCustodianDebug.effectiveStat('ruggedness'));
const statuses = () => D(()=>window.rpgCustodianDebug.statuses('player').map(e=>({n:e.name,pol:e.polarity,mods:e.mods,end:e.endCondition})));
async function turn(t){
  const s=await D(()=>SillyTavern.getContext().chat.length);
  while(await busy())await wait(700);
  await D(x=>window.rpgCustodianDebug.act(x), t);
  for(let i=0;i<60;i++){await wait(1500); if(!(await busy()))break;}
  await wait(2000);
  const msgs = await D(k=>{const c=SillyTavern.getContext().chat;return c.slice(k).map(m=>`  [${m.is_user?'YOU':m.name}] ${String(m.mes).replace(/\s+/g,' ').slice(0,150)}`);}, s);
  console.log(`\n>>> ${t.slice(0,70)}...`);
  for(const m of msgs) console.log(m);
}
try {
  await login(page);
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
  for(let i=0;i<12;i++){const st=await page.evaluate(()=>SillyTavern.getContext().onlineStatus); if(st!=='no_connection')break; await wait(2500);}
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('Create Character'))?.click());
  await wait(6000);
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('New Game'))?.click());
  await wait(20000);
  // a capable warrior so the fight is survivable; Day so Fern is in the woods
  await D(()=>{ const p=window.rpgCustodianDebug.player(); p.stats.ruggedness=8; p.stats.stamina=8; window.rpgCustodianDebug.state().currentTime=1; window.rpgCustodianDebug.rel('Fern').affection=4; });
  await D(()=>window.rpgCustodianDebug.teleport('outskirts')); await wait(800);
  console.log('START ruggedness:', await rug(), '| statuses:', JSON.stringify(await statuses()));

  await turn("From the treeline a pack of gaunt, mangy wolves slinks toward me — ribs showing, weeping sores matting their fur, eyes fever-bright and yellow. They snarl as one and circle. I plant my feet, draw my blade, and brace to fight them off.");
  await turn("I wade into the pack, blade flashing — hamstringing one, opening the throat of another, driving them back with brutal efficiency.");
  await turn("The last wolf lunges and sinks its rotting fangs deep into my forearm before I bring the pommel down and crush its skull. As the beast dies, a cold, sickly weakness floods up my arm from the bite — my muscles go slack and heavy, the strength bleeding out of my limbs.");

  console.log('\n===== AFTER THE FIGHT =====');
  console.log('ruggedness:', await rug(), '| statuses:', JSON.stringify(await statuses()));

  await turn("Sweating and unsteady, my sword-arm trembling, I stagger off the road and into the Whispering Woods to find Fern the herbalist.");
  await turn("Fern — thank the gods. One of those sick wolves bit me and I can feel my strength rotting away, my arms turning to water. Please, can you brew something to purge this sickness from my blood?");
  await turn("Fern grinds a fistful of bitter herbs into a green poultice, binds it tight over the wound, and presses a steaming, foul-smelling draught into my hands. I tip it back and drink every drop, feeling the fever break and warmth flood back into my arms.");

  console.log('\n===== AFTER FERNS CURE =====');
  console.log('ruggedness:', await rug(), '| statuses:', JSON.stringify(await statuses()));
} finally { await page.close(); await browser.disconnect(); }
