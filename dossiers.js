'use strict';
// Dossiers (projets) : métadonnées légères, gardées dans le localStorage de l'appareil.
// Les constats restent dans IndexedDB et référencent leur dossier par dossierId.
const DOSSIER_KEY='constat-dossiers'+(TEST_MODE?'-verification':'');
const DOSSIER_FIELDS=['name','reference','type','client','address','status'];
const DOSSIER_STATUS={'En cours':'progress','En attente':'draft','Clos':'done'};
let editingDossierId=null;
function readDossiers(){try{const list=JSON.parse(localStorage.getItem(DOSSIER_KEY)||'[]');return Array.isArray(list)?list.filter(d=>d&&typeof d.id==='string'&&typeof d.name==='string'):[];}catch{return [];}}
function writeDossiers(list){try{localStorage.setItem(DOSSIER_KEY,JSON.stringify(list));return true;}catch{alert('Le dossier n’a pas pu être enregistré sur cet appareil (stockage plein ou bloqué).');return false;}}
function dossierById(id){return id?readDossiers().find(d=>d.id===id)||null:null;}
function cleanDossier(value){const d={};for(const key of DOSSIER_FIELDS)d[key]=typeof value?.[key]==='string'?value[key].trim().slice(0,300):'';d.status=DOSSIER_STATUS[d.status]?d.status:'En cours';return d;}
function saveDossier(values,id){const list=readDossiers(),now=new Date().toISOString(),data=cleanDossier(values);if(!data.name)return null;let dossier=list.find(d=>d.id===id);if(dossier)Object.assign(dossier,data,{updatedAt:now});else{dossier={id:createId(),...data,createdAt:now,updatedAt:now};list.push(dossier);}return writeDossiers(list)?dossier:null;}
// A visit backup file carries a copy of its dossier so it can be recreated on another device.
function importDossier(value){if(!value||typeof value.id!=='string'||!/^[\w-]+$/.test(value.id)||typeof value.name!=='string'||!value.name.trim())return;const list=readDossiers();if(list.some(d=>d.id===value.id))return;const now=new Date().toISOString();list.push({id:value.id,...cleanDossier(value),createdAt:typeof value.createdAt==='string'?value.createdAt:now,updatedAt:now});writeDossiers(list);}
function touchDossier(id){const list=readDossiers(),dossier=list.find(d=>d.id===id);if(!dossier)return;dossier.updatedAt=new Date().toISOString();writeDossiers(list);}
function formatDate(value,withTime){const date=new Date(value);if(Number.isNaN(date.getTime()))return '';return date.toLocaleString('fr-FR',withTime?{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}:{day:'numeric',month:'short',year:'numeric'});}
function statusBadge(status){return `<span class="status ${DOSSIER_STATUS[status]||'progress'}">${escapeHtml(status)}</span>`;}

// Formulaire de création / modification
function openDossierForm(id){const dossier=dossierById(id),form=$('#dossier-form');editingDossierId=dossier?dossier.id:null;form.reset();for(const key of DOSSIER_FIELDS)if(dossier)form.elements[key].value=dossier[key]||'';$('#dossier-dialog-title').textContent=dossier?'Modifier le dossier':'Nouveau dossier';$('#dossier-dialog').showModal();form.elements.name.focus();}
function closeDossierForm(){$('#dossier-dialog').close();editingDossierId=null;}
$('#new-dossier').addEventListener('click',()=>openDossierForm());
$('#picker-new-dossier').addEventListener('click',()=>openDossierForm());
$('#close-dossier').addEventListener('click',closeDossierForm);
$('#cancel-dossier').addEventListener('click',closeDossierForm);
$('#dossier-form').addEventListener('submit',e=>{e.preventDefault();const form=e.target,values=Object.fromEntries(DOSSIER_FIELDS.map(key=>[key,form.elements[key].value]));const wasEditing=editingDossierId,dossier=saveDossier(values,editingDossierId);if(!dossier){form.elements.name.focus();return;}closeDossierForm();
  // From step 1 of a visit, a new dossier is attached to the visit right away.
  if(!wasEditing&&$('#inspection').classList.contains('active'))applyDossier(dossier.id);
  else if(wasEditing&&state.dossierId===dossier.id)applyDossier(dossier.id);
  renderDrafts();});

// Rattachement du constat en cours (étape 1)
function syncDossierPicker(){const select=$('#case-dossier'),list=readDossiers().sort((a,b)=>a.name.localeCompare(b.name,'fr'));select.innerHTML='<option value="">— Aucun dossier —</option>'+list.map(d=>`<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}${d.reference?' · '+escapeHtml(d.reference):''}</option>`).join('');select.value=list.some(d=>d.id===state.dossierId)?state.dossierId:'';}
function applyDossier(id){const dossier=dossierById(id);state.dossierId=dossier?dossier.id:null;if(dossier){state.caseName=dossier.name;state.caseReference=dossier.reference;touchDossier(dossier.id);}renderCaseDetails();syncDossierPicker();saveVisit();}
$('#case-dossier').addEventListener('change',e=>applyDossier(e.target.value));

// Page « Mes dossiers » et tableau de bord
function renderDossierList(drafts){const list=readDossiers().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  $('#dossier-list').innerHTML=list.length?list.map(d=>{const visits=drafts.filter(v=>v.dossierId===d.id).sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
    return `<article class="dossier-card"><div class="dossier-card-head"><div><h2>${escapeHtml(d.name)}</h2><p>${[d.reference,d.type,d.client].filter(Boolean).map(escapeHtml).join(' · ')}</p>${d.address?`<small>⌖ ${escapeHtml(d.address)}</small>`:''}</div>${statusBadge(d.status)}</div>
    <div class="dossier-visits">${visits.length?visits.map(v=>`<div class="dossier-visit"><span>${escapeHtml(formatDate(v.visitDate||v.savedAt))} — ${v.photos.length} photo(s)</span><button class="link-btn" data-open-draft="${escapeHtml(v.draftId)}">Reprendre →</button></div>`).join(''):'<p>Aucun constat rattaché pour le moment.</p>'}</div>
    <div class="dossier-card-actions"><button class="primary" data-dossier-visit="${escapeHtml(d.id)}">＋ Nouveau constat</button><button class="secondary" data-dossier-edit="${escapeHtml(d.id)}">Modifier</button><button class="secondary danger" data-dossier-delete="${escapeHtml(d.id)}">Supprimer</button></div></article>`;}).join('')
  :'<div class="empty-panel"><div>▱</div><h2>Aucun dossier pour le moment</h2><p>Créez un dossier pour y rattacher vos constats de terrain.</p><button class="primary" type="button" data-dossier-create>＋ Créer mon premier dossier</button></div>';}
$('#dossier-list').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.openDraft){openDraft(b.dataset.openDraft,b);return;}
  if('dossierCreate' in b.dataset){openDossierForm();return;}
  if(b.dataset.dossierEdit){openDossierForm(b.dataset.dossierEdit);return;}
  if(b.dataset.dossierVisit){startNewVisit(b.dataset.dossierVisit);return;}
  if(b.dataset.dossierDelete){const dossier=dossierById(b.dataset.dossierDelete);if(!dossier)return;const count=(await listDrafts()).filter(v=>v.dossierId===dossier.id).length;
    if(!confirm(`Supprimer le dossier « ${dossier.name} » ?`+(count?`\n\nSes ${count} constat(s) sont conservés dans « Mes brouillons », sans dossier.`:'')))return;
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
