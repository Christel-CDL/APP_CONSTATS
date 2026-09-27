'use strict';
// Serveur de production de Constats : fichiers de l'application derrière un contrôle d'accès.
// Comptes : table Utilisateurs d'Airtable (e-mail, rôle, statut). Connexion sans mot de passe : code à 6 chiffres
// ou lien envoyés par e-mail, puis session signée (cookie HttpOnly). Plusieurs profils par appareil.
// Les constats sont sauvegardés sur le VPS (DATA_DIR) pour passer d'un appareil à l'autre, avec une copie dans Airtable.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

const env=process.env;
const config={
  port:Number(env.PORT)||8080,
  root:path.resolve(env.APP_ROOT||path.join(__dirname,'..','public')),
  appUrl:(env.APP_URL||'').replace(/\/+$/,''),
  secret:String(env.SESSION_SECRET||'').trim(),
  sessionDays:Number(env.SESSION_DAYS)||90,
  airtable:{token:env.AIRTABLE_TOKEN||'',base:env.AIRTABLE_BASE_ID||'',table:env.AIRTABLE_USERS_TABLE||'Utilisateurs'},
  mail:{host:env.SMTP_HOST||'',port:Number(env.SMTP_PORT)||587,secure:env.SMTP_SECURE==='true',user:env.SMTP_USER||'',pass:env.SMTP_PASS||'',from:env.MAIL_FROM||''},
  devLogCodes:env.DEV_LOG_CODES==='1',
  // Tests uniquement : comptes fournis en JSON au lieu d'Airtable.
  devUsers:env.DEV_USERS?JSON.parse(env.DEV_USERS):null,
  projectsTable:env.AIRTABLE_PROJECTS_TABLE||'Projets',
  constatsTable:env.AIRTABLE_CONSTATS_TABLE||'Constats',
  airtableApi:(env.AIRTABLE_API_URL||'https://api.airtable.com/v0').replace(/\/+$/,'')// autre adresse : tests uniquement
};
// Diagnostic de démarrage : présence et longueur de chaque réglage, jamais leur valeur.
{const report=['APP_URL','SESSION_SECRET','AIRTABLE_TOKEN','AIRTABLE_BASE_ID','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','MAIL_FROM'].map(name=>{const value=String(env[name]||'').trim();return `  ${name} : ${value?`reçu (${value.length} caractères)`:'ABSENT'}`;});
  const problems=[];if(config.secret.trim().length<32)problems.push(`SESSION_SECRET manquant ou trop court (${config.secret.trim().length} caractères reçus, 32 minimum, 64 recommandés).`);
  if(!config.devUsers&&(!config.airtable.token||!config.airtable.base))problems.push('AIRTABLE_TOKEN et AIRTABLE_BASE_ID sont requis.');
  if(!config.devUsers&&!config.mail.host&&!config.devLogCodes)problems.push('SMTP_HOST manquant : les codes de connexion ne pourraient pas être envoyés.');
  console.log('Réglages reçus par le conteneur :\n'+report.join('\n'));
  if(problems.length){console.error('DÉMARRAGE IMPOSSIBLE :\n- '+problems.join('\n- ')+'\nRenseigner ces variables dans hPanel (projet app-constats), puis Déployer.');process.exit(1);}}

const ROLE_TYPES={'Expert judiciaire':['ej','autre'],'Expert':['ep','autre']};
const ALLOWED_STATUS=new Set(['Actif','Invité']);
const PUBLIC=new Set(['/demarrer.html','/launcher.js','/launcher.css','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/icon-maskable-512.png','/icons/apple-touch-icon.png','/icons/icon.svg','/robots.txt']);
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8'};
const EMAIL=/^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/;

// ── Sessions signées ─────────────────────────────────────────────
const b64=buf=>Buffer.from(buf).toString('base64url');
const sign=data=>crypto.createHmac('sha256',config.secret).update(data).digest('base64url');
function issue(user){const payload=b64(JSON.stringify({id:user.id,email:user.email,exp:Date.now()+config.sessionDays*864e5}));return payload+'.'+sign(payload);}
function readToken(token){const [payload,mac]=String(token).split('.');if(!payload||!mac)return null;const expected=sign(payload);
  if(mac.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))return null;
  try{const data=JSON.parse(Buffer.from(payload,'base64url'));return data.exp>Date.now()&&/^rec\w{14}$|^dev-\w+$/.test(data.id)?data:null;}catch{return null;}}
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(/;\s*/).filter(Boolean).map(c=>{const i=c.indexOf('=');return [c.slice(0,i),decodeURIComponent(c.slice(i+1))];}));}
function sessionTokens(req){const raw=cookies(req).constats_sessions;if(!raw)return [];return raw.split('~').slice(0,6).filter(t=>readToken(t));}
function setSessions(res,tokens){const value=tokens.join('~'),secure=config.appUrl.startsWith('https:')?'; Secure':'';
  res.setHeader('Set-Cookie',`constats_sessions=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${value?config.sessionDays*86400:0}`);}

