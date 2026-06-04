     // ─────────────────────────────────────────────────────────────
    //  STATE
    // ─────────────────────────────────────────────────────────────
    let selectedStyle   = 'classic';
    let selectedLang    = 'auto';   // auto = detect_language=true
    let generatedBlob   = null;
    let keyVisible      = false;

    // ─────────────────────────────────────────────────────────────
    //  UTILS
    // ─────────────────────────────────────────────────────────────
    function toggleKey() {
      const inp = document.getElementById('apiKey');
      const btn = document.getElementById('toggleBtn');
      keyVisible = !keyVisible;
      inp.type = keyVisible ? 'text' : 'password';
      btn.textContent = keyVisible ? 'HIDE' : 'SHOW';
    }

    function setStyle(el) {
      document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
      selectedStyle = el.dataset.style;
    }

    function setLang(el) {
      document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
      selectedLang = el.dataset.lang;
    }

    // ─────────────────────────────────────────────────────────────
    //  FILE UPLOAD UI
    // ─────────────────────────────────────────────────────────────
    const fileInput = document.getElementById('audioFile');
    const fileZone  = document.getElementById('fileZone');

    fileInput.addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      document.getElementById('fzIcon') && (document.getElementById('fzIcon').textContent = '');
      document.getElementById('fileIcon').textContent = '✓';
      document.getElementById('fzText').textContent   = 'File selected:';
      document.getElementById('fzName').textContent   = f.name;
      const mb = (f.size / 1024 / 1024).toFixed(1);
      document.getElementById('fzSub').textContent    = mb + ' MB';
      document.getElementById('fileErr').style.display = 'none';
      fileZone.style.borderColor = 'var(--accent)';
      fileZone.style.background  = 'rgba(200,245,96,.04)';
    });

    // drag-drop
    fileZone.addEventListener('dragover',  e => { e.preventDefault(); fileZone.classList.add('dragover'); });
    fileZone.addEventListener('dragleave', ()  => fileZone.classList.remove('dragover'));
    fileZone.addEventListener('drop', e => {
      e.preventDefault();
      fileZone.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f) {
        const dt = new DataTransfer();
        dt.items.add(f);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change'));
      }
    });

    // ─────────────────────────────────────────────────────────────
    //  LOG
    // ─────────────────────────────────────────────────────────────
    function log(msg, type = 'info') {
      const box = document.getElementById('logBox');
      box.style.display = 'block';
      const d = document.createElement('div');
      d.className = 'log-line' + (type === 'ok' ? ' ok' : type === 'err' ? ' err' : '');
      const ts = new Date().toLocaleTimeString('en', { hour12: false });
      d.innerHTML = `<span class="ts">${ts}</span>${msg}`;
      box.appendChild(d);
      box.scrollTop = box.scrollHeight;
    }

    function setProgress(pct, label) {
      document.getElementById('progressCard').style.display = 'block';
      document.getElementById('progFill').style.width = pct + '%';
      document.getElementById('progLabel').textContent = label;
      document.getElementById('progPct').textContent   = pct + '%';
    }

    // ─────────────────────────────────────────────────────────────
    //  AUDIO PROCESSING
    // ─────────────────────────────────────────────────────────────

    // FIXED: AudioBuffer does NOT have .slice() — use this helper instead
    function sliceAudioBuffer(buffer, startSec, endSec) {
      const sr          = buffer.sampleRate;
      const startSample = Math.floor(startSec * sr);
      const endSample   = Math.min(Math.floor(endSec * sr), buffer.length);
      const numSamples  = endSample - startSample;
      if (numSamples <= 0) return null;

      const ctx  = new OfflineAudioContext(buffer.numberOfChannels, numSamples, sr);
      const out  = ctx.createBuffer(buffer.numberOfChannels, numSamples, sr);

      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const src  = buffer.getChannelData(c);
        const dest = out.getChannelData(c);
        for (let i = 0; i < numSamples; i++) {
          dest[i] = src[startSample + i];
        }
      }
      return out;
    }

    // Light vocal-safe noise filter — does NOT kill music frequencies
    async function reduceNoise(audioBuffer) {
      const offCtx = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        audioBuffer.length,
        audioBuffer.sampleRate
      );
      const src = offCtx.createBufferSource();
      src.buffer = audioBuffer;

      // Only cut extreme sub-bass rumble — safe for vocals & instruments
      const hp = offCtx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 40;   // was 80 — lowered to keep warmth
      hp.Q.value = 0.5;

      // Light gentle compressor — does NOT squash dynamic vocals
      const comp = offCtx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value       = 40;   // very soft knee
      comp.ratio.value      = 3;    // was 12 — gentle ratio
      comp.attack.value     = 0.01;
      comp.release.value    = 0.3;

      src.connect(hp);
      hp.connect(comp);
      comp.connect(offCtx.destination);
      src.start(0);
      return offCtx.startRendering();
    }

    function audioBufferToWav(buffer) {
      // Mix down to mono for Deepgram
      const sr      = buffer.sampleRate;
      const data    = buffer.getChannelData(0);
      const length  = data.length;
      const arrBuf  = new ArrayBuffer(44 + length * 2);
      const view    = new DataView(arrBuf);

      function ws(off, str) {
        for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
      }
      ws(0, 'RIFF');
      view.setUint32(4, 36 + length * 2, true);
      ws(8, 'WAVE');
      ws(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sr, true);
      view.setUint32(28, sr * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      ws(36, 'data');
      view.setUint32(40, length * 2, true);

      let off = 44;
      for (let i = 0; i < length; i++) {
        const s = Math.max(-1, Math.min(1, data[i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        off += 2;
      }
      return new Blob([arrBuf], { type: 'audio/wav' });
    }

    // ── transcribeChunk: whisper-large + auto language + 3 retries ──
    async function transcribeChunk(wavBlob, apiKey, timeOffset, langOverride, attempt = 1) {
      const MAX_RETRIES = 3;
      // Build URL based on language selection
      let langParam = '';
      if (!langOverride || langOverride === 'auto') {
        langParam = '&detect_language=true';
      } else {
        langParam = '&language=' + langOverride;
      }
      // whisper-large handles: Hindi, English, mixed, singing — all languages
      const url = 'https://api.deepgram.com/v1/listen' +
        '?model=whisper-large' +
        langParam +
        '&smart_format=true' +
        '&punctuate=true' +
        '&utterances=false';

      let resp;
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': 'Token ' + apiKey,
            'Content-Type':  'audio/wav'
          },
          body: wavBlob
        });
      } catch (netErr) {
        if (attempt < MAX_RETRIES) {
          log(`  Network error, retrying (${attempt}/${MAX_RETRIES})...`, 'err');
          await new Promise(r => setTimeout(r, 1500 * attempt));
          return transcribeChunk(wavBlob, apiKey, timeOffset, langOverride, attempt + 1);
        }
        throw new Error('Network failed after ' + MAX_RETRIES + ' attempts: ' + netErr.message);
      }

      // Handle rate-limit (429) or server error (5xx) with retry
      if (resp.status === 429 || resp.status >= 500) {
        if (attempt < MAX_RETRIES) {
          const wait = 2000 * attempt;
          log(`  HTTP ${resp.status} — waiting ${wait/1000}s then retrying (${attempt}/${MAX_RETRIES})...`, 'err');
          await new Promise(r => setTimeout(r, wait));
          return transcribeChunk(wavBlob, apiKey, timeOffset, langOverride, attempt + 1);
        }
      }

      if (!resp.ok) {
        const txt = await resp.text();
        // Show first 200 chars of error to help diagnose
        log(`  Deepgram HTTP ${resp.status}: ${txt.substring(0, 200)}`, 'err');
        throw new Error('Deepgram error ' + resp.status);
      }

      const json = await resp.json();

      // Log detected language so user can verify
      const detectedLang = json?.results?.channels?.[0]?.detected_language;
      if (detectedLang) log(`  Detected language: ${detectedLang}`);

      // Log transcript snippet for debugging
      const transcript = json?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
      if (transcript) log(`  Preview: "${transcript.substring(0, 60)}..."`, 'ok');

      const words = json?.results?.channels?.[0]?.alternatives?.[0]?.words || [];

      // If 0 words but we have a transcript, build word-level timing from utterance
      if (words.length === 0 && transcript.trim()) {
        log(`  0 words from word-level but transcript exists — using utterance split`, 'info');
        const chunkDur = wavBlob.size / (16000 * 2); // rough estimate from 16kHz mono WAV
        const wList = transcript.trim().split(/\s+/);
        const avgLen = chunkDur / Math.max(wList.length, 1);
        return wList.map((w, i) => ({
          word:  w,
          start: timeOffset + i * avgLen,
          end:   timeOffset + (i + 1) * avgLen,
          conf:  0.5
        }));
      }

      return words.map(w => ({
        word:  w.punctuated_word || w.word,
        start: parseFloat(w.start) + timeOffset,
        end:   parseFloat(w.end)   + timeOffset,
        conf:  w.confidence
      }));
    }

    function fillGaps(words) {
      if (!words.length) return words;
      const out   = [];
      let lastEnd = 0;
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w.start > lastEnd + 0.5 && i > 0) {
          // Gap — insert empty placeholder so previous word doesn't linger
          out.push({ word: '', start: lastEnd, end: w.start, gap: true });
        }
        out.push(w);
        lastEnd = w.end;
      }
      return out;
    }

    // ─────────────────────────────────────────────────────────────
    //  VIDEO GENERATION
    // ─────────────────────────────────────────────────────────────
    const STYLES = {
      classic: (ctx, text, W, H) => {
        ctx.font      = 'bold 72px "Arial Black", Arial, sans-serif';
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth   = 6;
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        wrapText(ctx, text, W / 2, H * 0.82, W - 80, 80, true);
      },
      neon: (ctx, text, W, H) => {
        ctx.font        = 'bold 68px "Arial Black", Arial, sans-serif';
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#e040fb';
        ctx.shadowBlur  = 24;
        ctx.fillStyle   = '#f8aaff';
        ctx.strokeStyle = '#9b00d3';
        ctx.lineWidth   = 3;
        wrapText(ctx, text, W / 2, H * 0.82, W - 80, 80, true);
        ctx.shadowBlur = 0;
      },
      fire: (ctx, text, W, H) => {
        ctx.save();
        ctx.font        = 'bold italic 72px "Arial Black", Arial, sans-serif';
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#ff2200';
        ctx.shadowBlur  = 20;
        ctx.fillStyle   = '#ffaa00';
        ctx.strokeStyle = '#ff4400';
        ctx.lineWidth   = 4;
        wrapText(ctx, text, W / 2, H * 0.82, W - 80, 80, true);
        ctx.shadowBlur  = 0;
        ctx.restore();
      },
      clean: (ctx, text, W, H) => {
        ctx.font        = '300 56px "Syne", Arial, sans-serif';
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle   = '#e0f7fa';
        ctx.letterSpacing = '0.05em';
        wrapText(ctx, text, W / 2, H * 0.82, W - 100, 70, false);
      },
      retro: (ctx, text, W, H) => {
        ctx.font        = 'bold italic 68px Georgia, serif';
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle   = '#f5c518';
        ctx.strokeStyle = '#8b6914';
        ctx.lineWidth   = 4;
        // Drop shadow
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        ctx.shadowBlur   = 0;
        wrapText(ctx, text, W / 2, H * 0.82, W - 80, 80, true);
        ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      },
      bold: (ctx, text, W, H) => {
        ctx.font        = '900 80px "Arial Black", Arial, sans-serif';
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#ff5c72';
        ctx.lineWidth   = 6;
        ctx.fillStyle   = '#ffffff';
        wrapText(ctx, text, W / 2, H * 0.82, W - 80, 90, true);
      }
    };

    function wrapText(ctx, text, x, y, maxW, lineH, stroke) {
      const words = text.split(' ');
      const lines = [];
      let line    = '';

      for (const wrd of words) {
        const test = line ? line + ' ' + wrd : wrd;
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line);
          line = wrd;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);

      const totalH = lines.length * lineH;
      const startY = y - totalH / 2 + lineH / 2;

      for (let i = 0; i < lines.length; i++) {
        const ly = startY + i * lineH;
        if (stroke) ctx.strokeText(lines[i], x, ly);
        ctx.fillText(lines[i], x, ly);
      }
    }

    function generateVideo(words, style, durationSec) {
      return new Promise((resolve, reject) => {
        const W = 1080, H = 1920;
        const canvas = document.createElement('canvas');
        canvas.width  = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');

        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm';

        const stream   = canvas.captureStream(30);
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3000000 });
        const chunks   = [];

        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
        recorder.onerror = e => reject(e.error);

        recorder.start();

        const fps    = 30;
        const total  = Math.ceil(durationSec * fps);
        let   frame  = 0;

        const drawFrame = () => {
          if (frame >= total) {
            recorder.stop();
            return;
          }
          const t = frame / fps;

          // Green background
          ctx.fillStyle = '#00FF00';
          ctx.fillRect(0, 0, W, H);

          // Find word active at time t
          const active = words.filter(w => !w.gap && w.start <= t && w.end >= t);

          if (active.length > 0) {
            // Get context window: show up to 5 words around current
            const firstIdx = words.indexOf(active[0]);
            const windowWords = [];
            for (let i = Math.max(0, firstIdx - 2); i < Math.min(words.length, firstIdx + 4); i++) {
              if (!words[i].gap) windowWords.push(words[i]);
            }
            const text = windowWords.map(w => w.word).join(' ');
            ctx.save();
            STYLES[style](ctx, text, W, H);
            ctx.restore();
          }

          frame++;
          requestAnimationFrame(drawFrame);
        };

        drawFrame();
      });
    }

    // ─────────────────────────────────────────────────────────────
    //  MAIN PROCESS
    // ─────────────────────────────────────────────────────────────
    async function processAudio() {
      const apiKey    = document.getElementById('apiKey').value.trim();
      const fileEl    = document.getElementById('audioFile');
      let   valid     = true;

      if (!apiKey) {
        document.getElementById('keyErr').style.display = 'block';
        valid = false;
      } else {
        document.getElementById('keyErr').style.display = 'none';
      }

      if (!fileEl.files[0]) {
        document.getElementById('fileErr').style.display = 'block';
        valid = false;
      } else {
        document.getElementById('fileErr').style.display = 'none';
      }

      if (!valid) return;

      const file = fileEl.files[0];
      const btn  = document.getElementById('genBtn');

      btn.disabled = true;
      document.getElementById('dlSection').style.display = 'none';
      generatedBlob = null;

      try {
        // ── 1. Decode audio ──────────────────────────────────────
        setProgress(5, 'Reading audio file...');
        log('Decoding audio: ' + file.name);

        const arrBuf   = await file.arrayBuffer();
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let   buffer   = await audioCtx.decodeAudioData(arrBuf);
        const totalDur = buffer.duration;
        log('Duration: ' + totalDur.toFixed(1) + 's  |  Sample rate: ' + buffer.sampleRate + ' Hz');

        // ── 2. Noise reduction ───────────────────────────────────
        setProgress(15, 'Removing background noise...');
        log('Applying noise filters...');
        buffer = await reduceNoise(buffer);
        log('Noise reduction done', 'ok');

        // ── 3. Chunk & transcribe ────────────────────────────────
        const CHUNK = 25;   // 25s chunks — bigger = better context for Whisper
        const numChunks = Math.ceil(totalDur / CHUNK);
        let allWords = [];

        log(`Splitting into ${numChunks} chunks of ${CHUNK}s each | Language: ${selectedLang}`);

        for (let i = 0; i < numChunks; i++) {
          const start  = i * CHUNK;
          const end    = Math.min(start + CHUNK, totalDur);
          const pct    = Math.round(15 + (i / numChunks) * 60);

          setProgress(pct, `Transcribing chunk ${i + 1} of ${numChunks}...`);
          log(`Chunk ${i + 1}/${numChunks}: ${start.toFixed(1)}s – ${end.toFixed(1)}s`);

          const chunk   = sliceAudioBuffer(buffer, start, end);
          if (!chunk) { log(`Chunk ${i+1} empty, skipping`); continue; }

          const wavBlob = audioBufferToWav(chunk);
          const words   = await transcribeChunk(wavBlob, apiKey, start, selectedLang);
          log(`  Got ${words.length} words`, words.length > 0 ? 'ok' : 'err');
          allWords.push(...words);

          // Polite delay — avoids rate limiting on free tier
          if (i < numChunks - 1) await new Promise(r => setTimeout(r, 600));
        }

        // ── 4. Fix gaps ──────────────────────────────────────────
        setProgress(78, 'Fixing timing gaps...');
        allWords = fillGaps(allWords);
        log(`Total words after gap fix: ${allWords.filter(w => !w.gap).length}`, 'ok');

        if (allWords.filter(w => !w.gap).length === 0) {
          throw new Error('No words were transcribed. Check your API key and audio file.');
        }

        // ── 5. Render video ──────────────────────────────────────
        setProgress(82, 'Rendering green screen video...');
        log('Generating video frames at 1080×1920...');
        generatedBlob = await generateVideo(allWords, selectedStyle, totalDur);
        log('Video rendered! Size: ' + (generatedBlob.size / 1024 / 1024).toFixed(1) + ' MB', 'ok');

        setProgress(100, 'Done!');
        document.getElementById('dlSection').style.display = 'block';

      } catch (err) {
        log('ERROR: ' + err.message, 'err');
        setProgress(0, 'Error occurred — check log above');
        console.error(err);
      } finally {
        btn.disabled = false;
      }
    }

    // ─────────────────────────────────────────────────────────────
    //  DOWNLOAD
    // ─────────────────────────────────────────────────────────────
    function downloadVideo() {
      if (!generatedBlob) return;
      const url = URL.createObjectURL(generatedBlob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = 'captionforge_' + Date.now() + '.webm';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      log('Download started', 'ok');
    }

    function showGreenScreenNote() {
      log('Transparent WEBM with alpha requires VP9 alpha support (experimental). Use the green screen version and apply chroma key in CapCut / DaVinci / Premiere for best results.', 'info');
    }
  
