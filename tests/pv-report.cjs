// Procès-verbaux de réception et de levée des réserves (expertise privée). Node seul : node tests/pv-report.cjs
// Prérequis : docx 9.6.1 et jszip (voir tests/README.md). Données entièrement fictives.
const assert=require('node:assert/strict'),JSZip=require('jszip');
const {buildPvHtml,buildPvWord,normalizePv,reservesFromPhotos,pvForLevee,pvFileName,pvSummary}=require('../pv-report');
const {CDL_LOGO}=require('../report-logo');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
(async()=>{
  const photos=[1,2,3].map(n=>({number:n,subject:n<3?'Extérieur':'Salle de bain',src:png,description:'Désordre photo '+n,comment:'',transcript:'',drawing:'',include:{},imageWidth:1,imageHeight:1}));
  const pv=normalizePv({document:'reception',companyName:'ENTREPRISE FICTIVE SAS',companyAddress:'1 rue de l’Essai\n00000 VILLE',companyRcs:'RCS 000 000 000',companyRepresentative:'M. Test, directeur travaux',ownerName:'M. et Mme FICTIF',ownerAddress:'2 allée Test',
    references:'Bon de commande n° 0001 du 01/01/2026\nAvenant n° 1',works:'Module 25 m²\nTerrasse',effectDate:'2026-01-15',worksStart:'2026-01-02',worksEnd:'2026-01-14',receptionNotes:'Pas de DROC transmise.',
    declarations:[{label:'L’ouvrage a été livré propre',value:'non'}],reservesIntro:'Proposition de reprise attendue.',amountTotal:'80 000,00 € TTC',amountBalance:'8 000,00 € TTC',balanceComment:'Solde consigné.',
    reserves:[{location:'Extérieur',defect:'Vis non inox <b>',deadline:'Sous 1 mois',observations:'À reprendre',photos:'1'}],doe:[{label:'Notices',provided:true},{label:'Plans',provided:false}]});
  // Une réserve par photo non encore citée
  const added=reservesFromPhotos(photos,pv.reserves);assert.deepEqual(added.map(r=>r.photos),['2','3']);assert.equal(added[1].location,'Salle de bain');assert.equal(added[1].defect,'Désordre photo 3');
  pv.reserves.push(...added);
  const data={reference:'EP26-001',caseName:'Réception module',visitDate:'2026-01-15',siteAddress:'2 allée Test',presents:'M. Test — entreprise\nMOA',photos,subjects:['Extérieur','Salle de bain'],pv,generatedAt:'2026-01-15T12:00:00Z'};
  const html=buildPvHtml(data,CDL_LOGO);
  assert.match(html,/Procès-verbal de réception/);assert.match(html,/☐ SANS RÉSERVE &nbsp;&nbsp; ☒ AVEC RÉSERVES/);assert.match(html,/15\/01\/2026<\/b> \(point de départ des garanties légales – art\. 1792-6 C\. civ\.\)/);
  assert.equal((html.match(/data-reserve-index=/g)||[]).length,3);assert.ok(html.includes('Vis non inox &lt;b&gt;'));assert.match(html,/☒ Notices/);assert.match(html,/☐ Plans/);
  assert.match(html,/L’ouvrage a été livré propre : ☐ OUI ☒ NON/);assert.match(html,/Annexe photographique/);assert.ok(!/https?:\/\/(?!www\.w3)/.test(html.replace(/data:[^"]+/g,'')),'Aucune ressource externe');
  assert.equal(pvFileName('reception','EP26-001','2026-01-15'),'EP26-001_PV-RECEPTION_2026-01-15.html');assert.equal(pvFileName('levee','','2026-02-05'),'PV-LEVEE-RESERVES_2026-02-05.html');
  // Levée : reprise des parties et des réserves, statut à constater
  const levee=pvForLevee(pv,'2026-01-15');
  assert.equal(levee.document,'levee');assert.equal(levee.receptionDate,'2026-01-15');assert.equal(levee.companyName,'ENTREPRISE FICTIVE SAS');assert.equal(levee.reserves.length,3);
  assert.ok(levee.reserves.every(r=>r.status===''&&r.leveeDate===''));assert.notEqual(levee.reserves[0].id,pv.reserves[0].id);
  levee.reserves[0].status='levee';levee.reserves[0].leveeDate='2026-02-05';levee.reserves[1].status='non-levee';
  assert.deepEqual(pvSummary(levee),{total:3,lifted:1,remaining:2});
  const leveeHtml=buildPvHtml({...data,visitDate:'2026-02-05',pv:levee});
  assert.match(leveeHtml,/Annexe au procès-verbal de réception du 15\/01\/2026/);assert.match(leveeHtml,/Levée le 05\/02\/2026/);assert.match(leveeHtml,/Non levée/);assert.match(leveeHtml,/À constater/);
  assert.match(leveeHtml,/1 réserve\(s\) levée\(s\) sur 3/);assert.match(leveeHtml,/donne acte à l’entreprise de la levée des réserves/);
  // Word
  for(const [name,value] of [['reception',pv],['levee',levee]]){
    const blob=await buildPvWord({...data,pv:value},require('docx'));const zip=await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer())),xml=await zip.file('word/document.xml').async('string');
    assert.match(xml,/ENTREPRISE FICTIVE SAS/);assert.match(xml,/1792-6/);assert.equal((xml.match(/<w:drawing>/g)||[]).length,3,name+' : 3 photos en annexe');
    assert.match(xml,name==='levee'?/Date de la levée/:/Délai de levée/);
    if(process.env.TEST_OUTPUT)require('node:fs').writeFileSync(require('node:path').join(process.env.TEST_OUTPUT,`pv-${name}.docx`),Buffer.from(await blob.arrayBuffer()));
  }
  if(process.env.TEST_OUTPUT){const fs=require('node:fs'),path=require('node:path');fs.writeFileSync(path.join(process.env.TEST_OUTPUT,'pv-reception.html'),html);fs.writeFileSync(path.join(process.env.TEST_OUTPUT,'pv-levee.html'),leveeHtml);}
  // Normalisation défensive
  assert.equal(normalizePv({document:'x',reserves:[null,{status:'bidon',location:5}]}).reserves[0].status,'');assert.equal(normalizePv(null).document,'constat');
  console.log('PASS: PV réception/levée HTML + Word, reserves from photos, levée carry-over and summary, escaping, filenames, no external resource');
})().catch(e=>{console.error(e);process.exitCode=1;});
