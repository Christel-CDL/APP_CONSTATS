'use strict';
// Sauvegarde des constats sur le serveur (VPS) avec copie dans Airtable, pour passer d'un appareil à l'autre
// (téléphone ↔ iPad) ; fin de constat ; feuille de présence photographiée.
// Envoi : à chaque enregistrement local, le constat est marqué « à envoyer » puis transmis dès que le réseau le permet.
// Les images (photos, notes, signatures) et sons sont envoyés une seule fois, sous leur empreinte SHA-256.
// Expertise judiciaire : ni donneur d'ordre ni feuille de présence (noms) ne quittent l'appareil ; l'adresse du site
// est sauvegardée ; la référence OPALEXE identifie l'expertise.
function notify(message){$('.toast').textContent=message;$('.toast').classList.add('show');setTimeout(()=>$('.toast').classList.remove('show'),5000);}
// Conversion locale (la politique de sécurité interdit fetch() sur une adresse data:).
function dataUrlParts(src){const comma=src.indexOf(','),head=src.slice(5,comma),data=src.slice(comma+1),type=head.split(';')[0]||'application/octet-stream';
  if(/;base64$/i.test(head)){const bytes=atob(data),array=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)array[i]=bytes.charCodeAt(i);return {type,bytes:array};}
  return {type,bytes:new TextEncoder().encode(decodeURIComponent(data))};}
function dataUrlBlob(src){const {type,bytes}=dataUrlParts(src);return new Blob([bytes],{type});}
function frenchDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):'';}

const CLOUD=DOSSIER_REMOTE,CLOUD_KEY='constat-cloud'+PROFILE.suffix,CLOUD_DIRTY_KEY=CLOUD_KEY+'-a-envoyer';
const readMap=key=>{try{const v=JSON.parse(localStorage.getItem(key)||'{}');return v&&typeof v==='object'?v:{};}catch{return {};}};
const writeMap=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
const cloudMeta=()=>readMap(CLOUD_KEY);
function setCloudMeta(id,patch){const all=cloudMeta();all[id]={...all[id],...patch};writeMap(CLOUD_KEY,all);}
const dirtyIds=()=>readMap(CLOUD_DIRTY_KEY);
function markDirty(id){const all=dirtyIds();all[id]=Date.now();writeMap(CLOUD_DIRTY_KEY,all);}
function clearDirty(id,stamp){const all=dirtyIds();if(stamp===undefined||all[id]===stamp){delete all[id];writeMap(CLOUD_DIRTY_KEY,all);}}
const cloud={running:false,timer:null,error:'',remote:null,remoteAt:0};
async function cloudFetch(path,options={}){const res=await fetch(path+(path.includes('?')?'&':'?')+'profil='+encodeURIComponent(PROFILE.id),{credentials:'same-origin',cache:'no-store',...options});
  if(res.status===401)throw Object.assign(new Error('Session expirée : reconnectez ce profil depuis l’écran de lancement.'),{status:401});return res;}
const hashCache=new Map();
async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
// Remplace chaque image ou son intégré par « fichier:<empreinte> » et collecte les fichiers à envoyer.
async function extractBlobs(value,blobs){
  if(typeof value==='string'&&value.startsWith('data:')){let hash=hashCache.get(value);const parts=dataUrlParts(value);if(!hash){hash=await sha256(parts.bytes);if(hashCache.size>500)hashCache.clear();hashCache.set(value,hash);}blobs.set(hash,parts);return 'fichier:'+hash;}
  if(Array.isArray(value))return Promise.all(value.map(v=>extractBlobs(v,blobs)));
  if(value&&typeof value==='object'){const out={};for(const [k,v] of Object.entries(value))out[k]=await extractBlobs(v,blobs);return out;}
  return value;}
