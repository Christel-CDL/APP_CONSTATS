'use strict';
// Dossiers (projets) : métadonnées légères, gardées dans le localStorage de l'appareil.
// Les constats restent dans IndexedDB et référencent leur dossier par dossierId.
const DOSSIER_KEY='constat-dossiers'+PROFILE.suffix;
const DOSSIER_FIELDS=['name','reference','type','client','address','status'];
const DOSSIER_STATUS={'En cours':'progress','En attente':'draft','Clos':'done'};
let editingDossierId=null;
// Expertise judiciaire : aucun nom de partie ni juridiction n'est conservé dans l'application (RGPD).
function readDossiers(){try{const list=JSON.parse(localStorage.getItem(DOSSIER_KEY)||'[]');return Array.isArray(list)?list.filter(d=>d&&typeof d.id==='string'&&typeof d.name==='string').map(d=>reportTypeOf(d.type)==='ej'?{...d,client:''}:d):[];}catch{return [];}}
function writeDossiers(list){try{localStorage.setItem(DOSSIER_KEY,JSON.stringify(list));return true;}catch{alert('Le dossier n’a pas pu être enregistré sur cet appareil (stockage plein ou bloqué).');return false;}}
function dossierById(id){return id?readDossiers().find(d=>d.id===id)||null:null;}
function cleanDossier(value){const d={};for(const key of DOSSIER_FIELDS)d[key]=typeof value?.[key]==='string'?value[key].trim().slice(0,300):'';d.status=DOSSIER_STATUS[d.status]?d.status:'En cours';if(reportTypeOf(d.type)==='ej')d.client='';return d;}
// Valeurs reportées dans le constat lors du rattachement à un dossier.
function dossierVisitFields(dossier){const caseType=reportTypeOf(dossier.type);return {caseName:dossier.name,caseReference:dossier.reference,caseType,siteAddress:dossier.address||'',clientName:caseType==='ep'?dossier.client||'':'',clientAddress:caseType==='ep'?state.clientAddress:''};}
function saveDossier(values,id){const list=readDossiers(),now=new Date().toISOString(),data=cleanDossier(values);if(!data.name)return null;let dossier=list.find(d=>d.id===id);if(dossier)Object.assign(dossier,data,{updatedAt:now});else{dossier={id:createId(),...data,createdAt:now,updatedAt:now};list.push(dossier);}if(DOSSIER_REMOTE)dossier.pendingSync=true;return writeDossiers(list)?dossier:null;}
// A visit backup file carries a copy of its dossier so it can be recreated on another device.
function importDossier(value){if(!value||typeof value.id!=='string'||!/^[\w-]+$/.test(value.id)||typeof value.name!=='string'||!value.name.trim())return;const list=readDossiers();if(list.some(d=>d.id===value.id))return;const now=new Date().toISOString();list.push({id:value.id,...cleanDossier(value),createdAt:typeof value.createdAt==='string'?value.createdAt:now,updatedAt:now});writeDossiers(list);}
function touchDossier(id){const list=readDossiers(),dossier=list.find(d=>d.id===id);if(!dossier)return;dossier.updatedAt=new Date().toISOString();writeDossiers(list);}
function formatDate(value,withTime){const date=new Date(value);if(Number.isNaN(date.getTime()))return '';return date.toLocaleString('fr-FR',withTime?{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}:{day:'numeric',month:'short',year:'numeric'});}
function statusBadge(status){return `<span class="status ${DOSSIER_STATUS[status]||'progress'}">${escapeHtml(status)}</span>`;}

// Synchronisation avec la table Projets d'Airtable (profils connectés uniquement). Les dossiers restent utilisables
// hors connexion : une création ou modification est marquée « à envoyer » et transmise à la prochaine synchronisation.
const DOSSIER_REMOTE=PROFILE.suffix.startsWith('-u-'),HIDDEN_KEY=DOSSIER_KEY+'-masques';
let dossierSync={at:null,error:'',running:false};
const remoteValues=d=>({name:d.name,reference:d.reference,type:d.type,client:d.client,address:d.address,status:d.status});
function hiddenRemote(){try{return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY)||'[]'));}catch{return new Set();}}
async function projetsApi(method,path='',body){const res=await fetch('/api/projets'+path+(method==='GET'?'?profil='+encodeURIComponent(PROFILE.id):''),{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify({...body,profil:PROFILE.id})});
  const data=await res.json().catch(()=>({}));if(!res.ok)throw Object.assign(new Error(data.message||'Synchronisation impossible.'),{status:res.status});return data;}
