# Implementation Plan — GNPS2 Converter

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
