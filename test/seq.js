import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A bold adventurer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
const busy = () => D(()=>window.rpgCustodianDebug.busy());
const tail = n => D(k=>{const c=SillyTavern.getContext().chat;return c.slice(-k).map(m=>`[${m.is_user?'Player':m.name}] ${String(m.mes).replace(/\s+/g,' ').slice(0,160)}`);},n);
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
  // Fern in party, unconscious, at the grotto, Evening
  await D(()=>{ const st=window.rpgCustodianDebug.state(); st.party=['Fern']; st.currentTime=2; }); // Evening
  await D(()=>window.rpgCustodianDebug.hurt('Fern',99));   // KO Fern
  await D(()=>window.rpgCustodianDebug.teleport('forbidden-grotto')); await wait(1000);
  console.log('SETUP → loc:', await D(()=>window.rpgCustodianDebug.state().currentLocation),
    '| party:', JSON.stringify(await D(()=>window.rpgCustodianDebug.state().party)),
    '| Fern KO:', await D(()=>!!window.rpgCustodianDebug.rel('Fern').npcUnconscious),
    '| Fern present here:', await D(()=>SillyTavern.getContext(), true) && await D(()=>window.rpgCustodianDebug.state().currentLocation==='forbidden-grotto'));
  const s = await act('I carry Fern to her bed and tuck her in, then step back, looking her up and down, admiring her sleeping form, before setting off into the forest alone.');
  console.log('\n--- messages produced ---');
  for (const l of await D(k=>{const c=SillyTavern.getContext().chat;return c.slice(k).map(m=>`[${m.is_user?'Player':m.name}] ${String(m.mes).replace(/\s+/g,' ').slice(0,170)}`);}, s)) console.log(l);
  console.log('\n--- RESULT ---');
  console.log('location:', await D(()=>window.rpgCustodianDebug.state().currentLocation), '(expect forest)');
  console.log('party:', JSON.stringify(await D(()=>window.rpgCustodianDebug.state().party)), '(expect [])');
  const present = await D(()=>window.rpgCustodianDebug.state().currentLocation);
  console.log('Fern present at forest now?', await D(()=>{ const st=window.rpgCustodianDebug.state(); const p=TIME_PERIODS?.[st.currentTime]?.name; return null; }).catch(()=>'n/a'));
} finally { await page.close(); await browser.disconnect(); }
