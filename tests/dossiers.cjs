// Dossiers locaux et tableau de bord sans données fictives. Même prérequis que browser.cjs.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('refusé','NotAllowedError');};navigator.geolocation.watchPosition=()=>0;navigator.geolocation.getCurrentPosition=(ok,fail)=>fail({code:1});});
    const url=(process.env.TEST_URL||'http://127.0.0.1:8877/')+'?verification=1';
    await page.goto(url);await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
    const body=await page.locator('#dashboard').innerText();
    for(const fake of ['Jean','Ormes','Dubois','Logisud','38'])assert.ok(!body.includes(fake),'Plus de donnée fictive : '+fake);
    assert.equal(await page.locator('#stat-dossiers').innerText(),'0');
    // Création d'un dossier depuis « Mes dossiers »
    await page.locator('.nav-item[data-view="dossiers"]').click();
    await page.locator('#new-dossier').click();
    await page.locator('#dossier-form [name=name]').fill('ZZ TEST Résidence');await page.locator('#dossier-form [name=reference]').fill('RG 99/1');
    assert.ok(await page.locator('#dossier-form [name=client]').isDisabled(),'Expertise judiciaire par défaut : client non saisissable');
    await page.locator('#dossier-form [name=type]').selectOption('Expertise privée');
    await page.locator('#dossier-form [name=client]').fill('Client fictif');await page.locator('#dossier-form button[type=submit]').click();
    await page.waitForFunction(()=>readDossiers().length===1&&document.querySelectorAll('.dossier-card').length===1);
    assert.match(await page.locator('#dossier-list').innerText(),/ZZ TEST Résidence/);
    assert.equal(await page.locator('#dossier-count').innerText(),'1');
    // Nouveau constat rattaché au dossier
    await page.locator('[data-dossier-visit]').click();
    await page.waitForFunction(()=>state.dossierId&&$('#inspection').classList.contains('active'));
    assert.equal(await page.inputValue('#case-name'),'ZZ TEST Résidence');assert.equal(await page.inputValue('#case-reference'),'RG 99/1');
    assert.equal(await page.inputValue('#case-dossier'),await page.evaluate(()=>state.dossierId));
    await page.locator('#save-draft').click();await page.waitForFunction(()=>!unsaved);
    // Création depuis l'étape 1 : le nouveau dossier est rattaché
    await page.locator('#picker-new-dossier').click();await page.locator('#dossier-form [name=name]').fill('ZZ TEST Entrepôt');await page.locator('#dossier-form button[type=submit]').click();
    await page.waitForFunction(()=>readDossiers().length===2&&dossierById(state.dossierId)?.name==='ZZ TEST Entrepôt');
    await page.locator('#picker-new-dossier').evaluate(()=>applyDossier(readDossiers().find(d=>d.name==='ZZ TEST Résidence').id));
    await page.waitForFunction(()=>!unsaved);
    // La sauvegarde JSON transporte le dossier
    assert.equal(await page.evaluate(()=>snapshot().dossier?.name),'ZZ TEST Résidence');
    // Liste des dossiers et reprise
    await page.locator('.nav-item[data-view="dossiers"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('#dossier-list [data-open-draft]').length===1);
    await page.locator('#dossier-list [data-open-draft]').click();
    await page.waitForFunction(()=>$('#inspection').classList.contains('active'));
    // Tableau de bord réel
    await page.locator('.nav-item[data-view="dashboard"]').click();
    assert.equal(await page.locator('#stat-dossiers').innerText(),'2');
    assert.match(await page.locator('#recent-dossiers').innerText(),/ZZ TEST Résidence/);
    // Suppression : les constats restent dans les brouillons
    await page.locator('.nav-item[data-view="dossiers"]').click();
    const drafts=await page.evaluate(async()=>(await listDrafts()).length);
    await page.locator('.dossier-card',{hasText:'ZZ TEST Résidence'}).locator('[data-dossier-delete]').click();
    await page.waitForFunction(()=>readDossiers().length===1);
    assert.equal(await page.evaluate(async()=>(await listDrafts()).length),drafts);
    // Rechargement : dossiers persistés
    await page.reload();await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
    assert.equal(await page.evaluate(()=>readDossiers().length),1);
    await page.evaluate(()=>importDossier({id:'backup-1',name:'ZZ TEST Import',status:'Clos'}));
    assert.equal(await page.evaluate(()=>dossierById('backup-1')?.status),'Clos','Une sauvegarde recrée son dossier');
    // Expertise judiciaire : aucun champ nominatif conservé, rapport HTML au modèle EJ
    await page.evaluate(()=>{const list=readDossiers();list.push({id:'ej-legacy',name:'ZZ TEST EJ',reference:'EJ26-9999',type:'Expertise judiciaire',client:'PARTIE_INTERDITE',address:'1 rue Test',status:'En cours'});localStorage.setItem(DOSSIER_KEY,JSON.stringify(list));});
    assert.equal(await page.evaluate(()=>dossierById('ej-legacy').client),'','Ancien client EJ ignoré');
    await page.evaluate(()=>startNewVisit('ej-legacy'));await page.waitForFunction(()=>state.caseType==='ej');
    assert.equal(await page.inputValue('#case-type'),'ej');assert.equal(await page.inputValue('#site-address'),'1 rue Test');
    assert.equal(await page.locator('#case-reference-label').innerText(),'Référence OPALEXE');assert.ok(await page.locator('#case-type-note').isVisible());
    await page.evaluate(()=>{state.clientName='PARTIE_INTERDITE';addPhoto('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','Vue générale',new Date().toISOString());});
    assert.equal(await page.evaluate(()=>snapshot().clientName),'','Snapshot EJ sans client');
    await page.evaluate(()=>{state.currentStep=4;renderStep();});
    assert.ok(!(await page.locator('[data-report-field="clientName"]').isVisible()),'Donneur d’ordre masqué en EJ');
    await page.locator('#report-presents').fill('Expert désigné\nDemandeur');
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-html').click()]);
    assert.equal(download.suggestedFilename(),'EJ26-9999_CONSTAT_'+await page.evaluate(()=>state.visitDate)+'.html');
    const html=require('node:fs').readFileSync(await download.path(),'utf8');
    assert.match(html,/data-nominatif="true">/);assert.match(html,/<td data-field="tribunal"><\/td>/);assert.match(html,/<li>Demandeur<\/li>/);assert.ok(!html.includes('PARTIE_INTERDITE'));
    await page.waitForFunction(()=>!unsaved);
    assert.equal(await page.evaluate(async()=>(await listDrafts()).find(d=>d.draftId===state.draftId).presents),'Expert désigné\nDemandeur');
    // Passage en expertise privée : champs client disponibles
    await page.evaluate(()=>{state.currentStep=1;renderStep();});await page.locator('#case-type').selectOption('ep');await page.waitForFunction(()=>state.caseType==='ep');
    await page.evaluate(()=>{state.currentStep=4;renderStep();});assert.ok(await page.locator('[data-report-field="clientName"]').isVisible());
    assert.deepEqual(errors,[]);
    console.log('PASS: dashboard without fictitious data, dossier create/edit/attach/delete, draft link, backup carries dossier, persistence, EJ without nominative data and HTML report');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