async function syncDossiers(){
  if(!DOSSIER_REMOTE||dossierSync.running)return;if(!navigator.onLine){dossierSync.error='Hors connexion : dossiers de l’appareil uniquement.';renderSyncStatus();return;}
  dossierSync.running=true;renderSyncStatus();
  try{
    for(const local of readDossiers().filter(d=>d.pendingSync)){
      try{const {projet}=local.airtableId?await projetsApi('PATCH','/'+local.airtableId,remoteValues(local)):await projetsApi('POST','',remoteValues(local));
        const list=readDossiers(),d=list.find(x=>x.id===local.id);if(d){d.airtableId=projet.airtableId;delete d.pendingSync;writeDossiers(list);}}
      catch(error){if(error.status===403||error.status===404||error.status===400){const list=readDossiers(),d=list.find(x=>x.id===local.id);if(d){delete d.pendingSync;d.syncError=error.message;writeDossiers(list);}}else throw error;}
    }
    const {projets}=await projetsApi('GET'),list=readDossiers(),hidden=hiddenRemote(),now=new Date().toISOString();
    for(const p of projets){if(hidden.has(p.airtableId))continue;const local=list.find(d=>d.airtableId===p.airtableId);
      if(local){if(!local.pendingSync)Object.assign(local,cleanDossier({...local,...p}));}
      else list.push({id:'at-'+p.airtableId,...cleanDossier(p),airtableId:p.airtableId,createdAt:now,updatedAt:now});}
    writeDossiers(list);dossierSync.at=new Date();dossierSync.error='';
  }catch(error){dossierSync.error=error.status===401?'Session expirée : reconnectez ce profil pour synchroniser.':error.message;}
  finally{dossierSync.running=false;syncDossierPicker();if(typeof renderDrafts==='function')renderDrafts();renderSyncStatus();}
}
function renderSyncStatus(){const box=$('#dossier-sync');if(!box)return;box.hidden=!DOSSIER_REMOTE;$('#sync-dossiers').hidden=!DOSSIER_REMOTE;$('#sync-dossiers').disabled=dossierSync.running;
  const pending=readDossiers().filter(d=>d.pendingSync).length;
  box.textContent=dossierSync.running?'Synchronisation avec Airtable…':dossierSync.error?`⚠ ${dossierSync.error}${pending?` ${pending} dossier(s) en attente d’envoi.`:''}`:dossierSync.at?`✓ Synchronisé avec Airtable à ${dossierSync.at.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}${pending?` · ${pending} en attente`:''}`:'';}
$('#sync-dossiers').addEventListener('click',syncDossiers);
window.addEventListener('online',syncDossiers);
window.addEventListener('load',()=>setTimeout(syncDossiers,300));
// Formulaire de création / modification
// Chaque profil ne propose que ses types de mission (profil judiciaire / profil privé).
function restrictDossierTypes(select){for(const option of select.options){const allowed=profileAllows(reportTypeOf(option.value))||option.value===select.value&&!!editingDossierId;option.disabled=!allowed;option.hidden=!allowed;}if(select.selectedOptions[0]?.disabled)select.value=[...select.options].find(o=>!o.disabled)?.value||select.value;}
function syncDossierFormType(){const form=$('#dossier-form'),ej=reportTypeOf(form.elements.type.value)==='ej';form.elements.client.disabled=ej;if(ej)form.elements.client.value='';form.elements.reference.placeholder=ej?'Référence OPALEXE (ex. EJ26-1402)':'Référence interne…';$('#dossier-client-note').hidden=!ej;}
$('#dossier-form').elements.type.addEventListener('change',syncDossierFormType);
function openDossierForm(id){const dossier=dossierById(id),form=$('#dossier-form');editingDossierId=dossier?dossier.id:null;form.reset();for(const key of DOSSIER_FIELDS)if(dossier)form.elements[key].value=dossier[key]||'';if(dossier&&dossier.type==='Expertise amiable')form.elements.type.value='Expertise privée';restrictDossierTypes(form.elements.type);syncDossierFormType();$('#dossier-dialog-title').textContent=dossier?'Modifier le dossier':'Nouveau dossier';$('#dossier-dialog').showModal();form.elements.name.focus();}
function closeDossierForm(){$('#dossier-dialog').close();editingDossierId=null;}
$('#new-dossier').addEventListener('click',()=>openDossierForm());
$('#picker-new-dossier').addEventListener('click',()=>openDossierForm());
$('#close-dossier').addEventListener('click',closeDossierForm);
$('#cancel-dossier').addEventListener('click',closeDossierForm);
$('#dossier-form').addEventListener('submit',e=>{e.preventDefault();const form=e.target,values=Object.fromEntries(DOSSIER_FIELDS.map(key=>[key,form.elements[key].value]));const wasEditing=editingDossierId,dossier=saveDossier(values,editingDossierId);if(!dossier){form.elements.name.focus();return;}closeDossierForm();
  // From step 1 of a visit, a new dossier is attached to the visit right away.
  if(!wasEditing&&$('#inspection').classList.contains('active'))applyDossier(dossier.id);
  else if(wasEditing&&state.dossierId===dossier.id)applyDossier(dossier.id);
  renderDrafts();if(DOSSIER_REMOTE)syncDossiers();});

