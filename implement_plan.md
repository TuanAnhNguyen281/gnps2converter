# Implementation Plan — GNPS2 Converter

## Nâng cấp AI chatbot theo project và phiên nghiên cứu

**Ngày lập: 01/10/2026. Trạng thái: Đã triển khai MVP theo yêu cầu “triển khai” của người dùng.**

### Kết quả và xác minh ngày 01/10/2026

- Hoàn tất project, phiên nghiên cứu, gắn báo cáo, chat lưu PostgreSQL, lấy dữ liệu theo phạm vi và revision, nguồn bấm mở dòng, công cụ chỉ đọc, streaming/polling, dừng/thử lại, lịch sử và xuất Markdown/JSON.
- Hoàn tất provider/model, API key mã hóa, model mặc định theo tài khoản/project/phiên, catalog và nhập thủ công, usage, hạn mức và đơn giá tùy chọn với phiên bản được chụp tại mỗi lượt.
- Đã áp dụng migration 0002/0003 vào DB cấu hình; đã tạo khóa mã hóa local trong .env, không đưa secret vào mã nguồn hoặc tài liệu.
- Production build đạt; 63 kiểm thử trong 10 file đạt. Trình duyệt kiểm tra thao tác desktop/mobile sáng/tối đạt, không có page error; bằng chứng tại qa/research-ai/browser-results.json và ảnh cùng thư mục. Provider kiểm thử là giả lập trong DB bộ nhớ riêng.
- Project dùng lưu trữ (archive) thay cho xóa vĩnh viễn: automatic approval review từ chối thao tác xóa project kèm báo cáo/cloud do chưa được cho phép rõ. Xóa hội thoại có xác nhận, không xóa báo cáo và không đặt lại hạn mức ngày.
- Lịch sử dài dùng trích đoạn tóm tắt có giới hạn và version; giữ nguyên bản gốc. Các request chạy trong process có lease; restart làm lượt hết lease thành interrupted khi truy cập AI tiếp, không tự resume.
- Chưa xác minh API nhà cung cấp thật hoặc production. Bước sử dụng: khởi động lại ứng dụng, vào Cài đặt AI nhập provider/API key, tải hoặc thêm model, chat thử rồi chọn mặc định. Kiểm tra proxy SSE/cookie và giới hạn khi deploy.

### 1. Mục tiêu và quyết định thiết kế

Xây dựng trợ lý nghiên cứu ngay trong GNPS2 Converter: tự lấy dữ liệu đã lưu của project/phiên đang mở, trả lời về báo cáo và hợp chất, lưu toàn bộ hội thoại trong PostgreSQL, cho người dùng nhập API key và quản lý provider/model. Dùng `E:\nghich\learnwme` làm nguồn tham khảo cơ chế AI; dữ liệu và API key của hai ứng dụng độc lập.

- Giữ React/Vite + Express/TypeScript + PostgreSQL hiện tại; không bổ sung một DB hay dịch vụ vector cho bản đầu.
- Cấu trúc nghiệp vụ: **Tài khoản → Project → Phiên nghiên cứu → Hội thoại → Tin nhắn**. Project có nhiều báo cáo, một phiên có thể làm việc với nhiều báo cáo thuộc project đó.
- Phiên nghiên cứu là đối tượng lưu lâu dài, khác cookie phiên đăng nhập. Đóng trình duyệt, đăng nhập lại hoặc đổi model vẫn tiếp tục được phiên nghiên cứu.
- AI bản đầu đọc, phân tích, so sánh và gợi ý; việc sửa kết quả nghiên cứu vẫn do người dùng thực hiện. Không cấp quyền chạy SQL, shell hay tự sửa báo cáo cho model.
- Mỗi lượt chat ghi rõ model thực tế, nguồn dữ liệu và revision được sử dụng. Không xem lời giải thích AI là xác nhận định danh hợp chất.

### 2. Cơ sở từ mã nguồn đã kiểm tra

| Hệ thống | Hiện trạng đã đọc | Hướng áp dụng |
|---|---|---|
| GNPS2 `server/db/schema.ts`, `migrations/0001_accounts_reports.sql` | Có users, reports, report_rows, media_assets, report_assets; báo cáo có owner và revision | Mở rộng migration, giữ quyền sở hữu và cơ chế lưu hiện có |
| GNPS2 `server/app.ts`, `server/auth/*`, `server/reports/service.ts` | Session tài khoản, CSRF, kiểm tra owner, CRUD báo cáo và tệp | Dùng chung xác thực cho project/chat/provider |
| GNPS2 `src/Workspace.tsx`, `src/App.tsx`, `src/useReport.ts` | Workspace báo cáo, autosave, revision/conflict, chọn vùng bảng | Gắn chatbot với project/phiên/báo cáo; chờ lưu trước khi lấy context |
| Learnwme `backend/src/modules/api.ts` | CRUD provider, cấu hình model theo tác vụ, lịch sử hội thoại, gọi `/chat/completions`, usage | Tách thành module AI riêng; thích nghi cho nhiều tài khoản GNPS |
| Learnwme `backend/src/modules/providers/discovery.ts` | Tải `/models`, chuẩn hóa catalog, metadata/capabilities | Dùng ý tưởng catalog; có nhập model thủ công và kiểm tra bằng chat thật |
| Learnwme `backend/src/secrets.ts` | AES-256-GCM, IV ngẫu nhiên, authentication tag | Mã hóa key phía server, bổ sung key version/rotation |
| Learnwme `frontend/features/settings/SettingsScreen.tsx` | Nhập API, khám phá model, tìm model và bật nhiều model sử dụng | Thiết kế trang Cài đặt AI phù hợp giao diện GNPS |

Các điểm cần nâng cấp so với luồng chat tham khảo: request hiện dùng `stream:false`, lịch sử tối đa 30 message; user/assistant được lưu sau khi provider trả lời thành công. GNPS cần lưu user/request trước khi gọi provider, trạng thái lỗi/dừng, phân trang, thứ tự xác định, context theo revision và chống gửi trùng. Cần dùng user từ session GNPS, không mang cơ chế owner cấu hình cố định của ứng dụng tham khảo sang.

Khảo sát ban đầu dựa trên mã nguồn. Sau triển khai đã kết nối DB GNPS và áp dụng migration 0002/0003; chưa có credential provider để xác minh AI thật, chưa triển khai production.

### 3. Luồng sử dụng đề xuất

1. Vào **Cài đặt AI**: nhập tên provider, kiểu API, Base URL, API key → tải model → bật model → chọn mặc định → kiểm tra trả lời thử. Thông báo trước rằng phép thử chat có thể tính phí.
2. Tạo project với tên, mô tả và mục tiêu nghiên cứu; thêm báo cáo có sẵn hoặc nhập GNPS/TSV/XLSX mới vào project.
3. Mở project, tạo hoặc tiếp tục phiên; chọn báo cáo đang phân tích. Phiên lưu báo cáo đang mở, bộ lọc, sort và các row ID đang chọn. Trạng thái ghim/độ rộng cột hiện có tiếp tục dùng cơ chế cũ.
4. Mở bảng chat bên phải: nhìn thấy tên project, phiên, model và phạm vi dữ liệu. Trên mobile chuyển sang panel toàn màn hình có nút quay lại.
5. Mặc định context gồm mục tiêu project, thông tin phiên, tổng hợp báo cáo đang mở và các dòng được chọn. Người dùng có thể chuyển sang toàn báo cáo hoặc các báo cáo khác trong project.
6. Hỏi ví dụ: “Tóm tắt các hợp chất nổi bật”, “Các dòng đang chọn có ppm bất thường không?”, “So sánh kết quả hai báo cáo”. AI lấy dữ liệu qua công cụ đọc, trả lời kèm nguồn bấm được để mở báo cáo/dòng liên quan.
7. Có tạo hội thoại mới, đặt tên, tìm lịch sử, dừng trả lời, thử lại lượt lỗi, đổi model cho lượt tiếp theo và xuất lịch sử Markdown/JSON. Không cho sửa tin nhắn cũ trong MVP để tránh lịch sử bị phân nhánh ngầm.

### 4. Cơ chế tự lấy dữ liệu và quản lý context

Luồng: **Gửi câu hỏi → xác thực owner/project/phiên → đồng bộ báo cáo → tạo snapshot context → lấy dữ liệu cần thiết → gọi model → lưu kết quả/usage → hiện câu trả lời và nguồn**.

- Browser chỉ gửi ID và lựa chọn phạm vi; server kiểm tra quan hệ và lấy dữ liệu chuẩn từ DB. Không tin owner, row payload hoặc kết quả tổng hợp từ client.
- Khi báo cáo có thay đổi chưa lưu, đợi autosave thành công; gặp conflict/lỗi thì yêu cầu xử lý hoặc cho chọn dùng revision đã lưu, có nhãn rõ ràng. Không âm thầm gửi số liệu cũ.
- Một lượt sử dụng snapshot nhất quán của các báo cáo liên quan. Vì revision hiện tại không đảm bảo khôi phục được nội dung cũ, lưu payload đã dùng hoặc kết quả truy vấn trong snapshot DB, cùng hash, revision, row ID và thời điểm; không chỉ lưu revision tham chiếu.
- Mặc định gửi tổng hợp và tập dòng liên quan, không đẩy toàn bộ hàng nghìn dòng vào prompt. Lọc/tính thống kê phía server trên đầy đủ dữ liệu; phân trang và giới hạn đầu ra, ghi rõ số dòng đã xét, đã trả và bị cắt.
- Công cụ đọc dự kiến: `get_project_overview`, `list_project_reports`, `get_report_summary`, `query_report_rows`, `get_compound_details`, `compare_reports`. Schema đầu vào dùng allowlist trường/toán tử, validator; SQL tham số hóa do ứng dụng tạo. Server tự gắn owner/project, model không được mở rộng phạm vi.
- So sánh cần quy tắc rõ: mặc định ưu tiên mã thư viện/định danh hợp chất có sẵn; nếu chỉ khớp tên thì ghi “khớp theo tên”, không khẳng định cùng chất. Chuẩn hóa đơn vị và thông báo thiếu dữ liệu.
- Model có tool calling được dùng vòng lặp tối đa 4 lần/lượt; model không hỗ trợ vẫn dùng context tổng hợp và truy vấn xác định của ứng dụng, nêu giới hạn thay vì giả vờ đã gọi công cụ.
- Ngân sách context cấu hình theo model; ưu tiên câu hỏi, dữ liệu hiện tại, lượt gần nhất, sau đó tóm tắt lịch sử. Tóm tắt lưu version và message range, không xóa bản gốc; thay đổi dữ liệu làm mất hiệu lực cache/tóm tắt dữ liệu liên quan.
- Thông tin trong tệp, metadata và tin nhắn được xem là dữ liệu không đáng tin, không được đổi system instruction hoặc quyền công cụ. Không tải tùy ý URL do model tạo.
- Nguồn dẫn do server dựng từ dữ liệu đã truy xuất: report ID, revision, row ID, trường/giá trị, snapshot ID. Kiểm tra nguồn trước khi render; tách nhận xét suy luận khỏi dữ liệu thực.
- Bản đầu đọc kết quả phân tích có cấu trúc trong DB và metadata tệp; không hứa đọc nội dung PDF/Word, ảnh phổ hoặc cấu trúc hóa học bằng vision. OCR, tài liệu dài và RAG thuộc giai đoạn sau.

### 5. Provider, API và quản lý model

- MVP hỗ trợ adapter **OpenAI-compatible Chat Completions** cho endpoint thực sự tương thích. Thiết kế interface `discoverModels`, `testChat`, `generate`, `stream`, `normalizeUsage`, `capabilities` để thêm OpenAI Responses và Anthropic native ở giai đoạn sau.
- Không giả định mọi provider đều có `/models`, tool calling, streaming hoặc cùng tham số. Catalog có nhập thủ công, model bật/tắt, context limit, max output, khả năng tools/streaming và trạng thái xác minh; giá trị chưa xác minh được ghi rõ.
- Tách “kết nối/tải model thành công” khỏi “chat thử thành công”. Tải catalog không chứng minh key có quyền sử dụng từng model.
- Thứ tự model: lựa chọn lượt hiện tại → cấu hình phiên → cấu hình project → mặc định tài khoản. Chỉ cho dùng provider/model thuộc tài khoản và đang bật; lưu lựa chọn thực tế từng lượt.
- Không tự chuyển provider khi lỗi. Lựa chọn thử lại/đổi model hiển thị rõ vì thay đổi provider có thể gửi dữ liệu sang một bên khác.
- API key chỉ gửi khi tạo/thay key, mã hóa AES-256-GCM tại server; UI chỉ nhận `apiKeyConfigured` và phần che. Khóa mã hóa riêng tối thiểu 32 byte, khác session secret, kèm key version và quy trình đổi khóa. Không log key, không lưu trong localStorage hoặc prompt.
- Base URL HTTPS ở production; chặn localhost/private/link-local/metadata endpoint, URL có credential, redirect không được kiểm tra và DNS rebinding; giới hạn egress/provider allowlist khi triển khai. Provider local chỉ là tính năng riêng khi có cấu hình môi trường cho phép.
- Theo dõi token nếu provider trả usage; thiếu usage ghi “không xác định”. Chi phí chỉ là ước tính theo đơn giá người dùng cấu hình và version, không mặc định bằng 0. Giới hạn số lượt đồng thời, lượt/ngày và output; dự toán token trước request, quyết toán sau. Token thật do provider quyết định nên giới hạn dự toán không đảm bảo hóa đơn tuyệt đối.
- Trang cấu hình cho biết dữ liệu nào sẽ gửi ra provider; chat chỉ bắt đầu sau thao tác người dùng. Không tự gửi dữ liệu project khi vừa mở trang.

### 6. Thiết kế DB dự kiến

Giữ PostgreSQL hiện tại. Tên bảng dưới đây là thiết kế đề xuất, khóa UUID, timestamp có timezone, text dài có giới hạn ứng dụng.

| Bảng | Nội dung và ràng buộc chính |
|---|---|
| `projects` | owner_id, name, description, research_goal, archived_at; unique(id, owner_id) |
| `reports.project_id` | Nullable cho báo cáo cũ; FK có owner để báo cáo không gắn project tài khoản khác; một báo cáo thuộc tối đa một project |
| `research_sessions` | owner_id, project_id, title, status, active_report_id, view_state JSONB, model override, last_active_at |
| `ai_providers` | owner_id, name, adapter_type, base_url, encrypted_secret, iv, tag, key_version, enabled |
| `ai_provider_models` | provider_id, model_id, display_name, capabilities, limits, enabled, discovered_at; unique(provider_id, model_id) |
| `ai_settings` | default tài khoản/project/phiên, provider/model, giới hạn; kiểm tra scope và ownership |
| `ai_conversations` | owner_id, project_id, research_session_id, title, summary, summary_version, summary_until_seq, archived_at |
| `ai_messages` | conversation_id, sequence, role, content/parts JSONB, status, parent/request ID, provider/model snapshot, created_at; unique(conversation_id, sequence) |
| `ai_requests` | owner/conversation, client_request_id, state, model/provider, context_snapshot_id, error_code, started/ended; unique(owner_id, client_request_id) |
| `ai_context_snapshots` | project/session, report revisions, selection/filter, actual normalized payload/tool outputs, hash, prompt_version, budget/truncation metadata |
| `ai_tool_runs` | request_id, tool_name, validated arguments, snapshot/result reference, duration/status; không lưu key |
| `ai_usage` | request_id, input/output/cache tokens nullable, usage source, estimate/pricing version; unique(request_id) cho quyết toán cuối |

Tất cả đường truy xuất kiểm tra owner qua quan hệ cha; bổ sung FK composite khi phù hợp và index theo owner/project/updated_at, conversation/sequence. Giao dịch ngắn, không giữ transaction khi chờ provider. Hạn mức lưu chat/context riêng với quota media; giới hạn snapshot bytes, phân trang lịch sử.

Project được archive trước; báo cáo cũ nằm trong “Báo cáo chưa thuộc project”, người dùng tự gắn, không tự gom tùy ý. MVP không chuyển báo cáo đã được dùng trong chat sang project khác; có thể tạo bản sao nếu cần. Xóa project có màn hình nêu rõ dữ liệu sẽ xóa; xóa các phiên/chat/snapshot/usage liên quan và gọi đúng quy trình xóa báo cáo/media hiện có, giữ cơ chế retry xóa cloud. Không chỉ dựa vào cascade DB để xóa tệp cloud.

### 7. API và độ tin cậy của chat

- `/api/projects`: CRUD/archive và danh sách báo cáo; gắn báo cáo vào project qua endpoint có kiểm tra owner.
- `/api/projects/:projectId/research-sessions`: tạo/liệt kê phiên; endpoint phiên để tiếp tục, cập nhật trạng thái và context selection.
- `/api/ai/providers`: CRUD; `/:id/models`, `/:id/discover-models`, `/:id/test`; `/api/ai/settings` cho các scope.
- `/api/research-sessions/:id/conversations`: tạo/liệt kê; `/api/ai/conversations/:id/messages` phân trang theo sequence; rename/archive/delete/export.
- `POST /api/ai/conversations/:id/messages`: kèm client request ID, message, scope, optional model override; trả request ID sau khi đã lưu DB.
- `GET /api/ai/requests/:id/events`: SSE có xác thực; sự kiện `context`, `tool`, `delta`, `usage`, `done`, `error`. `POST /api/ai/requests/:id/cancel` để dừng. SSE dùng cookie cùng origin, CORS cụ thể nếu khác origin; không bỏ CSRF cho POST.
- Lưu user message và request trước khi gọi API. Một lượt chạy đồng thời cho mỗi conversation bằng khóa DB/unique constraint; chống double click và retry trùng. Retry lượt lỗi tạo attempt mới có liên kết, không chèn thêm user message vô tình.
- Chuỗi trạng thái: queued → running → completed/failed/cancelled/interrupted. Lưu output từng đợt, không ghi mỗi token; chỉ `completed` được xem là câu trả lời hoàn chỉnh. Lỗi provider vẫn giữ câu hỏi và lỗi đã làm sạch.
- SSE mất kết nối không tự gọi lại model. Kết nối lại đọc trạng thái và nội dung đã lưu; timeout/cancel abort upstream khi hỗ trợ, usage có thể chưa đầy đủ. Provider có thể tính phí dù request lỗi.
- MVP chạy request trong một backend process, với concurrency limit và lease/heartbeat DB. Restart đánh dấu request hết lease thành interrupted, cho retry thủ công. Không tuyên bố tác vụ tồn tại qua restart; worker/queue bền vững là giai đoạn sau.
- Production cần kiểm tra proxy không buffer SSE, heartbeat, timeout trên Vercel/Render và cookie/CORS. Nếu nền tảng không đáp ứng, dùng polling trạng thái làm phương án thay thế và giữ nguyên lưu DB.

### 8. Giao diện và tệp dự kiến thay đổi

- `src/Workspace.tsx`, `src/Dashboard.tsx`: điều hướng project, phiên nghiên cứu, Cài đặt AI và danh sách lịch sử.
- `src/App.tsx`, `src/useReport.ts`: project cho import/lưu báo cáo, đồng bộ context với autosave và bảng chọn dòng; tách phần AI ra component để tránh tăng thêm độ phức tạp App.
- Mới `src/ai/*`: ChatPanel, ConversationList, AiSettings, ModelPicker, ContextSources, hook stream; `src/projects/*`: ProjectList/ProjectDetail/ResearchSessionPicker.
- `src/api.ts`, `src/types.ts`, stylesheet hiện tại: API/kiểu dữ liệu mới, panel desktop/mobile, theme sáng/tối, Markdown render an toàn không chạy HTML tùy ý.
- Mới `server/ai/*`: routes, providers/adapters, secrets, context, tools, orchestration, persistence, usage; `server/projects/*`, `server/research-sessions/*`.
- `server/app.ts`, `server/config.ts`, `server/db/schema.ts`, migration SQL mới, report service/validation và import routes: đăng ký route, biến môi trường, scope project. Không sửa migration đã áp dụng.
- `.env.example` và tài liệu triển khai: encryption key, allowlist, timeout, token/output/concurrency/storage limits; không đưa secret thật vào tài liệu.

### 9. Phân kỳ triển khai

| Giai đoạn | Đầu ra | Điều kiện hoàn thành |
|---|---|---|
| 1. Nền tảng project/phiên | Migration, CRUD, gắn báo cáo, workspace | Dữ liệu cũ dùng được; không truy cập chéo tài khoản/project |
| 2. API/model | Mã hóa key, catalog, model thủ công, chat test, settings | Key không lộ; chọn model đúng scope; lỗi cấu hình rõ ràng |
| 3. Chat lưu DB | Hội thoại/message/request, streaming/polling, cancel/retry | Refresh giữ lịch sử, lỗi vẫn lưu câu hỏi, gửi trùng không sinh lượt mới |
| 4. Context nghiên cứu | Snapshot, tools đọc, aggregate/compare, dẫn nguồn | Lấy đúng báo cáo/revision, dữ liệu lớn không bị ngầm cắt |
| 5. Hoàn thiện và nghiệm thu | Mobile/theme, quota/usage, export/delete, tài liệu | Test tích hợp, tương tác thật và smoke production đạt |

