// content.js — Floating TTS controls + settings panel
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
  let currentSource = null;
  let audioQueue = [];
  let isPlayingGemini = false;
  let geminiStopped = false;
  let pauseTime = 0;
  let pauseOffset = 0;
  let currentBuffer = null;

  // Default settings
  let ttsSettings = {
    rate: 1.0,
    pitch: 1.0,
    voiceName: '', // empty = system default
    engine: 'chrome', // 'chrome' | 'gemini'
    geminiApiKey: '',
    geminiVoice: 'Kore'
  };

  // Gemini voice list
  const GEMINI_VOICES = [
    'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir',
    'Aoede', 'Leda', 'Orus', 'Perseus', 'Iapetus',
    'Altair', 'Autonoe', 'Callirrhoe', 'Dorus', 'Erinome',
    'Gacrux', 'Helios', 'Io', 'Janus', 'Keid',
    'Laomedeia', 'Maia', 'Narvi', 'Oberon', 'Pandora',
    'Quasar', 'Rastaban', 'Sadachbia', 'Talos', 'Umbriel'
  ];

  // ---- Load saved settings ----
  function loadSettings(callback) {
    chrome.storage.local.get('ttsSettings', (result) => {
      if (result.ttsSettings) {
        ttsSettings = { ...ttsSettings, ...result.ttsSettings };
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

        // Convert s16le PCM to Float32 for Web Audio
        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
          float32[i] = int16[i] / 32768.0;
        }

        const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
        audioBuffer.getChannelData(0).set(float32);

        currentBuffer = audioBuffer;
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        currentSource = source;
        pauseOffset = 0;

        source.onended = () => {
          currentSource = null;
          currentBuffer = null;
          resolve();
        };

        source.start(0);
      } catch (err) {
        reject(err);
      }
    });
  }

  async function processAudioQueue() {
    if (isPlayingGemini) return;
    isPlayingGemini = true;

    while (audioQueue.length > 0 && !geminiStopped) {
      const chunk = audioQueue.shift();
      await playBase64Pcm(chunk.audioData);
    }

    isPlayingGemini = false;

    // If not stopped, playback ended naturally
    if (!geminiStopped && ttsSettings.engine === 'gemini') {
      isSpeaking = false;
      isPaused = false;
      if (els) {
        updateButtons(els);
        els.status.textContent = 'Đã đọc xong.';
      }
    }
  }

  function stopGeminiPlayback() {
    geminiStopped = true;
    audioQueue = [];
    if (currentSource) {
      try { currentSource.stop(); } catch (e) { /* ignore */ }
      currentSource = null;
    }
    currentBuffer = null;
    isPlayingGemini = false;
  }

  function pauseGeminiPlayback() {
    const ctx = getAudioContext();
    if (ctx.state === 'running') {
      pauseTime = ctx.currentTime;
      ctx.suspend();
    }
  }

  function resumeGeminiPlayback() {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
  }

  // ---- Build UI ----
  function createUI() {
    const container = document.createElement('div');
    container.id = 'sts-floating-container';

    const btnRow = document.createElement('div');
    btnRow.className = 'sts-btn-row';

    const speakBtn = createButton('sts-btn-speak', '▶', 'Đọc');
    const pauseBtn = createButton('sts-btn-pause', '⏸', 'Tạm dừng');
    pauseBtn.disabled = true;
    const stopBtn = createButton('sts-btn-stop', '⏹', 'Dừng');
    stopBtn.disabled = true;
    const reloadBtn = createButton('sts-btn-reload', '⟲', 'Tải lại');
    const settingsBtn = createButton('sts-btn-settings', '⚙', 'Cài đặt');

    btnRow.append(speakBtn, pauseBtn, stopBtn, reloadBtn, settingsBtn);

    const status = document.createElement('span');
    status.id = 'sts-status';
    status.textContent = 'Sẵn sàng';

    container.append(btnRow, status);
    document.body.appendChild(container);

    // Build settings panel
    const panel = createSettingsPanel();
    document.body.appendChild(panel);

    return { speakBtn, pauseBtn, stopBtn, reloadBtn, settingsBtn, status, panel };
  }

  function createButton(id, icon, tooltip) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.className = 'sts-btn';
    btn.textContent = icon;
    btn.setAttribute('data-tooltip', tooltip);
    return btn;
  }

  // ---- Settings panel ----
  function createSettingsPanel() {
    const panel = document.createElement('div');
    panel.id = 'sts-settings-panel';

    // Title
    const title = document.createElement('div');
    title.className = 'sts-panel-title';
    title.textContent = '⚙ Cài đặt giọng đọc';

    // ---- Engine Toggle ----
    const engineRow = document.createElement('div');
    engineRow.className = 'sts-setting-row';
    const engineLabel = document.createElement('div');
    engineLabel.className = 'sts-setting-label';
    engineLabel.innerHTML = '<span>Công cụ đọc</span>';

    const toggleWrap = document.createElement('div');
    toggleWrap.className = 'sts-engine-toggle';

    const chromeLabel = document.createElement('span');
    chromeLabel.textContent = 'Chrome';
    chromeLabel.className = 'sts-toggle-label' + (ttsSettings.engine === 'chrome' ? ' sts-toggle-active' : '');
    chromeLabel.id = 'sts-label-chrome';

    const toggleSwitch = document.createElement('label');
    toggleSwitch.className = 'sts-switch';
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.id = 'sts-engine-switch';
    toggleInput.checked = ttsSettings.engine === 'gemini';
    const slider = document.createElement('span');
    slider.className = 'sts-slider';
    toggleSwitch.append(toggleInput, slider);

    const geminiLabel = document.createElement('span');
    geminiLabel.textContent = 'Gemini';
    geminiLabel.className = 'sts-toggle-label' + (ttsSettings.engine === 'gemini' ? ' sts-toggle-active' : '');
    geminiLabel.id = 'sts-label-gemini';

    toggleWrap.append(chromeLabel, toggleSwitch, geminiLabel);
    engineRow.append(engineLabel, toggleWrap);

    // ---- Chrome TTS Section ----
    const chromeSection = document.createElement('div');
    chromeSection.id = 'sts-chrome-section';
    chromeSection.style.display = ttsSettings.engine === 'chrome' ? 'block' : 'none';

    // Rate slider
    const rateRow = createSliderRow(
      'Tốc độ đọc', 'sts-rate-slider', 'sts-rate-value',
      0.5, 3.0, 0.1, ttsSettings.rate,
      (val) => { ttsSettings.rate = val; saveSettings(); }
    );

    // Pitch slider
    const pitchRow = createSliderRow(
      'Tông giọng', 'sts-pitch-slider', 'sts-pitch-value',
      0.0, 2.0, 0.1, ttsSettings.pitch,
      (val) => { ttsSettings.pitch = val; saveSettings(); }
    );

    // Voice selector (Chrome)
    const voiceRow = document.createElement('div');
    voiceRow.className = 'sts-setting-row';
    const voiceLabel = document.createElement('div');
    voiceLabel.className = 'sts-setting-label';
    voiceLabel.innerHTML = '<span>Loại giọng</span>';
    const voiceSelect = document.createElement('select');
    voiceSelect.id = 'sts-voice-select';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Mặc định hệ thống';
    voiceSelect.appendChild(defaultOpt);
    voiceSelect.addEventListener('change', () => {
      ttsSettings.voiceName = voiceSelect.value;
      saveSettings();
    });
    voiceRow.append(voiceLabel, voiceSelect);

    chromeSection.append(rateRow, pitchRow, voiceRow);

    // ---- Gemini Section ----
    const geminiSection = document.createElement('div');
    geminiSection.id = 'sts-gemini-section';
    geminiSection.style.display = ttsSettings.engine === 'gemini' ? 'block' : 'none';

    // API Key input
    const apiKeyRow = document.createElement('div');
    apiKeyRow.className = 'sts-setting-row';
    const apiKeyLabel = document.createElement('div');
    apiKeyLabel.className = 'sts-setting-label';
    apiKeyLabel.innerHTML = '<span>API Key</span>';
    const apiKeyInput = document.createElement('input');
    apiKeyInput.type = 'password';
    apiKeyInput.id = 'sts-gemini-apikey';
    apiKeyInput.className = 'sts-text-input';
    apiKeyInput.placeholder = 'Nhập Google AI Studio API Key';
    apiKeyInput.value = ttsSettings.geminiApiKey || '';
    apiKeyInput.addEventListener('change', () => {
      ttsSettings.geminiApiKey = apiKeyInput.value.trim();
      saveSettings();
    });

    // Show/hide toggle for API key
    const apiKeyWrap = document.createElement('div');
    apiKeyWrap.className = 'sts-apikey-wrap';
    const toggleVis = document.createElement('button');
    toggleVis.className = 'sts-apikey-toggle';
    toggleVis.textContent = '👁';
    toggleVis.type = 'button';
    toggleVis.addEventListener('click', () => {
      apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
    });
    apiKeyWrap.append(apiKeyInput, toggleVis);
    apiKeyRow.append(apiKeyLabel, apiKeyWrap);

    // Gemini voice selector
    const geminiVoiceRow = document.createElement('div');
    geminiVoiceRow.className = 'sts-setting-row';
    const geminiVoiceLabel = document.createElement('div');
    geminiVoiceLabel.className = 'sts-setting-label';
    geminiVoiceLabel.innerHTML = '<span>Giọng Gemini</span>';
    const geminiVoiceSelect = document.createElement('select');
    geminiVoiceSelect.id = 'sts-gemini-voice-select';
    GEMINI_VOICES.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      if (v === ttsSettings.geminiVoice) opt.selected = true;
      geminiVoiceSelect.appendChild(opt);
    });
    geminiVoiceSelect.addEventListener('change', () => {
      ttsSettings.geminiVoice = geminiVoiceSelect.value;
      saveSettings();
    });
    geminiVoiceRow.append(geminiVoiceLabel, geminiVoiceSelect);

    geminiSection.append(apiKeyRow, geminiVoiceRow);

    // ---- Toggle engine event ----
    toggleInput.addEventListener('change', () => {
      const isGemini = toggleInput.checked;
      ttsSettings.engine = isGemini ? 'gemini' : 'chrome';
      saveSettings();

      chromeSection.style.display = isGemini ? 'none' : 'block';
      geminiSection.style.display = isGemini ? 'block' : 'none';

      document.getElementById('sts-label-chrome').classList.toggle('sts-toggle-active', !isGemini);
      document.getElementById('sts-label-gemini').classList.toggle('sts-toggle-active', isGemini);
    });

    panel.append(title, engineRow, chromeSection, geminiSection);

    // Load voices from background
    loadVoices(voiceSelect);

    return panel;
  }

  function createSliderRow(labelText, sliderId, valueId, min, max, step, initial, onChange) {
    const row = document.createElement('div');
    row.className = 'sts-setting-row';

    const label = document.createElement('div');
    label.className = 'sts-setting-label';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = labelText;
    const valueSpan = document.createElement('span');
    valueSpan.className = 'sts-setting-value';
    valueSpan.id = valueId;
    valueSpan.textContent = initial.toFixed(1);
    label.append(labelSpan, valueSpan);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = sliderId;
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = initial;

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      valueSpan.textContent = val.toFixed(1);
      onChange(val);
    });

    row.append(label, slider);
    return row;
  }

  function loadVoices(selectEl) {
    chrome.runtime.sendMessage({ action: 'tts-getVoices' }, (response) => {
      if (!response || !response.voices) return;
      response.voices.forEach((voice) => {
        const opt = document.createElement('option');
        opt.value = voice.voiceName;
        opt.textContent = `${voice.voiceName} (${voice.lang || '?'})`;
        if (voice.voiceName === ttsSettings.voiceName) {
          opt.selected = true;
        }
        selectEl.appendChild(opt);
      });
    });
  }

  // ---- Fetch chapter text ----
  function fetchContent(els) {
    const chapterDiv = document.getElementById('chapter-c');
    if (!chapterDiv) {
      els.status.textContent = 'Không tìm thấy nội dung chương.';
      els.speakBtn.disabled = true;
      return;
    }
    currentText = chapterDiv.innerText.trim();
    if (currentText) {
      els.status.textContent = 'Đã tải nội dung.';
      els.speakBtn.disabled = false;
    } else {
      els.status.textContent = 'Nội dung trống.';
      els.speakBtn.disabled = true;
    }
  }

  // ---- TTS via chrome.tts (background) ----
  function speakText() {
    if (!currentText) return;

    if (ttsSettings.engine === 'gemini') {
      speakWithGemini();
    } else {
      speakWithChrome();
    }
  }

  function speakWithChrome() {
    chrome.runtime.sendMessage({
      action: 'tts-speak',
      text: currentText,
      rate: ttsSettings.rate,
      pitch: ttsSettings.pitch,
      voiceName: ttsSettings.voiceName
    });
  }

  function speakWithGemini() {
    if (!ttsSettings.geminiApiKey) {
      if (els) els.status.textContent = 'Vui lòng nhập API Key trong cài đặt.';
      return;
    }

    // Reset Gemini playback state
    geminiStopped = false;
    audioQueue = [];
    isPlayingGemini = false;

    isSpeaking = true;
    isPaused = false;
    if (els) {
      updateButtons(els);
      els.status.textContent = 'Đang tạo audio từ Gemini...';
    }

    chrome.runtime.sendMessage({
      action: 'gemini-tts-speak',
      text: currentText,
      apiKey: ttsSettings.geminiApiKey,
      geminiVoice: ttsSettings.geminiVoice
    });
  }

  function updateButtons(els) {
    els.speakBtn.disabled = isSpeaking && !isPaused;
    els.pauseBtn.disabled = !isSpeaking || isPaused;
    els.stopBtn.disabled = !isSpeaking;
  }

  // ---- Listen for TTS events from background ----
  let els; // declared here so the listener can access it

  chrome.runtime.onMessage.addListener((message) => {
    if (!els) return;

    // Handle Gemini audio chunks
    if (message.action === 'gemini-audio-chunk') {
      audioQueue.push(message);
      if (!isPlayingGemini && !geminiStopped) {
        processAudioQueue();
      }
      return;
    }

    if (message.action !== 'tts-event') return;

    switch (message.type) {
      case 'start':
        isSpeaking = true;
        isPaused = false;
        updateButtons(els);
        if (ttsSettings.engine === 'gemini') {
          els.status.textContent = 'Đang đọc (Gemini)...';
        } else {
          els.status.textContent = 'Đang đọc...';
        }
        break;

      case 'end':
        isSpeaking = false;
        isPaused = false;
        updateButtons(els);
        els.status.textContent = 'Đã đọc xong.';
        break;

      case 'pause':
        isPaused = true;
        updateButtons(els);
        els.status.textContent = 'Tạm dừng.';
        break;

      case 'resume':
        isPaused = false;
        updateButtons(els);
        els.status.textContent = 'Đang đọc...';
        break;

      case 'error':
      case 'cancelled':
        isSpeaking = false;
        isPaused = false;
        updateButtons(els);
        if (message.type === 'error') {
          els.status.textContent = 'Lỗi: ' + (message.error || 'Lỗi đọc.');
        }
        break;
    }
  });

  // ---- Event listeners ----
  function attachEvents(els) {
    els.speakBtn.addEventListener('click', () => {
      if (isPaused) {
        if (ttsSettings.engine === 'gemini') {
          resumeGeminiPlayback();
          isPaused = false;
          isSpeaking = true;
          els.status.textContent = 'Đang đọc (Gemini)...';
          updateButtons(els);
        } else {
          chrome.runtime.sendMessage({ action: 'tts-resume' });
          isPaused = false;
          isSpeaking = true;
          els.status.textContent = 'Đang đọc...';
          updateButtons(els);
        }
      } else {
        speakText();
      }
    });

    els.pauseBtn.addEventListener('click', () => {
      if (isSpeaking && !isPaused) {
        if (ttsSettings.engine === 'gemini') {
          pauseGeminiPlayback();
        } else {
          chrome.runtime.sendMessage({ action: 'tts-pause' });
        }
        isPaused = true;
        els.status.textContent = 'Tạm dừng.';
        updateButtons(els);
      }
    });

    els.stopBtn.addEventListener('click', () => {
      if (isSpeaking) {
        if (ttsSettings.engine === 'gemini') {
          stopGeminiPlayback();
        }
        chrome.runtime.sendMessage({ action: 'tts-stop' });
        isSpeaking = false;
        isPaused = false;
        els.status.textContent = 'Đã dừng.';
        updateButtons(els);
      }
    });

    els.reloadBtn.addEventListener('click', () => {
      if (ttsSettings.engine === 'gemini') {
        stopGeminiPlayback();
      }
      chrome.runtime.sendMessage({ action: 'tts-stop' });
      isSpeaking = false;
      isPaused = false;
      updateButtons(els);
      fetchContent(els);
    });

    // Toggle settings panel
    els.settingsBtn.addEventListener('click', () => {
      settingsOpen = !settingsOpen;
      els.panel.classList.toggle('sts-panel-open', settingsOpen);
    });

    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
      if (
        settingsOpen &&
        !els.panel.contains(e.target) &&
        e.target !== els.settingsBtn
      ) {
        settingsOpen = false;
        els.panel.classList.remove('sts-panel-open');
      }
    });
  }

  // ---- Sync UI sliders with loaded settings ----
  function syncUIToSettings() {
    const rateSlider = document.getElementById('sts-rate-slider');
    const rateValue = document.getElementById('sts-rate-value');
    const pitchSlider = document.getElementById('sts-pitch-slider');
    const pitchValue = document.getElementById('sts-pitch-value');
    const voiceSelect = document.getElementById('sts-voice-select');
    const engineSwitch = document.getElementById('sts-engine-switch');

    if (rateSlider) {
      rateSlider.value = ttsSettings.rate;
      rateValue.textContent = ttsSettings.rate.toFixed(1);
    }
    if (pitchSlider) {
      pitchSlider.value = ttsSettings.pitch;
      pitchValue.textContent = ttsSettings.pitch.toFixed(1);
    }
    if (voiceSelect) {
      voiceSelect.value = ttsSettings.voiceName;
    }
    if (engineSwitch) {
      engineSwitch.checked = ttsSettings.engine === 'gemini';
    }
  }

  // ---- Init ----
  loadSettings(() => {
    els = createUI();
    syncUIToSettings();
    attachEvents(els);
    fetchContent(els);
  });
})();
