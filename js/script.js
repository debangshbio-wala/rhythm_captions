let audioUrl = null;
let audioFile = null;
let segments = [];
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let activeAudio = null;
let isRunning = false;
let isRecording = false;
let mediaRecorder = null;
let rafId = null;

const CANVAS_W = 540;
const CANVAS_H = 960;
const LOCAL_STORAGE_KEY = 'rhythm_captions_dg_key';

const canvas = document.getElementById('videoCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: false });
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;

const apiKeyInput = document.getElementById('apiKeyInput');
const btnToggleKey = document.getElementById('btnToggleKey');
const iconEyeClosed = document.getElementById('iconEyeClosed');
const iconEyeOpen = document.getElementById('iconEyeOpen');
const dropZone = document.getElementById('dropZone');
const audioUpload = document.getElementById('audioUpload');
const controlsCard = document.getElementById('controlsCard');
const btnReset = document.getElementById('btnReset');
const btnTranscribe = document.getElementById('btnTranscribe');
const transcribeBtnLabel = document.getElementById('transcribeBtnLabel');
const lyricsBlock = document.getElementById('lyricsPreviewBlock');
const lyricsEditor = document.getElementById('lyricsEditor');
const lyricsHint = document.getElementById('lyricsHint');
const previewBox = document.getElementById('previewBox');
const renderStatus = document.getElementById('renderStatus');
const btnPreview = document.getElementById('btnPreview');
const btnRender = document.getElementById('btnRender');
const btnStopPreview = document.getElementById('btnStopPreview');
const btnStopRender = document.getElementById('btnStopRender');
const renderDot = document.getElementById('renderDot');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const progressLabel = document.getElementById('progressLabel');
const rememberKeyCheckbox = document.getElementById('rememberKey');
const contactBlock = document.getElementById('contactBlock');
const contactLine = document.getElementById('contactLine');
const contactReveal = document.getElementById('contactReveal');

function loadStoredKey() {
    try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored && stored.trim()) {
            apiKeyInput.value = stored.trim();
            rememberKeyCheckbox.checked = true;
        }
    } catch (e) {}
}

function saveKeyIfWanted() {
    const key = apiKeyInput.value.trim();
    if (rememberKeyCheckbox.checked && key) {
        try { localStorage.setItem(LOCAL_STORAGE_KEY, key); } catch (e) {}
    } else {
        try { localStorage.removeItem(LOCAL_STORAGE_KEY); } catch (e) {}
    }
}

loadStoredKey();
apiKeyInput.addEventListener('blur', saveKeyIfWanted);
rememberKeyCheckbox.addEventListener('change', saveKeyIfWanted);

function updateEyeIcon() {
    if (apiKeyInput.type === 'password') {
        iconEyeClosed.style.display = '';
        iconEyeOpen.style.display = 'none';
    } else {
        iconEyeClosed.style.display = 'none';
        iconEyeOpen.style.display = '';
    }
}
btnToggleKey.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
    updateEyeIcon();
});
updateEyeIcon();

let contactExpanded = false;
contactBlock.addEventListener('click', () => {
    contactExpanded = !contactExpanded;
    contactBlock.classList.toggle('expanded', contactExpanded);
    contactLine.innerHTML = contactExpanded 
        ? '<strong>nahi mila ga</strong> &mdash; tap to hide' 
        : '<strong>nahi mila ga</strong> &mdash; tap to reveal';
});

dropZone.addEventListener('click', () => audioUpload.click());
audioUpload.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    stopEverything();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioFile = file;
    audioUrl = URL.createObjectURL(file);
    document.getElementById('fileInfo').textContent = file.name;
    dropZone.classList.add('hidden');
    controlsCard.classList.remove('hidden');
    lyricsBlock.classList.add('hidden');
    previewBox.classList.add('hidden');
    segments = [];
});

btnReset.addEventListener('click', () => {
    stopEverything();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioFile = null;
    audioUrl = null;
    audioUpload.value = '';
    segments = [];
    controlsCard.classList.add('hidden');
    lyricsBlock.classList.add('hidden');
    previewBox.classList.add('hidden');
    dropZone.classList.remove('hidden');
});

function stopEverything() {
    isRunning = isRecording = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (activeAudio) {
        activeAudio.pause();
        activeAudio = null;
    }
}

console.log('%c Rhythm Captions %c Ready ', 'background:#111;color:#fff;padding:6px 10px;border-radius:6px 0 0 6px;font-family:monospace;', 'background:#fff;color:#000;padding:6px 10px;border-radius:0 6px 6px 0;font-family:monospace;');
