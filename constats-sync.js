'use strict';
// Fin de constat, fiche de suivi dans Airtable (table Constats) et feuille de présence photographiée.
// La fiche Airtable ne contient que des métadonnées : titre, date, statut, dossier, nombre de photos et nom du dernier
// fichier exporté. Photos, commentaires, feuille de présence et rapports restent sur l'appareil (RGPD).
const CONSTAT_SYNC_KEY='constat-constats-sync'+PROFILE.suffix;
function constatQueue(){try{const value=JSON.parse(localStorage.getItem(CONSTAT_SYNC_KEY)||'{}');return value&&typeof value==='object'?value:{};}catch{return {};}}
function writeConstatQueue(queue){try{localStorage.setItem(CONSTAT_SYNC_KEY,JSON.stringify(queue));}catch{}}
function notify(message){$('.toast').textContent=message;$('.toast').classList.add('show');setTimeout(()=>$('.toast').classList.remove('show'),5000);}
// Conversion locale (la politique de sécurité interdit fetch() sur une adresse data:).
function dataUrlBlob(src){const [head,data]=src.split(',');const bytes=atob(data),array=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)array[i]=bytes.charCodeAt(i);return new Blob([array],{type:/^data:([^;]+)/.exec(head)?.[1]||'image/jpeg'});}
function frenchDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):'';}
function constatRecord(status){const ej=state.caseType==='ej',dossier=dossierById(state.dossierId),date=frenchDate(state.visitDate);
  const doc=state.caseType==='ep'&&PV_DOCUMENTS[state.pv?.document]?PV_DOCUMENTS[state.pv.document].label:'Constat';
  // Expertise judiciaire : la référence OPALEXE seule, jamais le nom du dossier ni l'adresse.
  const title=ej?`${state.caseReference.trim()||'Référence à compléter'} — Constat du ${date}`:`${[state.caseReference.trim(),state.caseName.trim()].filter(Boolean).join(' — ')||'Constat'} — ${doc} du ${date}`;
  const subjects=new Set(state.photos.map(p=>p.subject)).size;
  return {draftId:state.draftId,status,kind:state.caseType,date:state.visitDate,title,place:ej?'':state.siteAddress||'',projet:dossier?.airtableId||'',
    summary:`${state.photos.length} photo(s) · ${subjects} sujet(s)${state.lastExport?` · dernier fichier : ${state.lastExport.name}`:''} — contenu conservé sur l’appareil et dans les rapports exportés.`};}
// Mise en file puis envoi dès que possible (hors connexion : envoi au retour du réseau).
function queueConstat(status){if(!DOSSIER_REMOTE||!state.draftId)return;const queue=constatQueue();queue[state.draftId]=constatRecord(status);writeConstatQueue(queue);flushConstats();}
let constatFlushing=false;
async function flushConstats(){if(!DOSSIER_REMOTE||constatFlushing||!navigator.onLine)return;constatFlushing=true;
  try{const queue=constatQueue();
    for(const [id,record] of Object.entries(queue)){
      // Le dossier a pu recevoir son identifiant Airtable depuis la mise en file.
      const draft=id===state.draftId?state:null;if(!record.projet&&draft)record.projet=dossierById(draft.dossierId)?.airtableId||'';
      const res=await fetch('/api/constats',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({...record,profil:PROFILE.id})}).catch(()=>null);
      if(!res)break;if(res.ok||res.status===400||res.status===404){const latest=constatQueue();if(latest[id]===undefined||JSON.stringify(latest[id])===JSON.stringify(queue[id]))delete latest[id];writeConstatQueue(latest);}
      else break;}
  }finally{constatFlushing=false;renderCloseStatus();}}
window.addEventListener('online',flushConstats);
if(!PROFILE.pending)setTimeout(flushConstats,3000);
// Un rapport exporté rend le constat « Finalisé » dans Airtable.
const REPORT_EXPORT=/\.(html|pdf|docx)$/i;
const baseDownload=download;
download=function(blob,name,options){baseDownload(blob,name,options);if(REPORT_EXPORT.test(name)&&!/sauvegarde/.test(name))queueConstat('Finalisé');renderCloseStatus();};

// « Terminer ce constat » : il quitte le constat actuel et passe dans « Constats terminés ».
function renderCloseStatus(){const box=$('#close-status');if(!box)return;const pending=constatQueue()[state.draftId];
  box.textContent=[state.lastExport?`Dernier fichier exporté : ${state.lastExport.name} (${new Date(state.lastExport.at).toLocaleString('fr-FR')}).`:'Aucun rapport exporté pour ce constat.',
    DOSSIER_REMOTE?(pending?'Fiche Airtable : en attente d’envoi (réseau).':state.lastExport?'Fiche Airtable : à jour.':''):''].filter(Boolean).join(' ');}
