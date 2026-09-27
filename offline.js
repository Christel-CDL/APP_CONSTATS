'use strict';
(async()=>{
  const status=document.querySelector('#offline-status');
  const describe=ready=>{status.textContent=ready?(navigator.onLine?'Application disponible hors connexion sur cet appareil.':'Hors connexion : collecte, brouillons et exports disponibles. Carte et dictée en ligne indisponibles.'):'Préparation du mode hors connexion…';};
  if(!('serviceWorker' in navigator)||!window.isSecureContext){status.textContent='Le mode hors connexion nécessite HTTPS ou un serveur local.';return;}
  try{
    const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
    describe(false);await navigator.serviceWorker.ready;describe(true);
    // Stockage persistant : le navigateur n'efface pas les constats de l'appareil en cas de manque d'espace.
    try{if(navigator.storage?.persist&&!(await navigator.storage.persisted()))await navigator.storage.persist();}catch{}
    window.addEventListener('online',()=>describe(true));window.addEventListener('offline',()=>describe(true));
    // Nouvelle version : rechargement automatique si aucune saisie n'est en cours, sinon proposition de recharger.
    let reloading=false;registration.update().catch(()=>{});
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloading)return;
      const busy=typeof unsaved!=='undefined'&&(unsaved||(typeof visitBusy==='function'&&visitBusy()));
      if(!busy){reloading=true;location.reload();return;}
      status.innerHTML='Nouvelle version disponible. <button type="button" class="secondary" id="reload-app">Recharger maintenant</button> (vos saisies sont enregistrées)';
      document.querySelector('#reload-app')?.addEventListener('click',async()=>{if(typeof persistVisit==='function')await persistVisit();reloading=true;location.reload();});});
  }catch{status.textContent='Mode hors connexion non préparé. Gardez une connexion et sauvegardez vos visites dans un fichier.';}
})();