const blobCache=new Map();
async function restoreBlobs(value){
  if(typeof value==='string'&&/^fichier:[a-f0-9]{64}$/.test(value)){const hash=value.slice(8);if(!blobCache.has(hash)){const res=await cloudFetch('/api/fichiers/'+hash);if(!res.ok)throw new Error('Fichier absent du serveur');blobCache.set(hash,await readBlob(await res.blob()));}return blobCache.get(hash);}
  if(Array.isArray(value))return Promise.all(value.map(restoreBlobs));
  if(value&&typeof value==='object'){const out={};for(const [k,v] of Object.entries(value))out[k]=await restoreBlobs(v);return out;}
  return value;}
const emptyDraft=d=>!d.photos?.length&&!String(d.caseName||'').trim()&&!String(d.caseReference||'').trim()&&!d.closedAt;
const statusOf=d=>d.closedAt?(d.lastExport?'Rapport envoyé':'Finalisé'):d.lastExport?'Finalisé':'Brouillon';
// Contenu envoyé au serveur ; l'empreinte ignore l'heure d'enregistrement et le sujet affiché, pour ne pas
// renvoyer (ni signaler en conflit) un constat simplement rouvert sans modification.
async function cloudVersionOf(draft,blobs=new Map()){const visit=structuredClone(draft);if(visit.caseType==='ej'){visit.attendance=[];visit.clientName='';visit.clientAddress='';}
  // Identité du dossier seulement (ses dates changent à chaque synchronisation des dossiers).
  if(visit.dossier&&typeof visit.dossier==='object'){const {id,name,reference,type,address,client,status,airtableId}=visit.dossier;visit.dossier={id,name,reference,type,address,client:visit.caseType==='ej'?'':client,status,airtableId};}
  const clean=await extractBlobs(visit,blobs),{savedAt,activeSubject,...content}=clean;
  return {clean,fingerprint:await sha256(new TextEncoder().encode(canonicalJson(content)))};}
// Forme canonique : clés triées, valeurs vides ignorées (l'ordre des champs change après une réouverture).
function canonicalJson(value){if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined&&value[k]!==null&&value[k]!=='').map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')+'}';
  return JSON.stringify(value??null);}
async function pushDraft(id,force=false){
  const stamp=dirtyIds()[id],draft=(await listDrafts()).find(d=>d.draftId===id);
  if(!draft||emptyDraft(draft)){clearDirty(id,stamp);return 'skip';}
  const blobs=new Map(),{clean,fingerprint}=await cloudVersionOf(draft,blobs),meta=cloudMeta()[id]||{};
  if(!force&&meta.version&&meta.fingerprint===fingerprint){clearDirty(id,stamp);return 'same';}
  if(blobs.size){const res=await cloudFetch('/api/fichiers/manquants',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hashes:[...blobs.keys()]})});if(!res.ok)throw new Error('Serveur indisponible');
    for(const hash of (await res.json()).manquants){const part=blobs.get(hash);const up=await cloudFetch('/api/fichiers/'+hash,{method:'PUT',headers:{'Content-Type':part.type},body:part.bytes});if(!up.ok)throw new Error('Envoi d’un fichier refusé ('+up.status+')');}}
  const res=await cloudFetch('/api/constats/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({visit:clean,baseVersion:cloudMeta()[id]?.version||0,status:statusOf(draft),force})});
  const body=await res.json().catch(()=>({}));
  if(res.status===409){setCloudMeta(id,{conflict:body.constat||{}});return 'conflict';}
  if(!res.ok)throw new Error(body.message||'Sauvegarde serveur impossible');
  setCloudMeta(id,{version:body.constat.version,fingerprint,syncedAt:new Date().toISOString(),conflict:null});clearDirty(id,stamp);cloud.remote=null;return 'ok';}
async function flushCloud(){if(!CLOUD||cloud.running||!ready)return;clearTimeout(cloud.timer);
  if(!navigator.onLine){cloud.error='';renderCloudStatus();return;}
  cloud.running=true;cloud.error='';
  let changed=false;
  try{for(const id of Object.keys(dirtyIds())){if(cloudMeta()[id]?.conflict)continue;const result=await pushDraft(id);changed||=result==='ok'||result==='conflict';}}
  catch(error){cloud.error=error.message||'Sauvegarde serveur impossible';scheduleCloud(60000);}
  finally{cloud.running=false;renderCloudStatus();if(changed)renderDrafts();}}
