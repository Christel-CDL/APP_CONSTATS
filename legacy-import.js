'use strict';
// Constats enregistrés sur cet appareil avant les comptes (base sans suffixe) : proposés une seule fois au premier
// profil ouvert, par copie. La base d'origine n'est jamais effacée ; rien n'est perdu si l'on refuse.
const LEGACY_IMPORT=(async()=>{
  if(!PROFILE.suffix.startsWith('-u-')||!window.indexedDB)return;
  const owner='constat-legacy-owner';
  try{if(localStorage.getItem(owner))return;}catch{return;}
  const open=(name,upgrade)=>new Promise((resolve,reject)=>{const req=indexedDB.open(name,2);req.onupgradeneeded=()=>upgrade?upgrade(req.result):req.transaction.abort();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('blocked'));});
  try{
    if(indexedDB.databases&&!(await indexedDB.databases()).some(d=>d.name==='constat-visits'))return;
    const legacy=await open('constat-visits');
    if(!legacy.objectStoreNames.contains('drafts')){legacy.close();return;}
    const drafts=await new Promise((resolve,reject)=>{const r=legacy.transaction('drafts').objectStore('drafts').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});legacy.close();
    let dossiers=[];try{dossiers=JSON.parse(localStorage.getItem('constat-dossiers')||'[]');}catch{}
    if(!drafts.length&&!dossiers.length){localStorage.setItem(owner,'vide');return;}
    if(!confirm(`${drafts.length} constat(s) et ${dossiers.length} dossier(s) ont été enregistrés sur cet appareil avant la création des comptes.\n\nLes rattacher au profil « ${PROFILE.name||PROFILE.email} » ?\n\nOK : copie dans ce profil (l'original reste sur l'appareil).\nAnnuler : la question sera posée au prochain profil ouvert.`))return;
    const target=await open('constat-visits'+PROFILE.suffix,db=>{for(const store of ['visits','drafts'])if(!db.objectStoreNames.contains(store))db.createObjectStore(store);});
    await new Promise((resolve,reject)=>{const tx=target.transaction('drafts','readwrite'),store=tx.objectStore('drafts');for(const d of drafts)if(d&&typeof d.draftId==='string')store.put(d,d.draftId);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});target.close();
    const key='constat-dossiers'+PROFILE.suffix;let current=[];try{current=JSON.parse(localStorage.getItem(key)||'[]');}catch{}
    localStorage.setItem(key,JSON.stringify([...current,...dossiers.filter(d=>d&&!current.some(c=>c.id===d.id))]));
    localStorage.setItem(owner,PROFILE.id);
  }catch(error){console.warn('Reprise des anciens constats :',error);}
})();