// ── Comptes (Airtable) ───────────────────────────────────────────
const statusCache=new Map();// id → {user, at}
function userFrom(record){const f=record.fields||{};const role=typeof f['Rôle']==='string'?f['Rôle']:f['Rôle']?.name;const status=typeof f['Statut du compte']==='string'?f['Statut du compte']:f['Statut du compte']?.name;
  return {id:record.id,email:String(f.Email||'').toLowerCase(),name:String(f.Nom||''),organisation:String(f.Organisation||''),role:role||'',status:status||''};}
async function airtable(pathname,options={},table=config.airtable.table){
  const res=await fetch(`${config.airtableApi}/${encodeURIComponent(config.airtable.base)}/${encodeURIComponent(table)}${pathname}`,{...options,headers:{Authorization:`Bearer ${config.airtable.token}`,'Content-Type':'application/json',...options.headers}});
  if(!res.ok)throw new Error(`Airtable ${res.status}`);return res.json();}
async function findUserByEmail(email){
  if(config.devUsers)return config.devUsers.find(u=>u.email===email)||null;
  // L'adresse est validée par EMAIL (aucune apostrophe possible) avant d'entrer dans la formule.
  const data=await airtable(`?maxRecords=1&filterByFormula=${encodeURIComponent(`LOWER({Email})='${email}'`)}`);
  return data.records?.[0]?userFrom(data.records[0]):null;}
async function findUserById(id){
  const cached=statusCache.get(id);if(cached&&Date.now()-cached.at<6*36e5)return cached.user;
  let user;if(config.devUsers)user=config.devUsers.find(u=>u.id===id)||null;
  else{try{user=userFrom(await airtable('/'+encodeURIComponent(id)));}catch(error){if(cached)return cached.user;if(/404/.test(error.message))user=null;else throw error;}}
  statusCache.set(id,{user,at:Date.now()});return user;}
async function activate(user){if(config.devUsers||user.status!=='Invité')return;
  try{await airtable('/'+encodeURIComponent(user.id),{method:'PATCH',body:JSON.stringify({fields:{'Statut du compte':'Actif','Inscrit le':new Date().toISOString().slice(0,10)}})});statusCache.delete(user.id);}
  catch(error){console.warn('Activation du compte non enregistrée dans Airtable :',error.message);}}
