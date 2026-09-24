const dialog = document.querySelector('#drawing-dialog');
const canvas = document.querySelector('#drawing-canvas');
const context = canvas.getContext('2d');
let drawing = false, drawingMode = 'note', drawingBase = null, drawingPointer = null;
let drawingVersion = 0;
let drawingTool = 'pen', lastDrawingPoint = null;
const drawingBackground = document.createElement('canvas');
function chooseDrawingTool(tool) {
  drawingTool = tool;
  document.querySelector('#drawing-pen').setAttribute('aria-pressed', String(tool === 'pen'));
  document.querySelector('#drawing-eraser').setAttribute('aria-pressed', String(tool === 'eraser'));
  canvas.style.cursor = tool === 'eraser' ? 'cell' : 'crosshair';
}
function eraseDrawing(from, to) {
  const radius = Math.max(10, Number(document.querySelector('#pen-width').value) * 2) * canvas.width / canvas.getBoundingClientRect().width;
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x-from.x, to.y-from.y) / (radius / 2)));
  for (let i=0; i<=steps; i++) {
    const x=from.x+(to.x-from.x)*i/steps, y=from.y+(to.y-from.y)*i/steps;
    context.save(); context.beginPath(); context.arc(x,y,radius,0,Math.PI*2); context.clip();
    context.drawImage(drawingBackground,0,0); context.restore();
  }
}
const drawingSave = document.querySelector('#save-drawing');
const drawingClear = document.querySelector('#clear-drawing');

function loadDrawingImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
  });
}

function resetDrawing() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (drawingBase) context.drawImage(drawingBase, 0, 0, canvas.width, canvas.height);
  else {
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.beginPath(); context.strokeStyle = '#e8eeec'; context.lineWidth = 1;
    for (let x = 20; x < canvas.width; x += 20) { context.moveTo(x, 0); context.lineTo(x, canvas.height); }
    for (let y = 20; y < canvas.height; y += 20) { context.moveTo(0, y); context.lineTo(canvas.width, y); }
    context.stroke();
  }
  drawingBackground.width=canvas.width; drawingBackground.height=canvas.height;
  drawingBackground.getContext('2d').drawImage(canvas,0,0);
}

async function openDrawing(photoId, mode = 'note') {
  const photo = state.photos.find(item => item.id === photoId);
  if (!photo) return;
  const version = ++drawingVersion;
  state.drawingTarget = photoId; drawingMode = mode; drawing = false; drawingPointer = null; drawingBase = null;
  chooseDrawingTool('pen'); lastDrawingPoint=null;
  drawingSave.disabled = true; drawingClear.disabled = true;
  canvas.style.pointerEvents = 'none';
  dialog.querySelector('b').textContent = mode === 'photo' ? 'Annoter la photo ' + photo.number : 'Note manuscrite';
  dialog.querySelector('small').textContent = 'Chargement…';
  drawingSave.textContent = mode === 'photo' ? 'Enregistrer les annotations' : 'Enregistrer la note';
  drawingClear.textContent = mode === 'photo' ? 'Retirer les annotations' : 'Effacer';
  context.clearRect(0, 0, canvas.width, canvas.height);
  dialog.showModal();
  try {
    const base = mode === 'photo' ? await loadDrawingImage(photo.src) : null;
    const savedSrc = mode === 'photo' ? photo.annotatedSrc : photo.drawing;
    const saved = savedSrc ? await loadDrawingImage(savedSrc) : null;
    if (version !== drawingVersion || !dialog.open) return;
    drawingBase = base;
    const dimensions = base || saved;
    const scale = dimensions ? Math.min(1, 1600 / Math.max(dimensions.naturalWidth, dimensions.naturalHeight)) : 1;
    canvas.width = dimensions ? Math.round(dimensions.naturalWidth * scale) : 900;
    canvas.height = dimensions ? Math.round(dimensions.naturalHeight * scale) : 430;
    resetDrawing();
    if (saved) context.drawImage(saved, 0, 0, canvas.width, canvas.height);
    dialog.querySelector('small').textContent = mode === 'photo' ? 'Dessinez au doigt ou au stylet. La photo originale est conservée.' : 'Écrivez avec votre stylet ou votre doigt';
    drawingSave.disabled = false; drawingClear.disabled = false; canvas.style.pointerEvents = '';
  } catch {
    if (version === drawingVersion) dialog.querySelector('small').textContent = 'Image illisible. Fermez cette fenêtre puis réessayez.';
  }
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
}
canvas.addEventListener('pointerdown', event => {
  if (drawingSave.disabled || drawingPointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault(); drawing = true; drawingPointer = event.pointerId;
  const point = pointerPosition(event);
  lastDrawingPoint=point;
  if(drawingTool==='eraser'){eraseDrawing(point,point);canvas.setPointerCapture(event.pointerId);return;}
  context.strokeStyle = document.querySelector('#pen-color').value;
  context.lineWidth = Number(document.querySelector('#pen-width').value) * canvas.width / canvas.getBoundingClientRect().width;
  context.lineCap = 'round'; context.lineJoin = 'round';
  context.beginPath(); context.moveTo(point.x, point.y); context.lineTo(point.x + 0.01, point.y); context.stroke();
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!drawing || event.pointerId !== drawingPointer) return;
  const point = pointerPosition(event);
  if(drawingTool==='eraser'){eraseDrawing(lastDrawingPoint||point,point);lastDrawingPoint=point;return;}
  context.lineTo(point.x, point.y); context.stroke();
  context.beginPath(); context.moveTo(point.x, point.y);
});
function stopDrawing(event) { if (event.pointerId === drawingPointer) { drawing = false; drawingPointer = null; } }
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => canvas.addEventListener(type, stopDrawing));
drawingClear.addEventListener('click', resetDrawing);
document.querySelector('#drawing-pen').addEventListener('click',()=>chooseDrawingTool('pen'));
document.querySelector('#drawing-eraser').addEventListener('click',()=>chooseDrawingTool('eraser'));
document.querySelector('#close-drawing').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { ++drawingVersion; drawing = false; drawingPointer = null; });
drawingSave.addEventListener('click', () => {
  const photo = state.photos.find(item => item.id === state.drawingTarget);
  if (!photo || drawingSave.disabled) return;
  if (drawingMode === 'photo') photo.annotatedSrc = canvas.toDataURL('image/jpeg', 0.9);
  else photo.drawing = canvas.toDataURL('image/png');
  dialog.close(); renderCaptures(); saveVisit();
});
