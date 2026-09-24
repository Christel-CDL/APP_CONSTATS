const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),JSZip=require('jszip');
const {buildConstatWord}=require('../word-report');
const {buildConstatPdf}=require('../pdf-report');
(async()=>{
 const out=process.env.TEST_OUTPUT||path.join(__dirname,'../../test-results');
 const fixture=JSON.parse(fs.readFileSync(path.join(out,'fixture.json')));
 const photos=Array.from({length:6},(_,i)=>({...fixture.photos[i%3],id:'test-'+i,number:i+1,subject:i<3?'Façade':'Intérieur',imageWidth:640,imageHeight:480,description:i===0?'Texte long à conserver. '.repeat(200):'Description '+(i+1),comment:'SECRET_EXCLU',drawing:'',include:{comment:false,description:true}}));
 const data={photos,subjects:['Façade','Intérieur'],heading:'TEST — Rapport long',date:'2026-09-24',actions:[{type:'Demander un devis',text:'ACTION_PRIVEE',recipient:'Tiers',date:'2026-10-01'}]};
 const doc=await buildConstatWord(data,require('docx'));
 const bytes=Buffer.from(await doc.arrayBuffer());fs.writeFileSync(path.join(out,'long.docx'),bytes);
 const zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');
 assert.equal((xml.match(/<w:drawing>/g)||[]).length,6);assert.doesNotMatch(xml,/SECRET_EXCLU/);assert.match(xml,/ACTION_PRIVEE/);assert.ok(xml.includes('pageBreakBefore'));
 for(const clean of [false,true])fs.writeFileSync(path.join(out,clean?'long-photos.pdf':'long.pdf'),await buildConstatPdf({...data,clean},require('../vendor/pdf-lib.min.js')));
 console.log('PASS: 6-photo multi-subject DOCX/PDF, long text, selected fields, embedded images, explicit page breaks');
})().catch(e=>{console.error(e);process.exitCode=1;});
