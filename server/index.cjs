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
{const report=['APP_URL','SESSION_SECRET','AIRTABLE_TOKEN','AIRTABLE_BASE_ID','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','MAIL_FROM','MS_CLIENT_ID','MS_CLIENT_SECRET','MS_TENANT_ID'].map(name=>{const value=String(env[name]||'').trim();return `  ${name} : ${value?`reçu (${value.length} caractères)`:'ABSENT'}`;});
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
  return {airtableId:record.id,kind,name:String(f['Code Constats']||f['Nom du projet']||'').slice(0,200),reference:String(f['Référence']||'').slice(0,100),type:airtableType==='Expertise amiable'?'Expertise privée':airtableType||'Autre',
    client:kind==='ep'?String(f['Client / Juridiction']||'').slice(0,200):'',address:address.slice(0,300),status:LOCAL_STATUS.has(status)?status:status==='Archivé'?'Clos':'En cours'};}
function projectFields(body,kind,creating,userId){const text=(v,max)=>String(v??'').trim().slice(0,max),fields={};
  // « Nom du projet » est une formule dans Airtable (non modifiable) : le nom saisi va dans « Code Constats »,
  // qui reprend en expertise judiciaire le code du tableau de suivi (EJ24-358_NOM). Sans référence, on en garde le n° (avant « _ »).
  if(body.name!==undefined)fields['Code Constats']=text(body.name,200);if(body.reference!==undefined)fields['Référence']=text(body.reference,100);
  if(!fields['Référence']&&creating){const code=/^(EJ[\w-]+?)_/i.exec(fields['Code Constats']||'');if(code)fields['Référence']=code[1].toUpperCase();}
  if(body.address!==undefined)fields['Adresse du site']=text(body.address,300);if(LOCAL_STATUS.has(body.status))fields.Statut=body.status;
  if(LOCAL_TO_AIRTABLE_TYPE[body.type])fields.Type=LOCAL_TO_AIRTABLE_TYPE[body.type];
  if(kind==='ep'&&body.client!==undefined)fields['Client / Juridiction']=text(body.client,200);
  if(creating){fields.Responsable=[userId];fields['Ouvert le']=new Date().toISOString().slice(0,10);}
  return fields;}
async function userProjectIds(userId){if(config.devUsers)return devProjects.filter(p=>p.owner===userId).map(p=>p.id);
  const record=await airtable('/'+encodeURIComponent(userId));return Array.isArray(record.fields?.Projets)?record.fields.Projets:[];}
async function listProjects(user){return (await listProjectsRaw(user)).filter(p=>(ROLE_TYPES[user.role]||['autre']).includes(p.kind)&&p.name).map(({kind,...p})=>p);}
async function listProjectsRaw(user){return (await projectRecords(user)).map(projectFrom);}
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
// ── Tableaux de suivi (Excel, OneDrive) → dossiers de l'application ─────────────────────────
// Les tableaux de suivi sont la référence des dossiers (plus la table Projets d'Airtable dès que la lecture OneDrive est
// configurée). Le serveur les lit par Microsoft Graph avec le compte OneDrive de chaque expert (connexion OAuth une fois,
// jeton chiffré dans DATA_DIR) : seules les lignes « En cours » deviennent des dossiers ; du tableau judiciaire, seuls le
// code et le n° d'expertise sont repris. Profil judiciaire : tableau des expertises judiciaires ; profil expertise privée :
// tableaux des expertises privées et des missions de conseil. Dernière lecture conservée sur le serveur (hors réseau OneDrive).
const graph={tenant:env.MS_TENANT_ID||'organizations',clientId:env.MS_CLIENT_ID||'',clientSecret:env.MS_CLIENT_SECRET||'',
  api:(env.GRAPH_API_URL||'https://graph.microsoft.com/v1.0').replace(/\/+$/,''),login:(env.MS_LOGIN_URL||'https://login.microsoftonline.com').replace(/\/+$/,'')};// adresses : tests uniquement
graph.ready=!!(graph.clientId&&graph.clientSecret&&config.appUrl);
// Écriture : rangement des rapports et des photos dans le dossier OneDrive de la mission à la clôture du constat.
const GRAPH_SCOPE='offline_access Files.ReadWrite';
const cleanPath=v=>'/'+String(v).replace(/^\/+/,'');
const TABLEAUX={
  ej:{label:'expertises judiciaires',prefix:'EJ',type:'Expertise judiciaire',file:cleanPath(env.TABLEAU_SUIVI_CHEMIN||'EXPERT JUDICIAIRE/DOSSIERS/Dossiers en cours/Tableau_suivi_expertises.xlsx'),sheet:env.TABLEAU_SUIVI_FEUILLE||'Suivi expertises',nominatif:true},
  ep:{label:'expertises privées',prefix:'EP',type:'Expertise privée',file:cleanPath(env.TABLEAU_EP_CHEMIN||'EXPERTISES/Expertises 2026/Tableau_suivi_expertises_privees.xlsx'),sheet:env.TABLEAU_EP_FEUILLE||'Suivi'},
  cs:{label:'missions de conseil',prefix:'CS',type:'Conseil / AMO',file:cleanPath(env.TABLEAU_CS_CHEMIN||'DEV-CONSULT/Tableau_suivi_missions_conseil.xlsx'),sheet:env.TABLEAU_CS_FEUILLE||'Suivi'}};
const TABLEAU_PARSE=2;// à augmenter quand la lecture des tableaux change : relecture des fichiers même inchangés
const ROLE_TABLEAUX={'Expert judiciaire':['ej'],'Expert':['ep','cs']};
const msKey=crypto.createHash('sha256').update('microsoft:'+config.secret).digest(),msPath=userId=>path.join(DATA_DIR,'microsoft',safeId(userId)+'.json');
function msSave(userId,refreshToken){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',msKey,iv),data=Buffer.concat([c.update(refreshToken,'utf8'),c.final()]);
  writeAtomic(msPath(userId),JSON.stringify({iv:b64(iv),tag:b64(c.getAuthTag()),data:b64(data),at:new Date().toISOString()}));}
