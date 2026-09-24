const pages = document.querySelectorAll('.page');
const sidebar = document.querySelector('.sidebar');
const state = { currentStep: 1, activeSubject: 'Vue générale', subjects: ['Vue générale'], photos: [], position: null, actions: [], drawingTarget: null };
const STORAGE_KEY = 'constat-field-visit';
let saveTimer;

function updateSaveState(message, isError = false) {
  const indicator = document.querySelector('.save-state');
  indicator.textContent = message;
  indicator.classList.toggle('save-error', isError);
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `photo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showPage(id) {
  pages.forEach(page => page.classList.toggle('active', page.id === id));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === id));
  sidebar.classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.view)));
document.querySelector('.mobile-menu').addEventListener('click', () => sidebar.classList.toggle('open'));
document.querySelectorAll('.new-inspection, .resume').forEach(button => button.addEventListener('click', () => { state.currentStep = 1; showPage('inspection'); renderStep(); }));
document.querySelectorAll('.back-btn').forEach(button => button.addEventListener('click', () => showPage('dashboard')));
document.querySelectorAll('.next-step').forEach(button => button.addEventListener('click', () => { state.currentStep = Math.min(4, state.currentStep + 1); renderStep(); }));
document.querySelectorAll('.prev-step').forEach(button => button.addEventListener('click', () => { state.currentStep = Math.max(1, state.currentStep - 1); renderStep(); }));
document.querySelectorAll('.case-option').forEach(option => option.addEventListener('click', () => {
  document.querySelectorAll('.case-option').forEach(item => { item.classList.remove('selected'); item.lastElementChild.textContent = ''; });
  option.classList.add('selected'); option.lastElementChild.textContent = '✓';
}));

function renderStep() {
  document.querySelectorAll('.step-content').forEach(content => content.classList.toggle('active', Number(content.dataset.step) === state.currentStep));
  document.querySelectorAll('.step').forEach((step, index) => step.classList.toggle('active', index + 1 <= state.currentStep));
  if (state.currentStep === 4) buildReportPreview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function escapeHtml(value = '') {
  const node = document.createElement('div'); node.textContent = value; return node.innerHTML;
}

function renderSubjects() {
  document.querySelector('#subject-tabs').innerHTML = state.subjects.map(subject => `<button class="${subject === state.activeSubject ? 'active' : ''}" data-subject="${escapeHtml(subject)}">${escapeHtml(subject)}</button>`).join('');
  document.querySelectorAll('[data-subject]').forEach(button => button.addEventListener('click', () => { state.activeSubject = button.dataset.subject; renderSubjects(); renderCaptures(); }));
}

document.querySelector('#new-subject').addEventListener('click', () => {
  const name = prompt('Nom du désordre ou du sujet (ex. Fissure façade nord) :');
  if (!name?.trim()) return;
  state.subjects.push(name.trim()); state.activeSubject = name.trim(); renderSubjects(); renderCaptures(); saveVisit();
});

const photoInput = document.querySelector('#photo-input');
document.querySelector('#photo-button').addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', event => {
  [...event.target.files].forEach(file => {
    const reader = new FileReader();
    reader.onload = () => {
      state.photos.push({ id: createId(), number: state.photos.length + 1, subject: state.activeSubject, src: reader.result, description: '', comment: '', drawing: '', audio: null, position: state.position ? { ...state.position } : null, capturedAt: new Date().toISOString() });
      renderCaptures(); saveVisit();
    };
    reader.readAsDataURL(file);
  });
  event.target.value = '';
});

function renderCaptures() {
  const visible = state.photos.filter(photo => photo.subject === state.activeSubject);
  const container = document.querySelector('#capture-list');
  container.innerHTML = visible.length ? visible.map(photo => `<article class="capture-card" data-photo-id="${photo.id}"><div class="photo-frame"><img src="${photo.annotatedSrc || photo.src}" alt="Photo ${photo.number}"><span>PHOTO ${String(photo.number).padStart(2, '0')}</span>${photo.position ? '<small>⌖ Géolocalisée</small>' : ''}</div><div class="capture-fields"><label>Sujet<select class="photo-subject">${state.subjects.map(subject => `<option ${subject === photo.subject ? 'selected' : ''}>${escapeHtml(subject)}</option>`).join('')}</select></label><label>Description pour le rapport<textarea class="photo-description" placeholder="Décrivez ce que montre la photo…">${escapeHtml(photo.description)}</textarea></label><label>Commentaires / observations<textarea class="photo-comment" placeholder="Mesures, réserves, éléments à vérifier…">${escapeHtml(photo.comment)}</textarea></label><div class="input-modes"><button class="secondary annotate-photo">✎ Annoter la photo</button><button class="secondary draw-note">✎ Écrire au stylet</button><button class="secondary record-audio">● Dicter une note</button><button class="delete-photo" aria-label="Supprimer">Supprimer</button></div>${photo.drawing ? '<span class="attachment-ok">✓ Note manuscrite enregistrée</span>' : ''}${photo.audio ? '<span class="attachment-ok">✓ Note audio enregistrée</span>' : ''}</div></article>`).join('') : '<div class="capture-empty"><span>◎</span><h3>Aucune photo dans ce sujet</h3><p>Prenez une photo pour démarrer votre reportage.</p></div>';
  bindCaptureEvents();
}

function bindCaptureEvents() {
  document.querySelectorAll('.capture-card').forEach(card => {
    const photo = state.photos.find(item => item.id === card.dataset.photoId);
    card.querySelector('.photo-description').addEventListener('input', event => { photo.description = event.target.value; saveVisit(); });
    card.querySelector('.photo-comment').addEventListener('input', event => { photo.comment = event.target.value; saveVisit(); });
    card.querySelector('.photo-subject').addEventListener('change', event => { photo.subject = event.target.value; renderCaptures(); saveVisit(); });
    card.querySelector('.annotate-photo').addEventListener('click', () => openDrawing(photo.id, 'photo'));
    card.querySelector('.draw-note').addEventListener('click', () => openDrawing(photo.id));
    card.querySelector('.record-audio').addEventListener('click', event => toggleRecording(photo, event.currentTarget));
    card.querySelector('.delete-photo').addEventListener('click', () => { state.photos = state.photos.filter(item => item.id !== photo.id); renumberPhotos(); renderCaptures(); saveVisit(); });
  });
}

document.querySelector('#locate-button').addEventListener('click', () => {
  const status = document.querySelector('#geo-status');
  if (!navigator.geolocation) { status.querySelector('small').textContent = 'Géolocalisation non prise en charge'; return; }
  status.querySelector('small').textContent = 'Recherche de la position…';
  navigator.geolocation.getCurrentPosition(position => {
    state.position = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
    status.classList.add('located'); status.querySelector('small').textContent = `${state.position.lat.toFixed(6)}, ${state.position.lng.toFixed(6)} · précision ${Math.round(state.position.accuracy)} m`;
    status.querySelector('button').textContent = 'Actualiser'; saveVisit();
  }, () => { status.querySelector('small').textContent = 'Position refusée ou indisponible'; });
});

let mediaRecorder;
async function toggleRecording(photo, button) {
  if (mediaRecorder?.state === 'recording') { mediaRecorder.stop(); button.textContent = '● Dicter une note'; button.classList.remove('recording'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const chunks = [];
    mediaRecorder = new MediaRecorder(stream); mediaRecorder.ondataavailable = event => chunks.push(event.data);
    mediaRecorder.onstop = () => { photo.audio = URL.createObjectURL(new Blob(chunks, { type: mediaRecorder.mimeType })); stream.getTracks().forEach(track => track.stop()); renderCaptures(); saveVisit(); };
    mediaRecorder.start(); button.textContent = '■ Arrêter l’enregistrement'; button.classList.add('recording');
  } catch { alert("L’accès au microphone doit être autorisé pour dicter une note."); }
}

const dialog = document.querySelector('#drawing-dialog');
const canvas = document.querySelector('#drawing-canvas');
const context = canvas.getContext('2d');
let drawing = false, drawingMode = 'note', drawingBase = null, drawingPointer = null;
let drawingVersion = 0;
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
}

async function openDrawing(photoId, mode = 'note') {
  const photo = state.photos.find(item => item.id === photoId);
  if (!photo) return;
  const version = ++drawingVersion;
  state.drawingTarget = photoId; drawingMode = mode; drawing = false; drawingPointer = null; drawingBase = null;
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
  context.strokeStyle = document.querySelector('#pen-color').value;
  context.lineWidth = Number(document.querySelector('#pen-width').value) * canvas.width / canvas.getBoundingClientRect().width;
  context.lineCap = 'round'; context.lineJoin = 'round';
  context.beginPath(); context.moveTo(point.x, point.y); context.lineTo(point.x + 0.01, point.y); context.stroke();
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!drawing || event.pointerId !== drawingPointer) return;
  const point = pointerPosition(event); context.lineTo(point.x, point.y); context.stroke();
  context.beginPath(); context.moveTo(point.x, point.y);
});
function stopDrawing(event) { if (event.pointerId === drawingPointer) { drawing = false; drawingPointer = null; } }
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => canvas.addEventListener(type, stopDrawing));
drawingClear.addEventListener('click', resetDrawing);
document.querySelector('#close-drawing').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { ++drawingVersion; drawing = false; drawingPointer = null; });
drawingSave.addEventListener('click', () => {
  const photo = state.photos.find(item => item.id === state.drawingTarget);
  if (!photo || drawingSave.disabled) return;
  if (drawingMode === 'photo') photo.annotatedSrc = canvas.toDataURL('image/jpeg', 0.9);
  else photo.drawing = canvas.toDataURL('image/png');
  dialog.close(); renderCaptures(); saveVisit();
});

function addAction(values = {}) {
  const row = document.querySelector('#action-template').content.firstElementChild.cloneNode(true);
  row.querySelector('select').value = values.type || 'Créer une tâche'; row.querySelector('input:not([type="date"])').value = values.text || ''; row.querySelector('[type="date"]').value = values.date || '';
  row.querySelector('.remove-action').addEventListener('click', () => { row.remove(); saveVisit(); }); row.addEventListener('input', saveVisit); document.querySelector('#action-list').appendChild(row);
}
document.querySelector('#add-action').addEventListener('click', () => addAction());

function renumberPhotos() { state.photos.forEach((photo, index) => { photo.number = index + 1; }); }
function collectActions() { return [...document.querySelectorAll('.action-row')].map(row => ({ type: row.querySelector('select').value, text: row.querySelector('input:not([type="date"])').value, date: row.querySelector('[type="date"]').value })); }
function persistVisit() {
  state.actions = collectActions();
  const photos = state.photos.map(photo => ({ ...photo, audio: null }));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ subjects: state.subjects, photos, position: state.position, actions: state.actions }));
    updateSaveState(`✓ Enregistré sur cet appareil à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (error) {
    console.error('Impossible d’enregistrer le brouillon local.', error);
    updateSaveState('⚠ Stockage local saturé : retirez une photo', true);
  }
}

