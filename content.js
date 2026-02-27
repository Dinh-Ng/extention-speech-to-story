// content.js — Floating TTS controls injected into truyenfull.vision pages
(function () {
  'use strict';

  // ---- State ----
  let currentText = '';
  let utterance = null;
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

  // ---- TTS ----
  function speakText(els) {
    if (!currentText) return;
    window.speechSynthesis.cancel();

    utterance = new SpeechSynthesisUtterance(currentText);
    utterance.lang = 'vi-VN';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      isSpeaking = true;
      isPaused = false;
      updateButtons(els);
      els.status.textContent = 'Đang đọc...';
    };

    utterance.onend = () => {
      isSpeaking = false;
      isPaused = false;
      updateButtons(els);
      els.status.textContent = 'Đã đọc xong.';
    };

    utterance.onerror = () => {
      isSpeaking = false;
      isPaused = false;
      updateButtons(els);
      els.status.textContent = 'Lỗi đọc.';
    };

    window.speechSynthesis.speak(utterance);
  }

  function updateButtons(els) {
    els.speakBtn.disabled = isSpeaking && !isPaused;
    els.pauseBtn.disabled = !isSpeaking || isPaused;
    els.stopBtn.disabled = !isSpeaking;
  }

  // ---- Event listeners ----
  function attachEvents(els) {
    els.speakBtn.addEventListener('click', () => {
      if (isPaused) {
        window.speechSynthesis.resume();
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
        window.speechSynthesis.pause();
        isPaused = true;
        els.status.textContent = 'Tạm dừng.';
        updateButtons(els);
      }
    });

    els.stopBtn.addEventListener('click', () => {
      if (isSpeaking) {
        window.speechSynthesis.cancel();
        isSpeaking = false;
        isPaused = false;
        els.status.textContent = 'Đã dừng.';
        updateButtons(els);
      }
    });

    els.reloadBtn.addEventListener('click', () => {
      window.speechSynthesis.cancel();
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
