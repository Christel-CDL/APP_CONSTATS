'use strict';
// Type de constat (EJ / EP / autre) et rapport HTML au modèle CDL EXPERT.
function renderReportFields(){
  const type=REPORT_TYPES[state.caseType]?state.caseType:'autre',ej=type==='ej',reference=(state.caseReference||'').trim();
  $('#case-type').value=type;
  for(const field of $$('[data-report-field]'))if(document.activeElement!==field)field.value=reportFieldValue(field.dataset.reportField);
  $$('.ej-only').forEach(el=>el.hidden=!ej);$$('.not-ej').forEach(el=>el.hidden=ej);$$('.ep-only').forEach(el=>el.hidden=type!=='ep');
  $('#hide-nominatif').checked=!!state.hideNominatif;
  $('#case-reference-label').textContent=ej?'Référence OPALEXE':'Référence';
  $('#case-reference').placeholder=ej?'Ex. EJ26-1402':'Votre référence';
  $('#report-presents').placeholder=ej?'Une qualité par ligne, sans nom : Expert désigné, Demandeur, Conseil du défendeur…':'Une personne par ligne : nom et qualité';
  const note=$('#case-type-note');note.hidden=!ej;
  note.textContent=ej?'Expertise judiciaire : ne saisissez ni nom de partie, ni juridiction, ni n° RG. La référence OPALEXE sert de clé pour compléter le rapport après génération.'+(reference&&!isOpalexeReference(reference)?` « ${reference} » ne correspond pas au format OPALEXE (EJ26-1402).`:''):'';
  $('#cdl-report-type').textContent=REPORT_TYPES[type].label;
  $('#cdl-report-filename').textContent=reportFileName(state.caseReference,state.visitDate);
}
function setCaseType(type){state.caseType=REPORT_TYPES[type]?type:'autre';for(const key of REPORT_TEXT_FIELDS)state[key]=reportFieldValue(key);renderReportFields();saveVisit();}
$('#case-type').addEventListener('change',e=>{const dossier=dossierById(state.dossierId);
  if(dossier&&reportTypeOf(dossier.type)!==e.target.value&&!confirm(`Le dossier « ${dossier.name} » est de type « ${dossier.type} ». Utiliser malgré tout le modèle « ${REPORT_TYPES[e.target.value].label} » pour ce constat ?`)){e.target.value=state.caseType;return;}
  if(e.target.value==='ej'&&(state.clientName||state.clientAddress)&&!confirm('Passer en expertise judiciaire efface le donneur d’ordre et son adresse de ce constat. Continuer ?')){e.target.value=state.caseType;return;}
  setCaseType(e.target.value);});
document.addEventListener('input',e=>{const key=e.target.dataset?.reportField;if(!key)return;state[key]=e.target.value;saveVisit();});
$('#hide-nominatif').addEventListener('change',e=>{state.hideNominatif=e.target.checked;saveVisit();});
for(const id of ['case-reference','visit-date'])$('#'+id).addEventListener('input',renderReportFields);
$('#export-html').addEventListener('click',()=>{
  if(visitBusy()){alert('Terminez la capture avant de créer le rapport.');return;}
  if(!state.photos.length){alert('Ajoutez au moins une photo au constat.');return;}
  if(state.caseType==='ej'&&!isOpalexeReference(state.caseReference)&&!confirm('La référence ne suit pas le format OPALEXE (ex. EJ26-1402). Elle sert de clé pour compléter le bloc nominatif. Générer quand même ?'))return;
  const html=buildConstatHtml({type:state.caseType,reference:state.caseReference,caseName:state.caseName,visitDate:state.visitDate,photos:state.photos,subjects:state.subjects,actions:collectActions(),position:state.position,hideNominatif:state.hideNominatif,...Object.fromEntries(REPORT_TEXT_FIELDS.map(key=>[key,reportFieldValue(key)]))});
  download(new Blob([html],{type:'text/html;charset=utf-8'}),reportFileName(state.caseReference,state.visitDate));
  $('.toast').textContent=state.caseType==='ej'?'Rapport HTML téléchargé — bloc nominatif à compléter hors application.':'Rapport HTML téléchargé.';$('.toast').classList.add('show');setTimeout(()=>$('.toast').classList.remove('show'),4500);
});
