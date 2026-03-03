// content.js — Floating TTS controls + settings panel
// Uses chrome.tts via message passing to background.js
(function () {
  'use strict';

  // ---- State ----
  let currentText = '';
  let isSpeaking = false;
  let isPaused = false;
  let settingsOpen = false;

  // Default settings
  let ttsSettings = {
    rate: 1.0,
    pitch: 1.0,
    voiceName: '' // empty = system default
  };

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

    // Rate slider
    const rateRow = createSliderRow(
      'Tốc độ đọc',
      'sts-rate-slider',
      'sts-rate-value',
      0.5, 3.0, 0.1,
      ttsSettings.rate,
      (val) => {
        ttsSettings.rate = val;
        saveSettings();
      }
    );

    // Pitch slider
    const pitchRow = createSliderRow(
      'Tông giọng',
      'sts-pitch-slider',
      'sts-pitch-value',
      0.0, 2.0, 0.1,
      ttsSettings.pitch,
      (val) => {
        ttsSettings.pitch = val;
        saveSettings();
      }
    );

    // Voice selector
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

    panel.append(title, rateRow, pitchRow, voiceRow);

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

    chrome.runtime.sendMessage({
      action: 'tts-speak',
      text: currentText,
      rate: ttsSettings.rate,
      pitch: ttsSettings.pitch,
      voiceName: ttsSettings.voiceName
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
    if (message.action !== 'tts-event' || !els) return;

    switch (message.type) {
      case 'start':
        isSpeaking = true;
        isPaused = false;
        updateButtons(els);
        els.status.textContent = 'Đang đọc...';
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
          els.status.textContent = 'Lỗi đọc.';
        }
        break;
    }
  });

  // ---- Event listeners ----
  function attachEvents(els) {
    els.speakBtn.addEventListener('click', () => {
      if (isPaused) {
        chrome.runtime.sendMessage({ action: 'tts-resume' });
        isPaused = false;
        isSpeaking = true;
        els.status.textContent = 'Đang đọc...';
        updateButtons(els);
      } else {
        speakText();
      }
    });

    els.pauseBtn.addEventListener('click', () => {
      if (isSpeaking && !isPaused) {
        chrome.runtime.sendMessage({ action: 'tts-pause' });
        isPaused = true;
        els.status.textContent = 'Tạm dừng.';
        updateButtons(els);
      }
    });

    els.stopBtn.addEventListener('click', () => {
      if (isSpeaking) {
        chrome.runtime.sendMessage({ action: 'tts-stop' });
        isSpeaking = false;
        isPaused = false;
        els.status.textContent = 'Đã dừng.';
        updateButtons(els);
      }
    });

    els.reloadBtn.addEventListener('click', () => {
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
  }

  // ---- Init ----
  loadSettings(() => {
    els = createUI();
    syncUIToSettings();
    attachEvents(els);
    fetchContent(els);
  });
})();
