'use strict';
// Scan de la feuille de présence : la photo prise avec l'appareil est recadrée sur les quatre coins de la feuille
// (détectés automatiquement, ajustables au doigt), redressée (correction de perspective), puis rendue en « document »
// (fond blanc uniforme, écriture et signatures contrastées). Tout est calculé sur l'appareil : aucune image n'est envoyée.
const SCAN_MAX_SOURCE=2400,SCAN_MAX_OUTPUT=1800;
const scan={image:null,corners:[],drag:-1,view:{scale:1,ox:0,oy:0},result:null,rotation:0,resolve:null};
const scanDist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function scanCanvas(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c;}
// Image source ramenée à SCAN_MAX_SOURCE pixels sur son grand côté (pixels lisibles pour le redressement).
function scanSource(image){const k=Math.min(1,SCAN_MAX_SOURCE/Math.max(image.naturalWidth,image.naturalHeight)),c=scanCanvas(image.naturalWidth*k,image.naturalHeight*k),ctx=c.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0,c.width,c.height);return c;}
// Détection de la feuille : seuil d'Otsu sur une image réduite, plus grande zone claire, puis ses quatre extrémités.
// Une feuille blanche posée sur une table plus sombre est le cas courant ; à défaut, cadre légèrement en retrait.
function scanDetect(src){const W=src.width,H=src.height,inset=[{x:W*.04,y:H*.04},{x:W*.96,y:H*.04},{x:W*.96,y:H*.96},{x:W*.04,y:H*.96}];
  if(Math.min(W,H)<32)return [{x:0,y:0},{x:W,y:0},{x:W,y:H},{x:0,y:H}];
  try{const k=320/Math.max(W,H),w=Math.max(8,Math.round(W*k)),h=Math.max(8,Math.round(H*k)),c=scanCanvas(w,h),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(src,0,0,w,h);
    const px=ctx.getImageData(0,0,w,h).data,n=w*h,gray=new Uint8Array(n),hist=new Float64Array(256);
    for(let i=0;i<n;i++){const g=(px[i*4]*299+px[i*4+1]*587+px[i*4+2]*114)/1000|0;gray[i]=g;hist[g]++;}
    let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let sumB=0,wB=0,best=0,threshold=128;
    for(let t=0;t<256;t++){wB+=hist[t];if(!wB)continue;const wF=n-wB;if(!wF)break;sumB+=t*hist[t];const mB=sumB/wB,mF=(sum-sumB)/wF,between=wB*wF*(mB-mF)**2;if(between>best){best=between;threshold=t;}}
    const label=new Int32Array(n),queue=new Int32Array(n);let bestLabel=0,bestSize=0,current=0;
    for(let start=0;start<n;start++){if(label[start]||gray[start]<=threshold)continue;current++;let head=0,tail=0,size=0;queue[tail++]=start;label[start]=current;
      while(head<tail){const i=queue[head++],x=i%w;size++;
        for(const j of [x>0?i-1:-1,x<w-1?i+1:-1,i-w,i+w])if(j>=0&&j<n&&!label[j]&&gray[j]>threshold){label[j]=current;queue[tail++]=j;}}
      if(size>bestSize){bestSize=size;bestLabel=current;}}
    if(bestSize<n*.12)return inset;
    let tl=null,tr=null,br=null,bl=null;
    for(let i=0;i<n;i++){if(label[i]!==bestLabel)continue;const x=i%w,y=(i/w)|0,s=x+y,d=x-y;
      if(!tl||s<tl.s)tl={x,y,s};if(!br||s>br.s)br={x,y,s};if(!tr||d>tr.d)tr={x,y,d};if(!bl||d<bl.d)bl={x,y,d};}
    const corners=[tl,tr,br,bl].map(p=>({x:Math.min(W,Math.max(0,(p.x+.5)/k)),y:Math.min(H,Math.max(0,(p.y+.5)/k))}));
    // Quadrilatère trop petit ou dégénéré (zone claire mal découpée) : cadre par défaut.
    const area=Math.abs(corners.reduce((a,p,i)=>{const q=corners[(i+1)%4];return a+p.x*q.y-q.x*p.y;},0))/2;
    return area>W*H*.12?corners:inset;}
  catch{return inset;}}
