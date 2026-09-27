'use strict';
const PREFIX='constat-shell-'+self.registration.scope;
const CACHE=PREFIX+'v20260927-4';
const ASSETS=['./','index.html','demarrer.html','launcher.js','launcher.css','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png','profile.js','legacy-import.js','styles.css','refinements.css','field-app.js','report-logo.js','html-report.js','cdl-report.js','pv-report.js','pv-editor.js','signature.js','drawing.js','drafts.js','dossiers.js','visit-access.js','pdf-report.js','word-report.js','export-actions.js','offline.js','vendor/pdf-lib.min.js','vendor/docx.js'];
const urls=ASSETS.map(path=>new URL(path,self.registration.scope).href);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(urls))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);url.search='';
  if(!urls.includes(url.href))return;
  // Pages : réseau d'abord, pour que le contrôle d'accès du serveur s'applique ; cache seulement hors connexion.
  if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(async()=>(await caches.open(CACHE)).match(url.href)));return;}
  // Keep the release coherent until old tabs close; never cache visits or other sites.
  event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.href))||fetch(event.request)));
});
