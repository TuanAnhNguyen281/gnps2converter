# GNPS2 Converter

## Nhập tự động bằng GNPS2 Task URL

Ở màn hình đầu, chọn **Nhập link GNPS2** (mặc định) và dán link Status, Result hoặc Network có chứa Task ID. Ứng dụng tự đọc `Description` làm tiêu đề, Library Matches làm danh sách hợp chất, nối `#Scan#` với `node.id` trong `network_singletons.graphml` để lấy `rt_min`, đọc consensus MGF cho fragments và dựng ảnh từ `Smiles`/`INCHI`.

Nếu node không có `rt_min`, ứng dụng dùng `RT_Query` và đánh dấu dòng cần duyệt. Trường không có trong nguồn GNPS2 được để trống, không tự suy đoán.

Ứng dụng đối sánh dữ liệu GNPS TSV với feature `m/z`/`rt` trong Excel, cho phép duyệt và sửa kết quả trước khi xuất Word hoặc Excel.

## Chạy local

Yêu cầu Node.js 22.19+ thuộc dòng 22 LTS. Cấu hình `.env` và chạy `npm run db:migrate` trước khi dùng tài khoản.

```bash
npm install
npm run dev
```

- Web: `http://localhost:5173`
- API health: `http://localhost:8787/api/health`

## Project và AI chat nghiên cứu

Sau khi đăng nhập, mở **Project & AI chat** trên thanh điều hướng. Tạo project, ghi mục tiêu nghiên cứu, tạo phiên và thêm báo cáo có sẵn. **Nhập báo cáo mới** từ project sẽ gắn báo cáo vừa nhập vào project đó. Báo cáo cũ không tự gắn project. Một báo cáo thuộc một project; không chuyển ngầm giữa các project.

Mở **Cài đặt AI**, nhập tên provider, Base URL HTTPS của API **OpenAI-compatible Chat Completions** (ví dụ URL gốc kết thúc `/v1`) và API key. Tải catalog hoặc nhập model thủ công; chọn model mặc định. Bật Tools/Stream chỉ khi model và provider hỗ trợ, chọn context/output phù hợp và dùng **Chat thử** để xác minh. Tải catalog thành công không chứng minh chat thành công. Phép thử có thể phát sinh phí và được tính vào hạn mức lượt ngày.

Tạo hội thoại trong phiên rồi chọn phạm vi dòng đang chọn, báo cáo đang mở hoặc các báo cáo trong project. Có nút **AI chat · Project** trên màn báo cáo để chat ngay khi phân tích. Hệ thống đợi autosave, kiểm tra revision, chụp dữ liệu đã lưu và chỉ gửi thông tin có giới hạn vào provider. Model có tools được phép đọc/lọc/tổng hợp/so sánh snapshot; model không có tools chỉ dùng dữ liệu khởi tạo và phải nêu giới hạn. AI không tự sửa báo cáo hoặc xác nhận định danh hợp chất.

- Project, phiên, hội thoại, tin nhắn, nguồn/revision, request state và usage được lưu PostgreSQL. Phiên nghiên cứu độc lập với cookie đăng nhập.
- Đổi model chỉ ảnh hưởng lượt tiếp theo. Thứ tự ưu tiên: lượt chat → phiên → project → tài khoản. Giao diện hiển thị provider/model hiệu lực; không tự chuyển provider khi lỗi.
- Câu hỏi được lưu trước khi gọi provider; lỗi/dừng/gián đoạn vẫn giữ lịch sử. Gửi trùng dùng request ID và fingerprint; không tự gọi lại model khi SSE mất kết nối.
- Nguồn dữ liệu mở báo cáo/dòng hiện tại; câu trả lời cũ vẫn dựa trên revision và snapshot đã ghi. Lịch sử dài được phân trang; prompt giữ các cặp hỏi/đáp gần nhất và trích đoạn cũ có version/range, không xóa tin nhắn gốc.
- Có tìm tên hội thoại, đổi tên, archive, xuất Markdown/JSON và xóa riêng hội thoại/snapshot. Xóa chat giữ nguyên báo cáo và sổ hạn mức ngày. Project dùng archive/mở lại; không cung cấp xóa vĩnh viễn cả project/báo cáo.
- API key mã hóa AES-256-GCM; API không trả key, không lưu key ở browser hay log. Provider phải là HTTPS public, không có credential trong URL, port riêng hoặc redirect; DNS được kiểm tra và ghim cho kết nối để chặn SSRF/rebinding.

