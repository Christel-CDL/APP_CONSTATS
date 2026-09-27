'use strict';
// Procès-verbaux d'expertise privée : réception (art. 1792-6 C. civ.) et levée des réserves. Browser/Node.
// Données propres au constat (state.pv) ; les parties sont saisies par l'expert, jamais en expertise judiciaire.
// En Node (tests), les fonctions partagées viennent des autres modules ; dans le navigateur, des scripts déjà chargés.
if(typeof module!=='undefined'&&typeof reportEsc==='undefined')Object.assign(globalThis,require('./html-report.js'),require('./word-report.js'));
const PV_DOCUMENTS={
  constat:{label:'Rapport de constats'},
  simple:{label:'Constat simple avec suites à donner',file:'CONSTAT-SIMPLE'},
  reception:{label:'PV de réception',title:'Procès-verbal de réception',file:'PV-RECEPTION'},
  levee:{label:'PV de levée des réserves',title:'Procès-verbal de levée des réserves',file:'PV-LEVEE-RESERVES'}
};
const PV_DOE_DEFAULTS=['Plans « tel que construit » et plan des réseaux','Notices d’usage et d’entretien des équipements','Fiches techniques et certificats des matériaux et équipements (DTA / AT si applicable)','Attestation de respect de la réglementation environnementale (RE2020)','Attestations d’assurance (décennale, RC professionnelle) et garanties fabricants'];
const PV_TEXT=['companyName','companyAddress','companyRcs','companyRepresentative','companyEmail','ownerName','ownerAddress','references','works','effectDate','worksStart','worksEnd','receptionNotes','reservesIntro','doeComment','amountTotal','amountBalance','balanceComment','ownerSignatory','companySignatory','receptionDate'];
const PV_RESERVE_TEXT=['location','defect','deadline','observations','photos','leveeDate'];
function defaultPv(){const pv={document:'constat',withReserves:true,signatures:{},declarations:[{label:'L’ouvrage a été livré propre',value:''}],reserves:[],doe:PV_DOE_DEFAULTS.map(label=>({label,provided:false}))};for(const key of PV_TEXT)pv[key]='';return pv;}
const pvString=(value,max=4000)=>typeof value==='string'?value.slice(0,max):'';
function normalizePv(value){
  const pv=defaultPv();if(!value||typeof value!=='object')return pv;
  pv.document=PV_DOCUMENTS[value.document]?value.document:'constat';pv.withReserves=value.withReserves!==false;
  for(const key of PV_TEXT)pv[key]=pvString(value[key]);
  if(Array.isArray(value.declarations))pv.declarations=value.declarations.filter(d=>d&&typeof d==='object').slice(0,30).map(d=>({label:pvString(d.label,300),value:['oui','non'].includes(d.value)?d.value:''}));
  if(Array.isArray(value.doe))pv.doe=value.doe.filter(d=>d&&typeof d==='object').slice(0,30).map(d=>({label:pvString(d.label,300),provided:d.provided===true}));
  if(Array.isArray(value.reserves))pv.reserves=value.reserves.filter(r=>r&&typeof r==='object').slice(0,300).map(r=>{const reserve={id:typeof r.id==='string'&&/^[\w-]+$/.test(r.id)?r.id:pvId(),status:['levee','non-levee'].includes(r.status)?r.status:''};for(const key of PV_RESERVE_TEXT)reserve[key]=pvString(r[key],2000);return reserve;});
  if(value.signatures&&typeof value.signatures==='object')for(const role of ['owner','company']){const s=cleanSignature(value.signatures[role]);if(s)pv.signatures[role]=s;}
  return pv;
}
function cleanSignature(value){if(!value||typeof value!=='object'||typeof value.image!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.image)||value.image.length>400000)return null;return {image:value.image,at:pvString(value.at,40),name:pvString(value.name,200),hash:pvString(value.hash,20)};}
// Empreinte du contenu signé (hors signatures) : détecte une modification après signature. Ce n'est pas un scellement cryptographique.
function pvContentHash(pv){const {signatures,...content}=pv||{};const text=JSON.stringify(content);let h=0x811c9dc5;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
function pvIsPv(pv){return pv?.document==='reception'||pv?.document==='levee';}
function pvId(){return globalThis.crypto?.randomUUID?.()||`reserve-${Date.now()}-${Math.random().toString(16).slice(2)}`;}
function emptyReserve(values={}){const reserve={id:pvId(),status:''};for(const key of PV_RESERVE_TEXT)reserve[key]=pvString(values[key],2000);return reserve;}
// Une réserve par photo non encore citée : localisation = sujet, désordre = description (ou commentaire).
function reservesFromPhotos(photos,reserves){
  const cited=new Set(reserves.flatMap(r=>pvPhotoNumbers(r.photos)));
  return (photos||[]).filter(p=>!cited.has(p.number)).map(p=>emptyReserve({location:p.subject,defect:(p.description||p.comment||'').trim(),photos:String(p.number)}));
}
function pvPhotoNumbers(value){return String(value||'').split(/[^\d]+/).filter(Boolean).map(Number);}
// Le PV de levée reprend les parties, références et réserves du PV de réception ; statut et date de levée restent à constater.
function pvForLevee(source,receptionVisitDate){
  const pv=normalizePv(source);pv.document='levee';pv.receptionDate=pv.effectDate||receptionVisitDate||'';pv.withReserves=true;
  pv.reserves=pv.reserves.map(r=>({...r,id:pvId(),status:'',leveeDate:'',observations:r.observations}));
  pv.declarations=pv.declarations.map(d=>({...d,value:''}));pv.signatures={};
  return pv;
}
function signedAt(value){const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleDateString('fr-FR',{timeZone:'Europe/Paris'})+' à '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'});}
function pvFileName(document,reference,date){const base=reportFileName(reference,date);return PV_DOCUMENTS[document]?.file?base.replace('_CONSTAT_',`_${PV_DOCUMENTS[document].file}_`).replace(/^CONSTAT_/,`${PV_DOCUMENTS[document].file}_`):base;}
function pvSummary(pv){const total=pv.reserves.length,lifted=pv.reserves.filter(r=>r.status==='levee').length;return {total,lifted,remaining:total-lifted};}
function buildPvHtml(data,logo=typeof CDL_LOGO==='string'?CDL_LOGO:''){
  const pv=normalizePv(data.pv),levee=pv.document==='levee',info=PV_DOCUMENTS[levee?'levee':'reception'];
  const esc=reportEsc,text=reportText,date=reportShortDate,lines=reportLines,box=on=>on?'☒':'☐';
  const reference=esc(data.reference),generated=reportLongDate(data.generatedAt?new Date(data.generatedAt):new Date());
  const row=(label,field,value)=>`<tr><td>${label}</td><td data-field="${field}">${value}</td></tr>`;
  const list=(value,field)=>{const items=lines(value);return items.length?`<ul class="pv-list" data-field="${field}">${items.map(line=>`<li>${esc(line)}</li>`).join('')}</ul>`:`<p class="pv-empty" data-field="${field}">—</p>`;};
  const {total,lifted,remaining}=pvSummary(pv);
  const reserveRows=pv.reserves.map((r,i)=>`<tr data-reserve-index="${i+1}"${levee?` class="${r.status==='levee'?'is-levee':r.status==='non-levee'?'is-open':''}"`:''}><td class="pv-num">${i+1}</td><td data-field="reserve_localisation">${text(r.location)}</td><td data-field="reserve_desordre">${text(r.defect)}</td><td data-field="${levee?'reserve_levee':'reserve_delai'}">${levee?(r.status==='levee'?`Levée${r.leveeDate?' le '+date(r.leveeDate):''}`:r.status==='non-levee'?'Non levée':'À constater'):text(r.deadline)}</td><td data-field="reserve_observations">${text(r.observations)}</td><td data-field="reserve_photos">${esc(pvPhotoNumbers(r.photos).join(', '))}</td></tr>`).join('');
  const declarations=pv.declarations.filter(d=>d.label.trim()).map(d=>`<li>${esc(d.label)} : ${box(d.value==='oui')} OUI ${box(d.value==='non')} NON</li>`).join('');
  const sections=reportPhotoSections(data.photos,data.subjects);
  const expert=cleanSignature(data.expertSignature);
  const signCell=(signature,field)=>{const s=cleanSignature(signature);return s?`<div class="pv-sign"><img class="pv-sign-img" data-field="${field}" src="${s.image}" alt="Signature"><small>Signé électroniquement le ${esc(signedAt(s.at))}</small></div>`:'<div class="pv-sign">Signature :</div>';};
  let n=0;const h=title=>`<h2 class="pv-h">${++n}) ${title}</h2>`;
  return `<!doctype html>
<html lang="fr" data-type-rapport="ep" data-document="${levee?'levee':'reception'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(info.title)}${data.reference?' — '+reference:''}</title>
<style>${REPORT_CSS}${PV_CSS}</style>
</head>
<body class="rapport-ep">
<div class="page-shell">
<header class="doc-header"><div class="logo-block">${reportImage(logo)?`<img src="${logo}" alt="CDL EXPERT – EI Christel LACOME" width="160">`:''}</div><div class="header-right"><span class="type-badge type-ep" data-field="type_badge">EXPERTISE PRIVÉE</span><div class="doc-title" data-field="titre_rapport">${esc(info.title)}</div>${levee?`<div class="doc-subtitle" data-field="pv_reception_ref">Annexe au procès-verbal de réception${pv.receptionDate?' du '+date(pv.receptionDate):''}</div>`:''}<div class="doc-subtitle">Réf. CDL : <strong data-field="ref_cdl">${reference}</strong></div></div></header>
<table class="ref-table"><tr><td colspan="2">Établi entre</td></tr>${row('Entreprise','entreprise_nom',esc(pv.companyName))}${row('Adresse','entreprise_adresse',text(pv.companyAddress))}${row('N° RCS / SIRET','entreprise_rcs',esc(pv.companyRcs))}${row('Représentée par','entreprise_representant',esc(pv.companyRepresentative)+(pv.companyEmail?` — ${esc(pv.companyEmail)}`:''))}<tr><td colspan="2">Et le maître d’ouvrage (MOA)</td></tr>${row('Maître d’ouvrage','moa_nom',esc(pv.ownerName))}${row('Domicilié','moa_adresse',text(pv.ownerAddress))}</table>
<table class="ref-table"><tr><td colspan="2">Opération</td></tr>${row('Adresse du chantier','adresse_site',text(data.siteAddress))}${row('Objet','objet',esc(data.caseName))}${row('Date de visite','date_visite',date(data.visitDate))}</table>
<div class="pv-block"><div class="pv-label">Références contractuelles</div>${list(pv.references,'references')}</div>
<div class="pv-block"><div class="pv-label">Ouvrage et prestations</div>${list(pv.works,'ouvrage')}</div>
<div class="pv-block"><div class="pv-label">Parties présentes</div>${list(data.presents,'presents')}</div>
${h(levee?'Rappel de la réception':'Réception')}
<p class="pv-choice" data-field="reception_choix">${box(!pv.withReserves)} SANS RÉSERVE &nbsp;&nbsp; ${box(pv.withReserves)} AVEC RÉSERVES (cf. § 2)</p>
<p>Date d’effet de la réception : <b data-field="reception_date">${pv.effectDate?date(pv.effectDate):'____ / ____ / ________'}</b> (point de départ des garanties légales – art. 1792-6 C. civ.)</p>
${pv.worksStart||pv.worksEnd?`<p data-field="periode_travaux">Période de travaux : ouverture de chantier le ${pv.worksStart?date(pv.worksStart):'—'} et fin le ${pv.worksEnd?date(pv.worksEnd):'—'}</p>`:''}
${pv.receptionNotes.trim()?`<p data-field="reception_observations">${text(pv.receptionNotes)}</p>`:''}
${declarations?`<p class="pv-sub">${levee?'État général lors de la visite':'Le maître d’ouvrage déclare que'} :</p><ul class="pv-list" data-field="declarations">${declarations}</ul>`:''}
${h(levee?'Levée des réserves':'Liste des réserves')}
${levee?`<p data-field="levee_acte">En date du ${date(data.visitDate)}, le maître d’ouvrage donne acte à l’entreprise de la levée des réserves ci-après.</p><p class="pv-summary" data-field="levee_bilan">${lifted} réserve(s) levée(s) sur ${total} — ${remaining} restant à lever ou à constater.</p>`:''}
${pv.reservesIntro.trim()?`<p data-field="reserves_intro">${text(pv.reservesIntro)}</p>`:''}
${total?`<table class="pv-table"><thead><tr><th>N°</th><th>Localisation précise</th><th>Désordre constaté</th><th>${levee?'Date de la levée':'Délai de levée'}</th><th>Observations</th><th>Photos</th></tr></thead><tbody>${reserveRows}</tbody></table>`:'<p class="pv-empty">Aucune réserve.</p>'}
${h('Documents remis (DOE)')}
<ul class="pv-list pv-checks" data-field="doe">${pv.doe.filter(d=>d.label.trim()).map(d=>`<li>${box(d.provided)} ${esc(d.label)}</li>`).join('')}</ul>
${pv.doeComment.trim()?`<p data-field="doe_commentaire">${text(pv.doeComment)}</p>`:''}
${h('Règlement du solde')}
<table class="ref-table">${row('Montant total de la commande','montant_total',esc(pv.amountTotal)||'—')}${row('Solde restant à verser','montant_solde',esc(pv.amountBalance)||'—')}</table>
${pv.balanceComment.trim()?`<p data-field="solde_commentaire">${text(pv.balanceComment)}</p>`:''}
<table class="pv-signatures"><tr><td><b>Pour le maître d’ouvrage</b><br><span data-field="signataire_moa">${esc(pv.ownerSignatory||pv.ownerName)}</span>${signCell(pv.signatures.owner,'signature_moa')}</td><td><b>Pour l’entreprise ${esc(pv.companyName)}</b><br><span data-field="signataire_entreprise">${esc(pv.companySignatory||pv.companyRepresentative)}</span>${signCell(pv.signatures.company,'signature_entreprise')}</td></tr>${expert?`<tr><td colspan="2"><b>L’expert assistant le maître d’ouvrage</b><br>${esc(REPORT_EXPERT.name)} — CDL EXPERT${signCell(expert,'signature_expert')}</td></tr>`:''}</table>
<p class="pv-assist">Établi avec l’assistance de ${esc(REPORT_EXPERT.name)}, CDL EXPERT, expert assistant le maître d’ouvrage.</p>
${sections?`<h2 class="pv-h pv-annex">Annexe photographique</h2>${sections}`:''}
<footer class="doc-footer"><div><span class="footer-brand">${esc(REPORT_EXPERT.brand)}</span><br>${esc(REPORT_EXPERT.title)}</div><div class="footer-contact"><span data-field="ref_pied">${reference}</span><br>Document confidentiel<br>Généré le <span data-field="date_generation">${generated}</span></div></footer>
</div>
</body>
</html>
`;
}
const PV_CSS=`
.pv-h{font-size:14px;color:var(--green-cdl);border-bottom:2px solid var(--green-cdl);padding-bottom:4px;margin:28px 0 12px;break-after:avoid}
.pv-block{margin-bottom:14px}.pv-label,.pv-sub{font-size:11px;font-weight:700;color:var(--green-cdl);text-transform:uppercase;letter-spacing:.06em;margin:0 0 4px}
.pv-list{margin:0 0 10px;padding-left:20px}.pv-list li{margin-bottom:2px}.pv-checks{list-style:none;padding-left:4px}.pv-empty{color:var(--text-light);margin:0 0 10px}
.pv-choice{font-weight:700;font-size:13px}.pv-summary{font-weight:600;color:var(--text-mid)}
.pv-table{width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:12px}.pv-table th{background:var(--green-cdl);color:#fff;text-align:left;padding:5px 6px;font-weight:600}
.pv-table td{border:1px solid var(--border);padding:5px 6px;vertical-align:top;overflow-wrap:anywhere}.pv-table tr{break-inside:avoid}.pv-num{text-align:center;font-weight:700;width:32px}
.pv-table tr.is-levee td{background:#F1F8EA}.pv-table tr.is-open td{background:#FEF4F3}
.pv-signatures{width:100%;border-collapse:collapse;margin-top:30px;break-inside:avoid}.pv-signatures td{width:50%;border:1px solid var(--border);padding:10px;vertical-align:top;font-size:12px}.pv-sign{margin-top:8px;min-height:90px;color:var(--text-light)}.pv-sign-img{display:block;max-width:100%;height:80px;object-fit:contain;object-position:left}.pv-sign small{font-size:10px}
.pv-assist{font-size:11px;color:var(--text-light);margin-top:10px}.pv-annex{break-before:page}
`;
async function buildPvWord(data,library=globalThis.docx){
  const {Document,Paragraph,TextRun,ImageRun,Table,TableRow,TableCell,Packer,WidthType,AlignmentType,Footer,PageNumber,HeadingLevel}=library;
  const pv=normalizePv(data.pv),levee=pv.document==='levee',info=PV_DOCUMENTS[levee?'levee':'reception'],date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):String(value||'');
  const run=(text,options={})=>new TextRun({text:String(text??''),font:'Arial',size:options.size||22,bold:!!options.bold});
  const paragraph=(text,options={})=>new Paragraph({spacing:{after:80},keepNext:!!options.keepNext,alignment:options.align,children:[run(text,options)]});
  const multi=(text,options)=>reportLines(text).map(line=>paragraph(line,options));
  const heading=text=>new Paragraph({heading:HeadingLevel.HEADING_2,spacing:{before:240,after:120},keepNext:true,children:[run(text,{bold:true,size:26})]});
  const cell=(content,width,options={})=>new TableCell({width:{size:width,type:WidthType.PERCENTAGE},margins:{top:60,bottom:60,left:80,right:80},shading:options.fill?{fill:options.fill}:undefined,children:(Array.isArray(content)?content:[content]).map(c=>typeof c==='string'?paragraph(c,options):c)});
  const table=(rows,widths)=>new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:rows.map((cells,i)=>new TableRow({tableHeader:i===0&&widths.header,cantSplit:true,children:cells.map((c,j)=>cell(c,widths.cols[j],i===0&&widths.header?{bold:true,fill:'E8F5E0'}:{}))}))});
  const box=on=>on?'☒':'☐',{total,lifted,remaining}=pvSummary(pv);
  const children=[paragraph('CDL EXPERT — EXPERTISE PRIVÉE',{bold:true,size:18}),new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:120},children:[run(info.title.toUpperCase(),{bold:true,size:30})]})];
  if(levee)children.push(paragraph(`Annexe au procès-verbal de réception${pv.receptionDate?' du '+date(pv.receptionDate):''}`,{align:AlignmentType.CENTER}));
  if(data.reference)children.push(paragraph('Réf. CDL : '+data.reference,{align:AlignmentType.CENTER}));
  children.push(heading('Établi entre'),paragraph(pv.companyName,{bold:true}),...multi(pv.companyAddress));
  if(pv.companyRcs)children.push(paragraph('N° RCS / SIRET : '+pv.companyRcs));
  if(pv.companyRepresentative)children.push(paragraph('Représentée par '+pv.companyRepresentative+(pv.companyEmail?' — '+pv.companyEmail:'')));
  children.push(paragraph('Et le maître d’ouvrage (MOA)',{bold:true}),paragraph(pv.ownerName),...multi(pv.ownerAddress));
  if(reportLines(pv.references).length)children.push(paragraph('Références :',{bold:true,keepNext:true}),...multi(pv.references));
  if(reportLines(pv.works).length)children.push(paragraph('Ouvrage et prestations :',{bold:true,keepNext:true}),...multi(pv.works));
  children.push(paragraph('Adresse du chantier : '+(data.siteAddress||'').replace(/\r?\n/g,', ')),paragraph('Date de visite : '+date(data.visitDate)));
  if(reportLines(data.presents).length)children.push(paragraph('Parties présentes :',{bold:true,keepNext:true}),...multi(data.presents));
  children.push(heading(`1) ${levee?'Rappel de la réception':'Réception'}`),paragraph(`${box(!pv.withReserves)} SANS RÉSERVE    ${box(pv.withReserves)} AVEC RÉSERVES (cf. § 2)`,{bold:true}),paragraph(`Date d’effet de la réception : ${pv.effectDate?date(pv.effectDate):'____ / ____ / ________'} (point de départ des garanties légales – art. 1792-6 C. civ.)`));
  if(pv.worksStart||pv.worksEnd)children.push(paragraph(`Période de travaux : ouverture de chantier le ${date(pv.worksStart)||'—'} et fin le ${date(pv.worksEnd)||'—'}`));
  children.push(...multi(pv.receptionNotes));
  const declarations=pv.declarations.filter(d=>d.label.trim());
  if(declarations.length)children.push(paragraph(levee?'État général lors de la visite :':'Le maître d’ouvrage déclare que :',{bold:true,keepNext:true}),...declarations.map(d=>paragraph(`${d.label} : ${box(d.value==='oui')} OUI  ${box(d.value==='non')} NON`)));
  children.push(heading(`2) ${levee?'Levée des réserves':'Liste des réserves'}`));
  if(levee)children.push(paragraph(`En date du ${date(data.visitDate)}, le maître d’ouvrage donne acte à l’entreprise de la levée des réserves ci-après.`),paragraph(`${lifted} réserve(s) levée(s) sur ${total} — ${remaining} restant à lever ou à constater.`,{bold:true}));
  children.push(...multi(pv.reservesIntro));
  if(total)children.push(table([['N°','Localisation précise','Désordre constaté',levee?'Date de la levée':'Délai de levée','Observations','Photos'],...pv.reserves.map((r,i)=>[String(i+1),r.location,r.defect,levee?(r.status==='levee'?'Levée'+(r.leveeDate?' le '+date(r.leveeDate):''):r.status==='non-levee'?'Non levée':'À constater'):r.deadline,r.observations,pvPhotoNumbers(r.photos).join(', ')])].map((row,i)=>i===0?row:row.map(value=>reportLines(value).length>1?reportLines(value).map(line=>paragraph(line,{size:18})):paragraph(value,{size:18}))),{header:true,cols:[6,18,28,14,26,8]}));
  else children.push(paragraph('Aucune réserve.'));
  children.push(heading('3) Documents remis (DOE)'),...pv.doe.filter(d=>d.label.trim()).map(d=>paragraph(`${box(d.provided)} ${d.label}`)),...multi(pv.doeComment));
  children.push(heading('4) Règlement du solde'),paragraph('Montant total de la commande : '+(pv.amountTotal||'—')),paragraph('Montant restant à verser (solde) : '+(pv.amountBalance||'—')),...multi(pv.balanceComment));
  const signImage=(signature,label)=>{const s=cleanSignature(signature);return s?[new Paragraph({children:[new ImageRun({data:s.image,type:'png',transformation:{width:190,height:68}})]}),paragraph('Signé électroniquement le '+signedAt(s.at),{size:16})]:[paragraph(label),paragraph(''),paragraph(''),paragraph('')];};
  const expert=cleanSignature(data.expertSignature);
  children.push(heading('Signatures'),table([[[paragraph('Pour le maître d’ouvrage',{bold:true}),paragraph(pv.ownerSignatory||pv.ownerName),...signImage(pv.signatures.owner,'Signature :')],[paragraph('Pour l’entreprise '+pv.companyName,{bold:true}),paragraph(pv.companySignatory||pv.companyRepresentative),...signImage(pv.signatures.company,'Signature :')]],...(expert?[[[paragraph('L’expert assistant le maître d’ouvrage',{bold:true}),paragraph(REPORT_EXPERT.name+' — CDL EXPERT'),...signImage(expert,'')],[paragraph('')]]]:[])],{cols:[50,50]}),paragraph(`Établi avec l’assistance de ${REPORT_EXPERT.name}, CDL EXPERT, expert assistant le maître d’ouvrage.`,{size:18}));
  const photos=wordPhotoBlocks(data,library);
  if(photos.length)children.push(new Paragraph({pageBreakBefore:true,children:[run('Annexe photographique',{bold:true,size:26})]}),...photos);
  const doc=new Document({creator:'Constat — CDL EXPERT',title:info.title,styles:{default:{document:{run:{font:'Arial',size:22}}}},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1020,bottom:1020,left:1020,right:1020}}},footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({children:[`${info.title}${data.reference?' — '+data.reference:''} — page `,PageNumber.CURRENT,' / ',PageNumber.TOTAL_PAGES],font:'Arial',size:16})]})]})},children}]});
  return Packer.toBlob(doc);
}
if(typeof module!=='undefined')module.exports={pvContentHash,cleanSignature,pvIsPv,signedAt,PV_DOCUMENTS,defaultPv,normalizePv,emptyReserve,reservesFromPhotos,pvPhotoNumbers,pvForLevee,pvFileName,pvSummary,buildPvHtml,buildPvWord};