// ── Dossiers (table Projets) ─────────────────────────────────────
// Chaque profil ne voit que ses dossiers (champ Responsable) et ses types de mission.
// Expertise judiciaire : le champ « Client / Juridiction » n'est jamais lu, transmis ni écrit (RGPD).
const PROJECT_TYPES={'Expertise judiciaire':'ej','Expertise amiable':'ep','Expertise privée':'ep','Conseil / AMO':'autre','Diagnostic':'autre','Suivi de chantier':'autre'};
const LOCAL_TO_AIRTABLE_TYPE={'Expertise judiciaire':'Expertise judiciaire','Expertise privée':'Expertise amiable','Expertise amiable':'Expertise amiable','Conseil / AMO':'Conseil / AMO','Diagnostic':'Diagnostic','Suivi de chantier':'Suivi de chantier'};
const LOCAL_STATUS=new Set(['En cours','En attente','Clos']);
const devProjects=env.DEV_PROJECTS?JSON.parse(env.DEV_PROJECTS):[];// tests uniquement
const selectName=v=>typeof v==='string'?v:v?.name||'';
function projectFrom(record){const f=record.fields||{},airtableType=selectName(f.Type),kind=PROJECT_TYPES[airtableType]||'autre',status=selectName(f.Statut);
  const address=[f['Adresse du site'],[f['Code postal'],f.Commune].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return {airtableId:record.id,kind,name:String(f['Nom du projet']||'').slice(0,200),reference:String(f['Référence']||'').slice(0,100),type:airtableType==='Expertise amiable'?'Expertise privée':airtableType||'Autre',
    client:kind==='ep'?String(f['Client / Juridiction']||'').slice(0,200):'',address:address.slice(0,300),status:LOCAL_STATUS.has(status)?status:status==='Archivé'?'Clos':'En cours'};}
function projectFields(body,kind,creating,userId){const text=(v,max)=>String(v??'').trim().slice(0,max),fields={};
  if(body.name!==undefined)fields['Nom du projet']=text(body.name,200);if(body.reference!==undefined)fields['Référence']=text(body.reference,100);
  if(body.address!==undefined)fields['Adresse du site']=text(body.address,300);if(LOCAL_STATUS.has(body.status))fields.Statut=body.status;
  if(LOCAL_TO_AIRTABLE_TYPE[body.type])fields.Type=LOCAL_TO_AIRTABLE_TYPE[body.type];
  if(kind==='ep'&&body.client!==undefined)fields['Client / Juridiction']=text(body.client,200);
  if(creating){fields.Responsable=[userId];fields['Ouvert le']=new Date().toISOString().slice(0,10);}
  return fields;}
async function userProjectIds(userId){if(config.devUsers)return devProjects.filter(p=>p.owner===userId).map(p=>p.id);
  const record=await airtable('/'+encodeURIComponent(userId));return Array.isArray(record.fields?.Projets)?record.fields.Projets:[];}
async function listProjects(user){return (await listProjectsRaw(user)).filter(p=>(ROLE_TYPES[user.role]||['autre']).includes(p.kind)&&p.name).map(({kind,...p})=>p);}
async function listProjectsRaw(user){const ids=(await userProjectIds(user.id)).filter(id=>/^rec\w{14}$|^dev-/.test(id)).slice(0,200);
  let records=[];
  if(config.devUsers)records=devProjects.filter(p=>ids.includes(p.id)).map(p=>({id:p.id,fields:p.fields}));
  else for(let i=0;i<ids.length;i+=50){const formula=`OR(${ids.slice(i,i+50).map(id=>`RECORD_ID()='${id}'`).join(',')})`;
    const data=await airtable(`?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`,{},config.projectsTable);records.push(...(data.records||[]));}
  return records.map(projectFrom);}
async function saveProject(user,body,airtableId){
  const kind=PROJECT_TYPES[LOCAL_TO_AIRTABLE_TYPE[body.type]]||'autre';if(body.type&&!(ROLE_TYPES[user.role]||['autre']).includes(kind))throw Object.assign(new Error('type'),{status:403});
  if(!airtableId&&!String(body.name||'').trim())throw Object.assign(new Error('name'),{status:400});
  if(airtableId&&!(await userProjectIds(user.id)).includes(airtableId))throw Object.assign(new Error('owner'),{status:404});
  const fields=projectFields(body,kind,!airtableId,user.id);
  if(config.devUsers){if(airtableId){const p=devProjects.find(x=>x.id===airtableId);Object.assign(p.fields,fields);return projectFrom(p);}
    const p={id:'dev-p'+(devProjects.length+1),owner:user.id,fields:{...fields,Type:fields.Type?{name:fields.Type}:undefined,Statut:fields.Statut?{name:fields.Statut}:undefined}};devProjects.push(p);return projectFrom(p);}
  const record=airtableId?await airtable('/'+encodeURIComponent(airtableId),{method:'PATCH',body:JSON.stringify({fields})},config.projectsTable)
    :await airtable('',{method:'POST',body:JSON.stringify({fields})},config.projectsTable);
  return projectFrom(record);}
// ── Sauvegarde des constats : VPS (fichiers et constats) + copie dans Airtable (table Constats) ─────────
// Les photos, sons, notes manuscrites et signatures sont conservés sur le VPS (volume DATA_DIR), sous leur empreinte
// SHA-256 : un fichier n'est envoyé qu'une fois. Le constat (texte, sans images) y est conservé à chaque sauvegarde,
// avec un numéro de version qui détecte les modifications faites entre-temps sur un autre appareil.
// Airtable en reçoit une copie lisible, regroupée et différée (MIRROR_DELAY_MS) : le forfait limite le nombre d'appels.
// Expertise judiciaire : aucune donnée nominative (donneur d'ordre, feuille de présence) n'est acceptée ; l'adresse
// du site est conservée, la référence OPALEXE sert d'identifiant de l'expertise.
const DATA_DIR=path.resolve(env.DATA_DIR||'/data'),MIRROR_DELAY=Number(env.MIRROR_DELAY_MS)||10*6e4;
const HASH=/^[a-f0-9]{64}$/,DRAFT_ID=/^[\w-]{6,60}$/,BLOB_TYPE=/^(image\/(jpeg|png|webp|gif|bmp|avif)|audio\/[\w.+-]{1,40}|video\/webm)$/;
const CONSTAT_STATUS=new Set(['Brouillon','Finalisé','Rapport envoyé']);
let storeReady=false;
{let mounted=false;try{fs.mkdirSync(path.join(DATA_DIR,'fichiers'),{recursive:true});fs.mkdirSync(path.join(DATA_DIR,'constats'),{recursive:true});fs.accessSync(DATA_DIR,fs.constants.W_OK);storeReady=true;}catch{}
  try{mounted=fs.readFileSync('/proc/mounts','utf8').split('\n').some(line=>line.split(' ')[1]===DATA_DIR);}catch{}
  console.log(`  DATA_DIR : ${DATA_DIR} — ${storeReady?'accessible':'NON ACCESSIBLE : sauvegarde serveur désactivée'}${storeReady?(mounted?' — volume Docker monté (données conservées aux redéploiements)':' — ATTENTION : aucun volume Docker monté sur ce dossier, les constats seraient perdus au prochain déploiement'):''}`);}
const safeId=id=>String(id).replace(/[^\w-]/g,'');
const blobPath=(userId,hash)=>path.join(DATA_DIR,'fichiers',safeId(userId),hash);
const constatPath=(userId,draftId)=>path.join(DATA_DIR,'constats',safeId(userId),draftId+'.json');
function writeAtomic(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomBytes(4).toString('hex')+'.tmp';fs.writeFileSync(tmp,data);fs.renameSync(tmp,file);}
function readConstat(userId,draftId){try{return JSON.parse(fs.readFileSync(constatPath(userId,draftId),'utf8'));}catch{return null;}}
async function readBody(req,max){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw Object.assign(new Error('too large'),{status:413});chunks.push(chunk);}return Buffer.concat(chunks);}
// Le constat ne doit contenir que des références « fichier:<empreinte> » : aucune image intégrée.
function blobRefs(value,found=new Set()){if(typeof value==='string'){if(value.startsWith('data:'))throw Object.assign(new Error('inline'),{status:400});const m=/^fichier:([a-f0-9]{64})$/.exec(value);if(m)found.add(m[1]);}
  else if(Array.isArray(value))value.forEach(v=>blobRefs(v,found));else if(value&&typeof value==='object')Object.values(value).forEach(v=>blobRefs(v,found));return found;}
