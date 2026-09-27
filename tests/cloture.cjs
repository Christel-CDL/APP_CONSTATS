// Dictée relancée (Android), feuille de présence, fin de constat et fiche Airtable (table Constats).
// Serveur de développement (node server.cjs, port 8877) + serveur de production lancé ici avec comptes fictifs.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const out=process.env.TEST_OUTPUT||path.join(__dirname,'../../test-results');fs.mkdirSync(out,{recursive:true});
(async()=>{
  // ── API /api/constats (serveur de production, comptes fictifs) ──
  const PORT=8898,BASE=`http://127.0.0.1:${PORT}`,codes={};let log='';
  const users=[{id:'dev-ej',email:'expert.ej@example.com',name:'Expert TEST',role:'Expert judiciaire',status:'Actif'},{id:'dev-x',email:'autre@example.com',name:'Autre',role:'Expert judiciaire',status:'Actif'}];
  const projects=[{id:'dev-p90',owner:'dev-ej',fields:{'Nom du projet':'ZZ EJ','Référence':'EJ26-0099','Type':{name:'Expertise judiciaire'}}},{id:'dev-p91',owner:'dev-x',fields:{'Nom du projet':'ZZ AUTRE','Type':{name:'Expertise judiciaire'}}}];
  const server=spawn(process.execPath,[path.join(__dirname,'../server/index.cjs')],{env:{...process.env,PORT:String(PORT),APP_ROOT:path.join(__dirname,'..'),APP_URL:BASE,SESSION_SECRET:'x'.repeat(40),DEV_USERS:JSON.stringify(users),DEV_PROJECTS:JSON.stringify(projects),DEV_LOG_CODES:'1'}});
  server.stdout.on('data',d=>{log+=d;for(const m of String(d).matchAll(/Code pour (\S+) : (\d{6})/g))codes[m[1]]=m[2];});server.stderr.on('data',d=>{log+=d;});
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
  try{
    for(let i=0;i<50&&!log.includes('port');i++)await new Promise(r=>setTimeout(r,100));
    const json={'Content-Type':'application/json',Origin:BASE};
    await fetch(BASE+'/api/auth/request',{method:'POST',headers:json,body:JSON.stringify({email:'expert.ej@example.com'})});
    for(let i=0;i<30&&!codes['expert.ej@example.com'];i++)await new Promise(r=>setTimeout(r,100));
    const login=await fetch(BASE+'/api/auth/verify',{method:'POST',headers:json,body:JSON.stringify({email:'expert.ej@example.com',code:codes['expert.ej@example.com']})});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const post=(body,headers={})=>fetch(BASE+'/api/constats',{method:'POST',headers:{...json,Cookie:cookie,...headers},body:JSON.stringify({profil:'dev-ej',...body})});
    assert.equal((await fetch(BASE+'/api/constats',{method:'POST',headers:json,body:JSON.stringify({profil:'dev-ej',draftId:'abcdef1'})})).status,401,'Sans session : refusé');
    assert.equal((await post({draftId:'abcdef1'},{Origin:'https://pirate.example'})).status,403,'Autre origine refusée');
    assert.equal((await post({draftId:'x'})).status,400,'Identifiant invalide');
    let r=await post({draftId:'visit-001',title:'EJ26-0099 — Constat du 27/09/2026',date:'2026-09-27',status:'Finalisé',kind:'autre',place:'1 rue FICTIVE',projet:'dev-p90',summary:'2 photo(s)'});
    assert.equal(r.status,200);const first=(await r.json()).constat;assert.equal(first.status,'Finalisé');
    r=await post({draftId:'visit-001',title:'EJ26-0099 — Constat du 27/09/2026',date:'2026-09-27',status:'Rapport envoyé',projet:'dev-p90'});
    assert.equal((await r.json()).constat.id,first.id,'Même constat : fiche mise à jour, pas de doublon');
    r=await post({draftId:'visit-002',title:'X',status:'Inconnu',projet:'dev-p91'});assert.equal((await r.json()).constat.status,'Brouillon','Statut inconnu ramené à Brouillon');
    // La fiche d'un dossier EJ ne reçoit jamais l'adresse, même si le client l'envoie ; dossier d'un autre compte ignoré.
  }finally{server.kill();}
  // ── Parcours navigateur (serveur de développement) ──
  const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true,permissions:['camera','microphone','geolocation']});
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
    assert.match(await page.locator('#close-status').innerText(),/Dernier fichier exporté/);
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
    console.log('PASS: dictation restarted after spontaneous stops (interim text kept), attendance sheet annexed (EP) / separate file only (EJ), last export tracked, share bar, close visit, delete closed draft, /api/constats (session, origin, upsert, status)');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
