import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce',acceptDownloads:true});
const report={created:false,partial:false,reloaded:false,retryPreserved:false,privateBirthHidden:false,exported:false,deleted:false};
const failures=[];page.on('response',async(response)=>{if(response.status()>=400&&/\/(auth|rest|functions)\/v1\//.test(response.url())){const body=await response.json().catch(()=>({}));failures.push({path:new URL(response.url()).pathname,status:response.status(),code:body.code||body.error_code||body.error?.code,message:body.message||body.msg||body.error_description||body.error?.message});}});
const resultResponse=(action)=>page.waitForResponse((response)=>response.url().includes('/functions/v1/saju')&&response.request().method()==='POST'&&response.request().postDataJSON()?.action===action,{timeout:130000});
try {
 await mkdir('tests/ui/artifacts',{recursive:true});await page.goto('http://127.0.0.1:5173/onboarding?character=sani',{waitUntil:'networkidle'});
 await page.getByLabel('이름 또는 닉네임').fill('QA_UI_20260920');const start=page.getByRole('button',{name:'산이와 이야기 시작하기'});
 if(await start.isDisabled())throw new Error('Browser onboarding awaits security confirmation or configuration. No account was created.');
 await start.click();await page.waitForURL('**/chat/sani',{timeout:20000});report.created=true;
 await page.getByRole('button',{name:'사주',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('생년월일').fill('1992-10-24');await dialog.getByLabel('출생시간',{exact:true}).fill('05:30');await dialog.getByLabel('성별',{exact:false}).selectOption('MALE');await dialog.getByLabel('출생도시',{exact:true}).fill('Seoul');
 await dialog.getByRole('list',{name:'출생도시 검색 결과'}).getByRole('button').filter({hasText:'Asia/Seoul'}).first().click({timeout:20000});
 const initialResponse=resultResponse('CALCULATE');await dialog.getByRole('button',{name:'나의 사주 이야기',exact:true}).click();const initial=await (await initialResponse).json();if(!initial.ok)throw new Error(`Saju returned ${initial.error?.code||'unknown error'}`);report.partial=initial.data.executionStatus==='PARTIAL';
 await page.getByLabel('저장된 사주 결과').waitFor({timeout:20000});await page.screenshot({path:'tests/ui/artifacts/live-saju-chat-1280.png',fullPage:true});
 await page.reload({waitUntil:'networkidle'});await page.getByLabel('저장된 사주 결과').waitFor();report.reloaded=true;
 const retryResponse=resultResponse('RETRY_INTERPRETATION');await page.getByRole('button',{name:'사주 해석 다시 받기',exact:true}).click();const retry=await (await retryResponse).json();report.retryPreserved=retry.ok&&retry.data.readingId===initial.data.readingId;
 await page.getByRole('link',{name:'사주 자세히 보기',exact:true}).click();await page.getByText('나를 이루는 네 기둥',{exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
 report.privateBirthHidden=!(await page.locator('main').innerText()).includes('1992-10-24');await page.screenshot({path:'tests/ui/artifacts/live-saju-reading-1280.png',fullPage:true});
 await page.setViewportSize({width:360,height:800});await page.screenshot({path:'tests/ui/artifacts/live-saju-reading-360.png',fullPage:true});if(await page.evaluate(()=>document.documentElement.scrollWidth)>360)throw new Error('Reading layout overflows360px');
 const download=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:'결과 이미지 저장',exact:true}).click();await (await download).saveAs('tests/ui/artifacts/live-saju-export.png');report.exported=true;
} catch(error) {report.error=error.message;await page.screenshot({path:'tests/ui/artifacts/live-saju-failure.png',fullPage:true}).catch(()=>{});}
finally {try{await page.goto('http://127.0.0.1:5173/settings',{waitUntil:'networkidle'});const remove=page.getByRole('button',{name:'계정과 모든 데이터 삭제'});if(await remove.count()){report.created=true;await remove.click();await page.getByPlaceholder('DELETE').fill('DELETE');await page.getByRole('button',{name:'모두 삭제',exact:true}).click();await page.waitForURL('http://127.0.0.1:5173/',{timeout:20000});report.deleted=true;}}catch(error){report.cleanupError=error.message;}await browser.close();}
console.log(JSON.stringify({...report,failures},null,2));if(report.error||report.cleanupError)process.exitCode=1;