function msLoad(userId){try{const s=JSON.parse(fs.readFileSync(msPath(userId),'utf8')),d=crypto.createDecipheriv('aes-256-gcm',msKey,Buffer.from(s.iv,'base64url'));d.setAuthTag(Buffer.from(s.tag,'base64url'));
  return Buffer.concat([d.update(Buffer.from(s.data,'base64url')),d.final()]).toString('utf8');}catch{return null;}}
const msTokens=new Map(),msNonces=new Map();// userId → {token, exp} ; nonce → exp
function msState(userId){const payload=b64(JSON.stringify({id:userId,n:crypto.randomBytes(12).toString('hex'),exp:Date.now()+15*6e4}));msNonces.set(JSON.parse(Buffer.from(payload,'base64url')).n,Date.now()+15*6e4);return payload+'.'+sign(payload);}
function msReadState(state){const [payload,mac]=String(state).split('.');if(!payload||!mac||mac.length!==sign(payload).length||!crypto.timingSafeEqual(Buffer.from(mac),Buffer.from(sign(payload))))return null;
  try{const data=JSON.parse(Buffer.from(payload,'base64url'));if(data.exp<Date.now()||!msNonces.has(data.n))return null;msNonces.delete(data.n);return data;}catch{return null;}}
async function msTokenRequest(params){const res=await fetch(`${graph.login}/${encodeURIComponent(graph.tenant)}/oauth2/v2.0/token`,{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({client_id:graph.clientId,client_secret:graph.clientSecret,scope:GRAPH_SCOPE,...params})});const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.access_token)throw Object.assign(new Error('Microsoft '+(data.error||res.status)),{grant:data.error==='invalid_grant'});return data;}
function msRemember(userId,data){msTokens.set(userId,{token:data.access_token,exp:Date.now()+(Number(data.expires_in)||3600)*1000-6e4});if(data.refresh_token)msSave(userId,data.refresh_token);}
async function msAccessToken(userId){const cached=msTokens.get(userId);if(cached&&cached.exp>Date.now())return cached.token;
  const refresh=msLoad(userId);if(!refresh)return null;
  try{msRemember(userId,await msTokenRequest({grant_type:'refresh_token',refresh_token:refresh}));return msTokens.get(userId).token;}
  catch(error){if(error.grant){try{fs.unlinkSync(msPath(userId));}catch{}return null;}throw error;}}
