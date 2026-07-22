# GNPS2 Converter

## Nhập tự động bằng GNPS2 Task URL

Ở màn hình đầu, chọn **Nhập link GNPS2** (mặc định) và dán link Status, Result hoặc Network có chứa Task ID. Ứng dụng tự đọc `Description` làm tiêu đề, Library Matches làm danh sách hợp chất, nối `#Scan#` với `node.id` trong `network_singletons.graphml` để lấy `rt_min`, đọc consensus MGF cho fragments và dựng ảnh từ `Smiles`/`INCHI`.

Nếu node không có `rt_min`, ứng dụng dùng `RT_Query` và đánh dấu dòng cần duyệt. Trường không có trong nguồn GNPS2 được để trống, không tự suy đoán.

Ứng dụng đối sánh dữ liệu GNPS TSV với feature `m/z`/`rt` trong Excel, cho phép duyệt và sửa kết quả trước khi xuất Word hoặc Excel.

## Chạy local

Yêu cầu Node.js 20.17+ (khuyến nghị Node 22 LTS).

```bash
npm install
npm run dev
```

- Web: `http://localhost:5173`
- API health: `http://localhost:8787/api/health`

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

## Deploy: Railway backend + Vercel frontend

Repo có hai pipeline build độc lập:

```bash
npm run build:server  # Railway -> dist-server/
npm run build:web     # Vercel -> dist/
```

- `railway.json` dùng Railpack, chạy backend bằng `npm start` và healthcheck `/api/health`.
- `vercel.json` chỉ build Vite SPA và rewrite route giao diện về `index.html`.
- Trên Vercel, đặt `VITE_API_BASE_URL=https://<backend>.up.railway.app` cho Production/Preview.
- Trên Railway, đặt `FRONTEND_ORIGIN=https://<frontend>.vercel.app`. Có thể nhập nhiều origin, phân cách bằng dấu phẩy.
- Hai URL không có dấu `/` ở cuối. Sau khi thay environment variable, redeploy service tương ứng.

Luồng khuyến nghị: deploy Railway lấy backend URL → đặt URL đó trên Vercel và deploy → lấy domain Vercel → đặt `FRONTEND_ORIGIN` trên Railway → redeploy Railway.
