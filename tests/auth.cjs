// Contrôle d'accès : serveur de production (server/index.cjs) avec comptes fictifs, sans Airtable ni SMTP.
// Prérequis : npm ci dans server/ ; Playwright comme les autres tests. node tests/auth.cjs
const {chromium}=require('playwright');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const PORT=8899,BASE=`http://127.0.0.1:${PORT}`;
const users=[{id:'dev-ej',email:'expert.ej@example.com',name:'Expert TEST-EJ',organisation:'Cabinet fictif',role:'Expert judiciaire',status:'Actif'},
  {id:'dev-ep',email:'expert.ep@example.com',name:'Expert TEST-EP',organisation:'Cabinet fictif',role:'Expert',status:'Invité'},
  {id:'dev-off',email:'suspendu@example.com',name:'Compte suspendu',role:'Expert',status:'Suspendu'}];
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// Explorateur de fichiers (showSaveFilePicker) non pilotable par Playwright : ces tests vérifient le téléchargement classique.
async function noSavePicker(browser,options){const context=await browser.newContext(options);await context.addInitScript(()=>{delete window.showSaveFilePicker;});return context;}
(async()=>{
  const codes={};let log='';
  const projects=[{id:'dev-p90',owner:'dev-ej',fields:{'Nom du projet':'ZZ EJ AIRTABLE','Référence':'EJ26-0099','Type':{name:'Expertise judiciaire'},'Client / Juridiction':'PARTIE_SECRETE','Commune':'Villefictive','Statut':{name:'En cours'}}},
    {id:'dev-p91',owner:'dev-ej',fields:{'Nom du projet':'ZZ EP DU MAUVAIS PROFIL','Type':{name:'Expertise amiable'}}},
    {id:'dev-p92',owner:'dev-ep',fields:{'Nom du projet':'ZZ EP AIRTABLE','Type':{name:'Expertise amiable'},'Client / Juridiction':'Client EP visible'}}];
  const server=spawn(process.execPath,[path.join(__dirname,'../server/index.cjs')],{env:{...process.env,PORT:String(PORT),APP_ROOT:path.join(__dirname,'..'),APP_URL:BASE,SESSION_SECRET:'x'.repeat(40),DATA_DIR:fs.mkdtempSync(path.join(require('node:os').tmpdir(),'constats-')),DEV_USERS:JSON.stringify(users),DEV_PROJECTS:JSON.stringify(projects),DEV_LOG_CODES:'1'}});
  server.stdout.on('data',d=>{log+=d;for(const m of String(d).matchAll(/Code pour (\S+) : (\d{6})/g))codes[m[1]]=m[2];});server.stderr.on('data',d=>{log+=d;});
  for(let i=0;i<50&&!log.includes('port');i++)await new Promise(r=>setTimeout(r,100));
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
  try{
    // Accès sans session
    const plain=async(p,opts)=>fetch(BASE+p,{redirect:'manual',...opts});
    assert.equal((await plain('/')).status,302);assert.equal((await plain('/index.html')).headers.get('location'),'/demarrer.html');
    assert.equal((await plain('/field-app.js')).status,401);assert.equal((await plain('/icons/icon-192.png')).status,200);assert.equal((await plain('/demarrer.html')).status,200);
    assert.equal((await plain('/server/index.cjs')).status,404);assert.notEqual((await plain('/../package.json')).status,200);
    const head=(await plain('/demarrer.html')).headers;assert.match(head.get('content-security-policy'),/script-src 'self'/);assert.equal(head.get('x-robots-tag'),'noindex, nofollow');
    const ask=email=>plain('/api/auth/request',{method:'POST',headers:{'Content-Type':'application/json',Origin:BASE},body:JSON.stringify({email})});
    assert.equal((await ask('inconnu@example.com')).status,200,'Réponse identique pour un compte inconnu');assert.equal(codes['inconnu@example.com'],undefined);
    assert.equal((await ask('suspendu@example.com')).status,200);assert.equal(codes['suspendu@example.com'],undefined,'Aucun code pour un compte suspendu');
    assert.equal((await plain('/api/auth/request',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://pirate.example'},body:'{}'})).status,403);
    // Code faux : 5 essais puis invalidation
    await ask('expert.ep@example.com');const verify=(email,code)=>plain('/api/auth/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,code})});
    for(let i=0;i<6;i++)assert.equal((await verify('expert.ep@example.com','000000')).status,401);
    assert.equal((await verify('expert.ep@example.com',codes['expert.ep@example.com'])).status,401,'Code invalidé après trop d’essais');

    const context=await noSavePicker(browser,{viewport:{width:1280,height:900},acceptDownloads:true});const page=await context.newPage(),problems=[];
    page.on('pageerror',e=>problems.push(e.message));page.on('console',m=>{if(/Content Security Policy|Refused to/i.test(m.text()))problems.push(m.text());});page.on('dialog',d=>d.accept());
    // Anciens constats de l'appareil (avant les comptes) : proposés au premier profil
    await page.goto(BASE+'/demarrer.html');
    await page.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('constat-visits',2);req.onupgradeneeded=()=>{req.result.createObjectStore('visits');req.result.createObjectStore('drafts');};req.onsuccess=()=>{const tx=req.result.transaction('drafts','readwrite');tx.objectStore('drafts').put({version:2,draftId:'legacy-1',savedAt:new Date().toISOString(),subjects:['Vue générale'],photos:[],actions:[],caseName:'ZZ ANCIEN CONSTAT'},'legacy-1');tx.oncomplete=()=>{req.result.close();resolve();};tx.onerror=reject;};req.onerror=reject;}));
    await page.evaluate(()=>localStorage.setItem('constat-dossiers',JSON.stringify([{id:'old-1',name:'ZZ ANCIEN DOSSIER',type:'Autre',status:'En cours'}])));
    // Connexion profil judiciaire
    await page.goto(BASE+'/');await page.waitForURL(/demarrer\.html/);
    await page.locator('#email').fill('expert.ej@example.com');await page.locator('#email-form button[type=submit]').click();
    await page.locator('#code').waitFor();await page.waitForFunction(()=>true);for(let i=0;i<30&&!codes['expert.ej@example.com'];i++)await page.waitForTimeout(100);
    await page.locator('#code').fill(codes['expert.ej@example.com']);await page.locator('#code-form button[type=submit]').click();
    await page.waitForURL(/index\.html/);await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
    assert.equal(await page.evaluate(()=>PROFILE.id),'dev-ej');assert.match(await page.locator('#profile-name').innerText(),/TEST-EJ/);
    assert.ok(await page.evaluate(async()=>(await listDrafts()).some(d=>d.draftId==='legacy-1')),'Anciens constats copiés dans le profil');
    assert.ok(await page.evaluate(()=>readDossiers().some(d=>d.name==='ZZ ANCIEN DOSSIER')));
    assert.deepEqual(await page.evaluate(()=>[...$('#case-type').options].filter(o=>!o.disabled).map(o=>o.value)),['ej','autre'],'Profil judiciaire : EJ et constat');
    // Dossiers Airtable : récupérés pour ce profil, sans client en expertise judiciaire, sans les dossiers d'un autre type
    await page.waitForFunction(()=>readDossiers().some(d=>d.airtableId==='dev-p90'));
    const synced=await page.evaluate(()=>readDossiers().find(d=>d.airtableId==='dev-p90'));assert.equal(synced.reference,'EJ26-0099');assert.equal(synced.client,'');assert.equal(synced.type,'Expertise judiciaire');
    assert.ok(!(await page.evaluate(()=>readDossiers().some(d=>d.airtableId==='dev-p91'))),'Dossier privé absent du profil judiciaire');
    const raw=await page.evaluate(()=>fetch('/api/projets?profil=dev-ej').then(r=>r.text()));assert.ok(!raw.includes('PARTIE_SECRETE'),'Client/juridiction EJ jamais transmis');
    assert.equal(await page.evaluate(()=>fetch('/api/projets?profil=dev-ep').then(r=>r.status)),401,'Profil non connecté : accès refusé');
    assert.equal(await page.evaluate(()=>fetch('/api/projets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profil:'dev-ej',name:'X',type:'Expertise privée'})}).then(r=>r.status)),403,'Type hors profil refusé');
    // Nouveau dossier créé dans l'application → enregistré dans Airtable
    await page.locator('.nav-item[data-view="dossiers"]').click();await page.locator('#new-dossier').click();
    await page.locator('#dossier-form [name=name]').fill('ZZ NOUVEAU EJ');await page.locator('#dossier-form [name=reference]').fill('EJ26-0100');await page.locator('#dossier-form button[type=submit]').click();
    await page.waitForFunction(()=>{const d=readDossiers().find(x=>x.name==='ZZ NOUVEAU EJ');return d&&d.airtableId&&!d.pendingSync;});
    assert.ok((await page.evaluate(()=>fetch('/api/projets?profil=dev-ej').then(r=>r.json()))).projets.some(p=>p.name==='ZZ NOUVEAU EJ'&&p.reference==='EJ26-0100'));
    assert.match(await page.locator('#dossier-sync').innerText(),/Synchronisé avec Airtable/);
    // Parcours et exports sous la politique de sécurité du contenu
    await page.evaluate(png=>{saveDossier({name:'ZZ DOSSIER EJ',reference:'EJ26-0001',type:'Expertise judiciaire',address:'1 rue Test'});startNewVisit(readDossiers().find(d=>d.name==='ZZ DOSSIER EJ').id);},png);
    await page.waitForFunction(()=>state.caseType==='ej');await page.evaluate(png=>{addPhoto(png,'Vue générale',new Date().toISOString());state.currentStep=4;renderStep();},png);
    for(const button of ['#export-html','#generate-report','#export-pdf']){const [d]=await Promise.all([page.waitForEvent('download'),page.locator(button).click()]);assert.ok(fs.statSync(await d.path()).size>500,button);}
    await page.locator('#save-draft').click();await page.waitForFunction(()=>!unsaved);
    // Second profil (privé) sur le même appareil, puis choix au lancement
    await page.goto(BASE+'/demarrer.html?choisir');await page.locator('#add-profile').click();
    await ask('expert.ep@example.com');// renvoi d'un code neuf (l'ancien est invalidé)
    await page.locator('#email').fill('expert.ep@example.com');await page.locator('#email-form button[type=submit]').click();await page.locator('#code').waitFor();
    for(let i=0;i<30;i++){await page.waitForTimeout(100);}
    await page.locator('#code').fill(codes['expert.ep@example.com']);await page.locator('#code-form button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.profile').length===2);
    await page.locator('.profile',{hasText:'TEST-EP'}).locator('button.open').click();await page.waitForURL(/index\.html/);await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
    assert.equal(await page.evaluate(()=>PROFILE.id),'dev-ep');
    assert.ok(!(await page.evaluate(()=>readDossiers().some(d=>d.name==='ZZ DOSSIER EJ'))),'Données du profil judiciaire invisibles');
    assert.ok(!(await page.evaluate(async()=>(await listDrafts()).some(d=>d.caseReference==='EJ26-0001'))));
    assert.deepEqual(await page.evaluate(()=>[...$('#case-type').options].filter(o=>!o.disabled).map(o=>o.value)),['ep','autre']);
    await page.waitForFunction(()=>readDossiers().some(d=>d.airtableId==='dev-p92'));assert.equal(await page.evaluate(()=>readDossiers().find(d=>d.airtableId==='dev-p92').client),'Client EP visible');
    // Relancement : choix du profil demandé
    await page.evaluate(()=>sessionStorage.clear());await page.goto(BASE+'/index.html');await page.waitForURL(/demarrer\.html/);await page.waitForFunction(()=>document.querySelectorAll('.profile').length===2);
    // Déconnexion d'un profil
    await page.locator('.profile',{hasText:'TEST-EP'}).locator('.logout').click();await page.waitForFunction(()=>document.querySelector('#status').textContent!==''||true);
    await page.waitForURL(/index\.html/);// un seul profil restant : ouverture directe
    const me=await page.evaluate(()=>fetch('/api/me').then(r=>r.json()));assert.deepEqual(me.profiles.map(p=>p.id),['dev-ej']);
    assert.deepEqual(problems,[],'Aucune erreur ni blocage CSP');
    console.log('PASS: access control (redirects, 401, public assets, CSP), e-mail code login, anti-enumeration, suspended account, brute force, legacy data copy, two profiles with isolated data and mission types, launcher choice, logout, exports under CSP, Airtable dossiers (per profile, no EJ client, create/sync, cross-profile refusal)');
  }finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exit(1);});
