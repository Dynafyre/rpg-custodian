import { connect, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Reigngard','A bold adventurer.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const D = (fn,...a) => page.evaluate(fn,...a);
const busy = () => D(()=>window.rpgCustodianDebug.busy());
const T = () => D(()=>window.rpgCustodianDebug.state().timeStep);
const lastFern = async () => D(()=>{const c=SillyTavern.getContext().chat;for(let i=c.length-1;i>=0;i--){if(c[i].name==='Fern'&&!c[i].is_user)return c[i].mes;}return '(none)';});
async function act(t){ while(await busy())await wait(700); await D(x=>window.rpgCustodianDebug.act(x), t); for(let i=0;i<45;i++){await wait(1500); if(!(await busy()))break;} await wait(1500); }
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
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(900);
  // warm Fern up a bit for a nicer tier
  await D(()=>{ const r=window.rpgCustodianDebug.rel('Fern'); r.affection=5; });
  await act('Fern, hello — good to run into you out here.');
  console.log('Fern (first meeting):', (await lastFern()).slice(0,120));
  console.log('lastSeenStep after talking:', await D(()=>window.rpgCustodianDebug.rel('Fern').lastSeenStep), '| t=', await T());
  // leave and let ~3 days pass away
  await D(()=>window.rpgCustodianDebug.teleport('town-square')); await wait(700);
  for(let i=0;i<12;i++){ await page.evaluate(()=>[...document.querySelectorAll('.rpg-action-btn')].find(b=>/Wait/i.test(b.textContent))?.click()); await wait(850); }
  await D(()=>{ window.rpgCustodianDebug.state().currentTime=1; });
  await D(()=>window.rpgCustodianDebug.teleport('forest')); await wait(800);
  console.log('\n=== corrected REUNION NOTE ===\n'+await D(()=>window.rpgCustodianDebug.reunionNote('Fern')));
  await act('Fern! There you are — it has been too long.');
  console.log('\n=== Fern REPLY on return (should acknowledge the gap) ===\n'+(await lastFern()));
} finally { await page.close(); await browser.disconnect(); }