function cleanVisit(visit,ej){const v={...visit};if(ej){v.clientName='';v.clientAddress='';v.attendance=[];if(v.dossier&&typeof v.dossier==='object')v.dossier={...v.dossier,client:''};}return v;}
function constatSummary(record){const v=record.visit||{};return {draftId:v.draftId,version:record.version,updatedAt:record.updatedAt,status:record.status,caseReference:String(v.caseReference||'').slice(0,100),caseName:String(v.caseName||'').slice(0,200),caseType:v.caseType||'autre',visitDate:v.visitDate||'',photos:Array.isArray(v.photos)?v.photos.length:0,closedAt:v.closedAt||'',savedAt:v.savedAt||'',airtable:record.mirroredVersion===record.version?'copié':record.airtableError?'erreur : '+record.airtableError:'en attente'};}
async function saveVisit(user,draftId,body){
  const visit=body.visit;if(!DRAFT_ID.test(draftId)||!visit||typeof visit!=='object'||visit.draftId!==draftId||!Array.isArray(visit.photos))throw Object.assign(new Error('visit'),{status:400});
  blobRefs(visit);const current=readConstat(user.id,draftId);
  if(current&&body.force!==true&&Number(body.baseVersion)!==current.version)return {conflict:true,...constatSummary(current)};
  const ej=visit.caseType==='ej'||visit.dossier?.type==='Expertise judiciaire';
  const record={version:(current?.version||0)+1,updatedAt:new Date().toISOString(),status:CONSTAT_STATUS.has(body.status)?body.status:'Brouillon',visit:cleanVisit(visit,ej),
    airtable:current?.airtable||{},mirroredVersion:current?.mirroredVersion||0};
  writeAtomic(constatPath(user.id,draftId),JSON.stringify(record));
  scheduleMirror(user.id,draftId,record.status!==current?.status&&record.status!=='Brouillon'?5000:MIRROR_DELAY);
  return constatSummary(record);}