MVP gồm cả 5 giai đoạn. Mỗi giai đoạn có thể review riêng nhưng bản chat chỉ được coi là đạt mục tiêu sau khi có context project/phiên và kiểm tra ở giai đoạn 4–5. Sau MVP: native Responses/Anthropic adapters, đọc tài liệu/OCR/vision, RAG khi có nhu cầu thực, background worker và đề xuất chỉnh báo cáo có diff để người dùng duyệt.

### 10. Kiểm thử và nghiệm thu bắt buộc

1. Hai tài khoản không đọc/sửa provider, model, project, phiên, message, SSE, snapshot hoặc tệp của nhau; thử ID sai scope và CSRF.
2. Báo cáo cũ, import GNPS/TSV/XLSX, autosave/conflict, chọn/ghim vùng bảng và xuất Excel/Word giữ hành vi hiện có.
3. Mở lại phiên sau refresh/login lấy đúng project/báo cáo/lịch sử; đổi project không mang selection/chat/context sang project khác.
4. Dữ liệu fixture biết trước: đếm/lọc/ppm/so sánh phải đúng khi có hàng nghìn dòng; câu trả lời dẫn nguồn đúng row/revision; báo cáo thay đổi giữa lượt không làm snapshot bị trộn.
5. Model discovery lỗi/không hỗ trợ, model thủ công, model tắt, key sai, quota, 429/5xx, timeout, provider thiếu usage/tool/stream đều có hành vi rõ ràng.
6. Double click, nhiều tab, cancel, SSE disconnect/reconnect và backend restart không mất user message, không tạo request trùng; output chưa xong được ghi trạng thái đúng.
7. Kiểm tra secret không xuất hiện trong response/log/export/prompt; SSRF với private IP/redirect/DNS; prompt injection không mở quyền công cụ; Markdown không chạy script.
8. Chạy typecheck/build, test context/tool/scope/request-state và integration bằng provider giả lập; không cần dùng API trả phí cho CI. Kiểm tra trình duyệt bằng thao tác thật trên desktop/mobile và hai theme.
9. Khi có môi trường/key phù hợp: chat provider thật, cookie/CSRF, lưu DB sau reload, stream/cancel và dữ liệu revision trên deployment. Build/test nội bộ không thay cho nghiệm thu này.

### 11. Quyết định mặc định để review

- Project cá nhân theo owner, chưa có chia sẻ/team/role mới.
- Một project nhiều báo cáo; nhiều phiên và nhiều hội thoại; mỗi lượt chat chỉ đọc trong một project.
- PostgreSQL hiện tại lưu chat và snapshot; key riêng cho mỗi tài khoản; một model mỗi lượt, không gọi đồng thời nhiều model.
- Chat ở panel trong màn báo cáo và trang hội thoại đầy đủ; nguồn là dữ liệu đã lưu; model/API do người dùng cung cấp.
- Người dùng đã review và yêu cầu **“triển khai”**; việc sửa hệ thống đã được thực hiện, theo chỉ dẫn AGENTS.md: “Đối với những yêu cầu phải xử lý với khối lượng công việc, nghiệp vụ nhiều cần tạo implement_plan.md để review trước khi thực hiện”.

### 12. Tài liệu kỹ thuật tham khảo

- OpenAI Function calling: https://developers.openai.com/api/docs/guides/function-calling — luồng công cụ, schema và kiểm tra đầu vào.
- OpenAI Streaming: https://developers.openai.com/api/docs/guides/streaming-responses — sự kiện streaming; adapter chuẩn hóa về sự kiện nội bộ.
- Claude Streaming: https://platform.claude.com/docs/en/build-with-claude/streaming — cơ chế streaming riêng cho adapter native ở giai đoạn sau.

Không cố định tên model hay giá từ tài liệu; catalog thực tế và cấu hình tài khoản là nguồn khi triển khai.

## Ghim hàng và cột trong bảng kết quả

**Trạng thái: Đã triển khai theo kế hoạch được người dùng duyệt bằng yêu cầu “triển khai”.**

### Hiện trạng theo mã hiện tại

- Bảng đã ghim cố định checkbox chọn dòng, STT và tên hoạt chất; các cột còn lại cuộn ngang cùng bảng.
- Bảng hỗ trợ chọn ô, kéo vùng, Shift/Ctrl+click và sao chép TSV. Dữ liệu hàng đang theo thứ tự lọc/sắp xếp; độ rộng cột đã lưu trong trình duyệt.
- Chưa có trạng thái hàng/cột do người dùng ghim. Ghim cột tùy ý cần đồng bộ thứ tự header, ô dữ liệu, vùng chọn và nội dung clipboard.

### Phạm vi và hành vi đề xuất

1. Thêm **Ghim hàng** và **Ghim cột** trên thanh công cụ bảng; thao tác dựa trên vùng đang chọn. Một ô ghim hàng/cột chứa ô đó; vùng chọn nhiều ô ghim các hàng và cột có mặt trong vùng; Ctrl/Cmd chọn rời thì chỉ ghim hàng/cột có ô được chọn. Nút đổi sang **Bỏ ghim** khi phần đang chọn đã được ghim.
2. Hiển thị hàng ghim trong dải ngay dưới header và giữ dải này đứng yên khi cuộn dọc; loại các hàng đó khỏi thân bảng cuộn để không hiện hai lần. Giữ thứ tự lọc/sắp xếp hiện tại trong nhóm ghim. Hàng bị bộ lọc ẩn sẽ tạm không hiện nhưng vẫn giữ trạng thái ghim.
3. Đưa cột ghim vào dải cố định bên trái, sau checkbox, STT và tên hoạt chất. Giữ thứ tự tương đối ban đầu giữa các cột ghim; cột chưa ghim tiếp tục cuộn ngang. Tính vị trí sticky theo độ rộng hiện tại để thao tác resize không làm chồng cột.
4. Lưu các cột ghim và ID hàng ghim trong `localStorage` theo báo cáo hiện tại. Khi đổi báo cáo, nạp cấu hình của báo cáo đó; có thao tác bỏ ghim vùng chọn và bỏ ghim tất cả.
5. Vùng chọn và TSV phải theo thứ tự đang nhìn thấy: hàng ghim trước, sau đó hàng cuộn; cột ghim trước, sau đó các cột còn lại. Không đổi thứ tự/dữ liệu của xuất Excel/Word hiện có và không thay API/backend.
6. Thể hiện trạng thái ghim bằng biểu tượng và tooltip truy cập được bằng bàn phím; giữ khả năng chọn ô, lọc/sắp xếp, copy, đổi độ rộng cột, theme sáng/tối và cuộn dọc/ngang.

### Tệp dự kiến thay đổi

- `src/App.tsx`: nút ghim/bỏ ghim, lưu trạng thái theo báo cáo, sắp xếp nhóm hàng/cột nhìn thấy và tính vị trí sticky.
- `src/result-table-grid.ts`, `src/result-table-grid.test.ts`: chuyển đổi selection sang các hàng/cột ghim, thứ tự hiển thị và TSV theo thứ tự nhìn thấy.
- `src/workspace.css`, `src/styles.css`: dải hàng ghim, cột ghim, phân lớp sticky và dấu hiệu trạng thái ở cả hai theme.
- Không sửa dữ liệu báo cáo, API hoặc pipeline xuất Excel/Word.

### Tiêu chí nghiệm thu

- Ghim được một/nhiều hàng và cột từ ô/vùng chọn; bỏ ghim riêng vùng chọn hoặc toàn bộ; trạng thái được nhớ riêng cho từng báo cáo sau tải lại.
- Hàng ghim luôn nằm ngay dưới header và không lặp trong phần cuộn; cột ghim nằm sau các cột nhận diện và không che nội dung khi kéo thay đổi độ rộng.
- Lọc, sắp xếp, vùng chọn, Ctrl/Cmd+C và nút copy hoạt động theo thứ tự hiển thị sau khi ghim; xuất Excel/Word giữ nguyên kết quả trước đây.
- `npm run build`, test thứ tự ghim/TSV và `git diff --check` đạt; kiểm tra trình duyệt trên cuộn dọc/ngang, resize, theme sáng/tối.

### Kết quả triển khai

- Đã thêm nút ghim/bỏ ghim hàng và cột theo vùng chọn, cùng nút bỏ ghim tất cả; lựa chọn Ctrl/Cmd rời nhau chỉ tác động lên hàng/cột có ô được chọn.
- Hàng ghim được gom ngay dưới tiêu đề và giữ vị trí khi cuộn; cột ghim nằm sau STT/tên hoạt chất, giữ thứ tự gốc và tính lại offset theo độ rộng cột.
- Trạng thái ghim được lưu riêng theo ID báo cáo; ghim tạm của báo cáo mới được chuyển sang ID sau khi tự lưu thành công.
- Copy/TSV tuân theo thứ tự nhìn thấy sau ghim. Xuất Excel/Word và API không thay đổi.
- Kiểm tra: `npm run build`, toàn bộ test và `git diff --check` đạt. Chưa xác nhận tương tác trực tiếp trong trình duyệt với báo cáo đã đăng nhập.

## Hoàn thiện thao tác Excel và phân cấp chữ song ngữ trong bảng báo cáo

**Trạng thái: Đã triển khai theo kế hoạch được người dùng duyệt bằng yêu cầu “triển khai”.**

### Hiện trạng theo ảnh và mã hiện tại

- Ảnh cho thấy dòng tiếng Anh đang mảnh/nhạt và dòng tiếng Việt đậm; nhiều đoạn chữ xanh chọn kiểu trình duyệt đang phủ lên nội dung bảng.
- Bảng đã có chọn ô, chọn cột qua tiêu đề, chọn hàng qua STT, Shift+click mở rộng hình chữ nhật, Ctrl+C/Cmd+C và nút sao chép TSV. Chưa có Ctrl/Cmd+click để chọn ô rời nhau, cũng chưa hỗ trợ kéo chuột để quét vùng.
- Tên hợp chất hiện chỉ hiện nút **Sửa** khi rê chuột; các giá trị khác đang khóa. Các cột có độ rộng CSS cố định, chưa có tay nắm để người dùng thay đổi.
- Hộp xem hợp chất và một số biểu mẫu báo cáo có style nhãn/ô nhập riêng; cần đồng bộ phân cấp tiếng Anh/tiếng Việt và trạng thái focus với bảng.

### Phạm vi và hành vi đề xuất

1. **Thứ bậc chữ:** dòng tiếng Anh ở trên, đậm và rõ; dòng tiếng Việt ở dưới, nhẹ/nhạt hơn. Áp dụng đồng nhất cho tiêu đề cột, nhãn trong thanh công cụ bảng và biểu mẫu/hộp chỉnh sửa của màn báo cáo. Giữ nguyên ngôn ngữ của điều hướng và màn đăng nhập ngoài phạm vi báo cáo.
2. **Co giãn cột:** thêm tay nắm kéo ở mép phải mỗi cột dữ liệu, cập nhật đồng bộ header và các ô cùng cột. Cho chỉnh độc lập cả cột metadata, đặt giới hạn tối thiểu để chữ và nút thao tác còn dùng được, giữ cuộn ngang trong bảng. Lưu độ rộng theo khóa cột trong trình duyệt để không mất sau khi tải lại; giữ vị trí cố định của cột chọn, STT và tên hợp chất.
3. **Chỉnh sửa:** tên hợp chất luôn là ô nhập trực tiếp, không cần bấm nút mở sửa; thay đổi dùng autosave hiện có. Thêm nút **Sửa tất cả** trên thanh công cụ để bật/tắt sửa các trường giá trị còn lại, gồm RT, ion, m/z, mảnh vỡ, công thức, ppm và metadata nguồn. Khi tắt, các trường đó chỉ đọc. Giữ checkbox chọn dòng, STT và ảnh cấu trúc ở chức năng riêng; khi sửa số vẫn giữ kiểu số, không biến metadata số thành chuỗi.
4. **Chọn kiểu Excel:** click chọn một ô; kéo chuột hoặc Shift+click mở rộng vùng chữ nhật; Ctrl/Cmd+click thêm/bỏ ô rời nhau mà không xóa vùng hiện có. Ctrl+C/Cmd+C và nút **Sao chép** đưa vùng vào clipboard dạng TSV theo thứ tự đang lọc/sắp xếp. Khi vùng gồm các ô rời, giữ tọa độ hàng/cột bằng ô trống tại các vị trí không chọn.
5. **Bỏ bôi chữ trình duyệt:** tắt native text selection trên ô dữ liệu và tiêu đề bảng để thao tác chọn vùng chỉ dùng vùng chọn của bảng; vẫn cho chọn/copy văn bản bình thường bên trong ô nhập tên, các ô đang bật **Sửa tất cả**, ô tìm kiếm và biểu mẫu. Ctrl+C trong ô nhập giữ chức năng copy văn bản đã bôi trong ô đó.
6. Giữ trạng thái chọn dễ nhìn ở cả theme sáng/tối; tay nắm resize và nút **Sửa tất cả** có tooltip/nhãn truy cập bàn phím. Không để kéo cột vô tình chọn ô hoặc kéo văn bản.

### Tệp dự kiến thay đổi

- `src/App.tsx`: tên hợp chất nhập trực tiếp; bật/tắt sửa tất cả; resize handles; chọn ô bằng click/kéo/Shift/Ctrl; copy đa vùng TSV.
- `src/result-table-grid.ts`, `src/result-table-grid.test.ts`: mô hình selection đơn/rời nhau, vùng copy và định dạng TSV.
- `src/styles.css`, `src/workspace.css`: tiếng Anh đậm, tiếng Việt nhạt trên bảng và biểu mẫu báo cáo; bỏ native text selection trong grid; tay nắm cột, trạng thái focus/chọn và bố cục gọn.
- Không đổi API hoặc cấu trúc xuất Excel/Word; dùng cơ chế lưu báo cáo hiện tại.

### Tiêu chí nghiệm thu

- English bold ở dòng trên và tiếng Việt nhạt ở dòng dưới tại cả header và biểu mẫu thuộc màn báo cáo.
- Kéo chỉnh từng cột không làm lệch dữ liệu, sticky columns, sort/filter hoặc cuộn trang; độ rộng được nhớ khi tải lại.
- Tên hợp chất sửa được ngay. Các trường khác khóa mặc định và chỉ đổi được khi bật **Sửa tất cả**; tắt chế độ thì trường quay lại chỉ đọc.
- Click, kéo, Shift+click và Ctrl/Cmd+click cho vùng chọn rõ ràng; Ctrl+C/Cmd+C dán đúng hàng/cột vào Excel kể cả khi có các ô rời.
- Văn bản trong grid không còn bị trình duyệt bôi xanh mặc định; ô nhập vẫn chọn/copy văn bản bình thường.
- `npm run build`, test vùng chọn/TSV/chỉnh sửa và `git diff --check` đạt; kiểm tra trực quan desktop/mobile, hai theme, resize, chọn vùng và clipboard.

### Kết quả triển khai

- Đảo thứ bậc nhãn: English đậm ở trên, tiếng Việt nhẹ hơn ở dưới trong tiêu đề bảng, nút thao tác bảng và nhãn của hộp thông tin hợp chất.
- Gắn tay nắm kéo vào từng cột dữ liệu, hỗ trợ phím mũi tên để chỉnh độ rộng và lưu kích thước theo từng cột trong trình duyệt; các cột chọn, STT và tên hoạt chất vẫn sticky.
- Tên hoạt chất nhập trực tiếp và tự lưu. Nút **Edit all / Sửa tất cả** mở khóa các trường RT, ion, m/z, mảnh vỡ, công thức, ppm và metadata; khi tắt, chúng trở về chỉ đọc.
- Thêm kéo chọn vùng, Shift+click mở rộng vùng, Ctrl/Cmd+click thêm hoặc bỏ ô rời; sao chép giữ hình chữ nhật TSV với ô trống cho khoảng bị bỏ qua. Tắt bôi chữ mặc định của trình duyệt trong bảng, vẫn giữ chọn/copy bên trong ô nhập.
- Kiểm chứng: `npm run build` đạt; `npm test -- --run` đạt **36/36**; `git diff --check` đạt. Trang ứng dụng local tải và không có lỗi console. Phiên kiểm tra chưa đăng nhập nên bảng báo cáo không được render để xác nhận trực quan resize/clipboard trên desktop/mobile và cả hai theme.

## Bảng kết quả gọn như Excel, sao chép và khóa dữ liệu nguồn

**Trạng thái: Đã triển khai theo kế hoạch được người dùng duyệt.**

### Hiện trạng đã kiểm tra

- Màn chi tiết báo cáo trong `src/App.tsx` hiển thị bảng kết quả với 46 trường nguồn ở ảnh mẫu. RT, tên hợp chất, ion, m/z, mảnh vỡ, công thức và ppm hiện đều là ô nhập sửa trực tiếp; metadata GNPS là ô chỉ đọc và có nút copy riêng.
- `src/styles.css` và `src/workspace.css` cùng định nghĩa kích thước bảng. Padding hàng trong workspace là 14px mỗi phía; ảnh cấu trúc là 90 × 65px cộng viền, padding và dòng chữ “Xem chi tiết”. Cột RT bị đặt min-width 110px ở cuối `workspace.css`.
- Header chính đang đặt tiếng Việt trên, tiếng Anh dưới. Nút lọc/sắp xếp nằm trong header; bảng có cột checkbox, STT và tên hợp chất cố định. Checkbox chọn dòng hiện dùng cho báo cáo/xuất, cần giữ độc lập với vùng chọn để copy.

### Phạm vi và hành vi đề xuất

1. Thu chiều cao hàng, padding và cỡ ảnh; giảm độ rộng tối thiểu của các cột theo loại dữ liệu để hiện nhiều trường hơn trên desktop. Giữ cuộn ngang trong bảng, nội dung dài được cắt gọn với tooltip/chi tiết đầy đủ, không làm mất dữ liệu gốc. Giữ kích thước chạm và khả năng đọc trên màn nhỏ.
2. Đổi header thành **English ở trên, tiếng Việt ở dưới** cho các cột chuẩn và metadata. Giữ tên khóa gốc của trường nguồn ở dòng tiếng Anh; dùng bản dịch hiện có ở dòng tiếng Việt. STT và cột chọn có nhãn phù hợp; menu sắp xếp vẫn hoạt động.
3. Hiển thị RT, ion, m/z, mảnh vỡ, công thức, ppm và toàn bộ metadata ở chế độ chỉ đọc; không mở chỉnh sửa bằng double-click, gõ phím hay paste. Giữ checkbox chọn dòng và các thao tác xem ảnh/chi tiết. Chỉ tên hợp chất có nút **Sửa** theo từng dòng; bấm nút mới mở ô nhập, có Lưu/Hủy và hỗ trợ Enter/Escape. Chỉ thay đổi đã xác nhận mới đi qua cơ chế tự lưu hiện có.
4. Cho phép click chọn một ô, click tiêu đề chọn cả cột, click STT chọn cả hàng trong thứ tự đang lọc/sắp xếp; Shift+click chọn dải ô. Ctrl+C/Cmd+C và nút Sao chép sẽ đưa nội dung đã chọn vào clipboard dạng TSV để dán vào Excel. Với hàng/cột nhiều ô, dùng tab giữa cột và xuống dòng giữa hàng; ô ảnh xuất giá trị text/URL phù hợp thay vì bitmap. Vùng chọn để copy không thay đổi checkbox xuất báo cáo.
5. Làm rõ trạng thái ô/hàng/cột đang chọn, hỗ trợ điều hướng mũi tên/Tab cơ bản, focus bàn phím và thông báo copy thành công/lỗi. Không chặn copy văn bản thông thường khi đang nhập tên hợp chất hay dùng ô tìm kiếm.

### Tệp dự kiến thay đổi

- `src/App.tsx`: chuyển ô dữ liệu sang chỉ đọc, nút sửa tên hợp chất, mô hình vùng chọn/copy và thứ tự header.
- `src/styles.css`, `src/workspace.css`: độ rộng cột, padding, ảnh cấu trúc, trạng thái chọn/focus, responsive và hai theme.
- Test tập trung vào phép tạo TSV theo thứ tự hiển thị, vùng chọn hàng/cột, dữ liệu rỗng và quy tắc chỉ cho sửa tên hợp chất; không thay đổi định dạng xuất Excel/Word hay dữ liệu backend.

### Tiêu chí nghiệm thu

- Ở khung desktop như ảnh, thấy nhiều cột hơn và hàng thấp hơn rõ rệt; ảnh gọn nhưng vẫn mở xem chi tiết được. Không có cuộn ngang toàn trang.
- Tất cả header hai dòng đúng thứ tự English/tiếng Việt; lọc/sắp xếp và cột cố định hoạt động.
- Dán một ô, một hàng, một cột và dải ô sang Excel giữ đúng vị trí hàng/cột; copy phản ánh thứ tự lọc/sắp xếp hiện tại.
- Các trường ngoài tên hợp chất không thể sửa trên giao diện; sửa tên cần bấm nút và Lưu, sau đó autosave/reload giữ tên mới. Checkbox chọn báo cáo, xuất Excel/Word và xem ảnh vẫn hoạt động.
- `npm run build`, test liên quan và `git diff --check` đạt; kiểm tra trực quan desktop/mobile, sáng/tối và thao tác bàn phím/clipboard trong trình duyệt.

