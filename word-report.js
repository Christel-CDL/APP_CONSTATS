'use strict';
// Browser/Node builder. Local library, embedded images, editable Word text.
async function buildConstatWord(data, library=globalThis.docx){
  const {Document,Paragraph,TextRun,ImageRun,Table,TableRow,TableCell,Packer,WidthType,AlignmentType,Footer,PageNumber}=library;
  const paragraph=(text,options={})=>new Paragraph({spacing:{after:100},...options,children:[new TextRun({text:String(text??''),font:'Arial',size:24,bold:!!options.bold})]});
  const image=(src,w,h,maxW=230,maxH=120)=>{
    const ratio=Math.min(maxW/(w||maxW),maxH/(h||maxH));
    return new Paragraph({alignment:AlignmentType.CENTER,children:[new ImageRun({data:src,type:src.startsWith('data:image/png')?'png':'jpg',transformation:{width:Math.round((w||maxW)*ratio),height:Math.round((h||maxH)*ratio)}})]});
  };
  const children=[paragraph('Reportage photographique commenté',{bold:true}),paragraph(data.heading),paragraph(data.date)];
  let rows=0;
  for(const subject of data.subjects){
    const photos=data.photos.filter(p=>p.subject===subject);
    for(let i=0;i<photos.length;i+=2){
      if(rows&&rows%2===0)children.push(new Paragraph({pageBreakBefore:true,children:[]}));
      children.push(paragraph(subject,{bold:true,keepNext:true}));
      const cells=photos.slice(i,i+2).map(p=>{
        const content=[image(p.annotatedSrc||p.src,p.imageWidth,p.imageHeight),paragraph('Photo '+p.number,{bold:true})];
        for(const [key,label] of [['description','Description'],['comment','Commentaires'],['transcript','Transcription']]){
          if(p.include?.[key]!==false&&p[key]?.trim()){
            content.push(paragraph(label,{bold:true,keepNext:true}));
            for(const line of p[key].split('\n'))content.push(paragraph(line));
          }
        }
        if(p.include?.drawing!==false&&p.drawing)content.push(image(p.drawing,p.noteWidth,p.noteHeight,230,100));
        if(p.position&&Number.isFinite(p.position.lat)&&Number.isFinite(p.position.lng))content.push(paragraph(`Position ${p.position.source==='capture'?'relevée lors de la capture':'associée manuellement'} : ${p.position.lat.toFixed(6)}, ${p.position.lng.toFixed(6)}${Number.isFinite(p.position.accuracy)?' · précision ±'+Math.round(p.position.accuracy)+' m':''}`));
        return new TableCell({width:{size:50,type:WidthType.PERCENTAGE},children:content,margins:{top:100,bottom:100,left:100,right:100}});
      });
      if(cells.length===1)cells.push(new TableCell({width:{size:50,type:WidthType.PERCENTAGE},children:[paragraph('')]}));
      children.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},columnWidths:[4932,4932],rows:[new TableRow({children:cells})]}));
      children.push(paragraph(''));rows++;
    }
  }
  const actions=(data.actions||[]).filter(a=>a.text?.trim()||a.recipient?.trim());
  if(actions.length){children.push(paragraph('Suites à donner',{bold:true,keepNext:true}));for(const a of actions)children.push(paragraph(`${a.type} — ${a.text}${a.recipient?' · Destinataire : '+a.recipient:''}${a.date?' · Échéance : '+a.date:''}`));}
  const doc=new Document({creator:'Constat',title:'Reportage photographique',styles:{default:{document:{run:{font:'Arial',size:24},paragraph:{spacing:{after:100}}}}},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1020,bottom:1020,left:1020,right:1020}}},footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({children:[PageNumber.CURRENT,' / ',PageNumber.TOTAL_PAGES],font:'Arial',size:20})]})]})},children}]});
  return Packer.toBlob(doc);
}
if(typeof module!=='undefined')module.exports={buildConstatWord};
