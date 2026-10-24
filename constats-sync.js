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

const CLOUD=DOSSIER_REMOTE,CLOUD_KEY='constat-cloud'+PROFILE.suffix,CLOUD_DIRTY_KEY=CLOUD_KEY+'-a-envoyer',CLOUD_DELETE_KEY=CLOUD_KEY+'-a-supprimer',CLOUD_DEPOSIT_KEY=CLOUD_KEY+'-a-ranger';
const readMap=key=>{try{const v=JSON.parse(localStorage.getItem(key)||'{}');return v&&typeof v==='object'?v:{};}catch{return {};}};
const writeMap=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
const cloudMeta=()=>readMap(CLOUD_KEY);
function setCloudMeta(id,patch){const all=cloudMeta();all[id]={...all[id],...patch};writeMap(CLOUD_KEY,all);}
const dirtyIds=()=>readMap(CLOUD_DIRTY_KEY);
function markDirty(id){const all=dirtyIds();all[id]=Date.now();writeMap(CLOUD_DIRTY_KEY,all);}
function clearDirty(id,stamp){const all=dirtyIds();if(stamp===undefined||all[id]===stamp){delete all[id];writeMap(CLOUD_DIRTY_KEY,all);}}
const deletions=()=>readMap(CLOUD_DELETE_KEY),deposits=()=>readMap(CLOUD_DEPOSIT_KEY);
const cloud={running:false,timer:null,error:'',remote:null,remoteAt:0,deleted:[]};
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
// Constat terminé et rangé dans OneDrive (sur cet appareil ou un autre) : il quitte « Mes brouillons » ; il reste dans
// son dossier et dans « Rapports », d'où il peut être rouvert pour être complété tant que le dossier est en cours.
function storedInOneDrive(d){if(!d.closedAt)return null;const remote=cloud.remote?.find(r=>r.draftId===d.draftId);return remote?.onedrive?.aJour?remote.onedrive:d.storedInOneDrive||null;}
const emptyDraft=d=>!d.photos?.length&&!String(d.caseName||'').trim()&&!String(d.caseReference||'').trim()&&!d.closedAt;
const statusOf=d=>d.closedAt?(d.lastExport?'Rapport envoyé':'Finalisé'):d.lastExport?'Finalisé':'Brouillon';
// Contenu envoyé au serveur ; l'empreinte ignore l'heure d'enregistrement et le sujet affiché, pour ne pas
// renvoyer (ni signaler en conflit) un constat simplement rouvert sans modification.
async function cloudVersionOf(draft,blobs=new Map()){const visit=structuredClone(draft);delete visit.closureReport;delete visit.storedInOneDrive;if(visit.caseType==='ej'){visit.attendance=[];visit.clientName='';visit.clientAddress='';}
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
  try{// Suppressions faites sur cet appareil (éventuellement hors réseau) : transmises au serveur, qui les répercute sur les autres appareils.
    for(const id of Object.keys(deletions())){const res=await cloudFetch('/api/constats/'+encodeURIComponent(id),{method:'DELETE'});if(!res.ok&&res.status!==404)throw new Error('Suppression sur le serveur impossible');
      const all=deletions();delete all[id];writeMap(CLOUD_DELETE_KEY,all);cloud.remote=null;}
    for(const id of Object.keys(dirtyIds())){if(cloudMeta()[id]?.conflict)continue;const result=await pushDraft(id);changed||=result==='ok'||result==='conflict';}
    changed=(await flushDeposits())||changed;}
  catch(error){cloud.error=error.message||'Sauvegarde serveur impossible';scheduleCloud(60000);}
  finally{cloud.running=false;renderCloudStatus();if(changed)renderDrafts();}}
// Constats terminés à ranger dans OneDrive : le rapport préparé à la clôture est envoyé au serveur, qui le dépose avec les
// photos dans le dossier OneDrive de la mission (une fois le constat terminé sauvegardé sur le serveur).
async function flushDeposits(){let changed=false;
  for(const id of Object.keys(deposits())){if(dirtyIds()[id]||!cloudMeta()[id]?.version)continue;
    const draft=(await listDrafts()).find(d=>d.draftId===id),forget=()=>{const all=deposits();delete all[id];writeMap(CLOUD_DEPOSIT_KEY,all);};
    if(!draft||!draft.closedAt){forget();continue;}
    const res=await cloudFetch('/api/constats/'+encodeURIComponent(id)+'/depot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({html:draft.closureReport?.html||'',name:draft.closureReport?.name||''})});
    const body=await res.json().catch(()=>({}));
    if(res.status===428){cloud.error=body.message;continue;}
    if(res.ok||res.status===422||res.status===409||res.status===404){forget();changed=true;
      if(res.ok){const {closureReport,...rest}=draft;await writeDraftRecord({...rest,storedInOneDrive:{at:new Date().toISOString(),fichiers:body.fichiers}});cloud.remote=null;notify(`Constat rangé dans OneDrive (${body.fichiers} fichier(s)) : ${body.dossier}.`);}
      else notify('Constat non rangé dans OneDrive : '+(body.message||'erreur')+'.');continue;}
    throw new Error(body.message||'Rangement dans OneDrive impossible');}
  return changed;}
function scheduleCloud(delay=15000){if(!CLOUD)return;clearTimeout(cloud.timer);cloud.timer=setTimeout(flushCloud,delay);}
// Chaque enregistrement local réussi marque le constat « à envoyer ».
if(CLOUD){const basePersist=persistVisit;persistVisit=function(){const id=state.draftId;return basePersist().then(ok=>{if(ok&&id){markDirty(id);scheduleCloud();}return ok;});};
  window.addEventListener('online',()=>scheduleCloud(1000));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushCloud();});
  if(!PROFILE.pending)setTimeout(startupCloud,2500);}
