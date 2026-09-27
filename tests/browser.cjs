// npm install --no-save playwright jszip; use an installed Edge or PLAYWRIGHT_CHANNEL.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const JSZip=require('jszip');
const out=process.env.TEST_OUTPUT||path.join(__dirname,'../../test-results');
fs.mkdirSync(out,{recursive:true});
(async()=>{
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
  try{
    const context=await browser.newContext({permissions:['camera','microphone','geolocation'],geolocation:{latitude:48.8566,longitude:2.3522,accuracy:7},viewport:{width:1280,height:900}});
    const page=await context.newPage(),errors=[];
    page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(20000);
    page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});
    page.on('dialog',dialog=>dialog.accept());page.on('console',msg=>{if(msg.type()==='warning')console.log('WARN',msg.text());});
    await page.addInitScript(()=>{
      // Reconnaissance vocale simulée ; window.speechHang simule un navigateur qui ne rend plus la main (iPad).
      window.SpeechRecognition=class{start(){this.t=setTimeout(()=>this.onresult?.({resultIndex:0,results:[Object.assign([{transcript:'fissure horizontale en pied de mur'}],{isFinal:true})]}),200);}stop(){clearTimeout(this.t);if(!window.speechHang)setTimeout(()=>this.onend?.(),50);}abort(){}};
      window.mediaRequests=0;if(!navigator.mediaDevices)return;
      // Synthetic sources exercise actual browser tracks/recording without physical devices.
      navigator.mediaDevices.getUserMedia=async options=>{
        window.mediaRequests++;const tracks=[];
        if(options.video){const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');let frame=0;const draw=()=>{ctx.fillStyle='#305f51';ctx.fillRect(0,0,640,480);ctx.fillStyle='#e6c69d';ctx.fillRect(50+frame++%200,60,150,200);};draw();const timer=setInterval(draw,50);const video=canvas.captureStream(20);window.testSources||=[];window.testSources.push({canvas,video,timer});tracks.push(...video.getTracks());}
        if(options.audio){const audio=new AudioContext(),destination=audio.createMediaStreamDestination(),oscillator=audio.createOscillator();oscillator.connect(destination);oscillator.start();await audio.resume();window.testAudio=audio;tracks.push(...destination.stream.getTracks());}
        return new MediaStream(tracks);
      };
    });
    const url=(process.env.TEST_URL||'http://127.0.0.1:8877/')+'?verification=1';
    await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);console.log('Loaded');
    await page.locator('.new-inspection').first().click();
    await page.waitForFunction(()=>visitAccess.tracks.length===2&&!!visitAccess.position);console.log('Access prepared');
    await page.locator('#case-name').fill('Essai stabilisation');await page.locator('#case-reference').fill('TEST-2026');
    await page.locator('#visit-date').fill('2026-09-24');
    await page.locator('[data-step="1"] .next-step').click();
    for(let i=0;i<2;i++){
      await page.locator('#photo-button').click();await page.locator('#take-photo').waitFor();
      await page.waitForFunction(()=>!document.querySelector('#take-photo').disabled).catch(async e=>{console.log(await page.evaluate(()=>({status:$('#camera-status').textContent,stream:cameraStream?.getTracks().map(t=>({state:t.readyState,enabled:t.enabled})),width:$('#camera-video').videoWidth,version:cameraVersion,access:visitAccess.tracks.map(t=>({kind:t.kind,state:t.readyState,enabled:t.enabled})),message:visitAccess.mediaMessage})));throw e;});
      await page.locator('#take-photo').click();await page.waitForFunction(n=>state.photos.length===n&&pendingCapture===false,i+1).catch(async e=>{console.log(await page.evaluate(()=>({status:$('#capture-status').textContent,count:state.photos.length,pending:pendingCapture})));throw e;});console.log('Captured',i+1);
    }
    assert.equal(await page.evaluate(()=>window.mediaRequests),1,'One media request for repeated captures');
    assert.equal(await page.evaluate(()=>state.photos.every(p=>p.position?.source==='capture')),true);
    const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=600;const x=c.getContext('2d');x.fillStyle='#e6d6c6';x.fillRect(0,0,800,600);x.fillStyle='#173f36';x.fillRect(150,150,250,200);return c.toDataURL('image/png');});
    await page.locator('#photo-input').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1],'base64')});
    await page.waitForFunction(()=>state.photos.length===3&&pendingImports===0);
    assert.equal(await page.evaluate(()=>state.photos[2].position),null,'Imports do not inherit GPS');
    await page.locator('[data-command="drawing"]').first().click();
    await page.waitForFunction(()=>!document.querySelector('#save-drawing').disabled);
    const rect=await page.locator('#drawing-canvas').boundingBox();
    await page.mouse.move(rect.x+70,rect.y+70);await page.mouse.down();await page.mouse.move(rect.x+140,rect.y+70,{steps:10});await page.mouse.up();
    const painted=await page.evaluate(()=>canvas.toDataURL());
    await page.locator('#drawing-eraser').click();await page.mouse.move(rect.x+60,rect.y+70);await page.mouse.down();await page.mouse.move(rect.x+155,rect.y+70,{steps:15});await page.mouse.up();
    assert.notEqual(await page.evaluate(()=>canvas.toDataURL()),painted,'Eraser changes pixels');
    await page.locator('#save-drawing').click();
    // Enregistrement sonore seul (fichier audio), barre d'arrêt fixe et visible
    await page.locator('[data-command="audio"]').first().click();
    const dialogBox=await page.locator('#audio-dialog').boundingBox();assert.ok(dialogBox.y+dialogBox.height<=900,'Boîte de note vocale contenue dans l’écran');
    await page.locator('#start-sound').click();await page.waitForFunction(()=>recording?.recorder?.state==='recording');
    assert.ok(await page.locator('#stop-recording').isVisible());assert.equal(await page.locator('#recording-status').evaluate(e=>getComputedStyle(e).position),'fixed');
    await page.waitForTimeout(1200);await page.locator('#stop-recording').click();await page.waitForFunction(()=>!recording&&!!state.photos[0].audio);
    assert.equal(await page.evaluate(()=>state.photos[0].comment||''),'','Enregistrement sonore : aucun texte ajouté');
    // Dictée : texte ajouté aux commentaires, sans enregistrement audio
    await page.locator('[data-command="audio"]').first().click();await page.locator('#start-dictation').click();
    await page.waitForFunction(()=>/fissure horizontale/.test($('#recording-live').textContent));await page.locator('#stop-recording').click();
    await page.waitForFunction(()=>!recording&&/fissure horizontale en pied de mur/.test(state.photos[0].comment));
    // Navigateur qui ne répond plus : arrêt forcé en 4 s, texte déjà reconnu conservé, page utilisable
    await page.evaluate(()=>{window.speechHang=true;state.photos[1].comment='';});
    await page.locator('[data-command="audio"]').nth(1).click();await page.locator('#start-dictation').click();
    await page.waitForFunction(()=>/fissure/.test($('#recording-live').textContent));await page.locator('#stop-recording').click();
    await page.waitForFunction(()=>!recording,null,{timeout:8000});assert.match(await page.evaluate(()=>state.photos[1].comment),/fissure horizontale/);assert.ok(await page.locator('#recording-status').isHidden());
    await page.evaluate(()=>{window.speechHang=false;state.photos[0].comment='';state.photos[1].comment='';renderCaptures();});
    // Grand cadre d'écriture
    await page.locator('[data-command="expand"][data-field="description"]').first().click();assert.ok((await page.locator('#text-dialog-field').boundingBox()).height>=400,'Cadre d’écriture agrandi');
    await page.locator('#text-dialog-field').fill('Écrit dans le grand cadre');await page.locator('#save-text').click();
    assert.equal(await page.evaluate(()=>state.photos[0].description),'Écrit dans le grand cadre');
    // Changement de sujet d'une photo par la liste (effet immédiat, numéro conservé)
    await page.evaluate(()=>{addSubject('ZZ Façade test');renderCaptures();});const moved=await page.evaluate(()=>state.photos[0].number);
    await page.locator('.photo-subject').first().selectOption('ZZ Façade test');
    await page.waitForFunction(n=>state.photos.find(p=>p.number===n).subject==='ZZ Façade test',moved);
    await page.evaluate(n=>{state.photos.find(p=>p.number===n).subject=state.subjects[0];renderSubjects();renderCaptures();},moved);
    assert.equal(await page.evaluate(()=>window.mediaRequests),1,'Audio reuses prepared microphone');
    await page.locator('[data-edit="description"]').first().fill('Description conservée');
    await page.locator('[data-edit="comment"]').first().fill('COMMENTAIRE_CONFIDENTIEL');
    await page.locator('#save-draft').click();await page.waitForFunction(()=>!unsaved);
    await page.locator('.new-inspection').first().click();await page.locator('[data-view="constats"]').click();
    await page.locator('.draft-card').filter({hasText:'Essai stabilisation'}).getByRole('button').click();
    await page.waitForFunction(()=>state.photos.length===3);
    assert.equal(await page.locator('#case-name').inputValue(),'Essai stabilisation');
    assert.ok(await page.evaluate(()=>state.photos[0].audio));
    await page.locator('[data-step="2"] .next-step').click();
    await page.locator('.action-text').first().fill('ACTION_PRIVEE');
    await page.locator('[data-step="3"] .next-step').click();
    await page.locator('#summary-editor [data-include="comment"]').first().uncheck();
    fs.writeFileSync(path.join(out,'fixture.json'),JSON.stringify(await page.evaluate(()=>snapshot())));
    const downloads={};
    for(const [button,name] of [['#generate-report','rapport.docx'],['#export-pdf','rapport.pdf'],['#export-clean-pdf','photos.pdf']]){
      const promise=page.waitForEvent('download');await page.locator(button).click();const download=await promise;const target=path.join(out,name);await download.saveAs(target);downloads[name]=target;
    }
    const zip=await JSZip.loadAsync(fs.readFileSync(downloads['rapport.docx']));
    const xml=await zip.file('word/document.xml').async('string');
    assert.match(xml,/Description conservée/);assert.doesNotMatch(xml,/COMMENTAIRE_CONFIDENTIEL/);assert.match(xml,/ACTION_PRIVEE/);assert.match(xml,/TEST-2026/);assert.match(xml,/w:w="11906"/);
    assert.ok(Object.keys(zip.files).some(x=>x.startsWith('word/media/')));
    await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);await page.waitForFunction(()=>!unsaved);
    await context.setOffline(true);await page.reload();await page.waitForFunction(()=>ready);
    assert.equal(await page.evaluate(()=>state.photos.length),3,'Offline reload restores images');
    await page.locator('.resume').click();await page.locator('[data-step="2"] .next-step').click();await page.locator('[data-step="3"] .next-step').click();
    const offlineDownload=page.waitForEvent('download');await page.locator('#generate-report').click();await (await offlineDownload).saveAs(path.join(out,'hors-connexion.docx'));
    await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'mobile.png')});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile layout fits screen');
    assert.deepEqual(errors,[],'No browser JS errors');
    console.log('PASS: startup, shared permissions, capture GPS, import without GPS, eraser, audio, draft restore, DOCX/PDF downloads, offline reload/export, sound recording vs dictation to comments, forced stop, large writing box, no JS errors');
    await context.close();
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
