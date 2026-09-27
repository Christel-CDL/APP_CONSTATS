// Parcours navigateur PV de réception puis PV de levée des réserves (expertise privée). Même prérequis que dossiers.cjs.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
(async()=>{
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
  try{
    const page=await (await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true})).newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('refusé','NotAllowedError');};navigator.geolocation.watchPosition=()=>0;navigator.geolocation.getCurrentPosition=(ok,fail)=>fail({code:1});});
    await page.goto((process.env.TEST_URL||'http://127.0.0.1:8877/')+'?verification=1');await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
    const step=n=>page.evaluate(n=>{state.currentStep=n;renderStep();},n);
    // Dossier privé et constat de réception
    await page.evaluate(()=>saveDossier({name:'ZZ TEST Module',reference:'EP26-900',type:'Expertise privée',client:'M. FICTIF',address:'1 rue Test'}));
    await page.evaluate(()=>startNewVisit(readDossiers().find(d=>d.name==='ZZ TEST Module').id));await page.waitForFunction(()=>state.caseType==='ep');
    assert.ok(await page.locator('#pv-document').isVisible(),'Choix du document en expertise privée');
    await page.locator('#pv-document').selectOption('reception');
    await page.evaluate(png=>{addPhoto(png,'Vue générale',new Date().toISOString());addSubject('Salle de bain');addPhoto(png,'Salle de bain',new Date().toISOString());state.photos[1].description='Receveur en contrepente';},png);
    await step(4);assert.ok(await page.locator('#pv-editor').isVisible());assert.ok(!(await page.locator('[data-report-field="conclusions"]').isVisible()),'Conclusions du rapport masquées en mode PV');
    assert.equal(await page.inputValue('[data-pv="ownerName"]'),'M. FICTIF','MOA repris du donneur d’ordre');
    await page.locator('[data-pv="companyName"]').fill('ENTREPRISE FICTIVE');await page.locator('[data-pv="effectDate"]').fill('2026-01-15');
    await page.locator('[data-pv-command="from-photos"]').click();await page.waitForFunction(()=>state.pv.reserves.length===2);
    assert.equal(await page.inputValue('.pv-reserve >> nth=1 >> [data-pv-item="defect"]'),'Receveur en contrepente');
    await page.locator('.pv-reserve >> nth=0 >> [data-pv-item="deadline"]').fill('Sous 1 mois');
    await page.locator('#pv-editor [data-pv-list="doe"] >> nth=0 >> [data-pv-item="provided"]').check();
    const [html]=await Promise.all([page.waitForEvent('download'),page.locator('#export-html').click()]);
    assert.match(html.suggestedFilename(),/^EP26-900_PV-RECEPTION_\d{4}-\d{2}-\d{2}\.html$/);
    const content=fs.readFileSync(await html.path(),'utf8');assert.match(content,/ENTREPRISE FICTIVE/);assert.match(content,/Sous 1 mois/);assert.match(content,/☒ Plans/);
    const [word]=await Promise.all([page.waitForEvent('download'),page.locator('#export-pv-word').click()]);assert.match(word.suggestedFilename(),/_PV-RECEPTION_.*\.docx$/);assert.ok(fs.statSync(await word.path()).size>5000);
    await page.locator('#save-draft').click();await page.waitForFunction(()=>!unsaved);
    const receptionId=await page.evaluate(()=>state.draftId);
    assert.equal(await page.evaluate(async id=>(await listDrafts()).find(d=>d.draftId===id).pv.reserves.length,receptionId),2,'PV enregistré avec le constat');
    // Nouveau constat du même dossier : PV de levée repris du PV de réception
    await page.evaluate(()=>startNewVisit(readDossiers().find(d=>d.name==='ZZ TEST Module').id));await page.waitForFunction(id=>state.draftId!==id,receptionId);
    await page.locator('#pv-document').selectOption('levee');await step(4);
    await page.waitForFunction(()=>$('#pv-import-source option')?.value&&$('#pv-import-source option').value!=='');
    await page.locator('[data-pv-command="import"]').click();await page.waitForFunction(()=>state.pv.reserves.length===2&&state.pv.document==='levee');
    assert.equal(await page.evaluate(()=>state.pv.companyName),'ENTREPRISE FICTIVE');assert.equal(await page.evaluate(()=>state.pv.receptionDate),'2026-01-15');
    await page.locator('.pv-reserve >> nth=0 >> [data-pv-item="status"]').selectOption('levee');await page.waitForFunction(()=>state.pv.reserves[0].leveeDate===state.visitDate);
    await page.locator('.pv-reserve >> nth=1 >> [data-pv-item="status"]').selectOption('non-levee');
    const [levee]=await Promise.all([page.waitForEvent('download'),page.locator('#export-html').click()]);
    assert.match(levee.suggestedFilename(),/_PV-LEVEE-RESERVES_/);const leveeHtml=fs.readFileSync(await levee.path(),'utf8');
    assert.match(leveeHtml,/Annexe au procès-verbal de réception du 15\/01\/2026/);assert.match(leveeHtml,/1 réserve\(s\) levée\(s\) sur 2/);assert.match(leveeHtml,/Non levée/);
    // Passage en expertise judiciaire : le PV (données nominatives) est effacé
    await step(1);await page.locator('#case-type').selectOption('ej');await page.waitForFunction(()=>state.caseType==='ej');
    assert.equal(await page.evaluate(()=>snapshot().pv.companyName),'');assert.ok(!(await page.locator('#pv-document').isVisible()));
    await page.reload();await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
    assert.equal(await page.evaluate(async id=>(await listDrafts()).find(d=>d.draftId===id).pv.document,receptionId),'reception','PV de réception conservé après rechargement');
    assert.deepEqual(errors,[]);
    console.log('PASS: EP PV de réception (reserves from photos, HTML/Word), saved with visit, PV de levée carried over from reception, statuses, EJ drops PV data');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
