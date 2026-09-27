// Parcours navigateur PV de réception puis PV de levée des réserves (expertise privée). Même prérequis que dossiers.cjs.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// Explorateur de fichiers (showSaveFilePicker) non pilotable par Playwright : ces tests vérifient le téléchargement classique.
async function noSavePicker(browser,options){const context=await browser.newContext(options);await context.addInitScript(()=>{delete window.showSaveFilePicker;});return context;}
(async()=>{
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
  try{
    const page=await (await noSavePicker(browser,{viewport:{width:1280,height:900},acceptDownloads:true})).newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.accept();});
    const draw=async()=>{const box=await page.locator('#signature-canvas').boundingBox();await page.mouse.move(box.x+30,box.y+40);await page.mouse.down();await page.mouse.move(box.x+120,box.y+90,{steps:8});await page.mouse.move(box.x+220,box.y+30,{steps:8});await page.mouse.up();await page.locator('#save-signature').click();};
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
    // Signatures au doigt / stylet : maître d'ouvrage, puis modification du PV → signature invalidée
    await page.locator('[data-sign="owner"]').click();await draw();await page.waitForFunction(()=>!!state.pv.signatures.owner?.image);
    await page.locator('[data-pv="amountTotal"]').fill('10 000 € TTC');
    dialogs.length=0;await page.locator('#export-html').click();await page.waitForTimeout(300);assert.ok(dialogs.some(m=>/modifié après la signature/.test(m)),'Export bloqué après modification');
    await page.locator('[data-sign="owner"]').first().click();await draw();
    await page.locator('#expert-signs').check();assert.ok(await page.locator('#expert-signature').isVisible(),'Signature expert ouverte par la case');
    dialogs.length=0;await page.locator('#export-html').click();await page.waitForTimeout(300);assert.ok(dialogs.some(m=>/signature d’expert/.test(m)),'Case cochée sans signature : export bloqué');
    await page.locator('[data-sign="expert"]').click();await draw();await page.waitForFunction(()=>!!state.expertSignature?.image);
    const [signed]=await Promise.all([page.waitForEvent('download'),page.locator('#export-html').click()]);const signedHtml=fs.readFileSync(await signed.path(),'utf8');
    assert.match(signedHtml,/data-field="signature_moa" src="data:image\/png/);assert.match(signedHtml,/data-field="signature_expert" src="data:image\/png/);assert.match(signedHtml,/Signé électroniquement le/);
    const [signedWord]=await Promise.all([page.waitForEvent('download'),page.locator('#export-pv-word').click()]);assert.ok(fs.statSync(await signedWord.path()).size>5000);
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
    // Passage en expertise judiciaire : données non exportées → sauvegarde JSON téléchargée avant effacement
    await page.locator('[data-pv="balanceComment"]').fill('Modification non exportée');
    await step(1);const backup=page.waitForEvent('download');await page.locator('#case-type').selectOption('ej');await page.waitForFunction(()=>state.caseType==='ej');
    const saved=await backup;assert.match(saved.suggestedFilename(),/sauvegarde-avant-effacement/);assert.equal(JSON.parse(fs.readFileSync(await saved.path(),'utf8')).pv.balanceComment,'Modification non exportée','Sauvegarde complète avant effacement');
    assert.equal(await page.evaluate(()=>snapshot().pv.companyName),'');assert.ok(!(await page.locator('#pv-document').isVisible()));
    await page.reload();await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
    assert.equal(await page.evaluate(async id=>(await listDrafts()).find(d=>d.draftId===id).pv.document,receptionId),'reception','PV de réception conservé après rechargement');
    // Constat simple avec suites à donner (expertise privée)
    await page.evaluate(()=>startNewVisit(readDossiers().find(d=>d.name==='ZZ TEST Module').id));await page.waitForFunction(()=>state.caseType==='ep'&&!state.photos.length);
    await page.locator('#pv-document').selectOption('simple');await page.evaluate(png=>addPhoto(png,'Vue générale',new Date().toISOString()),png);
    await page.evaluate(()=>{$('#action-list').innerHTML='';addAction({type:'Demander une pièce',text:'Transmettre le DOE',recipient:'Entreprise',date:'2026-10-15'});});
    await step(4);assert.ok(!(await page.locator('#pv-editor').isVisible()));assert.ok(!(await page.locator('[data-report-field="missionDetail"]').isVisible()));
    const [simple]=await Promise.all([page.waitForEvent('download'),page.locator('#export-html').click()]);assert.match(simple.suggestedFilename(),/_CONSTAT-SIMPLE_/);
    const simpleHtml=fs.readFileSync(await simple.path(),'utf8');assert.match(simpleHtml,/Constat de visite/);assert.match(simpleHtml,/Suites à donner demandées/);assert.match(simpleHtml,/Transmettre le DOE/);assert.match(simpleHtml,/15\/10\/2026/);assert.ok(!simpleHtml.includes('data-field="conclusions"'));
    assert.deepEqual(errors,[]);
    console.log('PASS: EP PV de réception (reserves from photos, HTML/Word), saved with visit, PV de levée carried over from reception, statuses, signatures (party/expert, invalidated after change), backup before erasing, EJ drops PV data, simple constat with follow-ups');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
