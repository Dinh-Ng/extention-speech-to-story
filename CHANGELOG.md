# Changelog - Đọc truyện Speech

Tất cả các thay đổi quan trọng đối với dự án "Đọc truyện Speech" sẽ được ghi lại trong file này. Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [2.5.0] - 2026-03-11
### Added
- **Quản lý đa dạng Gemini API Key**: Hỗ trợ lưu danh sách nhiều API key.
- **Cơ chế Auto-Fallback**: Tự động chuyển đổi sang key tiếp theo khi key hiện tại hết hạn mức (Quota 429) hoặc gặp lỗi server (500/503).
- **UI Key Manager**: Danh sách key trong phần cài đặt với tính năng Thêm (Add), Xoá (Remove) và Chọn key chính (Manual Selection).
- **Quy tắc AI Commit**: Thêm file `.cursorrules` để chuẩn hoá thông điệp commit khi làm việc với AI.

### Changed
- Cập nhật `.gitignore` để loại bỏ các file rác như `.DS_Store`.
- Tự động di chuyển (migrate) API key cũ sang định dạng danh sách mới.

---

## [2.4.0] - 2026-03-10
### Added
- **Chế độ Giao diện (Theme)**: Thêm tuỳ chọn Sáng (Light), Tối (Dark) và Tự động (System) cho Card điều khiển.
- **CSS Variables**: Tái cấu trúc toàn bộ style bằng biến số để dễ dàng tuỳ biến giao diện.
- **OS Theme Listener**: Tự động đồng bộ giao diện theo thiết lập của hệ điều hành.

### Fixed
- Lỗi `500 Internal Error` của Gemini TTS bằng cách giảm kích thước chunk văn bản xuống 2500 ký tự.
- Cải thiện độ ổn định của API Preview bằng cách tối giản hoá System Instruction.

---

## [2.3.0] - 2026-03-06
### Added
- **Card UI Redesign**: Thay thế các nút nổi rời rạc bằng một khối giao diện Thẻ (Card) thống nhất, chuyên nghiệp.
- **Progress Bar**: Thanh tiến trình (0-100%) hiển thị tiến độ tạo âm thanh của Gemini AI.
- **Integrated Settings**: Phần cài đặt được tích hợp dạng accordion ẩn/hiện ngay trên card.
- **Roadmap**: Thêm file `roadmap.md` định hướng phát triển dự án.

### Changed
- Di chuyển vị trí Card sang phía bên phải màn hình để tránh che khuất nội dung truyện.

---

## [2.2.0] - 2026-03-04
### Added
- **Gemini TTS Integration**: Tích hợp hỗ trợ giọng đọc AI chất lượng cao từ Google AI Studio.
- **Engine Selector**: Tuỳ chọn chuyển đổi linh hoạt giữa Chrome TTS (miễn phí) và Gemini AI (truyền cảm).
- **Gemini Voice Selector**: Hỗ trợ list 30 giọng đọc AI khác nhau (Zephyr, Kore, Puck, v.v.).
- **Audio Chunking**: Logic chia nhỏ văn bản dài để xử lý qua giới hạn của mô hình ngôn ngữ.

---

## [2.1.0] - 2026-02-28
### Added
- **Background Service Worker**: Chuyển đổi logic phát âm thanh sang Service Worker (MV3) để đảm bảo hoạt động nền ổn định.
- **Chrome TTS API**: Sử dụng API hệ thống thay vì `window.speechSynthesis` để có giọng đọc Tiếng Việt tốt hơn.
- **Settings Persistence**: Lưu trữ cấu hình tốc độ (rate), tông giọng (pitch) qua `chrome.storage.local`.

---

## [2.0.0] - 2026-02-27
### Added
- **Floating Controls**: Lần đầu tiên đưa bảng điều khiển trực tiếp vào trang web thay vì dùng Popup như bản cũ.
- **Content Extraction**: Tự động nhận diện vùng chứa nội dung truyện trên `truyenfull.vision`.

---

## [1.0.0] - 2026-02-25
### Added
- Khởi tạo dự án extension cơ bản với tính năng đọc text đơn giản.