### Kết quả triển khai

- Thu nhỏ cột STT, RT, tên hợp chất, các trường phân tích và metadata; giảm padding hàng cùng kích thước ảnh cấu trúc, vẫn giữ nút mở chi tiết.
- Đổi toàn bộ tiêu đề bảng thành tiếng Anh ở dòng trên, tiếng Việt ở dòng dưới; tách công thức và sai số ppm thành hai cột để khi sao chép khớp cấu trúc Excel.
- Khóa RT, ion, m/z, mảnh vỡ, công thức, ppm và metadata trong bảng lẫn hộp chi tiết. Tên hợp chất chỉ sửa sau khi bấm **Sửa**, xác nhận bằng **Lưu**; tự lưu theo cơ chế hiện tại.
- Thêm chọn ô, chọn cột bằng tiêu đề, chọn hàng bằng STT, mở rộng vùng bằng Shift+click, di chuyển bằng phím mũi tên/Tab, Ctrl+C và nút **Sao chép** dạng TSV. Bản sao theo thứ tự lọc/sắp xếp; checkbox chọn dòng cho báo cáo độc lập.
- Kiểm chứng: `npm run build` đạt; `npm test` đạt **34/34** (tăng 3 kiểm thử cho chọn vùng/TSV); `git diff --check` đạt. Chưa xác minh thao tác clipboard và bố cục trực tiếp trong trình duyệt ở desktop/mobile và hai theme.

## Chuẩn hóa animation nút và trạng thái tự động lưu

**Trạng thái: Đã triển khai theo kế hoạch được người dùng duyệt bằng yêu cầu “triển khai”.**

### Hiện trạng đã rà soát

- Nút dùng chung `.ui-button` hiện chủ yếu đổi nền/viền khi hover; nút primary tắt transform khi hover/nhấn. Một số nút cũ có CSS riêng nên phản hồi giữa dashboard, đăng nhập, workspace, bảng dữ liệu và dialog chưa đồng nhất.
- Đã có focus-visible và trạng thái disabled dùng chung trong workspace/auth; cần giữ rõ khả năng thao tác bàn phím, tương phản theme sáng/tối và trạng thái không khả dụng.
- Báo cáo tự lưu sau 1 giây kể từ lần chỉnh sửa cuối. Màn chi tiết hiển thị các chuỗi trạng thái như “Có thay đổi chưa lưu”, “Đang lưu…” và “Đã lưu”, nhưng chưa có thời điểm lưu gần nhất hoặc trạng thái saving tách biệt; nút “Lưu lại” luôn hiện.
- Backend đã trả `updated_at` trong truy vấn report nhưng `ReportService.get()` chưa đưa thời điểm đó vào payload chi tiết. Có thể bổ sung trường thời gian chỉ đọc để trạng thái lúc mở báo cáo phản ánh đúng lần lưu gần nhất.

### Kết quả triển khai

- Chuẩn hóa phản hồi hover/nhấn của nút trên dashboard, đăng nhập, workspace, thư viện, bảng và hộp thoại; giữ nút theme riêng, disabled đứng yên và hỗ trợ `prefers-reduced-motion`.
- Nút “Lưu ngay” chỉ bật khi có thay đổi, hiện spinner khi lưu và cho phép thử lại sau lỗi; nút xuất Excel/Word cũng báo trạng thái đang tạo.
- Trạng thái lưu tách bạch giữa chưa lưu, đang tự lưu/lưu thủ công, đã lưu, lưu một phần, lỗi và xung đột. Khi lỗi một phần hoặc lưu thất bại, UI hiện thông tin nguyên nhân; thời điểm lưu gần nhất hiển thị theo xác nhận của backend.
- Payload đọc và cập nhật báo cáo trả `updatedAt`; kiểm thử backend xác nhận thời gian ở lúc tạo, cập nhật và đọc lại.
- Kiểm chứng: `npm run build`, `npm test` (**31/31**), `npm run test:backend` (**12/12**) và `git diff --check` đều đạt. Chưa kiểm tra trực quan bằng trình duyệt ở các kích thước/theme trong lượt này.

### Mục tiêu và phạm vi

1. Chuẩn hóa phản hồi của các nút thao tác trên dashboard, đăng nhập/đăng ký, workspace, thư viện báo cáo, màn chi tiết, bảng và dialog: hover nhẹ, nhấn có phản hồi, focus rõ, disabled không nhúc nhích, loading có spinner và thao tác thành công có phản hồi ngắn.
2. Giữ chuyển động nhỏ, không làm xê dịch bố cục; giảm hiệu ứng với nút icon/điều hướng để giao diện không rối. Hỗ trợ `prefers-reduced-motion` và theme sáng/tối.
3. Cải thiện nút lưu báo cáo thành hành động rõ ràng “Lưu ngay”; khi đang lưu hiển thị spinner/“Đang lưu…”, tránh gửi lặp thao tác, và vô hiệu hóa nút khi không có thay đổi cần lưu.
4. Hiển thị autosave gần tiêu đề/hành động với biểu tượng và thông điệp dễ phân biệt: chưa lưu, đang lưu, đã lưu kèm thời điểm, lưu một phần do ảnh/file, thất bại và xung đột. Dùng `role="status"`/`aria-live` phù hợp; không báo đã lưu đủ nếu media còn lỗi.
5. Khi mở báo cáo cũ, lấy `updated_at` hiện có để hiển thị lần lưu gần nhất; sau mỗi lần autosave hoặc lưu thủ công, cập nhật thời điểm theo phản hồi thành công. Giữ debounce, xử lý xung đột, upload file chờ lưu và cảnh báo rời trang hiện hành.

### Cách triển khai dự kiến

- Rà các biến thể nút thực tế rồi bổ sung chuyển động/token dùng chung và áp dụng có chọn lọc cho các nút bespoke; không thêm hiệu ứng hover gây nhảy nội dung hoặc làm bảng nhấp nháy.
- Tách trạng thái lưu khỏi chuỗi hiển thị trong `useReport` để quản lý `dirty/saving/savedAt/error/conflict/media warning`; giữ API lưu và cơ chế revision/idempotency hiện có.
- Bổ sung `updatedAt` vào payload đọc chi tiết báo cáo nếu đúng kiểu dữ liệu DB, cập nhật trạng thái hook và UI badge; thay nút “Lưu lại” bằng nút lưu có trạng thái disabled/loading rõ ràng.
- Bổ sung test cho trạng thái autosave (thay đổi → đang lưu → đã lưu; lỗi/xung đột; media chưa đủ), giữ nguyên các kiểm thử backend hiện tại; kiểm tra trực quan nút và trạng thái trên desktop/mobile, sáng/tối, reduced motion.

### Tiêu chí nghiệm thu

- Các nhóm nút chính có cùng nhịp hover/pressed/focus/disabled/loading; thao tác icon nhỏ không phóng to quá mức; reduced-motion không chạy chuyển động trang trí.
- Nút lưu chỉ chạy một lượt tại một thời điểm và thể hiện được đang lưu, lưu thành công, có thay đổi mới, lỗi, xung đột và media chưa lưu đủ.
- Thời gian lưu gần nhất đến từ `updated_at` khi mở báo cáo và đổi sau khi server xác nhận lần lưu kế tiếp; không hiển thị thời gian thành công khi save thất bại.
- `npm run build`, `npm test`, `npm run test:backend` và `git diff --check` đạt; kiểm tra giao diện trực tiếp ở các kích thước desktop/mobile và hai theme.

## Tiến trình đồng bộ GNPS2 và lưu báo cáo

**Trạng thái: Đã triển khai theo kế hoạch được người dùng duyệt bằng yêu cầu “triển khai kế hoạch animation loading bên trên”.**

### Mục tiêu

- Giữ nguyên animation loading hiện có và thanh loading chuyển động bên dưới.
- Chỉ thay dải bước được khoanh trong popup bằng trạng thái tiến trình có tên bước, mô tả việc đang làm, số lượng khi có thể đếm và thanh phần trăm.
- Tiến trình phải theo các mốc thật của backend; không giả lập phần trăm hoàn tất theo thời gian.

### Luồng đề xuất

1. Kiểm tra trạng thái task GNPS2 và đọc tiêu đề task.
2. Tải Library Matches; báo số dòng đã nhận.
3. Tải Network GraphML và ghép metadata RT; báo số node đã nhận.
4. Lấy ảnh cấu trúc/công thức và phổ mảnh vỡ theo từng lô; cập nhật số dòng đã xử lý, số ảnh và phổ đã lấy.
5. Lưu báo cáo và các dòng dữ liệu vào PostgreSQL; hiển thị số dòng được lưu.
6. Lưu lần lượt ảnh cấu trúc và file nguồn lên Cloudinary; hiển thị loại/tên tài sản, số đã lưu và lỗi nếu có.
7. Báo hoàn tất hoặc hoàn tất một phần kèm cảnh báo lưu tài sản; chỉ đóng popup khi kết quả cuối đã nhận.

### Cách triển khai dự kiến

- Bổ sung callback tiến trình vào `importGnpsTask` tại các điểm tải và xử lý thật; callback lô hiển thị tiến độ ảnh/phổ theo số dòng đã hoàn tất.
- Truyền tiếp callback qua `saveAnalysis`, `ReportService.create` và `persistMedia` để phân biệt transaction lưu dữ liệu với từng lần upload Cloudinary.
- Thêm chế độ stream tiến trình cho endpoint nhập task bằng Server-Sent Events (SSE), giữ phản hồi JSON hiện tại cho client/API không yêu cầu stream. Stream gửi riêng các event `progress`, `result` và `error`; xử lý cả trường hợp idempotency trả báo cáo đã tồn tại.
- Frontend đọc stream bằng `apiFetch` để giữ cookie/CSRF hiện tại, cập nhật tiến trình trong popup; giữ nguyên spinner của nút, màn loading bên dưới và luồng import hiện có. Lỗi trước/sau khi mở stream vẫn hiển thị thông báo thật và luôn giải phóng trạng thái loading.
- Phạm vi ưu tiên là nhập từ GNPS2 Task như ảnh. Luồng TSV/XLSX không đổi nghiệp vụ; nếu dùng chung popup sẽ giữ thông báo phù hợp cho luồng file, không hiển thị nhầm các bước GNPS2.

### Kiểm chứng

- Unit test importer xác nhận thứ tự callback và cập nhật theo từng lô; integration test endpoint xác nhận event tiến trình, kết quả cuối, lỗi, idempotency và không thay đổi JSON mặc định.
- Test persistence callback cho báo cáo DB, ảnh cấu trúc, file nguồn và upload lỗi; kiểm tra lỗi lưu media được báo là lưu một phần thay vì báo thành công toàn bộ.
- Chạy `npm run build`, `npm test`, `npm run test:backend` và `git diff --check`; kiểm tra popup ở task import chậm/nhanh để xác nhận nhãn đổi theo backend, thanh bên dưới vẫn chạy và lỗi không mắc ở trạng thái loading.

### Kết quả triển khai

- Đã nối tiến trình thật từ importer GNPS2 qua bước lưu PostgreSQL đến từng ảnh/file đưa lên Cloudinary; UI hiển thị bước hiện tại, phần trăm theo mốc backend, số dòng/node/hợp chất/tài nguyên, tên file và số upload thành công/lỗi.
- Dải nhãn tĩnh trong popup được thay bằng thẻ tiến trình động. Giữ nguyên animation quỹ đạo, spinner của nút và thanh loading chuyển động phía dưới; luồng TSV/XLSX vẫn dùng nội dung phù hợp riêng.
- Endpoint GNPS2 phát SSE khi client yêu cầu `?progress=stream`; phản hồi JSON mặc định, CSRF/session, trường hợp báo cáo đã tồn tại và luồng lỗi vẫn được giữ.
- Kiểm thử bao phủ callback importer, parser SSE frontend, thứ tự lưu DB/media, task chưa hoàn tất, idempotency và upload lỗi một phần.
- Kiểm chứng cuối: `npm run build` đạt; `npm test` đạt **31/31**; `npm run test:backend` đạt **12/12**; `git diff --check` đạt. Chưa xác minh OAuth/Neon/Cloudinary thật trên deployment; integration test dùng PGlite và media provider giả lập.

## Dashboard: thanh nhập option 1 và header đúng luồng

- Thay thẻ nhập lớn bằng thanh thao tác ngang, thấp và rộng hơn; giữ nguyên nền khoa học, tiêu đề, đăng nhập và theme.
- Cho phép dán link GNPS2 ngay tại dashboard; giữ link qua đăng nhập để form nhập hiện có tiếp tục xử lý. Nút TSV/XLSX vẫn đi đúng luồng đăng nhập/chọn tệp.
- Sửa ba nhãn tiến trình theo luồng thật: nhập dữ liệu → đối chiếu và hiệu chỉnh → lưu và xuất; thu chiều cao header, tăng chiều rộng trên desktop và bảo đảm co gọn trên màn nhỏ.
- Kiểm chứng build, lưu link qua auth bằng kiểm tra luồng hiện có, và chụp QA desktop/mobile so với option 1.

### Kết quả

- Hoàn tất: trang chủ dùng thanh thao tác ngang theo option 1; header gọn hơn, rộng hơn và ghi đúng tiến trình “Nhập dữ liệu → Đối chiếu & hiệu chỉnh → Lưu & xuất”.
- Link GNPS2 được giữ trong session qua đăng nhập và được đưa vào ô nhập trong workspace sau khi xác thực; nút TSV/XLSX tiếp tục vào đúng luồng đăng nhập và chọn tệp.
- Kiểm tra trực quan desktop 1280×720, mobile 390×844 và 320×720; ở 768px kiểm tra DOM xác nhận các khối không tràn khỏi viewport. Theme sáng/tối và điều hướng link/tệp sang đăng nhập đã được thử.
- `npm run build` đạt, `npm test` đạt (27/27), `git diff --check` đạt. Chi tiết và giới hạn QA: `design-qa.md`.

## Thu gọn thanh trên và menu desktop

- Desktop: topbar 56px; sidebar icon-only rộng 68px, chỉ bung ra khi bấm nút mở rộng và có cùng nút để thu gọn. Rê chuột hoặc focus bàn phím không đổi trạng thái. Mobile giữ menu dạng nút bấm.
- Bổ sung tên trợ năng và tooltip cho icon điều hướng.
- Hoàn tất 29/09/2026: khi bung menu, cột nội dung dịch theo sidebar (248px) nên không bị che. Cập nhật theo yêu cầu: mở/thu gọn bằng click, trạng thái chỉ đổi qua nút và có nhãn trợ năng/tooltip rõ ràng; giảm khoảng cách dọc ở sidebar mở; hiển thị toàn bộ báo cáo theo `updated_at` mới nhất trước, làm mới danh sách sau autosave/xóa và mở trực tiếp báo cáo từ sidebar. `npm run build`, 27/27 tests và `git diff --check` đạt.

## Sửa lỗi form và chẩn đoán nhập GNPS2

- Form link: bỏ lưới 3 cột kế thừa từ CSS cũ; nút/ô link nằm trong khung. Đã kiểm tra browser 1800/1024/768/390px, chuyển tab vẫn đúng; build đạt.
- Lỗi import hiện bị gom chung thành SERVICE_UNAVAILABLE nên không thể phân biệt URL sai, task chưa hoàn tất, timeout, phản hồi GNPS không hợp lệ hay lỗi database. Sửa phân loại lỗi và thông báo theo đúng bước; bổ sung kiểm thử lỗi importer và kiểm tra task thực tế khi có link.
- Đã tìm được lỗi kết nối thực tế: `www.gnps2.org` trả ECONNREFUSED khi lấy Library Matches, còn `gnps2.org` trả HTTP 200 với 27 dòng trên cùng task mẫu. Đã sửa hostname trong importer và API lấy ảnh cấu trúc.
- Importer hiện trả mã riêng cho URL/Task ID sai (400), task chưa DONE (409), upstream HTTP/JSON/GraphML/kết nối lỗi (502), timeout (504) và file quá lớn (413); không lộ phản hồi HTML hay thông tin cấu hình.
- Kiểm tra mạng thật task mẫu `2515573ac8c24ec8b85f553aad9b440e`: nhập thành công 27 dòng, 75 node mạng, 27 ảnh cấu trúc, 27 phổ mảnh vỡ và 3 file nguồn, khoảng 10,3 giây. Chưa có link task lỗi cụ thể của người dùng để đối chiếu trực tiếp.
- Build đạt; 27/27 tests đạt, gồm 6 kiểm thử regression/error mới. Ảnh form sửa xong: `.tmp/gnps-form-fixed-desktop.png`.

## Điều chỉnh dashboard theo yêu cầu người dùng

- Khôi phục dashboard công khai với headline, nền khoa học và nhận diện giao diện cũ. Mở ứng dụng sẽ thấy dashboard, kể cả khi chưa đăng nhập.
- Khi chọn nhập Link GNPS2 hoặc TSV/XLSX, yêu cầu đăng nhập nếu chưa có phiên; đăng nhập xong chuyển thẳng đến đúng nguồn đã chọn. Báo cáo cá nhân vẫn yêu cầu tài khoản.
- Có đường quay về dashboard từ login và workspace; lưu thay đổi báo cáo trước khi rời workspace. Giữ API và phân quyền backend hiện tại.
- Đây là sửa phạm vi đã triển khai theo yêu cầu trực tiếp của người dùng; kiểm chứng build và browser trước khi hoàn tất.
- Đã hoàn tất: dashboard xem được trước đăng nhập, giữ nền khoa học cũ và headline; đã thử chọn file → login → đúng form TSV/XLSX, tài khoản đã đăng nhập → form link trực tiếp, Dashboard từ sidebar, báo cáo cá nhân và đăng xuất về dashboard. Mobile 390px không tràn ngang; nút quay về dashboard có trên màn login mobile.
- Build/TypeScript đạt; 21/21 kiểm thử hiện có đạt. Ảnh kiểm chứng: `.tmp/dashboard-restored-desktop.png`, `.tmp/dashboard-restored-mobile.png`.

## Đã triển khai — Thiết kế lại frontend sau cập nhật backend

**Ngày: 29/09/2026. Đã được phê duyệt bằng yêu cầu “triển khai”. Giao diện đã hoàn thiện; giữ nguyên hợp đồng API và schema backend.**

### Kết quả nghiệm thu giao diện

- Đã thay giao diện đăng nhập/đăng ký, thư viện báo cáo, form tạo báo cáo, trang chỉnh sửa, tab ảnh/file và trang tài khoản. Theme dùng chung từ đăng nhập đến workspace; giữ nhận diện flask/teal.
- Đã bổ sung menu mobile, dialog xác nhận, Escape/focus trap/trả focus, thao tác tab bằng phím mũi tên; khóa điều hướng khi xử lý và tránh chuyển trang đồng thời. Flush lưu trước khi rời báo cáo; refresh trạng thái media sau retry.
- `npm run build` đạt (TypeScript frontend/server và Vite). `npm test`: **21/21 đạt**, 4 file kiểm thử. `git diff --check` đạt.
- Browser local độc lập: đăng ký → thư viện trống; mở báo cáo có 4 dòng và 2 file nguồn; đổi tiêu đề → chuyển trang → reload giữ tiêu đề; đăng xuất/đăng nhập lại thành công. Đã kiểm tra tìm kiếm không có kết quả, xem TSV nguồn, ánh xạ, tab bằng bàn phím và hủy xóa bằng Escape (focus trở về nút mở).
- Xuất Excel/Word qua giao diện tạo bản xuất thành công và hiển thị trạng thái đã lưu trong tab file. Browser không trả sự kiện download để xác nhận file ở ổ đĩa; nội dung DOCX/XLSX được kiểm tra trong integration test.
- Đã kiểm tra sáng/tối và các khung 1440, 1024, 768, 390px: không cuộn ngang toàn trang; bảng được cuộn riêng. Đã sửa vùng chọn file bị cắt do CSS cũ và khoảng chia card thống kê.
- Ảnh thực tế: `.tmp/workspace-auth-desktop.png`, `.tmp/workspace-library-light.png`, `.tmp/workspace-results-desktop.png`, `.tmp/workspace-results-mobile-dark.png`, `.tmp/workspace-import-tablet.png`.
- Thiếu cấu hình Google được hiển thị phù hợp ở login và tài khoản. Neon/Google OAuth/Cloudinary thật chưa kiểm thử vì chưa có credentials; backend test dùng PostgreSQL PGlite và media provider giả lập. Các tình huống quota/revision/ownership được kiểm tra bằng integration, chưa mô phỏng mọi lỗi trên browser. Chưa kiểm thử dataset lớn và GNPS mạng ngoài trong đợt UI.

