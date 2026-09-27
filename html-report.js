'use strict';
// Rapport HTML CDL EXPERT (modèles Expertise judiciaire / Expertise privée / Constat), Browser/Node.
// Les hooks data-field / data-*-index / data-include reprennent ceux des modèles v3 : un rapport généré
// peut être relu et complété par un outil externe. En expertise judiciaire, le bloc data-nominatif="true"
// est TOUJOURS laissé vide par l'application : tribunal, n° RG, parties et expert désigné sont ajoutés
// après génération, hors application (RGPD).
const REPORT_TYPES={
  ej:{label:'Expertise judiciaire',badge:'EXPERTISE JUDICIAIRE',subtitle:'Reportage photographique commenté'},
  ep:{label:'Expertise privée',badge:'EXPERTISE PRIVÉE',subtitle:'Mission d’expertise amiable — confidentiel'},
  autre:{label:'Constat',badge:'CONSTAT',subtitle:'Reportage photographique commenté'}
};
const REPORT_EXPERT={name:'Christel LACOME',brand:'CDL EXPERT — EI Christel LACOME',title:'Ingénieur-Conseil · Expert Bâtiment & Environnement',court:'Expert près le Tribunal judiciaire de Bordeaux',email:'christel.lacome@cdl-expertises.com',place:'Bordeaux'};
const OPALEXE_PATTERN=/^EJ\d{2}-\d{1,6}$/i;
// Types de dossier de l'application → modèle de rapport ; « Expertise amiable » est l'ancien libellé.
function reportTypeOf(dossierType){return dossierType==='Expertise judiciaire'?'ej':dossierType==='Expertise privée'||dossierType==='Expertise amiable'?'ep':'autre';}
function isOpalexeReference(value){return OPALEXE_PATTERN.test(String(value||'').trim());}
function reportFileName(reference,date){const ref=String(reference||'').trim().replace(/[^\w-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);const day=/^\d{4}-\d{2}-\d{2}$/.test(date||'')?date:new Date().toISOString().slice(0,10);return `${ref?ref+'_':''}CONSTAT_${day}.html`;}
// Fonctions partagées avec les procès-verbaux (pv-report.js).
const reportEsc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const reportText=value=>reportEsc(String(value??'').trim()).replace(/\r?\n/g,'<br>');
const reportImage=src=>typeof src==='string'&&/^data:image\/(jpeg|png|webp|gif);base64,/i.test(src)?src:'';
const reportShortDate=value=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||'');return m?`${m[3]}/${m[2]}/${m[1]}`:reportEsc(value||'');};
const reportLongDate=date=>date.toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});
function reportLines(value){return String(value||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);}
// Sections photographiques par sujet. Un champ exclu est rendu vide et masqué : le hook reste en place, le texte ne quitte pas l'application.
function reportPhotoSections(photos,subjects){
  const esc=reportEsc,text=reportText,image=reportImage,included=(photo,field)=>photo.include?.[field]!==false;
  const part=(photo,field,tag,cls,name,content)=>{const on=included(photo,field)&&String(content||'').trim();return `<${tag} class="${cls}" data-field="${name}" data-photo-index="${photo.number}" data-include="${field}"${on?'':' hidden'}>${on?text(content):''}</${tag}>`;};
  const photoHtml=photo=>{const src=image(photo.annotatedSrc)||image(photo.src),drawing=included(photo,'drawing')&&image(photo.drawing);
    return `<div class="photo-item" data-photo-index="${photo.number}"><div class="photo-num">Photo ${photo.number}</div>${part(photo,'description','div','photo-caption-top','legende',photo.description)}${src?`<img class="photo-img" data-field="photo_img" data-photo-index="${photo.number}" src="${src}" alt="Photo ${photo.number}">`:'<div class="photo-placeholder">[ Photo indisponible ]</div>'}${part(photo,'comment','div','photo-comment','commentaire',photo.comment)}${part(photo,'transcript','div','photo-transcript','transcript',photo.transcript)}${drawing?`<img class="photo-drawing" data-field="note_manuscrite" data-photo-index="${photo.number}" data-include="drawing" src="${drawing}" alt="Note manuscrite, photo ${photo.number}">`:''}</div>`;};
  const list=Array.isArray(photos)?photos:[];
  return (subjects||[]).map(subject=>({subject,photos:list.filter(ph=>ph.subject===subject)})).filter(s=>s.photos.length).map((s,i)=>`<div class="constat-section" data-section-index="${i+1}"><div class="section-header"><h3 data-field="section_titre" data-section-index="${i+1}">${esc(s.subject)}</h3></div><div class="section-body"><div class="photo-grid cols-2">${s.photos.map(photoHtml).join('')}</div><div class="section-comment" data-field="synthese_section" data-section-index="${i+1}"></div><div class="expert-note" data-field="note_expertale" data-section-index="${i+1}"></div></div></div>`).join('');
}
function buildConstatHtml(data,logo=typeof CDL_LOGO==='string'?CDL_LOGO:''){
  const type=REPORT_TYPES[data.type]?data.type:'autre',info=REPORT_TYPES[type],ep=type==='ep',ej=type==='ej';
  const esc=reportEsc,text=reportText,image=reportImage,shortDate=reportShortDate,longDate=reportLongDate;
  const dms=(value,pos,neg)=>{const t=Math.round(Math.abs(value)*3600);return `${Math.floor(t/3600)}°${String(Math.floor(t%3600/60)).padStart(2,'0')}'${String(t%60).padStart(2,'0')}" ${value<0?neg:pos}`;};
  const p=data.position,gps=p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)?`${dms(p.lat,'N','S')} / ${dms(p.lng,'E','O')}${Number.isFinite(p.accuracy)?` (précision ±${Math.round(p.accuracy)} m)`:''}`:'';
  const sections=reportPhotoSections(data.photos,data.subjects);
  const actions=(data.actions||[]).filter(a=>a&&(String(a.text||'').trim()||String(a.recipient||'').trim()));
  const actionsHtml=actions.length?`<div class="actions-block" data-field="actions"><div class="actions-header">${ep?'Suites recommandées':'Suites à donner / Actions'}</div><table class="actions-table"><thead><tr><th>Action</th><th>Description</th><th>Destinataire</th><th>Échéance</th></tr></thead><tbody>${actions.map((a,i)=>`<tr data-action-index="${i+1}"><td class="action-type" data-field="action_type">${esc(a.type)}</td><td data-field="action_text">${text(a.text)}</td><td data-field="action_recipient">${esc(a.recipient)}</td><td data-field="action_date">${a.date?shortDate(a.date):'—'}</td></tr>`).join('')}</tbody></table></div>`:'';
  const presents=reportLines(data.presents);
  const reference=esc(data.reference),visitDate=shortDate(data.visitDate),generated=longDate(data.generatedAt?new Date(data.generatedAt):new Date());
  const row=(label,field,value)=>`<tr><td>${label}</td><td data-field="${field}">${value}</td></tr>`;
  const refTable=ep?`<table class="ref-table"><tr><td colspan="2">Identification de la mission</td></tr>${row('Réf. CDL','ref_cdl',reference)}${row('Donneur d’ordre','client_nom',esc(data.clientName))}${row('Adresse client','client_adresse',text(data.clientAddress))}${row('Adresse du site','adresse_site',text(data.siteAddress))}${row('Objet de la mission','objet',esc(data.caseName))}${row('Date de visite','date_visite',visitDate)}${row('Mandataire','expert',esc(REPORT_EXPERT.name+' — CDL EXPERT'))}</table>`
    :`<table class="ref-table"><tr><td colspan="2">Informations dossier</td></tr>${row('Réf. CDL','ref_cdl',reference)}${row('Type','type_constat',esc(info.label))}${row('Date de visite','date_visite',visitDate)}${row('Adresse du site','adresse_site',text(data.siteAddress))}${row('Objet','objet',esc(data.caseName))}</table>`;
  const nominatif=ej?`<div class="nominatif-block" data-nominatif="true"${data.hideNominatif?' data-masque="true" hidden':''}><div class="nominatif-label">⚠ Champs nominatifs — complétés hors application, après génération (non saisis dans l’app)</div><table class="ref-table">${row('Tribunal','tribunal','')}${row('N° expertise / RG','num_expertise_rg','')}${row('Dossier','intitule_dossier','')}${row('Expert désigné','expert','')}</table></div>`:'';
  const mission=ep?`<div class="mission-block"><div class="mission-label">Objet de la mission</div><div class="mission-text" data-field="mission_detail">${text(data.missionDetail)}</div></div>`:'';
  const conclusions=ep?`<div class="conclusions-block"><div class="conclusions-header">Conclusions et avis de l’expert</div><div class="conclusions-body" data-field="conclusions">${text(data.conclusions)}</div></div><div class="signature-block"><div class="signature-inner"><div class="signature-label">Fait à ${esc(REPORT_EXPERT.place)}, le <span data-field="date_generation">${generated}</span></div><div class="signature-space"></div><div class="signature-name">${esc(REPORT_EXPERT.name)}<br><small>Ingénieur-Conseil CDL EXPERT</small></div></div></div>`:'';
  return `<!doctype html>
<html lang="fr" data-type-rapport="${type}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rapport de constats — ${esc(info.label)}${data.reference?' — '+reference:''}</title>
<style>${REPORT_CSS}</style>
</head>
<body class="rapport-${type}">
<div class="page-shell">
<header class="doc-header"><div class="logo-block">${image(logo)?`<img src="${logo}" alt="CDL EXPERT – EI Christel LACOME" width="160">`:''}</div><div class="header-right"><span class="type-badge type-${type}" data-field="type_badge">${info.badge}</span><div class="doc-title" data-field="titre_rapport">Rapport de Constats</div><div class="doc-subtitle">${esc(info.subtitle)}</div><div class="doc-subtitle">Réf. CDL : <strong data-field="ref_cdl">${reference}</strong>${ej?'<span class="num-expertise" data-field="num_expertise" data-nominatif="true"></span>':''}</div></div></header>
${ep?'<div class="confidential-banner">DOCUMENT CONFIDENTIEL — Expertise amiable — Destiné exclusivement au(x) donneur(s) d’ordre</div>':''}
${refTable}${nominatif}${mission}
<div class="visit-block" data-visit-index="1"><div class="visit-header"><span class="visit-title">${ep?'Visite du':'Visite n°1'}</span><span class="visit-date" data-field="visit_date" data-visit-index="1">${visitDate}</span></div><div class="presents-block"><span class="presents-label">Présents :</span><ul class="presents-list" data-field="presents" data-visit-index="1">${presents.map(line=>`<li>${esc(line)}</li>`).join('')}</ul></div><div class="expert-note visit-note" data-field="expert_note" data-visit-index="1">${text(data.expertNote)}</div>
${sections||'<p class="empty">Aucune photo.</p>'}
${actionsHtml}<div class="gps-block" data-field="position">${gps}</div></div>
${conclusions}
<footer class="doc-footer"><div><span class="footer-brand">${esc(REPORT_EXPERT.brand)}</span><br>${esc(REPORT_EXPERT.title)}${ej?'<br>'+esc(REPORT_EXPERT.court):''}</div><div class="footer-contact"><span data-field="ref_pied">${reference}</span><br>${ep?'Document confidentiel':esc(REPORT_EXPERT.email)}<br>Rapport généré le <span data-field="date_generation">${generated}</span></div></footer>
</div>
</body>
</html>
`;
}
// Mise en page des modèles v3, sans police externe : aucune requête vers un tiers à l'ouverture du rapport.
const REPORT_CSS=`
:root{--navy:#1A3A5C;--navy-mid:#2A5080;--red:#C0200A;--green-cdl:#6B8C3E;--amber:#B07A10;--bg:#FFFFFF;--bg-alt:#F4F6F9;--border:#C8D0DA;--border-light:#E2E8EF;--text:#1C2432;--text-mid:#3D4B5E;--text-light:#6B7A8F;--caption-bg:#EEF3F8;--accent:var(--navy);--accent-mid:var(--navy-mid);color-scheme:light}
.rapport-ep{--accent:var(--green-cdl);--accent-mid:var(--green-cdl)}.rapport-autre{--accent:var(--amber);--accent-mid:var(--amber)}
*,*::before,*::after{box-sizing:border-box}[hidden]{display:none!important}
body{font-family:'Source Sans 3','Source Sans Pro',Arial,sans-serif;font-size:13px;line-height:1.5;color:var(--text);background:var(--bg);margin:0}
.page-shell{max-width:860px;margin:0 auto;padding:0 20px 48px}
.type-badge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;border-radius:3px;margin-bottom:6px;align-self:flex-start}
.type-ej{background:#D6E8F7;color:#1A3A5C}.type-ep{background:#E8F5E0;color:#3A5A1A}.type-autre{background:#F4F0E0;color:#5A4A10}
.doc-header{border-bottom:3px solid var(--accent);padding-block:16px 14px;margin-bottom:22px;display:grid;grid-template-columns:170px 1fr;gap:20px;align-items:start}
.logo-block img{width:160px;height:auto;display:block}.header-right{display:flex;flex-direction:column;gap:4px}
.doc-title{font-size:17px;font-weight:700;color:var(--accent);line-height:1.2}.doc-subtitle{font-size:12px;color:var(--text-light)}
.confidential-banner{background:#FFF8E0;border:1px solid var(--amber);border-radius:4px;padding:7px 14px;margin-bottom:18px;font-size:11px;color:var(--amber);font-weight:600;text-align:center;letter-spacing:.04em}
.ref-table{width:100%;border-collapse:collapse;margin-bottom:24px;font-size:12px}.ref-table td{padding:5px 8px;border:1px solid var(--border);vertical-align:top}
.ref-table td:first-child{font-weight:600;color:var(--accent-mid);width:150px;background:var(--bg-alt);white-space:nowrap}
.ref-table td[colspan]{background:var(--bg-alt);font-weight:600;color:var(--accent);font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.nominatif-block{border:1px dashed var(--amber);border-radius:4px;padding:10px 12px;margin-bottom:20px;background:#FFFBF0}.nominatif-block .ref-table{margin-bottom:0}
.nominatif-label{font-size:10px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px}
.nominatif-block td[data-field]:empty::after{content:"À compléter";color:var(--text-light);font-style:italic}
.mission-block{border:1px solid var(--green-cdl);border-radius:4px;padding:10px 14px;margin-bottom:22px;background:#F6FCF0}
.mission-label{font-size:10px;font-weight:700;color:var(--green-cdl);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px}.mission-text{font-size:12px;color:var(--text-mid)}
.mission-text:empty::after{content:"—"}
.visit-block{margin-bottom:36px}.visit-header{background:var(--accent);color:#fff;padding:8px 14px;border-radius:4px 4px 0 0;display:flex;justify-content:space-between;align-items:baseline}
.visit-title{font-size:13px;font-weight:700}.visit-date{font-size:12px;opacity:.85}
.presents-block{background:var(--bg-alt);border:1px solid var(--border);border-top:none;padding:8px 14px;font-size:12px;margin-bottom:16px}
.presents-label{font-weight:600;color:var(--text-mid);margin-right:6px}.presents-list{margin:4px 0 0;padding-left:18px}.presents-list li{margin-bottom:2px}.presents-list:empty::after{content:"Non renseignés";color:var(--text-light);font-style:italic}
.constat-section{margin-bottom:28px;border:1px solid var(--border-light);border-radius:4px;overflow:hidden;break-inside:auto}
.section-header{background:var(--bg-alt);padding:8px 14px;border-bottom:1px solid var(--border)}.section-header h3{margin:0;font-size:13px;color:var(--accent-mid);font-weight:700}.section-body{padding:14px}
.photo-grid{display:grid;gap:14px;margin-bottom:14px}.photo-grid.cols-1{grid-template-columns:1fr}.photo-grid.cols-2{grid-template-columns:1fr 1fr}
.photo-item{border:1px solid var(--border);border-radius:3px;overflow:hidden;break-inside:avoid}
.photo-num{font-size:10px;font-weight:700;color:var(--text-light);padding:3px 8px;background:var(--bg-alt);border-bottom:1px solid var(--border-light)}
.photo-caption-top{background:var(--caption-bg);color:var(--accent-mid);font-size:11px;font-weight:600;padding:5px 8px;border-bottom:1px solid var(--border-light)}
.photo-placeholder{width:100%;aspect-ratio:4/3;background:var(--bg-alt);display:flex;align-items:center;justify-content:center;color:var(--text-light);font-size:11px}
.photo-img{width:100%;aspect-ratio:4/3;object-fit:contain;background:#fff;display:block;border-bottom:1px solid var(--border-light)}
.photo-comment{font-size:11.5px;padding:6px 8px;color:var(--text-mid);border-bottom:1px solid var(--border-light)}
.photo-transcript{font-size:11px;font-style:italic;color:var(--text-light);padding:5px 8px 6px;border-top:1px dashed var(--border-light)}.photo-transcript::before{content:"🎙 "}
.photo-drawing{width:100%;max-height:160px;object-fit:contain;display:block;border-top:1px dashed var(--border-light)}
.photo-caption-top:empty,.photo-comment:empty,.photo-transcript:empty,.section-comment:empty,.expert-note:empty,.gps-block:empty{display:none}
.section-comment{border-left:3px solid var(--green-cdl);padding:8px 12px;background:#F4F9EE;margin-bottom:10px;font-size:12px;color:var(--text-mid);border-radius:0 3px 3px 0}
.expert-note{border-left:3px solid var(--red);padding:8px 12px;background:#FEF4F3;margin-bottom:10px;font-size:12px;color:var(--text-mid);border-radius:0 3px 3px 0}
.expert-note::before{content:"Note expertale — ";font-weight:700;color:var(--red)}.visit-note{margin-bottom:16px}
.rapport-ep .expert-note{border-left-color:var(--navy);background:#EEF4FA}.rapport-ep .expert-note::before{content:"Avis de l’expert — ";color:var(--navy)}
.actions-block{margin-top:28px;border:1px solid var(--amber);border-radius:4px;overflow:hidden;break-inside:avoid}
.actions-header{background:var(--amber);color:#fff;padding:7px 14px;font-size:12px;font-weight:700;letter-spacing:.04em}
.actions-table{width:100%;border-collapse:collapse;font-size:12px}.actions-table th{background:var(--bg-alt);padding:5px 10px;font-weight:600;color:var(--text-mid);border-bottom:1px solid var(--border);text-align:left}
.actions-table td{padding:5px 10px;border-bottom:1px solid var(--border-light);vertical-align:top}.action-type{font-weight:600;color:var(--accent-mid);white-space:nowrap}
.gps-block{font-size:11px;color:var(--text-light);margin-top:8px}.gps-block::before{content:"📍 Position de la visite : "}
.conclusions-block{margin-top:30px;border:1px solid var(--green-cdl);border-radius:4px;overflow:hidden}.conclusions-header{background:var(--green-cdl);color:#fff;padding:7px 14px;font-size:12px;font-weight:700}
.conclusions-body{padding:12px 14px;font-size:12.5px}.conclusions-body:empty::after{content:"—"}
.signature-block{margin-top:36px;display:flex;justify-content:flex-end;break-inside:avoid}.signature-inner{text-align:center;border-top:1px solid var(--border);padding-top:8px;min-width:200px}
.signature-label{font-size:11px;color:var(--text-light)}.signature-space{height:50px}.signature-name{font-size:12px;font-weight:700;color:var(--navy-mid);margin-top:4px}.signature-name small{font-weight:400;color:var(--text-light)}
.doc-footer{margin-top:40px;padding-top:12px;border-top:2px solid var(--accent);font-size:10.5px;color:var(--text-light);display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px}
.num-expertise:not(:empty)::before{content:" · "}
.footer-brand{font-weight:700;color:var(--accent-mid)}.footer-contact{text-align:right}.empty{color:var(--text-light)}
@media print{.page-shell{max-width:none;padding:0 10mm}.nominatif-block{border-color:#999;background:#fffdf0}@page{size:A4 portrait;margin:14mm}}
@media (max-width:600px){.doc-header{grid-template-columns:1fr}.photo-grid.cols-2{grid-template-columns:1fr}.ref-table td:first-child{white-space:normal;width:40%}}
`;
if(typeof module!=='undefined')module.exports={buildConstatHtml,reportTypeOf,reportFileName,isOpalexeReference,REPORT_TYPES,REPORT_EXPERT,REPORT_CSS,reportEsc,reportText,reportImage,reportShortDate,reportLongDate,reportLines,reportPhotoSections};