function listVisits(userId){const dir=path.join(DATA_DIR,'constats',safeId(userId));let files=[];try{files=fs.readdirSync(dir).filter(f=>f.endsWith('.json'));}catch{}
  return files.map(f=>{try{return constatSummary(JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')));}catch{return null;}}).filter(Boolean);}
// Copie lisible dans Airtable
const mirrorTimers=new Map();
function scheduleMirror(userId,draftId,delay){const key=userId+'/'+draftId;clearTimeout(mirrorTimers.get(key));
  const timer=setTimeout(()=>{mirrorTimers.delete(key);mirrorConstat(userId,draftId).catch(error=>{console.error('Copie Airtable du constat :',error.message);const r=readConstat(userId,draftId);if(r){r.airtableError=/429/.test(error.message)?'limite d’appels du forfait Airtable atteinte':/40[13]/.test(error.message)?'jeton Airtable refusé':/422/.test(error.message)?'champ refusé par la table Constats':'Airtable injoignable';try{writeAtomic(constatPath(userId,draftId),JSON.stringify(r));}catch{}}scheduleMirror(userId,draftId,Math.max(MIRROR_DELAY,6e4));});},delay);
  timer.unref();mirrorTimers.set(key,timer);}
function frDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):'';}
function readableSummary(v){const lines=[],ej=v.caseType==='ej',clip=(t,n=2000)=>String(t||'').trim().slice(0,n);
  lines.push(`Type : ${ej?'Expertise judiciaire':v.caseType==='ep'?'Expertise privée':'Constat'} — ${(v.photos||[]).length} photo(s)`);
  for(const subject of v.subjects||[]){const photos=(v.photos||[]).filter(p=>p.subject===subject);if(!photos.length)continue;lines.push('',`■ ${subject}`);
    for(const p of photos){lines.push(`  Photo ${p.number}${p.capturedAt?' ('+new Date(p.capturedAt).toLocaleString('fr-FR',{timeZone:'Europe/Paris'})+')':''}`);
      for(const [key,label] of [['description','Description'],['comment','Commentaires'],['transcript','Transcription']])if(clip(p[key]))lines.push(`    ${label} : ${clip(p[key])}`);}}
  const actions=(v.actions||[]).filter(a=>clip(a.text));if(actions.length){lines.push('','Suites à donner :');for(const a of actions)lines.push(`  - ${clip(a.type,80)} : ${clip(a.text,500)}${a.recipient?' → '+clip(a.recipient,200):''}${a.date?' (échéance '+frDate(a.date)+')':''}`);}
  for(const [key,label] of [['presents','Présents'],['expertNote',ej?'Note expertale':'Avis de l’expert'],['missionDetail','Mission'],['conclusions','Conclusions']])if(clip(v[key]))lines.push('',`${label} :`,clip(v[key],5000));
  return lines.join('\n').slice(0,95000);}
async function mirrorConstat(userId,draftId){
  if(config.devUsers&&!env.DEV_MIRROR)return;const record=readConstat(userId,draftId);if(!record||record.mirroredVersion===record.version)return;
  const v=record.visit,ej=v.caseType==='ej',a=record.airtable;
  // Dossier Airtable : celui du constat, sinon le dossier du compte portant la même référence (n° de l'expertise).
  if(!a.projet){const direct=/^rec\w{14}$/.test(v.dossier?.airtableId||'')?v.dossier.airtableId:'';
    if(direct&&(await userProjectIds(userId)).includes(direct))a.projet=direct;
    else if(String(v.caseReference||'').trim()){const user=await findUserById(userId);const match=user&&(await listProjectsRaw(user)).find(p=>p.reference.trim().toLowerCase()===String(v.caseReference).trim().toLowerCase());if(match)a.projet=match.airtableId;}}
  const json=JSON.stringify({version:record.version,visit:v});
  const title=`${String(v.caseReference||'').trim()||'Sans référence'} — ${ej?'Constat':String(v.caseName||'Constat').trim().slice(0,120)} du ${frDate(v.visitDate)}`;
  const base={Titre:title.slice(0,200),'Date de visite':/^\d{4}-\d{2}-\d{2}$/.test(v.visitDate||'')?v.visitDate:null,'Lieu visité':String(v.siteAddress||'').slice(0,300),Statut:record.status,
    'Synthèse':readableSummary(v),'Identifiant appli':draftId,...(Number.isFinite(v.position?.lat)&&Number.isFinite(v.position?.lng)?{Latitude:v.position.lat,Longitude:v.position.lng}:{}),...(a.projet?{Projet:[a.projet]}:{})};
  const extra={'Référence':String(v.caseReference||'').slice(0,100),'Données appli (JSON)':json.length<=99000?json:`Constat trop volumineux pour Airtable (${json.length} caractères) : version ${record.version} conservée sur le serveur.`,'Mis à jour le':record.updatedAt};
  const write=async fields=>a.id?airtable('/'+encodeURIComponent(a.id),{method:'PATCH',body:JSON.stringify({fields})},config.constatsTable)
    :airtable('',{method:'POST',body:JSON.stringify({fields:{...fields,Auteur:[userId]}})},config.constatsTable);
  let saved;try{saved=await write({...base,...extra});}
  catch(error){if(!/Airtable 422/.test(error.message))throw error;console.warn('Table Constats : champs Référence / Données appli (JSON) / Mis à jour le absents, copie réduite.');saved=await write(base);}
  const latest=readConstat(userId,draftId)||record;latest.airtable={...latest.airtable,id:saved.id,projet:a.projet||''};if(latest.version===record.version)latest.mirroredVersion=record.version;delete latest.airtableError;
  writeAtomic(constatPath(userId,draftId),JSON.stringify(latest));}
// Au démarrage : copies Airtable restées en attente (conteneur redémarré).
if(storeReady)setTimeout(()=>{try{for(const user of fs.readdirSync(path.join(DATA_DIR,'constats')))for(const f of fs.readdirSync(path.join(DATA_DIR,'constats',user)))if(f.endsWith('.json')){const r=readConstat(user,f.slice(0,-5));if(r&&r.mirroredVersion!==r.version)scheduleMirror(user,f.slice(0,-5),3e4);}}catch(error){console.warn('Reprise des copies Airtable :',error.message);}},1000).unref();
async function sessionUser(req,id){if(!sessionTokens(req).some(t=>readToken(t).id===id))return null;const user=await findUserById(id).catch(()=>null);return user&&ALLOWED_STATUS.has(user.status)?user:null;}
const publicProfile=user=>({id:user.id,name:user.name,email:user.email,organisation:user.organisation,role:user.role,types:ROLE_TYPES[user.role]||['autre']});

// ── Codes de connexion ───────────────────────────────────────────
const challenges=new Map();// email → {codeHash, tokenHash, exp, attempts, userId}
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const limits=new Map();
function limited(key,max,windowMs){const now=Date.now(),list=(limits.get(key)||[]).filter(t=>now-t<windowMs);list.push(now);limits.set(key,list);return list.length>max;}
setInterval(()=>{const now=Date.now();for(const [k,v] of challenges)if(v.exp<now)challenges.delete(k);for(const [k,v] of limits)if(!v.some(t=>now-t<36e5))limits.delete(k);},6e4).unref();

let transporter=null;
function mailer(){if(transporter)return transporter;if(!config.mail.host)return null;const nodemailer=require('nodemailer');
  transporter=nodemailer.createTransport({host:config.mail.host,port:config.mail.port,secure:config.mail.secure,auth:config.mail.user?{user:config.mail.user,pass:config.mail.pass}:undefined});return transporter;}
async function sendCode(user,code,token){
  const link=`${config.appUrl}/demarrer.html?jeton=${token}`;
  const text=`Bonjour ${user.name||''},\n\nVotre code de connexion à l'application Constats : ${code}\n\nSaisissez-le dans l'application (recommandé sur iPad et iPhone, depuis l'icône de l'écran d'accueil),\nou ouvrez ce lien dans le navigateur de l'appareil à connecter :\n${link}\n\nCode et lien valables 15 minutes, utilisables une seule fois.\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucun accès n'est ouvert sans ce code.\n\nCDL EXPERT — Constats`;
  if(config.devLogCodes)console.log(`[DEV] Code pour ${user.email} : ${code} — ${link}`);
  const transport=mailer();if(!transport){if(config.devLogCodes)return;throw new Error('SMTP non configuré');}
  await transport.sendMail({from:config.mail.from,to:user.email,subject:`Code de connexion Constats : ${code}`,text});}

// ── HTTP ─────────────────────────────────────────────────────────
const SECURITY_HEADERS={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin','X-Robots-Tag':'noindex, nofollow',
  'Permissions-Policy':'camera=(self), microphone=(self), geolocation=(self)',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; frame-src https://www.openstreetmap.org; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"};
function send(res,status,body,type='application/json'){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(type==='application/json'?JSON.stringify(body):body);}
async function readJson(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>4096)throw new Error('too large');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{return {};}}
// Dernière adresse de X-Forwarded-For : celle ajoutée par Traefik, que le client ne peut pas imposer.
const clientIp=req=>String(req.headers['x-forwarded-for']||'').split(',').pop().trim()||req.socket.remoteAddress||'';
const sameOrigin=req=>{const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===req.headers.host;}catch{return false;}};

async function api(req,res,pathname){
  if(req.method!=='GET'&&!sameOrigin(req))return send(res,403,{message:'Origine refusée.'});
  const projectPath=/^\/api\/projets(?:\/(rec\w{14}|dev-p\d+))?$/.exec(pathname);
  if(projectPath){
    const url=new URL(req.url,'http://localhost'),body=req.method==='GET'?{}:await readJson(req),profile=String(url.searchParams.get('profil')||body.profil||'');
    const user=await sessionUser(req,profile);if(!user)return send(res,401,{message:'Profil non connecté.'});
    try{
      if(req.method==='GET'&&!projectPath[1])return send(res,200,{projets:await listProjects(user)});
      if(req.method==='POST'&&!projectPath[1])return send(res,201,{projet:await saveProject(user,body)});
      if(req.method==='PATCH'&&projectPath[1])return send(res,200,{projet:await saveProject(user,body,projectPath[1])});
    }catch(error){if(error.status)return send(res,error.status,{message:error.status===403?'Type de mission non autorisé pour ce profil.':'Dossier introuvable ou invalide.'});
      console.error('Dossiers Airtable :',error.message);return send(res,503,{message:'Airtable indisponible : dossier conservé sur l’appareil.'});}
    return send(res,405,{message:'Méthode non autorisée.'});
  }
  const blobPathMatch=/^\/api\/fichiers\/([a-f0-9]{64})$/.exec(pathname),constatMatch=/^\/api\/constats(?:\/([\w-]{6,60}))?$/.exec(pathname);
  if(blobPathMatch||constatMatch||pathname==='/api/fichiers/manquants'){
    const url=new URL(req.url,'http://localhost'),user=await sessionUser(req,String(url.searchParams.get('profil')||''));
    if(!user)return send(res,401,{message:'Profil non connecté.'});
    if(!storeReady)return send(res,503,{message:'Sauvegarde serveur indisponible : constat conservé sur l’appareil.'});
    try{
      if(pathname==='/api/fichiers/manquants'&&req.method==='POST'){const hashes=JSON.parse(await readBody(req,64e3)||'{}').hashes;if(!Array.isArray(hashes)||hashes.length>2000)return send(res,400,{message:'Liste invalide.'});
        return send(res,200,{manquants:hashes.filter(h=>HASH.test(h)&&!fs.existsSync(blobPath(user.id,h)))});}
      if(blobPathMatch&&req.method==='PUT'){const hash=blobPathMatch[1],type=String(req.headers['content-type']||'').split(';')[0].trim();
        if(!BLOB_TYPE.test(type))return send(res,415,{message:'Type de fichier refusé.'});
        const data=await readBody(req,40e6);if(crypto.createHash('sha256').update(data).digest('hex')!==hash)return send(res,400,{message:'Empreinte incorrecte.'});
        if(!fs.existsSync(blobPath(user.id,hash))){writeAtomic(blobPath(user.id,hash)+'.type',type);writeAtomic(blobPath(user.id,hash),data);}
        return send(res,201,{ok:true});}
      if(blobPathMatch&&req.method==='GET'){const file=blobPath(user.id,blobPathMatch[1]);let type;try{type=fs.readFileSync(file+'.type','utf8');}catch{return send(res,404,{message:'Fichier absent du serveur.'});}
        res.writeHead(200,{'Content-Type':BLOB_TYPE.test(type)?type:'application/octet-stream','Cache-Control':'private, max-age=31536000, immutable'});return fs.createReadStream(file).pipe(res);}
      if(constatMatch&&!constatMatch[1]&&req.method==='GET')return send(res,200,{constats:listVisits(user.id)});
      if(constatMatch&&constatMatch[1]&&req.method==='GET'){const record=readConstat(user.id,constatMatch[1]);return record?send(res,200,{version:record.version,updatedAt:record.updatedAt,visit:record.visit}):send(res,404,{message:'Constat introuvable.'});}
      if(constatMatch&&constatMatch[1]&&req.method==='PUT'){let body;try{body=JSON.parse(await readBody(req,4e6));}catch(error){if(error.status)throw error;return send(res,400,{message:'Constat invalide.'});}
        const result=await saveVisit(user,constatMatch[1],body);return send(res,result.conflict?409:200,{constat:result});}
    }catch(error){if(error.status)return send(res,error.status,{message:error.status===413?'Fichier trop volumineux.':'Données invalides.'});console.error('Sauvegarde serveur :',error.message);return send(res,500,{message:'Sauvegarde serveur impossible.'});}
    return send(res,405,{message:'Méthode non autorisée.'});
  }
  if(pathname==='/api/me'&&req.method==='GET'){
    const profiles=[],kept=[];
    for(const token of sessionTokens(req)){const data=readToken(token),user=await findUserById(data.id).catch(()=>null);
      if(user&&ALLOWED_STATUS.has(user.status)&&!profiles.some(p=>p.id===user.id)){profiles.push(publicProfile(user));kept.push(token);}}
    if(kept.length!==sessionTokens(req).length)setSessions(res,kept);
    return send(res,profiles.length?200:401,{profiles});
  }
  if(pathname==='/api/auth/request'&&req.method==='POST'){
    const email=String((await readJson(req)).email||'').trim().toLowerCase();
    if(!EMAIL.test(email))return send(res,400,{message:'Adresse e-mail invalide.'});
    if(limited('ip:'+clientIp(req),10,15*6e4)||limited('mail:'+email,5,15*6e4))return send(res,429,{message:'Trop de demandes. Réessayez dans quelques minutes.'});
    // Réponse identique que le compte existe ou non : la liste des comptes ne peut pas être sondée.
    const done=()=>send(res,200,{ok:true});
    let user;try{user=await findUserByEmail(email);}catch(error){console.error('Recherche du compte :',error.message);return send(res,503,{message:'Service de comptes indisponible. Réessayez plus tard.'});}
    if(!user||!ALLOWED_STATUS.has(user.status))return done();
    const code=String(crypto.randomInt(0,1e6)).padStart(6,'0'),token=crypto.randomBytes(24).toString('base64url');
    challenges.set(email,{codeHash:hash(code),tokenHash:hash(token),exp:Date.now()+15*6e4,attempts:0,userId:user.id});
    try{await sendCode(user,code,token);}catch(error){challenges.delete(email);console.error('Envoi du code :',error.message);return send(res,503,{message:'Envoi de l’e-mail impossible pour le moment.'});}
    return done();
  }
  if(pathname==='/api/auth/verify'&&req.method==='POST'){
    const body=await readJson(req);let email,challenge;
    if(typeof body.token==='string'&&body.token.length<100){const h=hash(body.token);for(const [key,value] of challenges)if(value.tokenHash===h){email=key;challenge=value;}}
    else{email=String(body.email||'').trim().toLowerCase();challenge=challenges.get(email);
      if(limited('verify:'+clientIp(req),30,15*6e4))return send(res,429,{message:'Trop de tentatives. Réessayez dans quelques minutes.'});
      if(challenge&&(++challenge.attempts>5||hash(String(body.code||''))!==challenge.codeHash)){if(challenge.attempts>5)challenges.delete(email);challenge=null;}}
    if(!challenge||challenge.exp<Date.now())return send(res,401,{message:'Code ou lien invalide ou expiré. Demandez un nouveau code.'});
    challenges.delete(email);
    const user=await findUserByEmail(email).catch(()=>null);
    if(!user||user.id!==challenge.userId||!ALLOWED_STATUS.has(user.status))return send(res,401,{message:'Compte non autorisé.'});
    await activate(user);statusCache.delete(user.id);
    const tokens=sessionTokens(req).filter(t=>readToken(t).id!==user.id);tokens.push(issue(user));setSessions(res,tokens.slice(-6));
    return send(res,200,{profile:publicProfile(user)});
  }
  if(pathname==='/api/auth/logout'&&req.method==='POST'){
    const id=String((await readJson(req)).id||'');setSessions(res,sessionTokens(req).filter(t=>id&&readToken(t).id!==id));return send(res,200,{ok:true});
  }
  return send(res,404,{message:'Introuvable.'});
}
function serveFile(res,file,status=200){
  fs.readFile(file,(error,content)=>{if(error)return send(res,404,'Introuvable','text/plain; charset=utf-8');
    const ext=path.extname(file),immutable=file.includes(path.sep+'vendor'+path.sep)||file.includes(path.sep+'icons'+path.sep);
    res.writeHead(status,{'Content-Type':TYPES[ext]||'application/octet-stream','Cache-Control':immutable?'public, max-age=2592000':'no-cache'});res.end(content);});}
async function hasSession(req){for(const token of sessionTokens(req)){const user=await findUserById(readToken(token).id).catch(()=>null);if(user&&ALLOWED_STATUS.has(user.status))return true;}return false;}

const server=http.createServer(async(req,res)=>{
  for(const [k,v] of Object.entries(SECURITY_HEADERS))res.setHeader(k,v);
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{return send(res,400,{message:'Requête invalide.'});}
  try{
    if(pathname.startsWith('/api/'))return await api(req,res,pathname);
    if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{message:'Méthode non autorisée.'});
    if(pathname==='/'||pathname==='/index.html'&&!(await hasSession(req))){res.writeHead(302,{Location:'/demarrer.html','Cache-Control':'no-store'});return res.end();}
    if(pathname==='/robots.txt')return send(res,200,'User-agent: *\nDisallow: /\n','text/plain; charset=utf-8');
    const file=path.resolve(config.root,'.'+pathname);
    if(!file.startsWith(config.root+path.sep)||!TYPES[path.extname(file)])return send(res,404,'Introuvable','text/plain; charset=utf-8');
    if(!PUBLIC.has(pathname)&&!(await hasSession(req)))return send(res,401,'Connexion requise','text/plain; charset=utf-8');
    return serveFile(res,file);
  }catch(error){console.error(error);return send(res,500,{message:'Erreur interne.'});}
});
server.listen(config.port,()=>console.log(`Constats — serveur d'accès sur le port ${config.port}`));