Các mục bên dưới là kế hoạch đã được review và triển khai.

### 1. Các vấn đề đã kiểm tra

- `Account.tsx` đang là một form trung tâm với tab đăng ký/đăng nhập đơn giản; CSS màu cố định, chưa dùng chung theme với ứng dụng.
- Header trong `App.tsx` cùng lúc chứa brand, tiến trình, nút báo cáo, tên tài khoản, trạng thái engine và theme; dễ chật trên màn nhỏ.
- “Báo cáo của tôi” và tài khoản nằm trong modal chung, chưa có không gian rõ ràng cho quản lý lịch sử và thông tin tài khoản.
- Trạng thái lưu và khối ảnh/file đang đứng trước tiêu đề báo cáo; thiếu phân cấp giữa nội dung chính và tác vụ phụ.
- CSS phần backend mới được nối vào cuối stylesheet, dùng biến `--border` chưa thuộc bộ token hiện tại (`--line`), nên viền và màu chưa thống nhất.
- Ảnh kiểm thử local trước đây ở `.tmp/account-report-ui.png` cho thấy thanh hành động bị tràn ở khung hẹp. Ảnh này là bằng chứng của lần kiểm thử trước; cần kiểm tra lại giao diện chạy thực tế khi triển khai.

### 2. Hướng thiết kế chốt để review

- Phong cách ứng dụng phân tích dữ liệu khoa học: sạch, rõ, ít hiệu ứng; giữ logo bình flask và màu teal của GNPS2.
- Xây dựng light/dark đồng bộ từ login đến workspace. Tôn trọng lựa chọn theme đã lưu; không đổi theme của người dùng chỉ vì refresh/login.
- Font giao diện thống nhất; chữ nội dung khoảng 14–16px, tiêu đề trang 26–32px. Dữ liệu số dùng tabular numerals; đơn vị và metadata có tương phản đủ đọc.
- Nền phẳng, card và border nhẹ; hạn chế gradient/glass/shadow lặp lại. Animation chỉ dùng cho chuyển trạng thái, hỗ trợ reduced motion.
- Desktop có sidebar khoảng 220px, nội dung co giãn và header gọn. Tablet/mobile chuyển sidebar thành menu có nhãn; body không cuộn ngang, chỉ vùng bảng dữ liệu được cuộn ngang.

### 3. Bố cục và hành vi từng màn

| Màn | Bố cục và hành vi dự kiến |
| --- | --- |
| Đăng nhập/đăng ký | Desktop hai vùng: logo + giới thiệu ngắn về lưu báo cáo bên trái, form bên phải; mobile một cột. Nút Google có icon, phân cách rõ với email; label/input/focus/error chuẩn. Nút hiện mật khẩu, autocomplete và loading. Thiếu Google config có trạng thái phù hợp; thiếu kết nối có panel thử lại, không trộn vào lỗi mật khẩu. Không tạo chức năng quên mật khẩu giả. |
| Workspace | Sidebar: “Báo cáo của tôi”, “Tạo báo cáo”, “Tài khoản”; brand phía trên, người dùng/đăng xuất và theme dễ tìm. Header trang có tiêu đề và hành động chính; engine status là thông tin phụ. Khi đăng nhập mở thư viện; thư viện trống có CTA tạo báo cáo đầu tiên. |
| Báo cáo của tôi | Trang riêng thay modal. Tìm tiêu đề, danh sách báo cáo có tên, số dòng, ngày cập nhật; nút tạo mới nổi bật. Có loading, lỗi/thử lại, không có dữ liệu, không có kết quả tìm và “Xem thêm”. Thao tác mở/xóa rõ ràng, tên dài xuống dòng/ellipsis hợp lý. Chỉ hiển thị số liệu API có thật; không giả tổng số báo cáo hoặc dung lượng cloud toàn tài khoản. |
| Tạo báo cáo | Form làm việc trong workspace: hai lựa chọn “Link GNPS2” và “TSV + XLSX”, hướng dẫn ngắn, nguồn/tiêu đề/trạng thái preview rõ. Bỏ hero lớn và nền hoạt họa khỏi luồng đã đăng nhập để dành không gian cho nhập liệu. Giữ phân tích và ánh xạ hiện tại. |
| Chỉnh sửa báo cáo | Tiêu đề trước; badge tự lưu ngay cạnh tên, export là hành động chính. Thanh công cụ có xuất Word/Excel; nguồn, cấu trúc và đối chiếu GNPS là tác vụ phụ. Tab “Kết quả” / “Ảnh và file” giúp bảng giữ vị trí trung tâm. Các số liệu đối sánh nhỏ gọn, filter/sort và chọn dòng dễ nhìn. Xung đột/lưu lỗi dùng thông báo rõ với nút xử lý. |
| Ảnh và file | Tab riêng theo báo cáo, nhóm file nguồn / ảnh cấu trúc / bản xuất. Icon loại file, tên, dung lượng, trạng thái và revision; tải hoặc chọn lại đúng file khi lỗi. Empty state ngắn gọn, lỗi upload hiển thị bên cạnh file. Giữ chính sách 5 bản xuất, không tính pending thành “đã lưu”. |
| Tài khoản | Trang riêng: avatar chữ cái, tên/email, Google liên kết/chưa liên kết; form đổi mật khẩu và liên kết Google khi API hỗ trợ. Thành công, lỗi và loading tách biệt. Không thêm sửa hồ sơ/đặt mật khẩu Google nếu backend chưa hỗ trợ. |

### 4. Quy tắc tương tác cần giữ

- Navigation không làm mất sửa đổi: flush autosave khi phù hợp; lỗi lưu/conflict phải có lựa chọn xử lý rõ trước khi rời báo cáo. Đăng xuất chủ động vẫn cảnh báo thay đổi chưa lưu.
- Mở lại báo cáo, chọn dòng, chỉnh metadata, ảnh, xem TSV/XLSX, ánh xạ, filter/sort, GNPS comparison và export giữ đúng nghiệp vụ hiện tại. Sort trên màn hình không tự đổi thứ tự nguồn/export.
- Assets chỉ tải qua API có session; không đổi delivery sang public, không đưa credentials hoặc URL ký cloud vào frontend.
- Search/pagination tránh response cũ ghi đè kết quả mới; trạng thái mở báo cáo phải rõ khi đang tải file nguồn.
- Xóa có dialog thống nhất thay confirm thô; chặn double submit, thông báo kết quả, xử lý đúng khi xóa báo cáo đang mở.
- Focus/keyboard/label cho form và tab; dialog/menu hỗ trợ Escape, focus trap và trả focus về nút mở. Nút có tên dễ hiểu, vùng bấm ít nhất khoảng 40px, trên mobile ưu tiên 44px.

### 5. Phạm vi mã nguồn và các bước triển khai

1. Chuẩn hóa token theme và component nút/input/badge/dialog/empty state; đưa theme ra tầng dùng chung với auth.
2. Thiết kế lại `Account.tsx` và shell điều hướng; tách phần thư viện, tài khoản, assets trong `Workspace.tsx` thành component rõ trách nhiệm nếu cần.
3. Tích hợp trang workspace vào `App.tsx`, bố trí lại nhập liệu và báo cáo, giữ state/API/autosave hiện có.
4. Hoàn thiện `AssetsPanel`, thông báo lưu/conflict và các tình huống loading/error/empty.
5. Kiểm tra light/dark và viewport 1440px, 1024px, 768px, 390px; sửa tràn và kiểm tra bàn phím.

File dự kiến thay đổi: `src/App.tsx`, `src/Account.tsx`, `src/Workspace.tsx`, `src/styles.css`, `src/main.tsx`; thêm component/theme hook khi cần. `src/useReport.ts` và `src/api.ts` chỉ chỉnh nếu cần đồng bộ trạng thái hoặc chống race. Không cần package UI mới hay thay schema/backend trong đợt này.

### 6. Kiểm chứng và nghiệm thu

- TypeScript, build frontend/server và bộ kiểm thử backend/engine hiện có phải đạt sau thay đổi.
- Kiểm thử browser với backend test local độc lập, dữ liệu và credentials thử được tạo riêng; không bỏ qua auth trong code production, không cần người dùng có cloud credentials để review giao diện.
- Luồng kiểm thử: đăng ký/login → thư viện trống → nhập TSV/XLSX/GNPS theo khả năng mạng → báo cáo → sửa/chọn dòng/tự lưu → reload/mở lại → file/ảnh/retry → xuất → tài khoản/đăng xuất.
- Kiểm tra trạng thái thiếu Google/Cloudinary, backend không kết nối, upload lỗi, xung đột revision và tìm kiếm không có kết quả.
- Có ảnh kiểm chứng giao diện thực tế desktop/mobile, light/dark, auth/thư viện/báo cáo; ghi rõ Google/Cloudinary thật chưa được kiểm thử nếu thiếu credentials.
- Không có cuộn ngang toàn trang; nút export không bị cắt, modal không vượt viewport, bảng còn đủ rộng để xem dữ liệu khoa học.

**Đã tuân thủ AGENTS.md: tạo kế hoạch trước, nhận phê duyệt “triển khai”, sau đó thực hiện đợt giao diện này.**

---

## Backend lưu dữ liệu theo tài khoản và đăng nhập Google

**Ngày lập: 29/09/2026. Đã được phê duyệt bằng yêu cầu “triển khai”. Mã nguồn đã hoàn thiện; chưa provision/deploy dịch vụ cloud vì người dùng chưa có credentials.**

### Kết quả triển khai và kiểm chứng

- Đã triển khai tài khoản email/mật khẩu, Google OIDC, liên kết Google, đổi mật khẩu, session PostgreSQL và phân quyền theo chủ sở hữu.
- Đã triển khai PostgreSQL migration, báo cáo/dòng JSONB, autosave/revision/idempotency, thư viện báo cáo, nguồn và bản xuất riêng tư trên Cloudinary, quota và cleanup/retry.
- `npm test`: **21/21 đạt**. Integration dùng PGlite PostgreSQL trong bộ nhớ và media provider giả lập; có ownership, CSRF, session qua app restart, thu hồi phiên, transaction/rollback, cập nhật đồng thời, quota, raw source và DOCX/XLSX.
- TypeScript và build production frontend/server đạt; npm audit không phát hiện vulnerability trong bộ dependency hiện tại. Cài sạch dependencies đã kiểm tra.
- Đã thử giao diện local với backend test: đăng ký, mở thư viện, mở báo cáo, sửa tiêu đề, autosave và reload vẫn giữ tiêu đề. Chưa kiểm chứng đầy đủ dark/light, mobile hoặc tải dataset lớn đo RAM.
- Khác biệt triển khai: PostgreSQL session store riêng thay `connect-pg-simple`; SQL tham số qua pg dùng schema Drizzle làm mô tả typed. Trạng thái bền vững trên `media_assets` thay bảng `media_operations` riêng; retry bytes yêu cầu chọn lại file, không có worker luôn chạy.
- GNPS lưu file thực tế importer sử dụng: Library Matches JSON, GraphML và JSON spectrum peaks từ mirror service; chưa lấy consensus MGF trực tiếp.
- Chưa kiểm chứng Google OAuth thật, Neon TLS/pooling, Cloudinary authenticated image/raw, cold start/HTTPS Render hoặc backup/restore trên cloud. Chưa có quên mật khẩu/email verification hoặc backup tự động. Hướng dẫn cấu hình và giới hạn có trong README.

Các mục phía dưới là kế hoạch đã review; bảng/schema chi tiết hiện hành nằm trong migration và mã nguồn.

### 1. Hiện trạng và mục tiêu

- Đã có Node.js + Express + TypeScript, React/Vite, Zod và các API nhập GNPS2, preview TSV/XLSX, đối sánh, lấy ảnh cấu trúc, xuất DOCX/XLSX.
- `server/index.ts` hiện xử lý trực tiếp từng request; chưa có database, tài khoản, session hoặc kiểm tra quyền sở hữu dữ liệu.
- `src/App.tsx` giữ kết quả, tiêu đề, chỉnh sửa và dòng được chọn trong React state. Reload trang sẽ mất dữ liệu; localStorage hiện chỉ lưu theme.
- Upload dùng bộ nhớ, tối đa 25 MB/file; JSON request hiện tối đa 15 MB. Cần đo RAM thực tế trước khi giữ các mức này trên host free.
- Đã có cấu hình Render backend + Vercel frontend. Express cũng đã có khả năng phục vụ frontend từ `dist/`.
- Mục tiêu: đăng ký/đăng nhập email + mật khẩu, đăng nhập Google, lưu và mở lại báo cáo riêng của mỗi tài khoản trên nhiều thiết bị; tiếp tục chỉnh sửa và xuất kết quả đã lưu.

### 2. Lựa chọn database: PostgreSQL

| Tiêu chí của GNPS2 Converter | PostgreSQL | MongoDB |
| --- | --- | --- |
| Quan hệ tài khoản → báo cáo → dòng kết quả | Foreign key, unique constraint, transaction rõ ràng | Làm được; cần chủ động thiết kế tham chiếu và tính nhất quán |
| Metadata GNPS thay đổi theo nguồn | JSONB cho trường linh hoạt | Document linh hoạt, phù hợp dữ liệu JSON |
| Cập nhật báo cáo và nhiều dòng cùng lúc | Transaction thuận tiện | Có transaction nhưng phải thiết kế theo document/collection |
| Lọc lịch sử theo người dùng, ngày, tiêu đề | Index và SQL thuận tiện | Index và aggregation đáp ứng được |
| Gói cloud free | Neon Free | MongoDB Atlas Free |
| Đề xuất cho dự án | **Chọn PostgreSQL** | Phương án thay thế, không cần dùng song song |

