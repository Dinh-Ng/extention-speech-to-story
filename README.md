# Đọc truyện Speech (Speech-to-Story)

Đọc truyện Speech là một Chrome Extension được thiết kế để trích xuất và đọc nội dung truyện tự động từ trang web **truyenfull.vision**. Extension cung cấp một giao diện người dùng trực quan, gọn gàng, dạng Floating Card tích hợp ngay trên trang web, mang lại trải nghiệm tiện lợi nhất cho người nghe truyện.

## Tính năng nổi bật

- **Tích hợp hai công cụ đọc (hỗ trợ Tiếng Việt)**:
  - **Chrome TTS**: Sử dụng Google TTS tích hợp sẵn trên trình duyệt. Nhanh, mượt mà và hỗ trợ tùy chỉnh tốc độ, cao độ, giọng nam/nữ.
  - **Gemini TTS (AI Voice)**: Sử dụng các mô hình ngôn ngữ AI của Google (Gemini 2.5) để tạo ra giọng đọc truyền cảm xúc, tự nhiên như audiobook. Hỗ trợ tới 30 giọng đọc AI khác nhau chuyên biệt.
- **Giao diện hiện đại**:
  - Giao diện dạng Floating Card (thẻ nổi) đẹp mắt ở góc màn hình.
  - Hỗ trợ đổi giao diện **Sáng/Tối** (hoặc tự động theo hệ thống).
  - Thanh tiến trình trực quan hiển thị phần trăm khi tạo audio từ AI.
- **Tính năng điều khiển đầy đủ**: Phát (Play), Tạm dừng (Pause), Tiếp tục (Resume), Dừng (Stop) và Tải lại chương (Reload).
- **Hỗ trợ truyện siêu dài**: Đối với engine Gemini, hệ thống tự động nhận diện và chia nhỏ văn bản vượt giới hạn giúp đảm bảo đọc trọn vẹn cả những chương truyện.
- **Voice Consistency**: Tự động áp dụng lệnh "System Instruction" cho Gemini AI, đảm bảo mô hình giữ một giọng đọc ổn định xuyên suốt toàn bộ diễn biến, không tự ý thay đổi giọng điệu ở các câu chèn hội thoại.

## Hướng dẫn cài đặt

Extension này chưa được tải lên Chrome Web Store. Để sử dụng, bạn cần cài đặt qua Developer Mode của Chrome:

1. Tải toàn bộ source code của extension này về máy hoặc `git clone` repository này.
2. Mở trình duyệt Chrome và dán vào thanh địa chỉ: `chrome://extensions/`
3. Bật **Chế độ dành cho nhà phát triển** (Developer mode) ở góc trên bên phải màn hình.
4. Nhấn vào nút **Tải tiện ích đã giải nén** (Load unpacked).
5. Chọn thư mục chứa source code của extension (thư mục chứa file `manifest.json`).
6. Extension đã sẵn sàng sử dụng!

## Hướng dẫn sử dụng

1. Truy cập vào bất kỳ chương truyện nào trên trang [truyenfull.vision](https://truyenfull.vision).
2. Khi trang được load xong, một thanh điều khiển **Đọc truyện Speech** sẽ xuất hiện ở góc dưới bên phải màn hình.
3. **Nếu bạn muốn dùng chế độ cơ bản (Chrome)**:
   - Tab "Chrome" được chọn sẵn.
   - Bạn chỉ cần bấm nút ▶ (Play) để bắt đầu nghe.
   - Bấm ⚙ *Cài đặt âm thanh* nếu cần đổi tốc độ, cao độ hay loại giọng hệ thống.
4. **Nếu bạn muốn dùng chế độ AI (Gemini TTS)**:
   - Click vào thẻ **Gemini** ở phần đầu Card để đổi công cụ.
   - Bấm ⚙ *Cài đặt âm thanh*.
   - Nhập **Google AI Studio API Key** của bạn vào ô tương ứng. (Lấy API Key miễn phí tại [Google AI Studio](https://aistudio.google.com/apikey)).
   - Chọn một trong số 30 giọng đọc.
   - Bấm ▶ (Play). Extension sẽ phân giải văn bản và tự động đồng bộ hóa để đọc cho bạn với tiến trình phần trăm rõ ràng.

## Cài đặt riêng tư & API

- **API Key được lưu trữ cục bộ**: API Key của Gemini chỉ được lưu trực tiếp trong bộ nhớ cục bộ (Local Storage) của trình duyệt bạn (`chrome.storage.local`). Hệ thống không gửi hay lưu trữ key này ở bất kì server bên thứ ba nào ngoại trừ server của Google Generative AI để tạo audio.
- Extension chỉ được cấp quyền hoạt động và trích xuất nội dung giới hạn duy nhất đối với tên miền `truyenfull.vision`.

## Khắc phục sự cố (Troubleshooting)

- **Lỗi không có giọng đọc (Gemini)**: Vui lòng kiểm tra lại tính hợp lệ của API Key, hoặc kiểm tra xem tài khoản giới hạn số lượng request đã cạn chưa. Bảng điều khiển (status bar) sẽ hiển thị thông báo lỗi chi tiết.
- **Đọc thiếu truyện/Ngắt đoạn giữa chừng**: Có thể do chương truyện đó không được load hết content từ website hoặc tab Chrome đã bị đưa vào chế độ ngủ (Sleep Tab). Thử tải lại trang hoặc bấm nút Load (⟲).
