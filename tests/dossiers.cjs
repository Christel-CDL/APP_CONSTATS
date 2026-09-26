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
    await page.locator('#dossier-form [name=client]').fill('Tribunal fictif');await page.locator('#dossier-form button[type=submit]').click();
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
    assert.deepEqual(errors,[]);
    console.log('PASS: dashboard without fictitious data, dossier create/edit/attach/delete, draft link, backup carries dossier, persistence');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
