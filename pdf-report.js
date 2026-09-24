/* Shared browser/Node PDF builder. Images are embedded; no Internet needed. */
async function buildConstatPdf(data, library=globalThis.PDFLib){
  const {PDFDocument,StandardFonts,rgb}=library;
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(data.clean?'Constat - photos seules':'Constat - reportage commenté');
  const margin=45,width=595.28,height=841.89,gap=18,col=(width-2*margin-gap)/2;
  const safe=value=>Array.from(String(value??'').normalize('NFC')).map(ch=>{try{font.encodeText(ch);return ch;}catch{return '?';}}).join('');
  const wrap=(value,size=12,max=col-14)=>{const result=[];for(const paragraph of safe(value).split('\n')){let line='';for(const word of paragraph.split(/\s+/)){if(!word)continue;if(font.widthOfTextAtSize(line+(line?' ':'')+word,size)<=max){line+=(line?' ':'')+word;continue;}if(line){result.push(line);line='';}for(const char of word){if(font.widthOfTextAtSize(line+char,size)>max){result.push(line);line='';}line+=char;}}result.push(line);}return result;};
  let page,y,rows=0;
  function text(value,x,top,size=12,strong=false){page.drawText(safe(value),{x,y:height-top-size,size,font:strong?bold:font,color:rgb(.12,.2,.18)});}
  function newPage(){page=pdf.addPage([width,height]);y=margin;rows=0;text('CONSTAT · Reportage photographique',margin,y,17,true);y+=27;for(const line of wrap(data.heading||'',10,width-2*margin)){text(line,margin,y,10);y+=13;}text(data.clean?'Photos seules — sans commentaires ni notes':'Éléments sélectionnés dans la synthèse',margin,y,10);y+=22;page.drawLine({start:{x:margin,y:height-y},end:{x:width-margin,y:height-y},thickness:1,color:rgb(.2,.4,.34)});y+=16;}
  async function embed(source){if(!source)return null;return source.startsWith('data:image/png')?pdf.embedPng(source):pdf.embedJpg(source);}
  const include=(p,key)=>!data.clean&&p.include?.[key]!==false;
  newPage();
  for(const subject of data.subjects){
    const photos=data.photos.filter(p=>p.subject===subject);if(!photos.length)continue;
    for(let index=0;index<photos.length;index+=2){
      if(rows>=2||y>height-260)newPage();
      const titleLines=wrap(subject,12,width-2*margin);
      for(const line of titleLines){if(y>height-margin-35)newPage();text(line,margin,y,12,true);y+=17;}y+=5;
      const pair=photos.slice(index,index+2),cards=[];
      for(const photo of pair){
        const lines=[];
        for(const [field,label] of [['description','Description'],['comment','Commentaires'],['transcript','Transcription']])if(include(photo,field)&&photo[field]?.trim())lines.push(...wrap(label+' : '+photo[field]),'');
        if(photo.position&&Number.isFinite(photo.position.lat)&&Number.isFinite(photo.position.lng))lines.push(...wrap(`Position ${photo.position.source==='capture'?'à la capture':'associée'} : ${photo.position.lat.toFixed(6)}, ${photo.position.lng.toFixed(6)}`,10));
        cards.push({photo,image:await embed(photo.pdfSrc||photo.annotatedSrc||photo.src),drawing:include(photo,'drawing')&&photo.drawing?await embed(photo.drawing):null,lines});
      }
      let first=true;
      do{
        const top=y,photoHeight=first?94:0,noteHeight=first&&cards.some(c=>c.drawing)?74:0,base=25+photoHeight+(photoHeight?8:0)+noteHeight;
        let available=Math.floor((height-margin-30-y-base)/16);
        if(available<1){newPage();continue;}
        const take=Math.min(available,Math.max(...cards.map(c=>c.lines.length)),first?18:available);
        const cardHeight=base+take*16+10;
        cards.forEach((card,i)=>{const x=margin+i*(col+gap);text(`Photo ${card.photo.number}${first?'':' (suite)'}`,x+7,top+4,11,true);let contentTop=top+25;
          if(first){const dimensions=card.image.scaleToFit(180,94);page.drawImage(card.image,{x:x+(col-dimensions.width)/2,y:height-contentTop-dimensions.height,width:dimensions.width,height:dimensions.height});contentTop+=102;if(noteHeight){if(card.drawing){const d=card.drawing.scaleToFit(col-14,66);page.drawImage(card.drawing,{x:x+7,y:height-contentTop-d.height,width:d.width,height:d.height});}contentTop+=noteHeight;}}
          card.lines.splice(0,take).forEach((line,j)=>text(line,x+7,contentTop+j*16,12));page.drawRectangle({x,y:height-top-cardHeight,width:col,height:cardHeight,borderWidth:.5,borderColor:rgb(.8,.85,.82)});
        });
        y=top+cardHeight+18;rows++;first=false;if(cards.some(c=>c.lines.length))newPage();
      }while(cards.some(c=>c.lines.length));
    }
  }
  const actions=data.clean?[]:(data.actions||[]).filter(a=>a.text?.trim()||a.recipient?.trim());
  if(actions.length){if(y>height-140)newPage();text('Suites à donner',margin,y,13,true);y+=24;for(const action of actions){for(const line of wrap(`${action.type} — ${action.text}${action.recipient?' · Destinataire : '+action.recipient:''}${action.date?' · Échéance : '+action.date:''}`,12,width-2*margin)){if(y>height-margin-35)newPage();text(line,margin,y);y+=16;}y+=10;}}
  const pages=pdf.getPages();pages.forEach((p,i)=>p.drawText(`${i+1} / ${pages.length}`,{x:width-margin-35,y:24,font,size:9,color:rgb(.4,.45,.42)}));
  return pdf.save();
}
if(typeof module!=='undefined')module.exports={buildConstatPdf};