Lý do chính là dữ liệu có quyền sở hữu và quan hệ rõ ràng, không phải vì MongoDB không làm được auth. JSONB xử lý được `sourceMetadata`, mapping, parameters và các trường biến đổi mà không cần đổi toàn bộ schema khi GNPS thêm cột. [Tài liệu PostgreSQL JSON](https://www.postgresql.org/docs/current/datatype-json.html).

### 3. Stack đề xuất

- Node.js **22 LTS** cho đợt đầu, phù hợp `engines` hiện tại; không đổi runtime đồng thời với auth. Kiểm tra bản vá LTS và dependency trước triển khai. [Node.js releases](https://nodejs.org/en/about/previous-releases).
- Giữ Express + TypeScript và Zod; tách route/service/repository thay vì viết lại backend bằng framework khác.
- PostgreSQL trên Neon; `pg` + Drizzle ORM, migration SQL được version trong repo. [Drizzle migrations](https://orm.drizzle.team/docs/migrations).
- `express-session` + PostgreSQL session store, dự kiến `connect-pg-simple`; không dùng MemoryStore ở production.
- Hash mật khẩu bằng Argon2id; kiểm tra khả năng build package trên Render và giới hạn RAM khi chạy nhiều lượt hash.
- Cloudinary Node SDK cho lưu ảnh và file; PostgreSQL chỉ lưu metadata/quan hệ tài sản, không lưu base64 hoặc binary ảnh/file.
- Google OpenID Connect authorization code flow qua thư viện duy trì tốt, dự kiến `openid-client`; không tự viết phần xác minh chữ ký token.
- Thêm middleware security headers, giới hạn request và chống CSRF cho thao tác thay đổi dữ liệu.
- Session cookie HttpOnly; không lưu access token hoặc session token trong localStorage. Không cần Redis, JWT refresh-token hoặc microservice ở quy mô ban đầu.

### 4. Phạm vi phiên bản đầu

1. Đăng ký email/mật khẩu, đăng nhập, đăng xuất, đọc thông tin tài khoản và đổi mật khẩu khi biết mật khẩu cũ.
2. Đăng nhập Google; tài khoản Google mới có thể sử dụng hệ thống ngay.
3. Danh sách “Báo cáo của tôi”: phân trang, tìm theo tiêu đề, mở lại, đổi tên và xóa báo cáo.
4. Tự lưu báo cáo sau khi nhập GNPS2 hoặc đối sánh file thành công; lưu thay đổi tiêu đề, dữ liệu dòng và trạng thái chọn dòng.
5. Mở báo cáo đã lưu để chỉnh sửa và xuất Word/Excel, không phải upload lại file nguồn.
   - Bổ sung theo yêu cầu: lưu ảnh cấu trúc, file TSV/XLSX gốc, các file GNPS đã tải phục vụ báo cáo và bản DOCX/XLSX đã xuất lên Cloudinary; liên kết tài sản với đúng tài khoản/báo cáo/dòng kết quả.
6. Mọi API nghiệp vụ yêu cầu đăng nhập. Homepage, health và các endpoint khởi tạo auth cần thiết vẫn truy cập được trước đăng nhập; đăng ký công khai có rate limit.
7. Tạm giả định một vai trò người dùng, dữ liệu riêng tư; chưa làm nhóm, quản trị, phân quyền nhiều cấp, chia sẻ công khai hoặc lịch sử phiên bản đầy đủ.
8. Quên mật khẩu và xác minh email qua thư thuộc giai đoạn tiếp theo vì cần nhà cung cấp email. Bản đầu phải thông báo giới hạn này; không tự động gộp tài khoản chỉ dựa vào email.

### 5. Mô hình dữ liệu

| Bảng | Trường chính / trách nhiệm |
| --- | --- |
| `users` | UUID, email chuẩn hóa có unique index, display_name, avatar_url, password_hash nullable, email_verified_at nullable, created_at, updated_at |
| `auth_accounts` | user_id, provider, provider_subject, created_at; unique(provider, provider_subject), unique(user_id, provider) |
| `sessions` | Session ID, nội dung session tối thiểu, expiry; schema tương thích session store, index expiry |
| `reports` | UUID, owner_id, title, source_type, task_id, source_url, tên file nguồn, mapping/parameters/headers/sheets/summary JSONB, schema_version, revision, row_count, storage_bytes, timestamps |
| `report_rows` | UUID riêng của DB, report_id, source_row_id, position, compound_name, status, selected, payload JSONB cho các field còn lại của MatchRow, structure_asset_id nullable tham chiếu media_assets |
| `media_assets` | UUID, owner_id, cloudinary_asset_id/public_id/version, resource_type, delivery_type, original_name, mime_type, byte_size, SHA-256, trạng thái pending/ready/failed/deleting/deleted, timestamps; không lưu nội dung binary |
| `report_assets` | report_id, asset_id, kind (source_tsv/source_xlsx/gnps_matches/gnps_graphml/gnps_mgf/structure/export_docx/export_xlsx), report_revision nullable, created_at; unique(report_id, asset_id, kind) |
| `media_operations` | owner_id, operation_id/idempotency_key, asset_id, thao tác upload/delete, trạng thái, retry_count, next_attempt_at; theo dõi tác vụ chưa hoàn tất sau restart |

- `users.email` được trim/chuẩn hóa nhất quán; không áp dụng quy tắc tùy tiện như bỏ dấu chấm Gmail.
- `auth_accounts.provider_subject` dùng `sub` của Google làm định danh, không dùng email làm Google ID.
- Foreign key cho tài khoản, báo cáo, dòng và tài sản; kiểm tra tài sản thuộc cùng chủ sở hữu khi gắn vào dòng/báo cáo. Xóa báo cáo cascade dòng/liên kết; tài sản không còn tham chiếu được đưa vào tác vụ xóa Cloudinary bền vững trong DB.
- Unique `(report_id, source_row_id)` và `(report_id, position)`; không dùng ID dòng hiện tại làm khóa toàn hệ thống vì có thể trùng giữa các lần phân tích.
- Index `(owner_id, updated_at DESC, id)` cho lịch sử; `(report_id, position)` cho mở lại/export. Chưa thêm GIN index mọi JSONB khi chưa có nhu cầu query thực tế.
- Trường đã tách cột không lưu lặp trong payload JSONB; DTO trả về vẫn ghép thành `MatchRow` để giữ hợp đồng frontend.
- Lưu `position` riêng; sort hiển thị không làm đổi thứ tự nguồn hoặc thứ tự export hiện tại. Không tự suy đoán RT, formula hoặc metadata thiếu.
- Transaction bao trùm lưu header, rows và liên kết ảnh; lỗi giữa chừng không để báo cáo nửa chừng. Kiểm soát race condition bằng unique constraint và cập nhật revision có điều kiện.
- Cloudinary nằm ngoài transaction PostgreSQL: dùng trạng thái và tác vụ bù/retry; không tuyên bố rollback SQL tự động xóa file cloud. `storage_bytes` tách usage JSON trong DB và usage ảnh/file trên Cloudinary.

### 6. Luồng đăng nhập và bảo vệ tài khoản

**Email/mật khẩu**

1. Validate tên/email/mật khẩu; đề xuất mật khẩu 12–128 ký tự, hỗ trợ password manager và không ép quy tắc ký tự phức tạp không cần thiết.
2. Hash Argon2id, chỉ lưu hash; không ghi mật khẩu/token/session cookie vào log.
3. Đăng nhập sai trả thông báo chung; giới hạn theo IP và định danh tài khoản để giảm brute force, không khóa tài khoản vĩnh viễn.
4. Tạo lại session ID khi đăng nhập để chống session fixation. Timeout đề xuất: không hoạt động 24 giờ, tối đa 7 ngày; expiry kiểm tra phía server.
5. Đổi mật khẩu cần xác nhận mật khẩu cũ và CSRF; thu hồi các session cũ, tạo session mới cho thiết bị đang thao tác. Thiết kế ánh xạ session → user để thực hiện được thu hồi.
6. Đăng xuất destroy session trong DB và xóa cookie với cùng thuộc tính path/security.

**Google**

1. Backend tạo `state`, `nonce`, PKCE verifier/challenge và lưu challenge ngắn hạn trong session, một lần sử dụng, hết hạn sau khoảng 10 phút.
2. Redirect đến Google với scope `openid email profile`; không yêu cầu Drive/Gmail hoặc quyền GNPS.
3. Callback kiểm tra state, đổi code lấy token, xác minh chữ ký, issuer, audience, expiry và nonce qua thư viện.
4. Tìm `auth_accounts` bằng provider + `sub`; tạo user và account trong transaction nếu chưa có. Lưu trạng thái xác minh email theo claim được xác thực, không coi mọi email Google đều đã xác minh.
5. Nếu email trùng tài khoản email/mật khẩu hiện có: không tự merge, không tạo hai user cùng email. Yêu cầu đăng nhập tài khoản hiện có và chủ động liên kết Google sau khi xác thực lại bằng mật khẩu.
6. Liên kết Google có state/mode riêng, kiểm tra session người dùng ban đầu và Google subject chưa thuộc user khác; giữ nguyên báo cáo của user hiện tại.
7. Tài khoản chỉ dùng Google chưa có mật khẩu sẽ tiếp tục dùng Google; chức năng đặt mật khẩu mới sau xác thực lại là mở rộng, không giả lập mật khẩu tự động.
8. Tạo lại session sau đăng nhập; redirect về đường dẫn nội bộ cho phép. Không đưa token vào URL frontend, không chấp nhận return URL tùy ý.

Nguồn: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect). Cần Google Cloud OAuth client, consent screen và redirect URI đúng tuyệt đối; kiểm thử tài khoản test và cấu hình đối tượng sử dụng trước khi phát hành.

**Cookie và quyền dữ liệu**

- Production HTTPS: cookie `HttpOnly`, `Secure`, `SameSite=Lax`, host-only, path `/`; môi trường local dùng cấu hình tương ứng, không bật Secure trên HTTP local.
- Đặt frontend/API cùng origin ở phương án deploy chính. CSRF token và kiểm tra Origin cho POST/PATCH/DELETE, bao gồm đăng nhập và liên kết tài khoản; OAuth callback GET dùng state/nonce.
- `owner_id` luôn lấy từ session; không tin owner/user ID gửi từ client.
- Mọi thao tác báo cáo phải query theo cả ID và owner. Không sở hữu/không tồn tại trả 404; chưa đăng nhập trả 401.
- Rate limit phải phù hợp proxy Render; chỉ trust số hop/proxy thực tế đã kiểm chứng, không trust mọi X-Forwarded-For.
- Auth, dữ liệu cá nhân, ảnh riêng và export trả `Cache-Control: no-store`; không cache chung giữa các tài khoản.

### 7. API dự kiến

| Method | Endpoint | Chức năng |
| --- | --- | --- |
| GET | `/api/auth/csrf` | Khởi tạo token chống CSRF |
| POST | `/api/auth/register` | Đăng ký email/mật khẩu |
| POST | `/api/auth/login` | Đăng nhập email/mật khẩu |
| POST | `/api/auth/logout` | Đăng xuất |
| GET | `/api/auth/me` | Đọc tài khoản từ session |
| POST | `/api/auth/change-password` | Đổi mật khẩu và thu hồi session |
| GET | `/api/auth/google` | Bắt đầu đăng nhập Google |
| GET | `/api/auth/google/callback` | Xử lý callback Google |
| POST | `/api/auth/google/link` | Xác thực lại bằng mật khẩu và bắt đầu liên kết Google |
| GET | `/api/reports` | Danh sách của user; cursor pagination, lọc tiêu đề |
| POST | `/api/reports` | Lưu snapshot chưa được lưu; validate và kiểm tra quota |
| GET | `/api/reports/:id` | Mở báo cáo, metadata và rows |
| PATCH | `/api/reports/:id` | Lưu tiêu đề/rows theo expected revision trong transaction |
| DELETE | `/api/reports/:id` | Xóa báo cáo của user |
| GET | `/api/reports/:id/structures/:assetId` | Lấy ảnh đã lưu sau kiểm tra owner |
| GET | `/api/reports/:id/assets` | Liệt kê file nguồn, ảnh và bản xuất đã lưu |
| GET | `/api/reports/:id/assets/:assetId/download` | Backend kiểm tra owner rồi stream ảnh/file riêng tư từ Cloudinary |
| GET | `/api/reports/:id/assets/:assetId/preview` | Đọc TSV/XLSX đã lưu bằng parser preview hiện có, giới hạn byte/dòng |
| POST | `/api/reports/:id/assets/:assetId/retry` | Thử lại lưu tài sản lỗi khi nguồn vẫn còn; nếu nguồn hết cần upload/import lại |
| POST | `/api/reports/:id/export/docx` | Xuất Word từ phiên bản đã lưu của user |
| POST | `/api/reports/:id/export/xlsx` | Xuất Excel từ phiên bản đã lưu của user |

- `/api/gnps-task/import` và `/api/analyze` giữ engine hiện tại, bổ sung lưu thành báo cáo và trả report ID/revision; hỗ trợ idempotency key theo tài khoản để tránh tạo bản trùng khi mất response.
- `/api/files/preview` và `/api/structures/gnps2` được bảo vệ; middleware auth chạy trước đọc multipart/file nặng.
- Endpoint export mới đọc dữ liệu từ DB; trước export chờ lưu thành công để lấy đúng chỉnh sửa mới nhất. Endpoint export cũ chỉ giữ khi còn consumer cần tương thích và phải có auth.
- PATCH conflict trả 409; request sai 400; quá kích thước 413; quá quota 409 với mã riêng; quá rate limit 429; DB tạm lỗi 503, không báo lưu thành công.
- Zod kiểm tra toàn bộ field, enum, chiều dài, kiểu số hữu hạn, kích thước metadata và row count; không nhận payload/session/provider tùy ý.
- Đường dẫn API không tồn tại phải trả JSON 404 trước SPA fallback, tránh trả index.html cho lỗi auth/API.

### 8. Lưu ảnh và file tương ứng bằng Cloudinary

**Phân chia trách nhiệm:** PostgreSQL lưu tài khoản, session, dữ liệu phân tích/chỉnh sửa, metadata tài sản và quan hệ sở hữu; Cloudinary lưu bytes ảnh/file. Mỗi file gắn với báo cáo và chủ sở hữu, ảnh cấu trúc gắn thêm với dòng, bản xuất gắn với revision.

| Loại tài sản | Cloudinary resource_type | Nguyên tắc |
| --- | --- | --- |
| Ảnh cấu trúc PNG/JPEG/WebP | `image` | Lưu bản gốc; không crop/resize làm thay đổi nội dung cấu trúc hóa học; deduplicate theo hash trong cùng tài khoản |
| TSV/XLSX người dùng upload | `raw` | Giữ nguyên bytes, tên gốc trong DB, hash để kiểm chứng |
| Library Matches TSV, GraphML, consensus MGF | `raw` | Lưu những file thực tế importer đã tải và sử dụng, không mirror toàn bộ GNPS task |
| DOCX/XLSX xuất báo cáo | `raw` | Bản xuất có report_revision, loại file, thời điểm tạo; bản mới không ghi đè bản cũ |

- File `raw` không được biến đổi nội dung; public_id theo UUID có phần mở rộng thích hợp, tên file gốc chỉ dùng làm metadata/tên tải xuống đã sanitize. Giữ cloudinary asset_id, public_id, resource_type, delivery_type và version để đọc/xóa đúng tài sản, không chỉ lưu secure_url.
- Upload qua backend bằng request có chữ ký, SDK server giữ API secret; không mở unsigned upload preset. Prefix UUID giúp tổ chức tài sản nhưng không thay thế kiểm tra owner.
- Dùng delivery type `authenticated` cho ảnh và raw để bảo vệ bản gốc cùng ảnh dẫn xuất. Chữ ký upload không tự làm tài sản riêng tư; phải đặt delivery type rõ ràng. `private` chỉ bảo vệ ảnh gốc, không mặc định bảo vệ mọi ảnh dẫn xuất. [Cloudinary access control](https://cloudinary.com/documentation/control_access_to_media).
- Bản đầu frontend chỉ gọi endpoint backend đã kiểm tra quyền; backend lấy tài sản bằng cơ chế Cloudinary ký và stream về với `Cache-Control: no-store`, không trả URL public hoặc URL ký lâu dài. Không giả định URL có chữ ký thông thường tự hết hạn; nếu tối ưu bằng URL tải tạm dùng cơ chế có expiry được hỗ trợ và kiểm chứng.
- MIME/extension phải hợp lệ và khớp nội dung; chặn SVG/HTML/script và archive không thuộc nghiệp vụ. XLSX/DOCX kiểm tra định dạng OOXML; parser XML tắt external entities, parser ZIP giới hạn dung lượng giải nén để tránh file nén gây quá tải.
- Backend stream upload/download khi có thể, đặt timeout và giới hạn concurrency, không ghi file bền vững lên Render. Preview/export lấy ảnh/file từ Cloudinary bằng metadata DB đáng tin, không fetch URL tùy ý do client gửi.
- Không lấy file GNPS trực tiếp qua arbitrary remote-upload URL. Importer tiếp tục dùng GNPS allowlist và chuyển buffer/stream đã kiểm tra lên Cloudinary.

**Luồng lưu, lỗi và xóa**

1. Xác thực và kiểm tra quota trước xử lý; tạo operation UUID/idempotency record và reserve dung lượng trong DB để các upload đồng thời không vượt quota.
2. Upload file nguồn/ảnh với ID xác định từ operation; kiểm tra response metadata, cập nhật assets và liên kết report trong transaction. Chỉ hiển thị “Đã lưu đầy đủ” khi kết quả và các tài sản bắt buộc đều ready.
3. Upload thành công nhưng DB lỗi: operation/prefix cho phép đối chiếu lại; tạo tác vụ dọn tài sản không được tham chiếu. Upload lỗi sau khi kết quả đã lưu: giữ kết quả, hiển thị “Kết quả đã lưu, file/ảnh chưa lưu đủ”, cho thử lại. Retry cùng operation không tạo thêm file trùng.
4. DB chỉ giữ metadata nên không thể phục hồi bytes upload mất sau restart. Retry file người dùng khi buffer không còn phải yêu cầu chọn lại đúng file và kiểm tra hash; nguồn GNPS có thể tải lại từ URL allowlist nếu còn tồn tại. Không hứa retry tự động mọi file chỉ bằng metadata.
5. Xóa báo cáo: transaction gỡ liên kết/thu hồi truy cập và ghi tác vụ delete; không xóa tài sản còn được báo cáo khác tham chiếu. Backend gọi destroy đúng type/resource_type và invalidate khi áp dụng; lỗi cloud giữ tác vụ retry, chưa trừ usage vật lý cho đến khi xác nhận xóa.
6. Tác vụ retry/cleanup chạy giới hạn khi service khởi động hoặc có hoạt động; không phụ thuộc worker/timer luôn chạy trên Render Free. Rà soát orphan định kỳ từ DB/Cloudinary, tôn trọng giới hạn Admin API.
7. Export chờ lưu sửa đổi, tạo file và upload bản xuất theo revision. Nếu upload bản xuất lỗi vẫn cho tải file vừa tạo và báo “Đã xuất, chưa lưu bản file”; không báo bản xuất đã được lưu trên cloud. Cùng revision/loại file có thể tái dùng bản lưu còn hợp lệ để giảm credit.

**Quota và gói free**

- Cloudinary Free hiện có **25 credits dùng chung** cho storage, bandwidth và transformations; không phải đồng thời 25 GB lưu trữ cộng 25 GB tải xuống miễn phí. Một credit tương đương 1 GB storage hoặc 1 GB image bandwidth hoặc 1.000 transformations; tổng usage quy đổi cộng vào cùng budget. [Cloudinary billing](https://cloudinary.com/documentation/billing_and_plans).
- Gói Free hiện giới hạn **10 MB/image và 10 MB/raw file**. Upload hiện tại 25 MB/file của ứng dụng không tương thích lưu nguyên file lên gói này; đợt triển khai phải đặt ngưỡng byte dưới mức 10 MB đã kiểm chứng của tài khoản, validate cả client/backend và file GNPS trước lưu. File lớn hơn báo rõ, không chia nhỏ/cắt file âm thầm. Nếu dataset thật vượt mức thường xuyên, cần nâng gói hoặc thay storage cho raw. [Cloudinary plan limits](https://cloudinary.com/pricing/compare-plans).
- Quota khởi điểm để review: 20 báo cáo/tài khoản, 1.000 dòng/báo cáo, 1 MiB JSON/báo cáo trong DB; 100 MB ảnh/file/tài khoản trên cloud, ảnh upload riêng tối đa 2 MB, raw theo giới hạn provider dưới 10 MB. Tổng file nguồn + ảnh + bản xuất đều tính vào quota; điều chỉnh từ dataset thực trước phát hành.
- Cần chính sách giữ bản xuất: mặc định giữ tối đa 5 bản xuất gần nhất/báo cáo, hiển thị rõ trên UI; chỉ dọn bản xuất cũ theo chính sách này, không tự xóa file nguồn để nhường quota.
- Theo dõi budget DB và cloud độc lập, kể cả orphan/bản dẫn xuất/bản backup cloud nếu có; theo dõi credit bandwidth ngoài byte storage. Cảnh báo 70%, dự phòng trước 85%; không hứa toàn hệ thống miễn phí chỉ dựa trên quota từng user.
- Không lưu base64 ảnh trong JSONB, giúp giảm dung lượng Neon. Không bỏ ảnh/dòng/file âm thầm khi hết quota; hiển thị phần chưa lưu và cho tải về máy.
- Hạn chế transformations cho ảnh cấu trúc; xử lý nén không mất dữ liệu ở server khi phù hợp, không làm méo hoặc mất chữ trong hình phân tử.
- Dọn session/challenge có giới hạn; không ghi session cho mọi health request. Không để hàng đợi quan trọng chỉ trong RAM.
- Backup gồm `pg_dump`, manifest mapping asset/hash và bản sao ảnh/file ở nơi độc lập; PostgreSQL backup không chứa bytes Cloudinary. Không mặc định tính năng backup/revision cloud đã bật hoặc miễn phí; kiểm thử restore cả metadata lẫn tài sản.

Nguồn khả năng upload image/raw: [Cloudinary Upload API](https://cloudinary.com/documentation/upload_images). Quyền authenticated raw, tải xuống từng định dạng, giới hạn byte thực tế và xóa/invalidate cần kiểm thử với tài khoản Cloudinary trước xác nhận deploy đạt.

### 9. Deploy miễn phí đề xuất

**Phương án chính: một Render Free Web Service phục vụ React + Node API, Neon Free PostgreSQL và Cloudinary Free lưu ảnh/file.**

1. Tận dụng `express.static(dist)` hiện có; frontend dùng `/api` tương đối như local Vite proxy. Cùng origin giúp session cookie và OAuth đơn giản hơn khi dùng domain miễn phí.
2. Render build dự kiến `npm ci --include=dev && npm run build:web && npm run build:server`; start `npm start`; bind `0.0.0.0` và dùng `PORT` của Render.
3. Neon dùng pooled connection cho runtime, pool nhỏ và timeout phù hợp; migration dùng connection dành cho migration khi cần. Bắt buộc TLS và bảo vệ credential.
4. Migration chạy có kiểm soát từ máy/CI được ủy quyền trước release; không dùng schema push phá dữ liệu và không giả định free service có pre-deploy job. Migration phải tương thích phiên bản ứng dụng trước trong lúc rollout.
5. Tạo OAuth redirect `https://<service>.onrender.com/api/auth/google/callback`, cấu hình local riêng, chỉ nhận URL/domain đã đăng ký.
6. Biến môi trường dự kiến: `NODE_ENV`, `DATABASE_URL`, `MIGRATION_DATABASE_URL` (chỉ môi trường migration), `SESSION_SECRET`, `APP_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, các quota và timeout. Không commit secret và không dùng biến `VITE_*` cho secret; app kiểm tra thiếu config Cloudinary và báo lưu tài sản chưa sẵn sàng.
7. `/api/health` nhẹ cho liveness; readiness kiểm tra DB theo nhu cầu deploy, không ping DB liên tục chỉ để giữ sống. Graceful shutdown đóng pool; lỗi DB trả trạng thái có thể thử lại.

**Giới hạn đã kiểm tra từ nguồn chính thức ngày lập kế hoạch:**

- Neon Free: 0,5 GB storage và 100 CU-hours compute mỗi project/tháng theo thông tin hiện hành; compute có thể scale về zero. Đây là CU-hours, không phải 100 giờ uptime cố định. [Neon Free và scale to zero](https://neon.com/blog/building-patterns-unlocked-by-scale-to-zero).
- MongoDB Atlas Free: 0,5 GB gồm document và index, không có backup tích hợp ở gói Free; kiểm tra lại chính sách khi provision. [Atlas Free limitations](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/).
- Render Free: ngủ sau 15 phút không có traffic; lần truy cập tiếp theo có thể mất khoảng một phút để thức. 750 instance-hours/tháng chia sẻ theo workspace; có giới hạn bandwidth/build. Filesystem không bền vững và không gắn persistent disk gói Free. [Render Free](https://render.com/docs/free).
- Không dùng Render Postgres Free cho dữ liệu cần duy trì: database hết hạn sau 30 ngày. Cũng không dùng SQLite/file JSON trên disk Render để lưu dữ liệu dài hạn. [Render Free Postgres](https://render.com/docs/free#free-postgres).
- Phương án này hướng tới demo/MVP ít người dùng trong quota; không cam kết uptime hoặc miễn phí vô hạn. Không cấu hình auto-upgrade ngoài mong muốn.

**Phương án tùy chọn nếu giữ Vercel frontend hiện tại:**

- Vercel Hobby phù hợp sử dụng cá nhân/phi thương mại theo điều kiện gói. [Vercel Hobby](https://vercel.com/docs/plans/hobby).
- Cookie trực tiếp giữa `vercel.app` và `onrender.com` cần xử lý cross-site và có thể bị chặn cookie bên thứ ba; không chỉ thêm CORS là đủ.
- Có thể proxy `/api` cùng origin qua Vercel rewrite, nhưng phải kiểm chứng forwarding Set-Cookie, redirect OAuth, upload 25 MB và timeout import/export/cold start trước chọn. Không mặc định proxy đáp ứng payload và thời gian xử lý hiện tại. [Vercel rewrites](https://vercel.com/docs/routing/rewrites).
- Hai subdomain cùng domain riêng là phương án khác nhưng domain riêng không nằm trong yêu cầu free mặc định. Không đổi cấu hình deploy hiện tại trước khi review phương án.

### 10. Tích hợp giao diện

- Thêm màn đăng nhập/đăng ký tiếng Việt và nút Google, user menu và mục Báo cáo của tôi; giữ nhận diện và các thành phần nghiệp vụ hiện tại.
- Kiểm tra `/auth/me` khi mở app; tách trạng thái đang kiểm tra, chưa đăng nhập và đã đăng nhập. Không nhầm 503 do backend ngủ với 401.
- Sau analyze/import, hiển thị báo cáo đã tạo và trạng thái lưu. Nếu phân tích thành công nhưng DB lỗi, giữ kết quả hiện có, báo chưa lưu và cho thử lưu lại; idempotency ngăn tạo bản trùng.
- Autosave debounce khoảng 1 giây, gộp patch, chỉ một request lưu đang chạy; thay đổi phát sinh trong lúc lưu được gửi sau đó. Hiển thị “Đang lưu / Đã lưu / Lưu thất bại”.
- expected revision chống ghi đè từ hai tab/thiết bị; conflict cho tải lại hoặc giữ bản cục bộ để xử lý, không âm thầm ghi đè.
- Cảnh báo rời trang khi còn thay đổi chưa lưu; export phải flush autosave thành công. Không hứa đảm bảo lưu ở thời điểm tab bị đóng đột ngột.
- Mở lại báo cáo khôi phục đúng title, rows, selected, metadata, mapping, parameters và ảnh; sort/filter là trạng thái hiển thị, chưa lưu theo tài khoản ở bản đầu.
- Đăng xuất/xuất hiện 401 xóa dữ liệu tài khoản khỏi bộ nhớ; nếu còn chỉnh sửa chưa lưu thì báo rõ trước thao tác logout chủ động. Không hiện báo cáo của user trước khi user mới đăng nhập.
- Mở lại báo cáo có danh sách file nguồn/bản xuất và ảnh từ Cloudinary, xem TSV/XLSX qua preview endpoint và tải đúng file gốc; hiển thị tên, kích thước, trạng thái lưu và revision của bản xuất. File chưa lưu/lỗi cần bổ sung hoặc upload lại, không dựng file giả từ kết quả.
- Cold start có trạng thái chờ rõ ràng và retry GET có backoff; không tự retry POST import/export tùy tiện. Giữ GNPS URL allowlist và fallback mở tab mới như hiện tại.

### 11. Các đợt triển khai sau review

1. **Nền DB:** tách app/bootstrap, DB config/schema/migration/repository, env validation, error handling, test DB riêng; chưa thay engine đối sánh.
2. **Auth:** email/mật khẩu, PostgreSQL sessions, CSRF, Google OAuth và liên kết an toàn; kiểm thử cookie local/production và session sau restart.
3. **Lưu báo cáo và Cloudinary:** ownership, snapshot/rows/assets, upload image/raw authenticated, quota reservation, revision, idempotency, export bản lưu và cleanup/retry bền vững; tích hợp import/analyze.
4. **Frontend:** auth UI, danh sách/mở lại, autosave, trạng thái lỗi/conflict, export chờ lưu; giữ ngôn ngữ tiếng Việt.
5. **Deploy/QA:** Render + Neon + Google + Cloudinary config, migration/backup/restore đầy đủ tài sản, đo RAM và thời gian trên dataset thực; cập nhật README và trạng thái kế hoạch theo kiểm chứng.

Tệp dự kiến: `server/index.ts`, mới `server/app.ts`, `server/config.ts`, `server/db/*`, `server/auth/*`, `server/reports/*`, `server/media/*` (Cloudinary client, upload/download, quota, cleanup/retry), middleware/tests, migration SQL và cấu hình Drizzle; `src/App.tsx`, auth/report/assets UI và API client; `package.json`, lockfile, `.env.example`, `render.yaml`, README. `server/gnps-task.ts` thêm khả năng thu thập file thực tế importer đã tải; `server/matching.ts` và parser/export giữ hợp đồng nghiệp vụ, chỉ refactor tối thiểu khi cần.

### 12. Tiêu chí nghiệm thu

1. Tài khoản A không thể đọc, sửa, xóa, xuất hoặc lấy ảnh của B kể cả biết report ID/asset ID. Chưa login không được dùng API nghiệp vụ.
2. Đăng ký/login/logout/đổi mật khẩu hoạt động; DB không chứa mật khẩu/token Google dạng plaintext. Session tồn tại qua restart nhưng session hết hạn/đã logout không dùng được.
3. Google: thành công, hủy, sai state/nonce/issuer/audience, expired/replayed callback và trùng email đều xử lý đúng; liên kết không làm mất báo cáo hoặc chiếm tài khoản khác.
4. Reload/đổi thiết bị mở lại đúng title, toàn bộ rows, selected, metadata và ảnh. DOCX/XLSX phản ánh bản lưu mới nhất, thứ tự export không đổi bởi sort trên giao diện.
5. Lỗi transaction/quota/DB không tạo báo cáo dở; retry tạo báo cáo không tạo trùng; cập nhật đồng thời trả conflict thay vì mất dữ liệu.
6. File/JSON quá lớn, invalid numeric/enum, metadata quá dài và request quá dày bị từ chối rõ ràng; nguồn GNPS ngoài allowlist vẫn bị chặn.
7. Đo peak RAM cho TSV/XLSX thật, GNPS import, hash mật khẩu và export dưới giới hạn concurrency; điều chỉnh upload/row quota từ số đo.
8. Unit tests cho validation/auth helpers; integration tests trên PostgreSQL test riêng cho ownership, session, transaction, unique, quota và revision. Không chạy test phá dữ liệu trên production.
9. Regression test hiện tại, typecheck, build frontend/server và diff check đạt. Kiểm tra giao diện dark/light, mobile, đăng xuất và unsaved changes.
10. Kiểm thử thực tế HTTPS/Google/cold start trên host free và backup/restore đã xác nhận; nếu thiếu cloud credentials thì báo riêng phần chưa kiểm chứng, không coi test local là deploy đã đạt.
11. Cloudinary: upload/tải lại image và raw TSV/XLSX/GraphML/MGF/DOCX, kiểm tra hash file gốc và ảnh phân tử không đổi nội dung; ảnh/file vẫn mở lại sau restart Render. File quá giới hạn provider bị chặn trước upload; missing config/quota/timeouts báo đúng phần chưa lưu.
12. User khác không lấy được asset qua API hoặc Cloudinary URL unsigned; kiểm thử tài sản authenticated, không xuất hiện secret/URL ký lâu dài trong response/log. Signed upload không được coi là private delivery.
13. Upload thành công rồi DB lỗi, upload lỗi từng phần, delete cloud lỗi, retry sau restart và tài sản dùng chung nhiều báo cáo được xử lý không mất file hợp lệ; reservation không rò và file orphan được đối soát/dọn.
14. Bản xuất gắn đúng revision, file nguồn không bị sửa khi chỉnh rows, quota gồm bản xuất/ảnh/file và backup phục hồi được cả PostgreSQL lẫn tài sản cloud. Chính sách giữ 5 bản xuất hoạt động đúng và được hiển thị.

### 13. Những giả định cần review

- Chọn PostgreSQL/Neon, giữ Node.js/Express/TypeScript; ứng dụng cùng origin trên Render là cấu hình free ưu tiên.
- Bắt buộc đăng nhập cho nghiệp vụ, một vai trò user, lưu báo cáo riêng; chưa có chế độ khách hay chia sẻ nhóm.
- Bản đầu bổ sung Cloudinary lưu ảnh, file nguồn tương ứng và bản xuất theo revision; PostgreSQL giữ dữ liệu nghiệp vụ và metadata tài sản. Chưa có email quên mật khẩu/xác minh email.
- Quota ban đầu sẽ đo và điều chỉnh trước phát hành. Tài khoản cloud và OAuth credentials sẽ cấu hình ở giai đoạn deploy.
- **Đã nhận yêu cầu “triển khai”; nội dung kế hoạch cũ bên dưới được giữ nguyên.**

## Bổ sung — Sắp xếp dữ liệu theo từng cột kiểu Excel

**Trạng thái: Đã triển khai và kiểm tra ngày 05/09/2026.**

1. Thêm biểu tượng lọc/sắp xếp trong tiêu đề các cột có giá trị số/chữ; không thêm vào checkbox, STT và cột ảnh cấu trúc.
2. Cột số có lựa chọn `Từ thấp đến cao` và `Từ cao đến thấp`; cột chữ có `A → Z` và `Z → A`.
3. Các cột metadata GNPS phát sinh được tự nhận kiểu từ dữ liệu thực tế; giá trị rỗng luôn nằm cuối danh sách.
4. Mỗi lần chỉ áp dụng một cột sắp xếp. Có thể xóa sắp xếp để trở về thứ tự nguồn ban đầu.
5. Sắp xếp được áp dụng sau search và bộ lọc trạng thái, chỉ thay thứ tự hiển thị; dữ liệu gốc, chỉnh sửa, chọn dòng và thứ tự export giữ nguyên.
6. Kiểm tra dark/light theme, TypeScript, test, production build và `git diff --check`.

## Bổ sung cần review — Three.js premium analytical environment

**Trạng thái: Đã chuyển sang Canvas 2D theo mẫu, chờ kiểm tra trực quan.**

### 1. Ý tưởng thị giác

1. Xây dựng không gian “Mass Spectrometry Observatory” có chiều sâu, giữ vùng giữa sạch để không cạnh tranh với tiêu đề và form.
2. Ba lớp chính: dải phổ năng lượng uốn trong không gian; mạng phân tử phát sáng ở hai biên; trường đỉnh phổ và hạt bụi có phối cảnh.
3. Thêm vòng quét phân tích, halo mềm và các xung sáng chạy dọc liên kết để cảnh có điểm nhấn cao cấp nhưng không giống hiệu ứng game.
4. Dark mode dùng nền graphite với cyan–blue–violet phát quang; light mode dùng nền trắng xanh, teal–azure–lavender dịu và bóng kính sáng.

### 2. Tương tác và chuyển động

1. Camera parallax có quán tính theo con trỏ, giới hạn góc nhỏ để không gây chóng mặt.
2. Các lớp chuyển động ở tốc độ khác nhau để tạo chiều sâu; đỉnh phổ dao động chậm theo chu kỳ độc lập.
3. Con trỏ tạo vùng sáng ảnh hưởng nhẹ tới hạt và đường phổ, không che hoặc chặn thao tác form.
4. Chuyển dark/light nội suy màu mượt, không dựng lại toàn bộ canvas và không làm mất trạng thái nhập liệu.

### 3. Kỹ thuật và hiệu năng

1. Dùng instanced mesh/points cho phần tử lặp lại, shader đơn giản cho glow và luồng hạt; tránh tạo hàng trăm React mesh riêng lẻ.
2. Giới hạn DPR theo thiết bị, giảm mật độ trên mobile và tạm dừng animation khi tab bị ẩn.
3. Giữ lazy-load; fallback CSS gradient nếu WebGL lỗi. Không dùng MP4/HLS hoặc tài nguyên mạng cho background.
4. `prefers-reduced-motion` hiển thị cùng bố cục ở trạng thái tĩnh, không loại bỏ hoàn toàn phần nghệ thuật.

### 4. Phạm vi và nghiệm thu

1. Chỉ thay `src/MoleculeScene.tsx` và các style nền homepage cần thiết; không đổi header, form, API, màn hình kết quả hoặc dữ liệu.
2. Không giảm độ tương phản của chữ/form ở cả hai mode và không gây horizontal overflow trên mobile.
3. Kiểm tra TypeScript, production build, `git diff --check`; đánh giá kích thước bundle và đảm bảo Three.js tiếp tục nằm trong chunk lazy riêng.

## Bổ sung cần review — Homepage HLS dark glass với vùng nạp dữ liệu trung tâm

**Trạng thái: Đã triển khai và kiểm tra ngày 03/09/2026.**

### 1. Phạm vi và nguyên tắc kết hợp

1. Làm lại riêng homepage theo mẫu dark fullscreen trong file đính kèm: nền video HLS phủ toàn màn hình, navbar kính dạng pill và nội dung trung tâm; `100svh`, không cuộn ở desktop.
2. Giữ nguyên các thành phần header hiện tại theo yêu cầu:
   - logo `GNPS2 Converter`;
   - thanh quy trình `Dữ liệu → Đối sánh → Xuất báo cáo`;
   - trạng thái Engine;
   - nút chuyển Dark/Light Mode.
3. Không dùng logo Asme, nav Features/Pricing/About, Sign Up/Login hoặc email capture của mẫu.
4. Vùng CTA/email chính giữa được thay hoàn toàn bằng nghiệp vụ nạp dữ liệu hiện tại: `Nhập link GNPS2` hoặc `Tải TSV + XLSX`.
5. Không thay đổi màn hình kết quả, metadata, ngăn GNPS, matching, export hoặc API nghiệp vụ.

### 2. Video HLS và nền hero

1. Dùng đúng stream `https://stream.mux.com/kimF2ha9zLrX64H00UgLGPflCzNtl1T0215MlAmeOztv8.m3u8`.
2. Bổ sung dependency `hls.js`:
   - Safari/native HLS: gán URL trực tiếp cho `video.src`;
   - trình duyệt khác: `Hls.loadSource()` và `attachMedia()`;
   - cleanup instance khi unmount, không rò listener.
3. Video `autoplay`, `muted`, `loop`, `playsInline`, `object-fit: cover`; có lớp scrim đen/gradient để form và header luôn rõ.
4. Có fallback nền đen khi HLS lỗi/không được hỗ trợ; lỗi video không chặn chức năng nạp dữ liệu.
5. Với `prefers-reduced-motion`, không chạy animation nền mạnh; vẫn giữ nền tối dễ đọc.

### 3. Header kính dùng thành phần hiện tại

1. Header nằm trong container `max-width: 1180px`, bo tròn pill, glass blur/saturate và pseudo-element gradient border giống mẫu.
2. Logo ở trái; thanh quy trình ở giữa; bên phải là Engine status và mode toggle như hiện tại.
3. Responsive:
   - desktop hiển thị đủ ba bước;
   - màn hình hẹp thu gọn nhãn bước nhưng vẫn giữ số/trạng thái;
   - mobile giữ logo, Engine dot và mode; thanh quy trình chuyển thành hàng compact bên dưới trong cùng glass header.
4. Header màn hình kết quả tiếp tục dùng bố cục hiện tại, chỉ homepage dùng biến thể glass fullscreen.

### 4. Trạng thái Engine thực tế

1. Thêm state `checking | ready | offline` ở frontend.
2. Gọi `GET /api/health` ngay khi ứng dụng khởi động, timeout ngắn và kiểm tra lại định kỳ; kiểm tra lại khi tab trở về trạng thái visible.
3. Chỉ hiển thị `ENGINE SẴN SÀNG` khi response thành công và có `ok: true`.
4. Trong lúc gọi hiển thị `ĐANG KIỂM TRA`; khi timeout/network/API lỗi hiển thị `ENGINE MẤT KẾT NỐI` với màu đỏ/cam và tooltip ngắn.
5. Health-check không làm bật alert nghiệp vụ và không cản người dùng chọn file; khi bắt đầu gọi API thật, lỗi vẫn dùng thông báo hiện tại.

### 5. Vùng nạp dữ liệu trung tâm

1. Tagline và heading giữ phong cách mẫu nhưng dùng nội dung GNPS2:
   - tagline `MASS SPECTROMETRY ANALYTICAL WORKSPACE`;
   - heading serif `Đối sánh dữ liệu phổ khối. Tạo báo cáo chuẩn xác.`
2. Bên dưới heading là glass card trung tâm, dùng lại state/callback hiện có:
   - pill toggle `Nhập link GNPS2` / `Tải TSV + XLSX`;
   - chế độ Task: input URL + nút `Đọc dữ liệu GNPS2`;
   - chế độ file: hai vùng chọn TSV/XLSX compact, tiêu đề báo cáo và nút `Bắt đầu đối chiếu`.
3. Giữ validation, loading overlay, mapping modal, drag/drop, preview parsing và tự nhận tiêu đề như hiện tại.
4. Các mô tả dài/stages được rút gọn hoặc ẩn ở viewport thấp để toàn bộ tương tác chính nằm trong một màn hình; mobile được phép cuộn dọc khi chiều cao không đủ để tránh mất nút.
5. Chế độ sáng giữ video nhưng tăng lớp phủ sáng/tương phản phù hợp; form, chữ và glass border vẫn đọc được.

### 6. Công nghệ và tệp dự kiến thay đổi

1. Giữ CSS hiện tại thay vì chuyển toàn dự án sang Tailwind v4; tái hiện chính xác class liquid-glass bằng CSS có scope. Việc này tránh làm thay đổi màn hình kết quả.
2. Dùng `framer-motion` đang có thay cho cài thêm package `motion`; dùng các SVG icon hiện tại theo yêu cầu giữ header.
3. Tệp thay đổi:
   - `package.json`, `package-lock.json`: thêm `hls.js`;
   - `src/App.tsx`: component HLS background, health polling và homepage layout;
   - `src/styles.css`: font Inter/Instrument Serif, fullscreen/glass/form responsive;
   - `implement_plan.md`: cập nhật trạng thái sau triển khai.
4. `server/index.ts` không cần đổi vì `/api/health` đã tồn tại và trả `{ ok: true }`.

### 7. Tiêu chí nghiệm thu

1. Homepage desktop là một màn hình, video HLS cover, không xuất hiện scrollbar hoặc nội dung bị cắt ở chiều cao phổ biến.
2. Header giữ đủ logo, ba bước, trạng thái Engine và mode toggle; glass border/blur bám sát mẫu.
3. Khi API tắt, header đổi sang mất kết nối; khi API hoạt động lại, tự trở về sẵn sàng mà không reload trang.
4. Cả hai cách nhập dữ liệu hoạt động giống trước; state không mất khi chuyển tab nhập.
5. Loading, lỗi, mapping và chuyển sang danh sách kết quả hoạt động đúng.
6. Mobile 375px không tràn ngang; form có thể cuộn nếu viewport thấp, không mất CTA.
7. Màn hình kết quả và các bổ sung trước đó không bị thay đổi.
8. `npm test`, `npm run typecheck`, `npm run build` đạt; QA trực quan nếu trình duyệt kết nối khả dụng.

## Bổ sung cần review — Thiết kế lại homepage theo phong cách Targo + GNPS2

**Trạng thái: Đã hoàn tác theo yêu cầu ngày 03/09/2026; homepage trở về giao diện trước hạng mục này.**

### 1. Hướng kết hợp đã chọn

1. Áp dụng ngôn ngữ hình ảnh từ prompt Targo: font Quantico, nền `#F2F1F0`, video toàn cảnh, headline bậc thang, màu cyan `#15BCDF`, nút vát góc và bố cục hai section.
2. Giữ thương hiệu và nghiệp vụ hiện tại của GNPS2 Converter; không đổi logo thành `targo`, không dùng nội dung “Targo builds…” và không loại bỏ form nhập GNPS Task/TSV/XLSX.
3. Chỉ thiết kế lại homepage (`stage === 'upload'`). Màn hình danh sách kết quả, metadata, ngăn GNPS, dialog và export vừa hoàn thiện giữ nguyên giao diện/chức năng.
4. Homepage có đúng hai section và không hiện footer ở homepage; footer màn hình kết quả được giữ để không thay ngoài phạm vi.

### 2. Section 1 — Hero GNPS2

1. Chiều cao tối thiểu `100svh`, nền sáng và video hero đúng URL trong prompt, không crop (`object-fit: contain`), vị trí desktop/mobile đúng thông số đã cung cấp.
2. Thêm cơ chế autoplay an toàn: luôn muted, thử `play()` lại mỗi giây khi chưa chạy và thử lại ở lần click/touch đầu tiên; cleanup đầy đủ khi rời homepage.
3. Navbar mang style Targo nhưng dùng nhận diện GNPS2:
   - logo bình thí nghiệm + chữ `GNPS2 Converter` hiện tại;
   - link `TRANG CHỦ`, `GIỚI THIỆU`, `NẠP DỮ LIỆU` cuộn đến section tương ứng;
   - nút `NẠP DỮ LIỆU` vát góc ở desktop;
   - hamburger và menu xếp dọc dưới 700px.
4. Headline sáu dòng bậc thang dùng nội dung nghiệp vụ:
   - `BIẾN`
   - `DỮ LIỆU`
   - `PHỔ KHỐI`
   - `THÀNH`
   - `BÁO CÁO`
   - `CHUẨN XÁC` màu cyan.
5. CTA `BẮT ĐẦU PHÂN TÍCH` cuộn mượt đến vùng nạp dữ liệu; dùng đúng hình vát góc, màu, border, glow và trailing line từ prompt.
6. Desktop có scrim trái đúng gradient prompt; mobile bỏ scrim, đưa headline xuống dưới video và giữ video không che chữ.

### 3. Section 2 — Giới thiệu kết hợp vùng nạp dữ liệu

1. Giữ nền chuyển tiếp và padding theo prompt, không có khoảng trắng thừa ở mép phải của media.
2. Phần mở đầu dùng bố cục About:
   - headline `VỀ / GNPS2` dạng bậc thang, dòng `GNPS2` màu cyan;
   - đoạn giới thiệu tiếng Việt về đối sánh phổ khối, Library Matches, RT, cấu trúc và xuất báo cáo;
   - video thứ hai ở cột phải, phủ lớp cyan `mix-blend-mode: hue` đúng prompt.
3. Ngay bên dưới nhưng vẫn nằm trong section 2 là workspace nạp dữ liệu hiện tại:
   - giữ hai tab `Nhập link GNPS2` và `Tải TSV + XLSX`;
   - giữ nguyên state, validation, preview file, title, mapping và các API callback;
   - restyle card/input/dropzone/button theo Quantico + nền sáng + cyan, không thay nghiệp vụ.
4. Link `NẠP DỮ LIỆU` và CTA hero cuộn thẳng đến workspace; `GIỚI THIỆU` cuộn đến đầu section 2.

### 4. Responsive, theme và accessibility

1. Breakpoint chính 700px đúng prompt; các breakpoint cũ chỉ giữ khi cần cho form upload.
2. Mobile: ẩn nav desktop, mở hamburger có `aria-expanded`, đóng menu sau khi chọn link; headline/video/form không tràn ngang.
3. Hai video tôn trọng `prefers-reduced-motion`: không ép retry liên tục và hiển thị frame/poster nền ổn định khi người dùng giảm chuyển động.
4. Homepage mới dùng palette sáng cố định theo prompt. Nút theme không xuất hiện tại homepage; màn hình kết quả vẫn giữ Dark/Light Mode hiện có.
5. Focus-visible rõ, link/button có target hợp lệ, video decorative dùng `aria-hidden`, nội dung không phụ thuộc riêng vào chuyển động.

### 5. Tệp dự kiến thay đổi

- `src/App.tsx`: cấu trúc hai section, navbar mobile, refs cuộn trang và autoplay-retry; tái sử dụng nguyên logic form hiện tại.
- `src/styles.css`: scope style mới dưới homepage để không ảnh hưởng màn hình kết quả.
- `index.html` hoặc CSS import: nạp Google Font Quantico 400/700 và fallback an toàn.
- `implement_plan.md`: cập nhật trạng thái sau triển khai.

Không thay `server/*`, model dữ liệu, API matching hoặc export.

### 6. Tiêu chí nghiệm thu

1. Homepage có đúng hai section, không footer; kết quả vẫn hoạt động như hiện tại.
2. Hai URL video, desktop/mobile position, scrim, hue overlay, font, màu và nút vát góc bám sát prompt.
3. Nội dung hiển thị vẫn là GNPS2 Converter và đầy đủ luồng nhập Task/TSV/XLSX.
4. CTA/nav cuộn đúng vị trí; hamburger hoạt động và không làm mất state form.
5. Hai phương thức nhập vẫn gọi đúng API, loading/error/mapping hoạt động không đổi.
6. Không xuất hiện horizontal overflow ở 375px, 700px, tablet và desktop; màn hình ngắn vẫn thấy CTA.
7. `npm test`, `npm run typecheck`, `npm run build` đạt; QA trực quan desktop/mobile nếu trình duyệt kết nối khả dụng.

## Bổ sung cần review — Hiển thị đầy đủ metadata GNPS và ngăn web đối chiếu

**Trạng thái: Đã triển khai và kiểm tra ngày 03/09/2026.**

### 1. Mục tiêu và nguyên tắc giữ tương thích

1. Giữ nguyên toàn bộ trường/cột đang có trên danh sách: chọn dòng, STT, `tR (min)`, tên hoạt chất, ion, ion tiền chất, mảnh vỡ, công thức + sai số ppm và cấu trúc phân tử.
2. Bổ sung đầy đủ metadata Library Matches mà GNPS trả về; không thay tên, không làm mất giá trị `null`, không loại bỏ các trường cũ trong `MatchRow` và không thay đổi hành vi chọn/chỉnh sửa/xuất báo cáo hiện tại.
3. Hai nguồn đều dùng chung model:
   - nhập GNPS Task: lưu nguyên dữ liệu của mỗi object Library Matches;
   - nạp TSV + XLSX: lấy metadata từ đúng dòng TSV gốc, kể cả các cột ngoài phần ánh xạ hiện tại.
4. Giá trị gốc được giữ dưới dạng chuỗi/số/null để tránh mất định dạng; các giá trị số chỉ được parse riêng cho những phép tính/chỉnh sửa hiện có.

### 2. Danh sách trường cần bổ sung

Hiển thị theo thứ tự ổn định và chia nhóm để dễ đọc:

- **Định danh và phổ:** `SpectrumID`, `#Scan#`, `SpectrumFile`, `LibraryName`, `MQScore`, `TIC_Query`, `RT_Query`, `MZErrorPPM`, `SharedPeaks`, `MassDiff`, `SpecMZ`, `SpecCharge`, `FileScanUniqueID`, `NumberHits`.
- **Thông tin hợp chất/thư viện:** `Compound_Name`, `Ion_Source`, `Instrument`, `Compound_Source`, `PI`, `Data_Collector`, `Adduct`, `Precursor_MZ`, `ExactMass`, `Charge`, `CAS_Number`, `Pubmed_ID`, `Smiles`, `INCHI`, `INCHI_AUX`, `Library_Class`, `IonMode`, `Organism`, `LibMZ`, `UpdateWorkflowName`, `LibraryQualityString`, `tags`, `molecular_formula`, `InChIKey`, `InChIKey-Planar`.
- **Phân loại:** `superclass`, `class`, `subclass`, `npclassifier_superclass`, `npclassifier_class`, `npclassifier_pathway`, `library_usi`.

Ngoài danh sách cố định trên, nếu GNPS/TSV có cột mới trong tương lai thì vẫn giữ trong metadata và đưa vào nhóm **Trường bổ sung** thay vì silently drop.

### 3. Model dữ liệu và backend

1. Mở rộng `MatchRow` ở cả server/client bằng `sourceMetadata: Record<string, string | number | null>`; đây là phần bổ sung, không thay thế các thuộc tính cũ đang phục vụ UI/report.
2. `server/gnps-task.ts` sao chép an toàn toàn bộ object Library Matches vào `sourceMetadata`, chuẩn hóa `undefined` thành `null`, đồng thời giữ logic RT, fragments, structure và trạng thái hiện có.
3. `server/matching.ts` gắn toàn bộ dòng TSV gốc vào `sourceMetadata`; dữ liệu Excel đối chiếu và các trường tính toán cũ vẫn giữ nguyên như hiện tại.
4. Không cho metadata tùy ý ghi đè `id`, `selected`, trạng thái hoặc các trường nội bộ của ứng dụng.
5. API export vẫn nhận được model cũ và metadata mới. Word giữ layout báo cáo hiện hữu; Excel bổ sung các cột metadata sau các cột báo cáo cũ, đúng yêu cầu “chỉ bổ sung, không xóa bớt”.

### 4. Giao diện danh sách

1. Giữ nguyên các cột hiện tại ở bên trái và nối các cột metadata phía sau theo thứ tự tại mục 2.
2. Giữ checkbox, STT và tên hoạt chất dạng sticky khi cuộn ngang; header tiếp tục sticky theo chiều dọc.
3. Giá trị dài (`Smiles`, `INCHI`, taxonomy, `library_usi`...) hiển thị một dòng rút gọn, có tooltip/title và thao tác sao chép; không tăng chiều cao toàn bộ dòng.
4. `null`, chuỗi rỗng và trường không có ở nguồn hiển thị `—`, nhưng dữ liệu gốc không bị đổi thành chuỗi `—`.
5. Search hiện tại được mở rộng để tìm trên cả trường cũ lẫn toàn bộ `sourceMetadata`.
6. Bộ lọc, inline edit các trường cũ, dialog cấu trúc, chọn dòng và thống kê giữ nguyên hành vi.
7. Bảng dùng độ rộng tối thiểu theo cột và cuộn ngang riêng; desktop ưu tiên mật độ thông tin, tablet/mobile vẫn cuộn được và không khóa cuộn trang.

### 5. Ngăn web GNPS tại màn hình danh sách

1. Thêm nút `Đối chiếu GNPS` trong cụm thao tác của trang kết quả.
2. Nút mở/đóng một ngăn bên phải bằng `iframe`, dùng đúng URL GNPS đã nhập; với luồng import Task sẽ tự dựng URL Library Matches từ Task ID khi cần.
3. Thanh đầu ngăn hiển thị URL rút gọn, nút tải lại, sao chép link, mở ở tab mới và đóng ngăn.
4. Chỉ cho phép URL `https://gnps2.org` hoặc `https://www.gnps2.org`; không nhúng URL tùy ý. `iframe` có title rõ ràng, referrer policy và sandbox ở mức đủ để GNPS hoạt động nhưng không cấp quyền không cần thiết.
5. Nếu GNPS gửi `X-Frame-Options`/`Content-Security-Policy` chặn nhúng, hoặc trang không tải, ngăn vẫn giữ thông tin đối chiếu và đưa nút `Mở GNPS ở tab mới`; không proxy HTML/credential của GNPS qua backend.
6. Khi ngăn mở, bố cục dùng split view tương tự trình xem TSV/XLSX hiện có. Chỉ mở một ngăn phụ tại một thời điểm để tránh ép bảng quá hẹp.

### 6. Tệp dự kiến thay đổi

- `server/types.ts`: kiểu metadata dùng chung phía server.
- `src/types.ts`: kiểu metadata phía client.
- `server/gnps-task.ts`: giữ toàn bộ trường Library Matches.
- `server/matching.ts`: giữ toàn bộ cột dòng TSV gốc.
- `server/index.ts`: bổ sung metadata vào Excel export mà không thay các cột report cũ.
- `src/App.tsx`: cột metadata, search mở rộng, điều khiển/ngăn web GNPS.
- `src/styles.css`: sticky columns, bảng rộng, split view, drawer responsive và dark/light theme.
- `server/gnps-task.test.ts`, `server/matching.test.ts` và test export/UI phù hợp: kiểm tra không mất trường, null và trường phát sinh.

### 7. Tiêu chí nghiệm thu

1. Object mẫu trong yêu cầu hiển thị đủ tất cả key/value; `CAS_Number`, `Pubmed_ID`, `INCHI_AUX`, `tags` hiển thị `—` nhưng dữ liệu vẫn là `null`.
2. Các cột và khả năng chỉnh sửa cũ không bị mất; thứ tự cột cũ không thay đổi.
3. Cả luồng GNPS Task và TSV + XLSX đều mang metadata tới danh sách.
4. Search tìm được giá trị như `CCMSLIB00006679405`, `BJEPYKJPYRNKOW`, `Orbitrap` và `Fatty acids`.
5. Excel export chứa cột cũ trước, metadata mới sau; Word hiện tại không bị đổi layout ngoài phạm vi yêu cầu.
6. Ngăn GNPS mở/đóng/tải lại đúng link, không làm mất state chỉnh sửa/chọn dòng; có fallback rõ khi GNPS không cho nhúng.
7. Bảng và ngăn hoạt động ở desktop/tablet/mobile, dark/light mode, bàn phím và reduced motion.
8. `npm test`, `npm run typecheck` và `npm run build` đạt; kiểm tra thủ công với object mẫu và một GNPS Task thật.

### 8. Ngoài phạm vi lần bổ sung này

- Không đổi thuật toán match, quy tắc lấy RT/fragments/structure hoặc trạng thái dòng.
- Không biến mọi metadata thành trường chỉnh sửa; các field mới là dữ liệu nguồn chỉ đọc để đối chiếu.
- Không đổi template Word hiện tại thành bảng hơn 40 cột; dữ liệu đầy đủ được đưa vào danh sách và Excel.

## Bổ sung cần review — Trình xem nội dung TSV/XLSX trong chế độ nạp file

**Trạng thái: Đã triển khai và kiểm tra ngày 22/07/2026.**

### Mục tiêu và giao diện

Sau khi đối chiếu, trình xem file xuất hiện theo yêu cầu trên **trang kết quả**:

- Hai nút `Xem TSV` và `Xem XLSX` nằm trong cụm thao tác phía trên bảng kết quả.
- Bấm file nào sẽ chia vùng dữ liệu thành hai nửa: bảng kết quả bên trái và nội dung file đã chọn bên phải; đóng trình xem sẽ trả bảng về toàn chiều rộng.

Thiết kế chi tiết:

1. Desktop dùng split-view cạnh bảng kết quả; màn hình hẹp xếp trình xem phía trên bảng để giữ khả năng đọc.
2. Tab TSV/XLSX chỉ khả dụng khi file tương ứng đã được chọn.
3. Toolbar hiển thị tên file, dung lượng, tổng dòng/cột, ô search, nút xóa search, phân trang; XLSX có thêm chọn sheet.
4. Bảng preview có header sticky, custom scrollbar, hover row, tooltip ô dài và highlight từ khóa.
5. Có trạng thái rỗng/loading/lỗi/giới hạn dữ liệu; đồng bộ Dark/Light Mode và reduced motion.
6. Không để bảng con bắt wheel ngoài vùng cuộn của nó hoặc làm khóa scroll chính/carousel.

### API và xử lý dữ liệu

1. Thêm `POST /api/files/preview`, nhận một `.tsv` hoặc `.xlsx` bằng cấu hình Multer hiện có.
2. TSV dùng `csv-parse`, XLSX dùng `exceljs`; không thêm dependency.
3. Response chuẩn hóa gồm tên/loại file, sheet, header, rows, tổng dòng và cờ giới hạn preview.
4. Backend trả tối đa **1.000 dòng mỗi sheet** để tránh treo UI; luồng đối chiếu thật vẫn đọc toàn bộ file.
5. Chuẩn hóa header trống/trùng, giữ số 0/ô trống/ngày tháng ở dạng an toàn; không render HTML hoặc thực thi nội dung trong file.
6. Search chạy phía client trên tập preview, không gọi API theo từng ký tự.

### Trạng thái frontend

1. Chọn file sẽ tự tải preview, nhưng vẫn giữ `File` gốc cho API đối chiếu hiện tại.
2. TSV và XLSX có state `idle/loading/ready/error` độc lập.
3. Chọn lại file sẽ bỏ qua response cũ để tránh race condition.
4. Search không phân biệt hoa/thường, áp dụng trên mọi cột; mặc định 50 dòng/trang.
5. Lỗi preview không chặn đối chiếu nếu hai file đầu vào vẫn hợp lệ.
6. Trình xem chỉ đọc; chỉnh sửa nghiệp vụ vẫn thực hiện ở bảng kết quả để tránh hiểu nhầm file nguồn đã được sửa.

### Tệp dự kiến thay đổi

- `server/index.ts`: endpoint preview và validation.
- `src/types.ts`: kiểu dữ liệu preview.
- `src/App.tsx`: state preview, split-view, tab, sheet, search và phân trang.
- `src/styles.css`: layout, bảng preview, responsive và scrollbar.
- Test backend phù hợp: TSV/XLSX, sheet, header trùng/trống và giới hạn preview.

### Tiêu chí nghiệm thu

1. TSV và từng sheet XLSX hiển thị đúng header/nội dung.
2. Search toàn bảng, highlight đúng, có tổng kết quả và nút xóa.
3. Sticky header, phân trang và custom scrollbar không khóa scroll trang chính.
4. File hơn 1.000 dòng có cảnh báo preview giới hạn, nhưng đối chiếu vẫn dùng toàn bộ dữ liệu.
5. Thay file liên tục không hiển thị dữ liệu cũ.
6. Desktop/tablet/mobile và Dark/Light Mode đều đúng layout.
7. Luồng GNPS2 URL, đối chiếu, dialog cấu trúc và xuất Word/Excel không bị thay đổi.
8. Typecheck, unit tests và production build đều đạt.

## Bổ sung cần review — UI polish, theme và loading transition

### Phạm vi thay đổi

1. **Light/Dark mode**
   - Bổ sung nút chuyển theme trên topbar, có icon mặt trời/mặt trăng cùng hàng với trạng thái hệ thống.
   - Dùng CSS variables cho toàn bộ nền, panel, border, chữ, bảng, input và scrollbar; không vá màu rời rạc.
   - Tự nhận theme hệ điều hành lần đầu, lưu lựa chọn vào `localStorage`, chống nháy sai theme khi tải lại.
   - Three.js và gradient đổi màu phù hợp từng theme; giữ `prefers-reduced-motion`.

2. **Hero tiếng Việt và gradient**
   - Đổi `MASS SPECTROMETRY WORKSPACE` thành `KHÔNG GIAN PHÂN TÍCH PHỔ KHỐI`.
   - Giữ nội dung chính đúng: `Biến dữ liệu phổ khối` / `thành báo cáo chuẩn xác.`
   - Phần `báo cáo chuẩn xác.` dùng gradient cyan → violet mềm, có fallback rõ trong light mode.
   - Sửa clipping ở đáy hero để các trust badge không bị đường phân cách che mất.

3. **Khu vực nạp dữ liệu**
   - Căn lại badge `01`, tiêu đề, mô tả và tabs theo cùng baseline/grid.
   - Tabs có active indicator trượt qua lại bằng Framer Motion.
   - Sửa connector dấu `+`: luôn nằm chính giữa hai dropzone, không dính border hay lệch khi responsive.
   - Căn icon, text, input và nút `Đọc dữ liệu GNPS2` bằng flex/grid thống nhất; icon không đè chữ.
   - Nút có hover/press/loading state rõ; trong loading, icon chuyển thành spinner và khóa thao tác lặp.

4. **Animation chuyển sang danh sách**
   - Khi bấm đọc task/upload, hiển thị overlay/progress card có 4 stage thật: Task → Library → Network/Mirror → Structures.
   - Dùng animation molecule/data-stream nhẹ trong thời gian chờ, sau đó crossfade/slide sang Preview.
   - Không dùng progress giả theo timer; stage được cập nhật từ backend hoặc dùng trạng thái stage tổng quát nếu API chưa stream.
   - Có reduced-motion fallback và thông báo lỗi ngay trong loading panel.

5. **Preview, log và bảng**
   - Chuyển notice/log nhập dữ liệu lên trên bảng kết quả, ngay dưới header/ảnh GNPS2; không để dưới đáy bảng.
   - Notice có icon, số ảnh/fragments và nút đóng; màu tương thích light/dark.
   - Custom scrollbar riêng cho `.table-wrap`: thumb, track, hover, cả ngang và dọc; giữ khả năng truy cập bàn phím.
   - Sticky table header, giới hạn chiều cao bảng theo viewport và giữ các ô input dễ đọc ở hai theme.

6. **Footer và nhận diện**
   - Thay `Engine v0.1 · Node.js + Carbone` bằng `createby TuanAnhNguyen`.
   - Chuẩn hóa chính tả hiển thị thành `Created by TuanAnhNguyen` nếu người dùng đồng ý; mặc định triển khai đúng chuỗi yêu cầu `createby TuanAnhNguyen`.

### Kiểm thử nghiệm thu

- Chụp và đối chiếu desktop ở dark/light mode tại màn Upload, Loading và Preview.
- Kiểm tra 1440px, 1024px và 390px; dấu `+`, icon nút và tabs không lệch hàng.
- Theme được lưu sau reload, không nháy nền sai.
- Loading xuất hiện ngay sau click, không cho double-submit và tự chuyển sang danh sách khi API hoàn tất.
- Notice nằm trên bảng; scrollbar tùy biến hoạt động với chuột, trackpad và bàn phím.
- Reduced motion tắt các chuyển động trượt/phức tạp nhưng luồng chức năng không đổi.
- Typecheck, unit test, production build và kiểm thử trình duyệt local đều đạt.

## Bổ sung cần review — Chế độ nhập GNPS2 Task URL

### Mục tiêu

Thêm phương pháp nhập dữ liệu thứ hai, chạy song song với phương pháp upload TSV + XLSX hiện tại. Người dùng chỉ cần dán một trong các URL GNPS2 có chứa Task ID, ưu tiên URL Status:

```text
https://gnps2.org/status?task=2515573ac8c24ec8b85f553aad9b440e
```

Ứng dụng tự động:

1. lấy Task ID 32 ký tự từ URL;
2. kiểm tra task công khai, trạng thái `DONE` và workflow được hỗ trợ;
3. lấy `Description` làm tiêu đề báo cáo nhưng vẫn cho phép sửa;
4. đọc toàn bộ Library Matches;
5. đọc `network_singletons.graphml` của chế độ “Visualize Full Network w/ Singletons”;
6. nối `Library Matches.#Scan#` với `GraphML node.id` để lấy `rt_min`;
7. dựng đúng schema Preview hiện tại và tự lấy ảnh từ `Smiles`/`INCHI`;
8. cho sửa/chọn dòng và xuất Word/Excel bằng luồng hiện có.

### Dữ liệu đã xác minh trên task mẫu

- Description: `Cao Xạ Đen 1 neg lần 2`.
- Library Matches: 27 dòng; có `#Scan#`, `Compound_Name`, `SpecMZ`, `MZErrorPPM`, `Adduct`, `Smiles`, `INCHI`, `RT_Query`.
- GraphML singletons: có node fields `mz`, `rt`, `rt_min`, `charge`, `library_compound_name`, `library_SMILES`, `library_InChI`.
- Ví dụ khóa nối: Library Match scan `33` nối node `id="33"`, trả `rt_min = 12.02` cho `CAFFEIC ACID [M-H]-`.

### Quy tắc ánh xạ sang báo cáo

| Trường báo cáo | Nguồn GNPS2 | Fallback |
|---|---|---|
| `tR(min)` | GraphML node `rt_min`, nối bằng `#Scan# = node.id` | Library Match `RT_Query`, đồng thời đánh dấu fallback |
| Tên hoạt chất | `Compound_Name` | GraphML `library_compound_name` |
| Ion | `Adduct` | tách hậu tố adduct trong `Compound_Name` nếu nhận diện chắc chắn |
| Khối lượng phân tử ion tiền chất | `SpecMZ` | GraphML `mz`, sau đó `LibMZ` |
| Khối lượng mảnh vỡ | chưa có trực tiếp trong bảng Library Matches | đọc spectrum MGF theo scan; nếu không đọc được thì để trống |
| Công thức phân tử | trường formula nếu workflow trả về | để trống; không suy đoán từ SMILES |
| Sai số ppm | `MZErrorPPM` | để trống |
| Cấu trúc phân tử | `Smiles`, sau đó `INCHI` | GraphML `library_SMILES`/`library_InChI`; không có thì để trống |

### API và xử lý backend dự kiến

- `POST /api/gnps-task/import` nhận `{ url }` và chỉ chấp nhận host GNPS2 hợp lệ.
- Trích Task ID, giới hạn timeout/kích thước response và chống SSRF bằng URL do server tự dựng, không fetch URL tùy ý từ client.
- Status HTML chỉ dùng để lấy Description, status và workflow.
- Library JSON: `/result?json=&task={task}&viewname=librarymatches`.
- Network GraphML: `/resultfile?task={task}&file=nf_output/networking/network_singletons.graphml`.
- Có fallback đường dẫn GraphML theo workflow/version nếu `networking/network_singletons.graphml` không tồn tại; không mặc định mọi workflow có cùng artefact.
- Parse XML bằng parser an toàn, vô hiệu DTD/external entities; không dùng regex cho xử lý production.
- Cache theo Task ID trong thời gian ngắn để tránh tải lại GNPS2 khi người dùng quay lại Preview.
- Trả diagnostics: tổng library rows, node rows, số nối được RT, số dùng `RT_Query`, số thiếu RT/cấu trúc/fragments.

### Thay đổi giao diện

- Màn hình đầu có hai tab rõ ràng:
  - `Nhập link GNPS2` — phương pháp nhanh, được chọn mặc định;
  - `Tải file TSV + XLSX` — giữ nguyên phương pháp thủ công hiện tại.
- Tab link chỉ có một ô URL, nút `Đọc dữ liệu GNPS2` và phần tiến trình thật: Task → Library Matches → Network → Structures.
- Sau import, cả hai phương pháp dùng chung Preview/Edit/Export; không tạo hai màn hình kết quả khác nhau.
- Tiêu đề tự điền từ Description và luôn cho phép sửa.

### Kiểm thử nghiệm thu cho chế độ link

1. Task mẫu trả đúng tiêu đề `Cao Xạ Đen 1 neg lần 2`.
2. Trả đủ 27 Library Matches, không loại dòng chỉ vì thiếu node/RT.
3. Scan `33` nhận `rt_min = 12.02` từ GraphML.
4. Ảnh Preview và ảnh Word của từng dòng có checksum nội dung tương ứng, không lặp ảnh mẫu.
5. Task chưa `DONE`, private/hết hạn hoặc thiếu GraphML phải có thông báo rõ và fallback hợp lý.
6. Một dòng thiếu formula/fragments/structure vẫn được giữ lại và ô tương ứng để trống.

### Điểm cần chốt trước khi triển khai

Đề xuất mặc định: nếu không lấy được `rt_min` từ GraphML thì dùng `RT_Query` và hiển thị nhãn cảnh báo trên dòng. Không tự loại dòng Library Match. Sau khi người dùng duyệt phần bổ sung này, triển khai backend importer, tab nhập link và bộ integration test với task mẫu.

## 1. Mục tiêu sản phẩm

Xây dựng web app desktop-friendly giúp người dùng:

1. tải lên một file kết quả GNPS dạng `.tsv` và một file dữ liệu gốc `.xlsx`;
2. cấu hình ngưỡng matching theo `m/z` và retention time;
3. xem, lọc, chọn/bỏ chọn và sửa thủ công kết quả match;
4. tự động tra cứu ảnh cấu trúc phân tử (tùy chọn);
5. xuất báo cáo `.docx` giữ nguyên định dạng của Word template;
6. xuất `.xlsx` kết quả để lưu trữ/đối soát.

Ứng dụng ưu tiên độ chính xác, khả năng kiểm tra lại bằng mắt và trải nghiệm mượt. Three.js chỉ phục vụ lớp trình bày/nhận diện thị giác, không được làm chậm bảng dữ liệu hoặc cản trở thao tác nghiệp vụ.

## 2. Phạm vi phiên bản đầu (MVP)

### Có trong MVP

- React + TypeScript + Vite frontend.
- Node.js + Express backend viết bằng TypeScript.
- Upload `.tsv`, `.xlsx`, và chọn Word template.
- Tự nhận diện sheet/cột dựa trên alias; cho người dùng map lại cột nếu thiếu hoặc mơ hồ.
- Matching theo `m/z` (ppm hoặc Da) và RT (phút).
- Hiển thị cả match tốt nhất và thông tin chẩn đoán: `delta_mz`, `delta_ppm`, `delta_rt`, số lượng candidate.
- Preview/edit/select/filter/sort dữ liệu trước khi xuất.
- Xuất `.docx` qua Carbone và xuất `.xlsx` kết quả.
- Tra PubChem theo lựa chọn của người dùng, có cache, timeout và trạng thái không tìm thấy.
- Không cần database; trạng thái làm việc giữ theo session tạm thời có TTL.
- Responsive cho desktop/laptop; tablet ở mức sử dụng được.

### Chưa làm trong MVP

- Đăng nhập, phân quyền, lưu lịch sử dài hạn.
- Chỉnh sửa trực quan Word template trong web.
- Matching dựa trên phổ MS/MS hoặc thuật toán định danh hợp chất nâng cao.
- Hàng đợi xử lý phân tán/multi-user quy mô lớn.
- Đóng gói desktop; có thể bổ sung Tauri sau khi bản web ổn định.

## 3. Kiến trúc đề xuất

```text
Browser (React/Vite)
  ├─ Upload + column mapping + tolerance settings
  ├─ Preview/edit/select table
  └─ Export/structure lookup controls
          │ REST multipart + JSON
          ▼
Node.js / Express API
  ├─ Upload validation and session workspace
  ├─ TSV/XLSX parsers and normalization
  ├─ Matching engine
  ├─ PubChem client + bounded cache
  ├─ Carbone report renderer
  └─ XLSX exporter
          │
          ├─ temporary session files (TTL cleanup)
          ├─ Word template (.docx)
          └─ generated .docx/.xlsx streams
```

Monorepo dự kiến:

```text
gnps2converter/
  apps/
    web/                 # React frontend
    api/                 # Express backend
  packages/
    domain/              # schema, DTO, matching types dùng chung
    ui/                  # component/theme dùng chung nếu thực sự cần
  templates/
    report-template.docx
  samples/               # dữ liệu mẫu đã ẩn thông tin nhạy cảm
  tests/
    fixtures/
  docs/
  package.json
  implement_plan.md
```

Package manager đề xuất: `pnpm` workspace. Nếu môi trường triển khai chỉ hỗ trợ npm, dùng npm workspaces mà không đổi kiến trúc.

## 4. Chuẩn dữ liệu và quy tắc matching

### 4.1. TSV input

Các trường nghiệp vụ cần map:

- `Compound_Name`
- `Adduct`
- `Precursor_MZ`
- `molecular_formula`
- `MZErrorPPM`
- `RT_Query`
- cột fragments/MS2 (cần xác nhận tên cột thật)
- cột RT hiển thị định dạng Việt Nam, nếu đây là cột riêng (cần xác nhận tên và ý nghĩa)

Parser phải:

- nhận UTF-8/UTF-8 BOM;
- giữ nguyên chuỗi gốc để audit;
- chuẩn hóa dấu phẩy/dấu chấm thập phân một cách có kiểm soát;
- báo lỗi theo dòng/cột, không âm thầm biến giá trị lỗi thành `0`;
- hỗ trợ alias và bước column mapping trước khi chạy.

### 4.2. XLSX input

- Chọn sheet nếu workbook có nhiều sheet.
- Map tối thiểu hai cột `mz` và `rt`.
- Bỏ dòng rỗng; đánh dấu rõ dòng có số không hợp lệ.
- Không hard-code 703 dòng; số dòng thực tế là động.

### 4.3. Công thức

Với mỗi dòng TSV và feature XLSX:

```text
deltaDa  = abs(mzTsv - mzData)
deltaPpm = deltaDa / mzData * 1_000_000
deltaRt  = abs(rtTsv - rtData)
```

Điều kiện match:

```text
(mode = ppm AND deltaPpm <= mzTolerance)
OR
(mode = Da  AND deltaDa  <= mzTolerance)

AND deltaRt <= rtToleranceMinutes
```

Quy tắc khi có nhiều candidate:

1. lọc candidate thỏa cả hai tolerance;
2. xếp theo normalized score: `(deltaMz / mzTolerance) + (deltaRt / rtTolerance)`;
3. chọn score thấp nhất làm match mặc định;
4. giữ danh sách candidate và số lượng candidate để người dùng kiểm tra/đổi match;
5. không gộp hai hợp chất chỉ vì cùng match một feature; cảnh báo duplicate feature để người dùng quyết định.

Các trường kết quả nội bộ:

```ts
type MatchRow = {
  id: string;
  selected: boolean;
  sourceTsvRow: number;
  sourceXlsxRow: number;
  compoundName: string;
  adduct: string;
  mzTsv: number;
  mzData: number;
  rtTsv: number;
  rtData: number;
  deltaDa: number;
  deltaPpm: number;
  deltaRt: number;
  candidateCount: number;
  molecularFormula: string;
  fragments: string;
  reportedMzErrorPpm?: number;
  structure?: StructureResult;
};
```

Lưu ý: `MZErrorPPM` từ TSV là dữ liệu nguồn; `deltaPpm` do ứng dụng tính từ feature match là một trường khác. UI và báo cáo không được nhập nhằng hai giá trị này.

## 5. Schema dữ liệu xuất báo cáo

Backend tạo view model độc lập với model nội bộ:

```ts
{
  generated_at: "22/07/2026 14:30",
  parameters: {
    mz_mode: "ppm",
    mz_tolerance: "10",
    rt_tolerance: "0,5"
  },
  rows: [{
    stt: 1,
    rt: "12,02",
    ten_hoat_chat: "CAFFEIC ACID",
    ion: "[M-H]-",
    mz_precursor: "179.034",
    mz_fragments: "135 (100)",
    cong_thuc: "C9H8O4",
    sai_so_ppm: "2,21594",
    cau_truc: "data:image/png;base64,..."
  }]
}
```

- Format số dùng hàm tập trung, không format sớm trong matching engine.
- `stt` được đánh lại sau khi lọc các dòng `selected`.
- Tên hợp chất chỉ uppercase nếu template/nghiệp vụ yêu cầu; dữ liệu chỉnh tay của người dùng được ưu tiên.
- Ảnh thiếu dùng placeholder hoặc để trống theo cấu hình template.

## 6. API dự kiến

### Session và parse

- `POST /api/sessions` — tạo phiên tạm.
- `POST /api/sessions/:id/files` — upload TSV/XLSX, validate MIME, extension, size.
- `POST /api/sessions/:id/inspect` — trả sheets, headers, alias mapping, lỗi dữ liệu mẫu.
- `POST /api/sessions/:id/match` — nhận column mapping + tolerance, trả summary và rows.

### Preview/edit

- Frontend giữ edit state; backend nhận toàn bộ selected rows đã chuẩn hóa khi export.
- Với dataset lớn hơn ngưỡng, chuyển sang `PATCH /rows` và server-side pagination; MVP ưu tiên dataset cỡ vài nghìn dòng.

### Structure lookup

- `POST /api/structures/resolve` — nhận danh sách compound name có giới hạn.
- Backend gọi PubChem, không gọi trực tiếp từ browser.
- Có concurrency limit, retry có backoff, timeout, cache theo normalized name/CID.
- Kết quả phải phân biệt `found`, `ambiguous`, `not_found`, `error`; không tự động nhận một kết quả mơ hồ như kết quả chắc chắn.

### Export

- `POST /api/sessions/:id/export/docx` — validate rows, render và stream `.docx`.
- `POST /api/sessions/:id/export/xlsx` — tạo workbook đối soát.
- Tên file được sanitize; response có `Content-Disposition` phù hợp.

## 7. Thiết kế giao diện và motion

### Ngôn ngữ thị giác

- Chủ đề “analytical laboratory”: nền xanh đen/indigo, accent cyan–violet, panel sáng hoặc glass nhẹ nhưng đảm bảo tương phản.
- Typography rõ ràng, số liệu dùng tabular numerals.
- Các trạng thái match dùng màu + icon + text, không chỉ dựa vào màu.
- Tập trung mật độ thông tin ở màn Preview; không lạm dụng glass/blur trong bảng.

### Three.js

- Hero/login-free landing workspace có nền hạt phân tử và liên kết 3D chuyển động chậm.
- Pointer parallax rất nhẹ, camera drift có giới hạn.
- Khi upload thành công, animation biểu diễn hai luồng dữ liệu hội tụ thành các điểm match.
- Canvas lazy-load, dừng render khi tab ẩn, giới hạn DPR và số particle theo thiết bị.
- Tôn trọng `prefers-reduced-motion`; fallback gradient/CSS nếu WebGL yếu hoặc lỗi.
- Three.js không nằm trong React render tree của data grid; route Preview giảm/ẩn canvas để ưu tiên hiệu năng.

### Luồng màn hình

1. **Workspace / Upload**
   - hai dropzone rõ ràng cho TSV và XLSX;
   - trạng thái parse, sheet selection và column mapping;
   - preset tolerance: `10 ppm`, `±0.5 phút`, cho phép sửa;
   - validation inline và CTA “Phân tích matching”.

2. **Matching progress**
   - progress theo stage thực, không dùng progress giả;
   - summary: số dòng TSV, feature XLSX, matched, unmatched, ambiguous, invalid.

3. **Preview & Edit**
   - toolbar sticky: search, match status, selected only, duplicate/ambiguous filter;
   - bảng virtualized, pin `STT`, checkbox và compound name;
   - inline edit có undo; ô sửa tay có dấu nhận biết;
   - drawer chi tiết hiển thị TSV source, feature source, delta và candidates;
   - bulk select/unselect và cảnh báo trước khi loại nhiều dòng.

4. **Export**
   - chọn template hoặc dùng template mặc định;
   - bật/tắt tra ảnh cấu trúc;
   - summary số dòng/ảnh tìm thấy;
   - tải Word/XLSX và thông báo lỗi có thể xử lý.

### Accessibility và responsive

- Đầy đủ keyboard navigation, focus visible, aria label, trạng thái loading/error.
- Contrast tối thiểu WCAG AA cho nội dung chính.
- Motion có thể tắt.
- Bảng desktop-first; trên màn nhỏ chuyển sang card/detail drawer, không ép toàn bộ cột vào một viewport.

## 8. Công nghệ dự kiến

- Frontend: React, TypeScript, Vite, React Router, TanStack Query, TanStack Table + virtualization.
- UI: Tailwind CSS + component primitives có accessibility; Framer Motion cho UI transitions.
- 3D: Three.js qua React Three Fiber/Drei, bundle tách riêng và lazy-load.
- Form/schema: React Hook Form + Zod.
- Backend: Express + TypeScript, Multer/Busboy cho upload, Zod cho DTO.
- TSV: `csv-parse` hoặc Papa Parse; ưu tiên parser streaming phía Node.
- XLSX: ExcelJS cho đọc/ghi và kiểm soát workbook; chỉ dùng SheetJS nếu fixture thực tế cho thấy tương thích tốt hơn.
- Word: Carbone, sau một technical spike với template thật để xác nhận table-loop và dynamic image.
- Test: Vitest, Supertest, React Testing Library, Playwright.
- Quality: ESLint, Prettier, TypeScript strict, structured logging.

Phiên bản và license của các dependency phải được khóa/kiểm tra tại thời điểm scaffold; không dựa vào giả định license chung của mọi phiên bản Carbone.

## 9. An toàn, giới hạn và vận hành

- Giới hạn kích thước file, số dòng, thời gian parse/render và số lookup PubChem.
- Không tin MIME/extension do client gửi; kiểm tra signature/định dạng thực tế.
- Tên file ngẫu nhiên trong thư mục session; chống path traversal.
- Xóa file session theo TTL và khi export xong; không log nội dung dữ liệu nhạy cảm.
- API rate limit cho upload/lookup/export.
- PubChem failure không được chặn export: cho phép xuất không ảnh.
- Carbone render chạy trong worker/child process có timeout để tránh block event loop.
- Health endpoint và log có correlation/session ID.

## 10. Chiến lược kiểm thử

### Unit tests

- parse số với dấu phẩy/dấu chấm, BOM, dòng rỗng, malformed row;
- ppm/Da boundary (đúng bằng tolerance phải match);
- RT boundary;
- nhiều candidate, tie-break, duplicate feature;
- format dữ liệu xuất và đánh lại STT;
- chỉnh tay không bị ghi đè khi re-render/export.

### Integration tests

- upload → inspect → match bằng fixture nhỏ có expected output cố định;
- match dataset thực đã ẩn danh;
- PubChem mocked: found/ambiguous/not-found/timeout;
- Carbone render và kiểm tra file DOCX hợp lệ, có đúng số dòng và media.

### Visual/E2E

- upload hai file, map cột, chạy match, sửa một dòng, bỏ chọn một dòng, export;
- screenshot desktop/tablet cho các trạng thái empty/loading/error/result;
- kiểm tra reduced motion và WebGL fallback;
- mở file Word sinh ra bằng LibreOffice/Word để kiểm tra bảng, page break, image sizing và style.

## 11. Các giai đoạn triển khai

### Giai đoạn 0 — Khóa dữ liệu và technical spike

- Nhận file `.tsv`, `Data.xlsx`, `Cao_xạ_đen_1_neg.docx` thật (có thể là bản ẩn danh).
- Chốt tên sheet/cột, đơn vị RT, ý nghĩa cột fragments và RT Việt Nam.
- Chốt cách xử lý multiple match/duplicate feature.
- Tạo script proof-of-concept: parse 2 file → match fixture → render 3 dòng vào bản sao template.
- Xác nhận Carbone version/license, cú pháp loop trong table và khả năng chèn ảnh ở đúng kích thước ô.

**Điều kiện qua giai đoạn:** một file DOCX proof-of-concept mở đúng layout và bộ expected matching được người dùng xác nhận.

### Giai đoạn 1 — Scaffold và design system

- Tạo monorepo, strict TypeScript, lint/test/build.
- Dựng theme, shell, navigation stepper, responsive primitives.
- Dựng Three.js hero tối ưu và reduced-motion fallback.
- Tạo mock screens để review giao diện trước khi nối API.

### Giai đoạn 2 — Parsing và matching engine

- Implement upload/session/inspect.
- Implement normalization và column mapping.
- Implement matching thuần (pure functions) cùng unit tests.
- Với dữ liệu lớn, index/sort `mz` để tìm candidate theo khoảng thay vì so sánh toàn bộ `N × M`.
- Trả summary, invalid rows và diagnostics.

### Giai đoạn 3 — Preview/Edit UX

- Nối API bằng TanStack Query.
- Bảng virtualized, filters, inline editing, selected rows, undo và details drawer.
- Candidate reassignment và duplicate warnings.
- Autosave state cục bộ theo session; cảnh báo khi rời trang còn thay đổi.

### Giai đoạn 4 — PubChem và export

- Implement PubChem client/cache/concurrency.
- Chuẩn hóa report view model.
- Render `.docx` trong worker với timeout.
- Export `.xlsx` gồm sheet Report và Match Diagnostics.
- Kiểm thử layout trên template thật.

### Giai đoạn 5 — Hardening và bàn giao

- E2E, accessibility, responsive, performance profiling.
- Security/file limits/TTL cleanup/logging.
- Dockerfile và hướng dẫn chạy production.
- Tài liệu thay template, alias cột và tolerance.

## 12. Tiêu chí nghiệm thu

- Kết quả matching của fixture chuẩn đúng 100% so với expected set đã chốt.
- Người dùng xem được lý do match và candidate thay thế cho từng dòng.
- Sửa tay/chọn bỏ dòng được phản ánh chính xác trong cả DOCX và XLSX.
- File DOCX mở không báo repair, giữ header/border/font/merge/page layout của template.
- Ảnh cấu trúc đúng tỷ lệ, không phá chiều cao/cột; lỗi PubChem không làm hỏng export.
- Bảng vẫn thao tác mượt với dữ liệu mục tiêu thực tế; animation không gây drop frame đáng kể ở Preview.
- Upload lỗi trả thông báo theo file/dòng/cột, không crash server.
- Có reduced-motion và WebGL fallback.
- Toàn bộ test quan trọng, typecheck và production build chạy thành công.

## 13. Thông tin/tài nguyên cần người dùng cung cấp trước khi bắt đầu Giai đoạn 0

1. File TSV mẫu thực tế.
2. File `Data.xlsx` mẫu thực tế.
3. File Word gốc `Cao_xạ_đen_1_neg.docx`.
4. Xác nhận đơn vị `RT_Query` và `rt` trong Excel đều là phút hay cần quy đổi.
5. Xác nhận khi một TSV row match nhiều feature hoặc nhiều TSV row match cùng một feature: tự chọn tốt nhất hay bắt buộc người dùng duyệt.
6. Xác nhận cột `sai_so_ppm` trong báo cáo lấy `MZErrorPPM` từ TSV hay `deltaPpm` ứng dụng tự tính.
7. Logo, tên đơn vị, màu thương hiệu (nếu có); nếu chưa có sẽ dùng visual laboratory mặc định.

## 14. Thứ tự review đề xuất

Trước khi viết source, cần duyệt ba quyết định:

1. quy tắc matching và tie-break tại mục 4;
2. phạm vi MVP tại mục 2;
3. hướng giao diện/Three.js tại mục 7.

Sau khi được duyệt và có ba file mẫu, bắt đầu Giai đoạn 0. Không triển khai report template theo phỏng đoán vì đây là phần quyết định độ chính xác của sản phẩm.