async function remoteConstats(maxAge=60000){if(!CLOUD||!navigator.onLine)return null;
  if(cloud.remote&&Date.now()-cloud.remoteAt<maxAge)return cloud.remote;
  try{const res=await cloudFetch('/api/constats');if(!res.ok)return null;const body=await res.json();cloud.remote=body.constats;cloud.deleted=Array.isArray(body.supprimes)?body.supprimes:[];cloud.remoteAt=Date.now();return cloud.remote;}catch{return null;}}
async function writeDraftRecord(value){const db=await database;if(!db){localStorage.setItem(STORAGE_KEY+'-draft-'+value.draftId,JSON.stringify(value));return;}
  return new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(value,value.draftId);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
// Récupère la version du serveur sur cet appareil (sans la renvoyer ensuite).
async function pullDraft(id){const res=await cloudFetch('/api/constats/'+encodeURIComponent(id));if(!res.ok)throw new Error('Constat introuvable sur le serveur');
  const {version,visit}=await res.json(),restored=await restoreBlobs(visit);normalizeVisit(restored);
  // Le dossier porte un identifiant propre à chaque appareil : on le retrouve par son identifiant Airtable.
  const dossier=restored.dossier;if(dossier&&typeof dossier==='object'){const ref=String(dossier.reference||'').toUpperCase(),same=readDossiers().find(d=>dossier.airtableId&&d.airtableId===dossier.airtableId)||(ref&&readDossiers().find(d=>d.airtableId&&String(d.reference||'').toUpperCase()===ref));
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
    // Supprimés depuis un autre appareil : retirés ici aussi, sauf modification locale non envoyée (elle recrée le constat).
    for(const id of cloud.deleted)if(local.some(d=>d.draftId===id)&&!dirty[id]){try{await removeLocalDraft(id);}catch(error){console.warn(error);}}
    for(const r of remote){const mine=local.find(d=>d.draftId===r.draftId);if(mine&&!dirty[r.draftId]&&r.version>(meta[r.draftId]?.version||0)){try{await pullDraft(r.draftId);}catch(error){console.warn(error);}}}}
  await flushCloud();renderDrafts();}
function cloudBadge(d){if(!CLOUD||emptyDraft(d))return '';const meta=cloudMeta()[d.draftId]||{},remote=cloud.remote?.find(r=>r.draftId===d.draftId);
  if(meta.conflict)return `<p class="cloud-badge warn">⚠ Modifié aussi sur un autre appareil (${escapeHtml(new Date(meta.conflict.updatedAt||Date.now()).toLocaleString('fr-FR'))}).</p><div class="cloud-actions"><button class="secondary" data-cloud-pull="${escapeHtml(d.draftId)}">Prendre la version de l’autre appareil</button><button class="secondary" data-cloud-force="${escapeHtml(d.draftId)}">Garder la version de cet appareil</button></div>`;
  if(dirtyIds()[d.draftId])return `<p class="cloud-badge">⏳ Modifications en attente d’envoi au serveur</p>`;
  if(remote&&remote.version>(meta.version||0))return `<p class="cloud-badge">☁ Version plus récente sur un autre appareil</p><div class="cloud-actions"><button class="secondary" data-cloud-pull="${escapeHtml(d.draftId)}">Mettre à jour cet appareil</button></div>`;
  const stored=storedInOneDrive(d),ended=remote?.dossierTermine&&!stored;
  return (deposits()[d.draftId]?'<p class="cloud-badge">⏳ À ranger dans OneDrive</p>':stored?`<p class="cloud-badge ok">📁 Rangé dans OneDrive le ${escapeHtml(new Date(stored.at).toLocaleString('fr-FR'))}</p>`:'')
    +(ended?'<p class="cloud-badge warn">⚠ Dossier terminé dans le tableau de suivi : ce constat n’est pas rangé dans OneDrive. Rouvrez-le et terminez-le pour le ranger, ou supprimez-le.</p>':'')
    +(meta.version?'<p class="cloud-badge ok">☁ Sauvegardé sur le serveur</p>':'');}
async function renderCloudSection(local){const box=$('#cloud-list');if(!box)return;if(!CLOUD){box.innerHTML='';return;}
  const remote=await remoteConstats();if(!remote){box.innerHTML='';return;}
  const ids=new Set(local.map(d=>d.draftId)),others=remote.filter(r=>!ids.has(r.draftId)).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const card=r=>`<article class="draft-card cloud"><div><h2>${escapeHtml([r.caseReference,r.caseType==='ej'?'':r.caseName].filter(Boolean).join(' — ')||'Constat')}</h2><p>${r.photos} photo(s) · visite du ${escapeHtml(frenchDate(r.visitDate))}</p><small>Sauvegardé le ${escapeHtml(new Date(r.updatedAt).toLocaleString('fr-FR'))}${r.closedAt?' · terminé':''}</small></div><div class="draft-buttons"><button class="primary" data-cloud-pull="${escapeHtml(r.draftId)}">Récupérer sur cet appareil</button></div></article>`;
  const open=others.filter(r=>!r.closedAt),closed=others.filter(r=>r.closedAt&&!r.onedrive?.aJour);
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
  // Rapport préparé maintenant (constat affiché) pour son rangement dans OneDrive avec les photos.
  const closedId=state.draftId,report=CLOUD?closureReport():null;
  await startNewVisit();showPage('constats');
  // Après le changement de constat (qui réenregistre le constat terminé), le rapport est joint à son enregistrement local.
  if(CLOUD){if(report){const draft=(await listDrafts()).find(d=>d.draftId===closedId);if(draft)await writeDraftRecord({...draft,closureReport:report});}
    const all=deposits();all[closedId]=Date.now();writeMap(CLOUD_DEPOSIT_KEY,all);}
  scheduleCloud(500);
  notify(CLOUD?'Constat terminé : rapport et photos seront rangés dans le dossier OneDrive de la mission.':'Constat terminé : retrouvez-le dans « Mes brouillons › Constats terminés ».');
});
function closureReport(){try{if(pvMode())return {html:buildPvHtml(pvReportData()),name:pvFileName(state.pv.document,state.caseReference,state.visitDate)};
    const simple=state.caseType==='ep'&&state.pv.document==='simple';
    return {html:buildConstatHtml({simple,expertSignature:state.expertSigns?state.expertSignature:null,type:state.caseType,reference:state.caseReference,caseName:state.caseName,visitDate:state.visitDate,photos:state.photos,subjects:state.subjects,actions:collectActions(),position:state.position,hideNominatif:state.hideNominatif,attendance:state.attendance,...Object.fromEntries(REPORT_TEXT_FIELDS.map(key=>[key,reportFieldValue(key)]))}),
      name:simple?pvFileName('simple',state.caseReference,state.visitDate):reportFileName(state.caseReference,state.visitDate)};}
  catch(error){console.warn('Rapport de clôture :',error);return null;}}