// Rattachement du constat en cours (étape 1)
function syncDossierPicker(){const select=$('#case-dossier'),list=readDossiers().sort((a,b)=>a.name.localeCompare(b.name,'fr'));select.innerHTML='<option value="">— Aucun dossier —</option>'+list.map(d=>`<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}${d.reference?' · '+escapeHtml(d.reference):''}</option>`).join('');select.value=list.some(d=>d.id===state.dossierId)?state.dossierId:'';}
function applyDossier(id){const dossier=dossierById(id);state.dossierId=dossier?dossier.id:null;if(dossier){Object.assign(state,dossierVisitFields(dossier));touchDossier(dossier.id);}renderCaseDetails();syncDossierPicker();saveVisit();}
$('#case-dossier').addEventListener('change',e=>applyDossier(e.target.value));

// Page « Mes dossiers » et tableau de bord
function renderDossierList(drafts){const list=readDossiers().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  $('#dossier-list').innerHTML=list.length?list.map(d=>{const visits=drafts.filter(v=>v.dossierId===d.id).sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
    return `<article class="dossier-card"><div class="dossier-card-head"><div><h2>${escapeHtml(d.name)}</h2><p>${[d.reference,d.type,d.client].filter(Boolean).map(escapeHtml).join(' · ')}</p>${d.address?`<small>⌖ ${escapeHtml(d.address)}</small>`:''}${DOSSIER_REMOTE?`<small class="sync-flag">${d.pendingSync?'⏳ En attente d’envoi vers Airtable':d.syncError?'⚠ '+escapeHtml(d.syncError):d.airtableId?'✓ Airtable':''}</small>`:''}</div>${statusBadge(d.status)}</div>
    <div class="dossier-visits">${visits.length?visits.map(v=>`<div class="dossier-visit"><span>${escapeHtml(formatDate(v.visitDate||v.savedAt))} — ${v.photos.length} photo(s)</span><button class="link-btn" data-open-draft="${escapeHtml(v.draftId)}">Reprendre →</button></div>`).join(''):'<p>Aucun constat rattaché pour le moment.</p>'}</div>
    <div class="dossier-card-actions"><button class="primary" data-dossier-visit="${escapeHtml(d.id)}">＋ Nouveau constat</button><button class="secondary" data-dossier-edit="${escapeHtml(d.id)}">Modifier</button><button class="secondary danger" data-dossier-delete="${escapeHtml(d.id)}">Supprimer</button></div></article>`;}).join('')
  :'<div class="empty-panel"><div>▱</div><h2>Aucun dossier pour le moment</h2><p>Créez un dossier pour y rattacher vos constats de terrain.</p><button class="primary" type="button" data-dossier-create>＋ Créer mon premier dossier</button></div>';}