### Cấu hình máy chủ AI

Chạy `npm run db:migrate` để áp dụng `0002_research_ai.sql` và `0003_ai_model_pricing.sql` (chỉ thêm bảng/cột/ràng buộc; không chuyển hoặc xóa báo cáo cũ). Khai báo các biến trong `.env.example`:

```text
AI_ENCRYPTION_KEY=<64 ký tự hex ngẫu nhiên, tương đương 32 byte>
AI_KEY_VERSION=v1
AI_ALLOWED_HOSTS=<hostname chính xác, cách nhau bằng dấu phẩy>
AI_DAILY_REQUESTS=100
AI_DAILY_TOKEN_BUDGET=500000
AI_MAX_CONCURRENT=2
AI_MAX_STORAGE_BYTES=50000000
AI_TIMEOUT_MS=90000
```

Tạo khóa bằng `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` rồi lưu vào cấu hình bí mật của máy chủ. Không commit khóa và không dùng SESSION_SECRET làm khóa AI. Khi xoay khóa, đổi `AI_KEY_VERSION`, đặt khóa cũ trong JSON `AI_PREVIOUS_KEYS` theo version để đọc các provider chưa cập nhật; nhập lại API key trong Cài đặt AI để mã hóa bằng version mới trước khi bỏ khóa cũ. Khóa mất sẽ không giải mã được key đã lưu.

`AI_ALLOWED_HOSTS` trống cho phép HTTPS public; nên cấu hình đúng hostname provider khi đưa lên production. API native Responses/Anthropic, provider localhost, OCR/vision và RAG chưa thuộc bản này.

Hạn mức token là dự toán bảo thủ theo ngân sách context và số vòng tools; không hoàn trả dự toán khi lỗi/dừng. Usage thật chỉ hiển thị khi provider cung cấp, còn thiếu ghi không xác định. Chat thử cũng dùng hạn mức. Có thể nhập đơn giá input/output trên 1 triệu token tại từng model. Mỗi lượt lưu phiên bản đơn giá và chi phí ước tính; thiếu đơn giá hoặc usage thì để không xác định. Không tự đổi tiền tệ, không tính riêng cache/reasoning/phụ phí; đối chiếu hóa đơn thực tại provider. Dung lượng giới hạn gồm snapshot, tin nhắn và kết quả tools; có thể xóa hội thoại cũ để giải phóng.

Backend chạy lượt AI trong process với lease/heartbeat DB. Khi restart, lượt hết lease chuyển sang interrupted ở lần truy cập API AI tiếp theo; người dùng tự thử lại. Không có worker bền vững hoặc tự resume qua restart. SSE gửi trạng thái/nội dung đã lưu từng đợt; client tự dùng polling khi SSE lỗi. Khi deploy, cấu hình cookie/origin như xác thực hiện có và kiểm tra proxy SSE không buffering, timeout và cancel trên môi trường thật.

### Kiểm tra riêng bằng dữ liệu mẫu

`scripts/research-preview.ts` tạo DB PGlite trong bộ nhớ và provider giả lập, bind `127.0.0.1:8789`; không đọc dữ liệu DB được cấu hình và không gọi AI thật. Chạy trong terminal thứ nhất:

```text
npx tsx scripts/research-preview.ts
```

Terminal PowerShell thứ hai:

```powershell
$env:DEV_API_TARGET='http://localhost:8789'
npx vite --host 127.0.0.1 --port 5193
```

Đăng nhập môi trường QA tại `http://localhost:5193` bằng `research-qa@example.test` / `local-qa-password-123`. Đây là tài khoản giả lập trong bộ nhớ, mất khi dừng process. Thêm provider `https://example.com/v1`, API key bất kỳ, tải `demo-model`, bật Stream và đặt mặc định để kiểm tra. `scripts/research-browser-qa.cjs` dùng Playwright/Chrome có sẵn, kiểm tra thao tác và ghi bằng chứng vào `qa/research-ai/`. Không dùng tài khoản hoặc credential thật trong môi trường QA.

## Dữ liệu demo

```bash
node scripts/create-demo-xlsx.mjs
```

