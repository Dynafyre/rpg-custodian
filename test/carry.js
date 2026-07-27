import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A bold adventurer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
const busy = () => D(()=>window.rpgCustodianDebug.busy());
const T = () => D(()=>window.rpgCustodianDebug.state().timeStep);
const loc = () => D(()=>window.rpgCustodianDebug.state().currentLocation);
const relF = k => D(x=>window.rpgCustodianDebug.rel('Fern')[x], k);
const lastFern = async () => D(()=>{const c=SillyTavern.getContext().chat;for(let i=c.length-1;i>=0;i--){if(c[i].name==='Fern'&&!c[i].is_user)return c[i].mes;}return '(none)';});
async function act(t){ const s=await D(()=>SillyTavern.getContext().chat.length); while(await busy())await wait(700); await D(x=>window.rpgCustodianDebug.act(x), t); for(let i=0;i<50;i++){await wait(1500); if(!(await busy()))break;} await wait(1500); return s; }
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
  // Fern: warm affection, in party, asleep at town-square (adjacent to inn)
  await D(()=>{ window.rpgCustodianDebug.state().currentTime=1; });
  await D(()=>window.rpgCustodianDebug.addParty('Fern')); await wait(500);
  await D(()=>window.rpgCustodianDebug.teleport('town-square')); await wait(700);
  await D(()=>{ const r=window.rpgCustodianDebug.rel('Fern'); r.affection=6; r.lastSeenStep=window.rpgCustodianDebug.state().timeStep; });
  await D(()=>window.rpgCustodianDebug.hurt('Fern',99)); await wait(200);   // she passes out
  console.log('=== CHAIN 1: look at sleeping Fern, carry to inn, leave her ===');
  const s = await act("I crouch and study Fern's sleeping face for a long moment, then gather her limp form into my arms and carry her into the inn, laying her gently in a bed to rest — before slipping quietly back out the door.");
  console.log('messages:');
  for (const l of await D(k=>{const c=SillyTavern.getContext().chat;return c.slice(k).map(m=>`  [${m.is_user?'Player':m.name}] ${String(m.mes).replace(/\s+/g,' ').slice(0,120)}`);}, s)) console.log(l);
  console.log('→ player loc:', await loc(), '(expect inn)');
  console.log('→ party:', JSON.stringify(await D(()=>window.rpgCustodianDebug.state().party)), '(expect [])');
  console.log('→ Fern stashedAt:', await relF('stashedAt'), '| leftUnconscious:', await relF('leftUnconscious'), '| leftAt:', await relF('leftAt'));
  console.log('→ Fern present @inn:', JSON.stringify(await D(()=>window.rpgCustodianDebug.presence('inn'))));

  console.log('\n=== CHAIN 2: 3 days pass (rest on day 2), then reunite ===');
  await D(()=>window.rpgCustodianDebug.teleport('town-square')); await wait(600);   // leave the inn so she wakes alone
  await D(()=>window.rpgCustodianDebug.tick(3)); await wait(600);   // ~day 1→2; Fern wakes alone at inn
  console.log('after ~day 2 → Fern KO:', await relF('npcUnconscious'), '| wokeAloneAt:', await relF('wokeAloneAt'));
  await act('I make camp and rest through the night.');            // the day-2 rest
  await D(()=>window.rpgCustodianDebug.tick(6)); await wait(600);   // out to ~3 days total
  console.log('elapsed since last seen:', (await T()) - (await relF('lastSeenStep')), 'periods');
  // go find Fern at her scheduled spot and greet her
  const where = await D(()=>window.rpgCustodianDebug.sched('Fern'));
  console.log('Fern routine now:', where);
  await D(()=>{ const st=window.rpgCustodianDebug.state(); st.currentTime=1; }); // Day → forest
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(700);
  console.log('\n--- REUNION NOTE ---\n'+await D(()=>window.rpgCustodianDebug.reunionNote2('Fern')));
  await act('Fern! Gods, there you are — I was starting to worry.');
  console.log('\n--- Fern REPLY ---\n'+(await lastFern()));
} finally { await page.close(); await browser.disconnect(); }
