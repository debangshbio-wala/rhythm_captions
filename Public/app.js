(async function() {
  // Check if user has valid token
  try {
    const res = await fetch('/api/verify');
    const data = await res.json();
    if (!data.valid) {
      window.location.href = '/';
      return;
    }
    console.log('Welcome,', data.user?.name);
  } catch (e) {
    window.location.href = '/';
  }

  // ⬇️ Baki tumhara pura original app.js code yahan copy kar do ⬇️
  // ... (sara code jo pehle tha)
       /* ═══════════════════════════════════════════════
           RHYTHM CAPTIONS — app.js
           Transcription: Deepgram whisper-large
           Features: Chunked audio (45s) + overlap + retry
                     Vocal boost (center-channel extraction)
                     Hinglish transliteration
                     localStorage API key persistence
        ═══════════════════════════════════════════════ */

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

        /* ── DOM refs ── */
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

        /* ══════════════════════════════════════
           LOCAL STORAGE — API KEY PERSISTENCE
        ══════════════════════════════════════ */
        function loadStoredKey() {
            try {
                const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
                if (stored && stored.trim()) {
                    apiKeyInput.value = stored.trim();
                    rememberKeyCheckbox.checked = true;
                }
            } catch (e) {
                // localStorage unavailable (private browsing etc.)
                rememberKeyCheckbox.checked = false;
            }
        }

        function saveKeyIfWanted() {
            const key = apiKeyInput.value.trim();
            if (rememberKeyCheckbox.checked && key) {
                try {
                    localStorage.setItem(LOCAL_STORAGE_KEY, key);
                } catch (e) {
                    // silently fail
                }
            } else if (!rememberKeyCheckbox.checked) {
                try {
                    localStorage.removeItem(LOCAL_STORAGE_KEY);
                } catch (e) { /* ok */ }
            }
        }

        // Load on init
        loadStoredKey();

        // Auto-save on input change (debounced via blur)
        apiKeyInput.addEventListener('blur', saveKeyIfWanted);
        rememberKeyCheckbox.addEventListener('change', saveKeyIfWanted);

        /* ── API KEY TOGGLE (SVG eye icons) ── */
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

        /* ── FOOTER CONTACT EXPAND ── */
        let contactExpanded = false;
        contactBlock.addEventListener('click', () => {
            contactExpanded = !contactExpanded;
            if (contactExpanded) {
                contactBlock.classList.add('expanded');
                contactLine.innerHTML = '<strong>nahi mila ga</strong> &mdash; tap to hide';
            } else {
                contactBlock.classList.remove('expanded');
                contactLine.innerHTML = '<strong>nahi mila ga</strong> &mdash; tap to reveal';
            }
        });
        contactBlock.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                contactBlock.click();
            }
        });

        /* ── FILE UPLOAD ── */
        dropZone.addEventListener('click', () => audioUpload.click());
        dropZone.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') audioUpload.click();
        });
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

        btnReset.addEventListener('click', e => {
            e.stopPropagation();
            stopEverything();
            if (audioUrl) { URL.revokeObjectURL(audioUrl);
                audioUrl = null; }
            audioFile = null;
            audioUpload.value = '';
            segments = [];
            controlsCard.classList.add('hidden');
            lyricsBlock.classList.add('hidden');
            previewBox.classList.add('hidden');
            dropZone.classList.remove('hidden');
            if (audioCtx) { audioCtx.close();
                audioCtx = null;
                analyser = null;
                sourceNode = null; }
            progressWrap.style.display = 'none';
            progressLabel.textContent = '';
        });

        /* ══════════════════════════════════════════════════
           WAV ENCODER — AudioBuffer → WAV Blob (mono 16-bit)
        ═══════════════════════════════════════════════════ */
        function audioBufferToWavBlob(monoSamples, sampleRate) {
            const dataLen = monoSamples.length * 2;
            const buf = new ArrayBuffer(44 + dataLen);
            const view = new DataView(buf);
            const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
            ws(0, 'RIFF');
            view.setUint32(4, 36 + dataLen, true);
            ws(8, 'WAVE');
            ws(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true); // PCM
            view.setUint16(22, 1, true); // mono
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * 2, true);
            view.setUint16(32, 2, true);
            view.setUint16(34, 16, true);
            ws(36, 'data');
            view.setUint32(40, dataLen, true);
            let off = 44;
            for (let i = 0; i < monoSamples.length; i++) {
                const s = Math.max(-1, Math.min(1, monoSamples[i]));
                view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                off += 2;
            }
            return new Blob([buf], { type: 'audio/wav' });
        }

        /* ══════════════════════════════════════════════════
           VOCAL BOOST — center channel extraction
        ═══════════════════════════════════════════════════ */
        function extractCenter(audioBuffer) {
            const L = audioBuffer.getChannelData(0);
            const R = audioBuffer.numberOfChannels > 1 ?
                audioBuffer.getChannelData(1) :
                audioBuffer.getChannelData(0);
            const out = new Float32Array(L.length);
            for (let i = 0; i < L.length; i++) {
                out[i] = (L[i] + R[i]) * 0.5;
            }
            return out;
        }

        /* ══════════════════════════════════════════════════
           HINDI → ROMAN TRANSLITERATION (Hinglish)
        ═══════════════════════════════════════════════════ */
        const devanagariToRoman = {
            'अ': 'a',
            'आ': 'aa',
            'इ': 'i',
            'ई': 'ee',
            'उ': 'u',
            'ऊ': 'oo',
            'ए': 'e',
            'ऐ': 'ai',
            'ओ': 'o',
            'औ': 'au',
            'अं': 'an',
            'अः': 'ah',
            'क': 'k',
            'ख': 'kh',
            'ग': 'g',
            'घ': 'gh',
            'ङ': 'ng',
            'च': 'ch',
            'छ': 'chh',
            'ज': 'j',
            'झ': 'jh',
            'ञ': 'ny',
            'ट': 't',
            'ठ': 'th',
            'ड': 'd',
            'ढ': 'dh',
            'ण': 'n',
            'त': 't',
            'थ': 'th',
            'द': 'd',
            'ध': 'dh',
            'न': 'n',
            'प': 'p',
            'फ': 'ph',
            'ब': 'b',
            'भ': 'bh',
            'म': 'm',
            'य': 'y',
            'र': 'r',
            'ल': 'l',
            'व': 'v',
            'श': 'sh',
            'ष': 'sh',
            'स': 's',
            'ह': 'h',
            'क्ष': 'ksh',
            'त्र': 'tr',
            'ज्ञ': 'gya',
            'ा': 'aa',
            'ि': 'i',
            'ी': 'ee',
            'ु': 'u',
            'ू': 'oo',
            'े': 'e',
            'ै': 'ai',
            'ो': 'o',
            'ौ': 'au',
            'ं': 'n',
            'ः': 'h',
            'ँ': 'n',
            '़': '',
            '्': '',
            '०': '0',
            '१': '1',
            '२': '2',
            '३': '3',
            '४': '4',
            '५': '5',
            '६': '6',
            '७': '7',
            '८': '8',
            '९': '9',
        };

        function transliterateHindiToRoman(text) {
            if (!text) return text;
            // Check if text contains Devanagari characters
            const hasDevanagari = /[\u0900-\u097F]/.test(text);
            if (!hasDevanagari) return text; // already roman

            let result = '';
            const chars = [...text];
            let i = 0;
            while (i < chars.length) {
                // Try two-character combinations first
                let matched = false;
                if (i + 1 < chars.length) {
                    const two = chars[i] + chars[i + 1];
                    if (devanagariToRoman[two] !== undefined) {
                        result += devanagariToRoman[two];
                        i += 2;
                        matched = true;
                        continue;
                    }
                }
                // Single character
                const one = chars[i];
                if (devanagariToRoman[one] !== undefined) {
                    result += devanagariToRoman[one];
                } else {
                    result += one; // pass through unknown chars (spaces, punctuation)
                }
                i++;
            }
            // Clean up: merge repeated vowels intelligently
            result = result.replace(/a\s+a/g, 'aa ');
            result = result.replace(/\s+/g, ' ').trim();
            return result;
        }

        /* ══════════════════════════════════════════════════
           CHUNK + TRANSCRIBE with overlap & retry
           Splits audio into 45s chunks with 1s overlap,
           retries failed chunks up to 2 times,
           deduplicates overlapping words.
        ═══════════════════════════════════════════════════ */
        async function transcribeFullSong(file, apiKey, lang, useVocalBoost, wantHinglish) {
            setProgress(0, 'Decoding audio...');

            const arrBuf = await file.arrayBuffer();
            const tempCtx = new(window.AudioContext || window.webkitAudioContext)();
            const decoded = await tempCtx.decodeAudioData(arrBuf);
            await tempCtx.close();

            const sampleRate = decoded.sampleRate;
            const CHUNK_SEC = 45;
            const OVERLAP_SEC = 1.0;
            const CHUNK_SAMPS = CHUNK_SEC * sampleRate;
            const OVERLAP_SAMPS = Math.round(OVERLAP_SEC * sampleRate);
            const totalSamples = decoded.length;

            let monoFull;
            if (useVocalBoost) {
                setProgress(5, 'Boosting vocals (center extraction)...');
                monoFull = extractCenter(decoded);
            } else {
                const L = decoded.getChannelData(0);
                const R = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : L;
                monoFull = new Float32Array(L.length);
                for (let i = 0; i < L.length; i++) monoFull[i] = (L[i] + R[i]) * 0.5;
            }

            // Build chunk boundaries with overlap
            const chunks = [];
            let chunkStart = 0;
            while (chunkStart < totalSamples) {
                const startSamp = chunkStart;
                const endSamp = Math.min(chunkStart + CHUNK_SAMPS, totalSamples);
                chunks.push({ startSamp, endSamp, offsetSec: startSamp / sampleRate });
                chunkStart = endSamp - OVERLAP_SAMPS;
                if (chunkStart >= totalSamples) break;
                if (endSamp >= totalSamples) break;
            }

            const numChunks = chunks.length;
            let allWords = [];
            const MAX_RETRIES = 2;

            for (let c = 0; c < numChunks; c++) {
                const { startSamp, endSamp, offsetSec } = chunks[c];
                const chunkMono = monoFull.slice(startSamp, endSamp);
                const pct = 10 + Math.round((c / numChunks) * 85);
                setProgress(pct, `Transcribing chunk ${c + 1} of ${numChunks}...`);

                const wavBlob = audioBufferToWavBlob(chunkMono, sampleRate);
                const effectiveLang = (lang === 'hinglish') ? 'hi' : lang;

                let success = false;
                for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                    try {
                        if (attempt > 0) {
                            setProgress(pct, `Retrying chunk ${c + 1} (attempt ${attempt + 1})...`);
                            await new Promise(r => setTimeout(r, 800 * attempt));
                        }

                        const res = await fetch(
                            `https://api.deepgram.com/v1/listen?model=whisper-large&language=${effectiveLang}&punctuate=true&words=true&utterances=true`, {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Token ${apiKey}`,
                                    'Content-Type': 'audio/wav'
                                },
                                body: wavBlob
                            }
                        );

                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            const msg = err.err_msg || err.error || `HTTP ${res.status}`;
                            if (res.status === 401 || res.status === 403) {
                                throw new Error(`Authentication failed: ${msg}. Please check your API key.`);
                            }
                            if (attempt === MAX_RETRIES) {
                                throw new Error(`Chunk ${c+1} failed after ${MAX_RETRIES+1} attempts: ${msg}`);
                            }
                            continue; // retry
                        }

                        const data = await res.json();
                        const words = data?.results?.channels?.[0]?.alternatives?.[0]?.words || [];

                        for (const w of words) {
                            const rawWord = w.punctuated_word || w.word || '';
                            const finalWord = wantHinglish ? transliterateHindiToRoman(rawWord) :
                                rawWord;
                            allWords.push({
                                word: finalWord,
                                start: (w.start || 0) + offsetSec,
                                end: (w.end || 0) + offsetSec,
                            });
                        }
                        success = true;
                        break;
                    } catch (chunkErr) {
                        if (attempt === MAX_RETRIES || chunkErr.message.includes('Authentication')) {
                            console.warn('Chunk error (final):', chunkErr.message);
                            if (chunkErr.message.includes('Authentication')) throw chunkErr;
                        }
                    }
                }
                if (!success) {
                    console.warn(`Chunk ${c+1} could not be transcribed after retries. Continuing with remaining chunks.`);
                }
            }

            // Deduplicate overlapping words from chunk boundaries
            if (allWords.length > 1) {
                const deduped = [allWords[0]];
                for (let i = 1; i < allWords.length; i++) {
                    const prev = deduped[deduped.length - 1];
                    const curr = allWords[i];
                    const overlap = prev.end - curr.start;
                    const sameWord = prev.word.toLowerCase() === curr.word.toLowerCase();
                    if (overlap > 0.3 && sameWord) {
                        // Merge: keep the earlier start and later end
                        deduped[deduped.length - 1] = {
                            word: prev.word,
                            start: Math.min(prev.start, curr.start),
                            end: Math.max(prev.end, curr.end),
                        };
                    } else {
                        deduped.push(curr);
                    }
                }
                allWords = deduped;
            }

            setProgress(100, 'Done!');
            // Keep progress at 100% visible briefly
            setTimeout(() => {
                if (progressBar.style.width === '100%') {
                    progressWrap.style.display = 'none';
                }
            }, 2000);
            return allWords;
        }

        function setProgress(pct, label) {
            progressWrap.style.display = 'block';
            progressBar.style.width = Math.min(100, Math.max(0, pct)) + '%';
            progressLabel.textContent = label;
        }

        /* ══════════════════════════════════════
           TRANSCRIBE BUTTON
        ══════════════════════════════════════ */
        btnTranscribe.addEventListener('click', async () => {
            const key = apiKeyInput.value.trim();
            if (!key) {
                alert('Please enter your Deepgram API key.\nGet one free at: console.deepgram.com');
                return;
            }
            if (!audioFile) {
                alert('Please upload a song first.');
                return;
            }

            // Save key on transcription attempt (validated by successful use)
            saveKeyIfWanted();

            btnTranscribe.disabled = true;
            transcribeBtnLabel.textContent = 'Transcribing...';
            segments = [];
            lyricsBlock.classList.add('hidden');
            progressWrap.style.display = 'block';
            progressBar.style.width = '0%';

            try {
                const lang = document.getElementById('songLang')?.value || 'hinglish';
                const useVocalBoost = document.getElementById('vocalBoost')?.checked ?? true;
                const wantHinglish = (lang === 'hinglish');

                const words = await transcribeFullSong(audioFile, key, lang, useVocalBoost, wantHinglish);

                if (words.length > 0) {
                    segments = words.filter(w => w.word.trim() !== '');
                    lyricsHint.textContent =
                        `${segments.length} words detected across the full song. You can edit the lyrics below before generating.`;
                } else {
                    segments = [{ word: '(no speech detected)', start: 0, end: 9999 }];
                    lyricsHint.textContent =
                        'No words found. Try toggling Vocal Boost or changing the language setting.';
                }

                lyricsEditor.value = segments.map(s => s.word).join(' ');
                lyricsBlock.classList.remove('hidden');
                // Ensure progress shows 100%
                setProgress(100, 'Done!');

            } catch (err) {
                progressWrap.style.display = 'none';
                progressLabel.textContent = '';
                alert('Transcription failed:\n' + err.message);
            } finally {
                btnTranscribe.disabled = false;
                transcribeBtnLabel.textContent = 'Detect Lyrics with AI';
            }
        });

        /* ══════════════════════════════════════
           AUDIO CONTEXT SETUP
        ══════════════════════════════════════ */
        function getOrCreateAudioCtx(audioEl) {
            if (audioCtx && audioCtx.state !== 'closed') {
                if (sourceNode) { try { sourceNode.disconnect(); } catch (e) {} }
                sourceNode = audioCtx.createMediaElementSource(audioEl);
                sourceNode.connect(analyser);
                return;
            }
            audioCtx = new(window.AudioContext || window.webkitAudioContext)({ sampleRate: 22050 });
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 32;
            analyser.smoothingTimeConstant = 0.7;
            sourceNode = audioCtx.createMediaElementSource(audioEl);
            sourceNode.connect(analyser);
            analyser.connect(audioCtx.destination);
        }

        function stopEverything() {
            isRunning = isRecording = false;
            if (rafId) { cancelAnimationFrame(rafId);
                rafId = null; }
            if (mediaRecorder && mediaRecorder.state !== 'inactive') { try { mediaRecorder.stop(); } catch (e) {} }
            if (activeAudio) { activeAudio.pause();
                activeAudio.src = '';
                activeAudio = null; }
            btnPreview.disabled = false;
            btnRender.disabled = false;
            btnStopRender.style.display = 'none';
            renderDot.style.background = '#888';
        }

        /* ══════════════════════════════════════
           CANVAS DRAW — 5 caption styles
        ══════════════════════════════════════ */
        let bounceOffset = 0;
        let typeProgress = 0;
        let lastTypedSeg = null;

        function drawFrame(currentTime, bass, bgType, captionStyle) {
            if (bgType === 'transparent') ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
            else if (bgType === 'black') { ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, CANVAS_W, CANVAS_H); } else { ctx.fillStyle = '#00FF00';
                ctx.fillRect(0, 0, CANVAS_W, CANVAS_H); }

            if (!segments.length) return;

            const pulse = 1 + (bass / 255) * 0.22;
            const activeSeg = segments.filter(s => currentTime >= s.start && currentTime <= s.end);
            const pastSegs = segments.filter(s => s.end < currentTime).slice(-4);
            const nextSeg = segments.find(s => s.start > currentTime);

            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            if (captionStyle === 'word') {
                const seg = activeSeg[0];
                if (seg) {
                    const fs = Math.min(160, Math.max(70, CANVAS_W / Math.max(seg.word.length, 2) * 1.5)) * pulse;
                    ctx.font = `900 ${fs}px 'Bebas Neue', sans-serif`;
                    ctx.fillStyle = '#ffffff';
                    ctx.shadowBlur = 35 * pulse;
                    ctx.shadowColor = 'rgba(255,255,255,0.7)';
                    ctx.fillText(seg.word.toUpperCase(), CANVAS_W / 2, CANVAS_H / 2);
                    ctx.shadowBlur = 0;
                }
            } else if (captionStyle === 'line') {
                const line = activeSeg.map(s => s.word).join(' ') || pastSegs.map(s => s.word).join(' ');
                if (line) {
                    const fs = 68 * pulse;
                    ctx.font = `bold ${fs}px 'DM Mono', monospace`;
                    ctx.fillStyle = '#ffffff';
                    ctx.shadowBlur = 18;
                    ctx.shadowColor = 'rgba(0,0,0,0.8)';
                    wrapText(ctx, line, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W - 80, fs * 1.35);
                    ctx.shadowBlur = 0;
                }
            } else if (captionStyle === 'karaoke') {
                const allVis = [...pastSegs.slice(-2), ...activeSeg, ...(nextSeg ? [nextSeg] : [])];
                const fs = 65 * pulse;
                let y = CANVAS_H / 2 - (allVis.length / 2) * fs * 1.45;
                for (const seg of allVis) {
                    const isAct = activeSeg.includes(seg);
                    const isPast = seg.end < currentTime;
                    ctx.shadowBlur = 0;
                    if (isAct) {
                        ctx.fillStyle = '#ffffff';
                        ctx.shadowBlur = 28 * pulse;
                        ctx.shadowColor = 'rgba(255,255,255,0.9)';
                        ctx.font = `900 ${fs*1.18}px 'Bebas Neue', sans-serif`;
                    } else if (isPast) {
                        ctx.fillStyle = 'rgba(255,255,255,0.3)';
                        ctx.font = `bold ${fs}px 'Bebas Neue', sans-serif`;
                    } else {
                        ctx.fillStyle = 'rgba(255,255,255,0.12)';
                        ctx.font = `bold ${fs}px 'Bebas Neue', sans-serif`;
                    }
                    ctx.fillText(seg.word.toUpperCase(), CANVAS_W / 2, y);
                    ctx.shadowBlur = 0;
                    y += fs * 1.5;
                }
            } else if (captionStyle === 'bounce') {
                const seg = activeSeg[0];
                if (seg) {
                    bounceOffset = -Math.abs(Math.sin(Date.now() / 120)) * 30 * pulse;
                    const fs = Math.min(150, Math.max(65, CANVAS_W / Math.max(seg.word.length, 2) * 1.4)) * pulse;
                    ctx.font = `900 ${fs}px 'Bebas Neue', sans-serif`;
                    ctx.fillStyle = 'rgba(255,255,255,0.15)';
                    ctx.fillText(seg.word.toUpperCase(), CANVAS_W / 2, CANVAS_H / 2 + 12);
                    ctx.fillStyle = '#ffffff';
                    ctx.shadowBlur = 22 * pulse;
                    ctx.shadowColor = 'rgba(255,255,255,0.5)';
                    ctx.fillText(seg.word.toUpperCase(), CANVAS_W / 2, CANVAS_H / 2 + bounceOffset);
                    ctx.shadowBlur = 0;
                }
                if (nextSeg) {
                    const fs2 = 40;
                    ctx.font = `bold ${fs2}px 'Bebas Neue', sans-serif`;
                    ctx.fillStyle = 'rgba(255,255,255,0.18)';
                    ctx.fillText(nextSeg.word.toUpperCase(), CANVAS_W / 2, CANVAS_H / 2 + 130);
                }
            } else if (captionStyle === 'typewriter') {
                const seg = activeSeg[0];
                if (seg) {
                    if (seg !== lastTypedSeg) { typeProgress = 0;
                        lastTypedSeg = seg; }
                    typeProgress = Math.min(seg.word.length, typeProgress + 0.35 * pulse);
                    const display = seg.word.slice(0, Math.floor(typeProgress)).toUpperCase();
                    const cursor = Math.floor(Date.now() / 400) % 2 === 0 ? '|' : '';
                    const fs = Math.min(160, Math.max(70, CANVAS_W / Math.max(seg.word.length, 2) * 1.5));
                    ctx.font = `900 ${fs}px 'Bebas Neue', sans-serif`;
                    ctx.fillStyle = '#ffffff';
                    ctx.shadowBlur = 20;
                    ctx.shadowColor = 'rgba(255,255,255,0.5)';
                    ctx.fillText(display + cursor, CANVAS_W / 2, CANVAS_H / 2);
                    ctx.shadowBlur = 0;
                }
            }

            if (bass > 90) {
                ctx.beginPath();
                ctx.arc(CANVAS_W / 2, CANVAS_H / 2, 230 * pulse, 0, 2 * Math.PI);
                ctx.strokeStyle = `rgba(255,255,255,${(bass/255)*0.1})`;
                ctx.lineWidth = 7;
                ctx.stroke();
            }
            ctx.restore();
        }

        function wrapText(context, text, x, y, maxWidth, lineH) {
            const words = text.split(' ');
            let line = '',
                lines = [];
            for (const w of words) {
                const t = line ? line + ' ' + w : w;
                if (context.measureText(t).width > maxWidth && line) { lines.push(line);
                    line = w; } else line = t;
            }
            if (line) lines.push(line);
            const sy = y - ((lines.length - 1) * lineH) / 2;
            lines.forEach((l, i) => context.fillText(l, x, sy + i * lineH));
        }

        /* ══════════════════════════════════════
           PREVIEW LOOP
        ══════════════════════════════════════ */
        function startLoop(bgType, captionStyle) {
            const dataArr = new Uint8Array(32);
            let fc = 0;

            function loop() {
                if (!isRunning) return;
                if (++fc % 2 === 0) { rafId = requestAnimationFrame(loop); return; }
                analyser.getByteFrequencyData(dataArr);
                drawFrame(activeAudio ? activeAudio.currentTime : 0, (dataArr[0] + dataArr[1]) >> 1, bgType,
                    captionStyle);
                rafId = requestAnimationFrame(loop);
            }
            loop();
        }

        btnPreview.addEventListener('click', () => {
            if (!audioUrl) return;
            stopEverything();
            activeAudio = new Audio(audioUrl);
            activeAudio.crossOrigin = 'anonymous';
            getOrCreateAudioCtx(activeAudio);
            if (audioCtx.state === 'suspended') audioCtx.resume();

            isRunning = true;
            previewBox.classList.remove('hidden');
            renderStatus.textContent = 'Previewing...';
            renderDot.style.background = '#888';
            btnStopPreview.style.display = '';
            btnStopRender.style.display = 'none';
            btnPreview.disabled = true;

            const bgType = document.getElementById('bgType').value;
            const captionStyle = document.getElementById('captionStyle').value;

            activeAudio.play().catch(() => alert('Tap Preview again to start.'));
            activeAudio.addEventListener('ended', () => {
                stopEverything();
                renderStatus.textContent = 'Preview ended.';
                btnPreview.disabled = false;
            }, { once: true });
            startLoop(bgType, captionStyle);
        });

        btnStopPreview.addEventListener('click', () => {
            stopEverything();
            renderStatus.textContent = 'Preview stopped.';
            btnPreview.disabled = false;
        });

        /* ══════════════════════════════════════
           RENDER VIDEO
        ══════════════════════════════════════ */
        btnRender.addEventListener('click', () => {
            if (!audioUrl) return;
            stopEverything();
            activeAudio = new Audio(audioUrl);
            activeAudio.crossOrigin = 'anonymous';
            getOrCreateAudioCtx(activeAudio);
            if (audioCtx.state === 'suspended') audioCtx.resume();

            previewBox.classList.remove('hidden');
            renderStatus.textContent = 'Recording...';
            renderDot.style.background = '#f0f0f0';
            btnStopPreview.style.display = 'none';
            btnStopRender.style.display = '';
            btnRender.disabled = true;
            isRunning = isRecording = true;

            const bgType = document.getElementById('bgType').value;
            const captionStyle = document.getElementById('captionStyle').value;

            const stream = canvas.captureStream(24);
            const mimes = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
            let mime = '';
            for (const m of mimes) { if (MediaRecorder.isTypeSupported(m)) { mime = m; break; } }

            let chunks = [];
            mediaRecorder = mime ?
                new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 800_000 }) :
                new MediaRecorder(stream, { videoBitsPerSecond: 800_000 });

            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
            mediaRecorder.onstop = () => {
                if (!chunks.length) return;
                const ext = mediaRecorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
                const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
                chunks = [];
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `rhythm_captions.${ext}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 10000);
                renderStatus.textContent = 'Done! Check your downloads.';
                renderDot.style.background = '#888';
                btnRender.disabled = false;
                btnStopRender.style.display = 'none';
            };

            mediaRecorder.start(500);
            activeAudio.play().catch(() => { stopEverything();
                alert('Tap Generate again to start.'); });
            activeAudio.addEventListener('ended', () => {
                isRunning = false;
                if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
                renderStatus.textContent = 'Finalizing...';
            }, { once: true });
            startLoop(bgType, captionStyle);
        });

        btnStopRender.addEventListener('click', () => {
            isRunning = false;
            if (rafId) { cancelAnimationFrame(rafId);
                rafId = null; }
            if (activeAudio) { activeAudio.pause();
                activeAudio.src = '';
                activeAudio = null; }
            if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
            renderStatus.textContent = 'Finalizing...';
            btnRender.disabled = false;
            btnStopRender.style.display = 'none';
        });

        console.log('%c Rhythm Captions %c Ready ',
            'background:#111;color:#fff;padding:6px 10px;border-radius:6px 0 0 6px;font-family:monospace;',
            'background:#fff;color:#000;padding:6px 10px;border-radius:0 6px 6px 0;font-family:monospace;');
        console.log('%c API key stored in your browser only (localStorage). Never shared.',
            'color:#888;font-family:monospace;');
})();
