'use strict';
// Écran de lancement : profils connectés sur cet appareil, connexion par code e-mail, installation de l'icône.
const $=s=>document.querySelector(s);
const KNOWN='constat-known-profiles';
let loginEmail='',profiles=[],deferredInstall=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function status(text,error=false){$('#status').textContent=text;$('#status').classList.toggle('error',error);}
function show(section){for(const id of ['profiles','login'])$('#'+id).hidden=id!==section;}
async function api(path,body){const res=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});let data={};try{data=await res.json();}catch{}return {status:res.status,data};}
function roleBadge(p){const ej=(p.types||[]).includes('ej'),ep=(p.types||[]).includes('ep');return ej&&!ep?'<span class="badge ej">Expertise judiciaire</span>':ep&&!ej?'<span class="badge ep">Expertise privée</span>':'';}
function open(profile){try{sessionStorage.setItem('constat-profile',JSON.stringify(profile));}catch{}location.replace('./index.html');}
function renderProfiles(offline=false){
  $('#profile-list').innerHTML=profiles.map((p,i)=>`<div class="profile"><button class="open" data-index="${i}" type="button"><b>${esc(p.name||p.email)}</b><small>${esc(p.email)}${p.organisation?' · '+esc(p.organisation):''}</small><br>${roleBadge(p)}</button>${offline||p.id==='local'?'':`<button class="logout" data-logout="${esc(p.id)}" type="button" aria-label="Déconnecter ${esc(p.email)}">Déconnecter</button>`}</div>`).join('');
  $('#add-profile').hidden=offline||profiles.some(p=>p.id==='local');show('profiles');
}
$('#profile-list').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.index)return open(profiles[Number(b.dataset.index)]);
  if(b.dataset.logout&&confirm('Déconnecter ce profil sur cet appareil ?\n\nSes constats restent enregistrés sur l’appareil et seront retrouvés à la prochaine connexion.')){await api('/api/auth/logout',{id:b.dataset.logout});start();}
});
function startLogin(title){loginEmail='';$('#login-title').textContent=title;$('#email-form').hidden=false;$('#code-form').hidden=true;$('#cancel-login').hidden=!profiles.length;show('login');$('#email').focus();}
$('#add-profile').addEventListener('click',()=>startLogin('Ajouter un profil'));
$('#cancel-login').addEventListener('click',()=>renderProfiles());
$('#restart').addEventListener('click',()=>startLogin($('#login-title').textContent));
$('#email-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;loginEmail=$('#email').value.trim().toLowerCase();
  try{const {status:code,data}=await api('/api/auth/request',{email:loginEmail});
    if(code===429){status(data.message||'Trop de demandes. Réessayez dans quelques minutes.',true);return;}
    if(code>=400){status(data.message||'Demande impossible pour le moment.',true);return;}
    status('Si cette adresse correspond à un compte autorisé, un code vient d’être envoyé. Vérifiez aussi les courriers indésirables.');$('#email-form').hidden=true;$('#code-form').hidden=false;$('#code').value='';$('#code').focus();
  }catch{status('Connexion Internet nécessaire pour se connecter.',true);}finally{button.disabled=false;}
});
$('#code-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;
  try{await verify({email:loginEmail,code:$('#code').value.trim()});}finally{button.disabled=false;}
});
async function verify(body){
  try{const {status:code,data}=await api('/api/auth/verify',body);
    if(code!==200){status(data.message||'Code ou lien invalide ou expiré.',true);return false;}
    status('Connexion réussie.');await start(data.profile?.id);return true;
  }catch{status('Connexion Internet nécessaire pour se connecter.',true);return false;}
}
async function start(preferred){
  let result;
  try{result=await api('/api/me');}catch{result=null;}
  if(!result){// Hors connexion : profils déjà ouverts sur cet appareil.
    try{profiles=JSON.parse(localStorage.getItem(KNOWN)||'[]');}catch{profiles=[];}
    if(profiles.length){status('Hors connexion : choisissez un profil déjà ouvert sur cet appareil.');renderProfiles(true);}
    else{status('Connexion Internet nécessaire pour la première connexion.',true);show(null);}
    return;
  }
  if(result.status===404){profiles=[{id:'local',name:'Mode local',email:'Serveur de développement, sans compte',types:['ej','ep','autre']}];status('');renderProfiles();return;}
  profiles=result.status===200&&Array.isArray(result.data.profiles)?result.data.profiles:[];
  try{localStorage.setItem(KNOWN,JSON.stringify(profiles));}catch{}
  if(!profiles.length){status('');startLogin('Connexion');return;}
  if(preferred){const chosen=profiles.find(p=>p.id===preferred);if(chosen&&profiles.length===1)return open(chosen);}
  if(profiles.length===1&&!preferred&&!new URLSearchParams(location.search).has('choisir'))return open(profiles[0]);
  status(profiles.length>1?'Plusieurs profils sont ouverts sur cet appareil.':'');renderProfiles();
}
// Lien reçu par e-mail : ?jeton=...
(async()=>{
  const params=new URLSearchParams(location.search),token=params.get('jeton');
  if(token){history.replaceState(null,'',location.pathname);if(await verify({token}))return;}
  await start();
})();
// Installation de l'icône
const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
if(!standalone){const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);$('#install').hidden=false;$('#install-ios').hidden=!ios;$('#install-android').hidden=ios;
  if(ios){const ua=navigator.userAgent,other=/CriOS|FxiOS|EdgiOS/.test(ua),phone=/iPhone|iPod/.test(ua);
    // Safari iPhone : barre d'outils en bas ; Safari iPad et Chrome/Firefox/Edge : bouton dans la barre d'adresse, en haut.
    $('#install-ios-where').textContent=phone&&!other?'en bas de l’écran, au centre':'en haut à droite, dans ou à côté de la barre d’adresse';
    $('#install-ios-other').hidden=!other;}}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('#install-button').hidden=false;});
$('#install-button').addEventListener('click',async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('#install-button').hidden=true;});
