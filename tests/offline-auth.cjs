// Terrain sans réseau, avec le serveur de production (server/index.cjs) : connexion en ligne une fois,
// puis coupure totale du réseau et parcours complet depuis l'écran de lancement. node tests/offline-auth.cjs
const {chromium}=require('playwright');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const PORT=8897,BASE=`http://127.0.0.1:${PORT}`;
const users=[{id:'dev-ej',email:'expert.ej@example.com',name:'Expert TEST-EJ',organisation:'Cabinet fictif',role:'Expert judiciaire',status:'Actif'}];
const projects=[{id:'dev-p90',owner:'dev-ej',fields:{'Nom du projet':'ZZ EJ AIRTABLE','Référence':'EJ26-0099','Type':{name:'Expertise judiciaire'}}}];
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
(async()=>{
  const codes={};let log='';
  const start=()=>{const srv=spawn(process.execPath,[path.join(__dirname,'../server/index.cjs')],{env:{...process.env,PORT:String(PORT),APP_ROOT:path.join(__dirname,'..'),APP_URL:BASE,SESSION_SECRET:'z'.repeat(40),DEV_USERS:JSON.stringify(users),DEV_PROJECTS:JSON.stringify(projects),DEV_LOG_CODES:'1'}});
  srv.stdout.on('data',d=>{log+=d;for(const m of String(d).matchAll(/Code pour (\S+) : (\d{6})/g))codes[m[1]]=m[2];});return srv;};
  let server=start();
  for(let i=0;i<50&&!log.includes('port 8');i++)await new Promise(r=>setTimeout(r,100));
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1180,height:820},acceptDownloads:true});const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    // 1. En ligne : connexion, synchronisation des dossiers, préparation du hors connexion
    await page.goto(BASE+'/demarrer.html');await page.locator('#email').fill('expert.ej@example.com');await page.locator('#email-form button[type=submit]').click();
    await page.locator('#code').waitFor();for(let i=0;i<30&&!codes['expert.ej@example.com'];i++)await page.waitForTimeout(100);
    await page.locator('#code').fill(codes['expert.ej@example.com']);await page.locator('#code-form button[type=submit]').click();
    await page.waitForURL(/index\.html/);await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
    await page.waitForFunction(()=>readDossiers().some(d=>d.airtableId==='dev-p90'));
    await page.waitForFunction(()=>navigator.serviceWorker.controller!==null&&/disponible hors connexion/.test($('#offline-status').textContent),null,{timeout:20000});
    // 2. Réseau coupé ET serveur arrêté : aucune requête ne peut aboutir
    await context.setOffline(true);server.kill();await new Promise(r=>setTimeout(r,300));
    await page.evaluate(()=>sessionStorage.clear());// nouveau lancement de l'icône
    await page.goto(BASE+'/demarrer.html');await page.waitForFunction(()=>document.querySelectorAll('.profile').length===1);
    assert.match(await page.locator('#status').innerText(),/Hors connexion/);
    await page.locator('.profile button.open').click();await page.waitForURL(/index\.html/);await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
    assert.equal(await page.evaluate(()=>PROFILE.id),'dev-ej');
    assert.ok(await page.evaluate(()=>readDossiers().some(d=>d.reference==='EJ26-0099')),'Dossiers Airtable disponibles hors connexion');
    // 3. Nouveau dossier hors connexion : en attente d'envoi
    await page.locator('.nav-item[data-view="dossiers"]').click();await page.locator('#new-dossier').click();
    await page.locator('#dossier-form [name=name]').fill('ZZ CRÉÉ SANS RÉSEAU');await page.locator('#dossier-form [name=reference]').fill('EJ26-0200');await page.locator('#dossier-form button[type=submit]').click();
    await page.waitForFunction(()=>readDossiers().find(d=>d.name==='ZZ CRÉÉ SANS RÉSEAU')?.pendingSync===true);
    assert.match(await page.locator('#dossier-sync').innerText(),/Hors connexion/);
    // 4. Constat complet hors connexion : photo, enregistrement, rechargement, exports
    await page.evaluate(()=>startNewVisit(readDossiers().find(d=>d.reference==='EJ26-0099').id));await page.waitForFunction(()=>state.caseType==='ej');
    await page.evaluate(png=>{addPhoto(png,'Vue générale',new Date().toISOString());state.photos[0].description='Fissure relevée sans réseau';},png);
    await page.locator('#save-draft').click();await page.waitForFunction(()=>!unsaved);
    await page.reload();await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
    assert.equal(await page.evaluate(()=>state.photos[0]?.description),'Fissure relevée sans réseau','Constat conservé après rechargement hors connexion');
    await page.evaluate(()=>{showPage('inspection');state.currentStep=4;renderStep();});
    for(const button of ['#export-html','#generate-report','#export-pdf']){const [d]=await Promise.all([page.waitForEvent('download',{timeout:8000}),page.locator(button).click()]);assert.ok(fs.statSync(await d.path()).size>500,button+' hors connexion');}
    // 5. Retour du réseau : le dossier créé hors connexion part vers Airtable
    log='';server=start();for(let i=0;i<50&&!log.includes('port 8');i++)await new Promise(r=>setTimeout(r,100));
    await context.setOffline(false);await page.evaluate(()=>syncDossiers());
    await page.waitForFunction(()=>{const d=readDossiers().find(x=>x.name==='ZZ CRÉÉ SANS RÉSEAU');return d&&d.airtableId&&!d.pendingSync;});
    assert.deepEqual(errors,[]);
    console.log('PASS: offline after one online login — launcher, profile choice, Airtable dossiers cached, dossier created pending sync, visit saved/reloaded, HTML/Word/PDF exports, with network cut and server stopped; pending dossier sent to Airtable when back online');
  }finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exit(1);});
