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
  secret:env.SESSION_SECRET||'',
  sessionDays:Number(env.SESSION_DAYS)||90,
  airtable:{token:env.AIRTABLE_TOKEN||'',base:env.AIRTABLE_BASE_ID||'',table:env.AIRTABLE_USERS_TABLE||'Utilisateurs'},
  mail:{host:env.SMTP_HOST||'',port:Number(env.SMTP_PORT)||587,secure:env.SMTP_SECURE==='true',user:env.SMTP_USER||'',pass:env.SMTP_PASS||'',from:env.MAIL_FROM||''},
  devLogCodes:env.DEV_LOG_CODES==='1',
  // Tests uniquement : comptes fournis en JSON au lieu d'Airtable.
  devUsers:env.DEV_USERS?JSON.parse(env.DEV_USERS):null
};
if(config.secret.length<32){console.error('SESSION_SECRET manquant ou trop court (32 caractères minimum).');process.exit(1);}
if(!config.devUsers&&(!config.airtable.token||!config.airtable.base)){console.error('AIRTABLE_TOKEN et AIRTABLE_BASE_ID sont requis.');process.exit(1);}

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
async function airtable(pathname,options={}){
  const res=await fetch(`https://api.airtable.com/v0/${encodeURIComponent(config.airtable.base)}/${encodeURIComponent(config.airtable.table)}${pathname}`,{...options,headers:{Authorization:`Bearer ${config.airtable.token}`,'Content-Type':'application/json',...options.headers}});
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
  if(req.method==='POST'&&!sameOrigin(req))return send(res,403,{message:'Origine refusée.'});
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
