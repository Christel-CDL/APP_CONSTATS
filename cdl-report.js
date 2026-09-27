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
  const pv=type==='ep'&&state.pv.document!=='constat';$('#pv-document').value=type==='ep'?state.pv.document:'constat';
  $$('.constat-only').forEach(el=>el.hidden=pv);$('#export-pv-word').hidden=!pv;
  $('#export-html').textContent=pv?`${PV_DOCUMENTS[state.pv.document].label} (HTML)`:'Rapport HTML (modèle CDL)';
  $('#cdl-report-filename').textContent=pv?pvFileName(state.pv.document,state.caseReference,state.visitDate):reportFileName(state.caseReference,state.visitDate);
  if(typeof renderPvEditor==='function')renderPvEditor();
}
function setCaseType(type){state.caseType=REPORT_TYPES[type]?type:'autre';if(state.caseType!=='ep')state.pv=defaultPv();for(const key of REPORT_TEXT_FIELDS)state[key]=reportFieldValue(key);renderReportFields();saveVisit();}
$('#case-type').addEventListener('change',e=>{const dossier=dossierById(state.dossierId);
  if(dossier&&reportTypeOf(dossier.type)!==e.target.value&&!confirm(`Le dossier « ${dossier.name} » est de type « ${dossier.type} ». Utiliser malgré tout le modèle « ${REPORT_TYPES[e.target.value].label} » pour ce constat ?`)){e.target.value=state.caseType;return;}
  if(e.target.value==='ej'&&(state.clientName||state.clientAddress)&&!confirm('Passer en expertise judiciaire efface le donneur d’ordre et son adresse de ce constat. Continuer ?')){e.target.value=state.caseType;return;}
  if(e.target.value!=='ep'&&pvHasData(state.pv)&&!confirm('Quitter l’expertise privée efface le procès-verbal en cours de ce constat (parties, réserves). Continuer ?')){e.target.value=state.caseType;return;}
  setCaseType(e.target.value);});
document.addEventListener('input',e=>{const key=e.target.dataset?.reportField;if(!key)return;state[key]=e.target.value;saveVisit();});
$('#hide-nominatif').addEventListener('change',e=>{state.hideNominatif=e.target.checked;saveVisit();});
for(const id of ['case-reference','visit-date'])$('#'+id).addEventListener('input',renderReportFields);
$('#export-html').addEventListener('click',()=>{
  if(visitBusy()){alert('Terminez la capture avant de créer le rapport.');return;}
  if(pvMode()){const pv=state.pv;if(!pv.companyName.trim()||!pv.ownerName.trim()){alert('Renseignez l’entreprise et le maître d’ouvrage du procès-verbal.');return;}
    download(new Blob([buildPvHtml(pvReportData())],{type:'text/html;charset=utf-8'}),pvFileName(pv.document,state.caseReference,state.visitDate));$('.toast').textContent=PV_DOCUMENTS[pv.document].label+' téléchargé (HTML).';$('.toast').classList.add('show');setTimeout(()=>$('.toast').classList.remove('show'),4500);return;}
  if(!state.photos.length){alert('Ajoutez au moins une photo au constat.');return;}
  if(state.caseType==='ej'&&!isOpalexeReference(state.caseReference)&&!confirm('La référence ne suit pas le format OPALEXE (ex. EJ26-1402). Elle sert de clé pour compléter le bloc nominatif. Générer quand même ?'))return;
  const html=buildConstatHtml({type:state.caseType,reference:state.caseReference,caseName:state.caseName,visitDate:state.visitDate,photos:state.photos,subjects:state.subjects,actions:collectActions(),position:state.position,hideNominatif:state.hideNominatif,...Object.fromEntries(REPORT_TEXT_FIELDS.map(key=>[key,reportFieldValue(key)]))});
  download(new Blob([html],{type:'text/html;charset=utf-8'}),reportFileName(state.caseReference,state.visitDate));
  $('.toast').textContent=state.caseType==='ej'?'Rapport HTML téléchargé — bloc nominatif à compléter hors application.':'Rapport HTML téléchargé.';$('.toast').classList.add('show');setTimeout(()=>$('.toast').classList.remove('show'),4500);
});
function pvReportData(){return {reference:state.caseReference,caseName:state.caseName,visitDate:state.visitDate,siteAddress:state.siteAddress,presents:state.presents,photos:state.photos,subjects:state.subjects,pv:state.pv};}
$('#export-pv-word').addEventListener('click',async()=>{
  if(visitBusy()){alert('Terminez la capture avant de créer le procès-verbal.');return;}
  const pv=state.pv;if(!pv.companyName.trim()||!pv.ownerName.trim()){alert('Renseignez l’entreprise et le maître d’ouvrage du procès-verbal.');return;}
  const button=$('#export-pv-word');button.disabled=true;
  try{const photos=structuredClone(state.photos);for(const p of photos){const image=await loadDrawingImage(p.annotatedSrc||p.src);p.imageWidth=image.naturalWidth;p.imageHeight=image.naturalHeight;if(p.drawing){const note=await loadDrawingImage(p.drawing);p.noteWidth=note.naturalWidth;p.noteHeight=note.naturalHeight;}}
    download(await buildPvWord({...pvReportData(),photos}),pvFileName(pv.document,state.caseReference,state.visitDate).replace(/\.html$/,'.docx'));
    $('.toast').textContent=PV_DOCUMENTS[pv.document].label+' téléchargé (Word).';$('.toast').classList.add('show');setTimeout(()=>$('.toast').classList.remove('show'),4500);
  }catch(error){console.error(error);alert('Le procès-verbal Word n’a pas pu être créé. Vérifiez les photos et réessayez.');}finally{button.disabled=false;}
});