// Homographie carré unité → quadrilatère (coins dans l'ordre haut-gauche, haut-droit, bas-droit, bas-gauche).
function scanHomography(q){const [p0,p1,p2,p3]=q,dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x,dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y;
  let g=0,h=0;const den=dx1*dy2-dx2*dy1;if((Math.abs(dx3)>1e-9||Math.abs(dy3)>1e-9)&&Math.abs(den)>1e-9){g=(dx3*dy2-dx2*dy3)/den;h=(dx1*dy3-dx3*dy1)/den;}
  return {a:p1.x-p0.x+g*p1.x,b:p3.x-p0.x+h*p3.x,c:p0.x,d:p1.y-p0.y+g*p1.y,e:p3.y-p0.y+h*p3.y,f:p0.y,g,h};}
// Redressement : chaque pixel de la feuille de sortie est lu dans la photo (interpolation bilinéaire).
function scanWarp(src,q){const k0=Math.max(scanDist(q[0],q[1]),scanDist(q[3],q[2])),k1=Math.max(scanDist(q[0],q[3]),scanDist(q[1],q[2])),k=Math.min(1,SCAN_MAX_OUTPUT/Math.max(k0,k1,1));
  const W=Math.max(1,Math.round(k0*k)),H=Math.max(1,Math.round(k1*k)),sw=src.width,sh=src.height,sp=src.getContext('2d',{willReadFrequently:true}).getImageData(0,0,sw,sh).data;
  const out=scanCanvas(W,H),octx=out.getContext('2d'),img=octx.createImageData(W,H),op=img.data,m=scanHomography(q);
  for(let y=0;y<H;y++){const t=(y+.5)/H;for(let x=0;x<W;x++){const s=(x+.5)/W,z=m.g*s+m.h*t+1,fx=Math.min(sw-1.001,Math.max(0,(m.a*s+m.b*t+m.c)/z-.5)),fy=Math.min(sh-1.001,Math.max(0,(m.d*s+m.e*t+m.f)/z-.5));
    const x0=fx|0,y0=fy|0,ax=fx-x0,ay=fy-y0,i00=(y0*sw+x0)*4,i10=i00+4,i01=i00+sw*4,i11=i01+4,o=(y*W+x)*4;
    for(let ch=0;ch<3;ch++)op[o+ch]=(sp[i00+ch]*(1-ax)+sp[i10+ch]*ax)*(1-ay)+(sp[i01+ch]*(1-ax)+sp[i11+ch]*ax)*ay;op[o+3]=255;}}
  octx.putImageData(img,0,0);return out;}
