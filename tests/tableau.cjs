// Tableaux de suivi (Excel OneDrive) → dossiers de l'application, sans Airtable : connexion OneDrive (OAuth, état à usage
// unique), lecture des .xlsx par Microsoft Graph (faux service local), seules les lignes « En cours » deviennent des dossiers
// (code et n° ; client et adresse hors expertise judiciaire), profil judiciaire = tableau EJ, profil privé = tableaux EP + conseil,
// dossier existant reconnu par sa référence, dossiers créés dans l'application conservés sur le serveur.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),http=require('node:http');
const PORT=8898,BASE=`http://127.0.0.1:${PORT}`,MS=8899,fixture=name=>fs.readFileSync(path.join(__dirname,'fixtures',name));
const FILES={'/EXPERT%20JUDICIAIRE/DOSSIERS/Dossiers%20en%20cours/Tableau_suivi_expertises.xlsx':fixture('tableau-suivi.xlsx'),
  '/EXPERTISES/Expertises%202026/Tableau_suivi_expertises_privees.xlsx':fixture('tableau-ep.xlsx'),'/DEV-CONSULT/Tableau_suivi_missions_conseil.xlsx':fixture('tableau-cs.xlsx')};
(async()=>{
  // Faux Microsoft : jetons OAuth (un jeu par compte) et Graph (métadonnées et contenu des fichiers).
  const ms={tokens:[],downloads:0,etag:'"v1"',access:new Set(),refresh:new Set(),uploads:[]};
  const fake=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(req.url.endsWith('/oauth2/v2.0/token')){const p=new URLSearchParams(body);ms.tokens.push(Object.fromEntries(p));
      if(p.get('grant_type')==='authorization_code'&&p.get('code')!=='CODE-OK')return json(400,{error:'invalid_grant'});
      if(p.get('grant_type')==='refresh_token'&&!ms.refresh.has(p.get('refresh_token')))return json(400,{error:'invalid_grant'});
      const n=ms.tokens.length;ms.access.add('acc-'+n);ms.refresh.add('ref-'+n);return json(200,{access_token:'acc-'+n,refresh_token:'ref-'+n,expires_in:61});}
    if(!ms.access.has(String(req.headers.authorization).replace('Bearer ','')))return json(401,{error:'bad token'});
    if(req.method==='PUT'){const u=/^\/v1\.0\/me\/drive\/root:(.+):\/content$/.exec(req.url);ms.uploads.push({path:decodeURIComponent(u[1]),size:Buffer.byteLength(body),type:req.headers['content-type'],body});return json(201,{id:'x'});}
    if(req.url.startsWith('/v1.0/me/drive/root:/EXPERT%20JUDICIAIRE/DOSSIERS/Dossiers%20en%20cours:/children'))return json(200,{value:[{name:'Tableau_suivi_expertises.xlsx',file:{}},{name:'AUTRE_MI26-01000_01-01-2026',folder:{}},{name:'NOUVEAU_TJ_MI26-0100_01-01-2026',folder:{}}]});
    const m=/^\/v1\.0\/me\/drive\/root:(.+?)(:\/content)?$/.exec(req.url),file=m&&FILES[m[1]];if(!file)return json(404,{error:'not found'});
    if(m[2]){ms.downloads++;res.writeHead(200,{'Content-Type':'application/octet-stream'});return res.end(file);}
    json(200,{eTag:ms.etag,lastModifiedDateTime:'2026-10-24T08:15:00Z'});});}).listen(MS);
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'constats-tableau-')),codes={};let log='';
  const users=[{id:'dev-ej',email:'expert.ej@example.com',name:'Expert TEST-EJ',role:'Expert judiciaire',status:'Actif'},{id:'dev-ep',email:'expert.ep@example.com',name:'Expert TEST-EP',role:'Expert',status:'Actif'}];
  const server=spawn(process.execPath,[path.join(__dirname,'../server/index.cjs')],{env:{...process.env,PORT:String(PORT),APP_ROOT:path.join(__dirname,'..'),APP_URL:BASE,SESSION_SECRET:'t'.repeat(40),
    DEV_USERS:JSON.stringify(users),DEV_PROJECTS:'[]',DEV_LOG_CODES:'1',DATA_DIR:dataDir,
    MS_CLIENT_ID:'client-test',MS_CLIENT_SECRET:'secret-test',MS_TENANT_ID:'tenant-test',GRAPH_API_URL:`http://127.0.0.1:${MS}/v1.0`,MS_LOGIN_URL:`http://127.0.0.1:${MS}`}});
  server.stdout.on('data',d=>{log+=d;for(const m of String(d).matchAll(/Code pour (\S+) : (\d{6})/g))codes[m[1]]=m[2];});server.stderr.on('data',d=>{log+=d;});
  for(let i=0;i<50&&!log.includes('port');i++)await new Promise(r=>setTimeout(r,100));
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true}),errors=[];
  async function login(email){const context=await browser.newContext({viewport:{width:1180,height:820}}),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.goto(BASE+'/');await page.waitForURL(/demarrer\.html/);
    await page.locator('#email').fill(email);await page.locator('#email-form button[type=submit]').click();await page.locator('#code').waitFor();
    for(let i=0;i<50&&!codes[email];i++)await page.waitForTimeout(100);
    await page.locator('#code').fill(codes[email]);await page.locator('#code-form button[type=submit]').click();
    await page.waitForURL(/index\.html/);await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);return page;}
  async function connect(page,profil){const go=await page.request.get(`${BASE}/api/microsoft/connexion?profil=${profil}`,{maxRedirects:0});assert.equal(go.status(),302);
    const auth=new URL(go.headers().location);return {auth,state:auth.searchParams.get('state')};}
  try{
    // ── Profil judiciaire ──
    const page=await login('expert.ej@example.com');
    // Dossier déjà présent sur l'appareil (ancienne clé Airtable) avec un constat rattaché
    await page.evaluate(()=>{writeDossiers([{id:'at-recANCIEN000001',name:'EJ26-0099_Villefictive',reference:'EJ26-0099',type:'Expertise judiciaire',status:'En cours',airtableId:'recANCIEN000001'}]);});
    // OneDrive pas encore connecté : lien « Connecter OneDrive », liste incomplète → aucun dossier retiré
    await page.evaluate(()=>syncDossiers());await page.waitForFunction(()=>!dossierSync.running&&dossierSync.tableau?.etat==='a-connecter');
    assert.equal(await page.evaluate(()=>readDossiers().length),1,'Rien n’est retiré tant que les tableaux n’ont pas été lus');
    await page.evaluate(()=>startNewVisit());await page.locator('#picker-search-tableau').waitFor();
    assert.match(await page.locator('[data-step="1"] .tableau-status').textContent(),/Connecter OneDrive/);
    // Connexion : droit de lecture seul, choix du compte, état signé à usage unique
    const {auth,state}=await connect(page,'dev-ej');
    assert.equal(auth.origin+auth.pathname,`http://127.0.0.1:${MS}/tenant-test/oauth2/v2.0/authorize`);
    assert.equal(auth.searchParams.get('scope'),'offline_access Files.ReadWrite');assert.equal(auth.searchParams.get('redirect_uri'),BASE+'/api/microsoft/retour');
    assert.equal(auth.searchParams.get('login_hint'),null,'Adresse du compte Constats non imposée');assert.equal(auth.searchParams.get('prompt'),'select_account');
    assert.match(await (await fetch(BASE+'/api/microsoft/retour?code=CODE-OK&state=x'+state)).text(),/non aboutie/,'État falsifié refusé');
    assert.match(await (await fetch(BASE+'/api/microsoft/retour?code=CODE-OK&state='+encodeURIComponent(state))).text(),/OneDrive connecté/,'Retour accepté sans cookie (iPad : ouvert hors de l’application)');
    assert.match(await (await fetch(BASE+'/api/microsoft/retour?code=CODE-OK&state='+encodeURIComponent(state))).text(),/non aboutie/,'État à usage unique');
    assert.equal((await fetch(BASE+'/api/microsoft/connexion?profil=dev-ej',{redirect:'manual'})).status,401,'Connexion refusée sans session');
    assert.ok(!fs.readFileSync(path.join(dataDir,'microsoft','dev-ej.json'),'utf8').includes('ref-'),'Jeton de renouvellement chiffré sur le serveur');
    // « Rechercher dans les tableaux de suivi » : dossiers « En cours » du tableau judiciaire seulement
    await page.click('#picker-search-tableau');await page.waitForFunction(()=>!dossierSync.running&&dossierSync.tableau?.etat==='ok');
    const t=await page.evaluate(()=>dossierSync.tableau);assert.equal(t.tableaux.length,1);assert.equal(t.tableaux[0].enCours,2);
    const dossiers=await page.evaluate(()=>readDossiers().map(d=>({id:d.id,name:d.name,reference:d.reference,status:d.status,type:d.type,client:d.client,address:d.address})).sort((a,b)=>a.name.localeCompare(b.name)));
    assert.deepEqual(dossiers.map(d=>d.name),['EJ26-0099_FICTIF','EJ26-0100_NOUVEAU-DOSSIER'],'Seules les expertises en cours ; rapport déposé et archivée absents');
    assert.equal(dossiers[0].id,'at-recANCIEN000001','Dossier existant reconnu par sa référence : même identifiant local (constats rattachés)');
    assert.ok(dossiers.every(d=>d.status==='En cours'&&d.type==='Expertise judiciaire'&&!d.client&&!d.address));
    assert.match(await page.locator('[data-step="1"] .tableau-status').textContent(),/2 expertises judiciaires en cours/);
    assert.ok(await page.locator('#case-dossier option',{hasText:'EJ26-0100_NOUVEAU-DOSSIER'}).count(),'Nouvelle expertise proposée dans la liste');
    assert.ok(!(await page.evaluate(()=>JSON.stringify(localStorage))).includes('PARTIE_SECRETE'),'Parties jamais reprises');
    assert.ok(!fs.readFileSync(path.join(dataDir,'dossiers','dev-ej.json'),'utf8').includes('PARTIE_SECRETE'),'Parties jamais conservées sur le serveur');
    // Fichier inchangé : pas de nouveau téléchargement à l'ouverture ; bouton : relecture forcée ; jeton renouvelé
    await page.waitForTimeout(1200);const downloads=ms.downloads;
    await page.request.get(BASE+'/api/projets?profil=dev-ej&tableau=force');assert.equal(ms.downloads,downloads+1,'Bouton : relecture forcée');
    assert.ok(ms.tokens.some(x=>x.grant_type==='refresh_token'),'Jeton d’accès renouvelé avec le jeton chiffré');
    const again=await (await page.request.get(BASE+'/api/projets?profil=dev-ej&tableau=1')).json();assert.equal(again.tableau.inchange,true);assert.equal(ms.downloads,downloads+1,'Ouverture : pas de relecture inutile');
    // Dossier créé dans l'application : conservé sur le serveur (hors tableau) ; un dossier du tableau ne se modifie pas ici
    await page.evaluate(()=>{saveDossier({name:'ZZ HORS TABLEAU',reference:'',type:'Expertise judiciaire',status:'En cours'});return syncDossiers();});
    await page.waitForFunction(()=>!dossierSync.running&&readDossiers().some(d=>d.name==='ZZ HORS TABLEAU'&&/^man-/.test(d.airtableId||'')));
    assert.ok(JSON.parse(fs.readFileSync(path.join(dataDir,'dossiers','dev-ej.json'),'utf8')).manuels.some(d=>d.name==='ZZ HORS TABLEAU'));
    const h={'Content-Type':'application/json',Origin:BASE};
    assert.equal((await page.request.patch(BASE+'/api/projets/tab-EJ26-0099',{headers:h,data:{profil:'dev-ej',name:'X'}})).status(),409,'Dossier du tableau : modification refusée');
    // Clôture en expertise judiciaire, ligne sans lien « Dossier OneDrive » : dossier retrouvé par son n° dans le dossier du tableau ;
    // pas de demande caméra / micro / position pour le constat vierge qui suit
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const ejDraft=await page.evaluate(async src=>{await startNewVisit(readDossiers().find(d=>d.name==='EJ26-0100_NOUVEAU-DOSSIER').id);addPhoto(src,'Vue générale',new Date().toISOString(),null,'import');saveVisit();return state.draftId;},png);
    await page.evaluate(()=>{state.currentStep=4;renderStep();});await page.click('#close-visit');
    for(let i=0;i<200&&!ms.uploads.some(u=>u.path.includes('NOUVEAU_TJ_MI26-0100')&&u.path.endsWith('.png'));i++)await page.waitForTimeout(100);
    assert.ok(ms.uploads.some(u=>/^\/EXPERT JUDICIAIRE\/DOSSIERS\/Dossiers en cours\/NOUVEAU_TJ_MI26-0100_01-01-2026\/CONSTATS\/[\d-]+\/EJ26-0100_CONSTAT_[\d-]+\.html$/.test(u.path)),'Rapport EJ rangé dans le dossier retrouvé par son n°');
    assert.equal(await page.evaluate(()=>visitAccess.attempted),false,'Aucune demande d’accès après la clôture');
    assert.ok(ejDraft);
    // Accès révoqué chez Microsoft : retour à « Connecter OneDrive », dernière lecture conservée
    ms.refresh.clear();await page.waitForTimeout(1200);
    const revoked=await (await page.request.get(BASE+'/api/projets?profil=dev-ej&tableau=force')).json();assert.equal(revoked.tableau.etat,'a-connecter');assert.equal(revoked.projets.length,3);assert.equal(revoked.complet,true);
    // ── Profil expertise privée : tableaux des expertises privées et des missions de conseil ──
    const ep=await login('expert.ep@example.com');
    const c=await connect(ep,'dev-ep');assert.match(await (await fetch(BASE+'/api/microsoft/retour?code=CODE-OK&state='+encodeURIComponent(c.state))).text(),/OneDrive connecté/);
    await ep.evaluate(()=>syncDossiers('force'));await ep.waitForFunction(()=>!dossierSync.running&&dossierSync.tableau?.etat==='ok');
    const priv=await ep.evaluate(()=>readDossiers().map(d=>({name:d.name,reference:d.reference,type:d.type,client:d.client,address:d.address})).sort((a,b)=>a.name.localeCompare(b.name)));
    assert.deepEqual(priv.map(d=>d.name),['CS26-001_GAMMA','EP26-001_ALPHA'],'En cours seulement ; code incomplet et statut vide ignorés ; aucun dossier judiciaire');
    assert.deepEqual(priv[1],{name:'EP26-001_ALPHA',reference:'EP26-001',type:'Expertise privée',client:'Client Alpha',address:'3 rue Fictive, Bordeaux'});
    assert.equal(priv[0].type,'Conseil / AMO');
    const store=JSON.parse(fs.readFileSync(path.join(dataDir,'dossiers','dev-ep.json'),'utf8'));
    assert.equal(store.tableaux.ep.rows[0].onedrive,'EXPERTISES/Expertises 2026/ALPHA Dossier','Dossier OneDrive (lien web) retenu sur le serveur');
    assert.equal(store.tableaux.cs.rows[0].onedrive,'DEV-CONSULT/GAMMA Dossier','Dossier OneDrive (lien relatif au tableau) retenu sur le serveur');
    assert.match(await ep.evaluate(()=>tableauMessage(dossierSync.tableau)),/1 expertises privées en cours, 1 missions de conseil en cours/);
    // ── Clôture d'un constat : rapport et photos rangés dans le dossier OneDrive de la mission ──
    const draftId=await ep.evaluate(async src=>{await startNewVisit(readDossiers().find(d=>d.name==='EP26-001_ALPHA').id);addPhoto(src,'Vue générale',new Date().toISOString(),null,'import');state.photos[0].description='Fissure';saveVisit();return state.draftId;},png);
    await ep.evaluate(()=>{state.currentStep=4;renderStep();});await ep.click('#close-visit');
    for(let i=0;i<200&&!ms.uploads.some(u=>u.path.includes('ALPHA Dossier')&&u.path.endsWith('.png'));i++)await ep.waitForTimeout(100);
    const day=await ep.evaluate(id=>listDrafts().then(l=>l.find(d=>d.draftId===id).visitDate),draftId),folder='/EXPERTISES/Expertises 2026/ALPHA Dossier/CONSTATS/'+day;
    const report=ms.uploads.find(u=>u.path.startsWith(folder+'/')&&u.path.endsWith('.html'));assert.ok(report,'Rapport HTML rangé dans le dossier de la mission');assert.match(report.body,/Fissure/);
    assert.ok(ms.uploads.some(u=>u.path===folder+'/Photos/Photo_01_Vue-generale.png'),'Photo rangée dans Photos/');
    let stored=false;for(let i=0;i<100&&!stored;i++){stored=await ep.evaluate(id=>listDrafts().then(l=>!!l.find(d=>d.draftId===id)?.storedInOneDrive&&!Object.keys(deposits()).length),draftId);if(!stored)await ep.waitForTimeout(100);}
    assert.ok(stored,'Constat marqué rangé ; rapport de clôture retiré de l’appareil');
    assert.ok(!(await ep.evaluate(id=>listDrafts().then(l=>'closureReport' in l.find(d=>d.draftId===id)),draftId)));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'constats','dev-ep',draftId+'.json'),'utf8')).onedrive.fichiers,2);
    // Constat rangé : absent de « Mes brouillons », présent dans son dossier (réouvrable) et dans « Rapports »
    await ep.evaluate(()=>renderDrafts());await ep.waitForTimeout(300);
    assert.equal(await ep.locator(`#draft-list [data-open-draft="${draftId}"],#draft-list [data-delete-draft="${draftId}"]`).count(),0,'Constat rangé retiré de « Mes brouillons »');
    assert.match(await ep.locator('#dossier-list').innerText(),/rangé dans OneDrive[\s\S]*Rouvrir pour compléter/);
    assert.equal(await ep.locator(`#report-list [data-open-report="${draftId}"]`).count(),1);assert.match(await ep.locator('#report-list').innerText(),/Rangé dans OneDrive le/);
    // ── Dossier passé « Terminé » dans le tableau : constat rangé effacé du serveur, puis de l'appareil ──
    FILES['/EXPERTISES/Expertises%202026/Tableau_suivi_expertises_privees.xlsx']=fixture('tableau-ep-termine.xlsx');ms.etag='"v2"';
    await ep.evaluate(()=>syncDossiers('force'));await ep.waitForFunction(()=>!dossierSync.running&&dossierSync.tableau?.etat==='ok'&&!readDossiers().some(d=>d.name==='EP26-001_ALPHA'));
    assert.ok(!fs.existsSync(path.join(dataDir,'constats','dev-ep',draftId+'.json')),'Constat du dossier terminé effacé du serveur');
    await ep.reload();await ep.waitForFunction(()=>typeof ready!=='undefined'&&ready);
    let gone=false;for(let i=0;i<150&&!gone;i++){gone=await ep.evaluate(async id=>!(await listDrafts()).some(d=>d.draftId===id),draftId).catch(()=>false);if(!gone)await ep.waitForTimeout(100);}
    assert.ok(gone,'Constat retiré de l’appareil');
    assert.equal(await ep.locator('[data-dossier-delete]').count(),0,'Aucune suppression de dossier dans l’application');
    assert.deepEqual(errors,[]);
    console.log('PASS: OneDrive connection (Files.ReadWrite scope, account choice, signed single-use state, encrypted refresh token), dossiers read directly from the tracking tables (no Airtable): EJ profile = EJ table, private profile = EP + consulting tables, « En cours » only, code/n° only for EJ, existing dossier re-keyed by reference, nothing removed before first read, manual dossiers kept on server, unchanged file not re-read, revoked access, report and photos stored in the mission OneDrive folder at closure (then out of drafts, still in dossier and reports), ended dossier cleans its stored constats (server and device), no dossier deletion in the app');
  }finally{await browser.close();server.kill();fake.close();}
})().catch(error=>{console.error(error);process.exit(1);});
