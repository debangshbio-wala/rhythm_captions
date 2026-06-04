    // Global variables
        let apiKey = '';
        let audioFile = null;
        let selectedStyle = 'classic';
        let generatedVideoBlob = null;
        let generatedTransparentBlob = null;

        // API Key visibility toggle
        function toggleKeyVisibility() {
            const input = document.getElementById('apiKey');
            const btn = document.querySelector('.toggle-password');
            if (input.type === 'password') {
                input.type = 'text';
                btn.textContent = 'Hide';
            } else {
                input.type = 'password';
                btn.textContent = 'Show';
            }
        }

        // Style selector
        document.querySelectorAll('.style-option').forEach(option => {
            option.addEventListener('click', function() {
                document.querySelectorAll('.style-option').forEach(o => o.classList.remove('selected'));
                this.classList.add('selected');
                selectedStyle = this.dataset.style;
            });
        });

        // Slider box functionality
        const sliderBox = document.getElementById('sliderBox');
        sliderBox.addEventListener('click', function() {
            this.classList.toggle('active');
        });

        // File input handler
        document.getElementById('audioFile').addEventListener('change', function(e) {
            audioFile = e.target.files[0];
            document.getElementById('fileError').style.display = 'none';
        });

        // Log function
        function log(message) {
            const logOutput = document.getElementById('logOutput');
            logOutput.style.display = 'block';
            logOutput.innerHTML += `<div>${new Date().toLocaleTimeString()}: ${message}</div>`;
            logOutput.scrollTop = logOutput.scrollHeight;
        }

        // Update progress
        function updateProgress(percent, message) {
            document.getElementById('progressContainer').style.display = 'block';
            document.getElementById('progressFill').style.width = percent + '%';
            document.getElementById('progressText').textContent = message;
        }

        // Noise reduction using Web Audio API
        async function reduceNoise(audioBuffer) {
            const offlineCtx = new OfflineAudioContext(
                audioBuffer.numberOfChannels,
                audioBuffer.length,
                audioBuffer.sampleRate
            );

            const source = offlineCtx.createBufferSource();
            source.buffer = audioBuffer;

            // Create filters for noise reduction
            const lowPass = offlineCtx.createBiquadFilter();
            lowPass.type = 'lowpass';
            lowPass.frequency.value = 8000;
            lowPass.Q.value = 0.7;

            const highPass = offlineCtx.createBiquadFilter();
            highPass.type = 'highpass';
            highPass.frequency.value = 80;
            highPass.Q.value = 0.7;

            // Compressor for dynamic range
            const compressor = offlineCtx.createDynamicsCompressor();
            compressor.threshold.value = -24;
            compressor.knee.value = 30;
            compressor.ratio.value = 12;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.25;

            source.connect(highPass);
            highPass.connect(lowPass);
            lowPass.connect(compressor);
            compressor.connect(offlineCtx.destination);

            source.start(0);
            return await offlineCtx.startRendering();
        }

        // Chunk audio for Deepgram
        function chunkAudio(audioBuffer, chunkDuration = 15) {
            const sampleRate = audioBuffer.sampleRate;
            const chunkSamples = chunkDuration * sampleRate;
            const chunks = [];
            
            for (let i = 0; i < audioBuffer.length; i += chunkSamples) {
                const chunk = audioBuffer.slice(i, Math.min(i + chunkSamples, audioBuffer.length));
                chunks.push(chunk);
            }
            
            return chunks;
        }

        // Convert AudioBuffer to WAV blob
        function audioBufferToWav(audioBuffer) {
            const numChannels = audioBuffer.numberOfChannels;
            const sampleRate = audioBuffer.sampleRate;
            const format = 1; // PCM
            const bitDepth = 16;
            
            const bytesPerSample = bitDepth / 8;
            const blockAlign = numChannels * bytesPerSample;
            
            const buffer = audioBuffer.getChannelData(0);
            const dataLength = buffer.length * bytesPerSample;
            const headerLength = 44;
            const totalLength = headerLength + dataLength;
            
            const arrayBuffer = new ArrayBuffer(totalLength);
            const view = new DataView(arrayBuffer);
            
            // WAV header
            writeString(view, 0, 'RIFF');
            view.setUint32(4, totalLength - 8, true);
            writeString(view, 8, 'WAVE');
            writeString(view, 12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, format, true);
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * blockAlign, true);
            view.setUint16(32, blockAlign, true);
            view.setUint16(34, bitDepth, true);
            writeString(view, 36, 'data');
            view.setUint32(40, dataLength, true);
            
            // Write audio data
            let offset = 44;
            for (let i = 0; i < buffer.length; i++) {
                const sample = Math.max(-1, Math.min(1, buffer[i]));
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
                offset += 2;
            }
            
            return new Blob([arrayBuffer], { type: 'audio/wav' });
        }

        function writeString(view, offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }

        // Transcribe with Deepgram
        async function transcribeWithDeepgram(audioBlob, apiKey) {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'audio.wav');
            
            const response = await fetch('https://api.deepgram.com/v1/listen?model=whisper&language=en&smart_format=true&utterances=true&timestamps=true', {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${apiKey}`,
                },
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`Deepgram API error: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            return data;
        }

        // Fix gaps in transcription
        function fixTranscriptionGaps(words) {
            if (!words || words.length === 0) return words;
            
            const fixed = [];
            let lastEnd = 0;
            
            for (let i = 0; i < words.length; i++) {
                const word = words[i];
                
                // Check for gap
                if (i > 0 && word.start > lastEnd + 0.5) {
                    // Insert a small pause marker
                    fixed.push({
                        word: '',
                        start: lastEnd,
                        end: word.start,
                        isGap: true
                    });
                }
                
                fixed.push({
                    word: word.punctuated_word || word.word,
                    start: word.start,
                    end: word.end,
                    confidence: word.confidence
                });
                
                lastEnd = word.end;
            }
            
            return fixed;
        }

        // Generate video with captions
        async function generateCaptionVideo(words, style, audioBuffer) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Set canvas size
            canvas.width = 1080;
            canvas.height = 1920;
            
            // Set background to green
            ctx.fillStyle = '#00FF00';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            const stream = canvas.captureStream(30);
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'video/webm;codecs=vp9',
                videoBitsPerSecond: 2500000
            });
            
            const chunks = [];
            mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
            
            const recordingPromise = new Promise((resolve) => {
                mediaRecorder.onstop = () => {
                    const blob = new Blob(chunks, { type: 'video/webm' });
                    resolve(blob);
                };
            });
            
            mediaRecorder.start();
            
            const fps = 30;
            const totalFrames = Math.ceil(audioBuffer.duration * fps);
            let currentFrame = 0;
            
            const drawFrame = () => {
                if (currentFrame >= totalFrames) {
                    mediaRecorder.stop();
                    return;
                }
                
                const currentTime = currentFrame / fps;
                
                // Clear canvas with green
                ctx.fillStyle = '#00FF00';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                
                // Find current words
                const currentWords = words.filter(w => 
                    w.start <= currentTime && w.end >= currentTime && !w.isGap
                );
                
                if (currentWords.length > 0) {
                    const text = currentWords.map(w => w.word).join(' ');
                    
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    
                    // Apply selected style
                    switch(style) {
                        case 'classic':
                            ctx.font = 'bold 72px Arial, sans-serif';
                            ctx.fillStyle = '#FFFFFF';
                            ctx.strokeStyle = '#000000';
                            ctx.lineWidth = 4;
                            ctx.strokeText(text, canvas.width / 2, canvas.height * 0.85);
                            ctx.fillText(text, canvas.width / 2, canvas.height * 0.85);
                            break;
                            
                        case 'modern':
                            ctx.font = 'bold 68px "Segoe UI", sans-serif';
                            ctx.shadowColor = '#a0d2db';
                            ctx.shadowBlur = 15;
                            ctx.fillStyle = '#FFFFFF';
                            ctx.fillText(text, canvas.width / 2, canvas.height * 0.85);
                            ctx.shadowBlur = 0;
                            break;
                            
                        case 'bold':
                            ctx.font = 'bold 76px "Impact", sans-serif';
                            ctx.fillStyle = '#FF4444';
                            ctx.strokeStyle = '#000000';
                            ctx.lineWidth = 6;
                            ctx.strokeText(text, canvas.width / 2, canvas.height * 0.85);
                            ctx.fillText(text, canvas.width / 2, canvas.height * 0.85);
                            break;
                    }
                }
                
                currentFrame++;
                requestAnimationFrame(drawFrame);
            };
            
            drawFrame();
            
            return await recordingPromise;
        }

        // Main process function
        async function processAudio() {
            apiKey = document.getElementById('apiKey').value.trim();
            const fileInput = document.getElementById('audioFile');
            
            // Validation
            let isValid = true;
            if (!apiKey) {
                document.getElementById('keyError').style.display = 'block';
                isValid = false;
            } else {
                document.getElementById('keyError').style.display = 'none';
            }
            
            if (!fileInput.files[0]) {
                document.getElementById('fileError').style.display = 'block';
                isValid = false;
            } else {
                document.getElementById('fileError').style.display = 'none';
            }
            
            if (!isValid) return;
            
            audioFile = fileInput.files[0];
            
            try {
                document.getElementById('processBtn').disabled = true;
                document.getElementById('downloadSection').style.display = 'none';
                updateProgress(0, 'Reading audio file...');
                log('Starting process...');
                
                // Read audio file
                const arrayBuffer = await audioFile.arrayBuffer();
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                let audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                
                updateProgress(20, 'Reducing background noise...');
                log('Reducing noise...');
                
                // Reduce noise
                audioBuffer = await reduceNoise(audioBuffer);
                
                updateProgress(40, 'Preparing audio chunks...');
                log('Chunking audio...');
                
                // Chunk audio
                const chunks = chunkAudio(audioBuffer, 15);
                let allWords = [];
                
                // Transcribe each chunk
                for (let i = 0; i < chunks.length; i++) {
                    updateProgress(40 + (i / chunks.length) * 40, `Transcribing chunk ${i + 1}/${chunks.length}...`);
                    log(`Processing chunk ${i + 1}/${chunks.length}`);
                    
                    const chunkBlob = audioBufferToWav(chunks[i]);
                    const result = await transcribeWithDeepgram(chunkBlob, apiKey);
                    
                    if (result.results?.channels?.[0]?.alternatives?.[0]?.words) {
                        const words = result.results.channels[0].alternatives[0].words;
                        // Adjust timestamps for chunk offset
                        const timeOffset = i * 15;
                        const adjustedWords = words.map(w => ({
                            ...w,
                            start: w.start + timeOffset,
                            end: w.end + timeOffset
                        }));
                        allWords.push(...adjustedWords);
                    }
                    
                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                
                updateProgress(85, 'Fixing transcription gaps...');
                log('Fixing gaps in transcription...');
                
                // Fix gaps
                allWords = fixTranscriptionGaps(allWords);
                
                updateProgress(90, 'Generating video...');
                log('Generating green screen video...');
                
                // Generate video
                generatedVideoBlob = await generateCaptionVideo(allWords, selectedStyle, audioBuffer);
                
                updateProgress(100, 'Complete!');
                log('Video generated successfully!');
                
                document.getElementById('downloadSection').style.display = 'block';
                document.getElementById('processBtn').disabled = false;
                
            } catch (error) {
                log(`Error: ${error.message}`);
                updateProgress(0, 'Error occurred');
                document.getElementById('processBtn').disabled = false;
            }
        }

        // Download functions
        function downloadVideo() {
            if (!generatedVideoBlob) return;
            
            const url = URL.createObjectURL(generatedVideoBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `green_screen_caption_${Date.now()}.webm`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            log('Green screen video downloaded');
        }

        function downloadTransparentVideo() {
            // For transparent video, we'd need a more complex solution
            // This is a placeholder - true transparency requires alpha channel support
            log('Transparent video download is not fully supported in browser');
            alert('Transparent video requires additional processing. Green screen video can be keyed out in video editors.');
        }

        // Initialize
        log('App initialized. Ready to process.');
        
        // Handle slider on mobile
        sliderBox.addEventListener('touchstart', function(e) {
            e.preventDefault();
            this.classList.toggle('active');
        });
