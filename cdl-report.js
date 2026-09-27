'use strict';
// Type de constat (EJ / EP / autre) et rapport HTML au modèle CDL EXPERT.
function renderReportFields(){
  const type=REPORT_TYPES[state.caseType]?state.caseType:'autre',ej=type==='ej',reference=(state.caseReference||'').trim();
  for(const option of $('#case-type').options){const allowed=profileAllows(option.value)||option.value===type;option.disabled=!allowed;option.hidden=!allowed;}
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
  const pv=type==='ep'&&pvIsPv(state.pv);$('#pv-document').value=type==='ep'?state.pv.document:'constat';
  $$('.constat-only').forEach(el=>el.hidden=pv||type!=='ep'&&el.classList.contains('ep-only'));$$('.full-report-only').forEach(el=>el.hidden=type!=='ep'||state.pv.document!=='constat');renderExpertSignature();$('#export-pv-word').hidden=!pv;
  const doc=type==='ep'?state.pv.document:'constat';
  $('#export-html').textContent=doc!=='constat'?`${PV_DOCUMENTS[doc].label} (HTML)`:'Rapport HTML (modèle CDL)';
  $('#cdl-report-filename').textContent=doc!=='constat'?pvFileName(doc,state.caseReference,state.visitDate):reportFileName(state.caseReference,state.visitDate);
  if(typeof renderPvEditor==='function')renderPvEditor();
  if(typeof renderAttendance==='function'){renderAttendance();renderCloseStatus();}
}
function setCaseType(type){state.caseType=REPORT_TYPES[type]?type:'autre';if(state.caseType!=='ep')state.pv=defaultPv();for(const key of REPORT_TEXT_FIELDS)state[key]=reportFieldValue(key);renderReportFields();saveVisit();}
$('#case-type').addEventListener('change',e=>{const dossier=dossierById(state.dossierId);
  if(dossier&&reportTypeOf(dossier.type)!==e.target.value&&!confirm(`Le dossier « ${dossier.name} » est de type « ${dossier.type} ». Utiliser malgré tout le modèle « ${REPORT_TYPES[e.target.value].label} » pour ce constat ?`)){e.target.value=state.caseType;return;}
  const erasing=[e.target.value==='ej'&&(state.clientName||state.clientAddress)?'le donneur d’ordre et son adresse':'',e.target.value!=='ep'&&(pvHasData(state.pv)||Object.keys(state.pv.signatures||{}).length)?'le procès-verbal (parties, réserves, signatures)':''].filter(Boolean);
  if(erasing.length&&!(ensureTransferred()&&confirm(`Ce changement efface de ce constat : ${erasing.join(' et ')}. Continuer ?`))){e.target.value=state.caseType;return;}
  setCaseType(e.target.value);});
document.addEventListener('input',e=>{const key=e.target.dataset?.reportField;if(!key)return;state[key]=e.target.value;saveVisit();});
$('#hide-nominatif').addEventListener('change',e=>{state.hideNominatif=e.target.checked;saveVisit();});
for(const id of ['case-reference','visit-date'])$('#'+id).addEventListener('input',renderReportFields);
$('#export-html').addEventListener('click',async()=>{
  if(visitBusy()){alert('Terminez la capture avant de créer le rapport.');return;}
  if(pvMode()){const pv=state.pv;if(!pvReady(pv))return;
    if(!(await download(new Blob([buildPvHtml(pvReportData())],{type:'text/html;charset=utf-8'}),pvFileName(pv.document,state.caseReference,state.visitDate))))return;markTransferred();$('.toast').textContent=PV_DOCUMENTS[pv.document].label+' enregistré (HTML).';$('.toast').classList.add('show');setTimeout(()=>$('.toast').classList.remove('show'),4500);return;}
  if(!state.photos.length){alert('Ajoutez au moins une photo au constat.');return;}
  if(state.caseType==='ej'&&!isOpalexeReference(state.caseReference)&&!confirm('La référence ne suit pas le format OPALEXE (ex. EJ26-1402). Elle sert de clé pour compléter le bloc nominatif. Générer quand même ?'))return;
  if(state.expertSigns&&!state.expertSignature){alert('Vous avez coché votre signature d’expert : signez, ou décochez la case, avant l’export.');return;}
  const simple=state.caseType==='ep'&&state.pv.document==='simple';
  const html=buildConstatHtml({simple,expertSignature:state.expertSigns?state.expertSignature:null,type:state.caseType,reference:state.caseReference,caseName:state.caseName,visitDate:state.visitDate,photos:state.photos,subjects:state.subjects,actions:collectActions(),position:state.position,hideNominatif:state.hideNominatif,attendance:state.attendance,...Object.fromEntries(REPORT_TEXT_FIELDS.map(key=>[key,reportFieldValue(key)]))});
  if(!(await download(new Blob([html],{type:'text/html;charset=utf-8'}),simple?pvFileName('simple',state.caseReference,state.visitDate):reportFileName(state.caseReference,state.visitDate))))return;if(state.caseType==='ep')markTransferred();
  $('.toast').textContent=state.caseType==='ej'?'Rapport HTML enregistré — bloc nominatif à compléter hors application.':'Rapport HTML enregistré.';$('.toast').classList.add('show');setTimeout(()=>$('.toast').classList.remove('show'),4500);
});
function pvReady(pv){if(!pv.companyName.trim()||!pv.ownerName.trim()){alert('Renseignez l’entreprise et le maître d’ouvrage du procès-verbal.');return false;}
  const stale=staleSignatures(pv);if(stale.length){alert(`Le procès-verbal a été modifié après la signature (${stale.join(', ')}). Faites signer à nouveau, ou effacez ces signatures, avant l’export.`);return false;}
  if(state.expertSigns&&!state.expertSignature){alert('Vous avez coché votre signature d’expert : signez, ou décochez la case, avant l’export.');return false;}return true;}
