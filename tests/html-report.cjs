// Rapport HTML CDL EXPERT (modèles EJ / EP / autre). Node seul, sans navigateur : node tests/html-report.cjs
const assert=require('node:assert/strict');
const {buildConstatHtml,reportTypeOf,reportFileName,isOpalexeReference}=require('../html-report');
const {CDL_LOGO}=require('../report-logo');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const annotated=png.replace('ErkJggg==','ErkJggg=ANNOTE');
const photos=[
  {number:1,subject:'Vue générale',src:png,annotatedSrc:'',description:'LEGENDE_1',comment:'COMMENT_1',transcript:'DICTEE_1',drawing:'',include:{description:true,comment:true,transcript:true,drawing:true}},
  {number:2,subject:'Fissure façade Ouest',src:png,annotatedSrc:'data:image/png;base64,QU5OT1RF',description:'<script>alert(1)</script>',comment:'COMMENT_EXCLU',transcript:'DICTEE_EXCLUE',drawing:png,include:{description:true,comment:false,transcript:false,drawing:false}}
];
const base={reference:'EJ26-1402',caseName:'Désordres dallage',visitDate:'2026-09-26',photos,subjects:['Vue générale','Fissure façade Ouest','Sujet vide'],
  actions:[{type:'Créer une tâche',text:'Recherche de fuites',recipient:'Expert',date:'2026-09-29'},{type:'Créer une tâche',text:'',recipient:'',date:''}],
  position:{lat:48.76,lng:2.51,accuracy:187},siteAddress:'1 rue de l’Essai',presents:'Expert désigné\nDemandeur',expertNote:'Note générale',
  clientName:'CLIENT_EJ_INTERDIT',clientAddress:'ADRESSE_CLIENT',missionDetail:'MISSION',conclusions:'CONCLUSIONS',generatedAt:'2026-09-27T10:00:00Z'};
// Correspondances
assert.equal(reportTypeOf('Expertise judiciaire'),'ej');assert.equal(reportTypeOf('Expertise privée'),'ep');assert.equal(reportTypeOf('Expertise amiable'),'ep');assert.equal(reportTypeOf('Diagnostic'),'autre');
assert.ok(isOpalexeReference('EJ24-358'));assert.ok(isOpalexeReference(' ej26-1402 '));assert.ok(!isOpalexeReference('RG 24/00242'));
assert.equal(reportFileName('EJ26-1402','2026-09-26'),'EJ26-1402_CONSTAT_2026-09-26.html');
assert.equal(reportFileName('#EX-2026/031 · bât','2026-09-26'),'EX-2026-031-b-t_CONSTAT_2026-09-26.html');
assert.equal(reportFileName('','2026-09-26'),'CONSTAT_2026-09-26.html');
// Expertise judiciaire
const ej=buildConstatHtml({...base,type:'ej'},CDL_LOGO);
assert.match(ej,/class="type-badge type-ej" data-field="type_badge">EXPERTISE JUDICIAIRE</);
assert.match(ej,/<div class="nominatif-block" data-nominatif="true">/);
for(const field of ['tribunal','num_expertise_rg','intitule_dossier','expert'])assert.match(ej,new RegExp(`<td data-field="${field}"></td>`),'Bloc nominatif vide : '+field);
assert.match(ej,/<span class="num-expertise" data-field="num_expertise" data-nominatif="true"><\/span>/);
for(const secret of ['CLIENT_EJ_INTERDIT','ADRESSE_CLIENT','MISSION','CONCLUSIONS','COMMENT_EXCLU','DICTEE_EXCLUE','<script>'])assert.ok(!ej.includes(secret),'Absent du rapport EJ : '+secret);
assert.ok(ej.includes('&lt;script&gt;'),'Texte échappé');
assert.ok(!/https?:\/\/(?!www\.w3)/.test(ej.replace(/data:[^"]+/g,'')),'Aucune ressource externe');
assert.match(ej,/data-field="photo_img" data-photo-index="2" src="data:image\/png;base64,QU5OT1RF"/,'annotatedSrc prioritaire');
assert.match(ej,/data-field="photo_img" data-photo-index="1" src="data:image\/png;base64,iVBOR/);
assert.match(ej,/data-field="commentaire" data-photo-index="2" data-include="comment" hidden><\/div>/);
assert.ok(!ej.includes('data-field="note_manuscrite" data-photo-index="2"'),'Note manuscrite exclue');
assert.match(ej,/<h3 data-field="section_titre" data-section-index="2">Fissure façade Ouest<\/h3>/);assert.ok(!ej.includes('Sujet vide'));
assert.equal((ej.match(/data-action-index=/g)||[]).length,1);assert.match(ej,/data-field="action_date">29\/09\/2026</);
assert.match(ej,/48°45'36" N \/ 2°30'36" E \(précision ±187 m\)/);
assert.match(ej,/<li>Expert désigné<\/li><li>Demandeur<\/li>/);assert.match(ej,/data-field="date_visite">26\/09\/2026</);
assert.match(ej,/data-field="date_generation">27 septembre 2026</);assert.match(ej,/data-field="ref_pied">EJ26-1402</);
assert.match(buildConstatHtml({...base,type:'ej',hideNominatif:true}),/data-nominatif="true" data-masque="true" hidden>/);
// Expertise privée
const ep=buildConstatHtml({...base,type:'ep'},CDL_LOGO);
assert.match(ep,/type-ep" data-field="type_badge">EXPERTISE PRIVÉE</);assert.match(ep,/DOCUMENT CONFIDENTIEL/);
assert.ok(!ep.includes('data-nominatif'));
for(const [field,value] of [['client_nom','CLIENT_EJ_INTERDIT'],['client_adresse','ADRESSE_CLIENT'],['mission_detail','MISSION'],['conclusions','CONCLUSIONS']])assert.ok(ep.includes(`data-field="${field}">${value}<`),field);
// Constat autre
const autre=buildConstatHtml({...base,type:'inconnu'});
assert.match(autre,/type-autre" data-field="type_badge">CONSTAT</);assert.ok(!autre.includes('data-nominatif')&&!autre.includes('CLIENT_EJ_INTERDIT'));
if(process.env.TEST_OUTPUT){const fs=require('node:fs'),path=require('node:path');for(const [name,html] of [['ej',ej],['ep',ep]])fs.writeFileSync(path.join(process.env.TEST_OUTPUT,`rapport-${name}.html`),html);}
console.log('PASS: HTML report EJ/EP/autre, empty nominative block, excluded fields absent, annotatedSrc priority, escaping, GPS, filename, no external resource');
