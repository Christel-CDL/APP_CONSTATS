'use strict';
// Disabled source tracks are reused; each capture gets its own clone.
const visitAccess = {attempted:false,pending:null,tracks:[],streams:[],watch:null,position:null,
  generation:0,waiters:[],geoBlocked:false,mediaMessage:'Accès non préparés.',geoMessage:'Localisation non démarrée.'};
function accessStatus(){ $('#access-status').textContent=visitAccess.mediaMessage+' '+visitAccess.geoMessage; }
function receivePosition(p){
  visitAccess.position={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,measuredAt:new Date(p.timestamp).toISOString()};
  visitAccess.geoMessage='Localisation active.';state.position={...visitAccess.position};
  showPosition();accessStatus();visitAccess.waiters.splice(0).forEach(resolve=>resolve({...visitAccess.position}));saveVisit();
}
function startLocationWatch(force=false){
  if(visitAccess.watch!==null||(visitAccess.geoBlocked&&!force))return;
  if(!navigator.geolocation){visitAccess.geoMessage='Localisation indisponible.';accessStatus();return;}
  const generation=visitAccess.generation;
  visitAccess.geoBlocked=false;visitAccess.geoMessage='Recherche de la position…';accessStatus();
  visitAccess.watch=navigator.geolocation.watchPosition(p=>{if(generation===visitAccess.generation)receivePosition(p);},error=>{
    if(generation!==visitAccess.generation)return;
    visitAccess.position=null;
    visitAccess.geoMessage=error.code===1?'Localisation refusée : autorisez-la dans les réglages du navigateur.':error.code===2?'Position indisponible : vérifiez la localisation de l’appareil.':'Position non obtenue ; la recherche continue.';
    if(error.code===1){visitAccess.geoBlocked=true;navigator.geolocation.clearWatch(visitAccess.watch);visitAccess.watch=null;}
    $('#geo-status small').textContent=visitAccess.geoMessage;accessStatus();visitAccess.waiters.splice(0).forEach(resolve=>resolve(null));
  },{enableHighAccuracy:true,maximumAge:0,timeout:20000});
}
function recentPosition(maxAge=15000){
  const p=visitAccess.position,age=p?Date.now()-Date.parse(p.measuredAt):Infinity;
  return validPosition(p)&&age>=-1000&&age<=maxAge?{...p}:null;
}
function sessionPosition(){
  const cached=recentPosition();if(cached)return Promise.resolve(cached);
  if(visitAccess.watch===null||visitAccess.geoBlocked)return Promise.resolve(null);
  return new Promise(resolve=>{
    const finish=value=>{clearTimeout(timer);visitAccess.waiters=visitAccess.waiters.filter(fn=>fn!==finish);resolve(value);};
    const timer=setTimeout(()=>finish(null),12000);visitAccess.waiters.push(finish);
  });
}
async function prepareVisitAccess(force=false){
  if(visitAccess.pending)return visitAccess.pending;
  if(visitAccess.attempted&&!force)return;
  visitAccess.attempted=true;startLocationWatch(force);
  const generation=visitAccess.generation;
  visitAccess.mediaMessage='Préparation caméra et microphone…';accessStatus();
  const operation=(async()=>{
    const tracks=[],streams=[];
    const retain=stream=>{streams.push(stream);tracks.push(...stream.getTracks());};
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
      const missing=['video','audio'].filter(kind=>!visitAccess.tracks.some(t=>t.kind===kind&&t.readyState==='live'));
      if(missing.length){
        try{retain(await navigator.mediaDevices.getUserMedia({video:missing.includes('video')?{facingMode:{ideal:'environment'}}:false,audio:missing.includes('audio')}));}
        catch(error){
          if(error.name!=='NotFoundError'&&error.name!=='OverconstrainedError')throw error;
          for(const kind of missing){if(generation!==visitAccess.generation)break;try{retain(await navigator.mediaDevices.getUserMedia(kind==='video'?{video:{facingMode:{ideal:'environment'}}}:{audio:true}));}catch{}}
        }
      }
      if(generation!==visitAccess.generation){tracks.forEach(t=>t.stop());return;}
      tracks.forEach(t=>{t.enabled=false;});visitAccess.tracks=visitAccess.tracks.filter(t=>t.readyState==='live');visitAccess.tracks.push(...tracks);visitAccess.streams.push(...streams);
      const live=kind=>visitAccess.tracks.some(t=>t.kind===kind&&t.readyState==='live');
      visitAccess.mediaMessage=`Caméra ${live('video')?'prête':'indisponible'} · Microphone ${live('audio')?'prêt':'indisponible'}. En pause hors capture.`;
    }catch(error){
      tracks.forEach(t=>t.stop());if(generation!==visitAccess.generation)return;
      visitAccess.mediaMessage=error.name==='NotAllowedError'?'Accès caméra/micro refusé. Autorisez-les dans le navigateur, puis réessayez.':'Caméra/micro indisponibles. Vous pouvez importer des photos.';
    }
  })();
  visitAccess.pending=operation;
  try{await operation;}finally{if(generation===visitAccess.generation){visitAccess.pending=null;accessStatus();}}
}
async function acquireVisitStream(kind){
  await prepareVisitAccess();
  // Mobile browsers can end a previously granted track after backgrounding.
  if(visitAccess.tracks.some(t=>t.kind===kind)&&!visitAccess.tracks.some(t=>t.kind===kind&&t.readyState==='live'))await prepareVisitAccess(true);
  const track=visitAccess.tracks.find(t=>t.kind===kind&&t.readyState==='live');
  if(!track)throw new Error('Utilisez « Préparer / réessayer les accès » en haut du constat.');
  const clone=track.clone();clone.enabled=true;return new MediaStream([clone]);
}
function suspendVisitAccess(){
  ++visitAccess.generation;visitAccess.pending=null;
  visitAccess.tracks.forEach(t=>t.stop());visitAccess.tracks=[];visitAccess.streams=[];
  if(visitAccess.watch!==null)navigator.geolocation?.clearWatch(visitAccess.watch);
  visitAccess.watch=null;visitAccess.position=null;visitAccess.attempted=false;visitAccess.geoBlocked=false;
  visitAccess.mediaMessage='Caméra et microphone arrêtés.';visitAccess.geoMessage='Suivi de position suspendu.';
  visitAccess.waiters.splice(0).forEach(resolve=>resolve(null));accessStatus();
}
window.addEventListener('pagehide',()=>{if(recording)stopRecording();closeCamera();suspendVisitAccess();});
$('#prepare-access').addEventListener('click',()=>prepareVisitAccess(true));
$('#pause-access').addEventListener('click',()=>{
  if(recording||$('#camera-dialog').open){alert('Terminez la capture avant de suspendre les accès.');return;}
  suspendVisitAccess();
});