Sau đó upload `samples/GNPS.demo.tsv` và `samples/Data.demo.xlsx`. Bộ demo cho kết quả 3 hợp chất đối chiếu được tên và 1 hợp chất không tìm thấy.

## Word template

Nếu tồn tại `templates/report-template.docx`, backend dùng Carbone để render với object `{ rows: [...] }`. Nếu chưa có, hệ thống tự tạo báo cáo Word dạng bảng tiêu chuẩn để luồng export vẫn hoạt động.

Các field trong mỗi row:

- `stt`
- `rt`
- `ten_hoat_chat`
- `ion`
- `mz_precursor`
- `mz_fragments`
- `cong_thuc`
- `sai_so_ppm`
- `cau_truc`

Trường cấp báo cáo `title` được tự động lấy từ tên file TSV (bỏ phần mở rộng) và có thể sửa trên cả màn Upload lẫn Preview. Template dùng tag `{d.title}`; tiêu đề cũng được dùng làm tên file xuất sau khi loại bỏ ký tự không hợp lệ của Windows.

Template hiện tại tại `templates/report-template.docx` được tạo trực tiếp từ file `Cao xạ đen 1 neg.docx`, giữ nguyên trang A4 ngang, bảng tám cột, kích thước cột, border, typography và ô ảnh cấu trúc. Có thể tái tạo template bằng:

```bash
node scripts/build-carbone-template.mjs
node scripts/smoke-render-template.mjs
```

## Mapping của bộ dữ liệu thực tế

TSV `Cao xạ đen 1 neg 2.tsv` có hai cột cuối bị bỏ trống header. Parser tự đặt tên:

- cột 17: `mz_fragments`
- cột 18: `rt_vn`

Các cột đối chiếu và xuất báo cáo:

- Tên hoạt chất: `TSV.Compound_Name`
- Ion: `TSV.Adduct`
- Ion tiền chất: `TSV.Precursor_MZ`
- Mảnh vỡ: `TSV.mz_fragments`
- Công thức phân tử: `TSV.molecular_formula`
- Sai số dưới công thức: `TSV.MZErrorPPM`
- Khóa đối chiếu tên: `TSV.Compound_Name` ↔ `Excel.library_compound_name`
- `tR (min)`: `Excel.rt_min`

Tên được chuẩn hóa chữ hoa/thường, dấu phân cách và cho phép chứa thêm mô tả ở Excel. Toàn bộ dòng TSV luôn được giữ lại để preview/export. Dòng tìm thấy tên trong Excel được bổ sung `rt_min`; dòng không tìm thấy vẫn giữ đầy đủ dữ liệu TSV và để trống `tR (min)`. Với ba file nguồn hiện tại, kết quả là 10 dòng xuất báo cáo: 1 dòng có RT từ Excel và 9 dòng chưa có RT.

## Ảnh cấu trúc từ GNPS2

Tại màn Preview, dán URL trang `Library Matches`, ví dụ `https://gnps2.org/result?task=...&viewname=librarymatches`. Backend đọc JSON công khai của task, đối chiếu `Compound_Name`, và tạo ảnh từ `INCHI` hoặc `Smiles` qua `structure.gnps2.org`. Dòng không tìm thấy tên hoặc không có cấu trúc hợp lệ được để trống; ứng dụng không tự chuyển sang PubChem.

## Kiểm tra

```bash
npm test
npm run typecheck
npm run build
npm audit
```

## Backend tài khoản và lưu dữ liệu

Đã có email/mật khẩu, Google OpenID Connect, liên kết Google sau xác thực lại, đổi mật khẩu và đăng xuất. Session lưu PostgreSQL, cookie HttpOnly, CSRF cho thao tác ghi; mọi báo cáo/ảnh/file kiểm tra chủ sở hữu trên server. Giao diện có **Báo cáo của tôi**, tìm lịch sử, mở lại, xóa, tự lưu và xử lý xung đột giữa hai tab. Xuất Word/Excel chờ lưu thành công và đọc dữ liệu đã lưu.

Chưa có quên mật khẩu/xác minh email qua thư, nhóm hay quản trị. Không có bypass đăng nhập hoặc tài khoản demo trong production.

### Thiết lập local