async function graphGet(token,pathname){const res=await fetch(graph.api+pathname,{signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`}});
  if(!res.ok)throw Object.assign(new Error('Graph '+res.status),{status:res.status});return res.json();}
const drivePath=file=>file.split('/').map(encodeURIComponent).join('/');
// Lecture du .xlsx téléchargé (droit Files.Read suffisant, contrairement à l'API « classeur » de Graph) : archive ZIP + XML.
function unzip(buf){const files=new Map();let end=buf.length-22;while(end>=0&&buf.readUInt32LE(end)!==0x06054b50)end--;if(end<0)throw new Error('xlsx illisible');
  let p=buf.readUInt32LE(end+16);for(let n=buf.readUInt16LE(end+10);n>0;n--){if(buf.readUInt32LE(p)!==0x02014b50)throw new Error('xlsx illisible');
    const method=buf.readUInt16LE(p+10),size=buf.readUInt32LE(p+20),nameLen=buf.readUInt16LE(p+28),local=buf.readUInt32LE(p+42),name=buf.toString('utf8',p+46,p+46+nameLen);
    const start=local+30+buf.readUInt16LE(local+26)+buf.readUInt16LE(local+28),data=buf.subarray(start,start+size);
    files.set(name,method===8?require('node:zlib').inflateRawSync(data):data);p+=46+nameLen+buf.readUInt16LE(p+30)+buf.readUInt16LE(p+32);}
  return files;}
const xmlText=s=>s.replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(n)).replace(/&amp;/g,'&');
function xlsxSheet(buf,sheetName){const files=unzip(buf),read=name=>files.get(name)?.toString('utf8')||'';
  const shared=[...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m=>xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t=>t[1]).join('')));
  const sheet=[...read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map(m=>m[0]).find(tag=>xmlText((/name="([^"]*)"/.exec(tag)||[])[1]||'')===sheetName);if(!sheet)throw new Error('feuille absente');
  const rid=(/r:id="([^"]+)"/.exec(sheet)||[])[1],rel=[...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map(m=>m[0]).find(tag=>tag.includes(`Id="${rid}"`));
  const target=(/Target="([^"]+)"/.exec(rel||'')||[])[1]||'',xml=read(target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,''));
  // Liens hypertexte (colonne « Dossier OneDrive ») : cellule → adresse, d'après les relations de la feuille.
  const relsName=(target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'')).replace(/([^/]+)$/,'_rels/$1.rels'),links=new Map();
  const sheetRels=[...read(relsName).matchAll(/<Relationship\b[^>]*>/g)].map(m=>m[0]);
  for(const h of xml.matchAll(/<hyperlink\b[^>]*>/g)){const ref=(/ref="([A-Z]+\d+)"/.exec(h[0])||[])[1],id=(/r:id="([^"]+)"/.exec(h[0])||[])[1],rel=sheetRels.find(t=>t.includes(`Id="${id}"`));
    if(ref&&rel)links.set(ref,xmlText((/Target="([^"]*)"/.exec(rel)||[])[1]||''));}
  const rows=[...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row=>{const cells=[];
    for(const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){const ref=(/r="([A-Z]+)/.exec(c[1])||[])[1]||'',type=(/t="(\w+)"/.exec(c[1])||[])[1],body=c[2]||'';
      const col=[...ref].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1,v=(/<v>([\s\S]*?)<\/v>/.exec(body)||[])[1];
      cells[col<0?cells.length:col]=type==='s'?shared[Number(v)]??'':type==='inlineStr'?xmlText(body):xmlText(v??'');}
    return Array.from(cells,c=>c??'');});
  return {rows,links,rowNumbers:[...xml.matchAll(/<row\b[^>]*?r="(\d+)"/g)].map(m=>Number(m[1]))};}
// Lien « Dossier OneDrive » → chemin dans le OneDrive. Formes rencontrées : lien web SharePoint, chemin Windows du OneDrive
// synchronisé (éventuellement en file:/// avec espaces codés) et chemin relatif au tableau (forme enregistrée par Excel).
function oneDrivePath(link,tableFile){let v=String(link||'').trim();if(!v)return '';try{v=decodeURIComponent(v);}catch{}
  let m=/\/Documents\/(.+)$/.exec(v.split('?')[0]);if(m)return m[1].replace(/\/+$/,'');
  v=v.replace(/^file:\/*/i,'').replace(/\\/g,'/');m=/OneDrive - [^/]+\/(.+)$/.exec(v);if(m)return m[1].replace(/\/+$/,'');
  if(/^[a-z]+:|^\/\//i.test(v))return '';// autre disque ou adresse : hors du OneDrive
  const parts=path.posix.dirname(cleanPath(tableFile||'')).split('/').filter(Boolean);
  for(const seg of v.split('/')){if(!seg||seg==='.')continue;if(seg==='..')parts.pop();else parts.push(seg);}
  return parts.join('/');}
// Lignes du tableau → dossiers « En cours ». Ligne d'en-tête repérée par la colonne « Code Constats ».
function tableauRows(sheet,key){const t=TABLEAUX[key],values=sheet.rows,header=values.findIndex(row=>row.some(c=>/^code constats/i.test(String(c).trim())));if(header<0)throw new Error('colonne « Code Constats » absente');
  const cols=values[header].map(c=>String(c).trim().toLowerCase()),find=test=>cols.findIndex(test),iCode=find(c=>c.startsWith('code constats')),iStatut=cols.indexOf('statut');
  const iClient=t.nominatif?-1:find(c=>c.startsWith('client')),iAdresse=t.nominatif?-1:find(c=>c.startsWith('adresse')||c.startsWith('site')),iLien=find(c=>c.startsWith('dossier onedrive'));
  const code=new RegExp(`^(${t.prefix}\\d[\\w-]*?)_[\\w'-]+$`,'i'),out=new Map(),colName=i=>{let n='';for(i++;i>0;i=Math.floor((i-1)/26))n=String.fromCharCode(65+(i-1)%26)+n;return n;};
  values.slice(header+1).forEach((row,i)=>{const value=String(row[iCode]??'').trim(),m=code.exec(value);if(!m||String(row[iStatut]??'').trim().toLowerCase()!=='en cours')return;
    const rowNumber=sheet.rowNumbers[header+1+i],reference=m[1].toUpperCase();
    out.set(reference,{reference,code:value.slice(0,200),type:t.type,client:iClient>=0?String(row[iClient]??'').trim().slice(0,200):'',address:iAdresse>=0?String(row[iAdresse]??'').trim().slice(0,300):'',
      onedrive:iLien>=0?oneDrivePath(sheet.links.get(colName(iLien)+rowNumber),t.file):''});});
  return [...out.values()];}
async function projectRecords(user){const ids=(await userProjectIds(user.id)).filter(id=>/^rec\w{14}$|^dev-/.test(id)).slice(0,200);
  if(config.devUsers)return devProjects.filter(p=>ids.includes(p.id)).map(p=>({id:p.id,fields:p.fields}));
  const records=[];for(let i=0;i<ids.length;i+=50){const formula=`OR(${ids.slice(i,i+50).map(id=>`RECORD_ID()='${id}'`).join(',')})`;
    const data=await airtable(`?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`,{},config.projectsTable);records.push(...(data.records||[]));}
  return records;}
// Dossiers du compte : dernière lecture des tableaux + dossiers créés dans l'application (« hors tableau ») ; DATA_DIR.
const dossiersPath=userId=>path.join(DATA_DIR,'dossiers',safeId(userId)+'.json');
function readDossierStore(userId){try{const v=JSON.parse(fs.readFileSync(dossiersPath(userId),'utf8'));return {tableaux:v.tableaux||{},manuels:Array.isArray(v.manuels)?v.manuels:[]};}catch{return {tableaux:{},manuels:[]};}}
function writeDossierStore(userId,store){writeAtomic(dossiersPath(userId),JSON.stringify(store));}
const STATUS_OK=new Set(['En cours','En attente','Clos']);
function dossierOut(d){return {airtableId:d.key,name:d.name||d.code,reference:d.reference||'',type:d.type,client:d.type==='Expertise judiciaire'?'':d.client||'',address:d.address||'',status:STATUS_OK.has(d.status)?d.status:'En cours',horsTableau:!!d.manuel};}
function composeDossiers(store,keys){const fromTables=keys.flatMap(k=>(store.tableaux[k]?.rows||[]).map(r=>({...r,key:'tab-'+r.reference,status:'En cours'}))),refs=new Set(fromTables.map(d=>d.reference));
  return [...fromTables,...store.manuels.filter(d=>!d.reference||!refs.has(d.reference.toUpperCase())).map(d=>({...d,manuel:true}))].map(dossierOut);}
const tableauState=new Map();// userId → {checkedAt, running}
// mode « cache » : dernière lecture ; « auto » : relecture au plus toutes les 2 minutes, et seulement des fichiers modifiés ;
// « force » : bouton « Rechercher dans les tableaux de suivi ».
async function readTableaux(user,mode){const keys=ROLE_TABLEAUX[user.role]||[];if(!keys.length)return {store:readDossierStore(user.id),keys,result:null};
  if(!graph.ready)return {store:readDossierStore(user.id),keys,result:{etat:'non-configure',message:'Lecture des tableaux de suivi non configurée sur le serveur.'}};
  if(!storeReady)return {store:{tableaux:{},manuels:[]},keys,result:{etat:'erreur',message:'Stockage du serveur indisponible.'}};
  const st=tableauState.get(user.id)||{};tableauState.set(user.id,st);
  if(mode==='cache'||(mode!=='force'&&st.checkedAt&&Date.now()-st.checkedAt<2*6e4)){const store=readDossierStore(user.id);return {store,keys,result:st.last?{...st.last,inchange:true}:null};}
  if(st.running)return st.running;
  st.running=(async()=>{const store=readDossierStore(user.id),before=new Set(composeDossiers(store,keys).map(d=>d.airtableId)),tableaux=[];
    try{const token=await msAccessToken(user.id);if(!token)return {store,keys,result:{etat:'a-connecter',message:'Connectez votre OneDrive pour lire vos tableaux de suivi.'}};
      for(const key of keys){const t=TABLEAUX[key],prev=store.tableaux[key]||{};
        try{const item=await graphGet(token,`/me/drive/root:${drivePath(t.file)}`);
          if(mode==='force'||prev.etag!==item.eTag||prev.v!==TABLEAU_PARSE){const file=await fetch(graph.api+`/me/drive/root:${drivePath(t.file)}:/content`,{signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`}});
            if(!file.ok)throw Object.assign(new Error('Graph '+file.status),{status:file.status});
            store.tableaux[key]={v:TABLEAU_PARSE,etag:item.eTag,modifie:item.lastModifiedDateTime||'',lu:new Date().toISOString(),rows:tableauRows(xlsxSheet(Buffer.from(await file.arrayBuffer()),t.sheet),key)};}
          tableaux.push({nom:t.label,etat:'ok',enCours:store.tableaux[key].rows.length,modifie:store.tableaux[key].modifie});}
        catch(error){console.error(`Tableau des ${t.label} :`,error.message);if(error.grant)throw error;
          tableaux.push({nom:t.label,etat:'erreur',message:error.status===404?`Tableau introuvable dans OneDrive (${t.file}).`:/colonne|feuille|xlsx/.test(error.message)?`Tableau illisible : ${error.message}.`:'Lecture impossible pour le moment.'});}}
      writeDossierStore(user.id,store);const after=composeDossiers(store,keys).map(d=>d.airtableId);
      const result={etat:tableaux.every(t=>t.etat==='ok')?'ok':'erreur',tableaux,ajoutes:after.filter(k=>!before.has(k)).length,retires:[...before].filter(k=>!after.includes(k)).length};
      if(result.etat!=='ok')result.message=tableaux.filter(t=>t.etat!=='ok').map(t=>`${t.nom} : ${t.message}`).join(' ');
      const ended=[...before].filter(k=>k.startsWith('tab-')&&!after.includes(k)).map(k=>k.slice(4));if(ended.length&&tableaux.every(t=>t.etat==='ok'))await cleanupEndedDossiers(user,ended).catch(error=>console.warn('Nettoyage des dossiers terminés :',error.message));
      st.last=result;st.checkedAt=Date.now();return {store,keys,result};}
    catch(error){console.error('Tableaux de suivi :',error.message);return {store,keys,result:{etat:'erreur',message:'Lecture des tableaux impossible pour le moment.'}};}})();
  try{return await st.running;}finally{st.running=null;}}
// Dossier créé ou modifié dans l'application (hors tableau) : conservé sur le serveur, visible sur tous les appareils.
// Un dossier issu d'un tableau se modifie dans le tableau.
function saveManualDossier(user,body,key){if(key&&key.startsWith('tab-'))throw Object.assign(new Error('tableau'),{status:409});
  const kind=PROJECT_TYPES[LOCAL_TO_AIRTABLE_TYPE[body.type]]||'autre';if(body.type&&!(ROLE_TYPES[user.role]||['autre']).includes(kind))throw Object.assign(new Error('type'),{status:403});
  const store=readDossierStore(user.id),text=(v,max)=>String(v??'').trim().slice(0,max);let d=key?store.manuels.find(x=>x.key===key):null;
  if(key&&!d)throw Object.assign(new Error('owner'),{status:404});if(!d&&!text(body.name,200))throw Object.assign(new Error('name'),{status:400});
  if(!d){d={key:'man-'+crypto.randomUUID(),created:new Date().toISOString()};store.manuels.push(d);}
  for(const [field,max] of [['name',200],['reference',100],['address',300]])if(body[field]!==undefined)d[field]=text(body[field],max);
  if(!d.reference){const m=/^((?:EJ|EP|CS)\d[\w-]*?)_/i.exec(d.name||'');if(m)d.reference=m[1].toUpperCase();}
  if(LOCAL_TO_AIRTABLE_TYPE[body.type])d.type=body.type==='Expertise amiable'?'Expertise privée':body.type;d.type=d.type||'Autre';
  d.client=d.type==='Expertise judiciaire'?'':body.client!==undefined?text(body.client,200):d.client||'';if(STATUS_OK.has(body.status))d.status=body.status;
  writeDossierStore(user.id,store);return dossierOut({...d,manuel:true});}
setInterval(()=>{const now=Date.now();for(const [k,v] of msNonces)if(v<now)msNonces.delete(k);},6e4).unref();
// Le constat ne doit contenir que des références « fichier:<empreinte> » : aucune image intégrée.
function blobRefs(value,found=new Set()){if(typeof value==='string'){if(value.startsWith('data:'))throw Object.assign(new Error('inline'),{status:400});const m=/^fichier:([a-f0-9]{64})$/.exec(value);if(m)found.add(m[1]);}
  else if(Array.isArray(value))value.forEach(v=>blobRefs(v,found));else if(value&&typeof value==='object')Object.values(value).forEach(v=>blobRefs(v,found));return found;}
function cleanVisit(visit,ej){const v={...visit};if(ej){v.clientName='';v.clientAddress='';v.attendance=[];if(v.dossier&&typeof v.dossier==='object')v.dossier={...v.dossier,client:''};}return v;}
function constatSummary(record){const v=record.visit||{};return {draftId:v.draftId,version:record.version,updatedAt:record.updatedAt,status:record.status,caseReference:String(v.caseReference||'').slice(0,100),caseName:String(v.caseName||'').slice(0,200),caseType:v.caseType||'autre',visitDate:v.visitDate||'',photos:Array.isArray(v.photos)?v.photos.length:0,closedAt:v.closedAt||'',savedAt:v.savedAt||'',onedrive:record.onedrive?.ok?{at:record.onedrive.at,fichiers:record.onedrive.fichiers,aJour:record.onedrive.version===record.version}:null,dossierTermine:!!record.dossierTermine,airtable:record.mirroredVersion===record.version?'copié':record.airtableError?'erreur : '+record.airtableError:'en attente'};}
async function saveVisit(user,draftId,body){
  const visit=body.visit;if(!DRAFT_ID.test(draftId)||!visit||typeof visit!=='object'||visit.draftId!==draftId||!Array.isArray(visit.photos))throw Object.assign(new Error('visit'),{status:400});
  blobRefs(visit);const current=readConstat(user.id,draftId);
  if(current&&body.force!==true&&Number(body.baseVersion)!==current.version)return {conflict:true,...constatSummary(current)};
  const ej=visit.caseType==='ej'||visit.dossier?.type==='Expertise judiciaire';
  const record={version:(current?.version||0)+1,updatedAt:new Date().toISOString(),status:CONSTAT_STATUS.has(body.status)?body.status:'Brouillon',visit:cleanVisit(visit,ej),
    airtable:current?.airtable||{},mirroredVersion:current?.mirroredVersion||0};
  writeAtomic(constatPath(user.id,draftId),JSON.stringify(record));
  // Modifié sur un appareil après sa suppression sur un autre : le constat est conservé (rien n'est perdu).
  const tombs=readTombs(user.id);if(tombs[draftId]){delete tombs[draftId];writeTombs(user.id,tombs);}
  scheduleMirror(user.id,draftId,record.status!==current?.status&&record.status!=='Brouillon'?5000:MIRROR_DELAY);
  return constatSummary(record);}
// Suppression d'un constat (depuis n'importe quel appareil) : fichier du serveur et copie Airtable effacés ; une trace
// « supprimé » (identifiant et date, 180 jours) permet aux autres appareils de le retirer à leur tour.
const tombPath=userId=>path.join(DATA_DIR,'supprimes',safeId(userId)+'.json');
function readTombs(userId){try{const all=JSON.parse(fs.readFileSync(tombPath(userId),'utf8')),limit=Date.now()-180*864e5;return Object.fromEntries(Object.entries(all).filter(([,at])=>Date.parse(at)>limit));}catch{return {};}}
function writeTombs(userId,tombs){writeAtomic(tombPath(userId),JSON.stringify(tombs));}
async function deleteVisit(user,draftId){if(!DRAFT_ID.test(draftId))throw Object.assign(new Error('id'),{status:400});
  const current=readConstat(user.id,draftId),key=user.id+'/'+draftId;clearTimeout(mirrorTimers.get(key));mirrorTimers.delete(key);
  try{fs.unlinkSync(constatPath(user.id,draftId));}catch{}
  const tombs=readTombs(user.id);tombs[draftId]=new Date().toISOString();writeTombs(user.id,tombs);
  if(/^rec\w{14}$/.test(current?.airtable?.id||'')&&(!config.devUsers||env.DEV_MIRROR))await airtable('/'+encodeURIComponent(current.airtable.id),{method:'DELETE'},config.constatsTable).catch(error=>console.warn('Suppression de la copie Airtable du constat :',error.message));
  return {ok:true};}
// ── Rangement dans OneDrive à la clôture du constat ─────────────────────────────────────────
// L'appareil envoie le rapport HTML produit à la clôture ; le serveur le dépose avec les photos (et annotations, notes
// manuscrites, sons) dans « <dossier OneDrive de la mission>/CONSTATS/AAAA-MM-JJ/ » (ou un sous-dossier « Constats » existant, ex. « 10_Constats »). Le dossier de la mission est le lien
// « Dossier OneDrive » de la ligne du tableau de suivi (référence du constat).
const FILE_EXT={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/bmp':'bmp','image/avif':'avif','audio/mp4':'m4a','audio/mpeg':'mp3','audio/ogg':'ogg','audio/webm':'webm','audio/wav':'wav','video/webm':'webm'};
const slug=v=>String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\w-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
async function graphUpload(token,file,data,type){const url=graph.api+`/me/drive/root:${drivePath(cleanPath(file))}:`,fail=res=>Object.assign(new Error('Graph '+res.status),{status:res.status});
  if(data.length<=4e6){const res=await fetch(url+'/content',{method:'PUT',signal:AbortSignal.timeout(120000),headers:{Authorization:`Bearer ${token}`,'Content-Type':type||'application/octet-stream'},body:data});if(!res.ok)throw fail(res);return;}
  // Fichier volumineux (rapport avec photos intégrées) : session d'envoi par morceaux (multiples de 320 Kio).
  const session=await fetch(url+'/createUploadSession',{method:'POST',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({item:{'@microsoft.graph.conflictBehavior':'replace'}})});
  if(!session.ok)throw fail(session);const {uploadUrl}=await session.json(),size=327680*30;
  for(let i=0;i<data.length;i+=size){const part=data.subarray(i,i+size),res=await fetch(uploadUrl,{method:'PUT',signal:AbortSignal.timeout(120000),headers:{'Content-Range':`bytes ${i}-${i+part.length-1}/${data.length}`},body:part});if(!res.ok)throw fail(res);}}
// Dossier de la mission : lien de la ligne du tableau ; à défaut, recherche dans le dossier du tableau et ses sous-dossiers
// (ex. dossiers rangés par tribunal) d'un dossier dont le nom contient le n° de l'expertise (« …MI24-358… ») ou le nom
// court du code (« MATHIAS » pour EJ24-358_MATHIAS → « MATHIAS-OLIVIER TERRASS » ; « PENA-METAUX » → « PENA Métaux »).
// Dossier absent des tableaux (ligne sans statut « En cours », dossier créé dans l'application) : même recherche dans le
// dossier du tableau de son préfixe (CS → DEV-CONSULT), d'après le nom du dossier. Retourne {path, how}.
const normName=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const graphFolders=async(token,p)=>((await graphGet(token,`/me/drive/root:${drivePath(cleanPath(p))}:/children?$select=name,folder&$top=999`).catch(()=>({value:[]}))).value||[]).filter(i=>i.folder).map(i=>({name:i.name,path:`${cleanPath(p)}/${i.name}`}));
async function searchMissionFolder(token,key,ref,code){const dir=path.posix.dirname(TABLEAUX[key]?.file||'');if(dir==='/')return null;
  const number=ref.replace(/^[A-Z]+/,''),byNumber=number?new RegExp(`(^|[^0-9])${number.replace(/[^0-9]+/g,'[^0-9]?')}([^0-9]|$)`):/(?!)/;
  const suffix=normName(/^[A-Z]{2}\d[\w-]*_/i.test(code)?String(code).replace(/^[^_]*_/,''):code),first=suffix.split(' ')[0];
  const exact=name=>!!suffix&&(` ${normName(name)} `).includes(` ${suffix} `),starts=name=>!!suffix&&(normName(name)+' ').startsWith(suffix+' ');
  const byName=name=>exact(name)||first.length>=4&&normName(name).split(' ').includes(first);
  const level1=await graphFolders(token,dir),level2=[];for(const f of level1)if(!byNumber.test(f.name))level2.push(...await graphFolders(token,f.path));
  // N° : premier dossier qui le porte. Nom : dossier du client nommé d'après le code (« PENA Métaux », pas « PENA ENVIRONNEMENT »),
  // puis correspondance unique, de préférence au niveau des dossiers d'expertise (sous les dossiers par tribunal), jamais un
  // dossier qui contient lui-même d'autres dossiers d'expertise correspondants.
  const unique=(list,test)=>{const named=list.filter(f=>test(f.name));return named.length===1?named[0]:null;};
  const found=[...level1,...level2].find(f=>byNumber.test(f.name))||unique(level1,starts)||unique(level2,exact)||unique(level2,byName)||(level2.some(f=>byName(f.name))?null:unique(level1.filter(f=>!level2.some(c=>c.path.startsWith(f.path+'/'))),byName));
  return found?{path:found.path.slice(1),how:'recherche par '+(byNumber.test(found.name)?'n°':'nom')}:null;}
async function missionFolder(user,visit,token){const ref=String(visit.caseReference||visit.dossier?.reference||'').trim().toUpperCase(),name=String(visit.caseName||visit.dossier?.name||'').trim();
  const store=readDossierStore(user.id);for(const [key,t] of Object.entries(store.tableaux)){const row=(t.rows||[]).find(r=>r.reference===ref);if(!ref||!row)continue;if(row.onedrive)return {path:row.onedrive,how:'lien du tableau'};
    return await searchMissionFolder(token,key,ref,row.code)||{path:'',how:'introuvable'};}
  if(!ref&&!name)return {path:'',how:'sans référence'};
  const keys=(ROLE_TABLEAUX[user.role]||[]).filter(k=>!ref||ref.startsWith(TABLEAUX[k].prefix));
  for(const key of keys){const found=await searchMissionFolder(token,key,ref,name);if(found)return {...found,how:found.how+', hors tableau'};}
  return {path:'',how:'dossier absent des tableaux'};}
// Sous-dossier des constats : dossier existant nommé « Constats », éventuellement numéroté (« 10_Constats ») ; sinon « CONSTATS ».
async function constatsFolder(token,base){return (await graphFolders(token,base)).find(f=>/^(\d+ )?CONSTATS( |$)/.test(normName(f.name)))?.name||'CONSTATS';}
async function depositVisit(user,draftId,body){const record=readConstat(user.id,draftId);if(!record)throw Object.assign(new Error('absent'),{status:404});
  const v=record.visit;if(!v.closedAt)throw Object.assign(new Error('Constat non terminé.'),{status:409});
  const token=await msAccessToken(user.id);if(!token)throw Object.assign(new Error('Connectez OneDrive (droit d’écriture) pour ranger les constats terminés.'),{status:428});
  const found=await missionFolder(user,v,token),base=found.path;console.log(`Rangement OneDrive ${draftId.slice(0,8)} (${String(v.caseReference||'').slice(0,20)}) : dossier ${base?'trouvé ('+found.how+')':'non trouvé ('+found.how+')'}`);
  if(!base)throw Object.assign(new Error('Pas de dossier OneDrive trouvé pour ce constat : vérifiez sa référence et, dans le tableau de suivi, le statut « En cours » et le lien « Ouvrir » (Dossier OneDrive) de sa ligne'),{status:422});
  // Un dossier par jour de visite ; un second constat du même jour va dans « AAAA-MM-JJ (2) ».
  const day=/^\d{4}-\d{2}-\d{2}$/.test(v.visitDate||'')?v.visitDate:String(v.closedAt).slice(0,10),used=new Set(listVisits(user.id).filter(c=>c.draftId!==draftId).map(c=>readConstat(user.id,c.draftId)?.onedrive?.folder).filter(Boolean));
  const sub=await constatsFolder(token,base);let folder=`${base}/${sub}/${day}`;for(let n=2;used.has(folder);n++)folder=`${base}/${sub}/${day} (${n})`;
  const files=[],name=String(body.name||'').split(/[\\/]/).pop().replace(/[^\w.() -]+/g,'_').slice(0,120);
  if(typeof body.html==='string'&&body.html.length&&/\.html?$/i.test(name))files.push({path:`${folder}/${name}`,data:Buffer.from(body.html,'utf8'),type:'text/html'});
  for(const p of v.photos||[])for(const [field,suffix] of [['src',''],['annotatedSrc','_annotee'],['drawing','_note-manuscrite'],['audio','_son']]){const m=/^fichier:([a-f0-9]{64})$/.exec(p[field]||'');if(!m)continue;
    let type;try{type=fs.readFileSync(blobPath(user.id,m[1])+'.type','utf8');}catch{continue;}
    files.push({path:`${folder}/Photos/Photo_${String(p.number).padStart(2,'0')}_${slug(p.subject)||'photo'}${suffix}.${FILE_EXT[type]||'bin'}`,file:blobPath(user.id,m[1]),type});}
  if(!files.some(f=>f.type==='text/html'))throw Object.assign(new Error('Rapport absent : rouvrez le constat puis terminez-le à nouveau'),{status:422});
  try{for(const f of files)await graphUpload(token,f.path,f.data||fs.readFileSync(f.file),f.type);}
  catch(error){if(error.status===401||error.status===403)throw Object.assign(new Error('OneDrive refuse l’écriture : reconnectez OneDrive pour accorder le droit d’écriture.'),{status:428});throw error;}
  const latest=readConstat(user.id,draftId)||record;latest.onedrive={ok:true,at:new Date().toISOString(),folder,fichiers:files.length,version:record.version};delete latest.dossierTermine;
  writeAtomic(constatPath(user.id,draftId),JSON.stringify(latest));console.log(`Rangement OneDrive ${draftId.slice(0,8)} : ${files.length} fichier(s) déposé(s)`);
  return {fichiers:files.length,dossier:folder.split('/').slice(-4).join('/')};}
// Dossier terminé ou retiré du tableau de suivi : ses constats déjà rangés dans OneDrive sont effacés du serveur (et des
// appareils) ; les autres sont conservés et signalés. Fichiers (photos, sons) devenus inutiles effacés (plus d'une heure).
async function cleanupEndedDossiers(user,refs){if(!refs.length||!storeReady)return;const ended=new Set(refs);
  for(const c of listVisits(user.id)){const r=readConstat(user.id,c.draftId),ref=String(r?.visit?.caseReference||r?.visit?.dossier?.reference||'').trim().toUpperCase();if(!r||!ended.has(ref))continue;
    if(r.onedrive?.ok&&r.onedrive.version===r.version)await deleteVisit(user,c.draftId);else if(!r.dossierTermine){r.dossierTermine=true;writeAtomic(constatPath(user.id,c.draftId),JSON.stringify(r));}}
  const keep=new Set(),dir=path.join(DATA_DIR,'constats',safeId(user.id));try{for(const f of fs.readdirSync(dir))if(f.endsWith('.json')){try{blobRefs(JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')).visit,keep);}catch{}}}catch{}
  const blobs=path.join(DATA_DIR,'fichiers',safeId(user.id)),limit=Date.now()-36e5;
  try{for(const f of fs.readdirSync(blobs))if(HASH.test(f)&&!keep.has(f)&&fs.statSync(path.join(blobs,f)).mtimeMs<limit){fs.rmSync(path.join(blobs,f),{force:true});fs.rmSync(path.join(blobs,f)+'.type',{force:true});}}catch{}}
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
  const projectPath=/^\/api\/projets(?:\/(rec\w{14}|dev-p\d+|man-[\w-]{10,60}|tab-[\w-]{1,60}))?$/.exec(pathname);
  if(projectPath){
    const url=new URL(req.url,'http://localhost'),body=req.method==='GET'?{}:await readJson(req),profile=String(url.searchParams.get('profil')||body.profil||'');
    const user=await sessionUser(req,profile);if(!user)return send(res,401,{message:'Profil non connecté.'});
    try{
      // Lecture OneDrive configurée : dossiers issus des tableaux de suivi (plus de table Projets) ; sinon, Airtable.
      // « complet » : chaque tableau du profil a été lu au moins une fois (sinon l'appareil ne retire aucun dossier).
      if(graph.ready){const mode=url.searchParams.get('tableau'),allowed=ROLE_TYPES[user.role]||['autre'];
        if(req.method==='GET'&&!projectPath[1]){const {store,keys,result}=await readTableaux(user,mode==='force'?'force':mode?'auto':'cache');
          return send(res,200,{projets:composeDossiers(store,keys).filter(d=>allowed.includes(PROJECT_TYPES[LOCAL_TO_AIRTABLE_TYPE[d.type]]||'autre')),complet:keys.every(k=>store.tableaux[k]),...(result?{tableau:result}:{})});}
        if(req.method==='POST'&&!projectPath[1])return send(res,201,{projet:saveManualDossier(user,body)});
        if(req.method==='PATCH'&&projectPath[1])return send(res,200,{projet:saveManualDossier(user,body,projectPath[1])});
        return send(res,405,{message:'Méthode non autorisée.'});}
      if(req.method==='GET'&&!projectPath[1])return send(res,200,{projets:await listProjects(user)});
      if(req.method==='POST'&&!projectPath[1])return send(res,201,{projet:await saveProject(user,body)});
      if(req.method==='PATCH'&&projectPath[1])return send(res,200,{projet:await saveProject(user,body,projectPath[1])});
    }catch(error){if(error.status)return send(res,error.status,{message:error.status===403?'Type de mission non autorisé pour ce profil.':error.status===409?'Dossier issu d’un tableau de suivi : modifiez-le dans le tableau.':'Dossier introuvable ou invalide.'});
      console.error('Dossiers Airtable :',error.message);return send(res,503,{message:'Airtable indisponible : dossier conservé sur l’appareil.'});}
    return send(res,405,{message:'Méthode non autorisée.'});
  }
  const depotMatch=/^\/api\/constats\/([\w-]{6,60})\/depot$/.exec(pathname);
  if(depotMatch&&req.method==='POST'){const user=await sessionUser(req,String(new URL(req.url,'http://localhost').searchParams.get('profil')||''));if(!user)return send(res,401,{message:'Profil non connecté.'});
    if(!graph.ready||!storeReady)return send(res,503,{message:'Rangement OneDrive non configuré sur le serveur.'});
    try{let body;try{body=JSON.parse(await readBody(req,40e6));}catch(error){if(error.status)throw error;return send(res,400,{message:'Rapport invalide.'});}return send(res,200,await depositVisit(user,depotMatch[1],body));}
    catch(error){if(error.status&&error.status<500){console.warn(`Rangement OneDrive ${depotMatch[1].slice(0,8)} refusé (${error.status}) : ${String(error.message).slice(0,120)}`);return send(res,error.status,{message:error.status===413?'Rapport trop volumineux.':error.message});}console.error('Rangement OneDrive :',error.message);return send(res,502,{message:'Rangement dans OneDrive impossible pour le moment.'});}}
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
      if(constatMatch&&!constatMatch[1]&&req.method==='GET')return send(res,200,{constats:listVisits(user.id),supprimes:Object.keys(readTombs(user.id))});
      if(constatMatch&&constatMatch[1]&&req.method==='DELETE')return send(res,200,await deleteVisit(user,constatMatch[1]));
      if(constatMatch&&constatMatch[1]&&req.method==='GET'){const record=readConstat(user.id,constatMatch[1]);return record?send(res,200,{version:record.version,updatedAt:record.updatedAt,visit:record.visit}):send(res,404,{message:'Constat introuvable.'});}
      if(constatMatch&&constatMatch[1]&&req.method==='PUT'){let body;try{body=JSON.parse(await readBody(req,4e6));}catch(error){if(error.status)throw error;return send(res,400,{message:'Constat invalide.'});}
        const result=await saveVisit(user,constatMatch[1],body);return send(res,result.conflict?409:200,{constat:result});}
    }catch(error){if(error.status)return send(res,error.status,{message:error.status===413?'Fichier trop volumineux.':'Données invalides.'});console.error('Sauvegarde serveur :',error.message);return send(res,500,{message:'Sauvegarde serveur impossible.'});}
    return send(res,405,{message:'Méthode non autorisée.'});
  }
  // Connexion OneDrive (une fois) : le retour s'ouvre parfois hors de l'application (iPad) ; l'état signé, à usage unique, identifie le compte.
  // Pas d'indice d'adresse : l'e-mail du compte Constats (Gmail…) n'est pas forcément le compte Microsoft qui porte le OneDrive ; choix du compte proposé.
  if(pathname==='/api/microsoft/connexion'&&req.method==='GET'){const user=await sessionUser(req,String(new URL(req.url,'http://localhost').searchParams.get('profil')||''));
    if(!user||!(ROLE_TABLEAUX[user.role]||[]).length)return send(res,401,{message:'Profil non connecté.'});if(!graph.ready)return send(res,503,{message:'Lecture du tableau non configurée.'});
    const query=new URLSearchParams({client_id:graph.clientId,response_type:'code',redirect_uri:config.appUrl+'/api/microsoft/retour',response_mode:'query',scope:GRAPH_SCOPE,state:msState(user.id),prompt:'select_account'});
    res.writeHead(302,{Location:`${graph.login}/${encodeURIComponent(graph.tenant)}/oauth2/v2.0/authorize?${query}`,'Cache-Control':'no-store'});return res.end();}
  if(pathname==='/api/microsoft/retour'&&req.method==='GET'){const url=new URL(req.url,'http://localhost'),state=msReadState(url.searchParams.get('state')),code=url.searchParams.get('code');
    const page=(title,text)=>send(res,200,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.3rem">${title}</h1><p>${text}</p><p><a href="/index.html">Revenir à Constats</a></p></body>`,'text/html; charset=utf-8');
    if(!state||!code||!storeReady)return page('Connexion OneDrive non aboutie','Lien expiré, déjà utilisé ou connexion refusée. Relancez « Connecter OneDrive » depuis l’application.');
    try{msRemember(state.id,await msTokenRequest({grant_type:'authorization_code',code,redirect_uri:config.appUrl+'/api/microsoft/retour'}));tableauState.delete(state.id);}
    catch(error){console.error('Connexion OneDrive :',error.message);return page('Connexion OneDrive non aboutie','Microsoft a refusé la connexion. Réessayez depuis l’application.');}
    return page('OneDrive connecté','Vos tableaux de suivi seront lus à chaque ouverture de ce profil. Vous pouvez revenir à l’application (fermez cet onglet si besoin).');}
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
