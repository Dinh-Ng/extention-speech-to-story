// content.js — Unified TTS Control Card
// Uses chrome.tts via message passing to background.js
// Supports Gemini TTS via Google AI Studio API
(function () {
  'use strict';

  // ---- State ----
  let currentText = '';
  let isSpeaking = false;
  let isPaused = false;
  let settingsOpen = false;

  // Gemini audio playback state
  let audioContext = null;
  let analyser = null;
  let currentSource = null;
  let audioQueue = [];
  let isPlayingGemini = false;
  let geminiStopped = false;
  let pauseTime = 0;
  let geminiTotalChunks = 0;
  let geminiReceivedChunks = 0;
  let geminiAllChunksReceived = false;
  let geminiPlayedChunks = 0;
  let animationFrameId = null;

  // Download Audio state
  let isDownloadingAudio = false;
  let downloadChunks = [];  // stores { audioData: base64, chunkIndex } during download

  // Sleep Timer state
  let sleepTimerId = null;
  let sleepCountdownId = null;
  let sleepTimerEndTime = null;

  // Background Music state
  let bgMusicContext = null;
  let bgMusicGainNode = null;
  let bgMusicSource = null;
  let bgMusicCustomAudio = null;

  // Default settings
  let ttsSettings = {
    rate: 1.0,
    pitch: 1.0,
    voiceName: '',
    engine: 'chrome',
    geminiApiKeys: [],       // Array of API key strings
    geminiActiveKeyIndex: 0, // Currently active key index
    geminiApiKey: '',        // Legacy (migration support)
    geminiVoice: 'Kore',
    theme: 'system',
    isMiniMode: false,
    autoNextChapter: false,
    bgMusic: {
      enabled: false,
      track: 'rain',
      volume: 0.3,
      customUrl: ''
    }
  };

  // Auto-next chapter state
  let autoNextTimerId = null;

  const GEMINI_VOICES = [
    'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir',
    'Aoede', 'Leda', 'Orus', 'Perseus', 'Iapetus',
    'Altair', 'Autonoe', 'Callirrhoe', 'Dorus', 'Erinome',
    'Gacrux', 'Helios', 'Io', 'Janus', 'Keid',
    'Laomedeia', 'Maia', 'Narvi', 'Oberon', 'Pandora',
    'Quasar', 'Rastaban', 'Sadachbia', 'Talos', 'Umbriel'
  ];

  // Per-story config map and active story id
  let storySettingsMap = {};
  let currentStoryId = '';

  // Reading progress map (URL -> { chunkIndex, totalChunks, savedAt })
  let readingProgressMap = {};

  // ---- Site Parser Registry ----
  // Each entry supports:
  //   contentSelectors: list of CSS selectors tried in order for chapter text
  //   nextChapSelectors: list of CSS selectors tried in order for next chapter link
  // To add a new site, just add a new hostname key below.
  const SITE_PARSERS = {
    'truyenfull.vision': {
      contentSelectors: ['#chapter-c'],
      nextChapSelectors: ['#next_chap', 'a[title*="Chương tiếp"]'],
    },
    'tangthuvien.net': {
      contentSelectors: ['div.chapter-c', '#bookContentBody', '.content-chapter'],
      nextChapSelectors: ['a.btn-chapter-next', 'a[title*="Chương tiếp"]', '.next-chap'],
    },
  };

  // Returns the parser config for the current hostname, or null if unsupported
  function detectParser() {
    const hostname = window.location.hostname.replace(/^www\./, '');
    return SITE_PARSERS[hostname] || null;
  }

  // Helper to extract story slug from URL
  // e.g. "https://truyenfull.vision/pham-nhan-tu-tien/chuong-1/" -> "pham-nhan-tu-tien"
  function getStoryIdFromUrl() {
    const parts = window.location.pathname.split('/').filter(p => p.trim() !== '');
    if (parts.length > 0) {
      return parts[0];
    }
    return '';
  }

  // Helper to find the next chapter URL using site-specific selectors
  function findNextChapterUrl() {
    const parser = detectParser();
    const selectors = parser ? parser.nextChapSelectors : ['#next_chap', 'a[title*="Ch\u01b0\u01a1ng ti\u1ebfp"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.href && !el.classList.contains('disabled')) {
        return el.href;
      }
    }
    return null;
  }

  // ---- Load/Save settings ----
  function loadSettings(callback) {
    currentStoryId = getStoryIdFromUrl();

    chrome.storage.local.get(['ttsSettings', 'storySettingsMap', 'readingProgressMap'], (result) => {
      if (result.readingProgressMap) {
        readingProgressMap = result.readingProgressMap;
      }

      if (result.ttsSettings) {
        // Load global settings
        ttsSettings.geminiApiKeys = result.ttsSettings.geminiApiKeys || ttsSettings.geminiApiKeys;
        ttsSettings.geminiActiveKeyIndex = result.ttsSettings.geminiActiveKeyIndex ?? ttsSettings.geminiActiveKeyIndex;
        ttsSettings.geminiApiKey = result.ttsSettings.geminiApiKey || '';
        ttsSettings.theme = result.ttsSettings.theme || ttsSettings.theme;
        ttsSettings.isMiniMode = result.ttsSettings.isMiniMode ?? ttsSettings.isMiniMode;

        // Migrate legacy single key to array
        if (ttsSettings.geminiApiKey && (!ttsSettings.geminiApiKeys || ttsSettings.geminiApiKeys.length === 0)) {
          ttsSettings.geminiApiKeys = [ttsSettings.geminiApiKey];
          ttsSettings.geminiApiKey = '';
          saveSettings();
        }

        // Keep local fallback defaults for engine/voice options in case it's a new story
        ttsSettings.rate = result.ttsSettings.rate ?? ttsSettings.rate;
        ttsSettings.pitch = result.ttsSettings.pitch ?? ttsSettings.pitch;
        ttsSettings.voiceName = result.ttsSettings.voiceName || ttsSettings.voiceName;
        ttsSettings.engine = result.ttsSettings.engine || ttsSettings.engine;
        ttsSettings.geminiVoice = result.ttsSettings.geminiVoice || ttsSettings.geminiVoice;
        ttsSettings.autoNextChapter = result.ttsSettings.autoNextChapter ?? ttsSettings.autoNextChapter;

        // Load background music settings
        if (result.ttsSettings.bgMusic) {
          ttsSettings.bgMusic = {
            ...ttsSettings.bgMusic,
            ...result.ttsSettings.bgMusic
          };
        }
      }

      if (result.storySettingsMap) {
        storySettingsMap = result.storySettingsMap;
        
        // If specific settings exist for this story, override the local fallback state
        if (storySettingsMap[currentStoryId]) {
          const s = storySettingsMap[currentStoryId];
          ttsSettings.engine = s.engine || ttsSettings.engine;
          ttsSettings.voiceName = s.voiceName || ttsSettings.voiceName;
          ttsSettings.geminiVoice = s.geminiVoice || ttsSettings.geminiVoice;
          ttsSettings.rate = s.rate ?? ttsSettings.rate;
          ttsSettings.pitch = s.pitch ?? ttsSettings.pitch;
        }
      }

      if (callback) callback();
    });
  }

  function saveSettings() {
    // Save to the memory map
    storySettingsMap[currentStoryId] = {
      engine: ttsSettings.engine,
      voiceName: ttsSettings.voiceName,
      geminiVoice: ttsSettings.geminiVoice,
      rate: ttsSettings.rate,
      pitch: ttsSettings.pitch
    };

    // Save global settings and the updated map to Chrome storage
    chrome.storage.local.set({ 
      ttsSettings: {
        geminiApiKeys: ttsSettings.geminiApiKeys,
        geminiActiveKeyIndex: ttsSettings.geminiActiveKeyIndex,
        theme: ttsSettings.theme,
        isMiniMode: ttsSettings.isMiniMode,
        autoNextChapter: ttsSettings.autoNextChapter,
        bgMusic: ttsSettings.bgMusic,
        // Legacy fallbacks
        rate: ttsSettings.rate,
        pitch: ttsSettings.pitch,
        voiceName: ttsSettings.voiceName,
        engine: ttsSettings.engine,
        geminiVoice: ttsSettings.geminiVoice
      },
      storySettingsMap: storySettingsMap
    });
  }

  // ---- Reading Progress ----
  function saveReadingProgress(chunkIndex, totalChunks) {
    const url = window.location.href.split('#')[0]; // ignore hash
    readingProgressMap[url] = {
      chunkIndex,
      totalChunks,
      savedAt: Date.now()
    };
    chrome.storage.local.set({ readingProgressMap });
  }

  function clearReadingProgress() {
    const url = window.location.href.split('#')[0];
    if (readingProgressMap[url]) {
      delete readingProgressMap[url];
      chrome.storage.local.set({ readingProgressMap });
    }
  }

  // ---- Error Popup Logic ----
  function showErrorPopup(message) {
    // IMPORTANT: Stop any ongoing Gemini playback to prevent dual-audio on error
    stopGeminiPlayback();
    isSpeaking = false;
    isPaused = false;
    updateButtons();
    if (!els || !els.errorPopup || !els.errorMsg) return;
    els.errorMsg.textContent = message;
    els.errorPopup.style.display = 'flex';
  }

  function hideErrorPopup() {
    if (!els || !els.errorPopup) return;
    els.errorPopup.style.display = 'none';
  }

  // ---- Gemini Audio Playback ----
  let geminiMediaElement = null;
  let geminiMediaSourceNode = null;
  let geminiMediaObjectURL = null;

  function getAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 64; // Small size for simple 32-bar visualizer
      analyser.connect(audioContext.destination);
    }
    return audioContext;
  }

  function createWavBlob(int16Array, sampleRate) {
    const buffer = new ArrayBuffer(44 + int16Array.byteLength);
    const view = new DataView(buffer);
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + int16Array.byteLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, int16Array.byteLength, true);
    new Uint8Array(buffer, 44).set(new Uint8Array(int16Array.buffer));
    return new Blob([view], { type: 'audio/wav' });
  }

  function playBase64Pcm(base64Data) {
    return new Promise((resolve, reject) => {
      if (geminiStopped) { resolve(); return; }

      try {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();

        const binaryStr = atob(base64Data);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const int16 = new Int16Array(bytes.buffer);
        const blob = createWavBlob(int16, 24000);
        
        if (geminiMediaObjectURL) {
          URL.revokeObjectURL(geminiMediaObjectURL);
        }
        geminiMediaObjectURL = URL.createObjectURL(blob);

        if (!geminiMediaElement) {
          geminiMediaElement = new Audio();
          geminiMediaElement.preservesPitch = true;
          geminiMediaSourceNode = ctx.createMediaElementSource(geminiMediaElement);
          geminiMediaSourceNode.connect(analyser); // Connect to analyser instead of destination
        }

        geminiMediaElement.src = geminiMediaObjectURL;
        geminiMediaElement.playbackRate = ttsSettings.rate || 1.0;
        
        geminiMediaElement.onended = () => {
          currentSource = null;
          resolve();
        };

        geminiMediaElement.onerror = (e) => {
          currentSource = null;
          reject(e);
        };

        currentSource = geminiMediaElement; // Used by other parts
        geminiMediaElement.play().catch(reject);
        
      } catch (err) {
        reject(err);
      }
    });
  }

  // ---- Visualizer Logic ----
  function startVisualizer() {
    if (!els || !els.visualizerCanvas) return;
    // Ensure the AudioContext and analyser are initialized before drawing
    getAudioContext();
    if (!analyser) return;
    els.visualizerCanvas.style.display = 'block';

    const canvas = els.visualizerCanvas;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // We only need about half of the fftSize data for a good look
    const bufferLength = analyser.frequencyBinCount; 
    const dataArray = new Uint8Array(bufferLength);
    
    const barWidth = 3;
    const barGap = 1;
    const barsCount = Math.floor(width / (barWidth + barGap));

    function draw() {
      if (!isPlayingGemini || isPaused) {
        animationFrameId = null;
        return;
      }
      animationFrameId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, width, height);

      // determine color based on theme
      const isLight = ttsSettings.theme === 'light' || 
                      (ttsSettings.theme === 'system' && !window.matchMedia('(prefers-color-scheme: dark)').matches);
      
      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      if (isLight) {
        gradient.addColorStop(0, '#34a853'); // green
        gradient.addColorStop(1, '#4285f4'); // blue
      } else {
        gradient.addColorStop(0, '#4285f4'); // blue
        gradient.addColorStop(1, '#a8c7fa'); // light blue
      }

      ctx.fillStyle = gradient;

      for (let i = 0; i < barsCount; i++) {
        // map index to frequency data
        const dataIndex = Math.floor(i * (bufferLength / barsCount));
        const value = dataArray[dataIndex];
        
        // map 0-255 to canvas height
        const percent = value / 255;
        const barHeight = Math.max(2, percent * height); // min 2px height
        
        const x = i * (barWidth + barGap);
        const y = height - barHeight;
        
        // Draw with rounded top
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
        ctx.fill();
      }
    }
    
    if (!animationFrameId) {
      draw();
    }
  }

  function stopVisualizer() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (els && els.visualizerCanvas) {
      const ctx = els.visualizerCanvas.getContext('2d');
      ctx.clearRect(0, 0, els.visualizerCanvas.width, els.visualizerCanvas.height);
      els.visualizerCanvas.style.display = 'none';
    }
  }

  // ---- Progress UI ----
  function updateProgressBar(pct) {
    if (!els || !els.progressWrap || !els.progressBar) return;
    els.progressWrap.style.display = 'block';
    els.progressBar.style.width = Math.min(100, Math.max(0, pct)) + '%';
  }

  function hideProgressBar() {
    if (els && els.progressWrap) {
      els.progressWrap.style.display = 'none';
      els.progressBar.style.width = '0%';
    }
    stopVisualizer(); // ensure visualizer hides when progress bar hides
  }

  async function processAudioQueue() {
    if (isPlayingGemini) return;
    isPlayingGemini = true;

    startVisualizer();

    while (!geminiStopped) {
      if (audioQueue.length > 0) {
        const chunk = audioQueue.shift();
        geminiPlayedChunks++;

        if (els) {
          const pct = Math.round((geminiPlayedChunks / geminiTotalChunks) * 100);
          updateProgressBar(pct);
          els.status.textContent = `Đang đọc phần ${geminiPlayedChunks}/${geminiTotalChunks}...`;
        }

        await playBase64Pcm(chunk.audioData);
        saveReadingProgress(geminiPlayedChunks, geminiTotalChunks);
      } else if (geminiAllChunksReceived) {
        break;
      } else {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    isPlayingGemini = false;
    stopVisualizer();

    if (!geminiStopped && ttsSettings.engine === 'gemini') {
      stopBgMusic();
      isSpeaking = false;
      isPaused = false;
      clearReadingProgress(); // Clear when finished naturally
      if (els) {
        updateButtons(els);
        updateProgressBar(100);
        setTimeout(() => hideProgressBar(), 1500);
        els.status.textContent = 'Đã đọc xong.';
      }
      checkAutoNextChapter();
    }
  }

  function checkAutoNextChapter() {
    if (!ttsSettings.autoNextChapter) return;
    const nextUrl = findNextChapterUrl();
    if (!nextUrl) return;

    let countdown = 5;
    if (els) els.status.textContent = `Chuyển chương sau ${countdown}s...`;

    autoNextTimerId = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(autoNextTimerId);
        autoNextTimerId = null;
        if (els) els.status.textContent = 'Đang chuyển trang...';
        window.location.href = nextUrl;
      } else {
        if (els) els.status.textContent = `Chuyển chương sau ${countdown}s...`;
      }
    }, 1000);
  }

  // ---- Download Audio Logic ----
  function startDownloadGeminiAudio() {
    if (!currentText) {
      if (els) els.status.textContent = 'Chưa có nội dung để tải.';
      return;
    }
    if (!ttsSettings.geminiApiKeys || ttsSettings.geminiApiKeys.length === 0) {
      if (els) els.status.textContent = 'Vui lòng thêm API Key Gemini trước.';
      return;
    }

    // Reset download state
    isDownloadingAudio = true;
    downloadChunks = [];

    if (els) {
      els.downloadBtn.disabled = true;
      els.downloadBtn.innerHTML = '…';
      els.status.textContent = 'Đang chuẩn bị tải audio...';
      updateProgressBar(0);
    }

    chrome.runtime.sendMessage({
      action: 'gemini-tts-speak',
      text: currentText,
      apiKeys: ttsSettings.geminiApiKeys,
      activeKeyIndex: ttsSettings.geminiActiveKeyIndex || 0,
      geminiVoice: ttsSettings.geminiVoice,
      startChunkIndex: 0
    }, (resp) => {
      if (!isDownloadingAudio) return; // was cancelled
      if (resp && !resp.success && resp.error) {
        isDownloadingAudio = false;
        downloadChunks = [];
        if (els) {
          els.downloadBtn.disabled = false;
          els.downloadBtn.innerHTML = '⤓';
          els.status.textContent = 'Lỗi tải audio: ' + resp.error;
          hideProgressBar();
        }
      }
    });
  }

  function finishDownloadAudio() {
    if (!isDownloadingAudio || downloadChunks.length === 0) return;

    try {
      // Sort by chunk order just in case
      downloadChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

      // Decode each base64 chunk into Int16Array
      const int16Arrays = downloadChunks.map(c => {
        const binaryStr = atob(c.audioData);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        return new Int16Array(bytes.buffer);
      });

      // Merge all Int16Arrays into one
      const totalLength = int16Arrays.reduce((sum, arr) => sum + arr.length, 0);
      const merged = new Int16Array(totalLength);
      let offset = 0;
      for (const arr of int16Arrays) {
        merged.set(arr, offset);
        offset += arr.length;
      }

      // Build WAV blob using existing helper
      const wavBlob = createWavBlob(merged, 24000);
      const url = URL.createObjectURL(wavBlob);

      // Derive filename from page title
      const title = document.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'audio';
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      if (els) els.status.textContent = '✅ Đã tải xuống thành công!';
    } catch (err) {
      if (els) els.status.textContent = 'Lỗi tạo file WAV: ' + err.message;
    } finally {
      isDownloadingAudio = false;
      downloadChunks = [];
      if (els) {
        els.downloadBtn.disabled = false;
        els.downloadBtn.innerHTML = '⤓';
        hideProgressBar();
      }
    }
  }

  function cancelDownloadAudio() {
    isDownloadingAudio = false;
    downloadChunks = [];
    if (els) {
      els.downloadBtn.disabled = false;
      els.downloadBtn.innerHTML = '⤓';
      hideProgressBar();
      els.status.textContent = 'Đã huỷ tải audio.';
    }
  }

  function stopGeminiPlayback() {
    geminiStopped = true;
    audioQueue = [];
    geminiAllChunksReceived = true;
    if (currentSource) {
      try {
        if (typeof currentSource.stop === 'function') {
          currentSource.stop();
        } else if (typeof currentSource.pause === 'function') {
          currentSource.pause();
          currentSource.src = '';
        }
      } catch (e) { }
      currentSource = null;
    }
    isPlayingGemini = false;
    isPaused = false;
    hideProgressBar();
    stopVisualizer();
    if (autoNextTimerId) {
      clearInterval(autoNextTimerId);
      autoNextTimerId = null;
    }
  }

  function pauseGeminiPlayback() {
    const ctx = getAudioContext();
    if (ctx.state === 'running') {
      ctx.suspend();
    }
    if (currentSource && typeof currentSource.pause === 'function') {
      currentSource.pause();
    }
    stopVisualizer();
  }

  function resumeGeminiPlayback() {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    if (currentSource && typeof currentSource.play === 'function' && currentSource.paused) {
      currentSource.playbackRate = ttsSettings.rate || 1.0;
      currentSource.play().catch(e => console.error(e));
    }
    if (isPlayingGemini) {
      startVisualizer();
    }
  }

  // ---- Sleep Timer Logic ----
  function setSleepTimer(minutes) {
    cancelSleepTimer();
    const ms = minutes * 60 * 1000;
    sleepTimerEndTime = Date.now() + ms;
    sleepTimerId = setTimeout(() => {
      // Auto-stop when timer fires
      if (isSpeaking) {
        stopBgMusic();
        if (ttsSettings.engine === 'gemini') stopGeminiPlayback();
        chrome.runtime.sendMessage({ action: 'tts-stop' });
        isSpeaking = false;
        isPaused = false;
        updateButtons();
      }
      cancelSleepTimer();
      if (els) els.status.textContent = '⏱ Đã tự động tắt.';
    }, ms);
    startSleepCountdown();
    updateSleepTimerUI();
  }

  function cancelSleepTimer() {
    if (sleepTimerId) { clearTimeout(sleepTimerId); sleepTimerId = null; }
    if (sleepCountdownId) { clearInterval(sleepCountdownId); sleepCountdownId = null; }
    sleepTimerEndTime = null;
    updateSleepTimerUI();
  }

  function startSleepCountdown() {
    sleepCountdownId = setInterval(() => {
      if (!sleepTimerEndTime) { clearInterval(sleepCountdownId); return; }
      const remaining = sleepTimerEndTime - Date.now();
      if (remaining <= 0) { clearInterval(sleepCountdownId); return; }
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      const label = `${mins}:${String(secs).padStart(2, '0')}`;
      const statusEl = document.getElementById('sts-sleep-status');
      if (statusEl) statusEl.textContent = `⏱ Tắt sau ${label}`;
    }, 1000);
  }

  function updateSleepTimerUI() {
    const statusEl = document.getElementById('sts-sleep-status');
    const btns = document.querySelectorAll('.sts-sleep-btn');
    if (!sleepTimerEndTime) {
      if (statusEl) statusEl.textContent = '';
      btns.forEach(b => b.classList.remove('sts-active'));
    }
  }

  // ---- Background Music Logic ----
  function createWhiteNoiseBuffer(ctx, durationSec) {
    const bufferSize = ctx.sampleRate * durationSec;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  function createBrownNoiseBuffer(ctx, durationSec) {
    const bufferSize = ctx.sampleRate * durationSec;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5; // compensate for gain drop
    }
    return buffer;
  }

  function startBgMusic() {
    if (!ttsSettings.bgMusic.enabled) return;
    
    stopBgMusic(); // Clean up previous
    
    // For custom URL, use HTMLAudioElement
    if (ttsSettings.bgMusic.track === 'custom') {
      if (!ttsSettings.bgMusic.customUrl) return;
      bgMusicCustomAudio = new Audio(ttsSettings.bgMusic.customUrl);
      bgMusicCustomAudio.loop = true;
      bgMusicCustomAudio.volume = ttsSettings.bgMusic.volume;
      bgMusicCustomAudio.play().catch(e => console.log("Lỗi phát nhạc nền:", e));
      return;
    }
    
    // Web Audio API for synthetic ambient sounds
    bgMusicContext = new (window.AudioContext || window.webkitAudioContext)();
    bgMusicGainNode = bgMusicContext.createGain();
    
    // Prevent immediate pop by starting gain slightly lower or just assigning value
    bgMusicGainNode.gain.setValueAtTime(ttsSettings.bgMusic.volume, bgMusicContext.currentTime);
    bgMusicGainNode.connect(bgMusicContext.destination);

    bgMusicSource = bgMusicContext.createBufferSource();
    bgMusicSource.loop = true;
    
    if (ttsSettings.bgMusic.track === 'whitenoise') {
      bgMusicSource.buffer = createWhiteNoiseBuffer(bgMusicContext, 5); 
      bgMusicSource.connect(bgMusicGainNode);
    } else if (ttsSettings.bgMusic.track === 'brownnoise') {
      bgMusicSource.buffer = createBrownNoiseBuffer(bgMusicContext, 5);
      bgMusicSource.connect(bgMusicGainNode);
    } else if (ttsSettings.bgMusic.track === 'rain') {
      bgMusicSource.buffer = createWhiteNoiseBuffer(bgMusicContext, 5);
      
      const lowpass = bgMusicContext.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 800; // Muffled 

      // LFO for rain intensity variation
      const lfo = bgMusicContext.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.5; // Hz
      
      const lfoGain = bgMusicContext.createGain();
      lfoGain.gain.value = 200; 
      
      lfo.connect(lfoGain);
      lfoGain.connect(lowpass.frequency);
      lfo.start();

      bgMusicSource.connect(lowpass);
      lowpass.connect(bgMusicGainNode);
    }
    
    bgMusicSource.start();
  }

  function stopBgMusic() {
    if (bgMusicSource) {
      try { bgMusicSource.stop(); } catch(e) {}
      bgMusicSource.disconnect();
      bgMusicSource = null;
    }
    if (bgMusicContext) {
      bgMusicContext.close();
      bgMusicContext = null;
    }
    if (bgMusicCustomAudio) {
      bgMusicCustomAudio.pause();
      bgMusicCustomAudio.src = '';
      bgMusicCustomAudio = null;
    }
    bgMusicGainNode = null;
  }

  function setBgMusicVolume(v) {
    ttsSettings.bgMusic.volume = v;
    if (bgMusicGainNode && bgMusicContext) {
      bgMusicGainNode.gain.linearRampToValueAtTime(v, bgMusicContext.currentTime + 0.1);
    }
    if (bgMusicCustomAudio) {
      bgMusicCustomAudio.volume = v;
    }
  }

  // Ducking effect: temporarily lower volume
  function duckBgMusic(isDucked) {
    if (!ttsSettings.bgMusic.enabled) return;
    const targetVol = isDucked ? (ttsSettings.bgMusic.volume * 0.3) : ttsSettings.bgMusic.volume;
    
    if (bgMusicGainNode && bgMusicContext) {
      bgMusicGainNode.gain.linearRampToValueAtTime(targetVol, bgMusicContext.currentTime + 0.5);
    }
    if (bgMusicCustomAudio) {
      bgMusicCustomAudio.volume = targetVol;
    }
  }

  // ---- Theme Logic ----
  function applyTheme() {
    if (!els || !els.card) return;
    let isLight = false;

    if (ttsSettings.theme === 'light') {
      isLight = true;
    } else if (ttsSettings.theme === 'dark') {
      isLight = false;
    } else {
      // system
      isLight = !window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    if (isLight) {
      els.card.classList.add('sts-light-theme');
    } else {
      els.card.classList.remove('sts-light-theme');
    }

    if (ttsSettings.isMiniMode) {
      els.card.classList.add('sts-mini');
      if (els.miniBtn) els.miniBtn.innerHTML = '⛶'; // Expand icon
      if (els.settingsBody) els.settingsBody.classList.remove('sts-open');
      if (els.settingsToggle) els.settingsToggle.classList.remove('sts-open');
      settingsOpen = false;
    } else {
      els.card.classList.remove('sts-mini');
      if (els.miniBtn) els.miniBtn.innerHTML = '—'; // Minimize icon
    }

    updateThemeUI();
  }

  function updateThemeUI() {
    if (!els) return;
    const btns = document.querySelectorAll('.sts-theme-btn');
    btns.forEach(b => {
      if (b.dataset.theme === ttsSettings.theme) {
        b.classList.add('sts-active');
      } else {
        b.classList.remove('sts-active');
      }
    });
  }

  // Listen to OS theme changes if set to system
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (ttsSettings.theme === 'system') {
      applyTheme();
    }
  });

  // ---- Build New UI ----
  function createUI() {
    const container = document.createElement('div');
    container.id = 'sts-floating-container';

    const card = document.createElement('div');
    card.className = 'sts-card';

    // 1. Header
    const header = document.createElement('div');
    header.className = 'sts-header';

    const title = document.createElement('div');
    title.className = 'sts-title';
    title.innerHTML = '<span class="sts-title-icon">🎧</span> Đọc Truyện Speech';

    const engineToggle = document.createElement('div');
    engineToggle.className = 'sts-engine-toggle';

    const btnChrome = document.createElement('button');
    btnChrome.className = 'sts-engine-btn ' + (ttsSettings.engine === 'chrome' ? 'sts-active' : '');
    btnChrome.textContent = 'Chrome';
    btnChrome.dataset.engine = 'chrome';

    const btnGemini = document.createElement('button');
    btnGemini.className = 'sts-engine-btn ' + (ttsSettings.engine === 'gemini' ? 'sts-active' : '');
    btnGemini.textContent = 'Gemini';
    btnGemini.dataset.engine = 'gemini';

    engineToggle.append(btnChrome, btnGemini);

    const miniBtn = document.createElement('button');
    miniBtn.className = 'sts-mini-btn';
    miniBtn.innerHTML = ttsSettings.isMiniMode ? '⛶' : '—';
    miniBtn.title = 'Thu nhỏ / Phóng to';

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'sts-settings-btn';
    settingsBtn.innerHTML = '⚙';
    settingsBtn.title = 'Cài đặt âm thanh';

    header.append(title, engineToggle, settingsBtn, miniBtn);

    // 2. Main Playback Controls
    const controlsSection = document.createElement('div');
    controlsSection.className = 'sts-controls-section';

    const btnRow = document.createElement('div');
    btnRow.className = 'sts-btn-row';

    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'sts-btn-icon';
    reloadBtn.innerHTML = '⟲';
    reloadBtn.title = 'Tải lại nội dung';

    const playBtn = document.createElement('button');
    playBtn.className = 'sts-btn-primary';
    playBtn.innerHTML = '▶';
    playBtn.title = 'Đọc (Play/Resume)';

    const stopBtn = document.createElement('button');
    stopBtn.className = 'sts-btn-icon';
    stopBtn.innerHTML = '⏹';
    stopBtn.title = 'Dừng (Stop)';
    stopBtn.disabled = true;

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'sts-btn-icon sts-btn-download';
    downloadBtn.innerHTML = '⤓';
    downloadBtn.title = 'Tải audio xuống (WAV)';
    downloadBtn.disabled = true;

    btnRow.append(reloadBtn, playBtn, stopBtn, downloadBtn);

    const statusWrap = document.createElement('div');
    statusWrap.className = 'sts-status-wrap';

    const statusText = document.createElement('div');
    statusText.id = 'sts-status';
    statusText.textContent = 'Sẵn sàng';

    const progressWrap = document.createElement('div');
    progressWrap.id = 'sts-progress-container';
    const progressBar = document.createElement('div');
    progressBar.id = 'sts-progress-bar';
    progressWrap.appendChild(progressBar);

    const visualizerCanvas = document.createElement('canvas');
    visualizerCanvas.className = 'sts-visualizer';
    visualizerCanvas.width = 120;
    visualizerCanvas.height = 24;

    statusWrap.append(statusText, visualizerCanvas, progressWrap);
    controlsSection.append(btnRow, statusWrap);

    // Resume Banner
    const resumeBanner = document.createElement('div');
    resumeBanner.id = 'sts-resume-banner';
    resumeBanner.className = 'sts-resume-banner';
    resumeBanner.style.display = 'none';

    const resumeText = document.createElement('div');
    resumeText.className = 'sts-resume-text';
    
    const resumeBtnRow = document.createElement('div');
    resumeBtnRow.className = 'sts-resume-btn-row';
    const resumeYesBtn = document.createElement('button');
    resumeYesBtn.className = 'sts-resume-btn sts-resume-yes';
    resumeYesBtn.textContent = 'Đọc tiếp';
    const resumeNoBtn = document.createElement('button');
    resumeNoBtn.className = 'sts-resume-btn sts-resume-no';
    resumeNoBtn.textContent = 'Bỏ qua';
    resumeBtnRow.append(resumeYesBtn, resumeNoBtn);

    resumeBanner.append(resumeText, resumeBtnRow);

    // 3. Settings Popup (detached from card)
    const settingsOverlay = document.createElement('div');
    settingsOverlay.id = 'sts-settings-overlay';
    settingsOverlay.style.display = 'none';

    const settingsModal = document.createElement('div');
    settingsModal.className = 'sts-settings-modal';

    const settingsModalHeader = document.createElement('div');
    settingsModalHeader.className = 'sts-settings-modal-header';
    const settingsModalTitle = document.createElement('span');
    settingsModalTitle.textContent = 'Cài đặt âm thanh';
    const settingsCloseBtn = document.createElement('button');
    settingsCloseBtn.className = 'sts-settings-close-btn';
    settingsCloseBtn.innerHTML = '✕';
    settingsCloseBtn.title = 'Đóng';
    settingsModalHeader.append(settingsModalTitle, settingsCloseBtn);

    const settingsBody = createSettingsBody();
    settingsBody.className = 'sts-settings-body sts-open';

    settingsModal.append(settingsModalHeader, settingsBody);
    settingsOverlay.appendChild(settingsModal);

    // Error Popup Overlay
    const errorPopup = document.createElement('div');
    errorPopup.id = 'sts-error-popup';
    errorPopup.className = 'sts-error-popup';
    errorPopup.style.display = 'none';

    const errorMsg = document.createElement('div');
    errorMsg.className = 'sts-error-msg';

    const errorCloseBtn = document.createElement('button');
    errorCloseBtn.className = 'sts-error-close';
    errorCloseBtn.textContent = 'Đóng';
    errorCloseBtn.addEventListener('click', () => {
      hideErrorPopup();
    });

    errorPopup.append(errorMsg, errorCloseBtn);

    card.append(header, controlsSection, resumeBanner, errorPopup);
    container.append(card, settingsOverlay);
    document.body.appendChild(container);

    // Return elements reference
    return {
      card,
      miniBtn,
      settingsBtn,
      btnChrome,
      btnGemini,
      playBtn,
      stopBtn,
      reloadBtn,
      downloadBtn,
      status: statusText,
      progressWrap,
      progressBar,
      visualizerCanvas,
      resumeBanner,
      resumeText,
      resumeYesBtn,
      resumeNoBtn,
      settingsOverlay,
      settingsCloseBtn,
      settingsBody,
      errorPopup,
      errorMsg
    };
  }

  function createSettingsBody() {
    const body = document.createElement('div');
    body.className = 'sts-settings-body sts-open';

    // ---- Tab Bar ----
    const tabBar = document.createElement('div');
    tabBar.className = 'sts-tab-bar';

    const tabs = [
      { id: 'voice', label: '🎙 Giọng đọc' },
      { id: 'music', label: '🎵 Nhạc nền' },
      { id: 'general', label: '⚙ Chung' },
    ];

    const panels = {};

    tabs.forEach(tab => {
      const btn = document.createElement('button');
      btn.className = 'sts-tab-btn';
      btn.dataset.tab = tab.id;
      btn.textContent = tab.label;
      tabBar.appendChild(btn);

      const panel = document.createElement('div');
      panel.className = 'sts-tab-panel';
      panel.dataset.panel = tab.id;
      panel.style.display = 'none';
      panels[tab.id] = panel;
    });

    function switchTab(tabId) {
      tabBar.querySelectorAll('.sts-tab-btn').forEach(b => b.classList.toggle('sts-tab-active', b.dataset.tab === tabId));
      Object.entries(panels).forEach(([id, panel]) => {
        panel.style.display = id === tabId ? 'block' : 'none';
      });
    }

    tabBar.addEventListener('click', e => {
      if (e.target.classList.contains('sts-tab-btn')) switchTab(e.target.dataset.tab);
    });

    body.appendChild(tabBar);
    Object.values(panels).forEach(p => body.appendChild(p));

    // ==========================================
    // TAB 1: GIỌNG ĐỌC
    // ==========================================
    const voicePanel = panels['voice'];

    // Hint
    const hintText = document.createElement('div');
    hintText.className = 'sts-settings-hint';
    hintText.textContent = '* Tốc độ, Giọng và Engine được lưu riêng cho từng truyện.';
    voicePanel.appendChild(hintText);

    // Tốc độ (shared)
    const rateRow = createSliderRow('Tốc độ', 'sts-rate-slider', 'sts-rate-value', 0.5, 3.0, 0.1, ttsSettings.rate, (v) => {
      ttsSettings.rate = v;
      saveSettings();
      if (ttsSettings.engine === 'gemini' && currentSource && typeof currentSource.playbackRate !== 'undefined') {
        currentSource.playbackRate = v;
      }
    });
    voicePanel.appendChild(rateRow);

    // Chrome Section
    const chromeSection = document.createElement('div');
    chromeSection.id = 'sts-chrome-section';
    chromeSection.style.display = ttsSettings.engine === 'chrome' ? 'block' : 'none';

    const chromeDivider = document.createElement('div');
    chromeDivider.className = 'sts-section-divider';
    chromeDivider.textContent = 'Chrome TTS';
    chromeSection.appendChild(chromeDivider);

    const pitchRow = createSliderRow('Tông giọng', 'sts-pitch-slider', 'sts-pitch-value', 0.0, 2.0, 0.1, ttsSettings.pitch, (v) => { ttsSettings.pitch = v; saveSettings(); });

    const voiceRow = document.createElement('div');
    voiceRow.className = 'sts-setting-row';
    voiceRow.innerHTML = `<div class="sts-setting-label">Giọng đọc</div>`;
    const voiceSelect = document.createElement('select');
    voiceSelect.id = 'sts-voice-select';
    voiceSelect.innerHTML = `<option value="">Mặc định hệ thống</option>`;
    voiceSelect.addEventListener('change', () => { ttsSettings.voiceName = voiceSelect.value; saveSettings(); });
    voiceRow.appendChild(voiceSelect);
    chromeSection.append(pitchRow, voiceRow);
    voicePanel.appendChild(chromeSection);

    // Gemini Section
    const geminiSection = document.createElement('div');
    geminiSection.id = 'sts-gemini-section';
    geminiSection.style.display = ttsSettings.engine === 'gemini' ? 'block' : 'none';

    const geminiDivider = document.createElement('div');
    geminiDivider.className = 'sts-section-divider';
    geminiDivider.textContent = 'Gemini AI';
    geminiSection.appendChild(geminiDivider);

    // API Key Manager
    const keyManagerRow = document.createElement('div');
    keyManagerRow.className = 'sts-setting-row';
    keyManagerRow.innerHTML = `<div class="sts-setting-label">API Keys <span class="sts-setting-value" id="sts-key-count">${ttsSettings.geminiApiKeys.length}</span></div>`;

    const keyList = document.createElement('div');
    keyList.id = 'sts-key-list';
    keyList.className = 'sts-key-list';

    function renderKeyList() {
      keyList.innerHTML = '';
      const countEl = document.getElementById('sts-key-count');
      if (countEl) countEl.textContent = ttsSettings.geminiApiKeys.length;

      ttsSettings.geminiApiKeys.forEach((key, idx) => {
        const item = document.createElement('div');
        item.className = 'sts-key-item';
        if (idx === ttsSettings.geminiActiveKeyIndex) item.classList.add('sts-key-active');

        const label = document.createElement('span');
        label.className = 'sts-key-label';
        label.textContent = `Key ${idx + 1}`;

        const masked = document.createElement('span');
        masked.className = 'sts-key-masked';
        masked.textContent = key.slice(0, 6) + '••••' + key.slice(-4);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'sts-key-remove';
        removeBtn.textContent = '✕';
        removeBtn.title = 'Xoá key này';
        removeBtn.addEventListener('click', () => {
          ttsSettings.geminiApiKeys.splice(idx, 1);
          if (ttsSettings.geminiActiveKeyIndex >= ttsSettings.geminiApiKeys.length) {
            ttsSettings.geminiActiveKeyIndex = Math.max(0, ttsSettings.geminiApiKeys.length - 1);
          }
          saveSettings();
          renderKeyList();
        });

        item.append(label, masked, removeBtn);
        item.addEventListener('click', (e) => {
          if (e.target === removeBtn) return;
          ttsSettings.geminiActiveKeyIndex = idx;
          saveSettings();
          renderKeyList();
        });
        keyList.appendChild(item);
      });

      if (ttsSettings.geminiApiKeys.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sts-key-empty';
        empty.textContent = 'Chưa có API Key nào.';
        keyList.appendChild(empty);
      }
    }

    const addKeyWrap = document.createElement('div');
    addKeyWrap.className = 'sts-apikey-wrap';
    const addKeyInput = document.createElement('input');
    addKeyInput.type = 'password';
    addKeyInput.className = 'sts-text-input';
    addKeyInput.placeholder = 'Dán API Key mới...';
    const addKeyBtn = document.createElement('button');
    addKeyBtn.className = 'sts-apikey-toggle';
    addKeyBtn.textContent = '＋';
    addKeyBtn.title = 'Thêm key';
    addKeyBtn.addEventListener('click', () => {
      const val = addKeyInput.value.trim();
      if (!val) return;
      if (ttsSettings.geminiApiKeys.includes(val)) { addKeyInput.value = ''; return; }
      ttsSettings.geminiApiKeys.push(val);
      addKeyInput.value = '';
      saveSettings();
      renderKeyList();
    });
    addKeyWrap.append(addKeyInput, addKeyBtn);
    keyManagerRow.append(keyList, addKeyWrap);
    renderKeyList();

    // Gemini Voice
    const gVoiceRow = document.createElement('div');
    gVoiceRow.className = 'sts-setting-row';
    gVoiceRow.innerHTML = `<div class="sts-setting-label">Giọng Gemini</div>`;
    const gVoiceSelect = document.createElement('select');
    gVoiceSelect.id = 'sts-gemini-voice-select';
    GEMINI_VOICES.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      if (v === ttsSettings.geminiVoice) opt.selected = true;
      gVoiceSelect.appendChild(opt);
    });
    gVoiceSelect.addEventListener('change', () => { ttsSettings.geminiVoice = gVoiceSelect.value; saveSettings(); });
    gVoiceRow.appendChild(gVoiceSelect);

    geminiSection.append(keyManagerRow, gVoiceRow);
    voicePanel.appendChild(geminiSection);

    // Async load Chrome voices
    chrome.runtime.sendMessage({ action: 'tts-getVoices' }, (response) => {
      if (!response || !response.voices) return;
      response.voices.forEach((voice) => {
        const opt = document.createElement('option');
        opt.value = voice.voiceName;
        opt.textContent = `${voice.voiceName} (${voice.lang || '?'})`;
        if (voice.voiceName === ttsSettings.voiceName) opt.selected = true;
        voiceSelect.appendChild(opt);
      });
    });

    // ==========================================
    // TAB 2: NHẠC NỀN
    // ==========================================
    const musicPanel = panels['music'];

    // Toggle
    const bgMusicToggleRow = document.createElement('div');
    bgMusicToggleRow.className = 'sts-setting-row sts-row-inline';
    bgMusicToggleRow.innerHTML = `<div class="sts-setting-label">Phát nhạc nền</div>`;

    const bgMusicLabelWrap = document.createElement('label');
    bgMusicLabelWrap.className = 'sts-toggle-wrap';
    const bgMusicInput = document.createElement('input');
    bgMusicInput.type = 'checkbox';
    bgMusicInput.checked = !!ttsSettings.bgMusic.enabled;
    const bgMusicSlider = document.createElement('span');
    bgMusicSlider.className = 'sts-toggle-slider';

    const bgMusicOptionsWrap = document.createElement('div');
    bgMusicOptionsWrap.style.display = ttsSettings.bgMusic.enabled ? 'block' : 'none';
    bgMusicOptionsWrap.style.marginTop = '12px';

    bgMusicInput.addEventListener('change', () => {
      ttsSettings.bgMusic.enabled = bgMusicInput.checked;
      saveSettings();
      bgMusicOptionsWrap.style.display = ttsSettings.bgMusic.enabled ? 'block' : 'none';
      if (!ttsSettings.bgMusic.enabled) { stopBgMusic(); }
      else if (isSpeaking && !isPaused) { startBgMusic(); }
    });

    bgMusicLabelWrap.append(bgMusicInput, bgMusicSlider);
    bgMusicToggleRow.appendChild(bgMusicLabelWrap);
    musicPanel.appendChild(bgMusicToggleRow);

    // Track Select
    const trackRow = document.createElement('div');
    trackRow.className = 'sts-setting-row';
    trackRow.innerHTML = `<div class="sts-setting-label">Loại âm thanh</div>`;
    const trackSelect = document.createElement('select');
    trackSelect.className = 'sts-bgmusic-select';

    [
      { id: 'rain', name: '🌧 Tiếng mưa' },
      { id: 'whitenoise', name: '⬜ Nhiễu trắng' },
      { id: 'brownnoise', name: '🟤 Nhiễu nâu' },
      { id: 'custom', name: '🔗 URL tùy chỉnh' }
    ].forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      if (t.id === ttsSettings.bgMusic.track) opt.selected = true;
      trackSelect.appendChild(opt);
    });

    const customUrlInput = document.createElement('input');
    customUrlInput.type = 'url';
    customUrlInput.className = 'sts-text-input';
    customUrlInput.placeholder = 'Nhập link file audio (.mp3, .wav)...';
    customUrlInput.style.marginTop = '8px';
    customUrlInput.style.display = ttsSettings.bgMusic.track === 'custom' ? 'block' : 'none';
    customUrlInput.value = ttsSettings.bgMusic.customUrl || '';

    trackSelect.addEventListener('change', () => {
      ttsSettings.bgMusic.track = trackSelect.value;
      customUrlInput.style.display = trackSelect.value === 'custom' ? 'block' : 'none';
      saveSettings();
      if (ttsSettings.bgMusic.enabled && isSpeaking && !isPaused) startBgMusic();
    });
    customUrlInput.addEventListener('change', () => {
      ttsSettings.bgMusic.customUrl = customUrlInput.value;
      saveSettings();
      if (ttsSettings.bgMusic.enabled && ttsSettings.bgMusic.track === 'custom' && isSpeaking && !isPaused) startBgMusic();
    });

    trackRow.append(trackSelect, customUrlInput);
    bgMusicOptionsWrap.appendChild(trackRow);

    // Volume
    const bgVolRow = createSliderRow('Âm lượng nhạc nền', 'sts-bg-volume', 'sts-bg-volume-val', 0.05, 1.0, 0.05, ttsSettings.bgMusic.volume, (v) => {
      setBgMusicVolume(v);
      saveSettings();
    });
    bgMusicOptionsWrap.appendChild(bgVolRow);
    musicPanel.appendChild(bgMusicOptionsWrap);

    // ==========================================
    // TAB 3: CHUNG
    // ==========================================
    const generalPanel = panels['general'];

    // Theme
    const themeRow = document.createElement('div');
    themeRow.className = 'sts-setting-row';
    const themeLabel = document.createElement('div');
    themeLabel.className = 'sts-setting-label';
    themeLabel.textContent = 'Giao diện';
    const themePicker = document.createElement('div');
    themePicker.className = 'sts-theme-picker';
    themePicker.style.marginTop = '8px';

    ['system', 'light', 'dark'].forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'sts-theme-btn';
      btn.dataset.theme = t;
      btn.textContent = t === 'system' ? '🖥 Tự động' : (t === 'light' ? '☀ Sáng' : '🌙 Tối');
      btn.addEventListener('click', () => { ttsSettings.theme = t; saveSettings(); applyTheme(); });
      themePicker.appendChild(btn);
    });
    themeRow.append(themeLabel, themePicker);
    generalPanel.appendChild(themeRow);

    // Sleep Timer
    const sleepDivider = document.createElement('div');
    sleepDivider.className = 'sts-section-divider';
    sleepDivider.textContent = 'Hẹn giờ tắt';
    generalPanel.appendChild(sleepDivider);

    const sleepBtnWrap = document.createElement('div');
    sleepBtnWrap.className = 'sts-sleep-wrap';

    [{ label: '15 phút', minutes: 15 }, { label: '30 phút', minutes: 30 }, { label: '60 phút', minutes: 60 }].forEach(({ label, minutes }) => {
      const btn = document.createElement('button');
      btn.className = 'sts-sleep-btn';
      btn.dataset.minutes = minutes;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sts-sleep-btn').forEach(b => b.classList.remove('sts-active'));
        btn.classList.add('sts-active');
        setSleepTimer(minutes);
      });
      sleepBtnWrap.appendChild(btn);
    });

    const cancelSleepBtn = document.createElement('button');
    cancelSleepBtn.className = 'sts-sleep-btn sts-sleep-cancel';
    cancelSleepBtn.textContent = 'Huỷ';
    cancelSleepBtn.addEventListener('click', () => cancelSleepTimer());
    sleepBtnWrap.appendChild(cancelSleepBtn);

    const sleepStatus = document.createElement('div');
    sleepStatus.id = 'sts-sleep-status';
    sleepStatus.className = 'sts-sleep-status';
    generalPanel.append(sleepBtnWrap, sleepStatus);

    // Auto Next Chapter
    const nextChapDivider = document.createElement('div');
    nextChapDivider.className = 'sts-section-divider';
    nextChapDivider.textContent = 'Điều hướng';
    generalPanel.appendChild(nextChapDivider);

    const nextChapRow = document.createElement('div');
    nextChapRow.className = 'sts-setting-row sts-row-inline';
    const nextChapLabel = document.createElement('div');
    nextChapLabel.className = 'sts-setting-label';
    nextChapLabel.textContent = 'Tự động chuyển chương';
    const nextChapLabelWrap = document.createElement('label');
    nextChapLabelWrap.className = 'sts-toggle-wrap';
    const nextChapInput = document.createElement('input');
    nextChapInput.type = 'checkbox';
    nextChapInput.checked = !!ttsSettings.autoNextChapter;
    const nextChapSliderEl = document.createElement('span');
    nextChapSliderEl.className = 'sts-toggle-slider';
    nextChapInput.addEventListener('change', () => { ttsSettings.autoNextChapter = nextChapInput.checked; saveSettings(); });
    nextChapLabelWrap.append(nextChapInput, nextChapSliderEl);
    nextChapRow.append(nextChapLabel, nextChapLabelWrap);
    generalPanel.appendChild(nextChapRow);

    // Activate first tab
    switchTab('voice');

    return body;
  }

  function createSliderRow(label, id, valId, min, max, step, initial, onChange) {
    const row = document.createElement('div');
    row.className = 'sts-setting-row';
    row.innerHTML = `<div class="sts-setting-label"><span>${label}</span><span class="sts-setting-value" id="${valId}">${initial.toFixed(1)}</span></div>`;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = id;
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = initial;

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      row.querySelector('.sts-setting-value').textContent = v.toFixed(1);
      onChange(v);
    });
    row.appendChild(slider);
    return row;
  }

  // ---- Fetch Content ----
  function fetchContent() {
    const parser = detectParser();
    const selectors = parser ? parser.contentSelectors : ['#chapter-c'];

    let chapterEl = null;
    for (const sel of selectors) {
      chapterEl = document.querySelector(sel);
      if (chapterEl) break;
    }

    if (!chapterEl) {
      els.status.textContent = 'Không tìm thấy nội dung chương.';
      els.playBtn.disabled = true;
      return;
    }
    currentText = chapterEl.innerText.trim();
    if (currentText) {
      const charCount = currentText.length;
      els.status.textContent = `Đã tải: ${charCount.toLocaleString()} ký tự.`;
      els.playBtn.disabled = false;

      // Check for reading progress
      const url = window.location.href.split('#')[0];
      const progress = readingProgressMap[url];
      if (progress && progress.chunkIndex > 0 && progress.chunkIndex < progress.totalChunks && ttsSettings.engine === 'gemini') {
        els.resumeText.textContent = `Tiếp tục từ phần ${progress.chunkIndex}/${progress.totalChunks}?`;
        els.resumeBanner.style.display = 'flex';
      }

    } else {
      els.status.textContent = 'Nội dung trống.';
      els.playBtn.disabled = true;
    }
  }

  // ---- Dispatch TTS ----
  function handlePlayResume() {
    if (isPaused) {
      duckBgMusic(false);
      if (ttsSettings.engine === 'gemini') {
        resumeGeminiPlayback();
        isPaused = false;
        isSpeaking = true;
        els.status.textContent = 'Đang đọc (Gemini)...';
        updateButtons();
      } else {
        chrome.runtime.sendMessage({ action: 'tts-resume' });
        isPaused = false;
        isSpeaking = true;
        els.status.textContent = 'Đang đọc...';
        updateButtons();
      }
    } else if (isSpeaking) {
      // It's speaking, so this acts as PAUSE
      duckBgMusic(true);
      if (ttsSettings.engine === 'gemini') {
        pauseGeminiPlayback();
      } else {
        chrome.runtime.sendMessage({ action: 'tts-pause' });
      }
      isPaused = true;
      els.status.textContent = 'Tạm dừng.';
      updateButtons();
    } else {
      // Not speaking, start NEW speech
      startSpeech();
    }
  }

  function startSpeech(startChunkIndex = 0) {
    if (!currentText) return;

    startBgMusic();

    if (ttsSettings.engine === 'gemini') {
      if (!ttsSettings.geminiApiKeys || ttsSettings.geminiApiKeys.length === 0) {
        els.status.textContent = 'Vui lòng thêm API Key trong cài đặt.';
        return;
      }

      // Hide resume banner if starting speech
      els.resumeBanner.style.display = 'none';

      // Always stop previous Gemini session before starting a new one.
      // This prevents dual-audio when restarting after an error mid-fetch.
      stopGeminiPlayback();

      geminiStopped = false;
      audioQueue = [];
      isPlayingGemini = false;
      geminiTotalChunks = 0;
      geminiReceivedChunks = 0;
      geminiAllChunksReceived = false;
      geminiPlayedChunks = startChunkIndex; // Initialize with offset

      isSpeaking = true;
      isPaused = false;
      updateButtons();
      els.status.textContent = 'Đang kết nối Gemini...';
      updateProgressBar(0);

      chrome.runtime.sendMessage({
        action: 'gemini-tts-speak',
        text: currentText,
        apiKeys: ttsSettings.geminiApiKeys,
        activeKeyIndex: ttsSettings.geminiActiveKeyIndex || 0,
        geminiVoice: ttsSettings.geminiVoice,
        startChunkIndex: startChunkIndex
      }, (resp) => {
        if (resp && !resp.success && resp.error) {
          isSpeaking = false;
          isPaused = false;
          updateButtons();
          hideProgressBar();
          showErrorPopup('Lỗi: ' + resp.error);
        }
      });
    } else {
      chrome.runtime.sendMessage({
        action: 'tts-speak',
        text: currentText,
        rate: ttsSettings.rate,
        pitch: ttsSettings.pitch,
        voiceName: ttsSettings.voiceName
      });
    }
  }

  function updateButtons() {
    if (!els) return;

    if (isSpeaking && !isPaused) {
      els.playBtn.innerHTML = '⏸';
      els.playBtn.title = 'Tạm dừng (Pause)';
      els.stopBtn.disabled = false;
    } else if (isPaused) {
      els.playBtn.innerHTML = '▶';
      els.playBtn.title = 'Tiếp tục (Resume)';
      els.stopBtn.disabled = false;
    } else {
      els.playBtn.innerHTML = '▶';
      els.playBtn.title = 'Đọc (Play)';
      els.stopBtn.disabled = true;
    }

    if (ttsSettings.engine === 'gemini' && currentText && !isDownloadingAudio) {
      els.downloadBtn.disabled = false;
      els.downloadBtn.title = 'Tải audio xuống (WAV)';
    } else if (!isDownloadingAudio) {
      els.downloadBtn.disabled = true;
      els.downloadBtn.title = ttsSettings.engine !== 'gemini' ? 'Chỉ hỗ trợ tải với Gemini AI' : 'Đang xử lý...';
    }
  }

  // ---- Events & Handlers ----
  function attachEvents() {
    els.playBtn.addEventListener('click', handlePlayResume);

    els.stopBtn.addEventListener('click', () => {
      if (isSpeaking) {
        stopBgMusic();
        if (ttsSettings.engine === 'gemini') stopGeminiPlayback();
        chrome.runtime.sendMessage({ action: 'tts-stop' });
        isSpeaking = false;
        isPaused = false;
        els.status.textContent = 'Đã dừng.';
        updateButtons();
      }
      cancelSleepTimer(); // Cancel timer when user manually stops
      if (autoNextTimerId) {
        clearInterval(autoNextTimerId);
        autoNextTimerId = null;
      }
      if (isDownloadingAudio) {
        cancelDownloadAudio();
      }
    });

    els.downloadBtn.addEventListener('click', () => {
      if (ttsSettings.engine !== 'gemini') {
        showErrorPopup('Tính năng Tải audio chỉ hỗ trợ engine Gemini AI.');
        return;
      }
      if (isDownloadingAudio || !currentText) return;
      if (isSpeaking) {
        els.stopBtn.click(); // Stop current playback before downloading
      }
      startDownloadGeminiAudio();
    });

    els.resumeYesBtn.addEventListener('click', () => {
      const url = window.location.href.split('#')[0];
      const progress = readingProgressMap[url];
      if (progress && progress.chunkIndex > 0) {
        startSpeech(progress.chunkIndex);
      }
    });

    els.resumeNoBtn.addEventListener('click', () => {
      els.resumeBanner.style.display = 'none';
      clearReadingProgress();
      startSpeech(0); // Optional: Auto-start from beginning, or just clear and wait for user to click play
    });

    els.reloadBtn.addEventListener('click', () => {
      stopBgMusic();
      if (ttsSettings.engine === 'gemini') stopGeminiPlayback();
      chrome.runtime.sendMessage({ action: 'tts-stop' });
      isSpeaking = false;
      isPaused = false;
      updateButtons();
      fetchContent();
    });

    // Settings Popup Logic
    const openSettings = () => {
      els.settingsOverlay.style.display = 'flex';
      els.settingsBtn.classList.add('sts-active');
    };
    const closeSettings = () => {
      els.settingsOverlay.style.display = 'none';
      els.settingsBtn.classList.remove('sts-active');
    };
    els.settingsBtn.addEventListener('click', openSettings);
    els.settingsCloseBtn.addEventListener('click', closeSettings);
    els.settingsOverlay.addEventListener('click', (e) => {
      if (e.target === els.settingsOverlay) closeSettings();
    });

    // Engine Toggle Logic
    const switchEngine = (engine) => {
      ttsSettings.engine = engine;
      saveSettings();

      els.btnChrome.classList.toggle('sts-active', engine === 'chrome');
      els.btnGemini.classList.toggle('sts-active', engine === 'gemini');

      document.getElementById('sts-chrome-section').style.display = engine === 'chrome' ? 'block' : 'none';
      document.getElementById('sts-gemini-section').style.display = engine === 'gemini' ? 'block' : 'none';
    };

    els.btnChrome.addEventListener('click', () => switchEngine('chrome'));
    els.btnGemini.addEventListener('click', () => switchEngine('gemini'));

    // Mini Toggle Logic
    els.miniBtn.addEventListener('click', () => {
      ttsSettings.isMiniMode = !ttsSettings.isMiniMode;
      saveSettings();
      applyTheme(); // applyTheme handles the class toggle
    });
  }

  // Background message listener
  let els;
  chrome.runtime.onMessage.addListener((message) => {
    if (!els) return;

    switch (message.action) {
      case 'gemini-start':
        if (isDownloadingAudio) {
          // Download mode: just track total chunks
          geminiTotalChunks = message.totalChunks;
          els.status.textContent = `Đang tải audio (0/${geminiTotalChunks})...`;
          updateProgressBar(0);
        } else {
          geminiTotalChunks = message.totalChunks;
          geminiReceivedChunks = 0;
          geminiAllChunksReceived = false;
          geminiPlayedChunks = 0;
          isSpeaking = true;
          isPaused = false;
          updateButtons();
          els.status.textContent = `Đang tạo audio (0/${geminiTotalChunks})...`;
          updateProgressBar(0);
        }
        break;

      case 'gemini-progress':
        if (isDownloadingAudio) {
          const dlPct = Math.round(((message.chunkIndex + 1) / message.totalChunks) * 100);
          els.status.textContent = `Đang tải phần ${message.chunkIndex + 1}/${message.totalChunks}...`;
          updateProgressBar(dlPct);
        } else if (message.phase === 'fetching') {
          const fetchPct = Math.round(((message.chunkIndex) / message.totalChunks) * 100);
          els.status.textContent = `Đang tạo phần ${message.chunkIndex + 1}/${message.totalChunks}...`;
          updateProgressBar(fetchPct);
        }
        break;

      case 'gemini-audio-chunk':
        if (isDownloadingAudio) {
          // Download mode: collect chunks instead of playing
          downloadChunks.push({ audioData: message.audioData, chunkIndex: message.chunkIndex });
          const dlPct = Math.round((downloadChunks.length / geminiTotalChunks) * 100);
          els.status.textContent = `Đã nhận ${downloadChunks.length}/${geminiTotalChunks} phần...`;
          updateProgressBar(dlPct);
          if (message.isLast) finishDownloadAudio();
        } else {
          // Normal playback mode
          geminiReceivedChunks++;
          if (message.isLast) geminiAllChunksReceived = true;
          audioQueue.push(message);
          if (!isPlayingGemini && !geminiStopped) processAudioQueue();
        }
        break;

      case 'gemini-key-switch':
        ttsSettings.geminiActiveKeyIndex = message.newKeyIndex;
        saveSettings();
        els.status.textContent = `${message.reason} → chuyển sang ${message.keyLabel}`;
        break;

      case 'tts-event':
        handleChromeTtsEvent(message);
        break;
    }
  });

  function handleChromeTtsEvent(msg) {
    switch (msg.type) {
      case 'start':
        isSpeaking = true;
        isPaused = false;
        updateButtons();
        els.status.textContent = ttsSettings.engine === 'gemini' ? 'Đang đọc (Gemini)...' : 'Đang đọc...';
        break;
      case 'end':
        stopBgMusic();
        isSpeaking = false;
        isPaused = false;
        updateButtons();
        els.status.textContent = 'Đã đọc xong.';
        if (ttsSettings.engine === 'chrome') {
          checkAutoNextChapter();
        }
        break;
      case 'pause':
        isPaused = true;
        updateButtons();
        els.status.textContent = 'Tạm dừng.';
        break;
      case 'resume':
        isPaused = false;
        updateButtons();
        els.status.textContent = 'Đang đọc...';
        break;
      case 'error':
      case 'cancelled':
        stopBgMusic();
        isSpeaking = false;
        isPaused = false;
        updateButtons();
        if (msg.type === 'error') showErrorPopup('Lỗi: ' + (msg.error || 'Lỗi đọc.'));
        break;
    }
  }

  // ---- Init ----
  loadSettings(() => {
    els = createUI();
    applyTheme(); // apply theme immediately after UI creation
    attachEvents();
    fetchContent();
  });
})();
