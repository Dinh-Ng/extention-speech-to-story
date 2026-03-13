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
    theme: 'system'
  };

  const GEMINI_VOICES = [
    'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir',
    'Aoede', 'Leda', 'Orus', 'Perseus', 'Iapetus',
    'Altair', 'Autonoe', 'Callirrhoe', 'Dorus', 'Erinome',
    'Gacrux', 'Helios', 'Io', 'Janus', 'Keid',
    'Laomedeia', 'Maia', 'Narvi', 'Oberon', 'Pandora',
    'Quasar', 'Rastaban', 'Sadachbia', 'Talos', 'Umbriel'
  ];

  // ---- Load/Save settings ----
  function loadSettings(callback) {
    chrome.storage.local.get('ttsSettings', (result) => {
      if (result.ttsSettings) {
        ttsSettings = { ...ttsSettings, ...result.ttsSettings };
        // Migrate legacy single key to array
        if (ttsSettings.geminiApiKey && (!ttsSettings.geminiApiKeys || ttsSettings.geminiApiKeys.length === 0)) {
          ttsSettings.geminiApiKeys = [ttsSettings.geminiApiKey];
          ttsSettings.geminiApiKey = '';
          saveSettings();
        }
      }
      if (callback) callback();
    });
  }

  function saveSettings() {
    chrome.storage.local.set({ ttsSettings });
  }

  // ---- Gemini Audio Playback ----
  function getAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 64; // Small size for simple 32-bar visualizer
      analyser.connect(audioContext.destination);
    }
    return audioContext;
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
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
          float32[i] = int16[i] / 32768.0;
        }

        const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
        audioBuffer.getChannelData(0).set(float32);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(analyser); // Connect to analyser instead of destination
        currentSource = source;

        source.onended = () => {
          currentSource = null;
          resolve();
        };

        source.start(0);
      } catch (err) {
        reject(err);
      }
    });
  }

  // ---- Visualizer Logic ----
  function startVisualizer() {
    if (!els || !els.visualizerCanvas || !analyser) return;
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
      } else if (geminiAllChunksReceived) {
        break;
      } else {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    isPlayingGemini = false;
    stopVisualizer();

    if (!geminiStopped && ttsSettings.engine === 'gemini') {
      isSpeaking = false;
      isPaused = false;
      if (els) {
        updateButtons(els);
        updateProgressBar(100);
        setTimeout(() => hideProgressBar(), 1500);
        els.status.textContent = 'Đã đọc xong.';
      }
    }
  }

  function stopGeminiPlayback() {
    geminiStopped = true;
    audioQueue = [];
    geminiAllChunksReceived = true;
    if (currentSource) {
      try { currentSource.stop(); } catch (e) { }
      currentSource = null;
    }
    isPlayingGemini = false;
    isPaused = false;
    hideProgressBar();
    stopVisualizer();
  }

  function pauseGeminiPlayback() {
    const ctx = getAudioContext();
    if (ctx.state === 'running') {
      pauseTime = ctx.currentTime;
      ctx.suspend();
    }
    stopVisualizer();
  }

  function resumeGeminiPlayback() {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    if (isPlayingGemini) {
      startVisualizer();
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
    header.append(title, engineToggle);

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

    btnRow.append(reloadBtn, playBtn, stopBtn);

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

    // 3. Expandable Settings
    const settingsToggle = document.createElement('button');
    settingsToggle.className = 'sts-settings-toggle';
    settingsToggle.innerHTML = `Cài đặt âm thanh <span class="sts-chevron">▼</span>`;

    const settingsBody = createSettingsBody();

    card.append(header, controlsSection, settingsToggle, settingsBody);
    container.appendChild(card);
    document.body.appendChild(container);

    // Return elements reference
    return {
      card,
      btnChrome,
      btnGemini,
      playBtn,
      stopBtn,
      reloadBtn,
      status: statusText,
      progressWrap,
      progressBar,
      visualizerCanvas,
      settingsToggle,
      settingsBody
    };
  }

  function createSettingsBody() {
    const body = document.createElement('div');
    body.className = 'sts-settings-body';

    // Theme Section (Top of settings)
    const themeRow = document.createElement('div');
    themeRow.className = 'sts-setting-row sts-row-inline';
    const themeLabel = document.createElement('div');
    themeLabel.className = 'sts-setting-label';
    themeLabel.textContent = 'Giao diện';

    const themePicker = document.createElement('div');
    themePicker.className = 'sts-theme-picker';

    ['system', 'light', 'dark'].forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'sts-theme-btn';
      btn.dataset.theme = t;
      btn.textContent = t === 'system' ? 'Tự động' : (t === 'light' ? 'Sáng' : 'Tối');
      btn.addEventListener('click', () => {
        ttsSettings.theme = t;
        saveSettings();
        applyTheme();
      });
      themePicker.appendChild(btn);
    });

    themeRow.append(themeLabel, themePicker);
    body.appendChild(themeRow);

    // Chrome Section
    const chromeSection = document.createElement('div');
    chromeSection.id = 'sts-chrome-section';
    chromeSection.style.display = ttsSettings.engine === 'chrome' ? 'block' : 'none';

    const rateRow = createSliderRow('Tốc độ', 'sts-rate-slider', 'sts-rate-value', 0.5, 3.0, 0.1, ttsSettings.rate, (v) => { ttsSettings.rate = v; saveSettings(); });
    const pitchRow = createSliderRow('Tông giọng', 'sts-pitch-slider', 'sts-pitch-value', 0.0, 2.0, 0.1, ttsSettings.pitch, (v) => { ttsSettings.pitch = v; saveSettings(); });

    const voiceRow = document.createElement('div');
    voiceRow.className = 'sts-setting-row';
    voiceRow.innerHTML = `<div class="sts-setting-label">Giọng đọc</div>`;
    const voiceSelect = document.createElement('select');
    voiceSelect.id = 'sts-voice-select';
    voiceSelect.innerHTML = `<option value="">Mặc định hệ thống</option>`;
    voiceSelect.addEventListener('change', () => { ttsSettings.voiceName = voiceSelect.value; saveSettings(); });
    voiceRow.appendChild(voiceSelect);

    chromeSection.append(rateRow, pitchRow, voiceRow);

    // Gemini Section
    const geminiSection = document.createElement('div');
    geminiSection.id = 'sts-gemini-section';
    geminiSection.style.display = ttsSettings.engine === 'gemini' ? 'block' : 'none';

    // --- Multi API Key Manager ---
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

    // Add key row
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
      if (ttsSettings.geminiApiKeys.includes(val)) {
        addKeyInput.value = '';
        return;
      }
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
    body.append(chromeSection, geminiSection);

    // Load chrome voices async
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
    const chapterDiv = document.getElementById('chapter-c');
    if (!chapterDiv) {
      els.status.textContent = 'Không tìm thấy nội dung chương.';
      els.playBtn.disabled = true;
      return;
    }
    currentText = chapterDiv.innerText.trim();
    if (currentText) {
      const charCount = currentText.length;
      els.status.textContent = `Đã tải: ${charCount.toLocaleString()} ký tự.`;
      els.playBtn.disabled = false;
    } else {
      els.status.textContent = 'Nội dung trống.';
      els.playBtn.disabled = true;
    }
  }

  // ---- Dispatch TTS ----
  function handlePlayResume() {
    if (isPaused) {
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

  function startSpeech() {
    if (!currentText) return;

    if (ttsSettings.engine === 'gemini') {
      if (!ttsSettings.geminiApiKeys || ttsSettings.geminiApiKeys.length === 0) {
        els.status.textContent = 'Vui lòng thêm API Key trong cài đặt.';
        return;
      }

      geminiStopped = false;
      audioQueue = [];
      isPlayingGemini = false;
      geminiTotalChunks = 0;
      geminiReceivedChunks = 0;
      geminiAllChunksReceived = false;
      geminiPlayedChunks = 0;

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
        geminiVoice: ttsSettings.geminiVoice
      }, (resp) => {
        if (resp && !resp.success && resp.error) {
          isSpeaking = false;
          isPaused = false;
          updateButtons();
          hideProgressBar();
          els.status.textContent = 'Lỗi: ' + resp.error;
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
  }

  // ---- Events & Handlers ----
  function attachEvents() {
    els.playBtn.addEventListener('click', handlePlayResume);

    els.stopBtn.addEventListener('click', () => {
      if (isSpeaking) {
        if (ttsSettings.engine === 'gemini') stopGeminiPlayback();
        chrome.runtime.sendMessage({ action: 'tts-stop' });
        isSpeaking = false;
        isPaused = false;
        els.status.textContent = 'Đã dừng.';
        updateButtons();
      }
    });

    els.reloadBtn.addEventListener('click', () => {
      if (ttsSettings.engine === 'gemini') stopGeminiPlayback();
      chrome.runtime.sendMessage({ action: 'tts-stop' });
      isSpeaking = false;
      isPaused = false;
      updateButtons();
      fetchContent();
    });

    els.settingsToggle.addEventListener('click', () => {
      settingsOpen = !settingsOpen;
      els.settingsToggle.classList.toggle('sts-open', settingsOpen);
      els.settingsBody.classList.toggle('sts-open', settingsOpen);
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
  }

  // Background message listener
  let els;
  chrome.runtime.onMessage.addListener((message) => {
    if (!els) return;

    switch (message.action) {
      case 'gemini-start':
        geminiTotalChunks = message.totalChunks;
        geminiReceivedChunks = 0;
        geminiAllChunksReceived = false;
        geminiPlayedChunks = 0;
        isSpeaking = true;
        isPaused = false;
        updateButtons();
        els.status.textContent = `Đang tạo audio (0/${geminiTotalChunks})...`;
        updateProgressBar(0);
        break;

      case 'gemini-progress':
        if (message.phase === 'fetching') {
          const fetchPct = Math.round(((message.chunkIndex) / message.totalChunks) * 100);
          els.status.textContent = `Đang tạo phần ${message.chunkIndex + 1}/${message.totalChunks}...`;
          updateProgressBar(fetchPct);
        }
        break;

      case 'gemini-audio-chunk':
        geminiReceivedChunks++;
        if (message.isLast) geminiAllChunksReceived = true;
        audioQueue.push(message);
        if (!isPlayingGemini && !geminiStopped) processAudioQueue();
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
        isSpeaking = false;
        isPaused = false;
        updateButtons();
        els.status.textContent = 'Đã đọc xong.';
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
        isSpeaking = false;
        isPaused = false;
        updateButtons();
        if (msg.type === 'error') els.status.textContent = 'Lỗi: ' + (msg.error || 'Lỗi đọc.');
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