// Rendu « document » : l'éclairage (ombres, dégradés) est estimé par blocs puis retiré ; le papier devient blanc,
// l'écriture et les signatures restent nettes, en niveaux de gris.
function scanEnhance(canvas){const W=canvas.width,H=canvas.height,ctx=canvas.getContext('2d',{willReadFrequently:true}),img=ctx.getImageData(0,0,W,H),p=img.data,n=W*H,gray=new Float32Array(n);
  for(let i=0;i<n;i++)gray[i]=p[i*4]*.299+p[i*4+1]*.587+p[i*4+2]*.114;
  const B=Math.max(8,Math.round(Math.max(W,H)/40)),bw=Math.ceil(W/B),bh=Math.ceil(H/B),bg=new Float32Array(bw*bh);
  for(let by=0;by<bh;by++)for(let bx=0;bx<bw;bx++){let s=0,c=0;const x1=Math.min(W,(bx+1)*B),y1=Math.min(H,(by+1)*B);
    for(let y=by*B;y<y1;y++)for(let x=bx*B;x<x1;x++){s+=gray[y*W+x];c++;}const mean=s/c;let s2=0,c2=0;
    for(let y=by*B;y<y1;y++)for(let x=bx*B;x<x1;x++){const v=gray[y*W+x];if(v>=mean){s2+=v;c2++;}}bg[by*bw+bx]=c2?s2/c2:mean;}
  // Blocs chargés d'écriture : remplacés par le plus clair de leurs voisins (deux passes).
  for(let pass=0;pass<2;pass++){const copy=bg.slice();for(let by=0;by<bh;by++)for(let bx=0;bx<bw;bx++){let m=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const x=bx+dx,y=by+dy;if(x>=0&&y>=0&&x<bw&&y<bh)m=Math.max(m,copy[y*bw+x]);}bg[by*bw+bx]=m;}}
  for(let y=0;y<H;y++){const fy=Math.min(bh-1,Math.max(0,(y+.5)/B-.5)),y0=fy|0,y1=Math.min(bh-1,y0+1),ay=fy-y0;
    for(let x=0;x<W;x++){const fx=Math.min(bw-1,Math.max(0,(x+.5)/B-.5)),x0=fx|0,x1=Math.min(bw-1,x0+1),ax=fx-x0;
      const b=(bg[y0*bw+x0]*(1-ax)+bg[y0*bw+x1]*ax)*(1-ay)+(bg[y1*bw+x0]*(1-ax)+bg[y1*bw+x1]*ax)*ay,v=gray[y*W+x]/Math.max(1,b);
      const o=255*Math.min(1,Math.max(0,(v-.45)/.47))**1.15,i=(y*W+x)*4;p[i]=p[i+1]=p[i+2]=o;}}
  ctx.putImageData(img,0,0);return canvas;}
function scanRotate(canvas,turns){turns=((turns%4)+4)%4;if(!turns)return canvas;const out=turns%2?scanCanvas(canvas.height,canvas.width):scanCanvas(canvas.width,canvas.height),ctx=out.getContext('2d');
  ctx.translate(out.width/2,out.height/2);ctx.rotate(turns*Math.PI/2);ctx.drawImage(canvas,-canvas.width/2,-canvas.height/2);return out;}
function scanOutput(){const flat=scanWarp(scan.image,scan.corners),page=$('#scan-enhance').checked?scanEnhance(flat):flat;return scanRotate(page,scan.rotation);}

// ── Boîte de dialogue : étape 1, coins ; étape 2, aperçu ──
function scanFit(w,h){const box=$('#scan-stage'),maxW=Math.max(200,box.clientWidth||600),maxH=Math.max(220,window.innerHeight*.62);return Math.min(maxW/w,maxH/h,1.5);}
function drawScanCorners(){const c=$('#scan-canvas'),img=scan.image,k=scanFit(img.width,img.height),dpr=window.devicePixelRatio||1;
  c.style.width=Math.round(img.width*k)+'px';c.style.height=Math.round(img.height*k)+'px';c.width=Math.round(img.width*k*dpr);c.height=Math.round(img.height*k*dpr);scan.view.scale=k;
  const ctx=c.getContext('2d'),s=k*dpr,q=scan.corners;ctx.drawImage(img,0,0,c.width,c.height);
  ctx.save();ctx.fillStyle='#10302ba6';ctx.beginPath();ctx.rect(0,0,c.width,c.height);ctx.moveTo(q[0].x*s,q[0].y*s);for(const i of [3,2,1])ctx.lineTo(q[i].x*s,q[i].y*s);ctx.closePath();ctx.fill('evenodd');ctx.restore();
  ctx.strokeStyle='#2fd0a8';ctx.lineWidth=2.5*dpr;ctx.beginPath();q.forEach((p,i)=>i?ctx.lineTo(p.x*s,p.y*s):ctx.moveTo(p.x*s,p.y*s));ctx.closePath();ctx.stroke();
  for(const [i,p] of q.entries()){ctx.beginPath();ctx.arc(p.x*s,p.y*s,(scan.drag===i?17:13)*dpr,0,Math.PI*2);ctx.fillStyle='#ffffffd9';ctx.fill();ctx.lineWidth=3*dpr;ctx.stroke();}}
