const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const b=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
 try{
  const context=await b.newContext(),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{
    window.requestCount=0;window.stops=0;window.pendingMedia=null;
    navigator.mediaDevices.getUserMedia=()=>{window.requestCount++;return new Promise(resolve=>window.pendingMedia=resolve);};
    navigator.geolocation.watchPosition=()=>1;navigator.geolocation.clearWatch=()=>{};
  });
  await page.goto((process.env.TEST_URL||'http://127.0.0.1:8877/')+'?verification=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>ready);
  await page.locator('.new-inspection').first().click();await page.waitForFunction(()=>!!window.pendingMedia);
  await page.locator('#pause-access').click();
  await page.evaluate(async()=>{window.pendingMedia({getTracks:()=>[{stop(){window.stops++;}}]});await new Promise(r=>setTimeout(r,0));});
  assert.equal(await page.evaluate(()=>window.stops),1,'Late permission stream stopped after suspension');
  assert.equal(await page.evaluate(()=>visitAccess.tracks.length),0);
  const results=await page.evaluate(async()=>{
    visitAccess.position={lat:48,lng:2,measuredAt:new Date(Date.now()-60000).toISOString()};
    const stale=recentPosition();
    visitAccess.position={lat:48,lng:2,measuredAt:new Date().toISOString()};const fresh=recentPosition();
    const invalid=normalizeVisit({photos:[],subjects:['Test'],actions:[null,{text:22,recipient:{bad:true}}]});
    let rejected=false;try{normalizeVisit({photos:[{src:'javascript:alert(1)'}],subjects:['Test']});}catch{rejected=true;}
    state.caseName='Avant import';saveVisit();await persistVisit();const before=state.draftId;
    const original=dbWrite;dbWrite=async()=>{throw Error('QuotaExceededError');};const saved=await persistVisit();
    await startNewVisit();const retained=state.draftId===before&&state.caseName==='Avant import';dbWrite=original;
    return {stale,fresh,invalidActions:invalid.actions,rejected,saved,retained};
  });
  assert.equal(results.stale,null);assert.equal(results.fresh.lat,48);assert.equal(results.rejected,true);
  assert.equal(results.invalidActions[0].text,'');assert.equal(results.saved,false);assert.equal(results.retained,true,'Failed save preserves current visit');
  assert.deepEqual(errors,[]);
  console.log('PASS: cancellation of pending permissions, stale GPS rejected, backup validation, failed-save protection');
  await context.close();
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