1. Copy `.env.example` thành `.env`, đã được gitignore. Không commit/gửi secret trong chat.
2. Tạo PostgreSQL trên Neon, copy **pooled connection string có TLS** vào `DATABASE_URL`; **direct connection string** vào `MIGRATION_DATABASE_URL`. PostgreSQL local cũng dùng được.
3. Tạo `SESSION_SECRET` ngẫu nhiên ít nhất 32 ký tự, giữ cố định qua restart:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

4. Chạy `npm run db:migrate`, rồi `npm run dev`. Migration trong `migrations/` có checksum, transaction và advisory lock; không tự chạy khi app startup. Không sửa migration đã áp dụng. Schema Drizzle là bản mô tả TypeScript; repositories dùng SQL tham số để quản lý transaction/lock. PostgreSQL session store riêng tương thích `express-session`.
5. Thiếu Google/Cloudinary vẫn thử được tài khoản mật khẩu và lưu kết quả. Google bị tắt khi thiếu config; ảnh/file thiếu Cloudinary phải báo **chưa lưu đủ**. Thiếu DATABASE_URL hoặc SESSION_SECRET, health vẫn chạy nhưng auth/nghiệp vụ trả 503.

### Google OAuth

1. Tạo project Google Cloud, OAuth consent screen và client kiểu **Web application**, scopes `openid email profile`.
2. Local đăng ký redirect chính xác `http://localhost:5173/api/auth/google/callback`; Vite proxy chuyển callback sang API, cookie/browser cùng origin.
3. Điền GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI và restart. Consent ở chế độ Testing phải thêm tài khoản vào test users.
4. Production thêm `https://<service>.onrender.com/api/auth/google/callback`; đổi APP_ORIGIN/redirect tương ứng.
5. Nếu trùng email tài khoản mật khẩu: login bằng mật khẩu, mở menu tài khoản và chọn **Liên kết Google**. Không tự gộp bằng email. User chỉ dùng Google chưa có chức năng đặt mật khẩu mới.

### Cloudinary và file nguồn

1. Tạo Cloudinary product environment; điền CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET. Không đưa secret vào VITE_* hoặc mở unsigned upload preset.
2. Ảnh PNG/JPEG/WebP dùng `image`; file dùng `raw`. Tất cả delivery type **authenticated**. Frontend tải qua endpoint có session/owner check; URL cloud ký ngắn hạn chỉ dùng bên trong server.
3. PostgreSQL lưu metadata/hash, Cloudinary asset/public ID và liên kết tài khoản/báo cáo/dòng/revision; không lưu bytes/base64. TSV/XLSX gốc giữ nguyên, không đổi khi sửa kết quả.
4. Luồng GNPS Task hiện lưu **Library Matches JSON, Network GraphML và JSON peaks từ mirror service**. Engine dùng mirror API cho fragments, chưa tải consensus MGF trực tiếp; không giả lập MGF từ JSON. Luồng file lưu TSV/XLSX đã upload.
5. Nếu upload một phần lỗi, giữ kết quả và hiện **ảnh/file chưa lưu đủ**. Chọn lại đúng file để retry; backend kiểm tra hash. File bị từ chối trước quota reservation cần bổ sung sau giải phóng quota. Bytes chưa upload không tồn tại qua restart; không hứa retry tự động từ metadata.
6. Mở lại báo cáo tải TSV/XLSX đã lưu để xem nguồn/ánh xạ. Mục **Ảnh và file đã lưu** cho tải file nguồn, ảnh, bản xuất. Giữ tối đa 5 bản xuất gần nhất/báo cáo, file nguồn giữ riêng. Upload bản xuất lỗi vẫn cho tải file vừa tạo, báo chưa lưu bản cloud.
7. Xóa báo cáo thu hồi quyền ngay; cleanup xóa tài sản không còn tham chiếu. Trạng thái tác vụ xóa/retry lưu DB; chỉ trừ usage sau cloud xác nhận. Cleanup chạy startup/khi có hoạt động, có thể chậm khi Render ngủ.