function pvReportData(){return {expertSignature:state.expertSigns?state.expertSignature:null,reference:state.caseReference,caseName:state.caseName,visitDate:state.visitDate,siteAddress:state.siteAddress,presents:state.presents,attendance:state.attendance,photos:state.photos,subjects:state.subjects,pv:state.pv};}
$('#export-pv-word').addEventListener('click',async()=>{
  if(visitBusy()){alert('Terminez la capture avant de créer le procès-verbal.');return;}
  const pv=state.pv;if(!pvReady(pv))return;
  const name=pvFileName(pv.document,state.caseReference,state.visitDate).replace(/\.html$/,'.docx'),target=await chooseSaveTarget(name);if(target==='cancel')return;
  const button=$('#export-pv-word');button.disabled=true;
  try{const photos=structuredClone(state.photos);for(const p of photos){const image=await loadDrawingImage(p.annotatedSrc||p.src);p.imageWidth=image.naturalWidth;p.imageHeight=image.naturalHeight;if(p.drawing){const note=await loadDrawingImage(p.drawing);p.noteWidth=note.naturalWidth;p.noteHeight=note.naturalHeight;}}
    const attendance=[];for(const src of state.attendance||[]){const image=await loadDrawingImage(src);attendance.push({src,width:image.naturalWidth,height:image.naturalHeight});}
    if(!(await download(await buildPvWord({...pvReportData(),photos,attendance}),name,{target})))return;markTransferred();
    $('.toast').textContent=PV_DOCUMENTS[pv.document].label+' enregistré (Word).';$('.toast').classList.add('show');setTimeout(()=>$('.toast').classList.remove('show'),4500);
  }catch(error){console.error(error);alert('Le procès-verbal Word n’a pas pu être créé. Vérifiez les photos et réessayez.');}finally{button.disabled=false;}
});
// Profil affiché dans le menu
$('#profile-name').textContent=PROFILE.name||PROFILE.email||'Profil';
$('#profile-detail').textContent=[PROFILE.email,PROFILE.types.length===2?(PROFILE.types.includes('ej')?'Expertise judiciaire':'Expertise privée'):''].filter(Boolean).join(' · ');
// Avant tout effacement de données de parties : vérifier qu'elles ont été exportées depuis leur dernière modification.
function transferContentHash(){return pvContentHash({data:{pv:state.pv,client:[state.clientName,state.clientAddress],signature:state.expertSignature?.at||''}});}
function markTransferred(){state.transferHash=transferContentHash();saveVisit();}
function ensureTransferred(){
  if(state.transferHash===transferContentHash())return true;
  if(!confirm('Ces données n’ont pas été exportées depuis leur dernière modification : elles seraient perdues.\n\nOK : télécharger d’abord une sauvegarde complète du constat (fichier JSON), puis poursuivre.\nAnnuler : ne rien effacer.'))return false;
  saveFile(new Blob([JSON.stringify(snapshot())],{type:'application/json'}),`${(state.caseReference||'constat').replace(/[^\w-]+/g,'-')}_sauvegarde-avant-effacement_${new Date().toISOString().slice(0,10)}.json`);
  state.transferHash=transferContentHash();
  return confirm('La sauvegarde a été téléchargée. Vérifiez qu’elle figure bien dans vos fichiers (Téléchargements, Fichiers ou OneDrive) avant de poursuivre.\n\nPoursuivre l’effacement ?');
}
