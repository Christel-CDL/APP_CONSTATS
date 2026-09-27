let visitSwitching=false;
function visitBusy(){return !!recording||pendingImports>0||pendingCapture||$('#camera-dialog').open||$('#drawing-dialog').open||visitSwitching;}
async function listDrafts(){const db=await database;if(!db){const entries=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key.startsWith(STORAGE_KEY+'-draft-'))entries.push(JSON.parse(localStorage.getItem(key)));}return entries;}return new Promise((resolve,reject)=>{const request=db.transaction('drafts').objectStore('drafts').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function caseTitle(index){return $$('.case-option')[index]?.querySelector('b').textContent||'Constat de terrain';}
// Constats en cours / terminés. Un constat vide (sans photo ni nom) n'est pas listé.
function draftCard(d){const dossier=dossierById(d.dossierId),closed=!!d.closedAt;
  return `<article class="draft-card${closed?' closed':''}"><div><h2>${escapeHtml(d.caseName||caseTitle(d.caseIndex))}</h2>${dossier?`<p class="draft-dossier">▱ ${escapeHtml(dossier.name)}</p>`:''}<p>${d.photos.length} photo(s) · ${new Set(d.photos.map(p=>p.subject)).size} sujet(s)</p><small>${closed?'Terminé le '+escapeHtml(new Date(d.closedAt).toLocaleString('fr-FR')):'Enregistré le '+escapeHtml(new Date(d.savedAt).toLocaleString('fr-FR'))}</small>${d.lastExport?`<p class="draft-export">⬇ ${escapeHtml(d.lastExport.name)}</p>`:closed?'<p class="draft-export warn">Aucun rapport exporté</p>':''}<p>${escapeHtml(d.subjects.join(' · '))}</p></div><div class="draft-buttons"><button class="${closed?'secondary':'primary'}" data-open-draft="${escapeHtml(d.draftId)}">${closed?'Rouvrir':'Reprendre ce brouillon'}</button>${closed?`<button class="secondary danger" data-delete-draft="${escapeHtml(d.draftId)}">Supprimer de l’appareil</button>`:''}</div></article>`;}
async function renderDrafts(){try{const all=(await listDrafts()).sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt))),drafts=all.filter(d=>d.photos.length||d.caseName||d.caseReference||d.closedAt);
  const open=drafts.filter(d=>!d.closedAt),closed=drafts.filter(d=>d.closedAt).sort((a,b)=>String(b.closedAt).localeCompare(String(a.closedAt)));
  $('#draft-list').innerHTML=(open.length?open.map(draftCard).join(''):'<p>Aucun constat en cours. Démarrez un constat ; il est enregistré automatiquement sur cet appareil.</p>')
    +(closed.length?`<h2 class="draft-section">Constats terminés (${closed.length})</h2><p class="muted draft-section-note">Rapports exportés : une fois rangés dans OneDrive, supprimez le constat de l’appareil (photos et données personnelles).</p>${closed.map(draftCard).join('')}`:'');
  $('.continue-card p').textContent=`${state.caseName||'Constat de terrain'} · ${state.photos.length} photo(s) dans le constat actuel`;$('.continue-card h2').textContent='Reprendre le constat actuel';renderDossierViews(drafts);}catch{$('#draft-list').textContent='Impossible de lire les brouillons. Conservez une sauvegarde de la visite dans un fichier.';}}
async function saveDraftExplicit(){if(visitBusy()){alert('Terminez la prise de photo, l’import ou l’enregistrement audio avant d’enregistrer le brouillon.');return;}const button=$('#save-draft');button.disabled=true;try{const ok=await persistVisit();if(ok){$('.toast').textContent='Brouillon enregistré. Retrouvez-le dans « Mes brouillons ».';$('.toast').classList.add('show');setTimeout(()=>$('.toast').classList.remove('show'),4500);}}finally{button.disabled=false;}}
$('#save-draft').addEventListener('click',saveDraftExplicit);
initialize();
async function startNewVisit(dossierId){
  if(!ready||visitBusy()){alert('Terminez l’opération en cours avant de démarrer un autre constat.');return;}
  visitSwitching=true;
  try{if(state.photos.length||state.caseName||state.subjects.length>1||collectActions().some(a=>a.text||a.recipient)){if(!(await persistVisit()))return;}
    suspendVisitAccess();clearTimeout(saveTimer);state.draftId=createId();state.photos=[];state.subjects=['Vue générale'];state.activeSubject='Vue générale';state.position=null;state.dossierId=null;state.caseName='';state.caseReference='';state.visitDate=new Date().toLocaleDateString('en-CA');resetReportFields();if(typeof dossierId==='string'&&dossierById(dossierId)){const dossier=dossierById(dossierId);state.dossierId=dossier.id;Object.assign(state,dossierVisitFields(dossier));touchDossier(dossier.id);}syncDossierPicker();renderCaseDetails();$('#action-list').innerHTML='';addAction();selectCase(0);state.currentStep=1;renderSubjects();renderCaptures();showPosition();showPage('inspection');renderStep();saveVisit();prepareVisitAccess();
  }finally{visitSwitching=false;}
}
$('#draft-list').addEventListener('click',e=>{const button=e.target.closest('[data-open-draft]');if(button)openDraft(button.dataset.openDraft,button);});
async function openDraft(draftId,button){
  if(visitBusy()){alert('Terminez l’opération en cours avant de changer de brouillon.');return;}
  visitSwitching=true;button.disabled=true;
  try{if(unsaved&&!(await persistVisit()))return;const drafts=await listDrafts(),draft=drafts.find(d=>d.draftId===draftId);if(!draft)return;if(draft.closedAt&&!confirm('Rouvrir ce constat terminé ? Il redevient le constat en cours ; terminez-le à nouveau après vos modifications.'))return;if(draft.closedAt)draft.closedAt='';suspendVisitAccess();restoreState(draft);state.currentStep=2;showPage('inspection');renderStep();saveVisit();}
  catch{alert('Ce brouillon ne peut pas être ouvert. La visite actuelle est conservée.');}
  finally{visitSwitching=false;button.disabled=false;}
}