async function deleteDraft(draftId){const db=await database;if(!db){localStorage.removeItem(STORAGE_KEY+'-draft-'+draftId);return;}
  return new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').delete(draftId);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
// Suppression d'un constat (en cours ou terminé) : effacé de cet appareil, puis du serveur, d'Airtable et des autres appareils.
async function removeLocalDraft(id){await deleteDraft(id);clearDirty(id);{const all=deposits();if(all[id]){delete all[id];writeMap(CLOUD_DEPOSIT_KEY,all);}}const meta=cloudMeta();delete meta[id];writeMap(CLOUD_KEY,meta);
  // Constat ouvert : un constat vierge le remplace (rien n'est réenregistré).
  if(id===state.draftId){state.photos=[];state.caseName='';state.caseReference='';state.subjects=['Vue générale'];state.closedAt='';$('#action-list').innerHTML='';await startNewVisit();showPage('constats');}}
async function deleteConstat(id){
  if(visitBusy()){alert('Terminez l’opération en cours (photo, import, enregistrement) avant de supprimer un constat.');return;}
  if(id===state.draftId&&unsaved)await persistVisit();
  const draft=(await listDrafts()).find(d=>d.draftId===id);if(!draft){if(id===state.draftId)alert('Ce constat est vide : il n’y a rien à supprimer.');return;}
  const where=CLOUD?'de tous vos appareils, du serveur et d’Airtable':'de cet appareil';
  if(!confirm(`Supprimer définitivement ce constat ${where} ?\n\nPhotos, notes, sons et feuille de présence seront effacés.\n\n`+(draft.lastExport?`Dernier fichier enregistré : ${draft.lastExport.name}. Vérifiez qu’il est bien rangé dans OneDrive.`:'Aucun rapport n’a été enregistré pour ce constat : son contenu sera PERDU.')))return;
  try{if(CLOUD){const all=deletions();all[id]=Date.now();writeMap(CLOUD_DELETE_KEY,all);}
    await removeLocalDraft(id);renderDrafts();if(CLOUD)scheduleCloud(300);notify(CLOUD?'Constat supprimé ; il sera retiré de vos autres appareils à leur prochaine ouverture.':'Constat supprimé de cet appareil.');}
  catch{alert('Suppression impossible. Réessayez.');}}
$('#draft-list').addEventListener('click',e=>{const button=e.target.closest('[data-delete-draft]');if(button)deleteConstat(button.dataset.deleteDraft);});
$('#delete-current')?.addEventListener('click',()=>deleteConstat(state.draftId));

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
