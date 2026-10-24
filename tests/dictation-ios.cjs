// Dictée sur iPad installé en icône (écran d'accueil) : la reconnaissance vocale de WebKit n'y fonctionne pas.
// « Dicter » doit ouvrir le grand champ (touche micro du clavier) sans lancer la reconnaissance ; ailleurs, un échec
// sans texte reconnu ouvre aussi ce champ. Serveur de développement (node server.cjs, port 8877).
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const IPAD='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
async function open(browser,options,init){const context=await browser.newContext({viewport:{width:1024,height:1300},permissions:['camera','microphone','geolocation'],...options});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(init);await page.goto((process.env.TEST_URL||'http://127.0.0.1:8877/')+'?verification=1');await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
  await page.evaluate(async src=>{await startNewVisit();addPhoto(src,'Vue générale',new Date().toISOString(),null,'import');state.currentStep=2;renderStep();},photo);return {context,page,errors};}
(async()=>{
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
  try{
    // iPad (Safari se présente comme un Mac tactile) lancé depuis l'icône
    let {context,page,errors}=await open(browser,{userAgent:IPAD,hasTouch:true},()=>{
      Object.defineProperty(navigator,'standalone',{value:true});Object.defineProperty(navigator,'maxTouchPoints',{value:5});
      window.speechStarts=0;window.webkitSpeechRecognition=class{start(){window.speechStarts++;}stop(){}abort(){}};});
    await page.locator('[data-command="audio"]').first().click();
    assert.match(await page.locator('#dictation-help').textContent(),/touche 🎙 du clavier/);
    await page.locator('#start-dictation').click();
    assert.ok(await page.locator('#text-dialog').evaluate(d=>d.open),'Grand champ ouvert pour la dictée du clavier');
    assert.equal(await page.evaluate(()=>window.speechStarts),0,'Reconnaissance WebKit non lancée');
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'text-dialog-field','Curseur dans le champ');
    await page.fill('#text-dialog-field','fissure en tête de mur');await page.click('#save-text');
    assert.equal(await page.evaluate(()=>state.photos[0].comment),'fissure en tête de mur');
    assert.deepEqual(errors,[]);await context.close();
    // Navigateur dont la reconnaissance est refusée : bascule automatique vers le grand champ
    ({context,page,errors}=await open(browser,{},()=>{
      window.SpeechRecognition=class{start(){setTimeout(()=>{this.onerror?.({error:'service-not-allowed'});this.onend?.();},50);}stop(){}abort(){}};}));
    await page.evaluate(()=>startDictation(state.photos[0]));
    await page.waitForFunction(()=>!recording&&document.querySelector('#text-dialog').open);
    assert.match(await page.locator('.text-dialog-help').textContent(),/touche 🎙 du clavier/);
    assert.deepEqual(errors,[]);await context.close();
    console.log('PASS: iPad home-screen app dictates through the keyboard mic (no WebKit recognition), refused recognition falls back to the large text box');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
