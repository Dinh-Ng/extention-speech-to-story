// content.js
// Lắng nghe message từ popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getContent") {
    // Tìm phần tử chứa nội dung chương
    const chapterDiv = document.getElementById('chapter-c');
    if (!chapterDiv) {
      sendResponse({ success: false, error: "Không tìm thấy nội dung chương." });
      return;
    }

    // Lấy text thuần (innerText tự động xuống dòng theo <br>)
    const textContent = chapterDiv.innerText.trim();

    sendResponse({ success: true, content: textContent });
  }
  // Giữ kênh mở để gửi phản hồi bất đồng bộ (không cần thiết vì trả về ngay)
  return true;
});
