# Roadmap - Đọc truyện Speech (Speech-to-Story)

Dưới đây là kế hoạch phát triển và những mục tiêu mở rộng dự kiến cho extension trong tương lai, nhằm mang lại trải nghiệm tiện lợi và phong phú hơn cho người dùng.

## Mục tiêu ngắn hạn (Short-term Goals)

- [x] **Chuyển đổi giao diện Sáng / Tối (Dark / Light Theme)**
  - Tích hợp nút chuyển đổi giao diện bảng điều khiển trực tiếp trên UI.
  - Tự động đồng bộ giao diện theo thiết lập giao diện hệ thống (System Preferences).

- [ ] **Mở rộng hỗ trợ trên các nền tảng truyện khác**
  - Tái cấu trúc logic lấy nội dung (content parser) để dễ dàng thêm các trang web mới.
  - Hỗ trợ thêm các trang web đọc truyện phổ biến khác ở Việt Nam (VD: TruyenQQ, TangThuVien, Wattpad...).
  - Thêm chức năng cho phép người dùng tự định nghĩa vùng (CSS Selector) chứa văn bản truyện trên các trang chưa được hỗ trợ sẵn.

- [x] **Quản lý đa dạng Gemini API Key**
  - Hỗ trợ lưu trữ nhiều API key.
  - Tự động chuyển đổi sang key dự phòng khi một key báo lỗi hết quota (vượt quá giới hạn của bản miễn phí).

- [ ] **Tự động chuyển chương (Auto-Next Chapter)**
  - Tự động nhận diện nút "Chương tiếp" và chuyển trang khi đọc xong hết nội dung chương hiện tại.
- [ ] **Phím tắt điều khiển (Keyboard Shortcuts)**
  - Gán phím tắt nhanh (vd: Alt + P, Alt + N) để điều khiển trình phát mà không cần dùng chuột.
- [ ] **Hẹn giờ tắt (Sleep Timer)**
  - Tính năng tự động dừng đọc sau một khoảng thời gian được đặt trước (15, 30, 60 phút).

## Mục tiêu dài hạn (Long-term Goals)

- [ ] **Highlight văn bản Karaoke (Karaoke Highlighting)**
  - Vừa đọc vừa highlight câu tương ứng trên trang web giúp người dùng dễ dàng theo dõi.
- [ ] **Chế độ trình phát thu nhỏ (Mini Player Mode)**
  - Giao diện player siêu tối gọn để tiết kiệm diện tích màn hình.
- [x] **Hiệu ứng sóng âm sống động (Wave Visualizer)**
  - Hiệu ứng sóng âm chạy động trên Card UI khi đang phát audiobook.
- [ ] **Đồng bộ tiến trình đọc (Sync Reading Progress)**
  - Lưu và đồng bộ tự động tiến độ nghe/đọc trên nhiều thiết bị (sử dụng `chrome.storage.sync` hoặc liên kết tài khoản).
- [ ] **Lưu cấu hình Custom Voice cho từng trang/truyện**
  - Ghi nhớ tùy chọn Voice của người dùng cho từng thể loại truyện.
- [ ] **Tối ưu khả năng đọc Offline (Offline TTS Mode)**
  - Cải thiện công cụ đọc bằng cách lưu lại bộ đệm âm thanh tải trước (preload buffer).
- [ ] **Phát hành chính thức lên Chrome Web Store**
  - Tối ưu hóa lại icon, chụp ảnh màn hình hướng dẫn và xuất bản extension để người dùng cài đặt dễ dàng hơn.
