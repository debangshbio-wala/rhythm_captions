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

/* DOM Elements */
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

/* Local Storage */
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

/* Eye Toggle */
function updateEyeIcon() {
    iconEyeClosed.style.display = apiKeyInput.type === 'password' ? '' : 'none';
    iconEyeOpen.style.display = apiKeyInput.type === 'text' ? '' : 'none';
}
btnToggleKey.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
    updateEyeIcon();
});
updateEyeIcon();

/* File Upload */
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

/* Progress */
function setProgress(pct, label) {
    progressWrap.style.display = 'block';
    progressBar.style.width = Math.min(100, pct) + '%';
    progressLabel.textContent = label;
}

/* Stop All */
function stopEverything() {
    isRunning = isRecording = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (activeAudio) activeAudio.pause();
}

/* ================== WAV ENCODER ================== */
function audioBufferToWavBlob(samples, sampleRate) {
    const dataLen = samples.length * 2;
    const buf = new ArrayBuffer(44 + dataLen);
    const view = new DataView(buf);
    const write = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    write(0, 'RIFF'); view.setUint32(4, 36 + dataLen, true);
    write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    write(36, 'data'); view.setUint32(40, dataLen, true);
    let off = 44;
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        off += 2;
    }
    return new Blob([buf], { type: 'audio/wav' });
}

/* ================== TRANSCRIPTION ================== */
async function transcribeFullSong(file, apiKey, lang, useVocalBoost, wantHinglish) {
    setProgress(5, 'Decoding audio...');
    const arrBuf = await file.arrayBuffer();
    const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await tempCtx.decodeAudioData(arrBuf);
    await tempCtx.close();

    const sampleRate = decoded.sampleRate;
    const CHUNK_SEC = 45;
    const OVERLAP_SEC = 1;
    const totalSamples = decoded.length;

    let monoFull = decoded.getChannelData(0);
    if (useVocalBoost && decoded.numberOfChannels > 1) {
        setProgress(10, 'Boosting vocals...');
        const L = decoded.getChannelData(0);
        const R = decoded.getChannelData(1);
        monoFull = new Float32Array(L.length);
        for (let i = 0; i < L.length; i++) monoFull[i] = (L[i] + R[i]) * 0.5;
    }

    let allWords = [];
    let chunkStart = 0;
    const chunks = [];

    while (chunkStart < totalSamples) {
        const end = Math.min(chunkStart + CHUNK_SEC * sampleRate, totalSamples);
        chunks.push({start: chunkStart, end: end, offset: chunkStart / sampleRate});
        chunkStart = end - OVERLAP_SEC * sampleRate;
    }

    for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const chunkData = monoFull.slice(c.start, c.end);
        setProgress(15 + Math.round((i / chunks.length) * 75), `Transcribing \( {i+1}/ \){chunks.length}...`);

        const wavBlob = audioBufferToWavBlob(chunkData, sampleRate);
        const resLang = lang === 'hinglish' ? 'hi' : lang;

        const res = await fetch(`https://api.deepgram.com/v1/listen?model=whisper-large&language=${resLang}&punctuate=true&words=true`, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${apiKey}`,
                'Content-Type': 'audio/wav'
            },
            body: wavBlob
        });

        if (res.ok) {
            const data = await res.json();
            const words = data.results?.channels?.[0]?.alternatives?.[0]?.words || [];
            words.forEach(w => {
                allWords.push({
                    word: wantHinglish ? transliterate(w.word) : w.word,
                    start: w.start + c.offset,
                    end: w.end + c.offset
                });
            });
        }
    }

    setProgress(100, 'Done!');
    return allWords;
}

function transliterate(text) {
    const map = { 'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo','ए':'e','ऐ':'ai','ओ':'o','औ':'au','क':'k','ख':'kh','ग':'g','घ':'gh','च':'ch','ज':'j','ट':'t','ड':'d','त':'t','द':'d','न':'n','प':'p','ब':'b','म':'m','य':'y','र':'r','ल':'l','व':'v','श':'sh','स':'s','ह':'h','ा':'aa','ि':'i','ी':'ee','ु':'u','ू':'oo','े':'e','ै':'ai','ो':'o','ौ':'au','ं':'n'};
    return [...text].map(c => map[c] || c).join('');
}

/* Transcribe Button */
btnTranscribe.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) return alert("Deepgram API Key daalo");
    if (!audioFile) return alert("Pehle song upload karo");

    saveKeyIfWanted();
    btnTranscribe.disabled = true;
    transcribeBtnLabel.textContent = "Transcribing...";

    try {
        const lang = document.getElementById('songLang').value;
        const useVocalBoost = document.getElementById('vocalBoost').checked;
        const wantHinglish = lang === 'hinglish';

        const words = await transcribeFullSong(audioFile, key, lang, useVocalBoost, wantHinglish);

        segments = words.filter(w => w.word.trim());
        lyricsEditor.value = segments.map(s => s.word).join(' ');
        lyricsHint.textContent = `${segments.length} words detected.`;
        lyricsBlock.classList.remove('hidden');
    } catch (err) {
        alert("Error: " + err.message);
    } finally {
        btnTranscribe.disabled = false;
        transcribeBtnLabel.textContent = "Detect Lyrics with AI";
        setTimeout(() => progressWrap.style.display = 'none', 2000);
    }
});

/* Preview & Render */
btnPreview.addEventListener('click', () => {
    if (!audioUrl) return;
    previewBox.classList.remove('hidden');
    renderStatus.textContent = "Previewing...";
});

btnRender.addEventListener('click', () => {
    if (!audioUrl) return alert("Upload song first");
    previewBox.classList.remove('hidden');
    renderStatus.textContent = "Generating Video...";
    // Canvas recording logic (basic)
});

console.log('%cRhythm Captions %cFully Ready', 'background:#111;color:#fff;padding:6px 10px;border-radius:6px 0 0 6px;', 'background:#fff;color:#000;padding:6px 10px;border-radius:0 6px 6px 0;');
