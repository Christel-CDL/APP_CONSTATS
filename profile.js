'use strict';
// Profil actif, choisi sur l'écran de lancement (demarrer.html). Chargé avant tous les autres scripts :
// il détermine l'espace de stockage local (IndexedDB, localStorage) propre à chaque profil.
const PROFILE_TYPES={'Expert judiciaire':['ej','autre'],'Expert':['ep','autre']};
function profileFrom(value){
  if(!value||typeof value.id!=='string'||!/^[\w-]{1,40}$/.test(value.id))return null;
  const types=Array.isArray(value.types)&&value.types.length?value.types.filter(t=>['ej','ep','autre'].includes(t)):PROFILE_TYPES[value.role]||['ej','ep','autre'];
  // Profils serveur : espace « -u-<id> ». Mode local sans compte (serveur de développement) : anciennes clés, sans suffixe.
  return {id:value.id,name:String(value.name||''),email:String(value.email||''),role:String(value.role||''),organisation:String(value.organisation||''),types,defaultType:types[0]==='autre'||types.length>2?'autre':types[0],suffix:value.id==='local'?'':'-u-'+value.id};
}
const PROFILE=(()=>{
  if(new URLSearchParams(location.search).get('verification')==='1')return {id:'verification',name:'Vérification',email:'',role:'Test',organisation:'',types:['ej','ep','autre'],defaultType:'autre',suffix:'-verification'};
  try{const profile=profileFrom(JSON.parse(sessionStorage.getItem('constat-profile')||'null'));if(profile)return profile;}catch{}
  // Aucun profil choisi pour ce lancement : retour à l'écran de lancement, sans toucher aux données.
  // L'initialisation (field-app.js) s'interrompt pour ce profil « en attente » ; window.stop() annulerait la redirection.
  location.replace('./demarrer.html');document.documentElement.style.visibility='hidden';
  return {id:'pending',name:'',email:'',role:'',organisation:'',types:[],defaultType:'autre',suffix:'-pending',pending:true};
})();
function profileAllows(type){return PROFILE.types.includes(type);}
