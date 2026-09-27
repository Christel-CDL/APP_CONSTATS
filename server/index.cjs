'use strict';
// Serveur de production de Constats : fichiers de l'application derrière un contrôle d'accès.
// Comptes : table Utilisateurs d'Airtable (e-mail, rôle, statut). Connexion sans mot de passe : code à 6 chiffres
// ou lien envoyés par e-mail, puis session signée (cookie HttpOnly). Plusieurs profils par appareil.
// Aucune donnée de constat ne transite par ce serveur : elles restent sur l'appareil.
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
  projectsTable:env.AIRTABLE_PROJECTS_TABLE||'Projets'
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
  const res=await fetch(`https://api.airtable.com/v0/${encodeURIComponent(config.airtable.base)}/${encodeURIComponent(table)}${pathname}`,{...options,headers:{Authorization:`Bearer ${config.airtable.token}`,'Content-Type':'application/json',...options.headers}});
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
async function listProjects(user){const ids=(await userProjectIds(user.id)).filter(id=>/^rec\w{14}$|^dev-/.test(id)).slice(0,200),types=ROLE_TYPES[user.role]||['autre'];
  let records=[];
  if(config.devUsers)records=devProjects.filter(p=>ids.includes(p.id)).map(p=>({id:p.id,fields:p.fields}));
  else for(let i=0;i<ids.length;i+=50){const formula=`OR(${ids.slice(i,i+50).map(id=>`RECORD_ID()='${id}'`).join(',')})`;
    const data=await airtable(`?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`,{},config.projectsTable);records.push(...(data.records||[]));}
  return records.map(projectFrom).filter(p=>types.includes(p.kind)&&p.name).map(({kind,...p})=>p);}
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