function scheduleCloud(delay=15000){if(!CLOUD)return;clearTimeout(cloud.timer);cloud.timer=setTimeout(flushCloud,delay);}
// Chaque enregistrement local réussi marque le constat « à envoyer ».
if(CLOUD){const basePersist=persistVisit;persistVisit=function(){const id=state.draftId;return basePersist().then(ok=>{if(ok&&id){markDirty(id);scheduleCloud();}return ok;});};
  window.addEventListener('online',()=>scheduleCloud(1000));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushCloud();});
  if(!PROFILE.pending)setTimeout(startupCloud,2500);}
async function remoteConstats(maxAge=60000){if(!CLOUD||!navigator.onLine)return null;
  if(cloud.remote&&Date.now()-cloud.remoteAt<maxAge)return cloud.remote;
  try{const res=await cloudFetch('/api/constats');if(!res.ok)return null;cloud.remote=(await res.json()).constats;cloud.remoteAt=Date.now();return cloud.remote;}catch{return null;}}
async function writeDraftRecord(value){const db=await database;if(!db){localStorage.setItem(STORAGE_KEY+'-draft-'+value.draftId,JSON.stringify(value));return;}
  return new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(value,value.draftId);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
// Récupère la version du serveur sur cet appareil (sans la renvoyer ensuite).
async function pullDraft(id){const res=await cloudFetch('/api/constats/'+encodeURIComponent(id));if(!res.ok)throw new Error('Constat introuvable sur le serveur');
  const {version,visit}=await res.json(),restored=await restoreBlobs(visit);normalizeVisit(restored);
  // Le dossier porte un identifiant propre à chaque appareil : on le retrouve par son identifiant Airtable.
  const dossier=restored.dossier;if(dossier&&typeof dossier==='object'){const same=/^rec\w{14}$/.test(dossier.airtableId||'')&&readDossiers().find(d=>d.airtableId===dossier.airtableId);
    if(same)restored.dossierId=same.id;else if(!dossierById(dossier.id)){importDossier(dossier);if(dossier.airtableId){const list=readDossiers(),added=list.find(d=>d.id===dossier.id);if(added){added.airtableId=dossier.airtableId;writeDossiers(list);}}}}
  let local=restored;if(id===state.draftId){restoreState(restored);local=snapshot();await dbWrite(local);}else await writeDraftRecord(restored);
  setCloudMeta(id,{version,fingerprint:(await cloudVersionOf(local)).fingerprint,conflict:null,syncedAt:new Date().toISOString()});clearDirty(id);}
// Au lancement : les constats de cet appareil modifiés entre-temps sur un autre appareil sont mis à jour
// (seulement s'ils n'ont pas de modification locale en attente d'envoi).
async function startupCloud(){if(!ready){setTimeout(startupCloud,1000);return;}
  const local=await listDrafts(),meta=cloudMeta();
  // Constat marqué « à envoyer » sans modification réelle (simple réouverture) : rien à envoyer.
  for(const id of Object.keys(dirtyIds())){const d=local.find(x=>x.draftId===id);if(d&&meta[id]?.fingerprint&&!meta[id].conflict&&(await cloudVersionOf(d)).fingerprint===meta[id].fingerprint)clearDirty(id);}
  const remote=await remoteConstats(0);if(remote){const dirty=dirtyIds();
    for(const r of remote){const mine=local.find(d=>d.draftId===r.draftId);if(mine&&!dirty[r.draftId]&&r.version>(meta[r.draftId]?.version||0)){try{await pullDraft(r.draftId);}catch(error){console.warn(error);}}}}
  await flushCloud();renderDrafts();}
function cloudBadge(d){if(!CLOUD||emptyDraft(d))return '';const meta=cloudMeta()[d.draftId]||{},remote=cloud.remote?.find(r=>r.draftId===d.draftId);
  if(meta.conflict)return `<p class="cloud-badge warn">⚠ Modifié aussi sur un autre appareil (${escapeHtml(new Date(meta.conflict.updatedAt||Date.now()).toLocaleString('fr-FR'))}).</p><div class="cloud-actions"><button class="secondary" data-cloud-pull="${escapeHtml(d.draftId)}">Prendre la version de l’autre appareil</button><button class="secondary" data-cloud-force="${escapeHtml(d.draftId)}">Garder la version de cet appareil</button></div>`;
  if(dirtyIds()[d.draftId])return `<p class="cloud-badge">⏳ Modifications en attente d’envoi au serveur</p>`;
  if(remote&&remote.version>(meta.version||0))return `<p class="cloud-badge">☁ Version plus récente sur un autre appareil</p><div class="cloud-actions"><button class="secondary" data-cloud-pull="${escapeHtml(d.draftId)}">Mettre à jour cet appareil</button></div>`;
  const copy=remote?.airtable;return meta.version?`<p class="cloud-badge ${copy&&copy.startsWith('erreur')?'warn':'ok'}">☁ Sauvegardé sur le serveur · Airtable : ${escapeHtml(copy||'copie différée')}</p>`:'';}
async function renderCloudSection(local){const box=$('#cloud-list');if(!box)return;if(!CLOUD){box.innerHTML='';return;}
  const remote=await remoteConstats();if(!remote){box.innerHTML='';return;}
  const ids=new Set(local.map(d=>d.draftId)),others=remote.filter(r=>!ids.has(r.draftId)).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const card=r=>`<article class="draft-card cloud"><div><h2>${escapeHtml([r.caseReference,r.caseType==='ej'?'':r.caseName].filter(Boolean).join(' — ')||'Constat')}</h2><p>${r.photos} photo(s) · visite du ${escapeHtml(frenchDate(r.visitDate))}</p><small>Sauvegardé le ${escapeHtml(new Date(r.updatedAt).toLocaleString('fr-FR'))}${r.closedAt?' · terminé':''}</small></div><div class="draft-buttons"><button class="primary" data-cloud-pull="${escapeHtml(r.draftId)}">Récupérer sur cet appareil</button></div></article>`;
  const open=others.filter(r=>!r.closedAt),closed=others.filter(r=>r.closedAt);
  box.innerHTML=(open.length?`<h2 class="draft-section">Sur vos autres appareils (${open.length})</h2><p class="muted draft-section-note">Constats en cours sauvegardés depuis un autre appareil : récupérez-les pour continuer ici.</p>${open.map(card).join('')}`:'')
    +(closed.length?`<details class="cloud-closed"><summary>Constats terminés sauvegardés sur le serveur (${closed.length})</summary>${closed.map(card).join('')}</details>`:'');}
function renderCloudStatus(){const box=$('#cloud-status');if(!box)return;box.hidden=!CLOUD;if(!CLOUD)return;const pending=Object.keys(dirtyIds()).length,conflicts=Object.values(cloudMeta()).filter(m=>m.conflict).length;
  box.textContent=conflicts?`⚠ ${conflicts} constat(s) modifié(s) sur deux appareils : choisissez la version à garder ci-dessous.`:!navigator.onLine&&pending?`⏳ Hors réseau : ${pending} constat(s) seront sauvegardés au retour de la connexion.`:cloud.error?`⚠ ${cloud.error} — nouvel essai automatique.`:pending?`⏳ Sauvegarde en cours (${pending})…`:'☁ Constats sauvegardés sur le serveur ; copie dans Airtable.';
  renderCloseStatus();}
document.addEventListener('click',async e=>{const pull=e.target.closest('[data-cloud-pull]'),force=e.target.closest('[data-cloud-force]');if(!pull&&!force)return;
  if(visitBusy()){alert('Terminez l’opération en cours.');return;}const button=pull||force;button.disabled=true;
  try{if(pull){const id=pull.dataset.cloudPull;if(dirtyIds()[id]&&!confirm('Les modifications de cet appareil non envoyées seront remplacées par la version de l’autre appareil. Continuer ?'))return;
      if(id===state.draftId&&unsaved)await persistVisit();await pullDraft(id);notify('Constat récupéré sur cet appareil.');}
    else{const id=force.dataset.cloudForce;if(!confirm('La version de l’autre appareil sera remplacée par celle-ci. Continuer ?'))return;setCloudMeta(id,{conflict:null});markDirty(id);await pushDraft(id,true);notify('Version de cet appareil sauvegardée.');}
    cloud.remote=null;renderDrafts();}
  catch(error){alert((error.message||'Opération impossible')+'. Vérifiez la connexion et réessayez.');}finally{button.disabled=false;renderCloudStatus();}});

// « Terminer ce constat » : il quitte le constat actuel et passe dans « Constats terminés ».
function renderCloseStatus(){const box=$('#close-status');if(!box)return;const meta=cloudMeta()[state.draftId]||{};
  box.textContent=[state.lastExport?`Dernier fichier enregistré : ${state.lastExport.name} (${new Date(state.lastExport.at).toLocaleString('fr-FR')}).`:'Aucun rapport enregistré pour ce constat.',
    CLOUD?(dirtyIds()[state.draftId]?'Sauvegarde serveur : en attente.':meta.version?'Sauvegarde serveur : à jour.':''):''].filter(Boolean).join(' ');}
$('#close-visit').addEventListener('click',async()=>{
  if(visitBusy()){alert('Terminez l’opération en cours avant de clore le constat.');return;}
  if(!state.lastExport&&!confirm('Aucun rapport n’a été enregistré pour ce constat.\n\nLe terminer quand même ? Il restera consultable dans « Mes brouillons › Constats terminés ».'))return;
  state.closedAt=new Date().toISOString();
  if(!(await persistVisit())){state.closedAt='';return;}
  scheduleCloud(500);await startNewVisit();showPage('constats');
  notify('Constat terminé : retrouvez-le dans « Mes brouillons › Constats terminés ».');
});
async function deleteDraft(draftId){const db=await database;if(!db){localStorage.removeItem(STORAGE_KEY+'-draft-'+draftId);return;}
  return new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').delete(draftId);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
// Suppression d'un constat terminé de l'appareil : il reste sauvegardé sur le serveur et dans Airtable.
$('#draft-list').addEventListener('click',async e=>{const button=e.target.closest('[data-delete-draft]');if(!button)return;const id=button.dataset.deleteDraft;
  if(id===state.draftId){alert('Ce constat est ouvert : terminez-le ou ouvrez-en un autre avant de le supprimer.');return;}
  const draft=(await listDrafts()).find(d=>d.draftId===id);if(!draft)return;
  const saved=CLOUD&&cloudMeta()[id]?.version&&!dirtyIds()[id];
  if(!confirm(saved?'Retirer ce constat de cet appareil ?\n\nIl reste sauvegardé sur le serveur (récupérable dans « Constats terminés sauvegardés »).':draft.lastExport?`Supprimer définitivement ce constat de l’appareil (photos, notes, feuille de présence) ?\n\nDernier fichier enregistré : ${draft.lastExport.name}. Vérifiez qu’il est bien rangé dans OneDrive avant de continuer.`:'Aucun rapport n’a été enregistré pour ce constat et il n’est pas sauvegardé sur le serveur : ses photos et notes seront PERDUES.\n\nSupprimer quand même ?'))return;
  try{await deleteDraft(id);clearDirty(id);renderDrafts();}catch{alert('Suppression impossible. Réessayez.');}});

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
$('#attendance-download').addEventListener('click',async()=>{const base=exportBaseName(),pages=state.attendance||[];
  const files=pages.map((src,i)=>new File([dataUrlBlob(src)],`${base}_feuille-presence${pages.length>1?'_p'+(i+1):''}.jpg`,{type:'image/jpeg'}));
  if(files.length===1){await download(files[0],files[0].name);return;}
  if(TOUCH_DEVICE&&canShareFiles(files)){sharedFiles=files;try{await navigator.share({files,title:files[0].name});}catch{showShareBar(`${files.length} pages prêtes. Touchez « Enregistrer… ».`,true);}return;}
  for(const file of files)await download(file,file.name);});