$('#dossier-list').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.openDraft){openDraft(b.dataset.openDraft,b);return;}
  if('dossierCreate' in b.dataset){openDossierForm();return;}
  if(b.dataset.dossierEdit){openDossierForm(b.dataset.dossierEdit);return;}
  if(b.dataset.dossierVisit){startNewVisit(b.dataset.dossierVisit);return;}
  if(b.dataset.dossierDelete){const dossier=dossierById(b.dataset.dossierDelete);if(!dossier)return;const count=(await listDrafts()).filter(v=>v.dossierId===dossier.id).length;
    if(!confirm(`Supprimer le dossier « ${dossier.name} » de cet appareil ?`+(count?`\n\nSes ${count} constat(s) sont conservés dans « Mes brouillons », sans dossier.`:'')+(dossier.airtableId?'\n\nIl reste enregistré dans Airtable et ne sera plus proposé sur cet appareil.':'')))return;
    if(dossier.airtableId){const hidden=hiddenRemote();hidden.add(dossier.airtableId);try{localStorage.setItem(HIDDEN_KEY,JSON.stringify([...hidden]));}catch{}}
    if(writeDossiers(readDossiers().filter(d=>d.id!==dossier.id))){if(state.dossierId===dossier.id){state.dossierId=null;saveVisit();}syncDossierPicker();renderDrafts();}}
});
function renderDashboard(drafts){const dossiers=readDossiers(),active=dossiers.filter(d=>d.status==='En cours'),today=new Date().toLocaleDateString('en-CA');
  $('#today-label').textContent=new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}).toUpperCase();
  $('#dossier-count').textContent=dossiers.length;$('#dossier-count').hidden=!dossiers.length;
  $('#stat-dossiers').textContent=active.length;$('#stat-dossiers-note').textContent=`${dossiers.length} dossier(s) au total`;
  $('#stat-drafts').textContent=drafts.length;$('#stat-drafts-note').textContent=`${drafts.reduce((n,d)=>n+d.photos.length,0)} photo(s)`;
  const actions=drafts.flatMap(d=>(Array.isArray(d.actions)?d.actions:[]).filter(a=>a&&(a.text||'').trim()).map(a=>({...a,draft:d})));
  const upcoming=actions.filter(a=>/^\d{4}-\d{2}-\d{2}$/.test(a.date||'')).sort((a,b)=>a.date.localeCompare(b.date));
  $('#stat-actions').textContent=actions.length;$('#stat-actions-note').textContent=`${upcoming.filter(a=>a.date<today).length} échéance(s) dépassée(s)`;
  const lastActivity=d=>drafts.filter(v=>v.dossierId===d.id).reduce((max,v)=>String(v.savedAt)>max?String(v.savedAt):max,String(d.updatedAt||''));
  const recent=[...dossiers].sort((a,b)=>lastActivity(b).localeCompare(lastActivity(a))).slice(0,5);
  $('#recent-dossiers').innerHTML=recent.length?recent.map(d=>`<tr><td><span class="folder-icon">▰</span><div><b>${escapeHtml(d.name)}</b><small>${escapeHtml(d.reference||'')}</small></div></td><td>${escapeHtml(d.type)}</td><td>${escapeHtml(d.client)}</td><td>${escapeHtml(formatDate(lastActivity(d),true))}</td><td>${statusBadge(d.status)}</td></tr>`).join('')
    :'<tr><td colspan="5" class="empty-row">Aucun dossier. <button class="link-btn" type="button" data-view="dossiers">Créer un dossier →</button></td></tr>';
  $('#upcoming-actions').innerHTML=upcoming.length?upcoming.slice(0,4).map(a=>{const date=new Date(a.date+'T12:00:00');return `<div class="appointment${a.date<today?' overdue':''}"><div class="date"><b>${date.getDate()}</b><small>${escapeHtml(date.toLocaleDateString('fr-FR',{month:'short'}).toUpperCase())}</small></div><div><span class="time">${escapeHtml(a.type||'Action')}</span><h3>${escapeHtml(a.text)}</h3><p>${escapeHtml(a.draft.caseName||'Constat de terrain')}</p>${a.recipient?`<small>→ ${escapeHtml(a.recipient)}</small>`:''}</div></div>`;}).join('')
    :'<p class="empty-note">Aucune suite à donner datée. Ajoutez des échéances à l’étape 3 d’un constat.</p>';
  const card=$('#continue-card');card.hidden=!(state.photos.length||state.caseName);
}
$('#recent-dossiers').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)showPage(b.dataset.view);});
function renderDossierViews(drafts){renderDossierList(drafts);renderDashboard(drafts);syncDossierPicker();}
$$('[data-go]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.go)));
