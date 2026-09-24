// Permissions are requested at the start of a field session, not per capture.
const visitAccess={attempted:false,pending:null,tracks:[],watch:null,position:null,geoMessage:'Localisation non démarrée.',mediaMessage:'Accès non préparés.',waiters:[],geoBlocked:false};
function accessStatus(){const node=document.querySelector('#access-status');if(node)node.textContent=visitAccess.mediaMessage+' '+visitAccess.geoMessage;}
function receivePosition(p){visitAccess.position={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,measuredAt:new Date(p.timestamp).toISOString()};visitAccess.geoMessage='Localisation active.';state.position={...visitAccess.position};showPosition();accessStatus();for(const resolve of visitAccess.waiters.splice(0))resolve({...visitAccess.position});saveVisit();}
function startLocationWatch(force=false){
  if(visitAccess.watch!==null)return;
  if(visitAccess.geoBlocked&&!force)return;
  if(!navigator.geolocation){visitAccess.geoMessage='Localisation indisponible dans ce navigateur.';accessStatus();return;}
  visitAccess.geoBlocked=false;visitAccess.geoMessage='Recherche de la position…';accessStatus();
  visitAccess.watch=navigator.geolocation.watchPosition(receivePosition,error=>{
    visitAccess.geoMessage=error.code===1?'Localisation refusée : autorisez-la dans les réglages du navigateur.':error.code===2?'Position indisponible : vérifiez que la localisation de l’appareil est activée.':'Position non obtenue pour le moment ; la recherche continue.';
    if(error.code===1){visitAccess.geoBlocked=true;navigator.geolocation.clearWatch(visitAccess.watch);visitAccess.watch=null;}
    $('#geo-status small').textContent=visitAccess.geoMessage;accessStatus();for(const resolve of visitAccess.waiters.splice(0))resolve(null);
  },{enableHighAccuracy:false,maximumAge:15000,timeout:25000});
}
function recentPosition(maxAge=60000){const p=visitAccess.position;return p&&Date.now()-Date.parse(p.measuredAt)<=maxAge?{...p}:null;}
function sessionPosition(){const cached=recentPosition();if(cached)return Promise.resolve(cached);if(visitAccess.watch===null||visitAccess.geoBlocked)return Promise.resolve(null);return new Promise(resolve=>{let done=false;const finish=value=>{if(done)return;done=true;clearTimeout(timer);visitAccess.waiters=visitAccess.waiters.filter(fn=>fn!==finish);resolve(value);};const timer=setTimeout(()=>finish(null),12000);visitAccess.waiters.push(finish);});}
async function prepareVisitAccess(force=false){
  if(visitAccess.pending)return visitAccess.pending;
  if(visitAccess.attempted&&!force)return;
  visitAccess.attempted=true;startLocationWatch(force);
  visitAccess.pending=(async()=>{
    visitAccess.mediaMessage='Préparation caméra et microphone…';accessStatus();
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
      const missing=['video','audio'].filter(kind=>!visitAccess.tracks.some(t=>t.kind===kind&&t.readyState==='live'));
      if(missing.length){let tracks=[];
        try{tracks=(await navigator.mediaDevices.getUserMedia({video:missing.includes('video')?{facingMode:{ideal:'environment'}}:false,audio:missing.includes('audio')})).getTracks();}
        catch(error){if(error.name!=='NotFoundError'&&error.name!=='OverconstrainedError')throw error;
          // A computer may have a microphone but no camera (or the reverse).
          for(const kind of missing){try{tracks.push(...(await navigator.mediaDevices.getUserMedia(kind==='video'?{video:true}:{audio:true})).getTracks());}catch{}}
        }
        tracks.forEach(t=>{t.enabled=false;});visitAccess.tracks.push(...tracks);
      }
      const camera=visitAccess.tracks.some(t=>t.kind==='video'&&t.readyState==='live'),mic=visitAccess.tracks.some(t=>t.kind==='audio'&&t.readyState==='live');
      visitAccess.mediaMessage=`Caméra ${camera?'prête':'indisponible'} · Microphone ${mic?'prêt':'indisponible'}. Ils restent en pause hors capture.`;
    }catch(error){visitAccess.mediaMessage=error.name==='NotAllowedError'?'Accès caméra/micro refusé. Vous pouvez continuer avec des photos importées.':'Caméra/micro indisponibles dans ce navigateur ou sur cet appareil.';}
    finally{visitAccess.pending=null;accessStatus();}
  })();return visitAccess.pending;
}
function acquireVisitStream(kind){const track=visitAccess.tracks.find(t=>t.kind===kind&&t.readyState==='live');if(!track)throw new Error('Préparez les accès de la visite avec le bouton en haut du constat.');const clone=track.clone();clone.enabled=true;return new MediaStream([clone]);}
function suspendVisitAccess(){visitAccess.tracks.forEach(t=>t.stop());visitAccess.tracks=[];if(visitAccess.watch!==null)navigator.geolocation.clearWatch(visitAccess.watch);visitAccess.watch=null;visitAccess.position=null;visitAccess.attempted=false;visitAccess.mediaMessage='Caméra et microphone arrêtés.';visitAccess.geoMessage='Suivi de position suspendu.';accessStatus();for(const resolve of visitAccess.waiters.splice(0))resolve(null);}
window.addEventListener('pagehide',suspendVisitAccess);
$('#prepare-access').addEventListener('click',()=>prepareVisitAccess(true));
$('#pause-access').addEventListener('click',()=>{if(recording||$('#camera-dialog').open){alert('Terminez la capture avant de suspendre les accès.');return;}suspendVisitAccess();});
$('#apply-visit-position').addEventListener('click',()=>{if(!validPosition(state.position)){alert('Aucune position de visite enregistrée. Préparez les accès ou actualisez la localisation.');return;}const missing=state.photos.filter(p=>!validPosition(p.position));if(!missing.length){tell('Toutes les photos ont déjà une position.');return;}const date=state.position.measuredAt?new Date(state.position.measuredAt).toLocaleString('fr-FR'):'date inconnue';if(!confirm(`Associer la position de visite relevée le ${date} aux ${missing.length} photo(s) sans position ? Confirmez uniquement si cette position correspond bien au lieu photographié.`))return;missing.forEach(p=>p.position={...state.position,source:'manual'});renderCaptures();saveVisit();tell('Position de visite associée aux photos sélectionnées.');});
