'use strict';
// Signatures manuscrites au doigt ou au stylet (canvas), enregistrées en PNG avec la date et l'empreinte du
// contenu signé : un procès-verbal modifié après signature ne peut plus être exporté sans nouvelle signature.
let signatureTarget=null,signatureDirty=false;
const signatureCanvas=$('#signature-canvas'),signatureCtx=signatureCanvas.getContext('2d');
function resetSignatureCanvas(){const ratio=Math.min(2,window.devicePixelRatio||1),width=Math.min(760,window.innerWidth-48);signatureCanvas.width=width*ratio;signatureCanvas.height=Math.round(width*0.36)*ratio;signatureCanvas.style.width=width+'px';signatureCanvas.style.height=Math.round(width*0.36)+'px';
  signatureCtx.setTransform(ratio,0,0,ratio,0,0);signatureCtx.fillStyle='#fff';signatureCtx.fillRect(0,0,signatureCanvas.width,signatureCanvas.height);signatureCtx.strokeStyle='#1A3A5C';signatureCtx.lineWidth=2.4;signatureCtx.lineCap='round';signatureCtx.lineJoin='round';signatureDirty=false;}
let signaturePoint=null;
signatureCanvas.addEventListener('pointerdown',e=>{e.preventDefault();signatureCanvas.setPointerCapture(e.pointerId);const r=signatureCanvas.getBoundingClientRect();signaturePoint={x:e.clientX-r.left,y:e.clientY-r.top};signatureCtx.beginPath();signatureCtx.arc(signaturePoint.x,signaturePoint.y,1.2,0,Math.PI*2);signatureCtx.fillStyle='#1A3A5C';signatureCtx.fill();signatureDirty=true;});
signatureCanvas.addEventListener('pointermove',e=>{if(!signaturePoint)return;e.preventDefault();const r=signatureCanvas.getBoundingClientRect(),p={x:e.clientX-r.left,y:e.clientY-r.top};signatureCtx.lineWidth=e.pointerType==='pen'&&e.pressure?1.2+e.pressure*2.6:2.4;signatureCtx.beginPath();signatureCtx.moveTo(signaturePoint.x,signaturePoint.y);signatureCtx.lineTo(p.x,p.y);signatureCtx.stroke();signaturePoint=p;});
for(const type of ['pointerup','pointercancel','pointerleave'])signatureCanvas.addEventListener(type,()=>{signaturePoint=null;});
// target : {role:'owner'|'company'|'expert', label, name}
function openSignature(target){signatureTarget=target;$('#signature-title').textContent=`Signature — ${target.label}`;$('#signature-name').textContent=target.name?`Signataire : ${target.name}`:'Signataire à préciser dans le champ correspondant.';$('#signature-dialog').showModal();resetSignatureCanvas();}
$('#clear-signature').addEventListener('click',resetSignatureCanvas);
$('#close-signature').addEventListener('click',()=>$('#signature-dialog').close());
$('#save-signature').addEventListener('click',()=>{if(!signatureDirty){alert('Signez dans le cadre avant de valider.');return;}
  const out=document.createElement('canvas'),scale=Math.min(1,600/signatureCanvas.width);out.width=Math.round(signatureCanvas.width*scale);out.height=Math.round(signatureCanvas.height*scale);out.getContext('2d').drawImage(signatureCanvas,0,0,out.width,out.height);
  const signature={image:out.toDataURL('image/png'),at:new Date().toISOString(),name:signatureTarget.name||''};
  if(signatureTarget.role==='expert')state.expertSignature=signature;else{signature.hash=pvContentHash(state.pv);state.pv.signatures[signatureTarget.role]=signature;}
  $('#signature-dialog').close();renderReportFields();saveVisit();});
function signatureTime(signature){const d=new Date(signature.at);return Number.isNaN(d.getTime())?'':`${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`;}
function signatureMarkup(signature,role,label){return signature?.image?`<figure class="signature-preview"><img src="${escapeHtml(signature.image)}" alt="Signature ${escapeHtml(label)}"><figcaption>Signé le ${escapeHtml(signatureTime(signature))}${role!=='expert'&&signature.hash!==pvContentHash(state.pv)?' — <b class="signature-stale">PV modifié depuis cette signature</b>':''}</figcaption></figure><div class="pv-buttons"><button type="button" class="secondary" data-sign="${role}">Refaire la signature</button><button type="button" class="secondary danger" data-unsign="${role}">Effacer</button></div>`
  :`<button type="button" class="secondary" data-sign="${role}">✍ Faire signer (doigt ou stylet)</button>`;}
// Signatures des parties devenues invalides (contenu modifié après signature).
function staleSignatures(pv){return Object.entries(pv.signatures||{}).filter(([,s])=>s?.image&&s.hash!==pvContentHash(pv)).map(([role])=>role==='owner'?'maître d’ouvrage':'entreprise');}
document.addEventListener('click',e=>{const sign=e.target.closest('[data-sign]'),unsign=e.target.closest('[data-unsign]');
  if(sign){const role=sign.dataset.sign,pv=state.pv;openSignature(role==='expert'?{role,label:'expert',name:REPORT_EXPERT.name}:role==='owner'?{role,label:'maître d’ouvrage',name:pv.ownerSignatory||pv.ownerName}:{role,label:'entreprise',name:pv.companySignatory||pv.companyRepresentative});}
  if(unsign&&confirm('Effacer cette signature ?')){if(unsign.dataset.unsign==='expert')state.expertSignature=null;else delete state.pv.signatures[unsign.dataset.unsign];renderReportFields();saveVisit();}
});
$('#expert-signs').addEventListener('change',e=>{state.expertSigns=e.target.checked;renderReportFields();saveVisit();});
function renderExpertSignature(){$('#expert-signs').checked=!!state.expertSigns;const box=$('#expert-signature');box.hidden=!state.expertSigns;box.innerHTML=state.expertSigns?signatureMarkup(state.expertSignature,'expert','de l’expert'):'';}
