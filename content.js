// content.js — Floating TTS controls injected into truyenfull.vision pages
// Uses chrome.tts via message passing to background.js
(function () {
  'use strict';

  // ---- State ----
  let currentText = '';
  let isSpeaking = false;
  let isPaused = false;

  // ---- Build UI ----
  function createUI() {
    const container = document.createElement('div');
    container.id = 'sts-floating-container';

    const btnRow = document.createElement('div');
    btnRow.className = 'sts-btn-row';

    // Speak / Resume
    const speakBtn = createButton('sts-btn-speak', '▶', 'Đọc');
    // Pause
    const pauseBtn = createButton('sts-btn-pause', '⏸', 'Tạm dừng');
    pauseBtn.disabled = true;
    // Stop
    const stopBtn = createButton('sts-btn-stop', '⏹', 'Dừng');
    stopBtn.disabled = true;
    // Reload content
    const reloadBtn = createButton('sts-btn-reload', '⟲', 'Tải lại');

    btnRow.append(speakBtn, pauseBtn, stopBtn, reloadBtn);

    // Status label
    const status = document.createElement('span');
    status.id = 'sts-status';
    status.textContent = 'Sẵn sàng';

    container.append(btnRow, status);
    document.body.appendChild(container);

    return { speakBtn, pauseBtn, stopBtn, reloadBtn, status };
  }

  function createButton(id, icon, tooltip) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.className = 'sts-btn';
    btn.textContent = icon;
    btn.setAttribute('data-tooltip', tooltip);
    return btn;
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
  function speakText(els) {
    if (!currentText) return;

    chrome.runtime.sendMessage({
      action: 'tts-speak',
      text: currentText,
      rate: 1.0,
      pitch: 1.0
    });
  }

  function updateButtons(els) {
    els.speakBtn.disabled = isSpeaking && !isPaused;
    els.pauseBtn.disabled = !isSpeaking || isPaused;
    els.stopBtn.disabled = !isSpeaking;
  }

  // ---- Listen for TTS events from background ----
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action !== 'tts-event') return;

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
        speakText(els);
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
  }

  // ---- Init ----
  const els = createUI();
  attachEvents(els);
  fetchContent(els);
})();