function saveVisit() {
  updateSaveState('Enregistrement…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistVisit, 400);
}

function buildReportPreview() {
  document.querySelector('#report-date').textContent = new Intl.DateTimeFormat('fr-FR').format(new Date());
  document.querySelector('#report-photos').innerHTML = state.photos.length ? state.photos.map(photo => `<article><div class="report-image"><img src="${photo.annotatedSrc || photo.src}" alt="Photo ${photo.number}"><b>Photo ${photo.number}</b></div><h4>${escapeHtml(photo.subject)}</h4>${photo.description ? `<p>${escapeHtml(photo.description)}</p>` : ''}${photo.drawing ? `<img class="report-drawing" src="${photo.drawing}" alt="Note manuscrite">` : ''}</article>`).join('') : '<p class="report-empty">Aucune photo enregistrée.</p>';
  const points = state.photos.filter(photo => photo.position);
  document.querySelector('#map-points').innerHTML = points.length ? points.map(photo => `<span class="map-pin">${photo.number}</span>`).join('') + `<small>${points.length} prise${points.length > 1 ? 's' : ''} de vue géolocalisée${points.length > 1 ? 's' : ''}</small>` : 'Aucune coordonnée enregistrée';
}

document.querySelector('#generate-report').addEventListener('click', () => {
  buildReportPreview();
  const content = document.querySelector('.report-sheet').innerHTML;
  const word = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 portrait;margin:1.8cm}body{font-family:Arial;font-size:12pt}img{max-width:100%}.report-photo-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.report-image{height:300px}.report-image img{width:100%;height:100%;object-fit:contain}</style></head><body>${content}</body></html>`;
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([word], { type: 'application/msword' })); link.download = 'reportage-photographique-EX-2026-042.doc'; link.click(); URL.revokeObjectURL(link.href);
  const toast = document.querySelector('.toast'); toast.textContent = '✓ Fichier Word généré'; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2500);
});

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (saved) {
    state.subjects = saved.subjects?.length ? saved.subjects : state.subjects;
    state.activeSubject = state.subjects[0];
    state.photos = Array.isArray(saved.photos) ? saved.photos : [];
    state.position = saved.position || null;
    (saved.actions || []).forEach(addAction);
    updateSaveState('✓ Brouillon restauré sur cet appareil');
  }
} catch (error) {
  console.error('Le brouillon local est illisible.', error);
  updateSaveState('⚠ Brouillon local illisible', true);
}
if (!document.querySelector('.action-row')) addAction();
renderSubjects(); renderCaptures();
