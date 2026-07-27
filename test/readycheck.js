import { connect, collectLogs, login } from './harness.js';
const browser = await connect(); const page = await browser.newPage();
const { consoleLogs, pageErrors } = collectLogs(page);
const wait = ms => new Promise(r=>setTimeout(r,ms));
const answers = ['Playtester','A brave soul.','Adventurer','Traveler'];
page.on('dialog', async d => await d.accept(answers.shift() ?? ''));
try {
  await login(page);
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
  for(let i=0;i<12;i++){const s=await page.evaluate(()=>SillyTavern.getContext().onlineStatus); if(s!=='no_connection')break; await wait(2500);}
  // Create character + New Game (no LLM generation needed for setup)
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('Create Character'))?.click());
  await wait(6000);
  await page.click('#rpg-menu-button'); await wait(400);
  await page.evaluate(()=>[...document.querySelectorAll('.rpg-menu-item')].find(e=>e.textContent.includes('New Game'))?.click());
  await wait(20000);
  const bar = await page.evaluate(()=>[...document.querySelectorAll('#rpg-action-bar .rpg-action-btn')].map(b=>b.textContent.trim()));
  const group = await page.evaluate(()=>{const g=(SillyTavern.getContext().groups||[]).find(x=>x.name?.startsWith('RPG:')); return g?{name:g.name,members:g.members.length,disabled:g.disabled_members.length}:null;});
  const start = await page.evaluate(()=>{const c=SillyTavern.getContext().chat; return c[c.length-1]?.mes?.slice(0,120);});
  console.log('action bar:', JSON.stringify(bar));
  console.log('RPG group:', JSON.stringify(group));
  console.log('start message:', start);
  console.log('refresh logs:', consoleLogs.filter(l=>/Refreshing|Creating cast|Created RPG group|Cast ready/i.test(l)).join('\n'));
  console.log('errors:', pageErrors.join('\n')||'(none)', '|', consoleLogs.filter(l=>l.startsWith('[error]')&&!l.includes('backgrounds/')).slice(0,5).join('\n')||'(no err)');
} finally { await page.close(); await browser.disconnect(); }
