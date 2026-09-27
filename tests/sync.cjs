// Sauvegarde serveur des constats et passage d'un appareil à l'autre (téléphone → iPad), copie Airtable (simulée),
// conflit entre deux appareils, expertise judiciaire sans donnée nominative, enregistrement via l'explorateur.
// Serveur de production lancé ici (comptes fictifs, DATA_DIR temporaire, faux service Airtable local).
const {chromium}=require('playwright');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),http=require('node:http');
const PORT=8896,BASE=`http://127.0.0.1:${PORT}`,FAKE=8897;
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const png2='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
(async()=>{
  // Faux Airtable : enregistre les écritures dans la table Constats.
  const writes=[];const fake=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const fields=body?JSON.parse(body).fields:{};writes.push({method:req.method,url:req.url,fields});
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'recFAKECONSTAT001',fields}));});}).listen(FAKE);
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'constats-sync-')),codes={};let log='';
  const users=[{id:'dev-ej',email:'expert.ej@example.com',name:'Expert TEST-EJ',role:'Expert judiciaire',status:'Actif'}];
  const projects=[{id:'dev-p90',owner:'dev-ej',fields:{'Nom du projet':'EJ26-0099 — Expertise bâtiment','Référence':'EJ26-0099','Type':{name:'Expertise judiciaire'},'Statut':{name:'En cours'}}}];
  const server=spawn(process.execPath,[path.join(__dirname,'../server/index.cjs')],{env:{...process.env,PORT:String(PORT),APP_ROOT:path.join(__dirname,'..'),APP_URL:BASE,SESSION_SECRET:'s'.repeat(40),
    DEV_USERS:JSON.stringify(users),DEV_PROJECTS:JSON.stringify(projects),DEV_LOG_CODES:'1',DATA_DIR:dataDir,DEV_MIRROR:'1',AIRTABLE_API_URL:`http://127.0.0.1:${FAKE}/v0`,AIRTABLE_BASE_ID:'appTEST',AIRTABLE_TOKEN:'x',MIRROR_DELAY_MS:'400'}});
  server.stdout.on('data',d=>{log+=d;for(const m of String(d).matchAll(/Code pour (\S+) : (\d{6})/g))codes[m[1]]=m[2];});server.stderr.on('data',d=>{log+=d;});
  for(let i=0;i<50&&!log.includes('port');i++)await new Promise(r=>setTimeout(r,100));
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
  const errors=[];
  async function device(){const context=await browser.newContext({viewport:{width:1180,height:820},acceptDownloads:true});const page=await context.newPage();page.setDefaultTimeout(15000);
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    delete codes['expert.ej@example.com'];
    await page.goto(BASE+'/');await page.waitForURL(/demarrer\.html/);
    await page.locator('#email').fill('expert.ej@example.com');await page.locator('#email-form button[type=submit]').click();await page.locator('#code').waitFor();
    for(let i=0;i<50&&!codes['expert.ej@example.com'];i++)await page.waitForTimeout(100);
    await page.locator('#code').fill(codes['expert.ej@example.com']);await page.locator('#code-form button[type=submit]').click();
    await page.waitForURL(/index\.html/);await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
    await page.waitForFunction(()=>readDossiers().some(d=>d.airtableId==='dev-p90'));return page;}
  const synced=(page,version)=>page.waitForFunction(v=>!Object.keys(dirtyIds()).length&&!cloud.running&&cloudMeta()[state.draftId]?.version>=v,version,{timeout:20000});
  try{
    // Accès protégé
    const plain=(p,o)=>fetch(BASE+p,o);
    assert.equal((await plain('/api/constats?profil=dev-ej')).status,401);assert.equal((await plain('/api/fichiers/'+'a'.repeat(64)+'?profil=dev-ej')).status,401);
    // ── Téléphone : constat EJ, photo, commentaire, feuille de présence (jamais envoyée)
    const phone=await device();
    const draftId=await phone.evaluate(async src=>{await startNewVisit(readDossiers().find(d=>d.airtableId==='dev-p90').id);state.siteAddress='12 rue FICTIVE, Bordeaux';addPhoto(src,'Vue générale',new Date().toISOString(),null,'import');
      state.photos[0].comment='Fissure verticale';state.attendance=[src];state.presents='Expert désigné\nDemandeur';saveVisit();return state.draftId;},png);
    await synced(phone,1);
    const stored=JSON.parse(fs.readFileSync(path.join(dataDir,'constats','dev-ej',draftId+'.json'),'utf8'));
    assert.equal(stored.version,1);assert.match(stored.visit.photos[0].src,/^fichier:[a-f0-9]{64}$/);assert.deepEqual(stored.visit.attendance,[],'EJ : feuille de présence jamais envoyée');
    assert.ok(!JSON.stringify(stored).includes('data:'),'Aucune image intégrée au constat stocké');
    assert.ok(fs.existsSync(path.join(dataDir,'fichiers','dev-ej',stored.visit.photos[0].src.slice(8))),'Photo stockée sur le serveur');
    // Copie Airtable (différée, regroupée)
    for(let i=0;i<50&&!writes.length;i++)await new Promise(r=>setTimeout(r,100));
    const first=writes[0];assert.equal(first.method,'POST');assert.match(first.url,/\/v0\/appTEST\/Constats$/);
    assert.match(first.fields.Titre,/^EJ26-0099 — Constat du /);assert.equal(first.fields['Référence'],'EJ26-0099');assert.equal(first.fields['Lieu visité'],'12 rue FICTIVE, Bordeaux');
    assert.deepEqual(first.fields.Projet,['dev-p90'],'Rattaché au dossier par le n° de l’expertise');assert.deepEqual(first.fields.Auteur,['dev-ej']);
    assert.match(first.fields['Synthèse'],/Fissure verticale/);assert.equal(JSON.parse(first.fields['Données appli (JSON)']).visit.photos[0].comment,'Fissure verticale');
    // Protection du serveur
    const cookie=await phone.context().cookies().then(c=>c.map(x=>x.name+'='+x.value).join('; '));const h={'Content-Type':'application/json',Cookie:cookie,Origin:BASE};
    assert.equal((await plain(`/api/constats/${draftId}?profil=dev-ej`,{method:'PUT',headers:h,body:JSON.stringify({visit:{draftId,photos:[{src:png}]},baseVersion:1})})).status,400,'Image intégrée refusée');
    assert.equal((await plain('/api/fichiers/'+'b'.repeat(64)+'?profil=dev-ej',{method:'PUT',headers:{...h,'Content-Type':'image/png'},body:'xx'})).status,400,'Empreinte incorrecte refusée');
    assert.equal((await plain(`/api/constats/${draftId}?profil=dev-ej`,{method:'PUT',headers:{...h,Origin:'https://pirate.example'},body:'{}'})).status,403);
    // ── iPad : récupère le constat en cours
    const ipad=await device();
    await ipad.locator('.nav-item[data-view="constats"]').click();
    await ipad.locator(`[data-cloud-pull="${draftId}"]`).click();
    for(let i=0;i<100&&!(await ipad.evaluate(id=>listDrafts().then(l=>l.some(d=>d.draftId===id)),draftId));i++)await ipad.waitForTimeout(100);
    const copy=await ipad.evaluate(id=>listDrafts().then(l=>l.find(d=>d.draftId===id)),draftId);
    assert.equal(copy.photos[0].src,png,'Photo identique récupérée');assert.equal(copy.photos[0].comment,'Fissure verticale');assert.equal(copy.siteAddress,'12 rue FICTIVE, Bordeaux');
    assert.equal(copy.dossierId,await ipad.evaluate(()=>readDossiers().find(d=>d.airtableId==='dev-p90').id),'Rattaché au dossier local de l’iPad (pas de doublon)');
    assert.equal(await ipad.evaluate(()=>readDossiers().length),1);
    // iPad : ouvre et complète le constat → version 2
    await ipad.locator(`#draft-list [data-open-draft="${draftId}"]`).click();await ipad.waitForFunction(id=>state.draftId===id,draftId);
    await ipad.evaluate(src=>{addPhoto(src,'Vue générale',new Date().toISOString(),null,'import');state.photos[0].comment='Fissure verticale traversante';saveVisit();},png2);
    await synced(ipad,2);assert.equal(await ipad.evaluate(id=>cloudMeta()[id].version,draftId),2);
    // Téléphone : au lancement, mise à jour automatique (aucune modification locale en attente)
    await phone.reload();await phone.waitForFunction(()=>typeof ready!=='undefined'&&ready);
    await phone.waitForFunction(()=>state.photos.length===2&&state.photos[0].comment==='Fissure verticale traversante');
    // ── Conflit : les deux appareils modifient la même version
    await ipad.evaluate(()=>{state.photos[0].description='Relevé iPad';saveVisit();});await synced(ipad,3);
    await phone.evaluate(()=>{state.photos[0].description='Relevé téléphone';saveVisit();});
    await phone.waitForFunction(id=>!!cloudMeta()[id]?.conflict,draftId,{timeout:30000});
    await phone.locator('.nav-item[data-view="constats"]').click();await phone.locator(`[data-cloud-force="${draftId}"]`).click();
    await phone.waitForFunction(id=>!cloudMeta()[id]?.conflict&&cloudMeta()[id]?.version===4,draftId);
    const last=JSON.parse(fs.readFileSync(path.join(dataDir,'constats','dev-ej',draftId+'.json'),'utf8'));assert.equal(last.visit.photos[0].description,'Relevé téléphone');
    for(let i=0;i<50&&!writes.some(w=>w.method==='PATCH'&&JSON.parse(w.fields['Données appli (JSON)']||'{}').version===4);i++)await new Promise(r=>setTimeout(r,100));
    assert.ok(writes.some(w=>w.method==='PATCH'&&/recFAKECONSTAT001$/.test(w.url)),'Fiche Airtable mise à jour, pas de doublon');
    // ── Enregistrement via l'explorateur (ordinateur) : fichier écrit dans le dossier choisi
    await phone.evaluate(()=>{window.saved=[];window.showSaveFilePicker=async options=>({name:options.suggestedName,createWritable:async()=>({write:async blob=>window.saved.push({name:options.suggestedName,id:options.id,size:blob.size}),close:async()=>{}})});
      showPage('inspection');state.currentStep=4;renderStep();});
    await phone.click('#export-html');await phone.waitForFunction(()=>window.saved.length===1);
    const saved=await phone.evaluate(()=>window.saved[0]);assert.match(saved.name,/^EJ26-0099_CONSTAT_.*\.html$/);assert.equal(saved.id,'exp-EJ26-0099','Dossier mémorisé par expertise');assert.ok(saved.size>500);
    assert.equal(await phone.evaluate(()=>state.lastExport.name),saved.name);
    await phone.evaluate(()=>{window.showSaveFilePicker=async()=>{throw new DOMException('annulé','AbortError');};state.lastExport=null;});
    await phone.click('#export-html');await phone.waitForTimeout(300);assert.equal(await phone.evaluate(()=>state.lastExport),null,'Annulation : rien n’est noté comme enregistré');
    assert.deepEqual(errors,[]);
    console.log('PASS: server backup (photos by SHA-256, no inline image, EJ attendance never sent), deferred Airtable copy (reference, address, dossier link, JSON), phone → iPad retrieval without duplicate dossier, auto-update on launch, two-device conflict and forced keep, protected routes, save via file picker (per-expertise folder, cancel)');
  }finally{await browser.close();server.kill();fake.close();}
})().catch(e=>{console.error(e);process.exit(1);});
