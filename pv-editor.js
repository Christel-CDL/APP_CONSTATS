'use strict';
// Saisie des procès-verbaux (expertise privée) : parties, réception, réserves, DOE, solde, signataires.
function pvMode(){return state.caseType==='ep'&&state.pv.document!=='constat';}
function pvHasData(pv){return !!(pv.companyName||pv.ownerName||pv.references||pv.reserves.length);}
function pvInput(key,label,options={}){const value=escapeHtml(state.pv[key]||'');const attrs=`data-pv="${key}"${options.placeholder?` placeholder="${escapeHtml(options.placeholder)}"`:''}`;
  return `<label class="${options.wide?'wide':''}">${label}${options.area?`<textarea ${attrs}>${value}</textarea>`:`<input ${attrs} type="${options.type||'text'}" value="${value}" maxlength="${options.max||300}">`}</label>`;}
function renderPvEditor(){
  const editor=$('#pv-editor');if(!editor)return;const on=pvMode();editor.hidden=!on;if(!on){editor.innerHTML='';return;}
  const pv=state.pv,levee=pv.document==='levee',{total,lifted}=pvSummary(pv);
  editor.innerHTML=`<h3>${escapeHtml(PV_DOCUMENTS[pv.document].title)}</h3>
  ${levee?`<div class="pv-import"><p>Reprenez les parties, références et réserves du PV de réception, puis constatez la levée de chaque réserve.</p><div><select id="pv-import-source"><option value="">Chargement des constats…</option></select><button type="button" class="secondary" data-pv-command="import">Reprendre ce PV de réception</button></div></div>`:''}
  <fieldset><legend>Établi entre — entreprise</legend><div class="cdl-fields">${pvInput('companyName','Raison sociale')}${pvInput('companyRcs','N° RCS / SIRET')}${pvInput('companyAddress','Adresse',{wide:true})}${pvInput('companyRepresentative','Représentée par (nom, qualité)')}${pvInput('companyEmail','E-mail',{type:'email'})}</div></fieldset>
  <fieldset><legend>Maître d’ouvrage</legend><div class="cdl-fields">${pvInput('ownerName','Nom(s)')}${pvInput('ownerAddress','Domicile')}</div></fieldset>
  <fieldset><legend>Contrat et ouvrage</legend><div class="cdl-fields">${pvInput('references','Références contractuelles (une par ligne : bon de commande, avenants, OS, permis…)',{area:true,wide:true})}${pvInput('works','Ouvrage et prestations (une par ligne)',{area:true,wide:true})}</div></fieldset>
  <fieldset><legend>${levee?'Rappel de la réception':'Réception'}</legend><div class="cdl-fields">
    ${levee?pvInput('receptionDate','Date du PV de réception',{type:'date'}):''}
    <label>Réception<select data-pv="withReserves"><option value="true" ${pv.withReserves?'selected':''}>Avec réserves</option><option value="false" ${pv.withReserves?'':'selected'}>Sans réserve</option></select></label>
    ${pvInput('effectDate','Date d’effet de la réception (art. 1792-6 C. civ.)',{type:'date'})}${pvInput('worksStart','Ouverture de chantier',{type:'date'})}${pvInput('worksEnd','Fin de chantier',{type:'date'})}
    ${pvInput('receptionNotes','Observations sur la réception',{area:true,wide:true})}</div>
    <p class="pv-editor-label">${levee?'État général lors de la visite':'Le maître d’ouvrage déclare que'}</p>
    <div class="pv-rows">${pv.declarations.map((d,i)=>`<div class="pv-row" data-pv-list="declarations" data-index="${i}"><input data-pv-item="label" value="${escapeHtml(d.label)}" maxlength="300" aria-label="Déclaration"><select data-pv-item="value" aria-label="Réponse"><option value="">—</option><option value="oui" ${d.value==='oui'?'selected':''}>Oui</option><option value="non" ${d.value==='non'?'selected':''}>Non</option></select><button type="button" class="remove-action" data-pv-command="remove" aria-label="Supprimer">×</button></div>`).join('')}</div>
    <button type="button" class="secondary" data-pv-command="add-declaration">＋ Ajouter une déclaration</button></fieldset>
  <fieldset><legend>${levee?`Levée des réserves — ${lifted} levée(s) sur ${total}`:`Réserves — ${total}`}</legend>
    <div class="cdl-fields">${pvInput('reservesIntro','Texte d’introduction (facultatif)',{area:true,wide:true})}</div>
    <div class="pv-reserves">${pv.reserves.map((r,i)=>`<article class="pv-reserve" data-pv-list="reserves" data-index="${i}"><b>Réserve n° ${i+1}</b><div class="cdl-fields">
      <label>Localisation précise<input data-pv-item="location" value="${escapeHtml(r.location)}" maxlength="300"></label><label>Photos (n°)<input data-pv-item="photos" value="${escapeHtml(r.photos)}" maxlength="200" placeholder="Ex. 3, 4"></label>
      <label class="wide">Désordre constaté<textarea data-pv-item="defect">${escapeHtml(r.defect)}</textarea></label>
      ${levee?`<label>Constat<select data-pv-item="status"><option value="">À constater</option><option value="levee" ${r.status==='levee'?'selected':''}>Levée</option><option value="non-levee" ${r.status==='non-levee'?'selected':''}>Non levée</option></select></label><label>Date de la levée<input type="date" data-pv-item="leveeDate" value="${escapeHtml(r.leveeDate)}"></label>`:`<label class="wide">Délai de levée<input data-pv-item="deadline" value="${escapeHtml(r.deadline)}" maxlength="300" placeholder="Ex. sous 1 mois"></label>`}
      <label class="wide">Observations<textarea data-pv-item="observations">${escapeHtml(r.observations)}</textarea></label></div>
      <button type="button" class="secondary danger" data-pv-command="remove">Supprimer la réserve</button></article>`).join('')||'<p class="muted">Aucune réserve pour le moment.</p>'}</div>
    <div class="pv-buttons"><button type="button" class="secondary" data-pv-command="add-reserve">＋ Ajouter une réserve</button><button type="button" class="secondary" data-pv-command="from-photos">Créer une réserve par photo non citée</button>${levee?'<button type="button" class="secondary" data-pv-command="all-lifted">Marquer les réserves à constater comme levées ce jour</button>':''}</div></fieldset>
  <fieldset><legend>Documents remis (DOE)</legend><div class="pv-rows">${pv.doe.map((d,i)=>`<div class="pv-row" data-pv-list="doe" data-index="${i}"><input type="checkbox" data-pv-item="provided" ${d.provided?'checked':''} aria-label="Remis"><input data-pv-item="label" value="${escapeHtml(d.label)}" maxlength="300" aria-label="Document"><button type="button" class="remove-action" data-pv-command="remove" aria-label="Supprimer">×</button></div>`).join('')}</div>
    <button type="button" class="secondary" data-pv-command="add-doe">＋ Ajouter un document</button><div class="cdl-fields">${pvInput('doeComment','Commentaire (délai de remise…)',{area:true,wide:true})}</div></fieldset>
  <fieldset><legend>Règlement du solde</legend><div class="cdl-fields">${pvInput('amountTotal','Montant total de la commande',{placeholder:'Ex. 82 000,00 € TTC'})}${pvInput('amountBalance','Solde restant à verser')}${pvInput('balanceComment','Conditions de versement du solde',{area:true,wide:true})}</div></fieldset>
  <fieldset><legend>Signataires</legend><div class="cdl-fields">${pvInput('ownerSignatory','Pour le maître d’ouvrage',{placeholder:pv.ownerName||'Nom du signataire'})}${pvInput('companySignatory','Pour l’entreprise',{placeholder:pv.companyRepresentative||'Nom du signataire'})}</div></fieldset>`;
  if(levee)fillPvImportSources();
}
async function fillPvImportSources(){
  const select=$('#pv-import-source');if(!select)return;
  try{const drafts=(await listDrafts()).filter(d=>d.draftId!==state.draftId&&d.caseType==='ep'&&d.pv?.document==='reception').sort((a,b)=>(b.dossierId===state.dossierId)-(a.dossierId===state.dossierId)||String(b.savedAt).localeCompare(String(a.savedAt)));
    if(!select.isConnected)return;
    select.innerHTML=drafts.length?drafts.map(d=>`<option value="${escapeHtml(d.draftId)}">${escapeHtml([d.caseReference,d.caseName||'Constat'].filter(Boolean).join(' — '))} · ${escapeHtml(d.visitDate||'')} · ${d.pv.reserves?.length||0} réserve(s)${d.dossierId&&d.dossierId===state.dossierId?' · même dossier':''}</option>`).join(''):'<option value="">Aucun PV de réception enregistré sur cet appareil</option>';
  }catch{select.innerHTML='<option value="">Constats illisibles</option>';}
}
const pvList=el=>{const row=el.closest('[data-pv-list]');return row?{list:state.pv[row.dataset.pvList],index:Number(row.dataset.index)}:null;};
$('#pv-editor').addEventListener('input',e=>{const t=e.target;
  if(t.dataset.pv){state.pv[t.dataset.pv]=t.dataset.pv==='withReserves'?t.value==='true':t.value;saveVisit();return;}
  const item=t.dataset.pvItem,target=pvList(t);if(!item||!target)return;const entry=target.list[target.index];
  entry[item]=t.type==='checkbox'?t.checked:t.value;
  if(item==='status'&&t.value==='levee'&&!entry.leveeDate){entry.leveeDate=state.visitDate||'';renderPvEditor();}
  saveVisit();
});
$('#pv-editor').addEventListener('change',e=>{if(e.target.dataset.pvItem==='status')renderPvEditor();});
$('#pv-editor').addEventListener('click',async e=>{const b=e.target.closest('[data-pv-command]');if(!b)return;const pv=state.pv;
  switch(b.dataset.pvCommand){
    case 'add-declaration':pv.declarations.push({label:'',value:''});break;
    case 'add-doe':pv.doe.push({label:'',provided:false});break;
    case 'add-reserve':pv.reserves.push(emptyReserve());break;
    case 'from-photos':{const added=reservesFromPhotos(state.photos,pv.reserves);if(!added.length){alert('Toutes les photos sont déjà citées dans une réserve.');return;}pv.reserves.push(...added);break;}
    case 'all-lifted':pv.reserves.filter(r=>!r.status).forEach(r=>{r.status='levee';r.leveeDate||=state.visitDate||'';});break;
    case 'remove':{const target=pvList(b);if(!target)return;if(b.closest('.pv-reserve')&&!confirm(`Supprimer la réserve n° ${target.index+1} ?`))return;target.list.splice(target.index,1);break;}
    case 'import':{const id=$('#pv-import-source').value;if(!id)return;const draft=(await listDrafts()).find(d=>d.draftId===id);if(!draft?.pv)return;
      if(pvHasData(pv)&&!confirm('Remplacer le contenu du PV en cours par celui du PV de réception choisi ?'))return;
      state.pv=pvForLevee(draft.pv,draft.visitDate);if(!state.siteAddress&&draft.siteAddress)state.siteAddress=draft.siteAddress;renderReportFields();break;}
    default:return;
  }
  renderPvEditor();saveVisit();
});
$('#pv-document').addEventListener('change',e=>{const value=PV_DOCUMENTS[e.target.value]?e.target.value:'constat';
  if(value!=='constat'&&!state.pv.ownerName&&state.clientName)state.pv.ownerName=state.clientName;
  state.pv.document=value;renderReportFields();saveVisit();});
