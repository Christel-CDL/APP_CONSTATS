// Dictée relancée (Android), feuille de présence, fin de constat et fiche Airtable (table Constats).
// Serveur de développement (node server.cjs, port 8877). Sauvegarde serveur et Airtable : tests/sync.cjs.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const out=process.env.TEST_OUTPUT||path.join(__dirname,'../../test-results');fs.mkdirSync(out,{recursive:true});
// Explorateur de fichiers (showSaveFilePicker) non pilotable par Playwright : ces tests vérifient le téléchargement classique.
async function noSavePicker(browser,options){const context=await browser.newContext(options);await context.addInitScript(()=>{delete window.showSaveFilePicker;});return context;}
(async()=>{
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
  // ── Parcours navigateur (serveur de développement) ──
  const context=await noSavePicker(browser,{viewport:{width:1280,height:900},acceptDownloads:true,permissions:['camera','microphone','geolocation']});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{
    // Android : la reconnaissance s'arrête seule après une phrase, sans résultat « définitif ».
    window.speechStarts=0;window.speechPhrases=['fissure en pied de mur','côté jardin'];
    window.SpeechRecognition=class{start(){const phrase=window.speechPhrases[window.speechStarts++]||'';this.t=setTimeout(()=>{if(phrase)this.onresult?.({resultIndex:0,results:[Object.assign([{transcript:phrase}],{isFinal:false})]});this.onerror?.({error:phrase?'':'no-speech'});this.e=setTimeout(()=>this.onend?.(),30);},100+(phrase?0:1600));}stop(){clearTimeout(this.t);clearTimeout(this.e);setTimeout(()=>this.onend?.(),20);}abort(){}};
  });
  try{
    await page.goto((process.env.TEST_URL||'http://127.0.0.1:8877/')+'?verification=1');await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
    const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await page.evaluate(async src=>{await startNewVisit();state.caseReference='EJ26-0099';state.caseName='ZZ DOSSIER';state.siteAddress='1 rue FICTIVE';setCaseType('ep');addPhoto(src,'Vue générale',new Date().toISOString(),null,'import');},photo);
    // Dictée : deux séquences qui s'arrêtent seules, relancées jusqu'à « Arrêter »
    await page.evaluate(()=>startDictation(state.photos[0]));
    await page.waitForFunction(()=>window.speechStarts>=3,null,{timeout:8000});
    assert.ok(await page.evaluate(()=>!!recording),'Écoute toujours active après les arrêts spontanés');
    await page.click('#stop-recording');await page.waitForFunction(()=>!recording);
    assert.equal(await page.evaluate(()=>state.photos[0].comment),'fissure en pied de mur côté jardin','Texte provisoire conservé et séquences mises bout à bout');
    // Suppression d'un enregistrement sonore
    await page.evaluate(()=>{state.photos[0].audio='data:audio/webm;base64,GkXfow==';renderCaptures();});
    await page.evaluate(()=>document.querySelector('[data-delete-audio]').click());await page.waitForFunction(()=>state.photos[0].audio===null&&!document.querySelector('[data-delete-audio]'));
    // Feuille de présence (EP) : annexe du rapport HTML
    await page.evaluate(()=>{state.currentStep=4;renderStep();});
    const png=Buffer.from(photo.split(',')[1],'base64');fs.writeFileSync(path.join(out,'feuille.png'),png);
    await page.setInputFiles('#attendance-input',path.join(out,'feuille.png'));
    await page.waitForFunction(()=>state.attendance.length===1&&document.querySelectorAll('.attendance-thumb').length===1);
    let download=page.waitForEvent('download');await page.click('#export-html');let file=await download;
    let html=fs.readFileSync(await file.path(),'utf8');
    assert.match(html,/Annexe — Feuille de présence/);assert.match(html,/voir annexe/);
    assert.equal(file.suggestedFilename(),'EJ26-0099_CONSTAT_'+await page.evaluate(()=>state.visitDate)+'.html');
    assert.equal(await page.evaluate(()=>state.lastExport.name),file.suggestedFilename(),'Dernier export noté dans le constat');
    assert.match(await page.locator('#close-status').innerText(),/Dernier fichier enregistré/);
    assert.ok(await page.isVisible('#share-bar'),'Barre d’envoi affichée après l’export');
    // EJ : la feuille n'est jamais intégrée au rapport, seulement signalée ; téléchargement séparé
    await page.evaluate(()=>{state.clientName='';state.clientAddress='';state.transferHash=transferContentHash();});
    await page.evaluate(()=>{$('#case-type').value='ej';$('#case-type').dispatchEvent(new Event('change'));});
    assert.equal(await page.evaluate(()=>state.caseType),'ej');
    assert.ok(await page.isVisible('#attendance-download'));
    download=page.waitForEvent('download');await page.click('#export-html');file=await download;html=fs.readFileSync(await file.path(),'utf8');
    assert.doesNotMatch(html,/Annexe — Feuille de présence/);assert.match(html,/jointe en fichier séparé/);
    assert.ok(!html.includes(await page.evaluate(()=>state.attendance[0].slice(30,200))),'EJ : l’image de la feuille n’est pas dans le rapport');
    download=page.waitForEvent('download');await page.click('#attendance-download');file=await download;assert.match(file.suggestedFilename(),/^EJ26-0099_CONSTAT_.*_feuille-presence\.jpg$/);
    // Terminer : le constat passe dans « Constats terminés », un constat vierge prend sa place
    const closedId=await page.evaluate(()=>state.draftId);
    await page.click('#close-visit');await page.waitForFunction(id=>state.draftId!==id&&!state.photos.length&&$('#constats').classList.contains('active'),closedId);
    assert.match(await page.locator('#draft-list').innerText(),/Constats terminés \(1\)/);
    assert.equal(await page.evaluate(()=>state.attendance.length),0,'Nouveau constat sans feuille de présence');
    // Suppression d'un constat terminé
    await page.click(`[data-delete-draft="${closedId}"]`);
    await page.waitForFunction(id=>!document.querySelector(`[data-delete-draft="${id}"]`),closedId);
    assert.equal((await page.evaluate(()=>listDrafts())).filter(d=>d.draftId===closedId).length,0);
    assert.deepEqual(errors,[]);
    console.log('PASS: dictation restarted after spontaneous stops (interim text kept), sound recording deleted, attendance sheet annexed (EP) / separate file only (EJ), last export tracked, share bar, close visit, delete closed draft');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
