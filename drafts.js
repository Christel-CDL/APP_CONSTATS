let visitSwitching=false;
function visitBusy(){return !!recording||pendingImports>0||pendingCapture||$('#camera-dialog').open||$('#drawing-dialog').open||visitSwitching;}
async function listDrafts(){const db=await database;if(!db){const entries=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key.startsWith(STORAGE_KEY+'-draft-'))entries.push(JSON.parse(localStorage.getItem(key)));}return entries;}return new Promise((resolve,reject)=>{const request=db.transaction('drafts').objectStore('drafts').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function caseTitle(index){return $$('.case-option')[index]?.querySelector('b').textContent||'Constat de terrain';}
async function renderDrafts(){try{const drafts=(await listDrafts()).sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));$('#draft-list').innerHTML=drafts.length?drafts.map(d=>`<article class="draft-card"><div><h2>${escapeHtml(d.caseName||caseTitle(d.caseIndex))}</h2><p>${d.photos.length} photo(s) · ${new Set(d.photos.map(p=>p.subject)).size} sujet(s)</p><small>Enregistré le ${escapeHtml(new Date(d.savedAt).toLocaleString('fr-FR'))}</small><p>${escapeHtml(d.subjects.join(' · '))}</p></div><button class="primary" data-open-draft="${escapeHtml(d.draftId)}">Reprendre ce brouillon</button></article>`).join(''):'<p>Aucun brouillon enregistré. Démarrez un constat, puis enregistrez-le pour le retrouver ici.</p>';$('.continue-card p').textContent=`${state.caseName||'Constat de terrain'} · ${state.photos.length} photo(s) dans le constat actuel`;$('.continue-card h2').textContent='Reprendre le constat actuel';}catch{$('#draft-list').textContent='Impossible de lire les brouillons. Conservez une sauvegarde de la visite dans un fichier.';}}
async function saveDraftExplicit(){if(visitBusy()){alert('Terminez la prise de photo, l’import ou l’enregistrement audio avant d’enregistrer le brouillon.');return;}const button=$('#save-draft');button.disabled=true;try{const ok=await persistVisit();if(ok){$('.toast').textContent='Brouillon enregistré. Retrouvez-le dans « Mes brouillons ».';$('.toast').classList.add('show');setTimeout(()=>$('.toast').classList.remove('show'),4500);}}finally{button.disabled=false;}}
$('#save-draft').addEventListener('click',saveDraftExplicit);
initialize();
async function startNewVisit(){
  if(!ready||visitBusy()){alert('Terminez l’opération en cours avant de démarrer un autre constat.');return;}
  visitSwitching=true;
  try{if(state.photos.length||state.caseName||state.subjects.length>1||collectActions().some(a=>a.text||a.recipient)){if(!(await persistVisit()))return;}
    suspendVisitAccess();clearTimeout(saveTimer);state.draftId=createId();state.photos=[];state.subjects=['Vue générale'];state.activeSubject='Vue générale';state.position=null;state.caseName='';state.caseReference='';state.visitDate=new Date().toLocaleDateString('en-CA');renderCaseDetails();$('#action-list').innerHTML='';addAction();selectCase(0);state.currentStep=1;renderSubjects();renderCaptures();showPosition();showPage('inspection');renderStep();saveVisit();prepareVisitAccess();
  }finally{visitSwitching=false;}
}
$('#draft-list').addEventListener('click',async e=>{
  const button=e.target.closest('[data-open-draft]');if(!button)return;
  if(visitBusy()){alert('Terminez l’opération en cours avant de changer de brouillon.');return;}
  visitSwitching=true;button.disabled=true;
  try{if(unsaved&&!(await persistVisit()))return;const drafts=await listDrafts(),draft=drafts.find(d=>d.draftId===button.dataset.openDraft);if(!draft)return;suspendVisitAccess();restoreState(draft);state.currentStep=2;showPage('inspection');renderStep();saveVisit();}
  catch{alert('Ce brouillon ne peut pas être ouvert. La visite actuelle est conservée.');}
  finally{visitSwitching=false;button.disabled=false;}
});
