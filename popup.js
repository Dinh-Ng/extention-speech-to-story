// popup.js
let currentText = "";
let utterance = null;
let isSpeaking = false;
let isPaused = false;

// Lấy tab hiện tại và gửi yêu cầu lấy nội dung
async function fetchContent() {
  const contentDiv = document.getElementById('content');
  const speakBtn = document.getElementById('speakBtn');
  const statusDiv = document.getElementById('status');

  contentDiv.innerText = "Đang tải...";
  speakBtn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      contentDiv.innerText = "Không tìm thấy tab đang mở.";
      return;
    }

    // Kiểm tra URL có phải truyenfull.vision không
    if (!tab.url.includes('truyenfull.vision')) {
      contentDiv.innerText = "Vui lòng mở một trang truyenfull.vision.";
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { action: "getContent" });
    if (response && response.success) {
      currentText = response.content;
      contentDiv.innerText = currentText;
      speakBtn.disabled = false;
      statusDiv.innerText = "Đã tải nội dung.";
    } else {
      contentDiv.innerText = "Lỗi: " + (response?.error || "Không thể lấy nội dung.");
    }
  } catch (error) {
    contentDiv.innerText = "Lỗi kết nối với trang. Hãy thử tải lại trang.";
    console.error(error);
  }
}

// Hàm đọc văn bản
function speakText() {
  if (!currentText) return;

  // Dừng bất kỳ giọng đọc nào đang phát
  window.speechSynthesis.cancel();

  utterance = new SpeechSynthesisUtterance(currentText);
  utterance.lang = 'vi-VN'; // Đặt ngôn ngữ tiếng Việt
  utterance.rate = 1.0;      // Tốc độ đọc
  utterance.pitch = 1.0;     // Độ cao giọng

  utterance.onstart = () => {
    isSpeaking = true;
    isPaused = false;
    updateButtons();
    document.getElementById('status').innerText = "Đang đọc...";
  };

  utterance.onend = () => {
    isSpeaking = false;
    isPaused = false;
    updateButtons();
    document.getElementById('status').innerText = "Đã đọc xong.";
  };

  utterance.onerror = (event) => {
    console.error('Lỗi đọc:', event);
    isSpeaking = false;
    isPaused = false;
    updateButtons();
    document.getElementById('status').innerText = "Lỗi đọc.";
  };

  window.speechSynthesis.speak(utterance);
}

// Cập nhật trạng thái các nút
function updateButtons() {
  document.getElementById('speakBtn').disabled = isSpeaking;
  document.getElementById('pauseBtn').disabled = !isSpeaking || isPaused;
  document.getElementById('stopBtn').disabled = !isSpeaking;
}

// Xử lý sự kiện nút
document.getElementById('speakBtn').addEventListener('click', () => {
  if (isPaused) {
    window.speechSynthesis.resume();
    isPaused = false;
    document.getElementById('status').innerText = "Đang đọc...";
    updateButtons();
  } else {
    speakText();
  }
});

document.getElementById('pauseBtn').addEventListener('click', () => {
  if (isSpeaking && !isPaused) {
    window.speechSynthesis.pause();
    isPaused = true;
    document.getElementById('status').innerText = "Tạm dừng.";
    updateButtons();
  }
});

document.getElementById('stopBtn').addEventListener('click', () => {
  if (isSpeaking) {
    window.speechSynthesis.cancel();
    isSpeaking = false;
    isPaused = false;
    document.getElementById('status').innerText = "Đã dừng.";
    updateButtons();
  }
});

document.getElementById('reloadBtn').addEventListener('click', () => {
  window.speechSynthesis.cancel(); // dừng mọi đọc
  isSpeaking = false;
  isPaused = false;
  updateButtons();
  fetchContent();
});

// Tải nội dung khi popup mở
document.addEventListener('DOMContentLoaded', fetchContent);