function drawScanPreview(){const c=$('#scan-canvas'),r=scan.result,k=scanFit(r.width,r.height);c.style.width=Math.round(r.width*k)+'px';c.style.height=Math.round(r.height*k)+'px';c.width=r.width;c.height=r.height;c.getContext('2d').drawImage(r,0,0);}
function scanStep(step){$('#scan-dialog').dataset.step=step;$('#scan-help').textContent=step==='coins'?'Placez les 4 points sur les coins de la feuille (glissez-les au doigt ou au stylet).':'Vérifiez que la page est lisible, droite et entière.';
  if(step==='coins')drawScanCorners();else{try{scan.result=scanOutput();}catch(error){console.warn('Scan :',error);scan.result=scanEnhance(scanWarp(scan.image,[{x:0,y:0},{x:scan.image.width,y:0},{x:scan.image.width,y:scan.image.height},{x:0,y:scan.image.height}]));}drawScanPreview();}}
function scanPoint(e){const r=$('#scan-canvas').getBoundingClientRect(),k=scan.view.scale;return {x:Math.min(scan.image.width,Math.max(0,(e.clientX-r.left)/k)),y:Math.min(scan.image.height,Math.max(0,(e.clientY-r.top)/k))};}
$('#scan-canvas').addEventListener('pointerdown',e=>{if($('#scan-dialog').dataset.step!=='coins')return;const p=scanPoint(e),k=scan.view.scale;let best=-1,dist=Infinity;
  scan.corners.forEach((c,i)=>{const d=scanDist(c,p)*k;if(d<dist){dist=d;best=i;}});if(dist>48)return;scan.drag=best;e.target.setPointerCapture(e.pointerId);e.preventDefault();drawScanCorners();});
$('#scan-canvas').addEventListener('pointermove',e=>{if(scan.drag<0)return;scan.corners[scan.drag]=scanPoint(e);e.preventDefault();drawScanCorners();});
for(const type of ['pointerup','pointercancel'])$('#scan-canvas').addEventListener(type,()=>{if(scan.drag<0)return;scan.drag=-1;drawScanCorners();});
function finishScan(value){const done=scan.resolve;scan.resolve=null;scan.image=null;scan.result=null;if($('#scan-dialog').open)$('#scan-dialog').close();if(done)done(value);}
$('#scan-full').addEventListener('click',()=>{const W=scan.image.width,H=scan.image.height;scan.corners=[{x:0,y:0},{x:W,y:0},{x:W,y:H},{x:0,y:H}];drawScanCorners();});
$('#scan-next').addEventListener('click',()=>scanStep('apercu'));
$('#scan-back').addEventListener('click',()=>scanStep('coins'));
$('#scan-rotate').addEventListener('click',()=>{scan.rotation=(scan.rotation+1)%4;scanStep('apercu');});
$('#scan-enhance').addEventListener('change',()=>scanStep('apercu'));
$('#scan-ok').addEventListener('click',()=>finishScan(scan.result.toDataURL('image/jpeg',.82)));
$('#close-scan').addEventListener('click',()=>finishScan(null));
$('#scan-dialog').addEventListener('close',()=>finishScan(null));
window.addEventListener('resize',()=>{if(!$('#scan-dialog').open)return;$('#scan-dialog').dataset.step==='coins'?drawScanCorners():drawScanPreview();});
// Ouvre le scan d'une photo ; renvoie la page scannée (JPEG, data:) ou null si l'utilisateur abandonne.
async function scanDocument(src){const image=await loadDrawingImage(src);if(scan.resolve)finishScan(null);
  scan.image=scanSource(image);scan.corners=scanDetect(scan.image);scan.rotation=0;scan.drag=-1;$('#scan-enhance').checked=true;
  return new Promise(resolve=>{scan.resolve=resolve;$('#scan-dialog').showModal();requestAnimationFrame(()=>scanStep('coins'));});}
