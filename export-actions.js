function printReport(clean=false){
  if(!state.photos.length){alert('Ajoutez au moins une photo au constat.');return;}
  updateReportContent();let container=document.querySelector('#print-report');if(!container){container=document.createElement('div');container.id='print-report';container.hidden=true;document.body.append(container);}
  const original=state.photos.map(p=>p.include);
  try{if(clean)state.photos.forEach(p=>p.include={description:false,comment:false,transcript:false,drawing:false});container.innerHTML=`<h1>Reportage photographique${clean?' — photos seules':''}</h1><p>${escapeHtml($('.report-top small').textContent)} · ${escapeHtml($('#report-date').textContent)}</p>${groupedReportHtml()}${clean?'':reportActionsHtml()}${reportLocationsHtml()}`;}
  finally{state.photos.forEach((p,i)=>p.include=original[i]);}
  const images=[...container.querySelectorAll('img')];
  Promise.all(images.map(img=>img.decode().catch(()=>{}))).then(()=>{document.title=clean?'Constat - photos seules':'Constat - rapport commenté';window.print();});
}
async function downloadPdf(clean){
  if(visitBusy()){alert('Terminez la capture avant de créer le rapport.');return;}
  if(!state.photos.length){alert('Ajoutez au moins une photo au constat.');return;}
  const buttons=[$('#export-pdf'),$('#export-clean-pdf')];buttons.forEach(b=>b.disabled=true);
  try{updateReportContent();const photos=structuredClone(state.photos);for(const photo of photos){photo.pdfSrc=await compressPhoto(photo.annotatedSrc||photo.src);}
    const bytes=await buildConstatPdf({photos,subjects:[...state.subjects],actions:collectActions(),heading:$('.report-top small').textContent+' · '+$('#report-date').textContent,clean});
    download(new Blob([bytes],{type:'application/pdf'}),clean?'constat-photos-seules.pdf':'constat-rapport-commente.pdf');
    $('.toast').textContent='PDF téléchargé. Vous pouvez le joindre à votre e-mail.';$('.toast').classList.add('show');setTimeout(()=>$('.toast').classList.remove('show'),4000);
  }catch(error){console.error(error);alert('Le PDF n’a pas pu être créé. Vérifiez les photos puis réessayez.');}finally{buttons.forEach(b=>b.disabled=false);}
}
$('#export-pdf').addEventListener('click',()=>downloadPdf(false));
$('#export-clean-pdf').addEventListener('click',()=>downloadPdf(true));
window.addEventListener('afterprint',()=>{document.title='Constat — Rapports de terrain';});
$('#prepare-email').addEventListener('click',()=>{
  const field=$('#mail-recipient');if(!field.value.trim()||!field.reportValidity()){field.focus();return;}
  const subject='Reportage photographique — '+(state.caseName||'Constat de terrain');
  const body='Bonjour,\n\nVeuillez trouver en pièce jointe le reportage photographique du constat.\n\nCordialement\n\n[Avant l’envoi : joindre le fichier PDF exporté et supprimer cette ligne.]';
  const link=document.createElement('a');link.href=`mailto:${encodeURIComponent(field.value.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;link.click();
});
