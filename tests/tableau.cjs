// Tableau de suivi des expertises (Excel OneDrive) → dossiers : connexion OneDrive (OAuth, état à usage unique),
// lecture du .xlsx par Microsoft Graph (faux service local), import du code et du n° des seules expertises « En cours »
// (les autres sont retirées d'Airtable et de l'appareil),
// lecture automatique à l'ouverture du profil judiciaire et bouton « Rechercher dans le tableau de suivi ».
const {chromium}=require('playwright');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),http=require('node:http');
const PORT=8898,BASE=`http://127.0.0.1:${PORT}`,MS=8899,XLSX=fs.readFileSync(path.join(__dirname,'fixtures/tableau-suivi.xlsx'));
(async()=>{
  // Faux Microsoft : jetons OAuth et Graph (métadonnées et contenu du fichier).
  const ms={tokens:[],downloads:0,etag:'"v1"',access:'acc-0',refresh:'ref-0'};
  const fake=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(req.url.endsWith('/oauth2/v2.0/token')){const p=new URLSearchParams(body);ms.tokens.push(Object.fromEntries(p));
      if(p.get('grant_type')==='authorization_code'&&p.get('code')!=='CODE-OK')return json(400,{error:'invalid_grant'});
      if(p.get('grant_type')==='refresh_token'&&p.get('refresh_token')!==ms.refresh)return json(400,{error:'invalid_grant'});
      const n=ms.tokens.length;ms.access='acc-'+n;ms.refresh='ref-'+n;return json(200,{access_token:ms.access,refresh_token:ms.refresh,expires_in:61});}
    if(req.headers.authorization!=='Bearer '+ms.access)return json(401,{error:'bad token'});
    const file='/v1.0/me/drive/root:/EXPERT%20JUDICIAIRE/DOSSIERS/Dossiers%20en%20cours/Tableau_suivi_expertises.xlsx';
    if(req.url===file)return json(200,{eTag:ms.etag,lastModifiedDateTime:'2026-10-24T08:15:00Z'});
    if(req.url===file+':/content'){ms.downloads++;res.writeHead(200,{'Content-Type':'application/octet-stream'});return res.end(XLSX);}
    json(404,{error:'not found'});});}).listen(MS);
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'constats-tableau-')),codes={};let log='';
  const users=[{id:'dev-ej',email:'expert.ej@example.com',name:'Expert TEST-EJ',role:'Expert judiciaire',status:'Actif'}];
  const projects=[{id:'dev-p90',owner:'dev-ej',fields:{'Nom du projet':'EJ26-0099_Villefictive','Référence':'EJ26-0099','Type':{name:'Expertise judiciaire'},'Statut':{name:'En attente'}}},
    {id:'dev-p91',owner:'dev-ej',fields:{'Code Constats':'EJ25-0007_DEPOSE','Référence':'EJ25-0007','Type':{name:'Expertise judiciaire'},'Statut':{name:'En cours'}}}];
  const server=spawn(process.execPath,[path.join(__dirname,'../server/index.cjs')],{env:{...process.env,PORT:String(PORT),APP_ROOT:path.join(__dirname,'..'),APP_URL:BASE,SESSION_SECRET:'t'.repeat(40),
    DEV_USERS:JSON.stringify(users),DEV_PROJECTS:JSON.stringify(projects),DEV_LOG_CODES:'1',DATA_DIR:dataDir,
    MS_CLIENT_ID:'client-test',MS_CLIENT_SECRET:'secret-test',MS_TENANT_ID:'tenant-test',GRAPH_API_URL:`http://127.0.0.1:${MS}/v1.0`,MS_LOGIN_URL:`http://127.0.0.1:${MS}`}});
  server.stdout.on('data',d=>{log+=d;for(const m of String(d).matchAll(/Code pour (\S+) : (\d{6})/g))codes[m[1]]=m[2];});server.stderr.on('data',d=>{log+=d;});
  for(let i=0;i<50&&!log.includes('port');i++)await new Promise(r=>setTimeout(r,100));
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true}),errors=[];
  try{
    const context=await browser.newContext({viewport:{width:1180,height:820}}),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto(BASE+'/');await page.waitForURL(/demarrer\.html/);
    await page.locator('#email').fill('expert.ej@example.com');await page.locator('#email-form button[type=submit]').click();await page.locator('#code').waitFor();
    for(let i=0;i<50&&!codes['expert.ej@example.com'];i++)await page.waitForTimeout(100);
    await page.locator('#code').fill(codes['expert.ej@example.com']);await page.locator('#code-form button[type=submit]').click();
    await page.waitForURL(/index\.html/);await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
    await page.waitForFunction(()=>readDossiers().some(d=>d.airtableId==='dev-p91'));
    // OneDrive pas encore connecté : lien « Connecter OneDrive » à côté du choix du dossier
    await page.waitForFunction(()=>dossierSync.tableau?.etat==='a-connecter');
    await page.evaluate(()=>startNewVisit());await page.locator('#picker-search-tableau').waitFor();
    assert.match(await page.locator('[data-step="1"] .tableau-status').textContent(),/Connecter OneDrive/);
    // Connexion : redirection vers Microsoft (droit de lecture seul), retour avec un état signé à usage unique
    const go=await page.request.get(BASE+'/api/microsoft/connexion?profil=dev-ej',{maxRedirects:0});assert.equal(go.status(),302);
    const auth=new URL(go.headers().location);assert.equal(auth.origin+auth.pathname,`http://127.0.0.1:${MS}/tenant-test/oauth2/v2.0/authorize`);
    assert.equal(auth.searchParams.get('scope'),'offline_access Files.Read');assert.equal(auth.searchParams.get('redirect_uri'),BASE+'/api/microsoft/retour');
    const state=auth.searchParams.get('state');
    assert.match(await (await fetch(BASE+'/api/microsoft/retour?code=CODE-OK&state=x'+state)).text(),/non aboutie/,'État falsifié refusé');
    assert.match(await (await fetch(BASE+'/api/microsoft/retour?code=CODE-OK&state='+encodeURIComponent(state))).text(),/OneDrive connecté/,'Retour accepté sans cookie (iPad : ouvert hors de l’application)');
    assert.match(await (await fetch(BASE+'/api/microsoft/retour?code=CODE-OK&state='+encodeURIComponent(state))).text(),/non aboutie/,'État à usage unique');
    assert.equal((await fetch(BASE+'/api/microsoft/connexion?profil=dev-ej',{redirect:'manual'})).status,401,'Connexion refusée sans session');
    const stored=fs.readFileSync(path.join(dataDir,'microsoft','dev-ej.json'),'utf8');assert.ok(!stored.includes('ref-'),'Jeton de renouvellement chiffré sur le serveur');
    // « Rechercher dans le tableau de suivi » : dossiers créés ou mis à jour, sans donnée nominative autre que le code
    await page.click('#picker-search-tableau');await page.waitForFunction(()=>!dossierSync.running&&dossierSync.tableau?.etat==='ok');
    const t=await page.evaluate(()=>dossierSync.tableau);assert.equal(t.ajoutes,1);assert.equal(t.misAJour,1);assert.equal(t.retires,1);assert.equal(t.lignes,4);
    const dossiers=await page.evaluate(()=>readDossiers().map(d=>({name:d.name,reference:d.reference,status:d.status,type:d.type})).sort((a,b)=>a.name.localeCompare(b.name)));
    assert.deepEqual(dossiers.map(d=>d.name),['EJ26-0099_FICTIF','EJ26-0100_NOUVEAU-DOSSIER'],'Seules les expertises en cours ; rapport déposé retiré, archivée jamais ajoutée');
    assert.deepEqual(dossiers.map(d=>d.reference),['EJ26-0099','EJ26-0100']);
    assert.ok(dossiers.every(d=>d.status==='En cours'&&d.type==='Expertise judiciaire'));
    assert.match(await page.locator('[data-step="1"] .tableau-status').textContent(),/1 expertise\(s\) ajoutée\(s\), 1 mise\(s\) à jour, 1 terminée\(s\) ou en attente retirée\(s\)/);
    assert.ok(await page.locator('#case-dossier option',{hasText:'EJ26-0100_NOUVEAU-DOSSIER'}).count(),'Nouvelle expertise proposée dans la liste');
    assert.ok(!(await page.evaluate(()=>JSON.stringify(localStorage))).includes('PARTIE_SECRETE'),'Parties jamais reprises');
    // Ouverture suivante (lecture automatique) : fichier inchangé → pas de nouveau téléchargement ; jeton renouvelé
    await page.waitForTimeout(1200);const downloads=ms.downloads;
    await page.request.get(BASE+'/api/projets?profil=dev-ej&tableau=force');assert.equal(ms.downloads,downloads+1,'Bouton : relecture forcée');
    assert.ok(ms.tokens.some(x=>x.grant_type==='refresh_token'),'Jeton d’accès renouvelé avec le jeton chiffré');
    const again=await (await page.request.get(BASE+'/api/projets?profil=dev-ej&tableau=1')).json();assert.equal(again.tableau.inchange,true);assert.equal(ms.downloads,downloads+1,'Ouverture : pas de relecture inutile');
    // Accès révoqué chez Microsoft : retour à « Connecter OneDrive », sans erreur bloquante
    ms.refresh='revoque';await page.waitForTimeout(1200);
    const revoked=await (await page.request.get(BASE+'/api/projets?profil=dev-ej&tableau=force')).json();assert.equal(revoked.tableau.etat,'a-connecter');assert.equal(revoked.projets.length,2);
    assert.deepEqual(errors,[]);
    console.log('PASS: OneDrive connection (read-only scope, signed single-use state, encrypted refresh token), xlsx read via Graph, only « En cours » kept, others removed (Airtable and device), code/n° only (no parties), search button, auto read skipped when unchanged, revoked access');
  }finally{await browser.close();server.kill();fake.close();}
})().catch(error=>{console.error(error);process.exit(1);});
