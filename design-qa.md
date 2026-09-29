# Design QA — Dashboard option 1

## Reference and preview

- Selected reference: `C:\Users\admin\.codex\generated_images\01a0eacb-92fa-7143-a58d-e4fb0e90c4fb\exec-81dcd524-d92d-40ec-8553-d597ad2426b2.png` (1810×869).
- Local implementation: `http://127.0.0.1:5173/`.
- Desktop capture: Codex in-app browser, 1280×720. Mobile captures: CSS viewports 390×844 and 320×720. Tablet layout checked at 768×900.
- The browser capture API returned screenshots inline for visual review; it did not provide a workspace file path, so screenshots were not copied into the repository.

## Review

- Desktop keeps the GNPS2 brand, sign-in/theme actions, science background, and hero title. The header is 60px high with extra desktop width. Its steps now match the app: “Nhập dữ liệu”, “Đối chiếu & hiệu chỉnh”, and “Lưu & xuất”.
- Replaced the large entry card with option 1’s horizontal command bar: URL field, outlined GNPS2 action, separated TSV/XLSX action, and a short sign-in note. The outer frame uses the cyan-to-violet edge treatment from the selected design.
- Light and dark themes were both checked. At 390px, the progress labels shorten and both actions remain side by side. At 320px the command row stays within its container; DOM measurements showed no horizontal overflow. The 768px viewport also reported matching document and viewport widths.
- Clicking the GNPS2 action with a task link and clicking TSV/XLSX each reached the existing login screen. The GNPS2 URL is held in session storage and passed into the existing workspace input after authentication. A successful credential-backed sign-in was not exercised because this preview ran Vite without the configured auth API.
- The source image and runtime captures have different viewport aspect ratios, so this was a visual composition review rather than a pixel-diff comparison.

## Verification

- `npm run build`: passed.
- `npm test`: 27/27 tests passed across 4 files.
- `git diff --check`: passed; Git only reported existing LF/CRLF normalization notices.
- P0–P2 visual findings: none in the checked layouts.

final result: passed
