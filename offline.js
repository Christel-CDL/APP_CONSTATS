'use strict';
(async()=>{
  const status=document.querySelector('#offline-status');
  const describe=ready=>{status.textContent=ready?(navigator.onLine?'Application disponible hors connexion sur cet appareil.':'Hors connexion : collecte, brouillons et exports disponibles. Carte et dictée en ligne indisponibles.'):'Préparation du mode hors connexion…';};
  if(!('serviceWorker' in navigator)||!window.isSecureContext){status.textContent='Le mode hors connexion nécessite HTTPS ou un serveur local.';return;}
  try{
    const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
    describe(false);await navigator.serviceWorker.ready;describe(true);
    window.addEventListener('online',()=>describe(true));window.addEventListener('offline',()=>describe(true));
    const update=()=>{if(registration.waiting)status.textContent+=' Une mise à jour sera chargée après fermeture de tous les onglets de cette application.';};
    update();registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',update));
  }catch{status.textContent='Mode hors connexion non préparé. Gardez une connexion et sauvegardez vos visites dans un fichier.';}
})();
