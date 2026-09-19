import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser=await chromium.launch({headless:true,channel:'msedge'});
await mkdir('tests/ui/artifacts',{recursive:true});
const observations=[];
for(const [width,height] of [[1440,900],[1280,800],[390,844],[360,800]]) {
  for(const [name,path] of [['landing','/'],['chat','/chat/sani']]) {
    const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});const errors=[];page.on('pageerror',(error)=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:5173${path}`,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`tests/ui/artifacts/${name}-${width}.png`,fullPage:true});
    observations.push({page:name,width,scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth),errors});await page.close();
  }
}
for(const [name,path] of [['onboarding','/onboarding?character=arang'],['auth','/auth'],['history','/history'],['profile','/profile'],['settings','/settings'],['privacy','/privacy'],['reading','/reading/not-a-real-record']]) {
  const page=await browser.newPage({viewport:{width:360,height:800},reducedMotion:'reduce'});const errors=[];page.on('pageerror',(error)=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:5173${path}`,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`tests/ui/artifacts/${name}-360.png`,fullPage:true});
  observations.push({page:name,width:360,scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth),errors});await page.close();
}
await browser.close();console.log(JSON.stringify(observations,null,2));
if(observations.some((item)=>item.scrollWidth>item.width||item.errors.length))process.exitCode=1;
