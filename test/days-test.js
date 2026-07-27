import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs } = collectLogs(page);
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Dyna','A hero.','Wanderer','Drifter'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
const busy = () => page.evaluate(()=>window.rpgCustodianDebug.busy());
const day = () => page.evaluate(()=>window.rpgCustodianDebug.state().dayCount);
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
  console.log('start day:', await day(), '(Morning)');
  await page.type('#send_textarea','I make camp and wait here for three full days.'); await page.keyboard.press('Enter');
  for(let i=0;i<40;i++){ await wait(2000); const b=await busy(); if(b) { /* started */ } if(i>4 && !b) break; }
  await wait(2000);
  const intent = consoleLogs.filter(l=>l.includes('intent =')).slice(-1)[0];
  console.log('intent:', (intent||'').replace(/^.*intent = /,'').slice(0,150));
  console.log('end day:', await day(), '(3 days = 12 periods → should be Day 4, Morning)');
} finally { await page.close(); await browser.disconnect(); }