$('#close-visit').addEventListener('click',async()=>{
  if(visitBusy()){alert('Terminez l’opération en cours avant de clore le constat.');return;}
  if(!state.lastExport&&!confirm('Aucun rapport n’a été téléchargé pour ce constat.\n\nLe terminer quand même ? Il restera consultable dans « Mes brouillons › Constats terminés ».'))return;
  state.closedAt=new Date().toISOString();queueConstat(state.lastExport?'Rapport envoyé':'Finalisé');
  if(!(await persistVisit())){state.closedAt='';return;}
  await startNewVisit();showPage('constats');
  notify('Constat terminé : retrouvez-le dans « Mes brouillons › Constats terminés ».');
});
async function deleteDraft(draftId){const db=await database;if(!db){localStorage.removeItem(STORAGE_KEY+'-draft-'+draftId);return;}
  return new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').delete(draftId);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
// Suppression d'un constat terminé : conseillée une fois les rapports rangés dans OneDrive (données personnelles).
$('#draft-list').addEventListener('click',async e=>{const button=e.target.closest('[data-delete-draft]');if(!button)return;const id=button.dataset.deleteDraft;
  if(id===state.draftId){alert('Ce constat est ouvert : terminez-le ou ouvrez-en un autre avant de le supprimer.');return;}
  const draft=(await listDrafts()).find(d=>d.draftId===id);if(!draft)return;
  if(!confirm(draft.lastExport?`Supprimer définitivement ce constat de l’appareil (photos, notes, feuille de présence) ?\n\nDernier fichier exporté : ${draft.lastExport.name}. Vérifiez qu’il est bien rangé dans OneDrive avant de continuer.`:'Aucun rapport n’a été exporté pour ce constat : ses photos et notes seront PERDUES.\n\nSupprimer quand même ?'))return;
  try{await deleteDraft(id);renderDrafts();}catch{alert('Suppression impossible. Réessayez.');}});

// Feuille de présence photographiée (liste des présents signée sur papier).
function renderAttendance(){const list=$('#attendance-list');if(!list)return;const ej=state.caseType==='ej',pages=state.attendance||[];
  list.innerHTML=pages.map((src,i)=>`<figure class="attendance-thumb"><img src="${escapeHtml(src)}" alt="Feuille de présence, page ${i+1}"><figcaption>Page ${i+1} <button type="button" class="remove-action" data-attendance-remove="${i}" aria-label="Supprimer la page ${i+1}">×</button></figcaption></figure>`).join('');
  $('#attendance-add').textContent=pages.length?'📷 Ajouter une page':'📷 Photographier la feuille de présence';$('#attendance-add').disabled=pages.length>=ATTENDANCE_MAX;
  $('#attendance-download').hidden=!(ej&&pages.length);
  $('#attendance-note').textContent=ej?'Expertise judiciaire : la feuille porte des noms. Elle n’est pas reproduite dans le rapport ; téléchargez-la en fichier séparé pour votre dossier OneDrive. Le rapport indique seulement qu’elle existe.':'La feuille photographiée est jointe en annexe du rapport ou du PV.';}
$('#attendance-add').addEventListener('click',()=>$('#attendance-input').click());
$('#attendance-input').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;
  if((state.attendance||[]).length>=ATTENDANCE_MAX)return;pendingImports++;
  try{const src=await compressPhoto(await readBlob(file));state.attendance=[...(state.attendance||[]),src];renderAttendance();saveVisit();notify('Feuille de présence ajoutée.');}
  catch{alert('La photo de la feuille n’a pas pu être ajoutée. Réessayez.');}finally{pendingImports--;}});
$('#attendance-list').addEventListener('click',e=>{const b=e.target.closest('[data-attendance-remove]');if(!b)return;const i=Number(b.dataset.attendanceRemove);
  if(!confirm(`Supprimer la page ${i+1} de la feuille de présence ?`))return;state.attendance.splice(i,1);renderAttendance();saveVisit();});
$('#attendance-download').addEventListener('click',async()=>{const base=exportBaseName();
  for(const [i,src] of (state.attendance||[]).entries()){const blob=dataUrlBlob(src);download(blob,`${base}_feuille-presence${state.attendance.length>1?'_p'+(i+1):''}.jpg`,{append:i>0});}});