Quota mặc định: 20 báo cáo/user, 1.000 dòng/báo cáo, 1 MiB JSON/báo cáo, 100 MB ảnh/file/user; file tối đa **9.500.000 bytes**, ảnh 2.000.000 bytes. Cloudinary Free có [10 MB/raw hoặc image](https://cloudinary.com/pricing/compare-plans), [credits dùng chung storage/bandwidth/transformations](https://cloudinary.com/documentation/billing_and_plans). Theo dõi dashboard cả Neon lẫn Cloudinary và điều chỉnh quota theo dataset thực; file GNPS quá lớn báo chưa lưu, không cắt ngầm.

### Deploy mặc định: Render chung frontend/API + Neon + Cloudinary

1. `render.yaml` build web + server, start `npm start`, Node 22, health `/api/health`. Để trống VITE_API_BASE_URL để dùng `/api` cùng origin.
2. NODE_ENV=production; APP_ORIGIN và FRONTEND_ORIGIN bằng URL Render public, không dấu `/` cuối. Google callback cùng origin. SESSION_SECRET do Blueprint tạo hoặc tự tạo, giữ ổn định. TRUST_PROXY_HOPS=1 cần kiểm tra khớp proxy thực tế, không trust mọi proxy.
3. Điền DATABASE_URL, Google, Cloudinary environment ở Render. MIGRATION_DATABASE_URL chỉ dùng ở máy/CI migration, không cần runtime.
4. Chạy migration ở môi trường được ủy quyền trước release. Không dựa vào pre-deploy job gói Free.
5. Render có cold start và filesystem không bền vững; DB/file nằm ngoài Render. Gói free dành cho MVP trong quota, chưa đảm bảo uptime quan trọng.
6. Kiểm chứng HTTPS/Google/cookie Secure, authenticated ảnh/raw download và pooling/TLS Neon bằng credentials thật trước phát hành. Thiếu credentials chỉ xác nhận code/test local, chưa xác nhận deploy.

### Kiểm thử và backup

`npm test` có integration tests dùng PostgreSQL qua PGlite riêng trong bộ nhớ và Cloudinary provider giả lập, không đụng DB production. Kiểm tra auth/CSRF, ownership, quota, idempotency, revision, rollback, retry/delete tài sản và xuất Word/Excel. PGlite không thay thế kiểm thử TLS/pooling/cold start Neon hay OAuth/Cloudinary thật.

Backup cần `pg_dump` bằng direct database connection, manifest mapping asset/hash, và bản sao bytes Cloudinary ở nơi độc lập. Restore DB không tự khôi phục file cloud: kiểm tra mapping/hash và download sau restore. Chưa có lịch backup tự động; cần cấu hình nơi lưu/lịch trước vận hành.

## Tùy chọn Render backend + Vercel frontend

Repo có hai pipeline build độc lập:

```bash
npm run build:server  # Render -> dist-server/
npm run build:web     # Vercel -> dist/
```

- `render.yaml` hiện build cả frontend/API; chỉ đổi riêng build backend nếu chủ động chọn deploy tách frontend.
- `vercel.json` chỉ build Vite SPA và rewrite route giao diện về `index.html`.
- `vercel.json` chuyển tiếp `/api/*` sang `https://gnps2converter-api.onrender.com/api/*` trước rewrite SPA. Nếu đổi backend, cập nhật destination tương ứng.
- Build Command trong `vercel.json` đặt `VITE_API_BASE_URL` rỗng cho bản Vercel để frontend gọi `/api` cùng origin, kể cả khi project còn giữ biến cũ. Có thể xóa biến cũ trong Vercel để tránh nhầm lẫn.
- Trên Render, đặt `FRONTEND_ORIGIN=https://<frontend>.vercel.app`. Có thể nhập nhiều origin, phân cách bằng dấu phẩy.
- Hai URL không có dấu `/` ở cuối. Sau khi thay environment variable, redeploy service tương ứng.

Đặt `APP_ORIGIN` trên Render bằng `https://gnps2converter.vercel.app` và `GOOGLE_REDIRECT_URI=https://gnps2converter.vercel.app/api/auth/google/callback`; đăng ký đúng callback này trên Google Cloud. Reverse proxy giữ API và cookie SameSite=Lax cùng origin phía trình duyệt. Sau deploy cần xác nhận `/api/auth/csrf` trả JSON, cookie giữ được qua request tiếp theo, callback Google, upload/download và streaming GNPS2. Proxy có giới hạn thời gian xử lý; kiểm tra task dài thực tế. Vercel Hobby có điều kiện sử dụng cá nhân/phi thương mại; Render cùng origin ở trên là mặc định.
