# CleanDrive — Roadmap & Đặc tả tính năng

> **Nhãn chung của tài liệu:** [Inference] Đây là đề xuất thiết kế suy ra từ README hiện tại. Các chi tiết kỹ thuật về Windows được đánh dấu **[Unverified]** khi tôi chưa kiểm chứng trực tiếp trên máy thật. Những mục đó phải có một harness đo thật trong `scripts/` trước khi được coi là đúng. Các con số hiệu năng, tỷ lệ nén, hành vi của app bên thứ ba (Zalo, Telegram, Steam, OneDrive…) đều thuộc loại này.

---

## Mục lục

- [0. Cách đọc tài liệu](#0-cách-đọc-tài-liệu)
- [1. Đối tượng người dùng](#1-đối-tượng-người-dùng)
- [2. Nguyên tắc bất biến](#2-nguyên-tắc-bất-biến)
- [3. Roadmap tổng quan](#3-roadmap-tổng-quan)
- [4. Kiến trúc nền tảng (Giai đoạn 0)](#4-kiến-trúc-nền-tảng-giai-đoạn-0)
- [5. Đặc tả chi tiết từng tính năng](#5-đặc-tả-chi-tiết-từng-tính-năng)
  - [Nhóm A — Nhìn thấy toàn bộ ổ đĩa](#nhóm-a--nhìn-thấy-toàn-bộ-ổ-đĩa)
  - [Nhóm B — Giải phóng dung lượng không mất dữ liệu](#nhóm-b--giải-phóng-dung-lượng-không-mất-dữ-liệu)
  - [Nhóm C — Developer Pack](#nhóm-c--developer-pack)
  - [Nhóm D — Ứng dụng, game, app chat](#nhóm-d--ứng-dụng-game-app-chat)
  - [Nhóm E — Ảnh & video nâng cao](#nhóm-e--ảnh--video-nâng-cao)
  - [Nhóm F — Trùng lặp nâng cao](#nhóm-f--trùng-lặp-nâng-cao)
  - [Nhóm G — Lập kế hoạch & báo cáo](#nhóm-g--lập-kế-hoạch--báo-cáo)
  - [Nhóm H — Doanh nghiệp / IT](#nhóm-h--doanh-nghiệp--it)
  - [Nhóm I — Trải nghiệm & giữ chân người dùng (miễn phí)](#nhóm-i--trải-nghiệm--giữ-chân-người-dùng-miễn-phí)
- [6. Ma trận gói (Free / Pro / Business)](#6-ma-trận-gói-free--pro--business)
- [7. Thương mại hoá — giao diện production, thanh toán giả lập](#7-thương-mại-hoá--giao-diện-production-thanh-toán-giả-lập)
- [8. Ký số & tích hợp thanh toán thật (giai đoạn cuối)](#8-ký-số--tích-hợp-thanh-toán-thật-giai-đoạn-cuối)
- [9. Thay đổi cần cập nhật vào README](#9-thay-đổi-cần-cập-nhật-vào-readme)
- [10. Rủi ro & câu hỏi mở](#10-rủi-ro--câu-hỏi-mở)
- [11. Việc còn mở — ai làm được](#11-việc-còn-mở--ai-làm-được)

---

## 0. Cách đọc tài liệu

Mỗi tính năng có một mã (`A1`, `B3`, …) và được mô tả theo cùng một khuôn:

| Mục | Nội dung |
| --- | --- |
| **Gói** | Free / Pro / Pro·Dev / Business, kèm `feature key` dùng trong code |
| **Đối tượng** | Persona hưởng lợi chính (mục 1) |
| **Vấn đề** | Câu hỏi người dùng đang không trả lời được |
| **Hành vi** | App làm gì, theo thứ tự |
| **Giao diện** | Màn nào, control nào |
| **Verdict & độ tin cậy** | Cách gán `safe/review/protected/keep` và `certain/strong/likely/guess` |
| **An toàn** | Guard bắt buộc, những gì không bao giờ làm |
| **Tự động hoá** | Có được chạy không giám sát không (`unattendedEligible`) |
| **Trường hợp biên** | Những chỗ dễ sai |
| **Kiểm thử** | Harness trong `scripts/` phải có |
| **Hoàn thành khi** | Tiêu chí nghiệm thu |

Quy ước độ ưu tiên trong roadmap: **P0** (chặn các giai đoạn sau), **P1** (tính năng chính của giai đoạn), **P2** (có thể dời sang giai đoạn sau mà không ảnh hưởng gì).

---

## 1. Đối tượng người dùng

| Persona | Mô tả | Nỗi đau chính | Nhóm tính năng |
| --- | --- | --- | --- |
| **P1 — Người dùng phổ thông** | Laptop 256 GB, ổ C đỏ, không rành kỹ thuật | "Ổ C đầy mà không biết vì sao" | A1, A3, B1, B3, D4, G1, I |
| **P2 — Người dùng Việt Nam dùng app chat** | Zalo PC / Telegram nhận hàng GB ảnh, video, file | Dữ liệu chat phình to, không biết của cuộc trò chuyện nào | D3, E5, B1 |
| **P3 — Gia đình / người giữ ảnh** | Thư viện ảnh nhiều năm, nhiều bản copy | Sợ xoá nhầm ảnh không lấy lại được | E1–E4, F1, B2, B5 |
| **P4 — Gamer** | Nhiều game 50–150 GB | Game không chơi nữa vẫn chiếm chỗ | D2, B2, A4 |
| **P5 — Lập trình viên** | node_modules, Docker, WSL, SDK | Ổ đầy vì công cụ, tool thường bỏ qua đúng chỗ này | C1–C5, F2, F4, H1 |
| **P6 — IT / doanh nghiệp nhỏ** | Quản lý 5–500 máy | Không có cái nhìn tổng thể, không muốn đẩy dữ liệu lên cloud | H1–H4, G2, G4 |

---

## 2. Nguyên tắc bất biến

Ba quy tắc của README giữ nguyên. Tài liệu này bổ sung thêm năm quy tắc để chúng không bị xói mòn khi app lớn lên.

### Giữ nguyên
1. **Không chọn hộ người dùng.** Mọi thao tác hàng loạt đều nêu phạm vi, số lượng và dung lượng trước khi thực hiện.
2. **Moved ≠ freed.** Không bao giờ cộng hai con số này lại với nhau.
3. **Mọi verdict đều kèm bằng chứng và một trong bốn mức tin cậy.**

### Bổ sung
4. **Tính năng trả phí không bao giờ hạ thấp an toàn.** Hộp thoại xác nhận, cảnh báo cloud-sync, nhãn độ tin cậy, khả năng khôi phục và Restore Center luôn có ở mọi gói. Khi hết hạn license, tính năng chỉ chuyển sang *chỉ đọc*, không có dữ liệu nào bị khoá lại hay mất đi.
5. **Mỗi hành động mới đều đi qua cùng một pipeline.** Relocate, nén, dehydrate, quarantine hay hardlink đều qua vetting → probe → confirm → progress → toast → journal. Không có đường tắt nào riêng.
6. **Khi app không tự làm, app chuyển giao cho công cụ chính chủ.** Với dữ liệu hệ thống, app đã cài và game, app chỉ giải thích rồi mở đúng công cụ của Windows hoặc của launcher (Storage Sense, trình gỡ cài đặt, tính năng Move của Steam…). Hành động này gọi là `handoff`.
7. **Không upsell ở nơi ra quyết định xoá.** Hộp thoại xác nhận, màn progress và toast kết quả không bao giờ chứa quảng cáo. Upsell chỉ xuất hiện khi người dùng *chạm đúng giới hạn thật* của gói Free.
8. **Mạng chỉ được dùng khi người dùng bấm.** Ngoài kiểm tra update, các request mới (thanh toán, kích hoạt license) chỉ xảy ra trực tiếp sau một cú click, và đều được liệt kê trong README.

---

## 3. Roadmap tổng quan

```
Giai đoạn 0  Nền tảng              ████████
Giai đoạn 1  Nhìn thấy & không mất         ██████████
Giai đoạn 2  Quy mô & chuyên sâu                     ██████████
Giai đoạn 3  Kế hoạch & trùng lặp                              ████████
Giai đoạn 4  Ảnh, chat, di chuyển                                      ██████████
Giai đoạn 5  Doanh nghiệp                                                        ████████
Giai đoạn 6  Thương mại hoá (UI + mock)                                                  ██████
Giai đoạn 7  Ký số + thanh toán thật                                                           ████
```

Thời lượng tương đối chỉ mang tính minh hoạ. [Speculation] Tôi không ước tính số tuần được khi không biết quy mô đội.

### Giai đoạn 0 — Nền tảng (P0, chặn mọi giai đoạn sau) — ✅ Đã code xong (2026-09-24)

| Hạng mục | Mục đích | Trạng thái |
| --- | --- | --- |
| **0.1 Analyzer contract** | Mọi nguồn ứng viên (cũ và mới) dùng chung một giao diện | ✅ Đã code xong (2026-09-24) |
| **0.2 ActionKind pipeline** | Thêm các hành động ngoài `recycle`: `quarantine`, `relocate`, `compress`, `dehydrate`, `archive`, `hardlink`, `handoff` | ✅ Đã code xong (2026-09-24) — chỉ handler `recycle`; các kind khác đi cùng tính năng của chúng |
| **0.3 Action Journal** | Nhật ký thống nhất cho mọi hành động, là nền của Restore Center và audit log | ✅ Đã code xong (2026-09-24) |
| **0.4 Entitlements** | Lớp `can(feature)` ở main process. Trong dev mặc định bật tất cả | ✅ Đã code xong (2026-09-24) |
| **0.5 Elevated Helper** | Tiến trình nhỏ chạy quyền admin, chỉ đọc, có danh sách thao tác cố định | ✅ Đã code xong (2026-09-24) — phần nâng quyền UAC chưa được bấm thử |
| **0.6 Snapshot Store** | Lưu cây thư mục đã nén của mỗi lần quét, phục vụ diff (A5) và Planner (G1) | ✅ Đã code xong (2026-09-24) |
| **0.7 Settings schema v2 + migration** | Có version và migration tiến | ✅ Đã code xong (2026-09-24) |
| **0.8 Chuẩn hoá màn hình** | Thành phần dùng chung: `CandidateList`, `EvidencePanel`, `ActionBar`, `UpgradeHint` | ✅ Đã code xong (2026-09-24) |

**Hoàn thành khi:** bốn màn hiện có (Disk usage, What to delete, Photos, Duplicates) chạy trên Analyzer contract mới, toàn bộ ~40 harness hiện có vẫn pass, và mọi lần xoá đều được ghi vào Action Journal.

> **✅ Giai đoạn 0 đã code xong (2026-09-24).** Đối chiếu với tiêu chí hoàn thành:
> - **Bốn màn chạy trên Analyzer contract:** mọi dòng các màn vẽ ra đều là candidate đã qua `validateCandidate`, lấy từ 3 analyzer (`scan` cho Disk usage + What to delete, `duplicates`, `media`). Smoke xác nhận renderer chỉ nhận candidate, và mỗi candidate đều có evidence + confidence.
> - **Harness cũ vẫn pass:** 19 suite của `npm test` trước khi bắt đầu vẫn pass; thêm 8 suite mới (`test-contract`, `test-actions`, `test-ipc-manifest`, `test-journal`, `test-entitlements`, `test-helper`, `test-snapshots`, `test-settings-migration`), tổng 27. E2E `smoke.js`, `verify-autoclean.js` (Recycle Bin thật) và `verify-helper.js` (Electron thật, không nâng quyền) đều pass.
> - **Mọi lần xoá được ghi vào journal:** xoá từ cửa sổ (smoke xác nhận đủ 40/40 dòng), autoclean chạy tay, lần chạy theo lịch, và purge (`verify-autoclean.js` xác nhận trên bin thật) đều đi qua journal.
> - **Còn mở:** (1) bấm UAC thật cho helper, cần người: `npm run verify:helper -- --elevated`; (2) quyết định khoá/mở Pro ở bản `stable` trước Giai đoạn 6 (ghi ở mục 4.4); (3) sửa bảng 4.2 về `freesOnVolume` của quarantine/relocate/archive trước khi làm B1.
> - **Đã đóng cả ba (2026-09-24):** UAC đã bấm thử và pass; Pro mở ở `stable`; bảng 4.2 đã sửa. Xem ghi chú quyết định ở Giai đoạn 1.

### Giai đoạn 1 — Nhìn thấy toàn bộ & giải phóng không mất dữ liệu — ✅ Đã code xong (2026-09-25)

| Mã | Tính năng | Ưu tiên | Trạng thái |
| --- | --- | --- | --- |
| A1 | Bóc tách dung lượng hệ thống | P1 | ✅ Đã code xong (2026-09-24) |
| A3 | Treemap / Sunburst | P1 | ✅ Đã code xong (2026-09-24) — chỉ Treemap, Sunburst đã bỏ |
| A5 | Snapshot diff | P1 | ✅ Đã code xong (2026-09-25) — lịch chụp hằng tuần dời sang G3 |
| B1 | Quarantine sang ổ khác | P1 | ✅ Đã code xong (2026-09-25) — đã kiểm trên D: thật và trên ổ ảo VHDX thật (đầy, rút ổ giữa chừng) |
| B3 | OneDrive "Free up space" | P1 | ✅ Đã code xong (2026-09-25) — đã kiểm trên OneDrive thật |
| D4 | Cache app phổ biến | P1 | ✅ Đã code xong (2026-09-25) — 6 app đã kiểm trên máy này; các app còn lại chưa đưa vào |
| I1 | Restore Center | P1 | ✅ Đã code xong (2026-09-24) |
| I2 | Accessibility (high-contrast, bàn phím, screen reader) | P1 | ✅ Đã code xong (2026-09-25) — theo theme tương phản của Windows (đo trên theme giả lập) + màu tự thiết kế; bỏ tuỳ chọn accent; Narrator: người dùng xác nhận chạy ổn trên bản cài 0.1.16 (2026-09-26) |
| I3 | Menu chuột phải trong Explorer | P2 | ✅ Đã code xong (2026-09-25) — menu cổ điển qua HKCU (menu kiểu mới của Windows 11 cần gói đã ký), tắt sẵn; đã kiểm trên registry thật bằng khoá riêng của harness |
| I4 | Onboarding "Moved ≠ freed" | P2 | ✅ Đã code xong (2026-09-25) — không hiện cho người nâng cấp từ bản cũ; "Giới thiệu" nằm trong card Phiên bản |

Thứ tự làm (chốt 2026-09-24): I1 → A1 → A3 → A5 → B3 → D4 → B1 → I2 → I4 → I3. Giai đoạn 0 được commit riêng trước (`37179d8`).

**Hoàn thành khi:** trên máy test, tổng của "đã giải thích được" (thư mục người dùng + A1) cộng với dung lượng trống lệch không quá một ngưỡng nhất định so với dung lượng volume. Phần còn lại phải được hiện rõ thành một dòng *"chưa giải thích được: X GB"*, không được che đi.

> **Ngưỡng đã chốt (2026-09-24, khi làm A1):** chưa giải thích được ≤ 1% dung lượng đang dùng, tính sau lượt đo có quyền quản trị. Máy test đạt 0,33% (xem ghi chú A1). `npm run verify:system -- --elevated` kiểm tiêu chí này.

> **Quyết định đã chốt trước khi code Giai đoạn 1 (2026-09-24):**
> - Tính năng Pro ở bản `stable` trước Giai đoạn 6: **mở cho mọi người** (phương án a). Giai đoạn 6 sẽ phải khoá lại. Chưa quyết cho Pro·Dev và Business: hỏi lại trước Giai đoạn 2 và 5.
> - Helper UAC đã được bấm thử thật: `npm run verify:helper -- --elevated` → ALL PASS, integrity `high`.
> - Chỉ có **một** máy test, không phải ba như A1 ghi.
> - A1: thêm các dòng đặc tả thiếu (chương trình đã cài, phần còn lại của Windows, phần bị bỏ qua khi quét, người dùng khác), và thay `helper:request` dạng chung bằng hai kênh cố định. Fixture chỉ dùng output tiếng Anh thật, parser đọc theo cấu trúc (máy này không có bản dịch vssadmin/DISM).
> - A3: một màu accent đậm nhạt theo độ sâu, không tô theo loại file; bỏ Sunburst; dời tô màu Pro.
> - B1: bản gốc vào Recycle Bin theo mặc định và ghi thật là chưa giải phóng; tuỳ chọn "xoá bản gốc ngay" (tắt sẵn) là cách duy nhất giải phóng ổ C, kèm sửa quy tắc README về xoá vĩnh viễn.
> - B3: harness được tạo file thử trong OneDrive thật (thư mục riêng, tự dọn), nhưng phải hỏi lại ngay trước khi chạy.
> - D4: chỉ phát hành định nghĩa app đã kiểm đường dẫn trên máy này.

> **✅ Giai đoạn 1 đã code xong (2026-09-25).** Đối chiếu với tiêu chí hoàn thành:
> - **"Đã giải thích được" + dung lượng trống lệch không quá ngưỡng so với dung lượng volume; phần còn lại hiện thành dòng "chưa giải thích được":** ngưỡng đã chốt là ≤ 1% dung lượng đang dùng, tính sau lượt đo có quyền quản trị. **Máy test đạt 0,33%** (1,4 GiB trên 413 GiB đang dùng). Số này đo ngày 2026-09-24 qua đúng nút trong app (`npm run verify:system -- --elevated`, người dùng bấm UAC). Từ lúc đó không commit nào đụng vào đường đo (`src/main/system/`, `analyzers/system.js`, `helper/`, `lib/real-fs.js`; đã kiểm bằng `git log 9e9cf97..HEAD`), nên số đo vẫn đúng cho code hiện tại. Dòng "chưa giải thích được" luôn hiện trên màn Hệ thống, cả thành một phần riêng của thanh tỷ lệ, không bị che.
> - **Mười mục của giai đoạn đều đã code xong, mỗi mục một commit** (chưa push; push là phát hành): I1 `54d1486`, A1 `9e9cf97`, A3 `25e6dcc`, A5 `a81ec20`, B3 `6e66da7`, D4 `41ccef2`, B1 `f0d3b41`, I2 `3c55058`, I4 `5872e90`, I3 (commit ngay sau I4), cộng bản sửa EPERM `5e8e070` được duyệt riêng. Mỗi mục có ghi chú "✅" nói rõ khác đặc tả ở đâu.
> - **Harness lúc đóng giai đoạn:** `npm test` 38 suite, 1.586 kiểm tra, 0 lỗi; `test:e2e` 336/0; `test:a11y` 143/0; `test:onboarding` 40/0; `test:explorer` 21/0. Các harness chạy trên thứ thật: `verify-system --elevated` (ổ C: thật, UAC), `verify-quarantine --elevated` (VHDX thật, 13/13), `verify-dehydrate --write` (OneDrive thật), `verify-restore` (Thùng rác thật), `verify-contextmenu` (registry thật, 22/22), `verify-launch-target` (app thật, 12/12).
> - **Còn mở, cần người hoặc cần máy khác:** (1) ~~checklist Narrator của I2~~ người dùng xác nhận Narrator chạy ổn trên bản cài 0.1.16 (2026-09-26, xác nhận chung, không theo từng bước); bản có sửa lỗi "để yên" mới kiểm bằng `test:idle`, chưa ai nghe bằng Narrator; (2) theme tương phản thật của Windows, mới kiểm trên bản giả lập; (3) cài rồi gỡ installer thật để xác nhận bộ gỡ cài đặt xoá khoá menu (I3), mới kiểm được là NSIS biên dịch được; (4) các trường hợp A1 chưa có trên máy này (nhiều bản Windows, BitLocker đang mã hoá dở, Storage Spaces, ReFS); (5) chỉ có một máy test, không phải ba như A1 ghi. Đã dời có chủ đích: lịch chụp snapshot hằng tuần (A5) sang G3; tô màu Pro cho treemap (A3); tuỳ chọn màu accent (I2). Pro·Dev và Business: hỏi trước Giai đoạn 2 và 5; Pro vẫn mở trên bản stable tới Giai đoạn 6.

### Giai đoạn 2 — Quy mô & chuyên sâu — ✅ Đã code xong (2026-09-27)

Thứ tự làm (người dùng chốt 2026-09-26): A4 → D1 → D2 → C1–C5 → A2. Pro·Dev mở trên bản stable như Pro cho tới Giai đoạn 6, và vẫn giữ key `pro.dev` riêng.

| Mã | Tính năng | Ưu tiên | Trạng thái |
| --- | --- | --- | --- |
| A2 | Quét nhanh qua MFT / USN | P1 | ✅ Đã code xong (2026-09-27) — chỉ `$MFT`, không làm nhánh USN (USN không mang kích thước); công tắc chỉ cho quét cả một ổ NTFS; bộ phân tích byte chạy trong tiến trình quyền quản trị, có ghi threat model. **Sửa 2026-10-01:** qua helper thật (Electron) thì chưa từng đọc được bảng — Node 20 biến `\\.\D:` thành thư mục gốc; xem §11 mục 24 |
| A4 | Quét nhiều gốc, nhiều ổ, ổ ngoài, ổ mạng | P1 | ✅ Đã code xong (2026-09-26) — ổ mạng chỉ đọc (đã đo), ổ rời chỉ đọc cho tới khi đo; chưa đo trên ổ cứng gắn ngoài |
| C1–C5 | Developer Pack | P1 | ✅ Đã code xong (2026-09-26) — chỉ ship công cụ có thật; cache gói chỉ hiện lệnh, cache IDE xoá được khi IDE đóng; WSL và Docker chỉ giải thích; C1 chỉ giải thích, C5 xoá được nhưng **chỉ khi `.gitignore` của dự án khai**, và luật đó sửa luôn một lỗi có thật trong advisor |
| D1 | App đã cài: dung lượng & lần dùng cuối | P1 | ✅ Đã code xong (2026-09-26) — bỏ nguồn last-access (đã đo là không đáng tin), dung lượng tách hai cột đo được / bên cài khai; Prefetch cần quyền quản trị, chưa ai bấm |
| D2 | Thư viện game | P1 | ✅ Đã code xong (2026-09-26) — chỉ Steam (đã đo: không có launcher nào khác); dung lượng Steam ghi là chính xác nên một cột; thư mục mồ côi chỉ phát hiện, không xoá |

> **✅ Giai đoạn 2 đã code xong (2026-09-27).** Đối chiếu với tiêu chí hoàn thành:
>
> - **Năm mục đều xong, theo đúng thứ tự đã chốt** (A4 → D1 → D2 → C1–C5 → A2), mỗi mục một commit, chưa push (push là phát hành): A4 `3f13ff9`, D1 `762589f`, D2 `0abec91`, C1–C4 `c0c1600` và `77915f6`, C5 `2aad5dd`, A2 `2e9a4eb` + `543b1a9`. A2 là mục **duy nhất** đi hai commit — trình đọc `$MFT` tách khỏi phần nối, người dùng đồng ý lệch quy ước ở đây vì trình đọc đứng một mình đã kiểm chứng được. Mỗi mục có ghi chú "✅" nói rõ khác đặc tả ở đâu; đọc các ghi chú đó thay vì suy lại từ code.
> - **Harness lúc đóng giai đoạn** (chạy ngày 2026-09-27, máy này): `npm test` **46 bộ, 2.079 kiểm tra, 0 lỗi**; `test:e2e` **409/0**; `test:a11y` **173/0**; `test:onboarding` **40/0**; `test:explorer` **21/0**; `test:idle` **45/0**. Đầu giai đoạn là 38 bộ / 1.586 — giai đoạn này thêm **8 bộ và 493 kiểm tra**.
> - **Chạy trên thứ thật, trong giai đoạn này:** `verify:mft` trên `C:` và `D:` thật qua terminal quyền quản trị (người dùng chạy, 2026-09-27 — 0 bản ghi hỏng, parity +1 tệp trên D: và +42 tệp / 0,09 GB trên 209 GB ở C:, số thư mục trùng khít); `verify:external -- --drive D` làm đối chứng cho ổ rời; Steam thật cho D2; registry và tiến trình thật cho C1–C5.
> - **Ảnh chụp thật, hai theme + tiếng Việt + cửa sổ hẹp,** cho mọi giao diện mới: `shoot:multiroot` (A4), `shoot:apps` (D1), `shoot:games` (D2), `shoot:dev` và `shoot:devprojects` (C), `shoot:fastscan` (A2).
>
> **Ba thứ giai đoạn này sửa mà không nằm trong đặc tả mục nào:**
> - `isProtectedPath` không nhận ra dạng `\\?\C:\Windows`, `\\.\C:\…`, `\\?\UNC\…` và share quản trị của chính máy này (A4). Hệ quả: quét share quản trị sẽ đi thẳng vào thư mục Windows.
> - Advisor gọi thư mục `build` của một dự án là rác kể cả khi `.gitignore` của dự án đó không khai (C5).
> - Mọi reparse point bị coi là link trong bản nháp của A2 — cùng lớp lỗi mà `lib/real-fs.js` đã phải sửa cho walk thường, và trên `C:` thật là **312 thư mục cloud trên tổng 611** sẽ bị bỏ qua.
>
> **Còn mở, cần người hoặc cần máy khác:**
> 1. **Ổ gắn ngoài chưa đo được Thùng rác** (A4, người dùng tạm hoãn 2026-09-26). `npm run verify:external -- --drive X:` đã sẵn sàng. USB PNY đang cắm báo 0 GB, RAW, offline — **không khởi tạo, không format**.
> 2. ~~**`verify:prefetch -- --elevated` chưa lần nào chạy xong** (D1).~~ **Đã chạy 2026-09-27.** Giả định "mtime của `.pf` = lần chạy cuối" nay **có bằng chứng, chưa phải chứng minh** — xem D1 ở mục 5. Điều làm phần còn lại vô hại: `lastUsedFor` lấy **nguồn mới nhất**, nên prefetch cũ không kéo lùi được ngày khi UserAssist biết rõ hơn (có test trong `test-apps.js`).
> 3. **Chưa bấm thật một URI `steam://uninstall/...`** (D2).
> 4. **Chưa có ổ FAT/exFAT/ReFS thật** (A2). Đường quay về `notNtfs` nay có 14 kiểm tra trong `test-roots.js`, nhưng các dòng ổ lạ là **dữ liệu dựng**, ghi rõ trong test; chưa lần nào chạy trên một ổ thật.
> 5. **Quét tăng dần qua USN journal không làm** (mục 3 của đặc tả A2). Lý do đo được: USN record không mang kích thước tệp.
> 6. **Một lượt `test:a11y` cho 22 lỗi, không tái hiện được** trong bốn lượt sau, kể cả một lượt trên cây sạch `2e9a4eb`. Output của lượt đó không giữ lại. **Chưa có chẩn đoán** — nếu gặp lại, giữ output trước khi làm gì khác.
> 7. Mang sang từ Giai đoạn 1, chưa đổi: chưa ai nghe Narrator trên bản đã sửa lỗi "để yên"; chưa thử theme tương phản thật của Windows; chưa gỡ cài đặt thật để xác nhận menu Explorer bị xoá; chỉ có một máy test.
> 8. **Đã ghi nhận, chưa quyết:** quét `D:\work\tow_tool` cho ra **227 tệp `.png` trong thư mục `logs\`, 101,6 MB, xếp loại `log` / `safe`** — ảnh chụp màn hình nằm trong thư mục tên `logs`, và lượt chạy tự động sẽ lấy hết. Cần một quyết định riêng trước khi bật tự động trên máy có kiểu thư mục này.
>
> **Chưa push kể từ v0.1.16: 9 commit** (`ff14036` trở đi). Pro và Pro·Dev vẫn mở trên bản stable tới Giai đoạn 6. Business hỏi trước Giai đoạn 5.

### Giai đoạn 3 — Lập kế hoạch & trùng lặp nâng cao

Thứ tự làm (người dùng chốt 2026-09-28): **G1 → F1 → F2 → G4 → G2 → G3 → F3**.
G1 đi trước vì nó là mục **tiêu thụ** toàn bộ Giai đoạn 0–2: mọi bước của kế
hoạch đều trỏ về một màn đã có. G3 và F3 là P2 nên để cuối.

| Mã | Tính năng | Ưu tiên | Trạng thái |
| --- | --- | --- | --- |
| G1 | Space Planner | P1 | ✅ Đã code xong (2026-09-28) — không có nút "thực hiện kế hoạch"; mỗi bước mang **ba** con số thay vì một, và có thêm bước dọn Thùng rác vì nếu không thì 5/8 bước của đặc tả giải phóng đúng 0 byte |
| G2 | Báo cáo HTML | P1 | ✅ Đã code xong (2026-09-28) — **chế độ riêng tư che cả khối JSON nhúng**, nếu không thì hai yêu cầu của đặc tả tự phủ định nhau. Không tự đo gì để lấp chỗ trống: mục nào chưa có dữ liệu thì nói rõ là chưa có |
| G3 | Tóm tắt định kỳ | P2 | ✅ Đã code xong (2026-09-28) — cưỡi trên **phép đo hằng ngày**, không thêm tác vụ Windows thứ ba, và **chỉ trả giá Chromium vào đúng ngày có tóm tắt** (đo được: ngày thường vẫn 612–753 ms). Ví dụ của đặc tả đòi dữ liệu mà sampler không có |
| G4 | Nhiều hồ sơ tự động | P1 | ✅ Đã code xong (2026-09-28) — settings lên **v7**, chính sách đơn trở thành `autoClean.profiles`. "Mutex có tên" thay bằng **tệp khoá** (Node không có named mutex). Mẫu *Installer hàng tháng* của đặc tả **không dựng được**: `installer` không nằm trong danh sách trắng chạy ngầm |
| F1 | Trùng lặp xuyên thư mục / xuyên ổ | P1 | ✅ Đã code xong (2026-09-28) — phần "nhiều gốc nhiều ổ" **A4 đã giao từ trước**; mục này thêm tiêu chí chọn bản giữ theo loại ổ. **Không làm** nhánh hash qua ổ mạng: không đo được tốc độ thật trên máy này |
| F2 | Thư mục trùng toàn bộ | P1 | ✅ Đã code xong (2026-09-28) — **không có** `archive`/`quarantine` cả thư mục: `archive` chưa có handler nào (là B5), `quarantine` cũng `allowsFolders: false`. Hành động duy nhất là `recycle`/`quarantine` **từng tệp**, đúng quy tắc bất biến. Pha thư mục **đi cây riêng, nhìn cả `node_modules`, `.git`, tên chấm** — nếu không thì "trùng khớp" là lời nói dối |
| F3 | Phiên bản tài liệu | P2 | ✅ Đã code xong (2026-09-28) — ngày tháng **không** bị bỏ vô điều kiện như đặc tả yêu cầu: đo trên 6.503 tên thật, bỏ ngày tạo ra 38 nhóm mà **cả 38 đều sai**. Thêm một điều kiện đặc tả không có: một bộ phải **tự nói ra là phiên bản** (có hậu tố, hoặc cùng một thư mục) — nếu không thì 216 nhóm trên đĩa thật, 180 trong số đó chỉ là tên trùng |

### Giai đoạn 4 — Ảnh, chat, di chuyển dữ liệu

Thứ tự làm (người dùng chốt 2026-09-28): **B2 → B5 → B4 → E2 → E1 → D3 → E5 →
F4 → E4 → E3**. B2 đi đầu **không phải vì ưu tiên** mà vì nó mở `allowsFolders`
và dựng cỗ máy "copy nguyên vẹn một cây thư mục rồi chứng minh là nguyên vẹn"
mà B5 và E2 dùng lại nguyên. Ba mục P2 rủi ro cao đi cuối.

| Mã | Tính năng | Ưu tiên | Trạng thái |
| --- | --- | --- | --- |
| B2 | Relocate | P1 | ✅ Đã code xong (2026-09-28) — **mục mở đường cho cả nhóm B**: `allowsFolders` trước đây được khai báo ở cả 5 handler mà **không dòng nào đọc**, nay `execute()` thực thi nó thật và `relocate` là handler đầu tiên khai `true`. Giữ nguyên ADS (đo: Downloads **10,6%** tệp có stream, ổ D **0,07%**) vì mất `Zone.Identifier` là âm thầm gỡ cảnh báo SmartScreen. Lối tắt là `.lnk` qua PowerShell COM, **không bao giờ** junction. **Không có bước trong G1**: một bước phải khớp với *candidate*, mà không gì trong app xếp hạng được "thư mục nào nên sang ổ khác" — xem `planner/plan.js`. **Sửa kèm:** `WHEN.relocate` trong planner viết sẵn là `now` từ trước khi có handler, thật ra là `bin`; và bản đồ vẫn vẽ thư mục đã chuyển đi cho tới khi có `removeFolders()` — ảnh chụp bắt được |
| B5 | Đóng gói lưu trữ | P1 | ✅ Đã code xong (2026-09-28) — **nén có chọn lọc theo từng tệp**, quyết trên mẫu 64 KB: đo thật cho thấy mã nguồn tiết kiệm 68% còn `.docx` 1%, `.png` 1,5%, `.mp4` **−0%**, nên tệp không co lại thì ghi `STORED`. Manifest đi **bên trong archive**, không vào journal (journal có schema cố định — xem `journal/journal.js`). Xác minh là **bắt buộc**: mở lại archive, đối chiếu CRC + độ dài + sha256 từng tệp trước khi đụng bản gốc. Hoàn tác qua **Khôi phục**: giải nén về đúng chỗ, giữ timestamp. **ZIP64 đo được trên máy này** với thành viên 5,37 GB — Windows đọc lại đúng độ dài 64-bit. **Không làm `.7z`** (xem §11 mục 14). **Sửa kèm:** `WHEN.archive` trong planner cũng viết sẵn `now`, thật ra là `bin`; Restore Center liệt kê session archive nhưng báo "0 items can be put back" cho tới khi `inArchive` được thêm vào `RESTORABLE` — ảnh chụp bắt được |
| B4 | Nén NTFS có chọn lọc | P1 | ✅ Đã code xong (2026-09-28) — **hành động duy nhất của giai đoạn này giải phóng dung lượng ngay**, không qua Thùng rác. **Chỉ LZNT1** (đã chốt): đo được LZX cho 96,4% so với 87,5%, nhưng **một lệnh ghi 40 byte tại chỗ làm mất nén cả tệp** — nặng hơn điều đặc tả ngờ (§11 mục 15). Con số "30–45%" của đặc tả **sai trên máy này**: mã nguồn **87,5%**, log **81,2%**, ảnh/video **0,0%** — nên ước lượng lấy bằng cách đưa 12 tệp thật của chính thư mục qua NTFS (lệch **0,1 điểm** so với thực tế). **Không parse output của `compact`** (bản địa hoá: "1,9 to 1"); kích thước lấy từ `stat().blocks * 512`. Từ chối thêm hai thứ đặc tả không nhắc: ổ không nén được (**hỏi bằng cách thử**, không suy từ cluster) và thư mục có tệp **chỉ nằm trên OneDrive** (nén sẽ kéo về, đúng phần B3 vừa giải phóng). **G1 vẫn không có bước nén** — lý do ở `planner/plan.js` |
| E2 | Sao lưu trước khi xoá | P1 | ✅ Đã code xong (2026-09-29) — **không phải một handler mới**: là một tuỳ chọn của `recycle`, vì đặc tả đặt nó trong hộp thoại xác nhận. Nhưng hộp thoại đó là `dialog.showMessageBox` **native**, mà message box native chỉ chứa được **một checkbox**, không chứa được nút chọn thư mục — nên đích được chọn trên thanh hành động của màn Photos (giống B2/B5), còn hộp thoại giữ đúng phần người ta thật sự đổi ý vào phút chót: **bỏ tick là xoá mà không chép**. **Đề bài "dùng lại `tree-copy.js`" sai**: `copyTree` đòi đích **chưa tồn tại** và đi từ **một gốc**, còn E2 nhận một danh sách tệp rời từ nhiều thư mục, có thể nhiều ổ, vào một thư mục dùng đi dùng lại — phần dùng chung thật là `verified-copy.js`. Bố cục đích lấy **ổ làm thư mục đầu** (`<đích>\C\Users\…`), vì nếu không thì `C:\photos\a.jpg` và `D:\photos\a.jpg` là **cùng một chỗ**. **Không bao giờ ghi đè**: trùng tên mà khác nội dung thì thành ` (2)`; trùng cả hash thì tính là đã sao lưu và không chép lại. Manifest **cộng dồn**, không thay thế. **UNC được phép** — `lib/trash.js` chỉ từ chối **nguồn** trên mạng (`vet()`), còn đây chép **tới** mạng rồi xoá bản gốc cục bộ; nhưng máy này không có NAS nên tốc độ là `[Unverified]` (§11 mục 12). Giữ ADS (đã chốt). **Ảnh chụp bắt được ba lỗi**: đổi ngôn ngữ làm `translateDom` ghi đè nhãn nút và **mất tên thư mục đích**; hai nút mới đẩy **"Chuyển mục đã chọn vào Thùng rác" ra hẳn ngoài khung ở 1180px**; và toast nằm đè lên chính thanh đó |
| E1 | Màn so sánh cạnh nhau | P1 | ✅ Đã code xong (2026-09-29) — **hai phần, không phải một**: đặc tả nói "mở từ một nhóm near-duplicate", mà **nhóm đó chưa có mặt nào trên giao diện**. `perceptual.groupSimilar`, IPC `media:similar` và `api.mediaSimilar` đã nối đủ từ đầu và **không renderer nào từng gọi**; engine còn tính sẵn `spread` kèm comment "so the UI can say how alike these actually are". Nên mục này dựng cả dải nhóm lẫn màn so sánh. **Đo được**: băm một ảnh tốn **70,6 ms**, gom nhóm chỉ 2 ms — nên chi phí toàn bộ nằm ở phép giải mã mà lưới ảnh **cố ý không bao giờ làm hàng loạt**. Do đó có **nút riêng** kèm tiến độ và nút dừng (~4,9 phút cho 4.124 ảnh, trả một lần vì kết quả được cache), và thẻ luôn nói mẫu số thật. **2.534 ảnh chỉ nằm trên OneDrive bị loại khỏi lượt băm** và được nói ra — đọc một tấm là tải nó về, đảo ngược đúng thứ B3 vừa giải phóng. `preview:compare` từ 2 lên 2–4. `iso`/`exposureTime` đọc được từ lâu nhưng **bị bỏ rơi** khi dựng payload — nay có. **Ảnh chụp bắt được 4 lỗi**: ba ảnh hiện ở ba kích thước nên không so sánh được; `formatDuration` là bộ định dạng ETA nên toast ghi "in almost done"; ô Megapixel của ảnh nhỏ hiện `—` như thể không biết; và thẻ nhóm **không dịch phần do JS dựng** |
| D3 | Dữ liệu Zalo / Telegram theo cuộc trò chuyện | P1 | ✅ Đã code xong (2026-09-29) — **màn riêng, không đi qua analyzer thường**: `scanner.js:201` gắn `hard` cho mọi thứ dưới `AppData\Roaming` nên `advisor.js:400` trả `null`, mà cả hai app đều ở đó. `pro.chat` từ nay mới **thật sự được dùng** — nó đã khai trong `entitlements.js` từ lâu và không một dòng nào gọi. **Mức 3 chỉ Zalo**, và sâu hơn brief một tầng: `resource\<cuộc trò chuyện>\<loại>\`, không phải phẳng. **Đo được: 2.195 ảnh nằm hai bản** (`Cache` = JPEG như lúc nhận, `picture` = JXL mã hoá lại) — 272,3 MB, 26% cả cây. Nhưng **không đề xuất xoá bản trùng**: đo bằng đúng hai bộ giải mã của `thumbs.js` thì `.jxl` trả EMPTY ở Chromium 130 và ném lỗi ở shell Windows, còn tệp `Cache` **không đuôi** giải mã ra 862×1897 — bản nhỏ hơn là bản không ai mở được. **Telegram chỉ Mức 1** (không gì trong `tdata` mang tên cuộc trò chuyện), và `tupdates` 212,6 MB **không phải rác**: đọc `FileVersion` từ chính hai tệp `.exe` cho thấy 7.2.5.0 đang chờ đè lên 7.1.3.0 đang chạy — `review`, và bằng chứng nói xoá là mất 212 MB tải lại. **Cache trình duyệt của Zalo đi sang D4** (app thứ 7, 602,3 MB, Free · `safe`), không khoá sau `pro.chat`; settings lên **v10**. **Ảnh chụp bắt được 4 lỗi**: hai dòng cùng tên "Files" và bốn dòng cùng tên "Cached media"; hàng `update` **chưa dịch** vì thiếu `label`; và hai video đề ngày **30/11/2185** — tên chúng mở đầu bằng 13 chữ số là *id*, không phải epoch. **Sửa kèm:** media root của Telegram trong `lib/media/roots.js` trỏ cứng `user_data\media_cache` (**1 tệp / 10 KB**) và **không bao giờ thấy tài khoản thứ hai** — nay mỗi tài khoản một root, có tên |
| E5 | Ảnh theo cuộc trò chuyện | P1 (phụ thuộc D3) | ✅ Đã code xong (2026-09-29) — **đặc tả một câu, ba chỗ nó không lường tới.** (1) Trục này **không phải một phân hoạch** như "Where from": hầu hết ảnh không thuộc cuộc trò chuyện nào, nên thanh chia **riêng phần ảnh chat** và thẻ **biến mất hẳn** khi thư viện không có ảnh chat — đúng chữ của đặc tả. (2) **Hai cổng, không phải một**: ngoài luật đuôi ở `media/scan.js:214` còn luật từ chối thư mục tên `Cache` ở `roots.js` — mà ảnh JPEG không đuôi của Zalo **nằm trong** thư mục tên `Cache`. Đo được: hai luật này giấu **4.005 ảnh JPEG đọc được (293 MB)** và **57 video xem được (305 MB)**. (3) **5.508 tệp `.jxl` (342 MB) bị để ngoài, và nói ra thành câu** (đã chốt): chúng là ảnh thật nhưng không thứ gì trên máy này vẽ được, còn bản đọc được của cùng tấm ảnh thì vẫn có trong lưới. 183 tệp `fileNoise`/`voice` tự rơi ra vì bytes không nói gì. Kết quả: **4.614 tệp / 593 MB / 51 cuộc trò chuyện**, mỗi tệp mang `meta.conversation` đọc từ đường dẫn bằng chính hàm màn Chat dùng. **Không khoá `pro.photos`** (đã chốt) — nhất quán với E1, cả màn Photos vẫn Free. **Sửa kèm, một lỗi có sẵn ảnh chụp bắt được:** `#media-status` mang `data-i18n`, nên **đổi ngôn ngữ xoá luôn kết quả quét** và thay bằng câu "sẵn sàng quét" — lần thứ ba dự án này dính bẫy `translateDom`. Nay dòng trạng thái giữ **các con số**, không giữ câu, và tự nói lại bằng ngôn ngữ mới |
| F4 | Hardlink bản trùng (Dev Pack, có cảnh báo mạnh) | P2 | ✅ Đã code xong (2026-10-01) — **câu `[Unverified]` về Office đã đo: đúng, nhưng đặc tả nói sai hệ quả**. Một lần `Save()` của Word đổi `ino` và `nlink 2→1`, tên còn lại giữ **byte cũ**; Excel y hệt. Nên câu bắt buộc *"Sửa một bản sẽ sửa tất cả"* **sai với tệp Office**, và hộp thoại phải nói cả hai điều. Đo được luật thật: **ghi tại chỗ giữ liên kết, `rename` đè làm đứt** — nên lọc theo đuôi chỉ là đại diện, và giới hạn đó được **nói thẳng ra** thay vì để danh sách trông như đã đầy đủ. **Sửa kèm, máy móc dùng chung:** `lib/duplicate.js` trước nay **không biết tới inode**, nên sau khi hardlink nó vẫn hứa hẹn đúng số dung lượng vừa được giải phóng — nay `nlink` đi nhờ `lstat` sẵn có và mọi con số **đếm tệp chứ không đếm dòng**. Hoàn tác ở **Trung tâm khôi phục** (trạng thái `linked`), và vì tệp chưa từng rời chỗ nên `undo.inPlace` **tắt phép kiểm xung đột** — không tắt thì hoàn tác âm thầm không làm gì. Hộp thoại là **cái duy nhất không phải message box native**; cổng là *cuộn tới cuối*, cố ý không phải ô tick. Đo được: hardlink **không cần quyền quản trị**. Ảnh chụp bắt **3 lỗi** (nút thứ ba đẩy nút xoá ra khỏi mép ở 1180px; dòng đã nối vẫn ghi "identical"; Trung tâm khôi phục hiện `hardlink: 3 items` chưa dịch) |
| E4 | Timeline & bản đồ | P2 | ✅ Đã code xong (2026-10-01) — **hai nửa khác hẳn nhau**. Timeline **không cần dữ liệu mới**: `meta.at` đã sang cửa sổ từ lâu, nên `meta.year` thành trường chết và **đã xoá**. Đo được: **chỉ 4,5%** tệp mang ngày chụp thật, nhưng **ở đâu có cả hai thì 98,1% khớp cùng ngày** — nên vẫn vẽ tới cấp ngày, và mỗi mốc **nói ra** bao nhiêu được đề ngày bởi ảnh, bao nhiêu bởi tệp. Bản đồ: đo được **chỉ 38/11.419 tệp (0,3%)** ghi vị trí; tôi đề nghị không làm, **người dùng chốt làm và cho phép online** (2026-10-01) sau khi nghe ba hệ quả. Việc đó **đảo quyết định riêng tư** trong `exif.js`/`bmff.js` — cái comment ra đời sau khi một lượt kiểm in ra **toạ độ nhà của tác giả**. Thay thế bằng một **ranh giới có test**: toạ độ chỉ vượt IPC khi bản đồ bật, và `test-media-map.js` **đọc mã nguồn** của `report/`, `snapshots/`, `journal.js` để chứng minh không thứ nào ghi tệp chạm tới nó. **CSP không nới một chữ** — mảnh bản đồ đi qua main rồi về dạng `data:`. Câu *"thứ duy nhất có kết nối internet"* **đã sửa ở cả hai ngôn ngữ**. Đo được: `tile.openstreetmap.org` **bị chặn** từ máy này nhưng `a.tile…` thì không; chọn OSM vì **điều khoản của Carto/Wikimedia/Esri không hợp với sản phẩm có bán**. Không thêm dependency — Web Mercator viết tay. **Chưa làm:** reverse geocoding (cần bộ dữ liệu chưa duyệt) và kéo thả bản đồ |
| E3 | Tạo bản video nhẹ hơn | P2 | ✅ Đã code xong (2026-10-01) — **ffmpeg đã được duyệt nhưng cuối cùng không dùng, và `package.json` vẫn đúng hai dependency**. Phương án 3 của đặc tả bị đánh dấu `[Unverified]`; đo lại thì nó **chạy thật**: `VideoEncoder`/`VideoDecoder` **vắng mặt ở `data:` URL nhưng có đủ ở `file://`** — đúng origin `main.js:92` đang nạp. Đo được trên máy này: giải mã **660 fps**, encode H.264 **109 fps** @1080p, HEVC **84 fps**. Thứ Chromium **không** làm là ghi ra tệp: `MediaRecorder` có xuất `video/mp4` thật nhưng **bị khoá ở tốc độ thực** — 300 khung đẩy qua `MediaStreamTrackGenerator` hết 74 ms và trả về **0 byte**. Nên bộ ghi MP4 **tự viết** (`mp4/mux.js`), đúng cái giá B5 đã trả cho ZIP. **Đo trước khi code, và nó đổi cả bài toán: 308/381 video (87,7% số byte) là placeholder `CrossDevice` chiếm 0 byte trên đĩa** — nén chúng không giải phóng gì và đọc chúng là tải 4,6 GB về, nên bị từ chối thành lời. Còn **73 tệp / 644,7 MB đọc được, demux 73/73, tất cả đều `avc1`, không một tệp HEVC nào**. **Ba chỗ lệch với đặc tả:** (1) bước 3 nói "dùng lại E1" nhưng `compare.js:407` dựng `<img>` nên **chưa bao giờ mở được video** — nay có khung `<video>`, và đồng hồ chia chung đúng lý lẽ zoom chia chung đã có sẵn; (2) bước 2 đòi **giữ GPS**, mà ghi toạ độ vào tệp app tự tạo là đúng thứ `test-media-map.js` sinh ra để cấm — **không giữ**, nói ra thành câu, và `lib/media/mp4` nay **nằm trong vòng quét của chính phép kiểm đó** (6 → 9 tệp); ngày chụp và chiều xoay thì **có** giữ; (3) `pro.photos` vẫn là khoá chết nên **không khoá**, nhất quán với E1/E4/E5. Âm thanh **chép nguyên si, không encode lại**; thứ không phải AAC thì bỏ và nói rõ. **Xác minh là bắt buộc**: bản mới được đọc lại bằng chính bộ đọc của app trước khi ai được báo là nó tồn tại, và bản không đọc được thì **bị xoá** — đúng bài học `.jxl` của E5. **Ảnh chụp bắt được 6 lỗi thật** |

### Giai đoạn 5 — Doanh nghiệp — ✅ Đã code xong (2026-10-02)

Thứ tự làm (người dùng chốt 2026-10-01): **H4 → H1 → H2 → H3**. H4 đi đầu vì nó
chỉ dựa vào Journal 0.3 đã có; H2 cần `run --profile` của H1; H3 cần H2 bảo máy
ghi tệp lên share. Cái giá của thứ tự này: lệnh `journal verify` của đặc tả nằm
trong CLI, tức là H1, nên H4 phải có chỗ hiện kết quả trước đó — Restore Center.

| Mã | Tính năng | Ưu tiên | Trạng thái |
| --- | --- | --- | --- |
| H1 | CLI | P1 | ✅ Đã code xong (2026-10-01) — **đo trước, và số đo định hình cả mục**: exe là GUI subsystem nên PowerShell/cmd gõ thẳng **không chờ và mất mã thoát** → ship `bin\cleandrive.cmd` (không đụng PATH); `app.quit()` **nuốt mã thoát** → `app.exit(code)`; **Ctrl+C giết thẳng Electron** nên mã 5 không bao giờ là Ctrl+C; console CP 437 làm vỡ tiếng Việt → **CLI tiếng Anh, `--json` chỉ ASCII**. **Business vẫn đóng trên stable** (chốt): bảy lệnh trả 3 kèm câu nói rõ, còn `journal`/`restore`/`version`/`help` **không bao giờ hỏi licence** (quy tắc 4). **Chín chỗ lệch** ghi ở §5: `policy` sang H2; thêm mã 6 và 64; thêm `profiles`/`snapshots` vì đặc tả không cho cách biết id; `run` từ chối hồ sơ đang tắt; `restore` không bao giờ ghi đè; `scan --mft` từ chối thay vì lặng lẽ walk, không bao giờ bật UAC; chuỗi quét **tách khỏi `scan:run`** để không có hai phép quét; một lỗ `argv.includes('--helper')` đã có thể kéo CLI vào nhánh helper; hai màn hình nay gọi đúng tên phiên/lượt chạy từ dòng lệnh. Phần cần admin: người dùng chạy **41/1** — `system` 0,10% chưa giải thích được; `scan D:\ --mft` hỏng vì **lỗi có sẵn của A2** (helper Electron chưa từng đọc được bảng, §11 mục 24, sửa riêng); chạy lại sau bản sửa: **42/0** |
| H2 | Policy qua GPO / Intune (ADMX) | P1 | ✅ Đã code xong (2026-10-02) — **nửa "siết" áp dụng ở mọi gói, nửa "làm thay" cần `biz.policy`** (người dùng chốt): chỉ cho xem, ép tắt Automatic, trần danh mục, thư mục bảo vệ, tắt kiểm tra update chạy cả khi không có Business; hồ sơ của tổ chức và nơi đặt vùng quarantine thì cần. **Đo trước**: đọc `HKLM\SOFTWARE\Policies` không cần admin (25–45 ms) bằng `reg export … /reg:64` ra tệp UTF-16 — `reg query` làm mất hẳn tiếng Việt, `WOW6432Node\Policies` là một khoá riêng, và người dùng không ghi được kể cả `HKCU\Software\Policies`. **Policy thắng mà không bao giờ vào settings.json**: gỡ policy thì lựa chọn của người dùng còn nguyên. "Tắt hành động xoá" có **sáu cửa chứ không phải ba**, đều chặn — kể cả nút dọn Thùng rác và lựa chọn "Thay thế" của Khôi phục; khôi phục và handoff vẫn chạy (quy tắc 4). **Lệch đặc tả**: `policy apply` không nhận tệp và từ chối chạy dưới SYSTEM; `validate` nhận tệp `.reg`; đường dẫn báo cáo dời sang H3; không đọc được policy = không có policy, nói ra (người dùng chốt); hồ sơ của tổ chức mặc định chỉ báo cáo. ADMX/ADML **sinh từ schema** và khớp từng byte với `policy/` trong repo; nạp trong GPMC/Intune là **[Unverified]** (máy Home). Harness bắt được **một race thật**: đọc đúng lúc khoá đang được ghi lại thì ra rỗng → policy "biến mất" thì đọc lại trước khi tin. Ảnh chụp bắt **3 lỗi** của chính mục này |
| H3 | Console tổng hợp nhiều máy (không cloud) | P1 | ✅ Đã code xong (2026-10-02) — **phép đo hằng ngày ghi báo cáo, không thêm tác vụ thứ ba**, và ghi **sau cùng**: đo được IP không trả lời giữ lệnh ghi **42 s**, và cả `process.exit()` lẫn `app.exit()` đều không thoát được trước đó — share chết thì tiến trình ẩn sống thêm ~44 s, mã thoát vẫn 0. **"Task bị hỏng" không thể tự báo** (tác vụ ghi báo cáo hỏng thì im lặng), nên **im lặng quá 2 ngày** là tín hiệu mạnh nhất của Console. **Con dấu H4 lên share, Console nhớ** (người dùng chốt): bắt được **cả hai đòn THE LIMIT** của H4 — chạy thật trên journal niêm phong thật — với điều kiện Console đã đọc báo cáo trước lúc sửa. "Danh mục" và top thư mục **chỉ có từ lần quét bằng tay** (top thư mục bật riêng). Hồ sơ chỉ gửi **id**. Thêm `cleandrive report` để ai cũng tự kiểm tệp gửi đi có gì. Chưa đo được trên LAN thật (chỉ `\\localhost\D$`, §11 mục 31). Ảnh chụp và `test:a11y` bắt **7 lỗi** của chính mục này |
| H4 | Audit log ký số | P1 | ✅ Đã code xong (2026-10-01) — **khoá sau `biz.audit` mà journal vẫn không đọc licence**: `services.js` hỏi licence rồi *đưa* cho journal một bộ niêm phong hoặc không; việc kiểm là đọc nên không bao giờ khoá, và licence hết hạn chỉ dừng con dấu mới. **Bốn chỗ lệch:** (1) `prev` là hash của dòng trước **trong cùng phiên**, không phải trong tệp — cửa sổ và lượt chạy 02:00 ghi chung một tệp, Restore mở hai phiên cùng lúc, và chuỗi theo tệp sẽ gọi mỗi lần mất điện là "bị sửa"; xoá trọn một phiên thì bắt bằng **số thứ tự của con dấu** và trường `after`; (2) DPAPI **phạm vi người dùng**, không phải máy (người dùng chốt), qua PowerShell, ~0,5 s một lần cho mỗi tiến trình — **`safeStorage` bị loại vì đo được nó mất khoá khi tiến trình thoát bằng `app.exit()`**, đúng cách lượt chạy theo lịch thoát; (3) **giới hạn đặc tả ghi còn nhẹ hơn thật**: không chỉ admin mà **chính người dùng của máy** viết lại và ký lại được, vì task chạy dưới tài khoản của họ, không nâng quyền — harness kiểm cả hai đòn mà con dấu *không* thấy, để tài liệu không trôi thành lời hứa; (4) `journal verify` chưa có CLI (là H1) nên hiện ở **Restore Center**. Thêm một thứ đặc tả không có: **bản ghi `prune` có niêm phong**, nếu không mỗi lần dọn theo hạn 13 tháng trông y như bị xoá |

> **✅ Giai đoạn 5 đã code xong (2026-10-02).** Bốn mục, đúng thứ tự đã chốt, mỗi mục một commit, cộng bốn lỗi có sẵn tìm thấy giữa chừng, mỗi lỗi một commit đi trước: H4 `12bb8f0`; lượt chạy theo lịch luôn báo thành công và không bao giờ hiện thông báo `53021ac` (§11 mục 22); bảy token CSS không tồn tại `f41dc46` (§11 mục 23); Quét nhanh chưa từng đọc `$MFT` qua helper thật `444057e` (§11 mục 24); H1 `fec005a`; `scheduler.js` gọi `schtasks`/`powershell` qua PATH `271106c` (§11 mục 27); H2 `a304067`; H3 `b204193`. **Phát hành thành v0.5.0 ngày 2026-10-02** (`260d338`).
>
> - **Business vẫn đóng trên bản stable** (chốt ở H1): niêm phong, CLI (trừ `journal`/`restore`/`policy`/`version`/`help`), nửa "làm thay" của policy và Console đều trả lời bằng một câu nói rõ, không bao giờ chạy phần nhỏ hơn. Nửa "siết" của policy áp dụng ở mọi gói (chốt ở H2). Mọi quyết định licence được đưa ra ở `services.js` hoặc `main.js` rồi *đưa* vào; không module nào dưới `journal/`, `policy/`, `fleet/` nạp licence (`test-entitlements.js`).
> - **Harness lúc đóng giai đoạn** (2026-10-02, máy này): `npm test` **3290/0, 65 bộ**; `test:e2e` **610/0**; `test:a11y` **205/0**; `test:idle` **45/0**; `verify:cli` 39/0; `verify:scheduled-exit` 10/0; `verify:mft-pipe` 16/0; `verify:policy` 29/0; `verify:console` **20/0**. Phần cần admin do người dùng chạy: `verify:cli -- --elevated` 42/0, `verify:mft-pipe -- --real D` 7/0, `verify:policy -- --elevated` 8/1 rồi, sau bản sửa harness, **8/0** (§11 mục 28).
> - **Còn mở, cần người hoặc máy khác:** §11 mục 29 (nạp ADMX trong GPMC/Intune), 31 (báo cáo H3 qua LAN thật), 11 (chỉ một máy test). Cho trợ lý: 26 (fuse, Giai đoạn 7), 30 (lề `.panel-bar`), 33 (một lần bảng màu tối không kịp ổn định trong `shoot:console`).

### Giai đoạn 6 — Thương mại hoá: giao diện production, thanh toán giả lập

Toàn bộ giao diện gói, checkout, license, trial, hết hạn và nâng cấp được làm **đúng như production**. `MockPaymentProvider` luôn trả về thành công. Chi tiết ở [mục 7](#7-thương-mại-hoá--giao-diện-production-thanh-toán-giả-lập).

### Giai đoạn 7 — Ký số & thanh toán thật

Code signing, cổng thanh toán thật, server phát hành license, gỡ bỏ mock. Chi tiết ở [mục 8](#8-ký-số--tích-hợp-thanh-toán-thật-giai-đoạn-cuối).

### Phụ thuộc giữa các tính năng

```
0.1 Analyzer ─┬─► mọi tính năng
0.2 Actions  ─┼─► B1 B2 B3 B4 B5 F4 E3
0.3 Journal  ─┼─► I1 Restore Center ─► H4 Audit log
0.5 Helper   ─┼─► A1 A2 D1
0.6 Snapshot ─┴─► A5 Diff ─► G1 Planner ─► G3 Recap
A4 Multi-root ──► F1 Cross-drive dupes ─► F2 Folder dupes
D3 Chat data  ──► E5 Ảnh theo cuộc trò chuyện
B1 Quarantine ──► E2 Backup-before-delete (dùng chung cơ chế xác minh)
H1 CLI        ──► H2 Policy ─► H3 Console
0.4 Entitlements ──► Giai đoạn 6 ─► Giai đoạn 7
```

---
## 4. Kiến trúc nền tảng (Giai đoạn 0)

### 4.1. Analyzer contract

Mọi màn hình đều là một cách trình bày các `Candidate`, và mọi nguồn dữ liệu đều là một `Analyzer`.

```js
// src/main/analyzers/contract.js

/** @typedef {'certain'|'strong'|'likely'|'guess'} Confidence */
/** @typedef {'safe'|'review'|'protected'|'keep'} Verdict */
/** @typedef {'recycle'|'quarantine'|'relocate'|'compress'|'dehydrate'
 *           |'archive'|'hardlink'|'handoff'|'none'} ActionKind */

/**
 * @typedef Evidence
 * @property {number} rank        // 1 = mạnh nhất; bằng chứng được XẾP HẠNG, không cộng điểm
 * @property {string} key         // i18n key, ví dụ 'evidence.devcache.lockfilePresent'
 * @property {object} [params]    // tham số cho câu dịch
 */

/**
 * @typedef Candidate
 * @property {string}   id            // ổn định giữa các lần quét: hash(analyzerId + path)
 * @property {string}   path          // file HOẶC thư mục (với các action cho phép thư mục)
 * @property {'file'|'folder'|'virtual'} kind  // 'virtual' = hiberfil, restore point…
 * @property {number}   bytes         // dung lượng logic
 * @property {number}   [bytesOnDisk] // dung lượng thật trên đĩa (nén, sparse, placeholder)
 * @property {string}   category      // 'system.winsxs', 'dev.node_modules', ...
 * @property {Verdict}  verdict
 * @property {Confidence} confidence
 * @property {Evidence[]} evidence
 * @property {ActionKind[]} actions   // hành động hợp lệ, theo thứ tự đề xuất
 * @property {boolean}  unattendedEligible // mặc định false
 * @property {object}   [meta]        // dữ liệu riêng của analyzer
 */

/**
 * @typedef Analyzer
 * @property {string}  id
 * @property {string}  feature            // entitlement key: 'free', 'pro.dev', ...
 * @property {boolean} requiresElevation
 * @property {string[]} categories        // khai báo trước để UI và Automatic biết
 * @property {(ctx: AnalyzerContext, signal: AbortSignal) => AsyncIterable<Candidate|Progress>} run
 */
```

```js
// src/main/analyzers/registry.js
const analyzers = new Map();

export function register(analyzer) {
  if (analyzers.has(analyzer.id)) throw new Error(`duplicate analyzer ${analyzer.id}`);
  for (const c of analyzer.categories) assertCategoryDeclared(c); // danh mục phải có trong categories.js
  analyzers.set(analyzer.id, Object.freeze(analyzer));
}

export async function* runAnalyzer(id, ctx, signal, lic) {
  const a = analyzers.get(id);
  if (!a) throw new Error(`unknown analyzer ${id}`);
  if (!can(lic, a.feature)) { yield { type: 'locked', feature: a.feature }; return; }
  for await (const item of a.run(ctx, signal)) {
    if (signal.aborted) return;            // trả về kết quả từng phần, không ném lỗi
    if (item.type === 'candidate') validateCandidate(item); // verdict/confidence/evidence bắt buộc
    yield item;
  }
}
```

> **✅ Đã code xong (2026-09-24).** Code ở `src/main/analyzers/` (`contract.js`, `categories.js`, `registry.js`, `scan.js`, `duplicates.js`, `media.js`) và `src/main/automatic/allowed-categories.js`; harness `scripts/test-contract.js`. Khác với đặc tả ở trên:
> - Viết bằng CommonJS như phần còn lại của repo, và dùng `CancelToken` thay cho `AbortSignal`.
> - Evidence là message i18n của repo (`{ rank, i18n, en, params }`), không phải `{ rank, key }`, vì tiếng Anh nằm inline trong code.
> - Disk usage và What to delete dùng chung **một** analyzer (`scan`), vì hai màn là hai cách đọc cùng một lần duyệt. Tổng cộng 3 analyzer phục vụ 4 màn.
> - Mức tin cậy của advisor được gán theo bảng trong `analyzers/scan.js`. Không verdict dọn dẹp nào là `certain`; `certain` chỉ dành cho bản trùng đã so SHA-256.
> - Autoclean kiểm tra lại whitelist cứng trong `selectFiles`, và danh mục của `settings.js` được lấy từ chính whitelist đó.

**Quy tắc:**
- Một candidate thiếu `evidence` hoặc `confidence` bị `validateCandidate` từ chối. Không có đường nào để hiện một verdict "trần" không kèm bằng chứng.
- `unattendedEligible: true` chỉ hợp lệ khi `verdict === 'safe'` **và** category nằm trong danh sách trắng cứng trong `automatic/allowed-categories.js`. Lớp chạy tự động kiểm tra lại điều kiện này, không tin vào analyzer.

### 4.2. ActionKind pipeline

Mọi hành động, kể cả xoá, đi qua một executor chung.

```js
// src/main/actions/execute.js
const handlers = {
  recycle:    await import('./recycle.js'),
  quarantine: await import('./quarantine.js'),
  relocate:   await import('./relocate.js'),
  compress:   await import('./compress.js'),
  dehydrate:  await import('./dehydrate.js'),
  archive:    await import('./archive.js'),
  hardlink:   await import('./hardlink.js'),
  handoff:    await import('./handoff.js'),
};

export async function execute({ kind, items, options }, { signal, onProgress, lic, journal }) {
  const h = handlers[kind];
  if (!can(lic, h.feature)) return { refused: 'locked', feature: h.feature };

  // 1. Vetting — chung cho mọi kind, cộng thêm luật riêng của kind
  const { allowed, refused } = vetPaths(items, { allowFolders: h.allowsFolders });
  const extra = await h.vet?.(allowed, options) ?? { allowed, refused: [] };

  // 2. Probe quyền & file đang mở (dùng lại cơ chế hiện có)
  const { ok, needsAdmin, inUse } = await probe(extra.allowed);

  // 3. Xác nhận: handler cung cấp câu chữ, dialog là CHUNG
  const plan = h.describe(ok, options);  // { count, bytes, freesOnVolume, reversible, warnings[], etaMs }
  const confirmed = await confirmDialog(plan, { needsAdmin, inUse, refused: [...refused, ...extra.refused] });
  if (!confirmed) return { cancelled: true };

  // 4. Chạy tuần tự, từng mục một, ghi journal TRƯỚC khi báo thành công
  const session = journal.begin(kind, plan);
  const result = { done: [], failed: [], skipped: [] };
  for (const item of ok) {
    if (signal.aborted) { result.skipped.push(...ok.slice(result.done.length + result.failed.length)); break; }
    try {
      const rec = await h.apply(item, options);   // trả về bản ghi đủ để hoàn tác
      journal.record(session, rec);
      result.done.push(rec);
    } catch (err) {
      result.failed.push({ path: item.path, reason: classifyError(err) });
    }
    onProgress(progressOf(result, plan));
  }
  journal.end(session, result);
  return result;
}
```

> **✅ Đã code xong (2026-09-24).** Code ở `src/main/actions/` (`execute.js`, `handlers.js`, `recycle.js`), manifest IPC ở `src/main/ipc-manifest.js` (mục 4.8); harness `scripts/test-actions.js` và `scripts/test-ipc-manifest.js`. Khác với đặc tả ở trên:
> - Mới có handler `recycle`. Các kind còn lại bị `execute()` từ chối (`refused: 'unsupported'`) cho tới khi tính năng đặc tả chúng (B1–B5, F4, A1) được làm. Mỗi kind thêm vào chỉ là một dòng trong `handlers.js`.
> - Hộp thoại xác nhận là `ctx.confirm` do nơi gọi truyền vào: cửa sổ truyền dialog, lần chạy theo lịch không truyền gì. Vòng lặp từng mục nằm trong `executeTrash`, và hook `onItem` được await **trước** khi báo tiến độ. Nếu không ghi được bản ghi, cả lô dừng lại.
> - IPC `trash:delete`/`trash:cancel`/`trash:progress` đổi thành `action:execute`/`action:stop`/`action:progress`. Tên hàm ở preload giữ nguyên.
> - Sửa một lỗ hổng có sẵn: trước đây renderer gửi `{ confirm: false }` là bỏ qua được hộp thoại xác nhận. Giờ chỉ main process mới bật được (`ipc.allowUnconfirmedForHarness()`, do `smoke.js` gọi).
> - Autoclean cũng đi qua `execute()`.
> - ~~⚠️ Bảng bên dưới mâu thuẫn với B1/B2/B5.~~ **Đã sửa bảng (2026-09-24)**, theo quyết định cho B1: `quarantine` chỉ giải phóng khi bật "xoá bản gốc ngay"; `relocate` và `archive` giữ đúng đặc tả của chúng (bản gốc vào bin). `freesOnVolume(item, options)` nhận thêm `options` cho đúng việc này.
> - **Thêm ở I1 (2026-09-24):** handler có thêm `undo` (`locate`, `ready`, `putBack`): Restore Center dùng nó để tìm và đưa từng loại mục về. Có thêm handler `restore`. Nó không phải ActionKind trong contract (không candidate nào đề xuất nó), nhưng vẫn đi qua cùng pipeline và journal. Hộp thoại xác nhận có thể trả `{ approved, options }` thay vì `true`, và `options` của hộp thoại thắng `options` của request.
> - Chưa sửa (để B1 làm): `execute()` vẫn tính `freedBytes` cho cả lô theo `description.freesOnVolume` (`execute.js`), chưa cộng theo từng mục. B1 cần tính theo từng mục, vì một file đã copy xong mà xoá bản gốc thất bại thì không được tính là đã giải phóng.

Mỗi handler khai báo:

| Trường | Ý nghĩa |
| --- | --- |
| `feature` | Entitlement key |
| `allowsFolders` | Kind này có được áp dụng lên thư mục không (recycle: **không**, relocate/archive/compress: có) |
| `freesOnVolume(item, options)` | Có thực sự giải phóng dung lượng trên volume gốc không. **Đây là trường quyết định cột "Actually freed" trên Trends** |
| `reversible` | `'bin'` / `'journal'` / `'manual'` / `'none'` |
| `vet`, `describe`, `apply`, `undo` | Vòng đời của hành động |

**Bảng tổng hợp:**

| Kind | Giải phóng volume gốc? | Hoàn tác | Thư mục? | Gói |
| --- | --- | --- | --- | --- |
| `recycle` | Không (cho tới khi bin được làm trống) | Bin | Không | Free |
| `quarantine` | **Chỉ khi bật "xoá bản gốc ngay"**. Mặc định: không, vì bản gốc vào bin | Journal (chuyển về chỗ cũ) | Không | Pro |
| `relocate` | Không (bản gốc vào bin theo B2), cho tới khi bin được dọn | Journal | Có | Pro |
| `compress` | Có (một phần, sau khi đo) | Journal (giải nén) | Có | Pro |
| `dehydrate` | **Có**, nhưng do OneDrive thực hiện sau đó; con số là số đo được, không phải giả định | Tự động (OneDrive tải lại khi mở) | Có | Free |
| `archive` | Không (thư mục gốc vào bin theo B5), cho tới khi bin được dọn | Journal (giải nén về chỗ cũ) | Có | Pro |
| `hardlink` | Có | Journal (tách lại thành bản độc lập) | Không | Pro·Dev |
| `handoff` | Tuỳ công cụ đích; app **không** tự tính là đã giải phóng | Không áp dụng | — | Free |

### 4.3. Action Journal

Một file append-only, mỗi dòng là một JSON, xoay vòng theo tháng. Nó thay thế "record of what the app moved to the bin" hiện tại và mở rộng cho mọi kind.

```jsonc
// %APPDATA%\CleanDrive\journal\2026-09.jsonl
{"t":"2026-09-24T09:12:03.114Z","session":"s_8f2c","op":"begin","kind":"quarantine","count":412,"bytes":18923451234}
{"t":"...","session":"s_8f2c","op":"item","from":"C:\\Users\\a\\Downloads\\x.iso","to":"D:\\CleanDrive Quarantine\\s_8f2c\\000001.iso","bytes":4700000000,"sha256":"…","mtime":"…"}
{"t":"...","session":"s_8f2c","op":"end","done":410,"failed":1,"skipped":1,"freedOnSource":18800000000}
```

**Quy tắc:**
- Ghi dòng `item` **sau** khi thao tác thành công và **trước** khi cập nhật UI. Nếu tiến trình chết giữa chừng, journal vẫn phản ánh đúng những gì đã xảy ra.
- Mọi đường dẫn đích đều do app tự sinh ra, không bao giờ lấy từ nội dung file.
- Việc kiểm tra tính toàn vẹn của journal (H4) được thêm ở Giai đoạn 5 bằng hash chuỗi. Định dạng dòng đã chừa sẵn trường `prev` từ đầu.

> **✅ Đã code xong (2026-09-24).** Code ở `src/main/journal/journal.js`, ledger chạy trên journal ở `src/main/lib/ledger.js`; harness `scripts/test-journal.js`, cùng `verify-autoclean.js` chạy trên Recycle Bin thật và `smoke.js` e2e. Khác với đặc tả ở trên:
> - File đặt ở `userData\journal\` (`%APPDATA%\cleandrive\journal\` khi chạy từ source).
> - `trash-ledger.json` được import vào journal **một lần** rồi đổi tên thành `.migrated`. Purge 4 điều kiện vẫn dùng API ledger như cũ, chỉ khác là ledger giờ là lớp đọc trên journal: đã recycle trừ đi đã purge.
> - Purge cũng được ghi thành một session `kind: 'purge'`, nên journal có thêm kind này ngoài các ActionKind.
> - Journal giữ 13 file tháng (tháng hiện tại + 12 tháng trước), xoá cả file lúc app khởi động. Không bao giờ sửa một dòng.
> - `prev` chỉ được chừa chỗ, chưa ghi.
> - Việc journal sửa được (đo thật): (1) ledger cũ mất các entry của lần chạy 02:00 nếu cửa sổ mở qua đêm; (2) ledger cũ đóng dấu cả lô bằng một mốc thời gian, nên lô xoá dài hơn 5 phút không bao giờ purge được. Journal ghi mốc thời gian từng mục.
> - Race có thật trên Windows: hai `rename` đồng thời trên cùng một file đều "thành công", nên việc giành quyền migrate dùng file khoá tạo độc quyền (`wx`).
> - Đo được: 2 tiến trình cùng ghi 4.000 dòng vào một file, không mất dòng nào, không dòng nào bị rách.

### 4.4. Entitlements

```js
// src/main/license/entitlements.js
export const FEATURES = Object.freeze({
  'free':               { tier: 'free' },
  'pro.scan.multiroot': { tier: 'pro' },
  'pro.scan.mft':       { tier: 'pro' },
  'pro.diff':           { tier: 'pro' },
  'pro.planner':        { tier: 'pro' },
  'pro.quarantine':     { tier: 'pro' },
  'pro.relocate':       { tier: 'pro' },
  'pro.compress':       { tier: 'pro' },
  'pro.archive':        { tier: 'pro' },
  'pro.apps.lastused':  { tier: 'pro' },
  'pro.games':          { tier: 'pro' },
  'pro.chat':           { tier: 'pro' },
  'pro.photos':         { tier: 'pro' },
  'pro.dupes.advanced': { tier: 'pro' },
  'pro.reports':        { tier: 'pro' },
  'pro.automatic.profiles': { tier: 'pro' },
  'pro.dev':            { tier: 'pro', addon: 'dev' },
  'biz.cli':            { tier: 'business' },
  'biz.policy':         { tier: 'business' },
  'biz.console':        { tier: 'business' },
  'biz.audit':          { tier: 'business' },
});

export function can(lic, feature) {
  if (feature === 'free') return true;
  const f = FEATURES[feature];
  if (!f) throw new Error(`unknown feature ${feature}`);   // gõ sai key thì fail to, không âm thầm false
  if (lic.state === 'trial' || lic.state === 'active') {
    if (f.tier === 'business') return lic.tier === 'business';
    if (f.addon) return lic.addons?.includes(f.addon) || lic.tier === 'business';
    return lic.tier === 'pro' || lic.tier === 'business';
  }
  return false;
}

/** Hết hạn => chỉ đọc. Dữ liệu cũ (snapshot, báo cáo, journal) vẫn xem được. */
export const canRead = (lic, feature) => can(lic, feature) || lic.state === 'expired';
```

**Quy tắc:**
- `can()` chỉ chạy ở main process. Renderer chỉ nhận được `{ feature, allowed, reason }` để vẽ UI.
- Bản dev có biến môi trường `CLEANDRIVE_ENTITLEMENTS=all` để bật mọi tính năng. Bản release bỏ qua biến này (xem 7.8).
- **Restore Center, confirmation, cảnh báo cloud và Action Journal không bao giờ đi qua `can()`.**

> **✅ Đã code xong (2026-09-24).** Code ở `src/main/license/entitlements.js` (`FEATURES`, `can`, `canRead`, `forRenderer`), `src/main/license/state.js` (`currentLicense`, `canNow`) và `src/main/build-info.js`; harness `scripts/test-entitlements.js` (ma trận 84 ô theo mục 6). Khác với đặc tả ở trên:
> - Kênh build được quyết định bởi file `build-info.json`: `npm run build` ghi nó ra rồi xoá ngay sau khi đóng gói (`CLEANDRIVE_CHANNEL`, mặc định `stable`). Chạy từ source không có file này nên là kênh `dev`.
> - Ở kênh `dev`, mặc định bật tất cả. `CLEANDRIVE_ENTITLEMENTS=free|pro|pro+dev|business|all` dùng để thu hẹp khi test. Ở `stable`/`beta` biến này bị bỏ qua hoàn toàn, và license là `free` vì chưa có kho license (Giai đoạn 6).
> - `can()` đã được gắn vào registry analyzer và pipeline `execute()`. Renderer chỉ nhận `license:entitlements` dạng `[{ feature, allowed, reason }]`.
> - Harness kiểm tra tĩnh rằng journal, ledger, purge, trash, handler recycle và hộp thoại xác nhận **không hề nạp** module license.
> - ~~⚠️ Cần quyết định trước tính năng Pro đầu tiên.~~ **Đã chốt (2026-09-24): mở cho mọi người** ở `stable` trước Giai đoạn 6. Code (`license/state.js` cho kênh không phải `dev`) sẽ đổi cùng tính năng Pro đầu tiên (A5). Giai đoạn 6 phải tính tới việc khoá lại thứ đã mở.
> - **Đã đổi ở A5 (2026-09-25):** kênh không phải `dev` chạy với Pro `active` (`OPEN_PRO`, `source: 'open'`), Pro·Dev và Business vẫn khoá.

### 4.5. Elevated Helper

| Thuộc tính | Giá trị |
| --- | --- |
| Tiến trình | `cleandrive-helper.exe` riêng, được khởi chạy qua UAC (`runas`) chỉ khi người dùng bấm một hành động cần quyền admin |
| Giao tiếp | Named pipe với ACL chỉ cho SID của người dùng hiện tại; có nonce một lần do tiến trình chính sinh ra |
| Thao tác | Danh sách cố định, **chỉ đọc**: `system.breakdown`, `mft.enumerate`, `usn.query`, `prefetch.list`, `shadowstorage.query`, `dism.analyze` |
| Vòng đời | Thoát sau 5 phút không có request, hoặc khi app đóng |
| Không làm | Không xoá, không ghi, không chạy lệnh tuỳ ý. Mọi thay đổi hệ thống đều là `handoff` sang công cụ Windows |

[Unverified] Việc đọc MFT từ Node thuần có thể không đủ nhanh, và có thể cần một addon native (N-API) tự viết. Điều này chạm vào quy tắc hạn chế dependency. Đề xuất: viết addon trong repo (không phải dependency bên ngoài), và giữ harness so sánh với cách duyệt thường giống như cách đã làm với `mammoth`.

> **✅ Đã code xong (2026-09-24), trừ bước bấm UAC thật.** Code ở `src/main/helper/` (`protocol.js`, `ops.js`, `helper-process.js`, `client.js`) và nhánh `--helper` trong `main.js`; harness `scripts/test-helper.js` (pipe thật, tiến trình thật, không nâng quyền) và `scripts/verify-helper.js` (Electron thật). Khác với đặc tả ở trên:
> - **Không có `cleandrive-helper.exe` riêng.** Helper chính là `CleanDrive.exe --helper --pipe <tên> --nonce <hex>`: không thêm binary, không cần toolchain build exe, và dùng chung chữ ký số với app (mục 8.1 cũng đơn giản đi).
> - **App là pipe server, helper là client.** Node không đặt được ACL cho named pipe. Thêm nữa, pipe do tiến trình elevated tạo sẽ mang nhãn High integrity, và tiến trình thường không ghi lên được.
> - Nonce 32 byte chỉ đi qua command line. Trên pipe, hai bên trao đổi `HMAC(nonce, vai trò + challenge)`, không bên nào gửi nonce. Client lạ chiếm pipe trước sẽ bị đá ra. Nếu server giả chiếm tên pipe, helper bỏ đi mà không trả lời gì (có test). Sau khi helper vào, pipe ngừng nhận kết nối.
> - Danh sách thao tác trong Giai đoạn 0 chỉ có `ping` (pid + integrity level của chính helper). `system.breakdown`, `shadowstorage.query`, `dism.analyze` đi cùng A1; `mft.scan` đi cùng A2 (`usn.query` đã bỏ); `prefetch.list` đi cùng D1. Harness đọc `ops.js`, `system/walk.js`, `lib/real-fs.js`, `system/mft.js`, `system/ntfs.js` và `system/mft-wire.js`, fail nếu xuất hiện API ghi/xoá/chạy lệnh, và đòi mọi `open(` phải kèm cờ `'r'`.
> - Sửa trong lúc test: mọi exe mà helper (elevated) hoặc bước bật UAC gọi tới đều dùng **đường dẫn tuyệt đối trong System32**. Trên máy này PATH có `whoami.exe` của Git đứng trước bản Windows. Với một tiến trình admin, đó là lỗ hổng chiếm quyền qua PATH.
> - Helper tự thoát khi app đóng pipe, khi 5 phút không có yêu cầu, hoặc khi nhận được thứ không phải yêu cầu hợp lệ.
> - Chưa có IPC `helper:request` cho renderer: nó đi cùng nút "Đo với quyền quản trị" của A1, để UAC chỉ bật khi có cú click.
> - ~~⚠️ Chưa kiểm chứng: bước nâng quyền thật qua UAC.~~ **Đã kiểm chứng (2026-09-24), do người bấm:** `npm run verify:helper -- --elevated` → `main.js routed --helper to the helper, inside Electron` (`{"integrity":"high","elevated":true}`), ALL PASS.

### 4.6. Snapshot Store

Mỗi lần quét lưu một snapshot đã nén của cây thư mục, dùng cho A5 (diff), G1 (planner) và G3 (recap).

```jsonc
// %LOCALAPPDATA%\CleanDrive\snapshots\<rootHash>\2026-09-24T09-00-00Z.json.gz
{
  "v": 1,
  "root": "C:\\Users\\a",
  "volume": "C:",
  "takenAt": "2026-09-24T09:00:00Z",
  "scanner": "walk",            // 'walk' | 'mft'
  "excluded": 14,               // số vị trí hệ thống bị bỏ qua
  "tree": [                     // chỉ lưu thư mục + top-N file lớn mỗi thư mục, không lưu mọi file
    ["Downloads", 48213412134, 1203, [["x.iso", 4700000000, "2026-09-01T..."]]],
    ["Downloads\\setup", 1203412312, 44, []]
  ]
}
```

**Quy tắc:**
- Mặc định giữ 12 snapshot mỗi gốc, cộng một snapshot mỗi tháng trong 12 tháng. Có thể chỉnh trong Settings.
- Chỉ so sánh các snapshot **cùng gốc, cùng scanner, cùng quy tắc loại trừ**. Nếu khác, diff báo *"không so được vì …"*, giống cách Trends từ chối đưa ra dự đoán.
- Snapshot chứa tên file, tức là dữ liệu nhạy cảm. Chúng không bao giờ rời máy, trừ khi người dùng tự export.

> **✅ Đã code xong (2026-09-24).** Code ở `src/main/snapshots/store.js` (`SnapshotStore`, `comparable`, `selectRetained`) và tuỳ chọn `collectTree` trong `src/main/lib/scanner.js`; harness `scripts/test-snapshots.js` (thêm `--measure <thư mục>` để đo trên thư mục thật), cộng thêm kiểm tra trong `smoke.js`. Khác với đặc tả ở trên:
> - Mỗi dòng `tree` là `[đường dẫn tương đối, bytes, số file, [[tên, size, mtimeMs], …]]`. `bytes` là dung lượng thư mục **tự chứa**, tổng cả cây con là tổng các thư mục con cháu, nên không lưu trùng. Chỉ thư mục có file mới có dòng. File lớn là file ≥ 10 MB, tối đa 10 file mỗi thư mục.
> - Có thêm `complete` (lần quét bị dừng vẫn được lưu, đánh dấu `false`) và `rules`: hash của các quy tắc bỏ qua (hidden, system, noise, symlink, maxDepth). `comparable()` từ chối khi khác gốc, khác scanner hoặc khác `rules`; với lần quét dở thì cho so nhưng nhãn là `guess`.
> - Có `index.json` cho từng gốc; mất hoặc hỏng thì dựng lại từ các file. Chính sách giữ bản: 12 bản mới nhất + bản mới nhất của từng tháng trong 12 tháng (≤ 24 file mỗi gốc). Giá trị giữ bản được đọc lại mỗi lần lưu, và 0.7 đưa nó vào Settings.
> - Snapshot nằm ở `%LOCALAPPDATA%\<tên app>\snapshots\`. Khi harness chuyển `userData` vào thư mục tạm, snapshot tự đi theo vào `<userData>\local\` (`localDataDir()` trong `services.js`), nên smoke test không bao giờ ghi vào profile thật (có kiểm tra).
> - Cây chỉ ở lại main process, không gửi sang renderer (có kiểm tra).
> - ~~Chưa có IPC `snapshot:list`/`snapshot:diff`: chúng đi cùng A5.~~ Đã có từ A5 (2026-09-25). `rules` còn chứa `SCANNER_REVISION`, để thay đổi cách đếm của scanner không bị đọc thành tăng trưởng.
> - Đo thật: `D:\personal_projects` (15.350 file, 5.960 thư mục, 6,3 GB) → 3.744 dòng, snapshot **30,7 KB** sau gzip. [Inference] Với 500 nghìn file thì cỡ vài trăm KB. Con số này là ngoại suy, chưa đo.

### 4.6b. Settings schema v2 (hạng mục 0.7)

> **✅ Đã code xong (2026-09-24).** Code ở `src/main/lib/settings.js` (`SCHEMA_VERSION = 2`, `MIGRATIONS`, `migrate()`), card "Scan history" trong tab Settings (`src/renderer/snapshots.js`); harness `scripts/test-settings-migration.js`, cộng thêm kiểm tra trong `smoke.js`.
> - Migration chạy trên JSON đã parse, **trước** bước coerce, nên mọi giá trị do migration tạo ra vẫn qua cùng các giới hạn (clamp) như giá trị gõ tay. Migration chỉ đi tiến; file không có `version` được coi là v1.
> - v1 → v2 chỉ thêm section `snapshots: { keepRecent: 12, keepMonthly: 12 }` (1–100 và 0–60). Snapshot store đọc lại giá trị này mỗi lần lưu.
> - Lần lưu đầu tiên đè lên file đời cũ sẽ giữ bản gốc thành `settings.v1.json` (một lần, không ghi đè về sau). Chỉ load thì không ghi gì.
> - File do bản mới hơn ghi ra thì đọc phần hiểu được, kèm cảnh báo.
> - **Test hạ cấp thật:** harness lấy `settings.js` của commit HEAD (bản 0.1.15 đang phát hành) cho đọc file v2. Mọi cấu hình, kể cả autoclean, đều được giữ nguyên.

### 4.7. Thành phần giao diện dùng chung

| Thành phần | Dùng ở |
| --- | --- |
| `CandidateList` | Danh sách ảo hoá, có checkbox, shift-select, cột tuỳ chọn, các nút View/Reveal/Open |
| `EvidencePanel` | Liệt kê bằng chứng theo thứ tự rank, kèm từ chỉ độ tin cậy |
| `ActionBar` | Thanh nổi: `n selected · size`, các nút hành động theo `actions[]` của candidate, nút bị vô hiệu khi không hợp lệ |
| `FreesBadge` | Nhãn trên mỗi nút hành động: **"Giải phóng ổ C"** hoặc **"Chưa giải phóng — vào thùng rác"** |
| `UpgradeHint` | Dòng chữ nhỏ, **không phải modal**, xuất hiện khi chạm giới hạn Free (xem 7.4) |
| `RefusalNote` | Giải thích "vì sao không có con số" (diff, trend, planner) |

> **✅ Đã code xong (2026-09-24).** Code ở `src/renderer/components.js` (`CandidateList`, `EvidencePanel`, `ActionBar`, `FreesBadge`, `UpgradeHint`, `RefusalNote`) và `src/renderer/candidates.js` (chiếu candidate thành dòng hiển thị); kiểm tra trong `smoke.js` (mục "Shared components"), ảnh chụp bằng `npm run shoot:lists`.
> - Disk usage, What to delete và Duplicates đều dùng `CandidateList`. Có: shift-click chọn cả dải (trước đây chỉ Photos có), bàn phím (↑/↓, Space, Shift+↑/↓, Enter mở viewer), `aria-setsize`/`aria-posinset`, và cửa sổ hoá khi quá 200 dòng. Smoke đo được: 5.000 dòng chỉ vẽ 32; ngoài màn hình thì vẽ 0; cuộn tới đâu vẽ tới đó.
> - Photos giữ lưới ảo hoá riêng (là lưới, không phải danh sách), nhưng đọc dữ liệu từ candidate và có `FreesBadge`.
> - `EvidencePanel` mở ra khi bấm pill trên dòng: `safe · strong evidence`, hoặc chỉ mức tin cậy trong nhóm đã ghi verdict. Bản trùng có `oldest · certain`, `identical · certain`, `in use · strong evidence`.
> - `ActionBar` là thanh nổi đáy (dùng lại pattern `.actionbar` của Photos), chỉ hiện khi có chọn. Nút hiển thị là phần giao của `actions` của **mọi** dòng đang chọn. Id các nút xoá giữ nguyên.
> - `FreesBadge` đặt cạnh mọi nút hành động: *"Not freed until the bin is emptied"*. Cùng đợt này sửa câu chữ trái quy tắc 2 ở nhiều chỗ: toast sau khi xoá ("{size} freed" → "không giải phóng cho tới khi dọn bin"), câu mở đầu hộp thoại xác nhận ("This frees {size}"), bảng tiến độ, và câu "moved ≠ freed" vốn chỉ màn Photos có giờ áp dụng cho mọi lần xoá theo `freesOnVolume`.
> - `UpgradeHint` trả `null` khi tính năng được phép, **hoặc khi chưa đọc được entitlements** ("không chắc thì không quảng cáo"). Nó không có API nào gắn được vào dialog/toast. Hiện chưa có chỗ nào dùng vì chưa có tính năng Pro.
> - `RefusalNote` đã có, sẽ dùng từ A5/G1.
> - Sửa kèm, đều thấy qua ảnh chụp: toast đè lên thanh nổi (giờ đẩy lên trên); thanh nổi tràn ra ngoài và mất nút xoá ở cửa sổ 700px (giờ xuống dòng); dòng meta của bản trùng "in use" in ra `[object Object]` (lỗi có sẵn); bảng tiến độ có chữ "of" tiếng Anh viết cứng; file xoá từ Largest files vẫn nằm trên danh sách.

### 4.8. IPC — nguyên tắc bổ sung

README hiện có 50 thao tác cố định. Các thao tác mới được đặt tên theo namespace và được liệt kê trong `src/main/ipc/manifest.js`. Một harness kiểm tra rằng renderer không gọi được thao tác nào ngoài manifest.

```
analyzer.run / analyzer.stop
action.plan / action.execute / action.stop
journal.sessions / journal.restore
snapshot.list / snapshot.diff
license.state / license.activate / license.deactivate
commerce.plans / commerce.checkout / commerce.status
helper.request
```

### 4.9. Chiến lược kiểm thử

| Loại | Nội dung |
| --- | --- |
| **Fixture ổ đĩa** | Script tạo VHDX thật (qua `diskpart`, cần quyền admin trên máy CI) chứa cây thư mục mẫu, file có ADS, file nén, placeholder OneDrive giả lập, junction |
| **Harness theo analyzer** | Mỗi analyzer một file `scripts/analyzer-<id>.mjs`. Harness kiểm tra verdict, confidence và evidence cho từng fixture |
| **Harness theo action** | Với mỗi kind: apply → kiểm tra trạng thái đĩa → undo → so hash |
| **Harness "phía kẻ tấn công"** | Mở rộng từ harness purge hiện có: journal bị sửa tay, đường dẫn đích trỏ ra ngoài quarantine, symlink được cài vào giữa chừng |
| **E2E** | Như hiện tại: boot app, click chính các nút của app, đọc DOM |
| **Thương mại** | Toàn bộ luồng trial → mua (mock) → kích hoạt → hết hạn → gia hạn → bỏ kích hoạt |

---
## 5. Đặc tả chi tiết từng tính năng

### Nhóm A — Nhìn thấy toàn bộ ổ đĩa

#### A1. Bóc tách dung lượng hệ thống

| | |
| --- | --- |
| **Gói** | Free · `free` (xem và handoff). Quét sâu cần helper admin, vẫn Free |
| **Đối tượng** | P1, P4 |
| **Vấn đề** | Quét `C:\` báo thiếu vì vùng hệ thống bị loại trừ. Người dùng thấy "ổ 238 GB, đã dùng 220 GB, app chỉ thấy 140 GB" và mất niềm tin vào app |
| **Màn hình** | Màn mới **"Hệ thống"**, đặt giữa Disk usage và What to delete |

**Các mục cần giải thích:**

| Mục | Cách đo | Hành động | Ghi chú |
| --- | --- | --- | --- |
| `hiberfil.sys` | Kích thước file (đọc metadata, không mở file) | `handoff`: hướng dẫn `powercfg /hibernate off` hoặc `/type reduced`, kèm giải thích hệ quả (mất Hibernate, ảnh hưởng Fast Startup) | App không tự chạy lệnh |
| `pagefile.sys`, `swapfile.sys` | Kích thước file | `handoff`: mở System Properties → Virtual Memory | Verdict `keep`, tin cậy `certain`. Chỉ giải thích, không khuyến nghị tắt |
| Restore points / Shadow copies | `vssadmin list shadowstorage` (helper) | `handoff`: mở System Protection | [Unverified] Cần kiểm tra định dạng output theo ngôn ngữ hệ thống |
| WinSxS | `DISM /Online /Cleanup-Image /AnalyzeComponentStore` (helper) | `handoff`: hiện lệnh `StartComponentCleanup`, không tự chạy | Hiện **"dung lượng thực"** do DISM báo, không hiện kích thước thư mục, vì WinSxS dùng hardlink nhiều |
| `Windows.old` | Kích thước thư mục (helper) | `handoff`: Storage Sense → *Previous Windows installation(s)* | Cảnh báo: sau khi xoá sẽ không quay lại bản Windows trước được |
| Windows Update cache (`SoftwareDistribution\Download`) | Kích thước thư mục | `handoff`: Disk Cleanup | |
| Delivery Optimization cache | Kích thước thư mục | `handoff`: Settings → Delivery Optimization | [Unverified] Cần xác minh đường dẫn cache trên các bản Windows |
| DriverStore (driver cũ) | `pnputil /enum-drivers` (helper) | `handoff` | Chỉ liệt kê, verdict `review`, tin cậy `likely` |
| Thùng rác | Kích thước `$Recycle.Bin` theo từng người dùng | `handoff`: mở Recycle Bin | Tách riêng phần app đã chuyển vào bin (lấy từ journal) và phần người dùng tự xoá |
| Dung lượng NTFS dành riêng, metadata | Tổng volume trừ phần đã giải thích | Không có hành động | Hiện dòng **"Chưa giải thích được"** |

**Giao diện:**
- Một thanh tỷ lệ ngang cho toàn bộ volume: *Thư mục người dùng · Hệ thống (đã giải thích) · Trống · Chưa giải thích được*.
- Mỗi mục là một thẻ gồm dung lượng, giải thích bằng một câu, hậu quả nếu xử lý, và nút handoff.
- Chưa có quyền admin thì hiện *"Cần quyền quản trị để đo mục này"*, kèm nút **Đo với quyền quản trị** (UAC). Không tự bật UAC.

**An toàn:** app không bao giờ tự thay đổi hệ thống. Mọi mục đều có `unattendedEligible: false`.

**Trường hợp biên:** máy có nhiều bản Windows, BitLocker đang mã hoá dở, Storage Spaces, ổ ReFS (không có MFT).

**Kiểm thử:** `scripts/analyzer-system.mjs` kiểm tra với fixture output của `vssadmin`/`DISM` ở cả tiếng Anh lẫn tiếng Việt.

**Hoàn thành khi:** trên ba máy test thật, dòng "Chưa giải thích được" nhỏ hơn một ngưỡng đo được và ghi vào báo cáo harness.

> **✅ Đã code xong (2026-09-24).** Code ở `src/main/system/` (`walk.js` đi hết ổ chỉ để cộng dung lượng, `parse.js` đọc output của công cụ Windows, `breakdown.js` xếp từng byte vào một dòng, `measure.js` là trình tự chung cho IPC và harness), `src/main/analyzers/system.js`, `src/main/actions/handoff.js`, `src/main/lib/real-fs.js`. Helper có thêm op `system.breakdown`, `shadowstorage.query`, `dism.analyze`, `ntfs.info`, `storagereserve.query`. IPC mới: `system:facts`, `system:measure`, `system:measureElevated`, `system:cancel`, `system:handoff`, sự kiện `system:progress`. Màn hình ở `src/renderer/system.js`. Harness: `scripts/test-system.js` (58 kiểm tra; parser chạy trên output thật), phần mới trong `test-helper.js`, 15 kiểm tra mới trong `smoke.js` cho màn System (một "ổ" giả, và một helper giả trả về output thật đã ghi) và 3 cho `.asar`, `scripts/capture-system.js` (ghi fixture, cần UAC), `scripts/verify-system.js` (ổ C: thật; thêm `--elevated` cho lượt có UAC), ảnh chụp bằng `scripts/shoot-system.js`.
>
> **Đo thật trên máy test (máy duy nhất; ổ C: 475 GiB, dùng 413 GiB):**
> - Chưa có quyền admin: chưa giải thích được **35,5 GiB = 8,6%** dung lượng đang dùng, chủ yếu nằm trong 153 thư mục bị từ chối.
> - Sau lượt có admin, chạy qua đúng đường của nút trong app (người dùng bấm UAC): **1,4 GiB = 0,33%**. 11 thư mục vẫn bị từ chối kể cả với admin, trong đó có System Volume Information.
> - Đi hết ổ: 1,11 triệu tệp mất 73–135 s, tuỳ cache của đĩa. 152 thư mục bị từ chối, đo lại có admin mất 14 s. DISM mất 80 s.
> - **Ngưỡng đã chốt (2026-09-24):** chưa giải thích được ≤ **1% dung lượng đang dùng**, tính sau lượt có admin. Ngưỡng này đủ rộng cho tệp tạm sinh ra và mất đi trong lúc đi ổ. Nó vẫn bắt được mọi lỗi bỏ sót cả một khối: lỗi OneDrive vừa sửa lớn cỡ 3%. `verify-system.js --elevated` kiểm tiêu chí này (mặc định 1%, đổi được bằng `--threshold <n>`). Máy test đạt 0,33%.
>
> **Khác đặc tả ở trên:**
> - **Thêm dòng** (đã duyệt): chương trình đã cài (Program Files và WindowsApps), ProgramData, phần còn lại của Windows, phần bị các lần quét khác bỏ qua (thư mục tên bắt đầu bằng `.`/`$`, `node_modules`, `.git`…; ở máy này là 28,2 GB, riêng `.ollama` 14,3 GB), tài khoản khác, thư mục ở gốc ổ (có tên từng thư mục). Thêm cả bộ đệm Windows Installer (11,1 GB ở đây), Recovery (5,2 GB), phần sót lại của nâng cấp, MFT, reserved storage (chỉ hiện khi có phần giữ trống) và System Volume Information.
> - **Không có `helper:request` dạng chung** (đã duyệt): cửa sổ chỉ gọi được "đo" và "đo với quyền quản trị". Helper chỉ chạy công cụ trong một bảng cố định: exe trong System32, tham số là hằng số, ký tự ổ lấy từ `SystemDrive`. Nó chỉ trả tổng dung lượng, không trả tên tệp. `test-helper.js` đọc mã nguồn các file chạy với quyền admin để kiểm điều này.
> - `hiberfil.sys`/`swapfile.sys` lấy kích thước qua `dir /a /-c`, vì `fs.stat` bị EPERM. Trên máy này `pagefile.sys` nằm ở D:, nên không có dòng này cho C:.
> - Điểm khôi phục lấy con số "allocated" của vssadmin (8,90 GiB), không lấy "used" (8,60), vì allocated mới là phần ổ đã cấp ra. vssadmin và fsutil in số theo định dạng vùng (vi-VN: `8,60 GB`, `995.551.231`) dù chữ là tiếng Anh, nên parser đọc số theo hình dạng. DISM chạy với `/English`.
> - WinSxS lấy con số "actual size" của DISM. Phần chênh lệch được chuyển ra khỏi dòng "Windows", tổng không đổi. Lý do: walk chỉ đếm một lần các tệp có nhiều tên, ở chỗ nó gặp trước, nên con số WinSxS của walk phụ thuộc thứ tự đọc thư mục.
> - Reserved storage: [Inference, suy từ tài liệu của Microsoft] phần bị giữ trống = tổng của max(0, guarantee − used). Máy này có used lớn hơn guarantee, nên không có dòng này.
> - DriverStore chỉ đo kích thước thư mục, chưa dùng `pnputil` (dời lại). Windows.old không có trên máy này, nên dòng đó chỉ được kiểm bằng logic.
> - Thùng rác tách riêng phần app đưa vào (bản ghi của app đối chiếu với metadata của bin) để trỏ sang tab Khôi phục.
> - Thanh tỷ lệ có 5 phần thay vì 4: tệp của bạn, chương trình, Windows và hệ thống, trống, chưa giải thích được. Dùng các sắc độ của một màu accent, không dùng màu verdict.
> - Việc đi hết ổ chỉ chạy khi bấm nút, không tự chạy khi mở tab (mất cỡ 2 phút), và dừng được giữa chừng.
> - Handoff đi qua `execute()` và được ghi vào journal thành session `handoff` (ghi lại thứ đã mở). Không có hộp thoại xác nhận vì mở một trang cài đặt không thay đổi gì. Restore Center ẩn các session này. Các URI `ms-settings:` đã đối chiếu với trang "Launch Windows Settings" của Microsoft Learn; các exe đã đối chiếu với System32 của máy này.
> - Fixture: chỉ dùng output tiếng Anh thật (đã duyệt), gồm cả output lúc bị từ chối. Hai nhánh máy này không tạo ra được (reserve chưa đầy, không có shadow copy) dùng dữ liệu dựng, có ghi chú rõ trong test.
> - **Sửa hai lỗi có sẵn của scanner, tìm ra khi đo:**
>   1. `readdir` gắn cờ link cho **mọi** reparse point, nên thư mục OneDrive (reparse kiểu cloud, không phải link) bị bỏ qua toàn bộ. Trên máy này đó là 12,2 GiB, gồm cả Documents, Pictures và Desktop, khi quét thư mục Home.
>   2. Trong Electron, `fs` coi tệp `.asar` là thư mục, nên mọi `.asar` (VS Code, Zalo, Postman…) bị bỏ qua.
>
>   Cả hai sửa ở `lib/real-fs.js` (`entryKind()` hỏi lại `lstat`; dùng `original-fs`), có kiểm tra trong `test-system.js` và `smoke.js`.
> - Chưa kiểm được trên máy này: nhiều bản Windows, BitLocker đang mã hoá dở, Storage Spaces, ReFS (khi đó fsutil ntfsinfo sẽ báo không đọc được và dòng MFT ghi như vậy).

---

#### A2. Quét nhanh qua MFT / USN

| | |
| --- | --- |
| **Gói** | Pro · `pro.scan.mft` |
| **Đối tượng** | P1, P4, P5 |
| **Vấn đề** | Quét toàn ổ bằng duyệt thư mục chậm |

**Hành vi:**
1. Nếu volume là NTFS và người dùng đồng ý nâng quyền, helper liệt kê bản ghi qua `FSCTL_ENUM_USN_DATA` hoặc đọc `$MFT`, rồi dựng lại cây thư mục trong bộ nhớ.
2. Kết quả đi qua **cùng bộ lọc** như scanner thường (hidden, system, symlink/junction, dev noise), để hai scanner cho cùng một đáp án.
3. Lần quét sau dùng USN journal để chỉ cập nhật phần thay đổi (nếu journal còn liên tục). Nếu không, quét lại toàn bộ.

**Giao diện:** công tắc **Quét nhanh (cần quyền quản trị)** trên thanh chọn thư mục. Dòng trạng thái ghi rõ scanner nào đã được dùng.

**Trường hợp biên:** ổ FAT/exFAT/ReFS thì tự quay về duyệt thường và nói rõ lý do; file có nhiều hardlink được đếm một lần; file sparse và file nén dùng `bytesOnDisk`.

**Kiểm thử:** `scripts/scanner-parity.mjs` quét cùng một fixture bằng hai scanner, và kết quả phải khớp nhau về tổng byte, số file, top-50. [Unverified] Hiệu năng phải được đo và ghi lại, không được hứa hẹn con số cụ thể trong marketing trước khi đo.
> **✅ Đã code xong (2026-09-27).** Code nằm ở:
> - `src/main/system/ntfs.js` — hiểu byte: boot sector, fixup, FILE record, attribute, data run, `$ATTRIBUTE_LIST`, và `$REPARSE_POINT`.
> - `src/main/system/mft.js` — hiểu volume: `openVolume`, `locateMft`, `readRecords`, `collect`, `resolveFolderPaths`, `scanVolume`, `readVolume`.
> - `src/main/system/mft-walk.js` — bảng `$MFT` trở thành **nguồn** trả lời ba câu hỏi của `walk()`: `list(dir)`, `kind(entry)`, `stat(full, entry)`.
> - `src/main/system/mft-wire.js` — định dạng đi giữa hai tiến trình, **cả hai chiều trong một file**.
> - `src/main/system/mft-read.js` — nửa không cần quyền: `readElevated`, `sourceFor`.
> - `src/main/helper/ops.js` — op `mft.scan`; `protocol.js` + `client.js` + `helper-process.js` — giao thức nhiều mảnh.
> - `src/main/lib/scanner.js` — `walk()` nhận `source`, mặc định là hệ tệp thật; `ipc.js` — `prepareFastScan`, `whyNotFast`; `renderer/app.js` + `index.html` + `styles.css` — công tắc và dòng trạng thái.
>
> Harness: `test-ntfs.js` (55), `test-mft.js` (35), `test-mftwalk.js` (22, dựng cây thật trên `D:` rồi mô tả chính cây đó bằng một `$MFT` đọc ngược từ đĩa), `test-helper.js` (+16). `npm test` **2.065 kiểm tra, 46 bộ, 0 lỗi**. Ảnh chụp: `npm run shoot:fastscan`. Nửa cần admin: `npm run verify:mft -- --drive C --twice`.
>
> Khác với đặc tả ở trên:
> - **Không làm nhánh USN** (đã chốt). Đo được: `FSCTL_ENUM_USN_DATA` cũng bị từ chối khi không elevated, và **USN record không mang kích thước tệp**, nên nó chỉ thay được 9% công việc; 91% là `stat`. Mục 3 của đặc tả — quét lần sau chỉ cập nhật phần thay đổi qua USN journal — **chưa làm**, vì lý do đó.
> - **Công tắc chỉ hiện khi gốc là cả một ổ.** Lý do đo được: chi phí tỉ lệ với **ổ**, không phải với thư mục quét. `D:` có 516 k bản ghi trong bảng, còn walk cùng ổ đó chỉ liệt kê 192 k — walk bỏ qua `node_modules`, `.git`, thư mục ẩn, còn bảng mục lục thì không bỏ qua được gì. Quét một thư mục bằng `$MFT` là chậm hơn, và còn phải xin UAC để chậm hơn.
> - **Công tắc nằm cạnh nút Quét, không nằm trên thanh chọn thư mục** như đặc tả. Thanh đó hiện trên mọi màn, nơi công tắc này vô nghĩa; còn dòng trạng thái phải đọc kèm thì nằm ngay đây.
> - **Không có ratio trong bất cứ chỗ nào.** `$MFT` ổn định (C: 23,3 s, D: 5,4 s) còn walk dao động theo nhiệt độ cache (C: 44,2–144,8 s; D: 4,6–28,1 s) — tám lượt `verify:mft` có quyền quản trị. Câu duy nhất được nói là: **worst case của `$MFT` xấp xỉ best case của walk**.
> - **Bộ phân tích byte chạy trong tiến trình quyền quản trị** — trái với nguyên tắc `ops.js` tự viết cho `prefetch.list`. Người dùng chốt ngày 2026-09-27 sau khi cân nhắc. Không có đường vòng: `$MFT` chỉ đọc được qua `\\.\C:` (không admin = Win32 error 5, đo cả qua Node lẫn P/Invoke), và đẩy bảng thô ra ngoài để parse là 1,81 GB so với 112 MB dạng đã parse. Cái làm nó chấp nhận được là **nguồn dữ liệu**: `$MFT` là mục lục của chính volume, muốn đặt được một byte chọn sẵn vào đó thì đã phải ghi được raw volume, tức là đã là admin. Threat model viết trong header của `ops.js`. `test-helper.js` nay đọc cả `mft.js` và `ntfs.js`, và **siết chặt hơn chứ không nới**: `open(` không còn bị cấm thẳng mà bị đòi phải có cờ `'r'`.
> - **Giao thức helper nay gửi được nhiều mảnh** (`{ id, chunk }`), vì mọi bản ghi đều phải sang: bộ lọc nằm ở `walk()`, trong tiến trình không đặc quyền, nên helper không được phép lọc trước. Chọn dạng **cột**, đo trên 1,2 triệu tên/size/thời gian thật: cột 92,2 MB / 80,5 byte/tệp / 1.009 ms ghi + 581 ms đọc, còn mảng object 186,0 MB / 162,5 byte/tệp / 1.587 + 1.384 ms. **Trên bảng thật (2026-09-27, terminal quyền quản trị): C: 134,6 MB trong 298 mảnh, mảnh rộng nhất 542 KB, 117,7 byte/tệp, 3,7 s cả ghi lẫn đọc lại; D: 43,8 MB trong 97 mảnh, rộng nhất 518 KB, 89,0 byte/tệp, 0,9–1,1 s.** (Byte/tệp cao hơn ước lượng vì tên trên C: dài hơn mẫu dùng để đo.) Mảnh cắt theo **byte** (512 KB) chứ không theo số bản ghi, nên một ổ toàn tên 255 ký tự vẫn không dựng nổi một dòng quá `MAX_LINE_BYTES` (4.000 bản ghi tên dài nhất = 438 KB). Mảnh nào cũng reset timeout, nên deadline là *im lặng* chứ không phải tổng thời gian. `sendBackpressured` chờ `drain`, nên helper không chứa sẵn cả câu trả lời trong bộ nhớ.
> - **Sửa kèm, lỗi thật, mất 15 GB:** bản nháp của `mft-walk.js` gọi **mọi** reparse point là link (đọc bit `FILE_ATTRIBUTE_REPARSE_POINT`). Đó đúng là lỗi mà `lib/real-fs.js` được viết ra để chữa cho walk thường: `readdir` đánh dấu mọi reparse point là symlink, nhưng chỉ symlink và junction mới là link — thư mục OneDrive, từng tệp placeholder của nó, `CrossDevice` của Phone Link, `INetCache\Content.IE5` đều là reparse point *không phải* link. Comment trong `real-fs.js` ghi lần đo cũ: một lượt quét thư mục Home mắc lỗi này mất **cả OneDrive, khoảng 15 GB**, vì Windows đặt Documents, Pictures và Desktop ở đó. Sửa: `ntfs.js` đọc `$REPARSE_POINT` (0xC0) lấy tag, tag đi theo tới tận `MftEntry`, và chỉ `0xA000000C`/`0xA0000003` là link — đúng hai tag mà libuv coi là link. Kiểm: `test-mftwalk.js` dựng một junction **thật** trên `D:` (`fs.symlink(..., 'junction')` không cần admin) cộng hai mục mang tag cloud (tag là dữ liệu dựng — không script nào tạo được placeholder thật, và test ghi rõ điều đó). **Bỏ fix thì 8 kiểm tra fail và 15,7 MB trên 98,6 MB của fixture biến mất.**
> - **Bỏ một cái bẫy khác:** `mftSource.stat` từng có đường lui "tra theo thư mục vừa liệt kê gần nhất" cho lời gọi chỉ có đường dẫn. `walk()` chạy 16 thư mục cùng lúc, nên "gần nhất" là worker nào về sau — một tệp sẽ nhận kích thước của tệp khác. Đã xoá; không ai gọi kiểu đó.
> - **Hardlink đếm một lần** (theo đặc tả), còn walk thấy cả hai tên nên đếm hai. Lệch đúng theo đặc tả, ngược với parity. Ngoài `WinSxS` (walk đã loại) thì gần như không gặp; `verify-mft.js` để trong ngưỡng dung sai và README ghi rõ.
> - **`verify-mft.js` nay so qua `scan()`, không so danh sách thô.** Bản cũ phải tự biết walk sẽ bỏ qua những gì, nên mang theo một bản sao thứ ba của luật loại trừ — đúng thứ mà A2 sinh ra để chỉ có một bản. Đã xoá `walkWouldSkip`. Giờ hai bên cùng đi qua `scan()`: cùng walk, cùng bộ lọc, cùng advisor, khác mỗi nguồn. Harness còn so thêm `byType`, các nhóm verdict `safe`, số thư mục bị bảo vệ, và cho cả bảng đi qua đúng định dạng dây của helper rồi quét lần thứ ba.
> - **`pagefile.sys` / `hiberfil.sys` / `swapfile.sys`:** walk không `stat` nổi (EPERM) còn `$MFT` đọc được, nên `verify-mft.js` tách chúng ra **theo danh sách lỗi của walk**, không theo tên viết cứng. Đây không phải điểm cộng của A2: `analyzers/system.js` đã báo cáo chúng riêng từ A1.
> - **"Thời gian quét" ở ô thống kê nay cộng cả lượt đọc bảng mục lục.** `durationMs` trong snapshot thì không — nó là chuỗi số so giữa các lần quét, trộn hai scanner vào đó sẽ làm A5 so hai thứ khác nhau.
> - Ô "Quét nhanh" của Free bị khoá bằng `pro.scan.mft` ở main (`prepareFastScan` trả `locked` rồi quét thường), không phải bằng UpgradeHint ở cửa sổ: từ chối thì vẫn có kết quả, chỉ là kết quả của scanner kia.
>
> **Đo trên đĩa thật (2026-09-27, `verify:mft` trong terminal quyền quản trị):**
>
> | | C: | D: |
> | --- | --- | --- |
> | `$MFT` | 1,81 GB, 14 mảnh, 1.894.144 ô | 0,56 GB, 4 mảnh, 590.848 ô |
> | Đọc cả bảng | **23,5 s** · 1.198.835 tệp, 568.757 thư mục | **4,6–5,2 s** · 515.940 tệp, 74.118 thư mục |
> | Torn | **0** | **0** |
> | Bản ghi tràn sang record khác | 54.360, nối lại đủ 54.358 | 248, nối lại đủ 248 |
> | Quét xong (đọc + duyệt bảng) | 69,4 s (23,5 + 45,8) | 7,5–8,3 s (4,6–5,2 + 3,0) |
> | Walk cùng gốc | 86,5 s | 10,7–11,6 s |
> | Heap sau cả hai lượt quét | 508 MB | 114–140 MB |
> | Heap khi giữ cả hai bản sao của bảng | 683 MB | 152–176 MB |
>
> - **Parity:** C: +42 tệp / 0,09 GB trên 209 GB; D: **+1 tệp / +0,00 GB**. Số folder trùng khít cả hai ổ (C: 219.638 = 219.638; D: 32.884 = 32.884). Kích thước của mọi tệp lớn hai bên cùng thấy: trùng.
> - **Fix reparse point là có tải trên đĩa thật:** C: có **611 thư mục reparse point — 299 là link (junction/symlink), 312 là thứ khác**, mang tag `0x9000301a`, `0x9000601a`, `0x9000701a`, `0x9000e01a` (cloud placeholder). Bản đọc theo bit thuộc tính sẽ bỏ qua cả 312 thư mục đó. D: có 9, cả 9 đều là link thật.
> - **Lượt đọc thứ hai (cache nóng):** 28,4 s, lệch **2 tệp** sau 239 s — churn, không phải trình đọc trả lời khác.
> - `pagefile.sys` (D:, 29,00 GB), `hiberfil.sys` (C:, 6,29 GB), `swapfile.sys` (C:, 0,25 GB): walk không mở được, `$MFT` đọc được. Harness tách riêng **theo danh sách lỗi của walk**, không theo tên viết cứng.
>
> **Ba lần FAIL đầu tiên — harness sai, không phải trình đọc.** Cả ba cùng một nguyên nhân: harness đem so hai danh sách **đã bị cắt ngọn** giữa hai lượt quét nhìn thấy số tệp khác nhau. `scan()` chỉ trả về 100 tệp lớn nhất, 25 loại tệp lớn nhất, và `keepPerCategory` mặc định 100. Bên `$MFT` có thêm `pagefile`/`hiberfil`/`swapfile`, nên đúng bấy nhiêu mục rơi khỏi đáy mỗi danh sách:
> - `clang.exe`, `NoSQLBooster…exe` (C:), `PEAK_Data\level20` (D:) "chỉ walk thấy" — chúng rơi khỏi top-100 của bên `$MFT`. Đã kiểm: `clang.exe` có đúng **một** hardlink và không có tên 8.3, nên không phải lỗi hardlink cũng không phải lỗi 8.3.
> - `mov: 0,00 vs 0,93 GB` (C:), `resource: 0,00 vs 0,80 GB` (D:) — 6,5 GB `hiberfil`+`swapfile` dồn vào nhóm `sys` làm đổi hạng thứ 25.
> - Verdict `safe` lệch 3+3 ở một lượt D: — `keepPerCategory: 100` chạm trần.
>
> Sửa: hai scan chạy với `keepPerCategory: 1e6` (không còn trần), còn `largestFiles` và `byType` chỉ so **xuống tới mức mà cả hai danh sách đều còn nguyên** (lấy max của hai phần tử nhỏ nhất). Trên ngưỡng đó không danh sách nào bị cắt, nên lệch là lệch thật.
> **Sửa kèm, cũng là lỗi của tôi:** kiểm tra `--twice` đem `bytes` của cả volume so với `totalSize` của lượt quét đã lọc — 303 GB so với 215 GB, nên in ra "230.483.060.432 bytes different". Giờ so với tổng byte của chính bảng.
>> **Chưa làm / còn mở:**
> - **`verify:mft` đã chạy trên đĩa thật (2026-09-27, người dùng chạy trong terminal quyền quản trị).** Trình đọc không sai chỗ nào; **ba kiểm tra trong harness thì sai**, và đã sửa — xem mục "Ba lần FAIL đầu tiên" bên dưới.
> - Mục 3 của đặc tả (cập nhật tăng dần qua USN journal) chưa làm.
> - Chưa đo trên FAT/exFAT/ReFS thật — máy này không có. Đường quay về đã có code và có kiểm tra, nhưng `notNtfs` chưa lần nào chạy trên một ổ thật.
> - `$MFT` của C: tốn 710 MB heap ở phía helper cộng khoảng chừng đó ở phía app khi bảng đã sang. [Unverified] Chưa đo đỉnh bộ nhớ của cả hai tiến trình trong một lượt quét thật.
> - **Sửa 2026-10-01, lộ ra khi kiểm H1: công tắc Quét nhanh chưa từng đọc được bảng qua helper thật** (§11 mục 24). `verify:mft` đọc ổ **ngay trong tiến trình của nó, bằng Node 24 của hệ thống**, và chỉ *mô phỏng* wire; `shoot:fastscan` dùng helper giả. Helper thật chạy trong **Electron 33 (Node 20.18)**, ở đó `fs.open('\\.\D:')` qua `path.toNamespacedPath` thành `\\.\D:\` — **thư mục gốc của D:** — nên mở được mà không cần quyền admin, và mọi lần đọc là `EISDIR`. Cửa sổ lặng lẽ walk thay vào và ghi "không đọc được từ bảng mục lục". Sửa: `openVolume` đưa đường dẫn dưới dạng **Buffer** (không Node nào viết lại); helper Electron chưa nâng quyền nay bị từ chối `EPERM`, đúng là chính volume trả lời. Harness mới `npm run verify:mft-pipe`: **helper thật, named pipe thật**, bảng dựng sẵn 40.000 tệp (10 mảnh) và 520.000 tệp (129 mảnh, cỡ D:) qua cả helper Electron lẫn helper Node, cộng một phép kiểm không cần admin rằng helper Electron tới được thiết bị chứ không phải thư mục. Trên code cũ: `test-mft` FAIL 2, `verify:mft-pipe` FAIL 1 (`EISDIR`). **Đo trên D: thật qua helper thật** (người dùng chạy, quyền quản trị): 518.136 tệp trong **4,7 s** qua helper Electron, 4,2 s qua helper Node, cùng một bảng.


---

#### A3. Treemap / Sunburst

| | |
| --- | --- |
| **Gói** | Free (treemap cơ bản) · Pro `pro.scan.multiroot` (tô màu theo tuổi/loại, lọc) |
| **Đối tượng** | Tất cả |
| **Màn hình** | Tab con trong Disk usage: **Thanh · Treemap · Sunburst** |

**Hành vi:**
- Treemap theo thuật toán squarified, vẽ bằng Canvas 2D (không thêm dependency). Bấm vào ô để đi sâu, breadcrumb để đi lên.
- Tô màu: **theo loại file** (Free); **theo tuổi**, **theo verdict**, **theo nguồn gốc** (Pro).
- Hover hiện đường dẫn, dung lượng, số file và verdict nếu có. Chuột phải hiện View / Reveal / thêm vào lựa chọn.
- Ô quá nhỏ (dưới vài pixel) được gộp thành *"(n mục nhỏ)"*, không bị bỏ đi.

**Accessibility:** mọi thao tác trên treemap đều có tương đương trên danh sách. Treemap có vai trò `tree` với điều hướng bằng phím mũi tên.

> **✅ Đã code xong (2026-09-24).** Code ở `src/main/analyzers/scan-tree.js` (`ScanTree`: cây của lần quét cuối, giữ ở main process), `src/renderer/treemap-layout.js` (thuật toán squarified, nạp được cả trong trang lẫn trong harness), `src/renderer/treemap.js` (card "Dung lượng nằm ở đâu"), phần `treeFiles` trong `lib/scanner.js`, `fileCandidate` trong `analyzers/scan.js`. IPC mới: `scan:children`. Harness: `scripts/test-treemap.js` (48 kiểm tra), 25 kiểm tra mới trong `smoke.js` (mục "Map of the folder"), ảnh chụp `npm run shoot:treemap`. Khác với đặc tả ở trên:
> - **Không có Sunburst, không tô theo loại file** (đã chốt). Màu là các sắc độ của một màu accent, nhạt dần theo độ sâu. Ô gộp nhạt hơn nữa và có viền nét đứt. Phần tô màu Pro (theo tuổi, verdict, nguồn) và "lọc" dời lại. Đặc tả gắn chúng với key `pro.scan.multiroot`, nhưng đó là key của A4, nên khi làm lại cần một key riêng.
> - Tab con là **Bản đồ · Danh sách**, thay cho "Thanh · Treemap · Sunburst". Mặc định là Bản đồ, và app nhớ lựa chọn cuối cùng (localStorage). Danh sách là tương đương của bản đồ: cùng tầng, cùng cách đi sâu, cùng menu, và không còn chỉ là 12 thư mục ở tầng đầu.
> - **Cây không bao giờ sang cửa sổ nguyên vẹn.** `scan:children(treeId, rel)` trả về một thư mục và tối đa 3 tầng bên dưới, tối đa 1.500 nút, tối đa 300 thư mục mỗi tầng (phần dư gộp thành ô "(n thư mục khác)"), điền theo chiều rộng. Đo trên thư mục Home (377.710 tệp): cả cây là 5,3 MB JSON, reply cho tầng gốc là 101,6 KB. Dựng cây mất 738 ms và 20,1 MB heap; mỗi tầng mất tối đa 5,3 ms. [Đo bằng Node 24, chưa đo trong Electron.] Cửa sổ gọi thư mục bằng đường dẫn tương đối do main trả về, nên không có đường nào để thoát ra ngoài cây. Id của lần quét cũ bị từ chối (`ESTALE`).
> - **Tệp nào có ô riêng** theo đúng quy tắc của snapshot (≥ 10 MB, 10 tệp mỗi thư mục). Ở thư mục Home đó là 781 tệp, chiếm 78,4% dung lượng. Hạ ngưỡng xuống ≥ 1 MB chỉ lên được 84,8% mà số tệp tăng gấp 6, nên giữ nguyên. Phần còn lại của mỗi thư mục là một ô "(n tệp nhỏ hơn)". Ô nhỏ hơn 40 px² gộp thành "(n mục nhỏ)".
> - **Verdict trên ô tệp:** scanner giữ thêm verdict của các tệp có tên, nhưng chỉ trong bộ nhớ (`treeFiles`), nên định dạng snapshot không đổi. Ô tệp là candidate đã qua `validateCandidate`, cùng id với dòng tương ứng trong Largest files, nên "Thêm vào lựa chọn" dùng chung thanh chọn của Largest files.
> - Bấm vào ô thư mục thì đi sâu. Bấm vào ô tệp thì mở menu (Xem / Mở thư mục chứa / Thêm vào lựa chọn). Chuột phải mở menu cho cả thư mục (Mở thư mục này / Mở thư mục chứa). Tooltip hiện cả khi focus bằng bàn phím.
> - Bàn phím dùng role=tree trên một lớp phần tử đặt chồng lên canvas: ↑/↓ đi giữa các ô cùng cấp, → vào thư mục đang vẽ lồng (hoặc đi sâu thêm một tầng), ← ra ngoài, Enter mở thư mục hoặc xem tệp, Space chọn tệp, Backspace lên một tầng, phím menu hoặc Shift+F10 mở menu. Có đủ `aria-level`, `aria-setsize`, `aria-posinset`, `aria-expanded`, `aria-selected`.
> - **Sau khi xoá:** mỗi lần `action:execute` kind `recycle` thành công, dù gọi từ màn nào, main trừ các tệp đã chuyển đi khỏi cây trong bộ nhớ. Card ghi rõ "đã chuyển vào Thùng rác kể từ lần quét này… chưa giải phóng". Snapshot trên đĩa giữ nguyên. Khôi phục thì không cộng lại vào cây; muốn thấy lại thì quét lại.
> - Chưa làm: canvas chưa theo `forced-colors` (để I2 làm).
> - **Sửa kèm:** (1) "(no extension)" và chữ "files" ở By file type bị viết cứng tiếng Anh, vì tham số `t` của arrow function che mất hàm `t()` (`app.js`); `test:i18n` không bắt được lỗi này. (2) `scan:run` trước đây nhận options của scanner từ cửa sổ (đi theo symlink, bỏ loại trừ hệ thống…), dù cửa sổ chưa bao giờ dùng; giờ main không đọc options đó nữa. (3) Những lần IPC từ chối có chủ đích (`quiet`) không còn in stack trace vào log.

---

#### A4. Quét nhiều gốc, nhiều ổ, ổ ngoài, ổ mạng

| | |
| --- | --- |
| **Gói** | Pro · `pro.scan.multiroot`. Free vẫn quét một thư mục như hiện tại |
| **Đối tượng** | P1, P3, P4 |

**Hành vi:**
- Chọn nhiều gốc cùng lúc, hoặc **Toàn bộ ổ** (bao gồm cả vùng hệ thống nhờ A1).
- Ổ USB và ổ ngoài được nhận diện theo loại bus. Ổ mạng (UNC, ổ đã map) được hỗ trợ nhưng **không bao giờ dùng MFT**, và có cảnh báo rằng quét qua mạng chậm.
- Các gốc chồng lên nhau (ví dụ `C:\Users` và `C:\Users\a\Downloads`) được tự gộp lại để không đếm hai lần. UI báo rõ việc gộp này.

**Guard xoá:** giữ nguyên toàn bộ. Riêng ổ mạng thì thêm câu vào hộp thoại xác nhận: *"Ổ mạng thường không có Thùng rác. File sẽ bị xoá vĩnh viễn."* [Unverified] Hành vi recycle trên UNC phải được đo thật. Nếu không có bin, action `recycle` bị vô hiệu cho ổ mạng và chỉ còn `quarantine`.

> **✅ Đã code xong (2026-09-26).** Code nằm ở:
> - `src/main/lib/volumes.js`: loại ổ và bus, lấy qua CIM (`Win32_LogicalDisk` và `MSFT_Partition`/`MSFT_Disk`, 1,45 s kể cả lúc khởi động PowerShell; `Get-Partition | Get-Disk` mất 6,2 s), có cache 60 s.
> - `src/main/analyzers/scan-roots.js`: chuẩn hoá và gộp các gốc, ghép kết quả nhiều lần quét, tính ô "không quét ở đây", và `readOnlyCandidate`.
> - `MultiScanTree` và các tuỳ chọn `unscanned`/`readOnly` trong `scan-tree.js`.
> - `canonicalPath`/`isNetworkPath`/`adminShare` trong `lib/util.js`.
> - Trong `ipc.js`: `scan:run` nhận một mảng gốc, kênh mới `scan:drives` (manifest có 63 kênh), và `dupes:run` chuẩn hoá gốc giống lúc quét.
> - `renderer/roots.js`: nút "+ Thư mục", hộp "Toàn bộ ổ…", danh sách gốc có nhãn.
> - Ô `unscanned` trong `treemap.js`.
>
> Harness:
> - `scripts/test-roots.js` (58 kiểm tra, nằm trong npm test). Dùng fixture `scripts/fixtures/volumes/cim-nvme-and-card-reader.txt`, là output thật của máy này; ba dòng USB, ổ map và DVD là dữ liệu dựng và được ghi rõ trong test.
> - `scripts/test-multiroot.js` (30 kiểm tra, cửa sổ thật). "Toàn bộ ổ" thử trên một ổ `subst` thật. Ổ mạng thử bằng `\\<IP LAN của máy>\D$\…`, vì app không phân biệt được đó với share của một máy khác.
> - Ảnh chụp: `npm run shoot:multiroot`.
>
> Khác với đặc tả ở trên:
> - **Ổ mạng: chỉ đọc, không có quarantine** (người dùng chọn). **Đo được:** `shell.trashItem` trên `\\localhost\D$\…` bị từ chối ("Failed to perform delete operation", 187 ms) và tệp còn nguyên, trong khi cùng tệp đó qua đường dẫn cục bộ thì vào Thùng rác. Vì vậy dòng trên ổ mạng giữ verdict nhưng không có hành động nào, kèm một dòng bằng chứng. `trash.vet` cũng từ chối với mã `ENETWORK`, nên autoclean và quarantine đều bị chặn theo. Câu cảnh báo trong hộp xác nhận của spec không cần nữa. Duplicates bỏ qua gốc trên ổ mạng và nói rõ.
> - **Ổ rời (Removable) cũng chỉ đọc, cho tới khi đo được.** Máy này không có USB. Trước A4, app không kiểm loại ổ trước khi xoá, nên hành vi ở đó chưa ai biết. Ổ cứng gắn ngoài (Windows coi là `fixed`, bus USB) vẫn xoá như ổ nội bộ và chỉ được gắn nhãn "gắn ngoài". **Còn mở, người dùng tạm hoãn (2026-09-26):** đo Thùng rác trên ổ gắn ngoài bằng `npm run verify:external -- --drive X:`.
>   - Harness này đã chạy thử trên D: làm đối chứng: kết quả "recycled", bản ghi `$I` và `$R` đúng từng byte, dọn sạch.
>   - Thiết bị người dùng cắm vào là USB flash "PNY NAND Flash" (bus 7). Windows báo 0,0 GB, RAW, offline, không có phân vùng, nên không đo được. App không khởi tạo hay format nó.
> - **"Toàn bộ ổ" = quét như thường, cộng một ô "không quét ở đây"** (người dùng chọn), thay cho việc ghép phép đo của A1. Ô này bằng dung lượng đang dùng (statfs) trừ phần đã quét. Đây là số ước tính: ổ tính theo allocation, còn scan tính theo kích thước tệp. Bấm vào ô thì mở màn Hệ thống.
> - **Mỗi gốc vẫn được quét riêng**, nên history, snapshot và diff A5 theo từng gốc không đổi; chỉ phần hiển thị được ghép lại. Gốc nằm trong một gốc khác được quét cùng gốc đó, và dòng trạng thái lẫn nhãn của gốc đều báo việc gộp. Tối đa 12 gốc, quét lần lượt.
> - **Duplicates tìm trên mọi gốc cục bộ đã chọn** (người dùng chọn). Như vậy phần lõi "xuyên thư mục / xuyên ổ" của F1 đã có trước. Phần còn lại của F1 (tiêu chí chọn bản giữ theo ổ, hash qua mạng) vẫn ở Giai đoạn 3.
> - `pro.scan.multiroot` khoá gốc thứ hai và nút "Toàn bộ ổ…", cả ở cửa sổ (UpgradeHint) lẫn ở main (`ELOCKED`). Chọn `C:\` bằng hộp chọn thư mục vẫn là tính năng Free như trước.
> - **Sửa kèm, lỗ có từ trước:** `isProtectedPath` không nhận ra `\\?\C:\Windows`, `\\.\C:\…`, `\\?\UNC\…`, cũng như share quản trị của chính máy này (`\\localhost\C$\Windows`, `\\127.0.0.1\C$\Program Files`, `\\<tên máy>\C$\…`). Hệ quả là quét `\\máy\C$` sẽ đi vào thư mục Windows, và quarantine khi đã bật "Xoá bản gốc" có thể `unlink` qua UNC. Giờ `pathKey` chuẩn hoá các cách viết này. Share quản trị của máy khác (`\\pc\C$\Windows`) được bảo vệ theo đường dẫn tương đối.
>   - `SCANNER_REVISION` **không tăng**: thay đổi chỉ ảnh hưởng tới gốc là share quản trị của máy khác, còn tăng revision sẽ làm mọi snapshot cũ không so sánh được nữa. [Inference] Một diff A5 giữa hai lần quét share quản trị, một trước và một sau lần sửa này, sẽ báo "giảm" đúng bằng phần thư mục hệ thống. Tôi cho trường hợp đó là rất hiếm.
> - Tên ô gốc trên bản đồ là tên thư mục. Chỉ khi hai gốc trùng tên thì mới dùng đường dẫn đầy đủ.

---

#### A5. Snapshot diff — "Vì sao ổ đầy thêm?"

| | |
| --- | --- |
| **Gói** | Pro · `pro.diff` |
| **Đối tượng** | P1, P5, P6 |
| **Vấn đề** | Trends biết ổ đang tăng nhanh bao nhiêu, nhưng không biết **cái gì** đang tăng |

**Hành vi:**
1. Người dùng chọn hai snapshot của cùng một gốc. Mặc định là snapshot mới nhất và snapshot cách đó khoảng 7 ngày.
2. Kết quả gồm: thư mục tăng nhiều nhất, thư mục giảm, file lớn mới xuất hiện, file lớn biến mất.
3. Trends có liên kết: *"Ổ C tăng 6,2 GB trong 30 ngày → Xem cái gì đã tăng"*. Nếu không có snapshot phù hợp thì chuyển sang `RefusalNote`.

**Từ chối trả lời khi:**

| Tình huống | Câu hiển thị |
| --- | --- |
| Chỉ có một snapshot | "Mới quét một lần — cần ít nhất hai lần quét cùng thư mục." |
| Khác scanner / khác luật loại trừ | "Hai lần quét dùng cách đo khác nhau nên không so được." |
| Lần quét bị dừng giữa chừng | "Lần quét ngày … bị dừng sớm, so sánh sẽ sai lệch." (vẫn cho xem nhưng gắn nhãn `guess`) |

**Tự động:** có tuỳ chọn *"Chụp snapshot thư mục X mỗi tuần"*, chạy trong scheduled task hiện có (chỉ đọc).

> **✅ Đã code xong (2026-09-25).** Code ở `src/main/snapshots/diff.js` (`diffSnapshots`, `defaultPair`), IPC `snapshot:list` và `snapshot:diff` trong `ipc.js` (phần diff đi qua `can('pro.diff')`), card `src/renderer/changes.js` trong Trends, liên kết `renderChangesLink` trong `trends.js`, `SCANNER_REVISION` trong `lib/scanner.js`, và `license/state.js`. Harness: `scripts/test-snapshot-diff.js` (32 kiểm tra), 18 kiểm tra mới trong `smoke.js` (mục "What changed in a folder"), ảnh chụp `npm run shoot:changes`. Khác với đặc tả ở trên:
> - Là **một card trong Trends** (đã chốt), nằm ngay dưới "Folders, by how fast they grow". Mỗi thư mục trong danh sách đó đã được quét từ 2 lần trở lên có thêm link "What changed?".
> - **Thư mục tăng/giảm** không liệt kê theo từng thư mục, vì như vậy một con số sẽ lặp lại ở mọi cấp. Thay vào đó, thay đổi được chia thành những chỗ không chồng lên nhau, mỗi chỗ gọi tên ở thư mục sâu nhất còn giữ ít nhất một nửa thay đổi. Phép chia tính theo phần tệp *riêng* của từng thư mục, nên một tệp chuyển từ `Documents` vào `Documents\Archive` hiện ở cả hai phía. Bản đầu tính theo tổng và bỏ sót đúng trường hợp này; ảnh chụp đã bắt được lỗi đó. Tăng và giảm cộng lại đúng bằng thay đổi ròng (có test).
> - **Thêm hai mục đặc tả không có:** "tệp lớn đã tăng / đã nhỏ lại" (cùng đường dẫn, khác kích thước, ví dụ một tệp đĩa ảo phình ra) và "đã chuyển chỗ" (cùng tên, kích thước và mtime nhưng ở thư mục khác). Nhờ vậy một lần di chuyển không bị báo thành một tệp mất và một tệp mới.
> - **Quy tắc "biến mất":** chỉ gọi một tệp là biến mất khi lần quét **sau** lẽ ra đã ghi tên nó nếu nó vẫn ở đó với kích thước ấy: thư mục không còn tệp nào, danh sách chưa đủ 10, hoặc tệp lớn hơn tệp nhỏ nhất được giữ. "Tệp mới" dùng cùng quy tắc nhưng xét lần quét **trước**. Trường hợp còn lại ghi là "không rõ", kèm số tệp và dung lượng. Ghi chú audit trước đây đặt điều kiện "biến mất" lên "lần trước"; đã sửa lại cho đúng logic.
> - Mặc định chọn bản mới nhất (ưu tiên bản đã quét xong) và bản gần mốc 7 ngày trước nhất mà so được với nó. Card ghi khoảng cách thật giữa hai lần quét (phút, giờ hoặc ngày).
> - **Từ chối** theo bảng trên, thêm trường hợp "hai thư mục khác nhau". Nếu hai lần quét dùng quy tắc chọn tệp lớn khác nhau thì vẫn so thư mục nhưng không so tệp. `comparable()` giờ biết cả khi cách đếm của scanner thay đổi: `SCANNER_REVISION` (= 2, tính từ bản sửa OneDrive/`.asar` ở A1) nằm trong dấu vân tay `rules`.
> - Liên kết từ Trends chỉ hiện khi Growth có số và số đó dương. Câu liên kết ghi rõ thư mục, khoảng cách giữa hai lần quét và rằng đó không phải cả ổ. Nếu trên ổ đó chưa có thư mục nào được quét hai lần, card hiện một câu RefusalNote hướng dẫn cách có dữ liệu.
> - **Không làm lịch chụp hằng tuần**; phần này dời sang G3 (đã chốt).
> - **Pro mở ở `stable`/`beta`** (đã chốt): `currentLicense()` trả về Pro `active`, không kèm addon. Pro·Dev và Business vẫn khoá (có kiểm trong `test-entitlements.js`). Đây là lần đầu `UpgradeHint` được dùng thật; trước đó `loadEntitlements()` chưa bao giờ được gọi, nên nó luôn trả `null`.
> - **Sửa kèm:** (1) các câu từ chối của Trends viết cứng tiếng Anh trong `history.js` và hiện nguyên như vậy trên giao diện tiếng Việt; giờ chúng là message i18n. (2) Tốc độ tăng/giảm của thư mục trong Trends đang dùng màu vàng/xanh vốn dành cho verdict; giờ phân biệt bằng độ đậm của chữ.
> - **Chưa kiểm được trên snapshot thật của người dùng:** máy test chưa có snapshot nào. Mọi kiểm chứng đều chạy trên thư mục dựng, quét bằng scanner thật.

---

### Nhóm B — Giải phóng dung lượng không mất dữ liệu

#### B1. Quarantine sang ổ khác

| | |
| --- | --- |
| **Gói** | Pro · `pro.quarantine` |
| **Đối tượng** | P1, P2, P3 |
| **Vấn đề** | Recycle Bin nằm cùng volume nên không giải phóng dung lượng. Người dùng phải chọn giữa "an toàn nhưng không được gì" và "xoá vĩnh viễn" |

**Hành vi:**
1. Người dùng chọn một **vùng quarantine** trên một volume khác (ổ D, ổ USB). App tạo thư mục `CleanDrive Quarantine` với file `README.txt` giải thích thư mục này là gì.
2. Khi thực hiện: copy file → xác minh bằng SHA-256 → ghi journal → **đưa bản gốc vào Recycle Bin** (không xoá vĩnh viễn) → sau đó bản gốc chỉ bị purge qua đường purge hiện có (bốn điều kiện).
   - Tuỳ chọn Pro: *"Xoá bản gốc khỏi ổ C ngay sau khi xác minh"*. Tắt mặc định. Khi bật, hộp thoại xác nhận nói rõ bản gốc sẽ **không** nằm trong Recycle Bin, và bản duy nhất còn lại là ở vùng quarantine.
3. Thời hạn giữ mặc định 30 ngày, có thể chỉnh. Hết hạn thì **không tự xoá**. Tray chỉ báo *"n mục đã hết hạn cách ly"* để người dùng tự quyết.
4. Khôi phục qua Restore Center: chuyển về đúng đường dẫn cũ. Nếu đường dẫn đó đã có file khác, hỏi người dùng (đổi tên / bỏ qua / thay thế).

**Giao diện:** `ActionBar` có nút **Cách ly sang D:** với `FreesBadge` *"Giải phóng ổ C"*. Settings → Quarantine: chọn vùng, thời hạn, dung lượng tối đa, xem tổng dung lượng đang chiếm.

**An toàn:**
- Không cho phép chọn vùng quarantine nằm trên cùng volume với file nguồn (vì như vậy không giải phóng được gì).
- Nếu ổ quarantine bị rút ra, mục đó hiện *"Vùng cách ly không truy cập được"* và không mất bản ghi journal.
- Không bao giờ dùng quarantine cho file trong thư mục cloud-sync mà không kèm cảnh báo như README hiện có.

**Tự động:** được, nếu người dùng chọn `quarantine` làm hành động của một hồ sơ tự động (G4) **và** vùng quarantine đang truy cập được.

**Kiểm thử:** `scripts/action-quarantine.mjs`: rút ổ đích giữa chừng, đầy ổ đích, hash lệch, đường dẫn gốc bị thay bằng junction giữa chừng.

> **✅ Đã code xong (2026-09-25).** Code ở `src/main/lib/quarantine-zone.js` (tạo và kiểm vùng, dung lượng, tên do app sinh, dọn bản dở), handler `src/main/actions/quarantine.js` (plan, apply, `undo`), `lib/quarantine-notice.js` (nhắc hết hạn), cùng các chỗ nối: `execute.js` (truyền `sessionId`), `journal.js` (trường `sha256`, `original`), `ledger.js`, `restore.js` (trạng thái `inQuarantine`, `quarantined()`), `ipc.js` (`quarantineDeps`, `quarantine:status`, `quarantine:choose`, `confirmQuarantineText`), settings v4, `main.js`. Giao diện: card `src/renderer/quarantine.js` trong Settings, nút "Chuyển sang D:" trên bốn thanh thao tác, màn Restore. Harness: `scripts/test-quarantine.js` (74 kiểm tra; vùng cách ly thật trên D:, Thùng rác giả), `scripts/verify-quarantine.js --elevated` (ổ ảo VHDX 64 MB thật, 13 kiểm tra, người dùng tự chạy và bấm UAC), 15 kiểm tra mới trong `smoke.js` (D: thật, Thùng rác thật, file thử của harness), ảnh chụp `npm run shoot:quarantine`. Khác với đặc tả ở trên:
> - **Bản gốc vào Thùng rác theo mặc định** (đã chốt), nên badge cạnh nút **không** ghi "Giải phóng ổ C" như đặc tả. Nó đổi theo tuỳ chọn: "Bản gốc vào Thùng rác — chưa giải phóng", hoặc "Giải phóng dung lượng — bản gốc bị xoá". Biên lai và Trends tính đúng từng mục: bản gốc nào bị xoá thì mới tính là đã giải phóng.
> - **Dòng journal ghi sau khi xử lý bản gốc**, không ghi trước khi đưa vào Thùng rác như bước 2 của đặc tả, vì journal chỉ ghi điều đã xảy ra (quy tắc 4.3). Trước bước đó, `manifest.jsonl` trên chính ổ cách ly đã ghi bản chép nào là của tệp gốc nào (thêm so với đặc tả), nên ổ vẫn tự giải thích được nếu máy kia không còn.
> - **Đo được trên VHDX thật:** ổ bị rút giữa lúc chép thì bản chép dở **vẫn nằm lại** khi gắn ổ lại. Vì vậy bản chép được ghi dưới tên `….partial`, chỉ đổi sang tên thật sau khi đã đọc lại và khớp SHA-256. Lần chuyển sau sẽ dọn các `.partial` (chỉ là bản dở, bản gốc vẫn nguyên). Lần chạy đầu phát hiện ra việc này; lần chạy thứ ba xác nhận cách sửa.
> - **Tệp OneDrive theo trạng thái** (đã chốt): chỉ trên đám mây thì từ chối; chưa đồng bộ thì cho, hộp thoại nói bản trên ổ kia là bản đầy đủ duy nhất; đã đồng bộ thì cho, kèm cảnh báo xoá trên mọi thiết bị và gợi ý "Chỉ giữ trên đám mây". Đo lúc này: 12 tệp / 8,5 GB chưa đồng bộ (cloud đầy), đều mang cờ placeholder, nên không phân biệt được "chưa từng tải lên" với "đã tải rồi sửa".
> - **Hết hạn:** thông báo lúc mở app, tối đa một lần mỗi ngày, cùng con số trên card Settings và màn Restore. Không đặt ở tray như đặc tả, vì tray chỉ có khi bật theo dõi ổ đĩa (mặc định tắt). Không bao giờ tự xoá. Journal giữ lại mọi tháng có quarantine, dù cũ hơn 13 tháng.
> - **Nơi có nút:** Disk usage (tệp lớn và bản đồ), Duplicates (trừ thành phần của chương trình), Photos & video, và các nhóm `review` của "Nên xoá gì". Không có trên nhóm `safe` (tạm, cache, cache app).
> - **Vùng cách ly:** chỉ ổ cục bộ; không nhận ổ mạng, không nhận thư mục đồng bộ cloud. Phải là thư mục thật tên `CleanDrive Quarantine` có README (junction bị từ chối). "Khác ổ" so bằng `stat.dev`, đo được chính là số serial của volume. Loại ổ lấy từ .NET DriveInfo qua PowerShell (script cố định, đường dẫn tuyệt đối). [Unverified] Ổ USB loại HDD có thể tự báo là `Fixed`. Kiểm trước khi chép: đủ chỗ cho cả lô cộng 1 GB. Dung lượng tối đa mặc định là 0 (không giới hạn).
> - **Khôi phục từ vùng cách ly:** chép về, đối chiếu với SHA-256 lúc cách ly, rồi mới gỡ bản trên ổ kia. Bản không còn khớp thì không khôi phục. Bản gốc còn trong Thùng rác được để yên, và không còn là việc của purge.
> - **Xoá bản gốc** (tuỳ chọn, tắt sẵn): đo được là `unlink` của Node trên Windows tự gỡ thuộc tính read-only rồi xoá. Nhánh "xoá hỏng thì đưa vào Thùng rác" chưa dựng được tình huống thật để kiểm, vì tệp bị khoá thì cũng không vào Thùng rác được.
> - Chưa chạy tự động (G4 chưa có): `unattendedEligible: false`. Harness là `.js` CommonJS, không phải `.mjs`. Settings lên v4. Vùng cách ly chỉ đặt được qua `quarantine:choose`; `settings:save` từ cửa sổ bỏ qua trường `zone`.
> - **Sửa kèm:** (a) ở cửa sổ hẹp, câu "giải phóng hay không" bị dồn xuống cuối thanh, tách khỏi nút của nó; giờ mỗi câu đi cùng nút (`pairUp`). (b) Ghi chú của bản đồ thư mục phân biệt tệp vào Thùng rác với bản gốc đã bị xoá. (c) Tiêu đề hộp thoại và bảng tiến độ khi khôi phục không còn nói "từ Thùng rác" với mục đến từ ổ khác.
> - Khi harness VHDX cố ý tháo ổ, Windows Explorer hiện hộp thoại riêng "Z:\ is unavailable"; đó là Explorer, bấm OK là đóng.

---

#### B2. Relocate (chuyển thư mục sang ổ khác)

| | |
| --- | --- |
| **Gói** | Pro · `pro.relocate` |
| **Đối tượng** | P3, P4 |

**Hành vi:**
- Chuyển một **thư mục** người dùng (ví dụ `Videos\2019`) sang ổ khác. Quy trình: copy → xác minh → đưa bản gốc vào bin → ghi journal.
- **Không tạo junction/symlink mặc định.** Tuỳ chọn *"Để lại lối tắt tại chỗ cũ"* sẽ tạo một file `.lnk`, không phải junction, vì junction dễ làm các công cụ khác (và chính app này) hiểu sai.
- Với **thư mục thuộc app đã cài hoặc game**: không relocate, mà chuyển sang `handoff` (Steam → *Move install folder*; Epic → hướng dẫn; các app khác → mở trang cài đặt của app).
- Với thư mục Windows đặc biệt (Documents, Pictures…): `handoff` sang *Properties → Location* của Windows. Không tự sửa registry.

**Trường hợp biên:** đường dẫn dài hơn 260 ký tự, ADS (alternate data streams) phải được giữ lại hoặc báo là sẽ mất, thuộc tính và timestamp phải giữ nguyên, file đang mở thì bị bỏ qua và đếm.

> **✅ Đã code xong (2026-09-28).** Handler ở `src/main/actions/relocate.js`; cỗ máy dùng chung ở `src/main/lib/tree-copy.js` (đi cây, copy, xác minh) và `src/main/lib/verified-copy.js` (trích từ B1 ra, không nhân bản), `src/main/lib/ads.js` (liệt kê stream) và `src/main/lib/shortcut.js` (`.lnk`). Giao diện: mục **"Chuyển sang ổ khác…"** trong menu chuột phải của Treemap (`src/renderer/treemap.js`), `relocateFolder()` ở `src/renderer/app.js`, kênh `relocate:choose` và `confirmRelocate` trong `ipc.js`. Harness: `scripts/test-relocate.js` (**58 kiểm tra**, cây thật trên hai ổ thật), 11 kiểm tra mới trong `smoke.js` cộng một kiểm tra menu thư mục ở phần bản đồ, 8 kiểm tra mới trong `test-treemap.js`, ảnh chụp `npm run shoot:relocate`. Khác với đặc tả ở trên:
>
> - **ADS được giữ lại, không phải "báo là sẽ mất".** Đặc tả cho hai đường; số đo chọn đường thứ nhất. Mẫu 3.000 tệp mỗi nơi: `Downloads` có **318 tệp (10,6%)** mang stream (`Zone.Identifier`, `SmartScreen`, `OECustomProperty`), ổ `D:` có **2 tệp (0,07%)**. `Zone.Identifier` là dấu "tải từ Internet" — mất nó thì một `.exe` đã tải về **thôi không kích hoạt cảnh báo SmartScreen nữa**, tức là âm thầm hạ một lớp bảo vệ của Windows. Node đọc/ghi được stream qua `tệp:tên`, nhưng **không liệt kê được**; liệt kê đi qua `FindFirstStreamW` trong **một** tiến trình PowerShell cho cả cây, đúng khuôn `cloud-state.js`. Không hỏi được thì báo là *không biết*, không phải *không có*.
> - **`allowsFolders` từng là code chết.** Cả 5 handler khai báo nó, không ai đọc; thứ thật sự chặn thư mục là `opts.allowDirectories` trong `lib/trash.js`. Giờ `execute()` thực thi lời khai báo — và **bỏ thư mục ra khỏi lô chứ không đánh hỏng cả lô**, đúng quy tắc "một đường dẫn hỏng không chặn phần còn lại" mà `lib/trash.js` đã viết. Điều này gỡ luôn chỗ F2 từng phải từ chối thao tác trên cả thư mục.
> - **Bản gốc vào Thùng rác nguyên khối** (đã chốt), bằng `allowDirectories: true` mở **chỉ cho đúng thư mục vừa copy và vừa xác minh xong**, không mở rộng cho `recycle` hay `quarantine`.
> - **Chuyển đi không phải là giải phóng.** `freesOnVolume` chỉ `true` khi xoá thẳng bản gốc — Thùng rác nằm trên chính ổ vừa rời. Đây cũng là chỗ sửa `WHEN.relocate` trong `planner/plan.js`: nó được viết sẵn là `'now'` **trước khi có handler**, và phỏng đoán đó sai đúng kiểu app này viết ra để chống.
> - **Điểm vào là menu chuột phải trên Treemap** (đã chốt), không phải một card liệt kê "thư mục nên chuyển". Không gì trong app xếp hạng được điều đó một cách trung thực — nó phụ thuộc vào thứ người ta mở, không phải thứ đĩa nhìn thấy. Vì cùng lý do đó, **G1 không có bước relocate**.
> - **Hỏng ở đâu thì hoàn nguyên tới đó.** Copy lỗi → gỡ bản dở, bản gốc nguyên vẹn. Copy xong mà Thùng rác từ chối bản gốc → **gỡ luôn bản đã copy**, vì hai bản và không một lời nào là kết cục tệ nhất. Cả hai đều có kiểm tra riêng.
> - **Đo được trên máy này:** đường dẫn **313 ký tự** copy được (`\\?\` chỉ bật khi cần), tên tiếng Việt giữ nguyên, thư mục rỗng được giữ, junction **bị bước qua** — không đi theo, không dựng lại (dựng lại sẽ tạo một lối tắt trỏ về ổ mà tệp vừa rời).
> - **Bản đồ phải được bảo.** `scan-tree.remove()` viết cho *tệp rời khỏi thư mục*; một thư mục đã chuyển đi cần `removeFolders()` mới, gỡ cả node lẫn nhánh dưới và trừ đủ byte khỏi mọi cấp trên. **Ảnh chụp bắt được lỗi này**: move đã xong, tệp đã sang ổ kia, bản đồ vẫn vẽ 103 MB.
> - **Hộp thoại xác nhận không chụp được ảnh** vì nó là dialog của Windows — giống giới hạn của G3 với thông báo. `shoot-relocate.js` **in ra** nội dung nó sẽ hiện thay vì giả vờ chụp.
> - Chưa làm: chuyển **nhiều** thư mục một lượt có chạy nhưng chưa có giao diện cho nó; tuỳ chọn "để lại lối tắt" đã có trong handler và trong hộp thoại nhưng **chưa có công tắc trên giao diện** (menu gọi với mặc định là không để lại).

---

#### B3. OneDrive "Free up space" (dehydrate)

| | |
| --- | --- |
| **Gói** | Free · `free` |
| **Đối tượng** | P1, P3 |
| **Vấn đề** | File đã có trên cloud vẫn chiếm chỗ trên máy |

**Hành vi:**
1. Nhận diện file thuộc thư mục OneDrive đang ở trạng thái *locally available* hoặc *always keep on this device*.
2. Đề xuất chuyển sang *online-only*. [Unverified] Cơ chế dự kiến là đặt thuộc tính pinned/unpinned (`attrib +U -P`) hoặc gọi Cloud Files API. Cần harness kiểm chứng rằng OneDrive thực sự giải phóng dung lượng, và đo `bytesOnDisk` trước/sau.
3. Chỉ đề xuất cho file **đã đồng bộ xong** (trạng thái không phải đang tải lên hoặc lỗi).

**Verdict:** `safe` · `strong`, với bằng chứng *"Đã đồng bộ lên OneDrive"*, *"Không mở trong N ngày"*.

**Giao diện:** nhóm riêng trong What to delete, tên *"Có sẵn trên đám mây"*. Nút **Chỉ giữ trên đám mây** có `FreesBadge` *"Giải phóng ổ C, không xoá"*.

**An toàn:** hộp thoại xác nhận nói rõ file sẽ cần mạng để mở, và nếu OneDrive bị đăng xuất thì file sẽ không mở được cho tới khi đăng nhập lại.

**Mở rộng:** Dropbox, Google Drive for desktop. [Unverified] Cần kiểm tra từng app có dùng Cloud Files API không. Chỉ bật app nào đã có harness pass.

> **✅ Đã code xong (2026-09-25).** Code ở `src/main/lib/cloud-state.js` (hỏi Windows trạng thái đồng bộ, kiểm OneDrive có chạy không, gọi `attrib`), handler `src/main/actions/dehydrate.js`, phần `cloudFiles` trong `lib/scanner.js` và `cloudFindings` trong `analyzers/scan.js`, category `cloud.dehydrate`, `confirmDehydrate` trong `ipc.js`, card `src/renderer/cloud.js` trong What to delete. Harness: `scripts/test-dehydrate.js` (44 kiểm tra; OneDrive giả lập, còn pipeline, journal, analyzer và một lượt hỏi Windows thật đều là thật), `scripts/verify-dehydrate.js` (OneDrive thật: mặc định chỉ đọc; thêm `--write` để thử trên tệp của chính nó), 9 kiểm tra mới trong `smoke.js`, ảnh chụp `npm run shoot:cloud`. Khác với đặc tả ở trên:
> - **Không phải một nhóm trong "Nên xoá gì" mà là một card riêng** trong màn đó, có lựa chọn riêng và nút riêng. "Chọn mọi mục an toàn" không với tới card này, nút Thùng rác không thấy nó, tổng "An toàn để xoá" không tính nó; `actions` chỉ có `['dehydrate']`, `unattendedEligible: false`. Lý do: chuyển một tệp OneDrive vào Thùng rác là xoá nó trên mọi thiết bị.
> - **Trạng thái đồng bộ lấy từ Windows** (đã chốt: PowerShell + Add-Type), gọi `CfGetPlaceholderStateFromFindData` qua `FindFirstFileW`. Cách này không mở tệp nên không kéo tệp về. Node không biết được trạng thái này: Dirent không đánh dấu tệp placeholder, còn `attrib` in theo code page OEM nên làm hỏng tên tiếng Việt. Script là văn bản cố định (`-EncodedCommand`); đường dẫn đi qua stdin dạng UTF-8 và không bao giờ nằm trong script. Mọi exe đều gọi bằng đường dẫn tuyệt đối trong System32. Nếu không hỏi được Windows thì card ghi là không kiểm được và không đề xuất gì.
> - **Đo thật trên máy test** (lúc OneDrive tắt, có 566 tệp ≥ 1 MB): chỉ 391 tệp, 1,30 GB là đã đồng bộ và đang nằm trên máy; 153 tệp, 10,3 GB chưa từng được tải lên (các `.vmdk`, `.iso`); 22 tệp đã chỉ trên đám mây. Card đếm và nói rõ các tệp chưa tải lên, không đề xuất chúng.
> - **OneDrive không chạy thì từ chối** (đã chốt), nói rõ lý do và không đổi thuộc tính của tệp nào.
> - **Cơ chế:** `attrib +U -P`, lệnh Microsoft ghi trong tài liệu Files On-Demand. **Đã kiểm trên OneDrive thật** (`verify-dehydrate.js --write`, người dùng đồng ý và tự mở OneDrive): 3 tệp × 2 MB do harness tạo trong thư mục riêng. OneDrive mất **358 giây** mới tải chúng lên, vì vừa bật lại và đang đồng bộ bù. Sau đó allocation của mỗi tệp từ 2,00 MB về 0, app báo 6,00 MB đúng bằng phần đo được, Windows báo là online-only, tên và kích thước giữ nguyên. Thư mục đã được dọn.
> - **Dung lượng giải phóng là số đo được, không phải giả định:** handler theo dõi allocation tối đa 30 giây sau khi giao cho OneDrive, và báo số tệp OneDrive chưa kịp xử lý. `execute()` dùng `measuredFreedBytes` của handler nếu có (`freedBy()`), đây là bước đầu của việc tính theo từng mục mà B1 cần. Cột "vào Thùng rác" của Trends không cộng dehydrate.
> - **Trước khi làm, kiểm lại trạng thái** cả lô (chống TOCTOU); tệp đã hết đồng bộ, đổi kích thước/ngày, hoặc OneDrive vừa tắt đều bị bỏ qua và ghi rõ lý do.
> - Chỉ đề xuất tệp từ **1 MB** trở lên, và **chỉ OneDrive** (thư mục lấy từ biến môi trường của OneDrive); Dropbox và Google Drive chưa bật. Tệp "Luôn giữ trên thiết bị này" vẫn được đề xuất nhưng là `review · likely`, và hộp thoại nói rõ lựa chọn đó sẽ bị bỏ.
> - Bằng chứng mức 1 ghi "Windows báo tệp đã đồng bộ với OneDrive, và nội dung đang nằm trên ổ này" thay cho "Đã đồng bộ lên OneDrive", vì đó đúng là điều đã kiểm.
> - Restore Center ẩn các session dehydrate: tệp không đi đâu cả, mở tệp là OneDrive tải lại.
> - **Sửa kèm:** nhãn FreesBadge trên thanh chọn (cả nhãn "Chưa giải phóng…" của Thùng rác) không đổi theo ngôn ngữ khi chuyển tiếng lúc app đang chạy; ảnh chụp tiếng Việt đã bắt được lỗi này.
> - **Trùng với nhóm xoá (đã chốt):** cùng một tệp OneDrive lớn, lâu không mở vẫn có thể nằm trong nhóm cũ "Large and untouched" (verdict `review`, nút Thùng rác, kèm cảnh báo cloud có sẵn). Nhóm cũ giữ nguyên, nhưng candidate đó có thêm một dòng bằng chứng (`evidence.cloud.alsoInCloud`) trỏ sang cách giải phóng mà không xoá. Đã cân nhắc và không chọn hai phương án: bỏ hẳn tệp khỏi nhóm xoá, hoặc để nguyên.

---

#### B4. Nén NTFS có chọn lọc

| | |
| --- | --- |
| **Gói** | Pro · `pro.compress` |
| **Đối tượng** | P1, P5 |

**Hành vi:**
1. Chỉ đề xuất cho thư mục **ít thay đổi** và **nén được**: tài liệu, log lưu trữ, source code cũ, thư mục game đã cài (tuỳ chọn). Không đề xuất cho file đã nén sẵn như jpg, mp4, zip…
2. **Đo trước khi hứa:** nén thử một mẫu nhỏ trong bộ nhớ để ước lượng tỷ lệ. Hiện con số *"ước tính 30–45%"* với độ tin cậy `likely`. Sau khi nén thật thì báo con số thật.
3. Hai chế độ:
   - **NTFS LZNT1** (`compact /c`): giữ nén cả khi file bị ghi lại.
   - **WOF / XPRESS/LZX** (`compact /c /exe:lzx`): tỷ lệ cao hơn, nhưng [Unverified] file sẽ trở về dạng không nén khi bị ghi lại, nên chỉ phù hợp cho thư mục chỉ đọc.
4. Hoàn tác: `compact /u`.

**An toàn:** không nén thư mục hệ thống (CompactOS là `handoff`, có hướng dẫn riêng), không nén file đang mở, không nén trên ổ không phải NTFS.

> **✅ Đã code xong (2026-09-28).** Handler ở `src/main/actions/compress.js`, phần gọi NTFS ở `src/main/lib/ntfs-compress.js`. Giao diện: mục **"Nén bằng NTFS…"** trong menu chuột phải của Treemap, `compressFolder()` ở `renderer/app.js`, kênh `compress:state` và `confirmCompress` trong `ipc.js`. Harness: `scripts/test-compress.js` (**39 kiểm tra**, nén thật bằng `compact.exe` thật), 10 kiểm tra mới trong `smoke.js`, ảnh chụp `npm run shoot:compress`. Khác với đặc tả ở trên:
>
> - **"Ước tính 30–45%" sai cả hai chiều trên máy này.** Đo thật: mã nguồn **87,5%**, log lưu trữ **81,2%**, ảnh/video **0,0%**. Một dải cố định là lời hứa hụt với thư mục văn bản và lời hứa thừa với thư mục ảnh. Thay bằng phép đo: chép 12 tệp của chính thư mục sang thư mục tạm **cùng ổ**, cho NTFS nén thật, rồi suy ra. Đo trên thư mục 20,7 MB: ước lượng 87,6%, thực tế **87,5%** — lệch **0,0 điểm**; tốn 361 ms. Thư mục ảnh thì **không lấy mẫu gì cả** (đuôi tệp đã trả lời) và mất 31 ms.
> - **Đặc tả bảo "nén thử một mẫu nhỏ trong bộ nhớ".** Trong bộ nhớ là chỗ duy nhất không làm trung thực được: thứ Node nén được là deflate, **mạnh hơn LZNT1**, nên sẽ luôn hứa nhiều hơn NTFS trả. Hứa nhiều hơn thực trả là đúng chiều app này viết ra để chống, nên mẫu đi qua chính thuật toán sẽ dùng.
> - **Chỉ LZNT1, không WOF/LZX** (đã chốt). Đặc tả ngờ `[Unverified]` rằng tệp WOF "trở về dạng không nén khi bị **ghi lại**". Đo được: **tệ hơn thế**. Một log 3,3 MB nén LZX còn 90.112 byte trên đĩa; **một lệnh ghi 40 byte tại chỗ** đưa nó thẳng về 3.348.890. Không phải ghi lại — chỉ là ghi. LZNT1 sống sót qua cả ghi tại chỗ lẫn thay cả tệp. Số đo đầy đủ ở §11 mục 15.
> - **Không đọc output của `compact`.** Trên máy này nó in "The compression ratio is 1,9 to 1" — dấu phẩy, theo locale. Cùng lý do `lib/scheduler.js` đã nêu. Thành công lấy từ mã thoát, kích thước lấy từ `stat().blocks * 512` — đo được: 4.321.280 trước, **540.672** sau. Nên "tiết kiệm bao nhiêu" là miễn phí, không cần một tiến trình mỗi tệp.
> - **Ràng buộc cluster ≤ 4 KB đặc tả không nhắc**, và cách kiểm cũng khác: thay vì hỏi cluster rồi suy luận, module **ghi thử 64 KB byte dễ nén vào đúng chỗ đó và nhìn**. Ổ không làm được thì tự nói ra bằng cách không làm được — đó là một sự kiện, không phải một suy luận.
> - **OneDrive: đặc tả không nhắc, và đây là chỗ nguy.** Nén một tệp placeholder sẽ **kéo nó tải về** — đúng phần dung lượng B3 vừa giải phóng. Thư mục có tệp chỉ-trên-mây bị từ chối, kèm lý do nói thẳng điều đó. Thư mục OneDrive mà mọi tệp đều đang ở máy thì vẫn cho nén; và khi **không hỏi được Windows** thì vẫn làm, chứ không từ chối mọi thư mục OneDrive.
> - **Đây là hành động duy nhất trong giai đoạn này mà "giải phóng" là đúng nghĩa đen**: `freesOnVolume` trả `true`, không có Thùng rác nào ở giữa, và `WHEN.compress` trong planner đã là `now` từ trước — lần này phỏng đoán viết sẵn **đúng**, khác B2 và B5.
> - **Không vào Khôi phục, và đó là chủ ý.** Không có gì dịch chuyển nên không có gì để khôi phục. Đường về là `compact /u`, và **chính menu đó mời**: `compress:state` hỏi đĩa xem thư mục đang nén hay không rồi đổi chiều hộp thoại, thay vì để bản đồ mang một sự thật sẽ cũ đi.
> - **Bản đồ vẫn vẽ kích thước tệp, không phải chỗ chiếm trên đĩa.** Sau khi nén, "Dự án cũ" vẫn hiện 26,1 MB vì các tệp vẫn đúng 26,1 MB — cái đổi là số cluster. Đây là hành vi có từ trước (máy nào cũng có sẵn tệp nén), B4 chỉ làm nó lộ ra. Đã nói trong README; đổi bản đồ sang kích thước cấp phát sẽ đổi ý nghĩa của mọi ô.
> - Chưa làm: nén **nhiều** thư mục một lượt chạy được trong handler nhưng chưa có giao diện; không có cách chọn mức nén; và tuỳ chọn "thư mục game đã cài" của đặc tả **không làm** — thư mục game đi `handoff` như ở B2 và B5.

---

#### B5. Đóng gói lưu trữ

| | |
| --- | --- |
| **Gói** | Pro · `pro.archive` |
| **Đối tượng** | P3, P5 |

**Hành vi:**
- Đóng gói một thư mục (dự án cũ, ảnh năm 2015) thành `.zip` và lưu trên ổ khác hoặc cùng ổ.
- Quy trình: tạo archive → **mở lại archive và xác minh hash từng file** → ghi manifest vào journal → đưa thư mục gốc vào bin.
- Định dạng: `.zip` (writer tự viết, đi cùng ZIP reader sẵn có). [Speculation] `.7z` sẽ cần dependency hoặc một writer tự viết khá lớn. Nên để sau, và quyết định dựa trên harness đo tỷ lệ nén.
- Hoàn tác: giải nén về đúng chỗ cũ, giữ nguyên timestamp.

**Trường hợp biên:** file lớn hơn 4 GB (cần ZIP64), tên Unicode (cờ UTF-8), đường dẫn dài.

> **✅ Đã code xong (2026-09-28).** Handler ở `src/main/actions/archive.js`; bộ ghi/đọc ZIP ở `src/main/lib/archive-zip.js` (ghi kiểu stream, đọc kiểu seek, xác minh, giải nén). Phần phân tích chỉ mục **dùng lại `lib/preview/zip.js`** — module đó nhận thêm tham số `base` để đọc được từ phần đuôi tệp, nên app chỉ có **một** bộ đọc offset của định dạng ZIP. Giao diện: mục **"Đóng gói lưu trữ…"** trong menu chuột phải của Treemap, `archiveFolder()` ở `renderer/app.js`, kênh `archive:choose` và `confirmArchive` trong `ipc.js`, và Khôi phục hiểu trạng thái `inArchive`. Harness: `scripts/test-archive.js` (**58 kiểm tra**), 13 kiểm tra mới trong `smoke.js`, ảnh chụp `npm run shoot:archive`. Khác với đặc tả ở trên:
>
> - **Manifest không vào journal.** Đặc tả nói "ghi manifest vào journal", nhưng `journal/journal.js` ghi **một dòng JSONL mỗi mục với danh sách trường cố định**; nhét manifest 10.000 mục vào đó làm phình mọi lượt đọc của Khôi phục. Manifest nằm **trong chính archive** (`manifest.json`, có `sha256` từng tệp) — cùng khuôn mà B1 đã dùng cho vùng cách ly và đặc tả E2 cũng yêu cầu. Journal nhận một dòng trỏ tới archive, như mọi thao tác khác. Khi giải nén, manifest **bị bỏ qua**, vì nó chưa bao giờ là tệp của người dùng.
> - **Nén có chọn lọc, đặc tả không nói.** Đo trên máy này: `src/` của dự án này tiết kiệm **68,1%**, Documents **10,0%**, Downloads **6,9%**; theo đuôi thì `.js` 67%, `.xls` 70%, `.html` 41%, còn `.docx` **1,0%**, `.zip` 0,8%, `.png` 1,5%, `.mp4` **−0,0%**. Deflate cả một thư mục video là vài phút CPU để không được gì. Mỗi tệp được thử trên 64 KB đầu; không giảm nổi 5% thì ghi `STORED`. Hai ví dụ của đặc tả ("dự án cũ", "ảnh năm 2015") vì thế cho hai kết quả rất khác nhau, và **hộp thoại nói trước con số ước lượng** thay vì để người dùng phát hiện sau.
> - **Cùng ổ được phép** (đã chốt), khác B1/B2 vốn từ chối. Nén một dự án cũ ngay tại chỗ là ca nén ăn nhất. Bù lại hộp thoại phải nói rõ **sẽ lấy lại bao nhiêu sau khi dọn Thùng rác** — với ảnh thì con số đó gần 0 và nó nói thẳng.
> - **`.7z`: không làm**, và đây là quyết định có số chứ không còn `[Speculation]`. Xem §11 mục 14.
> - **ZIP64 đo được, không phải suy luận.** Một thành viên **5.368.710.354 byte** (vượt `0xFFFFFFFF` hơn 1 GB), nguồn là tệp thưa nên không tốn đĩa: ghi trong 32,8 s, chỉ mục đọc lại đúng độ dài 64-bit, xác minh đọc hết 5,37 GB và khớp, và **`System.IO.Compression` của Windows đọc ra đúng con số đó**. Lần chạy đầu **hỏng**, và lỗi đáng ghi lại: trong bản ghi ZIP, **tên đi trước extra field**, còn code ghi extra nằm trong header rồi mới tới tên — ca không-ZIP64 vẫn chạy vì extra rỗng, nên chỉ một thành viên >4 GB mới lộ ra.
> - **Xác minh là bắt buộc, không phải tuỳ chọn.** Archive không mở được thì không phải bản sao lưu, mà là một thư mục đã bị xoá. Kiểm CRC + độ dài của từng thành viên, cộng `sha256` đối chiếu manifest — hash lấy từ **cùng lượt đọc** đã nuôi bộ nén, nên không đọc đĩa hai lần.
> - **Hỏng ở đâu thì hoàn nguyên tới đó**, như B2: ghi lỗi → xoá archive dở, thư mục nguyên vẹn; xác minh trượt → xoá archive, thư mục nguyên vẹn; Thùng rác từ chối thư mục → **xoá cả archive vừa ghi**, vì hai bản và không một lời nào là kết cục tệ nhất.
> - **Giải nén từ chối tên trỏ ra ngoài thư mục.** Một archive là tệp của người khác kể cả khi chính app này viết ra nó.
> - Chưa làm: đóng gói **nhiều** thư mục một lượt chạy được trong handler nhưng chưa có giao diện; chưa có cách chọn mức nén; và archive **không có bước trong G1**, cùng lý do với B2 — xem `planner/plan.js`.

---

### Nhóm C — Developer Pack

Gói: **Pro·Dev** (`pro.dev`). Đây là add-on cho Pro, hoặc có sẵn trong Business.
Đối tượng: **P5**.

Màn hình: tab mới **"Developer"**, chỉ hiện khi phát hiện ít nhất một công cụ dev trên máy, hoặc khi người dùng bật trong Settings.

**Thay đổi quan trọng:** scanner hiện tại vẫn bỏ qua `.git`, `node_modules`, `.venv`, `__pycache__` ở các màn khác. Developer Pack là analyzer **riêng**, được phép đi vào các thư mục này. Hai hành vi này không xung đột nhau.

#### C1. `node_modules` và môi trường theo dự án

| Loại | Nhận diện dự án | Có thể cài lại khi |
| --- | --- | --- |
| Node | `package.json` cạnh `node_modules` | Có `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` |
| Python venv | `pyvenv.cfg` | Có `requirements.txt` / `pyproject.toml` / `poetry.lock` / `uv.lock` |
| Rust | `Cargo.toml` + `target/` | Luôn luôn (build lại được) |
| .NET | `*.csproj` + `bin/`, `obj/` | Luôn luôn |
| Java | `pom.xml` / `build.gradle` + `target/`, `build/` | Luôn luôn |

**Verdict:**
- `safe · strong`: có lockfile **và** dự án không bị chạm trong ≥ N ngày (mặc định 60). Thời gian "chạm" lấy theo file mới nhất **ngoài** thư mục dependency, và ưu tiên thời điểm commit cuối của `.git` nếu có.
- `review · likely`: không có lockfile. Bằng chứng: *"Không có lockfile — cài lại có thể ra phiên bản khác"*.
- `keep`: dự án đang có tiến trình chạy trong thư mục (kiểm tra CWD của tiến trình). [Unverified] Cách lấy CWD của tiến trình khác trên Windows cần được kiểm chứng. Nếu không lấy được thì bỏ qua điều kiện này và hạ mức tin cậy xuống.

**Giao diện:** mỗi dự án một hàng gồm tên, đường dẫn, lần chạm cuối, dung lượng dependency, dung lượng build output, trạng thái lockfile.

#### C2. Cache package manager

npm (`npm-cache`), pnpm store, yarn cache, pip cache, uv cache, Maven `.m2\repository`, Gradle `caches`, NuGet `packages`, Cargo `registry`, Go `pkg\mod`.

- Hành động ưu tiên là `handoff`: hiện lệnh chính chủ (`npm cache clean --force`, `pnpm store prune`, `pip cache purge`, `dotnet nuget locals all --clear`, `go clean -modcache`) kèm nút **Sao chép lệnh**.
- Hành động phụ là `recycle` từng thư mục con. Verdict `safe · strong`, bằng chứng *"Sẽ tải lại khi cần"*.
- Với pnpm store: **không** xoá trực tiếp, vì store được hardlink vào các dự án. Chỉ cho phép `handoff` sang `pnpm store prune`.

#### C3. Docker & WSL

| Mục | Nhận diện | Hành động |
| --- | --- | --- |
| WSL distro `ext4.vhdx` | Qua `wsl --list --verbose` và đường dẫn package | `handoff`: hướng dẫn từng bước: `wsl --shutdown`, sau đó `Optimize-VHD` (cần Hyper-V module) hoặc `diskpart compact vdisk`. [Unverified] Các bản WSL mới có thể có lệnh sparse riêng, cần kiểm tra |
| Docker Desktop disk | Thư mục dữ liệu của Docker Desktop | `handoff`: `docker system df` rồi `docker system prune` (hiện rõ những gì sẽ mất: image, volume, container đã dừng) |
| Distro không còn dùng | Lần khởi động cuối, nếu đo được | `handoff`: `wsl --unregister` (xoá vĩnh viễn, cảnh báo mạnh) |

App **không tự chạy bất kỳ lệnh nào** trong nhóm này. Lý do: chúng xoá dữ liệu nằm ngoài Recycle Bin.

#### C4. SDK, emulator, IDE

Android SDK system images và AVD, các bản .NET SDK cũ (`dotnet --list-sdks`), cache Visual Studio, JetBrains (`caches`, `index`, `log`), VS Code (`CachedData`, `CachedExtensionVSIXs`).

- SDK: `handoff` sang trình quản lý chính chủ (Android Studio SDK Manager, trình gỡ .NET SDK).
- Cache IDE: `safe · strong` nếu IDE đang không chạy. Nếu IDE đang chạy thì `keep`.

#### C5. Build output nhiều dự án

Gộp `bin/`, `obj/`, `target/`, `dist/`, `build/`, `.next/`, `.nuxt/`, `.turbo/`, `out/` trên toàn bộ các gốc đã chọn.

- `safe · strong` khi nằm cạnh file dự án tương ứng và dự án không bị chạm trong ≥ N ngày.
- `review · guess` khi chỉ có tên thư mục mà không có file dự án. Lý do: một thư mục `build/` bất kỳ không đủ để kết luận đó là build output.

**Tự động:** chỉ C5 và cache IDE được `unattendedEligible`, và **tắt mặc định** (giống quy tắc "build output tắt mặc định" hiện có).
> **✅ C2 và C4 đã code xong (2026-09-26).** Tab **Lập trình** mới (giữa Game và Xu hướng), `src/main/dev/` (`tools.js`, `measure.js`), analyzer `src/main/analyzers/dev.js` (`pro.dev`, category `dev.packageCache` / `dev.sdk` / `dev.ideCache`), 3 kênh IPC `dev:last/scan/cancel` + sự kiện `dev:progress` (73 kênh invoke), màn `src/renderer/dev.js`. **`OPEN_PRO` nay có `addons: ['dev']`** (đã chốt 2026-09-26, cùng lý do với Pro: vẫn chưa mua được). Harness: `scripts/test-dev.js` (54 kiểm tra, trong `npm test`), 14 kiểm tra mới trong `smoke.js`, `npm run shoot:dev`. C1, C3, C5 làm ở hai commit sau. Khác với đặc tả, tất cả đều do đo trên máy này ngày 2026-09-26:
>
> - **Chỉ ship công cụ có thật trên máy này** (nguyên tắc D4): npm 2,62 GB · Gradle 3,65 GB (+0,56 GB bản Gradle tải về) · NuGet 2,54 GB · pip 0,37 GB · Maven 0,00 GB. **Không ship pnpm, yarn, uv, cargo, go, Composer** — không có cái nào trên máy, kể cả mục pnpm mà đặc tả dặn kỹ "không xoá trực tiếp". Harness fail nếu có cái nào lọt vào.
> - **C2 chỉ `handoff` (hiện lệnh để copy), KHÔNG có `recycle` từng thư mục con** như đặc tả. Lý do đo được: liệt kê từng tệp cache npm mất **13,8 s**, Gradle **21,8 s**, NuGet 6,7 s, pip 2,4 s — 45 giây cho một màn hình đáng lẽ mở ra là thấy. Và `npm cache clean --force` biết mục nào còn được tham chiếu, đi bộ thư mục thì không. Verdict là `review`, không bao giờ `safe`: app không phải bên ra quyết định ở đây.
> - **Đổi lại, C4 cache IDE thì liệt kê thật và xoá được:** cả bốn cộng lại chỉ **2,4 s** (VS Code 0,1 · Cursor 0,2 · JetBrains 1,3 · Visual Studio 0,8). `safe · strong` khi IDE đóng, `keep` ngay khi nó mở — và `keep` cả khi **không đọc được danh sách tiến trình**, đúng luật của D4.
> - **⚠️ Đường dẫn phải chính xác tới từng thư mục con, không lấy cả thư mục sản phẩm.** `%LOCALAPPDATA%\JetBrains\PyCharmCE2024.2` có `caches`, `index`, `log` — và có cả **`LocalHistory`**, tức toàn bộ lịch sử chỉnh sửa của bạn, không sao lưu ở đâu khác, cùng với `plugins` và `projects`. Visual Studio y hệt: `CacheService` và `WebView2Cache` nằm cạnh `BackupFiles` và `SettingsBackup_*`. Chỉ ba tên của JetBrains và hai tên của Visual Studio được chạm tới; harness dựng cây có đủ các thư mục nguy hiểm đó và đòi lượt quét đi vòng qua.
> - **Thêm `.gradle\wrapper\dists`** (0,56 GB) mà đặc tả không nhắc: các bản Gradle mà từng dự án yêu cầu tải về.
> - **Chưa mục nào `unattendedEligible`.** Đặc tả xếp cache IDE và build output của C5 vào diện chạy tự động cùng nhau, tắt mặc định; mà whitelist của lượt chạy tự động lại khoá theo tên category của advisor (`cleanup.*`). Nối dây cho nửa này bây giờ nghĩa là đụng vào lớp xoá tự động hai lần. Cả hai sẽ vào cùng lúc ở commit C5.
> - **Tab luôn hiện**, khác đặc tả ("chỉ hiện khi phát hiện ít nhất một công cụ dev, hoặc bật trong Settings"). Lý do: một tab chỉ xuất hiện sau khi quét mà lại không quét được nếu không có tab là cái bẫy; và trạng thái rỗng vẫn kiểm được — harness chạy với một môi trường không có công cụ nào và đòi màn hình nói "không tìm thấy", chứ không phải bảng trống.
> - **Nói ra cả thứ không tìm thấy** ("Không có trên máy này, và đã tìm: pnpm, yarn…"), để không ai phải đoán xem app có buồn tìm hay không.
> - **Android SDK không có lệnh nào để hiện**, vì trình quản lý của nó là một cửa sổ bên trong Android Studio; dòng đó giải thích và mở thư mục. **.NET SDK** thì hiện `dotnet --list-sdks` để xem bản nào cũ, và handoff `apps` sang danh sách ứng dụng của Windows — đúng nơi đã cài nó vào.
> - **Sửa kèm harness:** `test-entitlements.js` có ba câu mô tả trạng thái trước khi Pro·Dev mở (`addons.length === 0`, `!can('pro.dev')`, "analyzer duy nhất sau feature key là games"). Đã đổi theo quyết định, và thêm câu kiểm rằng **một license Pro không có add-on vẫn không bao gồm `pro.dev`** — nó đang mở vì bản build này nói thế, không phải vì luật entitlement thôi phân biệt. `test-a11y.js` đổi từ mười một tab sang mười hai.
> **✅ C3 đã code xong (2026-09-26).** `src/main/dev/containers.js`, hai category mới `dev.wslDistro` và `dev.dockerDisk`, nhóm "Ổ đĩa Linux và container" ở đầu tab Lập trình. Trên máy này: **85,0 GB** — Docker 53,7 GB, Ubuntu 31,2 GB, docker-desktop 96 MB. `test-dev.js` nay 71 kiểm tra, `smoke.js` 18. Khác với đặc tả, tất cả do đo ngày 2026-09-26:
>
> - **Danh sách distro đọc từ registry, không chạy `wsl.exe`.** `HKCU\…\Lxss\{guid}` có `DistributionName`, `Version`, `BasePath`, `VhdFileName` — đọc xong là đủ, không khởi động gì. (`wsl --list --verbose` cũng chạy được, 71 ms, và không làm máy ảo bật lên — nhưng registry thì không cần tiến trình nào.)
> - **⚠️ Đường dẫn trong đặc tả sai trên máy này.** Đặc tả đoán distro nằm dưới `%LOCALAPPDATA%\Packages`; Ubuntu ở đây nằm tại `%LOCALAPPDATA%\wsl\{e0b47061-…}`, vị trí của các bản WSL mới. `BasePath` nói thẳng ra, nên không phải đoán. `BasePath` của docker-desktop còn có tiền tố `\\?\` phải cắt đi.
> - **⚠️ Ổ dữ liệu của Docker KHÔNG phải ổ của distro docker-desktop.** Distro docker-desktop có `ext4.vhdx` **96 MB**; còn **53,7 GB** nằm ở `Docker\wsl\disk\docker_data.vhdx`, nơi chứa image và volume. Bảo người dùng `--set-sparse` cái distro sẽ thu nhỏ đúng 0 byte. Hai dòng riêng, lời khuyên riêng, và bằng chứng của dòng Docker nói thẳng điều này.
> - **`Optimize-VHD` KHÔNG có trên máy này** (module Hyper-V chưa cài) — đúng thứ đặc tả đề xuất đầu tiên. Đổi lại, **`wsl --manage <Distro> --set-sparse true` thì có**: WSL ở đây là 2.7.14.0 và `wsl --help` liệt kê đúng công tắc đó. Nên dấu [Unverified] của đặc tả ("các bản WSL mới có thể có lệnh sparse riêng") **đã xác minh là có**. App chạy `wsl.exe --version` một lần (đường dẫn tuyệt đối trong System32, tham số cố định, chỉ đọc) để biết có nên khuyên dùng công tắc đó không; WSL 1.x thì không hiện lệnh không tồn tại.
> - **Các file `.vhdx` KHÔNG sparse — chiếm đúng 100%** (Docker 57,65 GB khai / 57,65 GB thật; Ubuntu 33,47 / 33,47). Ngược hẳn bài học D2, và đáng nói ra: đây là byte thật đang nằm trên ổ.
> - **Không chạy lệnh nào, tất cả đều là các bước để đọc và copy**, theo đúng thứ tự phải làm: tắt trước, rồi sparse, rồi (nếu muốn) `--unregister`. Bước nào xoá dữ liệu thì có cờ `destroys`, và trên màn hình nó in màu cảnh báo, đậm, với câu giải thích đặt **trước** dòng lệnh chứ không phải sau.
> - **`docker-desktop` không bao giờ được đề xuất `--unregister`**: gỡ nó là gỡ engine của Docker, không phải một quyết định về dung lượng.
> - **"Lần khởi động cuối" không đọc được**, đúng như đặc tả ngờ ("nếu đo được"). Thay bằng mtime của file `.vhdx`, và bằng chứng nói rõ đó là lúc ổ đĩa thay đổi chứ không phải lúc khởi động — không có cách nào đọc mốc kia mà không bật distro lên.


> **✅ C1 và C5 đã code xong (2026-09-26).** `src/main/dev/projects.js`, `src/main/lib/gitignore.js`, analyzer thứ hai `src/main/analyzers/dev-projects.js` (`devProjects`, `pro.dev`, category `dev.dependencies` / `dev.buildOutput`), 3 kênh IPC `dev:lastProjects/scanProjects/cancelProjects` + sự kiện `dev:projectProgress` (**76 kênh invoke**), màn `src/renderer/dev-projects.js`. Harness mới `scripts/test-devprojects.js` (46 kiểm tra, trong `npm test`), 13 kiểm tra mới trong `smoke.js`. Khác với đặc tả, tất cả đều do đo trên máy này ngày 2026-09-26:
>
> - **⚠️ Luật `safe · strong` của đặc tả — "nằm cạnh file dự án tương ứng" — đo ra là sai, và nó đã sai sẵn trong bản đã ship.** Quét thật `D:\fda\fdaplus\frontend\app\base\static\vendors`: **774 tệp, 43,7 MB** thư viện vendor được gắn nhãn `buildoutput` / `safe` — `bootstrap.min.css.map`, `echarts.min.js`, `Chart.js`, mọi tệp đều nằm trong git và được trang web nạp. Một lượt chạy tự động bật "kết quả biên dịch" sẽ lấy đi **400 tệp trong số đó**. Đúng bài học `out\` của VS Code, lặp lại một tầng sâu hơn.
> - **Thay bằng: chính `.gitignore` của dự án gọi tên thư mục đó.** Đo trên 13 thư mục chọn tay: luật đặc tả đúng 8/13, `git check-ignore` đúng 11/13 (33 ms mỗi lần, cần có git), **đọc `.gitignore` đúng 13/13** với 112 ms cho 185 thư mục và không cần tiến trình nào. Nó còn nói được thành câu kiểm chứng được: *"`.gitignore` của bạn có dòng `dist/`"*. **Sửa ở cả `lib/advisor.js`**, không chỉ tab Lập trình — sau khi sửa, vendor là **0 tệp**, còn 222 MB output thật của PyInstaller ở `D:\work\tow_tool` thì **tìm ra được** (trước đó không, vì `requirements.txt` không nằm trong danh sách marker).
> - **Bỏ luôn điều kiện "có file dự án bên cạnh", không phải cộng thêm.** `.gitignore` chỉ tồn tại ở nơi ai đó đã lập repo, tín hiệu mạnh hơn; chính `resources\app\package.json` của VS Code mới là thứ gây ra lỗi gốc. **Nhưng tên thư mục vẫn phải nằm trong sáu tên build** — phép giao đó mới là thứ giữ cho nó an toàn: `.gitignore` của `tow_tool` còn liệt kê `*.mat-khau.yaml`, tức mật khẩu tài khoản, được ghép vào đó chính vì **không** được commit.
> - **Luật trôi (`dist` không có dấu `/`) dừng lại ở mép một dự án lồng bên trong.** Git không bỏ qua thứ nó đã track, nên một thư viện vendor đã commit thì vẫn nằm yên dù root `.gitignore` nói gì; đọc file thì không biết điều đó. `D:\fda\fdaplus` có `bin` trần trong `.gitignore` và cả cây vendor đã commit — tác giả của nó đã phải comment `#dist` và `#build` lại để giữ chúng. Hẹp hơn git, có chủ ý.
> - **C1 chỉ giải thích, C5 xoá được — quyết định bằng phép đo, đúng câu hỏi đã đặt về `recycle` không nhận thư mục.** 19 thư mục dependency = **232 229 tệp, 44,5 s** để đo (riêng một `venv` 4 GB mất 21,9 s) — không phải một màn hình. 185 thư mục build = **5,25 s** kể cả liệt kê từng tệp. Đúng cặp C2/C4 đã ship: thứ app không động vào thì chỉ cộng và giải thích, thứ app chuyển được thì liệt kê. Trong chính C5 cũng vậy: 11 thư mục được khai thì liệt kê (18 957 tệp), 102 thư mục còn lại chỉ cộng — vì dòng của chúng không đề xuất gì.
> - **Nút quét riêng** (người dùng chốt 2026-09-26). Nửa công cụ quét đường dẫn cố định và mất 22,6 s; nửa dự án quét các gốc đã chọn ở tab Dung lượng đĩa (A4) và mất 12,5 s cho cả `D:\`. Gộp làm một là ~78 s cho người chỉ mở tab để xem 53 GB của Docker.
> - **“Lần chạm cuối” lấy cái muộn hơn giữa git và file, không ưu tiên git như đặc tả viết.** Đo 12 dự án: chỗ nào hai nguồn lệch nhau thì git luôn cũ hơn. `D:\work\fis\invoice_downloader`: git nói 4 ngày, file nói hôm nay — đang sửa mà chưa commit. Ưu tiên git làm dự án già đi giả tạo, đẩy về phía `safe` — hướng duy nhất mà câu trả lời sai không được phép đi. Cùng luật và cùng lý do với `max(mtime, atime)` ở `lib/autoclean.js`. Nguồn git là mtime của `.git\logs\HEAD` (reflog, 6 ms cho 12 dự án), không phải commit cuối.
> - **Bỏ điều kiện `keep` khi có tiến trình chạy trong thư mục**, đúng phương án dự phòng đặc tả viết sẵn: hạ mức tin cậy (không bao giờ `certain`) và **mọi dòng dự án đều nói rõ là chưa kiểm được**.
> - **Tổng dung lượng build phải gộp thư mục lồng nhau.** `build\` của Gradle chứa thêm 125 thư mục tên `out` và `build`; đếm riêng biến 6,53 GB thật thành 8,42 GB số học. 310 thư mục còn 185.
> - **`unattendedEligible`: tiền đề ban đầu sai hai chỗ, không nối dây gì cả.** (1) `cleanup.buildoutput` **đã** nằm trong whitelist (`allowed-categories.js`) và **đã** tắt mặc định (`settings.js`) từ lâu — thứ nó thiếu là phép thử `.gitignore`, giờ đã có. (2) `dev.ideCache` và `dev.buildOutput` **không bao giờ** tới được lượt chạy tự động: nó gọi `deps.scan(root)` — scanner đĩa thường — rồi chọn từ `cleanup.groups`, mà category phải có trong bảng cố định của advisor (`autoclean.js`). Analyzer `dev`/`devProjects` không hề chạy. Đặt cờ `true` là một ý kiến không ai đọc, và `contract.js` còn chặn trước.
> - **Luật loại trừ đo được là có tác dụng:** Home từ 222 dự án / 68,4 s xuống **143 / 17,2 s**, và không còn `node_modules` của Cursor hay Discord. Ngoài AppData, thư mục bắt đầu bằng dấu chấm và ruột app đã cài, còn loại thêm các gốc cache gói (`pub-cache`, `.m2`, `.nuget`, `.cargo`, `.gradle`) — `D:\pub-cache` lòi ra thư mục `build` đã ship của chính các package Dart.
> - **Gốc được chọn mà nằm trong vùng loại trừ thì báo ra**, kèm tên luật đã từ chối nó. Im lặng trả về rỗng cho một thư mục ai đó cố ý chọn trông như lỗi chứ không như luật. (Chính harness đã vấp: `os.tmpdir()` nằm dưới AppData, nên fixture phải dựng trên `D:` — và nó tự kiểm điều đó.)
> - **Sửa kèm harness:** `test-advisor.js` thêm ba fixture thật (thư viện vendor, dự án không có marker, file bí mật được ignore) và đổi con số `safeBytes`; `test-appsafety.js` và `test-contract.js` thêm `.gitignore` vào fixture dự án của chúng — cả hai trước đó dựa vào đúng luật vừa bỏ; `test-entitlements.js` đổi từ hai analyzer sau feature key sang ba.
> - **⚠️ Phát hiện kèm, không thuộc C1/C5, chưa sửa:** quét `D:\work\tow_tool` cho ra **227 file `.png` trong thư mục `logs\`, 101,6 MB, category `log` / `safe`**, và một lượt chạy tự động sẽ lấy hết. Đó là ảnh chụp màn hình trong một thư mục tên `logs`, không phải log. Cần quyết định riêng.


---
### Nhóm D — Ứng dụng, game, app chat

#### D1. App đã cài: dung lượng thực & lần dùng cuối

| | |
| --- | --- |
| **Gói** | Free (danh sách + dung lượng) · Pro `pro.apps.lastused` (lần dùng cuối, lọc, sắp xếp) |
| **Đối tượng** | P1, P4 |
| **Màn hình** | Tab mới **"Ứng dụng"** |

**Hành vi:**
1. Lấy danh sách app từ các khoá Uninstall trong registry (HKLM, HKCU, WOW6432Node) và từ gói MSIX/Store.
2. **Dung lượng thực** = thư mục cài đặt + các thư mục `%APPDATA%`/`%LOCALAPPDATA%`/`ProgramData` khớp với app. Việc khớp được gắn độ tin cậy riêng: khớp theo publisher và tên là `strong`, chỉ khớp theo tên là `guess`.
3. **Lần dùng cuối:** kết hợp nhiều nguồn, **xếp hạng, không cộng điểm**. [Unverified] Độ tin cậy của từng nguồn phải được đo:

| Rank | Nguồn | Ghi chú |
| --- | --- | --- |
| 1 | Prefetch (`C:\Windows\Prefetch`, cần helper) | Có thể bị tắt, hoặc chỉ giữ số lượng giới hạn |
| 2 | UserAssist (registry, theo người dùng) | Chỉ ghi lại app được mở qua Explorer / Start |
| 3 | Last-access time của file exe chính | Không dùng được nếu access time bị tắt (dùng lại cơ chế kiểm tra hiện có) |

4. Hành động: `handoff` sang trình gỡ cài đặt của app (`UninstallString`) hoặc Settings → Apps. **App không bao giờ tự gỡ cài đặt.**

**Giao diện:** bảng gồm tên, publisher, dung lượng cài đặt, dung lượng dữ liệu, lần dùng cuối kèm từ chỉ độ tin cậy, và nút **Gỡ cài đặt…**.

**An toàn:** không hiện verdict `safe` cho bất kỳ app nào. Mức cao nhất là `review` kèm bằng chứng *"Không mở trong 14 tháng (theo Prefetch)"*. App hệ thống và driver được đánh `protected`.

> **✅ Đã code xong (2026-09-26).** Tab **Ứng dụng** mới (giữa Trùng lặp và Xu hướng), `src/main/apps/` (`registry.js`, `store.js`, `inventory.js`, `lastused.js`, `measure.js`), analyzer `src/main/analyzers/apps.js` (category `apps.installed`, `apps.store`), thao tác helper `prefetch.list`, 4 kênh IPC `apps:last/scan/cancel/prefetch` + sự kiện `apps:progress` (67 kênh invoke), màn `src/renderer/apps.js`. Harness: `scripts/test-apps.js` (79 kiểm tra, trong `npm test`), fixture thật ở `scripts/fixtures/apps/` ghi bằng `npm run capture:apps` (chỉ đọc), 22 kiểm tra mới trong `smoke.js`, `npm run shoot:apps`, `npm run verify:prefetch -- --elevated`. Khác với đặc tả ở trên, tất cả đều do đo trên máy này ngày 2026-09-26:
>
> - **Bỏ hẳn nguồn rank 3 (last-access của exe)** — người dùng chốt sau khi xem số đo. NTFS ở đây *có* ghi last-access (`DisableLastAccess = 2`, System Managed), nên `accessTimesAreTracked()` trả `tracked: true` và D1 sẽ tin nó. Nhưng: trong 400 file nhị phân ở `C:\Program Files`, **281 (70%) có last-access trong 7 ngày**, trong khi UserAssist chỉ ghi 94 exe được mở trong 4 tháng; trong 30 exe đối chiếu được với lần mở thật, **cả 30** có atime mới hơn và chỉ **5** nằm trong 7 ngày quanh lần mở đó. Kiểm nhân quả: `measureTree` quét `C:\Program Files\Git` làm dịch atime **0/8** file, mở đọc 4 KB thì dịch ngay — nên thủ phạm là antivirus / bộ lập chỉ mục / sao lưu, không phải scanner của app. `test-apps.js` đọc mã nguồn của màn này và fail nếu `atimeMs` quay lại.
> - **"Dung lượng thực" tách làm hai cột, không bao giờ cộng:** *Đo được* (đi bộ thư mục thật) và *Bên cài khai* (`EstimatedSize`). Lý do: trong 36 app có cả hai, chỉ **24 nằm trong khoảng 2×** hai chiều — NVM khai 19 MB / đo 482 MB (25×), Microsoft Edge khai 3 080 MB / đo 634 MB (0,21×). Chỉ **69/162** app trong registry có `InstallLocation` khác rỗng, 58 thư mục còn tồn tại, nên phần lớn danh sách không có số đo và màn hình nói thẳng điều đó thay vì lấp bằng số khai.
> - **Lọc theo đúng luật ẩn của Windows:** 638 khoá → **162 app** người dùng thấy (có `DisplayName`, không `SystemComponent` — 406 khoá là loại này, không `ParentKeyName`, `ReleaseType` trống hoặc `Application`). Số bị bỏ được nói ra trong ghi chú chứ không im lặng.
> - **Ứng dụng Store đo được hết, không cần quyền quản trị** — đặc tả đánh giá thấp phần này. `Get-AppxPackage` 1,5 s, 147 gói non-framework; bản thân `C:\Program Files\WindowsApps` bị EPERM nhưng **từng thư mục gói con đọc được cả 147**, đo hết 10,6 s / 14,32 GB / 0 bị từ chối. Tổng một lượt quét không nâng quyền ≈ **26 s**.
> - **`prefetch.list` chỉ liệt kê, không đọc file nào.** Thao tác không nhận tham số nào cả (không có gì trong request trỏ đi chỗ khác), thư mục lấy từ `SystemRoot`, trả về tên + mtime + size. Đọc nội dung `.pf` cần giải nén MAM và parse định dạng của Microsoft *bên trong tiến trình admin*, trái với nguyên tắc §4.5 ("parse ở tiến trình thường"). ✅ **Đã kiểm chứng một phần.** **Đo được 2026-09-27** (người dùng chạy `npm run verify:prefetch -- --elevated`): 495 tệp `.pf`, 260 chương trình, cũ nhất 136 ngày. Đối chiếu với UserAssist trên **68 chương trình cả hai nguồn đều biết**: **57 lần prefetch mới hơn** (đúng như kỳ vọng — prefetch thấy mọi lần khởi động, UserAssist chỉ thấy cú bấm qua Explorer/Start menu), **10 trùng chính xác tới ngày**, **1 lần prefetch cũ hơn**. Trung vị: prefetch mới hơn 25,0 ngày. Ca ngoại lệ duy nhất là `TrGUI.exe` của CheckPoint, cũ hơn 32 ngày, UserAssist đếm **đúng một** cú bấm (25/09), chương trình vẫn còn trên đĩa và hiện không chạy. [Inference] Một cú bấm không nhất thiết khởi động được tiến trình — app đang chạy sẵn thì cú bấm chỉ gọi cửa sổ lên, hoặc nó thoát trước khi prefetcher kịp ghi trace (~10 giây đầu), hoặc nó chạy lỗi; cả ba đều không đụng tới tệp `.pf`, và **không phân biệt được ba khả năng đó chỉ bằng registry**. **Kết luận: giả định đứng vững theo hướng quan trọng, nhưng không phải là chứng minh tuyệt đối.** Rủi ro còn lại là prefetch *cũ hơn thực tế*, tức là app hiện "lâu rồi không dùng" trong khi vừa dùng — hướng sai nguy hiểm cho một màn hình gợi ý gỡ bỏ. Thứ triệt tiêu nó: `lastUsedFor` trong `apps/measure.js` gom cả hai nguồn rồi **sắp theo thời gian giảm dần và lấy cái đầu**, nên một prefetch cũ không bao giờ ghi đè được một cú bấm mới hơn. Bất biến đó nay có 6 kiểm tra riêng trong `test-apps.js`, dựng đúng theo ca `TrGUI.exe` có thật. Ngoài ra verdict duy nhất mà `lastUsed` dẫn tới là `review` (ngưỡng 90 ngày), hành động duy nhất là mở danh sách gỡ cài đặt của Windows, và `unattendedEligible` luôn `false` — không có đường nào từ một mốc thời gian sai tới một lần xoá.
> - **UserAssist chạy tốt nhưng tầm nhìn ngắn:** 9 khoá GUID, chỉ 2 có dữ liệu (`{CEBFF5CD…}` 460 giá trị / 151 có ngày / toàn exe; `{F4E57C4B…}` 71 / 70 / lối tắt). Bản ghi 72 byte, số lần chạy ở offset 4, FILETIME ở offset 60, tên mã ROT13, tiền tố KNOWNFOLDERID. **Bản ghi cũ nhất ở đây là 120 ngày**, nên câu ví dụ *"Không mở trong 14 tháng"* của đặc tả không nói được — màn hình nói "không có bản ghi nào trong {n} tháng mà các bản ghi này bao phủ".
> - **Im lặng không phải là không dùng.** App không có bản ghi nào là `keep` kèm lý do, **không phải `review`**: UserAssist chỉ thấy thứ Explorer và Start menu mở, nên một nút ghim trên thanh tác vụ hay một chương trình khác khởi chạy nó sẽ không để lại dấu vết. Chỉ khi *có* bản ghi và bản ghi đó cũ hơn 90 ngày thì mới là `review`. Không app nào là `safe`, không app nào `unattendedEligible`.
> - **`protected` có bốn lý do rời nhau, và dòng đó nói rõ lý do nào:** gói được Windows ký (`SignatureKind = System`), cờ `NoRemove` của Windows, cài bên trong thư mục Windows, hoặc không đăng ký trình gỡ cài đặt nào.
> - **Không chạy `UninstallString`** (đã chốt). Nút gỡ là handoff `apps` → `ms-settings:appsfeatures`; **cộng thêm** dòng lệnh `UninstallString` hiện ra **để copy, app không bao giờ chạy** (người dùng chốt) — đúng cách A1 đang hiện `DISM /Online /Cleanup-Image /StartComponentCleanup`. Dòng `protected` không hiện lệnh nào. Có thêm nút "Mở thư mục" cho app có thư mục cài.
> - **Khớp thư mục dữ liệu, và chỗ nó từ chối khớp:** đối chiếu tên thư mục trong Roaming/Local/ProgramData với chuỗi của chính app (tên hiển thị, publisher, basename thư mục cài, basename exe trong `UninstallString` **và** `DisplayIcon` — `DisplayIcon` là trường duy nhất nói `Code.exe` cho Visual Studio Code). Khớp basename thư mục/exe = `strong`, chỉ khớp tên hiển thị/publisher = `guess`. **Thư mục có từ hai app cùng nhận thì không ai được** — trên máy này 275 thư mục, 58 khớp đúng một app, 9 nhập nhằng (`Microsoft`, `Lenovo`, `Lenovo_Group_Ltd`) bị từ chối. Tên exe của trình gỡ cài đặt chung chung (`unins000`, `setup`, `update`…) không được coi là định danh.
> - **Parser `.reg` riêng, không dùng `parseExport` của `lib/context-menu.js`**: `reg export` ghi một số REG_SZ/REG_EXPAND_SZ dưới dạng `hex(2):` (UTF-16LE, có thể xuống dòng tiếp). Parser cũ chỉ đọc dạng chuỗi trong ngoặc kép nên **im lặng bỏ mất** `InstallLocation` của Gpg4win và GnuPG trên máy này. Dùng `reg export` (UTF-16LE ra file) chứ không `reg query` (code page của console) để tên app tiếng Việt không hỏng.
> - **Tổng không phải tổng các dòng.** Microsoft 365 và OneNote đăng ký một lần cho mỗi ngôn ngữ, bốn mục trỏ vào cùng một thư mục 4,5 GB. Mỗi dòng vẫn hiện dung lượng thư mục (đó là thứ có thật trong thư mục), nhưng tổng ở trên **đếm mỗi thư mục một lần** và mỗi dòng như vậy có thêm một câu bằng chứng nói nó đang dùng chung. Trên máy này việc đó bỏ đi 13,5 GB đếm trùng (133 GB → 120 GB).
> - **Bỏ thư mục cài quá rộng:** installer nào khai `C:\`, `C:\Program Files`, `ProgramData` hay thư mục người dùng thì không đo, kèm lý do — nếu không, cả ổ sẽ bị đo và gán cho một app.
> - **Sửa trong lúc làm:** (a) `measureTree` trong `system/walk.js` nhận `token` mặc định, truyền thẳng `null` vào sẽ làm nó ném lỗi ở lần kiểm hủy đầu tiên; chỗ gọi của D1 không truyền nữa. (b) axe bắt được `.apps-protection` mang `role="cell"` lồng trong một cell khác (`aria-required-parent`), đã đổi thành span thường. (c) bảng ở test-a11y đổi từ chín tab sang mười, và màn Ứng dụng được thêm vào cả vòng quét axe lẫn vòng kiểm tương phản hover/focus.
> - **Dòng mở rộng khi bấm huy hiệu là state của màn hình, không phải DOM chèn thêm** — nếu chèn thẳng vào cạnh dòng thì lần vẽ lại kế tiếp (đổi ngôn ngữ, `data-changed`) sẽ xoá mất nó ngay dưới tay người đang mở. `smoke.js` kiểm việc vẽ lại không đổi gì thì không dựng lại dòng nào.

---

#### D2. Thư viện game

| | |
| --- | --- |
| **Gói** | Pro · `pro.games` |
| **Đối tượng** | P4 |

**Nguồn dữ liệu:** [Unverified] Định dạng file của từng launcher phải được kiểm chứng bằng fixture thật.

| Launcher | Danh sách game | Lần chơi cuối |
| --- | --- | --- |
| Steam | `libraryfolders.vdf`, `appmanifest_*.acf` | `localconfig.vdf` (theo người dùng Steam) |
| Epic | `ProgramData\Epic\EpicGamesLauncher\Data\Manifests\*.item` | Chưa rõ nguồn, hiện *"không rõ"* |
| GOG Galaxy, EA app, Ubisoft Connect, Battle.net | Registry / manifest riêng | Tuỳ launcher |
| Xbox / Microsoft Store | Gói MSIX trong `XboxGames` | Chưa rõ nguồn |

**Hành vi:**
- Danh sách game gồm tên, launcher, dung lượng, lần chơi cuối, thư viện (ổ).
- Hành động: `handoff` **Gỡ qua launcher** (mở URI `steam://uninstall/<appid>` v.v.) hoặc **Chuyển sang ổ khác qua launcher**. App không tự xoá hay di chuyển thư mục game vì launcher sẽ không còn nhận ra game.
- Phát hiện **thư mục game mồ côi**: thư mục trong `steamapps\common` không có `appmanifest` tương ứng. Mục này được đánh `review · likely`, cho phép `recycle`.
- Phát hiện shader cache / crash dump của game, gộp vào nhóm GPU cache hiện có.

> **✅ Đã code xong (2026-09-26).** Tab **Game** mới (giữa Ứng dụng và Xu hướng), `src/main/games/` (`vdf.js`, `steam.js`, `measure.js`), analyzer `src/main/analyzers/games.js` (`pro.games`, category `games.steam` / `games.orphan` / `games.downloading`), 3 kênh IPC `games:last/scan/cancel` + sự kiện `games:progress` (70 kênh invoke), màn `src/renderer/games.js`. Harness: `scripts/test-games.js` (76 kiểm tra, trong `npm test`), fixture thật ở `scripts/fixtures/games/` ghi bằng `npm run capture:games` (chỉ đọc), 16 kiểm tra mới trong `smoke.js`, `npm run shoot:games`. Khác với đặc tả ở trên, tất cả đều do đo trên máy này ngày 2026-09-26:
>
> - **Chỉ Steam, đã xác nhận bằng đo:** Epic manifests `ENOENT` (launcher có cài nhưng không có game nào), GOG / Ubisoft / Battle.net / EA đều `ENOENT`, `C:\XboxGames` chỉ có `GameSave`. Đúng nguyên tắc D4.
> - **`SizeOnDisk` của Steam là chính xác — ngược hẳn D1.** Đối chiếu từng game với một lượt đi bộ thư mục thật: tỉ lệ **1.000x cho cả 10 game**, 47,05 GB so với 47,05 GB (lệch lớn nhất 0,6% ở game 5 MB). Nên D2 **một cột dung lượng**, không phải hai như D1, và không đi bộ 47 GB mỗi lần mở tab. Chỉ đo cái Steam không ghi sổ: thư mục mồ côi và `steamapps\downloading`.
> - **Không dùng registry để biết game ở đâu.** Steam ghi mục `Steam App <appid>` cho từng game, và **3 mục trên máy này trỏ `E:\SteamLibrary` — ổ không tồn tại** (thư viện đã dời sang D:). Một mục còn ghi tên tiếng Việt thành mojibake (`BÃ¡nh MÃ¬`) trong khi file `.acf` cạnh game ghi đúng. Registry chỉ dùng đúng một việc: tìm Steam cài ở đâu.
> - **Lần chơi cuối lấy mốc muộn hơn của hai nguồn**, đúng kiểu "xếp hạng, không cộng". Đặc tả chỉ nói `localconfig.vdf`, nhưng `appmanifest` cũng có `LastPlayed` — và **không cái nào luôn mới hơn**: đối chiếu 9 game, `localconfig` mới hơn ở 3 game (Spacewar **499 ngày**, The Scourge 122, Goose Goose Duck 41).
> - **Đọc cả 16 tài khoản Steam** (đã chốt): `userdata` có 16 thư mục, `loginusers.vdf` chỉ có 2. Câu hỏi là "có ai từng chơi game này trên máy này không", nên tài khoản đã đăng xuất vẫn tính. **Chỉ đọc đúng trường `LastPlayed`**, không đọc gì khác trong file đó.
> - **`steam://uninstall/<appid>` không phải phỏng đoán:** chính Steam ghi nó làm `UninstallString` của từng game trong khoá Uninstall của HKLM. **Đây là handoff có tham số đầu tiên** (đã chốt): `handoff.js` thêm `resolve()`, key viết `steamUninstall:1274570`, phần sau dấu hai chấm phải khớp `^[0-9]{1,10}$`, URI do code mình dựng. Target không khai `arg` thì **từ chối** tham số (`apps:evil` mở gì cũng không). 11 dạng key sai được kiểm trong harness.
> - **Thư mục mồ côi: phát hiện nhưng KHÔNG cho xoá**, khác đặc tả. Hai lý do: (1) `recycle` cố tình không nhận thư mục — `planTrash` có cờ `allowDirectories` mà action không bật, và nới nó ra cho một trường hợp máy này không chứng minh được là không đáng; (2) **máy này có 0 thư mục mồ côi** (10 thư mục, 10 manifest). Vẫn là `review · likely`, kèm câu "kiểm trong Steam trước rồi tự xoá". Harness tự dựng một thư viện để kiểm phần phát hiện.
> - **Đổi lại có thứ thật hơn mà đặc tả không nhắc: `steamapps\downloading`.** Trên máy này giữ **1,77 GB** rác của một game **vẫn đang cài bình thường**, file cũ nhất từ **2025-07-07**. Đây là file rời nên vào Thùng rác được: mỗi file một dòng, `review`, **chỉ đề xuất khi Steam không chạy** (dùng lại đúng luật chặn theo tiến trình của D4; không đọc được danh sách tiến trình thì cũng không đề xuất).
> - **⚠️ Suýt báo sai gấp 6 lần.** Steam tạo file ở đúng kích thước cuối cùng rồi mới tải nội dung vào, nên `downloading` **khai 11,07 GB nhưng chỉ chiếm 1,77 GB** — có một file 7,6 GB **chưa ghi byte nào**. Bản dựng đầu tiên cộng `stat.size` và báo 10,3 GB thu hồi được. Đã sửa: dòng hiện `bytesOnDisk` (= `blocks * 512`), `bytes` giữ kích thước logic đúng contract, và file chiếm 0 byte thì **không thành dòng** — chỉ đếm và nói ra ("5 tệp đã đặt chỗ sẵn, chưa ghi gì, nên không chiếm chỗ").
> - **Steamworks Common Redistributables là `protected`, không phải game.** 244 MB, chưa từng "chơi" — nên nó sẽ là dòng đầu tiên người ta gỡ vì không nhận ra. Gỡ nó làm game khác không chạy. Ảnh chụp bắt được lỗi này. Bảng `NOT_GAMES` chỉ liệt kê appid thấy trên máy này (228980); appid lạ vẫn coi là game, là hướng an toàn vì game chỉ handoff và Steam luôn hỏi lại.
> - **Parser VDF riêng (`vdf.js`), không dùng regex từng trường.** Lý do: `apps` là tên của nhiều block ở nhiều độ sâu — trong `libraryfolders.vdf` là appid→size, trong `localconfig.vdf` là appid→lần chơi — nên regex `"LastPlayed"` sẽ đọc nhầm mà không biết của game nào. Xử lý được cả `\\`, `\"`, comment `//`, token không ngoặc kép, và hậu tố điều kiện `[$WIN32]` (bỏ qua, nếu không sẽ lệch mọi cặp phía sau).
> - **Sửa kèm cho D1 (đã chốt):** 3 game đang hiện ở tab Ứng dụng kèm "thư mục không còn" vì registry trỏ ổ E:. Giờ mục `Steam App <appid>` được nhận ra, không đo và không kết luận gì về vị trí, bằng chứng nói "đây là game Steam — xem tab Game". Không ẩn dòng, vì bản Free không có tab Game.
> - **Sửa kèm harness:** `test-entitlements.js` có câu "không tính năng nào của app hôm nay là trả phí" — D2 là analyzer đầu tiên sau một feature key, nên câu đó đổi thành: chỉ `games` là `pro.games`, mọi analyzer khác `free`, và trên bản stable hôm nay vẫn chạy được cho mọi người. `test-a11y.js` đổi từ mười tab sang mười một, và màn Game vào cả vòng axe lẫn vòng tương phản hover/focus.

---

#### D3. Dữ liệu Zalo / Telegram theo cuộc trò chuyện

| | |
| --- | --- |
| **Gói** | Pro · `pro.chat` |
| **Đối tượng** | P2 |
| **Vấn đề** | App chat trên PC có thể tích luỹ hàng chục GB, và người dùng không biết phần nào thuộc cuộc trò chuyện nào |

[Unverified] **Toàn bộ phần này phụ thuộc vào định dạng dữ liệu không công khai và có thể thay đổi theo từng phiên bản app.** Phải làm harness khảo sát trên nhiều phiên bản trước khi cam kết. Thiết kế dưới đây chia làm ba mức độ, để luôn có kết quả dùng được ngay cả khi mức sâu nhất không làm được.

| Mức | Nội dung | Điều kiện |
| --- | --- | --- |
| **Mức 1 — Theo loại** | Tổng dung lượng ảnh / video / file / cache / database của từng app | Chỉ cần biết thư mục dữ liệu. Làm được chắc chắn |
| **Mức 2 — Theo thời gian** | Histogram theo tháng, file lớn nhất | Dựa trên timestamp file. Làm được chắc chắn |
| **Mức 3 — Theo cuộc trò chuyện** | Nhóm file theo cuộc trò chuyện / nhóm chat | Chỉ khi cấu trúc thư mục hoặc tên file chứa định danh cuộc trò chuyện. **Không** đọc database tin nhắn, **không** giải mã bất kỳ thứ gì |

**Quyết định về quyền riêng tư:** app **không đọc nội dung tin nhắn** và không mở database chat, kể cả khi làm vậy thì kỹ thuật dễ hơn. Nếu Mức 3 cần đọc database thì Mức 3 không được làm, và UI nói rõ điều đó.

**Hành động:**
- Ưu tiên `handoff` sang tính năng quản lý dung lượng có sẵn trong app chat nếu có (ví dụ Telegram Desktop có mục quản lý bộ nhớ trong cài đặt [Unverified]).
- `recycle` / `quarantine` chỉ cho file media đã tải xuống (ảnh, video, tài liệu), **không bao giờ** cho database hay file cấu hình.
- Hộp thoại xác nhận có thêm câu: *"Xoá file ở đây không xoá chúng khỏi cuộc trò chuyện. Zalo có thể tải lại nếu file còn trên máy chủ, hoặc hiện là không còn khả dụng."* [Unverified] Hành vi thực tế của từng app phải được kiểm tra trước khi viết câu này.

**Tự động:** không bao giờ.

> **✅ Đã code xong (2026-09-29).**
>
> Code: `src/main/chat/` (`zalo.js`, `telegram.js`, `measure.js`, `known.js`),
> `src/main/analyzers/chat.js`, `src/renderer/chat.js`, tab + panel trong
> `index.html`, `chat:last`/`chat:scan`/`chat:cancel` + `chat:progress` trong
> `ipc.js`, `chatNote()` trong hộp thoại xác nhận, `analyzers/app-caches/zalo.json`,
> settings **v10**. Harness: `scripts/test-chat.js` (**84 kiểm tra**), khối Chat
> trong `smoke.js` (**17 kiểm tra**), màn thứ 14 trong `test-a11y.js`, ảnh chụp
> `npm run shoot:chat`. Khác với đặc tả ở trên:
>
> - **Ba mức đều làm được, nhưng Mức 3 chỉ cho Zalo.** Đặc tả để ngỏ vì sợ
>   không có mức nào chạy được; thực tế Mức 1 và Mức 2 chạy cho cả hai app,
>   còn Mức 3 **chỉ Zalo** — không gì trong `tdata` của Telegram mang tên một
>   cuộc trò chuyện, bộ nhớ đệm của nó đánh địa chỉ theo nội dung, và chỗ duy
>   nhất định danh một cuộc trò chuyện là kho tin nhắn. Màn hình **nói ra điều
>   đó thành câu**, không để người dùng tự suy từ một danh sách rỗng.
> - **Cấu trúc sâu hơn một tầng so với những gì đã đo trước.** Không phải
>   `resource\<id>\<tệp>` mà `resource\<id>\{Cache,picture,richThumb,video,voice,file,fileNoise}\<tệp>`:
>   thư mục **loại** nằm *bên trong* thư mục cuộc trò chuyện. Đo lại cả cây:
>   **10.501 tệp / 1.034,4 MB**, trong đó `picture` 5.908 tệp / 367,3 MB,
>   `Cache` 4.038 / 292,5 MB, `video` 68 / 258,0 MB.
> - **⚠️ Zalo giữ mỗi ảnh hai bản, và bản nhỏ hơn là bản không ai mở được.**
>   Cùng một tấm: `Cache\<ts>_<acct>_<conv>_n` là **JPEG 91.405 byte không có
>   đuôi**, `picture\<ts>_<acct>_<conv>_<md5>.jxl` là **JPEG XL 41.323 byte**.
>   Trên cả cây: **2.194 ảnh có mặt ở cả hai, phần `Cache` của chúng là 272,3 MB**
>   — 26% cả cây. Lời khuyên hiển nhiên là "xoá bản trùng", và nó **sai chiều**:
>   chạy đúng hai bộ giải mã `lib/media/thumbs.js` dùng (Electron 33.4.11 /
>   Chromium 130) cho kết quả `.jxl` → **EMPTY** ở Chromium và **ném lỗi** ở
>   shell Windows, còn `Cache\..._n` → **862×1897**. Nên con số là **bằng
>   chứng**, không phải một hành động.
> - **Một cuộc trò chuyện hiện bằng id thô** (đã chốt), và mỗi hàng nói rõ vì
>   sao: cái tên nằm trong database tin nhắn, app không mở database tin nhắn.
>   `ZaloData\Database` là **1.239,8 MB** trên máy này và không một dòng code
>   nào chạm vào nó; harness kiểm điều đó **bằng đường dẫn**, không bằng lời hứa.
> - **Hai hạt, và chỉ một hạt hành động được** — đúng khuôn `duplicates.js` đã
>   chốt cho thư mục: hàng cuộc trò chuyện là `folder` và `actions: []` (cả
>   `recycle` lẫn `quarantine` đều từ chối thư mục, và B2 đã bắt `execute()`
>   thực thi điều đó), còn thứ nút bấm tác động lên là **từng tệp**, mỗi tệp
>   một hàng. Chọn theo **(cuộc trò chuyện, loại)**: không ai đi tick 5.868 tấm ảnh.
> - **Không có gì ở đây là `safe`, và không có gì chạy tự động.** Một tấm ảnh
>   người ta gửi không phải cache, và có thể là bản duy nhất — hộp thoại của
>   Zalo không hứa gì, app cũng không ở vị trí hứa thay.
> - **Câu cảnh báo bắt buộc quyết theo đường dẫn, không theo màn hình gọi tới.**
>   `chat/known.js` nhận ra tệp của app chat ở bất kỳ đâu, nên một ảnh Zalo xoá
>   từ màn Ảnh cũng nhận đúng câu đó. Và câu ấy **không hứa tải lại được**: đặc
>   tả viết "Zalo có thể tải lại nếu file còn trên máy chủ", đọc như một lời
>   trấn an mà **không gì ở đây kiểm được** — nên nó viết đúng là một điều không
>   chắc, kèm chỉ dẫn nên giả định chiều nào.
> - **Telegram: `tupdates` 212,6 MB không phải rác.** Đọc `FileVersion` từ
>   chính hai tệp `.exe`: `tupdates\temp\Telegram.exe` là **7.2.5.0** (2026-09-23),
>   bản đang cài là **7.1.3.0** (2026-08-28). Đây là **một bản cập nhật đã tải,
>   đã giải nén, chưa áp dụng** — xoá đi là bắt tải lại 212 MB, nên `review` và
>   bằng chứng nói thẳng điều đó. Phép đọc phiên bản **hỏng hai lần trước khi
>   chạy**: `ProductVersion` xuất hiện **hai lần** trong `Telegram.exe` (lần đầu
>   ở 46,8% là tên import `api-ms-win-core-version-l1-1-0.dll`), và phần đệm
>   căn theo khối tài nguyên chứ không theo tệp. Khoá đúng là `FileVersion`, ở
>   99,4%, và cách tách đúng là **bỏ qua dải NUL** — 6–9 ms một tệp 208 MB.
> - **Cache trình duyệt của Zalo sang D4, không sang đây** (đã chốt). Đó là
>   `ZaloData\{Cache,Code Cache,GPUCache,DawnCache}` (337,4 MB) và
>   `ZaloData\Partitions\zalo\{...}` (264,9 MB) — **602,3 MB**, Free · `safe`,
>   chạy được trong Automatic, dùng lại nguyên cỗ máy D4 đã có. `IndexedDB`,
>   `Local Storage`, `Service Worker` **không bao giờ** được đề xuất. Settings lên
>   **v10**: hồ sơ nào đang dọn cache của app nào đó thì được thêm `app.zalo`,
>   hồ sơ không dọn cái nào thì không được thêm gì — đúng luật v2→v3 đã dùng.
>   `cal\` (66,7 MB) **cố ý để ngoài**: đó là log xoay vòng, không phải cache.
> - **Chặn theo tiến trình cả ba tệp của Zalo.** `Zalo.exe`, `ZaloCall.exe`,
>   `ZaloCap.exe` — cả ba đều đang chạy trên máy này. Harness bắt được chỗ hụt
>   khi danh sách mới chỉ có `Zalo.exe`. **Zalo chạy lúc đăng nhập ở đây**, nên
>   mọi ảnh chụp đều là trạng thái "đang mở, không đề xuất gì" — đó là màn hình
>   đang làm việc, không phải màn hình rỗng, và các hàng Telegram trong cùng
>   tấm ảnh cho thấy nửa còn lại.
> - **Ảnh chụp bắt được 4 lỗi.** (a) Hai dòng cùng tên **"Files"** — `file` và
>   `fileNoise`; đo magic bytes thì `file` là **14 JPEG + 3 PNG**, còn
>   `fileNoise` (104 MB) **không tệp nào có đuôi và không tệp nào nhận dạng
>   được**, nên nay là "Files people sent" và "Files, kept in a form only Zalo
>   reads". (b) Bốn dòng cùng tên **"Cached media"** — Telegram có `cache` và
>   `media_cache` × hai tài khoản. (c) Hàng `update` **hiện chữ `update` giữa
>   một khối tiếng Việt** vì `meta` thiếu `label`. (d) Hai video đề ngày
>   **30/11/2185** và **15/5/2187**: tên chúng mở đầu bằng `6813644617565` —
>   13 chữ số, qua được phép kiểm độ dài, mà là **id chứ không phải epoch**. Luật
>   nay là **một khoảng thời gian**, không phải một số chữ số.
> - **Sửa kèm, một lỗi có sẵn:** `lib/media/roots.js` cho màn Ảnh trỏ cứng
>   `tdata\user_data\media_cache` — trên máy này là **1 tệp / 10 KB**, và
>   **không bao giờ thấy tài khoản thứ hai** (`user_data#2`: 4 tệp trong
>   `media_cache`, 352 trong `cache`). Nay mỗi tài khoản một root, mang tên tài
>   khoản khi có nhiều hơn một.
> - **Chưa làm, để cho E5:** nới luật "chỉ nhận theo đuôi" ở `media/scan.js:214`
>   và luật từ chối thư mục tên `Cache` ở `roots.js`. **Hai cổng, không phải
>   một** — mở mỗi cổng đuôi thì màn Ảnh vẫn ra 0 tệp, vì ảnh không đuôi nằm
>   trong thư mục tên `Cache`. Phần nhận dạng thì **đã sẵn**: `probe.js:87-99`
>   ghi đè `record.kind` bằng kết quả magic bytes, và `extensionMatches('', 'jpeg')`
>   trả `true` nên tệp không đuôi **không bị gắn nhầm `formatMismatch`**.

---

#### D4. Cache app phổ biến

| | |
| --- | --- |
| **Gói** | Free · `free` |
| **Đối tượng** | P1 |

**Danh mục ban đầu:** Chrome / Edge / Firefox / Brave / Cốc Cốc (cache theo **từng profile**, không đụng tới cookie, lịch sử, mật khẩu), Microsoft Teams (classic & new), Slack, Discord, Spotify, Zoom, Adobe (Media Cache, Camera Raw cache), Figma desktop.

**Quy tắc:**
- Mỗi app có một định nghĩa gồm đường dẫn, tên tiến trình, và danh sách **chỉ được phép chạm**. Mọi thứ ngoài danh sách đó mặc định là `keep`.
- App đang chạy thì cả nhóm là `keep` với bằng chứng *"Đang mở — đóng Discord rồi quét lại"*.
- Verdict `safe · strong`. Có thể `unattendedEligible` nhưng **phải** gắn điều kiện "skip while these apps are open" cho đúng tiến trình.

**Mở rộng:** định nghĩa app nằm ở `src/main/analyzers/app-caches/*.json` để thêm app mới mà không cần sửa code. Mỗi file JSON bắt buộc phải có harness fixture đi kèm.

> **✅ Đã code xong (2026-09-25).** Định nghĩa ở `src/main/analyzers/app-caches/` (`chrome`, `edge`, `teams`, `discord`, `zoom`, `figma`.json và `index.js`: `validate`, `matcher`, `openApps`), danh sách tiến trình ở `src/main/lib/processes.js`, `addKnown` trong `lib/advisor.js`, `knownCache` trong `lib/scanner.js`, `appCandidate`/`markOpenApps` trong `analyzers/scan.js`, kiểm lại ngay trước khi xoá trong `actions/recycle.js` (`leaveOpenApps`), chặn trong `lib/autoclean.js`, settings schema v3. Harness: `scripts/test-appcaches.js` (56 kiểm tra), fixture ở `scripts/fixtures/app-caches/` ghi bằng `npm run capture:appcaches` (chỉ đọc), 12 kiểm tra mới trong `smoke.js` (mục "Known apps' caches"), ảnh chụp `npm run shoot:appcaches`. Khác với đặc tả ở trên:
> - **Chỉ 6 app** (đã chốt: chỉ phát hành app đã kiểm được): Chrome, Edge, Teams bản mới (`ms-teams.exe`, lấy từ manifest của package), Discord, Zoom, Figma. Firefox, Brave, Cốc Cốc, Teams classic, Slack, Spotify, Adobe Media Cache **không có trên máy test**. Camera Raw có thư mục nhưng `Cache2` rỗng và không có app chủ để biết tiến trình, nên **chưa đưa vào** (đã chốt).
> - **Fixture là output thật:** tên thư mục trên máy này, sâu hai cấp dưới gốc của mỗi app. Tên site (`https_…`), thư mục tài khoản (phần `*` của Zoom) và chuỗi giống id đều được thay bằng `site-N`, `account-N`, `idN`; không ghi tên tệp hay kích thước. Harness dựng lại các thư mục đó và đòi định nghĩa chọn đúng các thư mục cache đã chọn trên máy thật. **Mọi tên trong danh sách phải thấy được trong fixture:** vì vậy đã bỏ `GraphiteDawnCache` của Zoom và `DawnCache` của Figma, hai tên không có trên máy này.
> - **Ngoài danh sách là `keep`**, đúng đặc tả, và điều này sửa một rủi ro có từ trước: `Code Cache`/`GPUCache` của Chrome và Edge trước đây rơi vào category `gpucache`, `safe`, nằm trong whitelist chạy tự động, **mà không kiểm trình duyệt có đang mở không**. Giờ mọi thứ dưới gốc của một app đã biết không còn đi qua luật chung. `IndexedDB`, `Service Worker` (một profile Edge ở đây có 608 MB và 560 MB) không bao giờ được đề xuất.
> - **Cache dưới Roaming** (Discord, Zoom, Figma) lần đầu được đề xuất, vì định nghĩa nói rõ thư mục nào là cache. Luật chung vẫn để yên phần còn lại của Roaming.
> - **Chặn theo tiến trình của từng app** (đã chốt), ở ba chỗ: (1) lúc quét xong, app đang mở thì nhóm là `keep · certain`, không có action, không chọn được, không tính vào "An toàn để xoá", bằng chứng đầu tiên là "{app} đang mở — hãy đóng nó rồi quét lại"; (2) lượt chạy tự động hỏi lại ngay trước khi chọn tệp; (3) **ngay trước khi xoá**, `recycle.plan` hỏi lại, và tệp của app vừa mở sau lượt quét bị bỏ qua như "đang dùng". Chỗ (3) không có trong đặc tả: probe `r+` của Thùng rác chỉ bắt được tệp mở không chia sẻ, nên không dựa vào nó được. Không đọc được danh sách tiến trình thì không đề xuất và không lấy cache của app nào.
> - **`tasklist` gọi bằng đường dẫn tuyệt đối** trong System32 với tham số cố định (`processes.js`). Lượt chạy tự động trước đây gọi `tasklist.exe` theo PATH; đã chuyển sang cùng hàm này.
> - **Thêm app vẫn phải sửa code**, khác với "không cần sửa code": `FILES` trong `index.js` liệt kê từng file để một JSON lạ không tự được nạp, whitelist chạy tự động (`allowed-categories.js`, giờ là 12) liệt kê bằng tay, và mỗi app cần nhãn trong `automatic.js` cùng bản dịch. Harness kiểm các danh sách này khớp nhau.
> - **Settings v3:** mỗi app là một category `app.<id>`, bật mặc định. Tệp v2 đang bật `gpucache` thì được thêm cả 6 (để ai đang được dọn cache Chrome/Edge vẫn được dọn); tệp đang tắt thì không thêm gì.
> - **Sửa kèm:** (a) badge ở đầu nhóm ("safe to delete", "your call") chưa bao giờ được dịch; ảnh tiếng Việt bắt được. (b) Thẻ "Never deleted" nói các thư mục trong đó "bị bỏ qua khi quét và bị lớp bảo vệ từ chối xoá", **điều này sai từ trước**: chúng vẫn được quét, và `vet()` chỉ chặn vị trí hệ thống và thư mục cài chương trình. D4 làm cái sai này lộ ra: cache Chrome được đề xuất ngay trên dòng "Chrome\User Data\Default — bị chặn". Đổi thành "Held back / Được giữ lại", kèm câu mô tả đúng điều code làm.

---

### Nhóm E — Ảnh & video nâng cao

Mọi tính năng trong nhóm này giữ nguyên quy tắc gốc của màn Photos & video: **không có lựa chọn tự động nào**, và **không bao giờ chạy trong Automatic**.

#### E1. Màn so sánh cạnh nhau

| | |
| --- | --- |
| **Gói** | Pro · `pro.photos` |
| **Đối tượng** | P3 |

**Hành vi:**
- Mở từ một nhóm near-duplicate / burst, hoặc từ 2–4 ảnh bất kỳ người dùng tự chọn.
- Hiện 2–4 ảnh cạnh nhau, **zoom và pan đồng bộ**, có chế độ lật qua lại (flicker) giữa hai ảnh.
- Bảng so sánh gồm kích thước, megapixel, dung lượng, ngày chụp, máy ảnh, ISO, tốc độ, và chỉ số *least detail* (đã có). Ô có giá trị "tốt hơn" được tô nhẹ, **không** được đánh dấu là "nên giữ".
- Thứ tự sắp xếp gợi ý: độ phân giải → chi tiết → dung lượng. Đây chỉ là **thứ tự**, không có tick sẵn.
- Phím tắt: `1`–`4` để tick hoặc bỏ tick ảnh tương ứng, `←`/`→` để sang nhóm tiếp theo.

> **✅ Đã code xong (2026-09-29).**
>
> Code: `src/renderer/compare.js` (mới), thẻ "Ảnh trông giống nhau" trong
> `renderer/media.js`, `media:measureAll` / `media:measureCancel` và
> `preview:compare` mở rộng trong `ipc.js`, `iso`/`exposureTime` thêm vào
> payload ở `analyzers/media.js`, `formatSpan` trong `renderer/app.js`.
> Harness: `scripts/test-compare.js` (**60 kiểm tra**), ảnh chụp
> `npm run shoot:compare`. Khác với đặc tả ở trên:
>
> - **"Mở từ một nhóm near-duplicate" giả định một màn hình không tồn tại.**
>   Engine gom nhóm đã có từ khi dựng hệ ảnh: `lib/media/perceptual.js`,
>   IPC `media:similar`, `api.mediaSimilar` trong preload — **nối đủ đầu tới
>   cuối và không một dòng renderer nào gọi tới**. `perceptual.js` thậm chí
>   tính sẵn `spread` với comment *"so the UI can say how alike these actually
>   are"*, viết cho một giao diện chưa từng có. Nên mục này là **hai việc**:
>   dải nhóm trên màn Photos, rồi màn so sánh mở ra từ đó. "Burst" **không
>   làm**: không có khái niệm nào trong code, và nhóm theo thời gian chụp là
>   một tiêu chí khác hẳn tiêu chí đang dùng.
> - **Vì sao có một cái nút, và nó tốn bao nhiêu.** Một ảnh chỉ gom nhóm được
>   sau khi đã giải mã để đo pixel, và `npm run bench:media` đo trên máy này:
>   **70,6 ms/tệp**, còn gom nhóm chỉ **2 ms cho 398 hash**. Lưới ảnh cố ý chỉ
>   đo từng màn hình một — đó là lý do thư viện vài nghìn tấm mở được — nên
>   ngay sau khi quét, danh sách này gần như rỗng. Thay vì giả vờ, thẻ nói
>   mẫu số thật ("đã xem 214 / 4.124") và mời quét nốt bằng **một nút có ước
>   lượng đo được, có tiến độ, dừng được**: ~**4,9 phút** cho 4.124 ảnh đọc
>   được ở đây, trả **một lần** vì số đo được cache theo đường dẫn, kích thước
>   và thời gian (lần hai là 91 ms).
> - **Ảnh chỉ nằm trên mây không bao giờ được băm.** Đo được: **2.534 trong
>   6.687** ảnh ở các gốc mặc định là placeholder OneDrive, và đọc một tấm là
>   tải nó về. Một lượt quét hàng loạt sẽ kéo vài GB trở lại đúng cái đĩa mà
>   B3 vừa dọn. Chúng được **đếm và nói ra trên màn**, không nằm trong mẫu số
>   mà nút kia tác động. `mediaStats` phải mang thêm cờ `dehydrated` cho việc
>   này.
> - **`preview:compare` từ đúng-hai thành 2–4**, cùng một handler chứ không
>   phải handler thứ hai: quy tắc "mỗi lần chỉ một preview" nằm ở đó, và hai
>   bản sao của quy tắc đó sẽ lệch nhau.
> - **Hai cột đặc tả đòi vốn không tới được cửa sổ.** `iso` và `exposureTime`
>   được `lib/media/probe.js` đọc từ đầu rồi **bị bỏ rơi** khi
>   `analyzers/media.js` dựng payload. Trên một loạt ảnh chụp liên tiếp từ
>   cùng một máy, đó thường là **hai thứ duy nhất khác nhau**.
> - **Tô màu không được mượn màu verdict.** Xanh/hổ phách/đỏ dành riêng cho
>   "an toàn / tuỳ bạn / giữ lại"; một bảng tô xanh ở đây là đang nói "giữ tấm
>   này", đúng lời khuyên mà đặc tả cấm. Dùng một sắc độ của accent, kèm câu
>   dưới bảng nói tô = **nổi bật**, không phải **tốt hơn**. ISO là hàng duy
>   nhất tô ô **nhỏ hơn**.
> - **Ảnh chụp bắt được bốn lỗi.** (a) Ba ảnh trong một nhóm hiện ở **ba kích
>   thước khác nhau** vì `max-width` — mà một nhóm trùng lặp thường là một
>   tấm ảnh ở nhiều cỡ, nên bản gốc 520px chiếm hết khung còn bản thu nhỏ
>   160px là con tem giữa khung thứ ba; ba độ phóng đại thì **không phải là so
>   sánh**. (b) `formatDuration` là bộ định dạng **ước lượng còn lại** — mọi
>   nhánh của nó kết thúc bằng "còn" — nên toast in **"Looked at 8 photos in
>   almost done"**; phải thêm `formatSpan`. (c) Ô Megapixel của ảnh 160×120
>   hiện `—`, tức "không biết", ngay dưới dòng vừa in kích thước của chính nó.
>   (d) Thẻ nhóm dịch được **mỗi cái tiêu đề**: phần còn lại do JS dựng và
>   `translateDom` không với tới, nên tiếng Việt nằm trên năm dòng tiếng Anh.
> - **§11 mục 9 tái diễn một lần** trong lượt kiểm này: `test:a11y` báo
>   `.brand-name` tương phản **1,18** — mực `#e9ecf3` trên nền `#ffffff`, lại
>   là hai bảng màu chồng nhau, cùng chữ ký đã chẩn đoán. Chạy lại: **177/0**.
>   Log đã giữ ở `%TEMP%\cleandrive-a11y-failures-1790646897831.txt`. Không
>   phải do mục này (E1 không đụng palette), và **mục 9 vẫn để mở**.

---

#### E2. Sao lưu trước khi xoá

| | |
| --- | --- |
| **Gói** | Pro · `pro.photos` |
| **Đối tượng** | P3 |

**Hành vi:**
- Tuỳ chọn trong hộp thoại xác nhận khi xoá từ màn Photos: **"Sao lưu sang … trước"**. Đích có thể là ổ ngoài, NAS (UNC), hoặc một thư mục bất kỳ.
- Quy trình: copy → hash → ghi manifest → rồi mới đưa bản gốc vào bin. Nếu bất kỳ file nào xác minh thất bại, file đó **không bị xoá** và được liệt kê trong toast kết quả.
- Dùng chung cơ chế copy-và-xác-minh với B1.
- Cấu trúc đích giữ nguyên đường dẫn tương đối và có thêm `manifest.json`.

> **✅ Đã code xong (2026-09-29).**
>
> Code: `src/main/lib/backup.js` (mới), tuỳ chọn `backupTo` trong
> `actions/recycle.js`, `summariseBackup` trong `actions/execute.js`,
> `backup:choose` / `backup:clear` trong `ipc.js`, checkbox trong
> `confirmAction`, settings **v9** (`backup.destination`), nút trên thanh hành
> động của màn Photos. Harness: `scripts/test-backup.js` (**50 kiểm tra, ALL
> PASS**), ảnh chụp `npm run shoot:backup`. Khác với đặc tả ở trên:
>
> - **"Tuỳ chọn trong hộp thoại xác nhận" chỉ đúng được một nửa, và giới hạn
>   là của Windows.** Hộp thoại xác nhận xoá là `dialog.showMessageBox` native
>   (`ipc.js`, `confirmAction`). Ngoài các nút, message box native chỉ có
>   **đúng một điều khiển: một checkbox**. Nó không chứa được ô đường dẫn và
>   không mở được trình duyệt thư mục. Nên đích được chọn ở màn hình phía sau
>   — đúng cách B2 và B5 đã làm — còn hộp thoại giữ phần người ta thật sự đổi
>   ý vào phút chót: **bỏ tick ô "Sao lưu sang … trước" là xoá mà không chép**.
>   Câu trả lời của hộp thoại thắng tuỳ chọn của cửa sổ, đúng đường đi
>   `{ approved, options }` mà `execute.js` đã có sẵn cho Khôi phục.
> - **"Dùng chung cơ chế copy-và-xác-minh với B1" đúng; "dùng lại
>   `tree-copy.js`" thì sai.** `copyTree` đòi đích **chưa tồn tại** (cố ý: một
>   phép trộn không hoàn tác được bằng cách xoá thứ vừa ghi) và đi từ **một
>   gốc duy nhất**. E2 nhận một **danh sách tệp rời** chọn trên màn Photos, từ
>   bao nhiêu thư mục cũng được, có thể **nhiều ổ**, vào một thư mục vốn đã
>   tồn tại và còn được ghi tiếp tuần sau. Phần thật sự dùng chung là
>   `verified-copy.js` — `copyHashed`, `copyMetadata`, `longPath` — mà comment
>   đầu tệp đó **đã viết sẵn tên E2 từ khi làm B2**.
> - **Đặc tả nói "giữ nguyên đường dẫn tương đối" mà không nói tương đối với
>   gì, và câu trả lời hiển nhiên là sai.** Một lựa chọn trên màn Photos trải
>   trên nhiều gốc, và trên máy này có ảnh ở cả `C:` lẫn `D:`. Không có gốc
>   chung. Nếu bỏ ổ đi thì `C:\photos\a.jpg` và `D:\photos\a.jpg` là **cùng
>   một đích** — một bản sao lưu âm thầm chỉ giữ một trong hai. Nên ổ là thư
>   mục đầu: `<đích>\C\Users\…\a.jpg`, và `\\nas\share\…` thành
>   `<đích>\UNC\nas\share\…`. `path.parse` **không dùng được** cho việc này:
>   đo được, trên Windows nó trả `C:` cho ổ và `\\` trơ trọi cho UNC, nên mọi
>   máy chủ sẽ dồn vào một thư mục không tên.
> - **Không bao giờ ghi đè.** Đích đã có tệp trùng tên: giống hệt cả kích
>   thước lẫn sha256 thì tính là **đã sao lưu rồi**, không chép lại; khác thì
>   thành ` (2)`, ` (3)`… Chỉ so tên và kích thước là **không đủ** — hai ảnh
>   trong một loạt chụp liên tiếp thường xuyên bằng nhau từng byte về độ dài.
> - **Manifest cộng dồn, không thay thế.** Một thư mục đích sinh ra để dùng
>   lại, và lần sao lưu thứ hai xoá mất bản ghi của lần đầu là một cái bẫy.
>   `manifest.json` không phải của app này (hoặc không parse được) thì **để
>   nguyên** và ghi sang `manifest (2).json`.
> - **Manifest được ghi trước khi xoá bất cứ thứ gì**, và nếu **không ghi
>   được** thì **không xoá gì cả** — bản chép vẫn nằm đó (là ảnh của người ta),
>   nhưng không có gì bị xoá dựa trên một bản sao lưu mà app không mô tả nổi.
> - **UNC được phép, và mối lo trong ghi chú là nhầm chỗ.** `lib/trash.js` từ
>   chối đường dẫn mạng ở `vet()`, tức là từ chối **xoá thứ nằm trên mạng**.
>   E2 chép **tới** chia sẻ mạng rồi xoá **bản gốc cục bộ**, nên không va vào
>   luật đó; `longPath()` đã xử lý `\\?\UNC\` sẵn. Máy này không có NAS thật
>   (§11 mục 12), nên **tốc độ và hành vi trên NAS là `[Unverified]`** và
>   không được hứa ở đâu.
> - **Giữ ADS** (đã chốt), dùng lại `lib/ads.js` với một tiến trình cho cả lô,
>   đúng lý lẽ của B2: mất `Zone.Identifier` là âm thầm gỡ cảnh báo
>   SmartScreen khỏi một tệp phục hồi từ bản sao lưu.
> - **Xác minh là ba điều phải cùng đồng ý**, không phải một: hash đọc được
>   lúc ghi, hash **đọc lại từ đích**, và độ dài. Harness dựng một ổ "nhận ghi
>   rồi lưu thứ khác" và đòi cả ba tệp bị từ chối, bản dở bị xoá, và **không
>   có manifest nào nói là đã lưu**.
> - **Ảnh chụp bắt được ba lỗi**, đúng như ba lần trước: (a) đổi sang tiếng
>   Việt làm `translateDom` ghi đè nhãn nút từ `data-i18n` và **mất tên thư
>   mục đích khỏi màn hình** — sửa bằng `onLanguageChange(drawBackup)`, chạy
>   sau lượt dịch DOM; (b) hai nút mới đẩy **"Chuyển mục đã chọn vào Thùng
>   rác" ra hẳn ngoài khung ở 1180px** — đúng lỗi mà quy tắc xuống dòng trong
>   `styles.css` đã được viết ra để chặn ở 700px, nay tái diễn vì thanh của màn
>   Photos đông hơn mọi thanh khác; (c) sau khi cho xuống dòng, toast **nằm đè
>   lên chính thanh đó**, thứ mà comment ngay trên quy tắc toast nói là chỗ nó
>   tuyệt đối không được nằm.
> - **Sửa kèm harness:** `test-settings-migration.js` viết cứng số `8` ở chín
>   chỗ, nên vừa thêm một mục settings là cả tệp hỏng vì **nói sai phiên bản
>   mà nó từng là**, che mất câu hỏi duy nhất đáng hỏi — tệp cũ còn migrate
>   được không. Nay đọc `SCHEMA_VERSION`.

---

#### E3. Tạo bản video nhẹ hơn

| | |
| --- | --- |
| **Gói** | Pro · `pro.photos` |
| **Đối tượng** | P3 |

**Quyết định kiến trúc cần chốt trước khi làm:** encode video cần một bộ mã hoá.

| Phương án | Ưu | Nhược |
| --- | --- | --- |
| Tải ffmpeg theo yêu cầu (người dùng bấm, có xác nhận tải) | Mạnh, nhiều codec | Thêm một binary bên ngoài; mâu thuẫn quy tắc dependency; thêm một loại network request |
| Media Foundation của Windows qua addon native tự viết | Không dependency | [Unverified] Hỗ trợ HEVC encode phụ thuộc phần cứng / extension; công sức lớn |
| Hardware encoder qua WebCodecs trong một cửa sổ ẩn | Không dependency | [Unverified] Giới hạn container và codec, cần kiểm chứng |

**Hành vi (dù chọn phương án nào):**
1. Người dùng chọn video → chọn mức (*Nhẹ hơn, giữ chất lượng* / *Nhỏ nhất*) → app **ước tính** dung lượng sau khi encode thử 10 giây đầu, gắn độ tin cậy `likely`.
2. Tạo bản mới **cạnh bản gốc** (`tên.cleandrive.mp4`), giữ metadata (ngày chụp, GPS, xoay) nếu làm được, báo rõ nếu không giữ được.
3. **Không bao giờ tự xoá bản gốc.** Sau khi encode, hiện màn so sánh (dùng E1) để người dùng xem trước, rồi người dùng tự đưa bản gốc vào bin qua pipeline thông thường.

> **✅ Đã code xong (2026-10-01).**
>
> ### Quyết định kiến trúc: ffmpeg được duyệt, và cuối cùng không cần tới
>
> Người dùng duyệt ffmpeg ngày 2026-09-28 vì **cả ba phương án đều va vào một nguyên tắc**. Trước khi tải bất cứ thứ gì về, tôi đo lại phương án 3 — thứ đặc tả tự đánh dấu `[Unverified]` — và nó chạy được:
>
> - `VideoEncoder` và `VideoDecoder` **vắng mặt ở `data:` URL** và **có đủ ở `file://`**. Cửa sổ app nạp bằng `loadFile` (`main.js:92`), nên chúng **đã sẵn ở đó**. Một người viết thử bằng `data:` URL sẽ kết luận máy này không có encoder — tôi đã kết luận đúng như vậy trong mười phút.
> - Encode được: H.264 main/high (cả phần cứng lẫn phần mềm), **HEVC chỉ phần cứng**, VP9, AV1. **`avc1.42E01E` (baseline) thì không** — nên danh sách codec là một vòng thử, không phải một hằng số.
> - Đo tốc độ thật ở 1080p: **H.264 phần cứng 109 fps**, phần mềm 119 fps, **HEVC phần cứng 84 fps**. Giải mã một tệp thật của thư viện: **241/241 khung, 660 fps**, demux hết **1 ms**.
> - Nên bước 1 của đặc tả (encode thử 10 giây) tốn khoảng **3 giây**, không phải 10. Đo trên fixture: **2,7 s cho ba clip**.
>
> Thứ Chromium **không** làm là đặt kết quả vào một tệp. `MediaRecorder` *có* xuất `video/mp4` thật — `ftyp/moov/moof/mdat/mfra`, chính `bmff.js` đọc được — nhưng nó lấy mẫu một track **theo tốc độ thực**: ba trăm khung đẩy qua `MediaStreamTrackGenerator` trong **74 ms** trả về **0 byte**. Vì thế `mp4/mux.js` tồn tại, và đó là đúng cái giá B5 đã trả cho ZIP: một định dạng có đặc tả rõ ràng, viết tay một lần, đổi lấy việc không mang một dependency mãi mãi.
>
> Còn một lý lẽ nữa cùng kỷ luật với E4: bản ffmpeg có `libx264` là **GPL**, không hợp một sản phẩm có bán — y hệt lý do Carto/Wikimedia/Esri bị loại khi chọn nhà cung cấp tile. Bản LGPL thì mất `libx264` và phải dựa vào encoder phần cứng, tức là **đúng thứ WebCodecs cho sẵn**. `package.json` vẫn đúng `electron-updater` và `mammoth`.
>
> ### Đo trước khi code, và con số đổi cả bài toán
>
> **308 trong 381 video (80,8% số tệp, 87,7% số byte) không nằm trên đĩa.** Chúng nằm trọn trong `C:\Users\…\CrossDevice\…` — điện thoại nhìn qua Phone Link — và `stat` trả `blocks = 0`. **4.591,8 MB mang tên mà chiếm 0 byte.** Nén chúng giải phóng **không gì cả**, còn đọc chúng là kéo 4,6 GB về máy, đảo đúng thứ B3 vừa giải phóng. Nên chúng bị **từ chối thành lời**, y như E1 từ chối 2.534 ảnh OneDrive.
>
> 73 tệp còn lại, **644,7 MB**, và **demux đọc được cả 73**:
>
> | nhóm | tệp | MB | bitrate | có đáng encode |
> | --- | --- | --- | --- | --- |
> | Quay màn hình `Videos\Captures` | 9 | **301,3** | 8.006–10.094 kbps @1080p | có |
> | Video chat Zalo | 62 | 309,9 | ~2.000 kbps @≤720p | rất ít |
> | `DSCF4958.MOV` (Fujifilm 4K, 4 s) | 1 | 29,0 | **60.695 kbps**, audio `lpcm` | có |
> | OneDrive Pictures | 1 | 4,5 | — | không |
>
> **Cả 73 tệp đều là `avc1`. Không một tệp HEVC nào** — đọc `stsd` trực tiếp, vì `probe.js` không hề đọc codec. **58/73 có `ctts`** (khung B), nên phần xử lý thứ tự trình chiếu không phải đề phòng suông: viết thẳng dấu thời gian trình chiếu làm dấu thời gian giải mã sẽ cho ra một video giật lùi từng đoạn. 67 tệp có AAC được chép nguyên si; đúng 1 tệp có audio `lpcm` bị bỏ và nói rõ.
>
> Nói thẳng con số cuối: trên máy này đích thật của E3 là **10 tệp / 330,3 MB**. Người dùng nghe xong vẫn chốt **làm đủ như đặc tả** (2026-10-01), nên app chào encode cho mọi video đọc được, kể cả video chat.
>
> ### Ba chỗ lệch với đặc tả
>
> 1. **"Dùng lại E1" không chạy như đã viết.** `compare.js` dựng `<img src>`, và `<img>` trỏ vào MP4 không vẽ gì — màn so sánh **chưa bao giờ mở được video**. Nay có khung `<video>`, và **đồng hồ chia chung**: bấm phát, tạm dừng hay tua ở một khung là cả hai cùng chạy. Đó không phải tính năng thêm vào mà là **đúng lý lẽ file này đã tự viết ra cho zoom** — hai khung cuộn độc lập là hai thứ khác nhau, và so sánh một bản gốc với bản encode lại ở hai khoảnh khắc khác nhau thì vô nghĩa đúng trong trường hợp nó sinh ra để phục vụ. Tiếng **tắt** ở mọi khung: bốn soundtrack cùng lúc là tiếng ồn.
> 2. **Bước 2 đòi giữ GPS, và luật đã chốt cấm đúng điều đó.** Ghi toạ độ vào một tệp app tự tạo là ghi toạ độ ra tệp. Nên **không giữ**, màn hình **nói ra thành câu**, và `lib/media/mp4` được **đưa vào đúng vòng quét của `test-media-map.js`** (6 → **9 tệp mã nguồn**) — đó là chỗ sắc nhất trong danh sách ấy, vì định dạng này *có* ô để chứa vị trí. **Ngày chụp và chiều xoay thì giữ**: bỏ ma trận xoay là đặt một video dọc nằm nghiêng, và một bản copy đề ngày hôm nay sẽ tự xếp mình lên đầu timeline mà E4 vừa dựng.
> 3. **`pro.photos` vẫn là khoá chết** (`entitlements.js:35`, 0 nơi dùng) nên **không khoá** — nhất quán với E1, E4 và E5.
>
> ### Những gì không hứa suông
>
> - **Ước lượng là một phép đo, không phải một dự đoán.** Nó encode thật phần đầu tệp rồi nhân lên, và chữ *likely* của đặc tả làm việc thật: một đoạn có nửa sau dồn dập hơn sẽ vượt nó. Phần thử dừng ở **khung khoá cuối cùng nằm trong cửa sổ**, không phải một số khung cố định — cắt giữa một nhóm ảnh là đã trả tiền cho một lần khởi động lại mà chưa thu được những khung rẻ theo sau, và ước lượng đọc lên cao hơn thực tế.
> - **Không bao giờ nhắm cao hơn nguồn.** Một video chat đã ở 2 Mbps không được "cải thiện" lên 2,8. Và thu nhỏ **chỉ thu nhỏ**: một clip 640×480 ở mức *Nhỏ nhất* giữ nguyên kích thước chứ không bị kéo giãn lên 1280.
> - **Xác minh là bắt buộc.** Bản mới được mở lại bằng chính bộ đọc của app, đếm đủ số khung, trước khi ai được báo là nó tồn tại; bản không đọc được thì **bị xoá** chứ không để lại trên đĩa trông như một kết quả. Đó đúng là hình dạng của phát hiện `.jxl` ở E5: bản nhỏ hơn hoá ra là bản không ai mở được.
> - **Chỉ H.264.** HEVC encode được ở đây (phần cứng, 84 fps) và sẽ nhẹ thêm chừng một phần năm, nhưng nó là đúng cái bẫy vừa nói, trong một định dạng mới.
> - **Bản gốc không bao giờ bị đụng tới.** Không đường mã nào mở nó để ghi, và không đường nào xoá nó. Bản mới nằm cạnh nó; trùng tên thì thành ` (2)`, không bao giờ ghi đè.
> - **Màn hình nói thẳng rằng việc này làm đĩa đầy thêm trước đã.** Trong một app dọn ổ đĩa, giấu điều đó là nói dối.
>
> Code: `lib/media/mp4/demux.js`, `lib/media/mp4/mux.js`, `lib/media/mp4/encode.js`, `renderer/encode.js` (**mới**); sửa `renderer/compare.js`, `renderer/media.js`, `ipc.js` (+6 kênh), `preload.js`, `ipc-manifest.js`, `index.html`, `styles.css`, 42 khoá `vi.js`. **Không đổi `lib/settings.js`** — mục này không có gì đáng nhớ giữa hai lần chạy, nên schema vẫn **v12**.
>
> Harness: `scripts/test-mp4.js` (**51 kiểm tra**, trong `npm test`) — demuxer được kiểm **bằng bảng mẫu viết tay**, không phải bằng chính muxer, vì hai nửa cùng hiểu sai một chỗ thì chúng sẽ đồng ý với nhau; `scripts/lib/video-fixture.js` (**mới**, encode clip thật bằng chính encoder của Chromium); **14 kiểm tra** trong `smoke.js`; **3 kiểm tra** trong `test-a11y.js`; `npm run shoot:e3` (**19 ảnh**). `npm test` **2.875/0**, `test:e2e` **602/0**, `test:a11y` **191/0**, `test:idle` **45/0**.
>
> **Ảnh chụp bắt được 6 lỗi thật:** (1) `translateDom` gán `textContent`, nên `<strong>` và `<code>` **nằm trong** một phần tử mang `data-i18n` bị xoá sạch — nhấn mạnh mà markup hứa không bao giờ tới được ai, ở **cả hai ngôn ngữ**; (2) dòng tiến độ **không bao giờ được xoá khi chạy xong**, nên một hộp thoại đã hoàn tất vẫn khăng khăng "đang encode khung 180/180"; (3) và nó còn **đứng nguyên bằng tiếng Việt** sau khi đổi sang tiếng Anh, vì nó là câu do JS dựng — nay giữ **hàm** chứ không giữ câu, đúng cách `media.js` đã giải bài này; (4) màn so sánh ghi **"2 photos, side by side"** trên hai video; (5) và mời người ta **"cuộn để phóng to"** một video, thứ sẽ tranh chấp với thanh điều khiển của chính nó; (6) chú thích dưới bảng nhắc tới **ISO** trong một bảng không có hàng ISO.
>
> **Harness tự bắt thêm hai lỗi của chính nó, và cả hai đáng ghi lại:** phép kiểm "bản mới có mở được không" chạy `<video>` **bên trong trang app**, mà trang ấy mang `media-src cleandrive:` — nên nó đo **CSP chứ không đo tệp**, và đã kết tội ba bản copy hoàn toàn tốt. Nay nó hỏi trong một cửa sổ riêng, và có thêm một **phép đối chứng**: nếu chính fixture cũng không mở được thì lỗi ở muxer, nếu chỉ bản copy hỏng thì lỗi ở pipeline. Lỗi thứ hai: `trialSampleCount` trả về khung khoá **đầu tiên vượt** cửa sổ 10 giây thay vì **cuối cùng nằm trong** nó, nên phần thử dài 12 giây — `test-mp4.js` bắt được.
>
> **Sửa kèm, hai thứ ngoài phạm vi E3 nhưng do E3 lộ ra:**
>
> - **Nhãn "no preview" trên lưới ảnh không đổi theo ngôn ngữ.** Nó được ghi lúc ảnh thu nhỏ trả về, chứ không lúc lưới được vẽ, mà `renderGrid` **dùng lại** ô nào có tệp không đổi — nên câu ấy đứng nguyên bằng ngôn ngữ nó được viết lần đầu. Ảnh chụp giao diện tiếng Việt bắt được một ô vẫn ghi **NO PREVIEW**. Lỗi có sẵn; fixture của E3 (một tệp `.mp4` hỏng) làm nó hiện ra. Nay ô được đánh dấu và lượt đổi ngôn ngữ nói lại nó, và `shoot:e3` **kiểm cả lưới chứ không chỉ hộp thoại**.
> - **`test:idle` nay giữ lại danh sách lỗi của chính nó** (`%TEMP%\cleandrive-idle-failures-*.txt`), đúng cách `test-a11y.js` đã làm — xem §11 mục dưới đây.
>
> **Chưa làm / còn hở, cố ý:**
> - **MP4 phân mảnh (`moof`) không đọc được**, nhưng **bị từ chối bằng đúng lý do của nó**. Bộ đọc này đọc bảng mẫu trong `moov`; một tệp phân mảnh để mẫu trong `moof/trun` và tự khai bằng hộp `mvex`. Trên máy này **0/73 tệp** dùng dạng đó, nên chưa đáng viết bộ đọc thứ hai — nhưng `MediaRecorder` của chính Chromium *ghi ra* đúng dạng ấy, nên nó sẽ tới. Nếu chỉ đọc bảng rồi im lặng, app sẽ nói "không có hình trong đó", **đúng về cái bảng và sai về cái tệp**; nay nó nói là tệp bị chia mảnh. Kiểm bằng **chính một tệp `MediaRecorder` ghi ra**, và bằng một fixture dựng tay trong `test-mp4.js`.
> - **Không encode lại âm thanh.** AAC được chép nguyên si — vừa rẻ hơn vừa không mất chất. Thứ không phải AAC (trên máy này: đúng một tệp `lpcm`) thì bản mới **không có tiếng**, và màn hình nói vậy.
> - **Không có HEVC**, lý do ở trên.
> - **Thẻ "Ảnh trông giống nhau" của E1 vẫn gọi video là "photos".** Lỗi chữ có sẵn, nay dễ thấy hơn vì E3 đặt thêm video lên màn này. Chưa sửa, vì nó thuộc E1.

---

#### E4. Timeline & bản đồ

| | |
| --- | --- |
| **Gói** | Pro · `pro.photos` |
| **Đối tượng** | P3 |

- **Timeline:** mở rộng histogram năm thành dạng năm → tháng → ngày, phóng to hoặc thu nhỏ được.
- **Bản đồ:** đặt ảnh có GPS lên bản đồ. Theo quy tắc hiện tại, *interface không được truy cập mạng*, nên bản đồ phải là **tile offline đóng gói sẵn ở mức zoom thấp** (đường biên quốc gia / tỉnh vẽ bằng vector). [Speculation] Cần cân nhắc dung lượng bộ cài. Phương án tối giản: chỉ gom nhóm theo toạ độ, hiển thị trên lưới, không có nền bản đồ.
- Việc gán tên địa danh (reverse geocoding) chỉ được làm offline với bộ dữ liệu nhỏ (cấp tỉnh/thành).

> **✅ Đã code xong (2026-10-01).**
>
> **Hai nửa rất khác nhau về rủi ro, và phải đọc riêng.**
>
> ### Nửa timeline — không cần một byte dữ liệu mới
>
> `meta.at` (mốc thời gian chính xác) **đã** sang tới cửa sổ từ trước: `candidates.js:17` trải `candidate.meta`, và `analyzers/media.js` đã tính `at` rồi mới rút ra `year`. Nên mục này thuần giao diện: `renderYears` thành `renderTimeline`, đào **năm → tháng → ngày**, một vệt đường dẫn để quay ra, và **phóng to chính là lọc** — cố ý một cử chỉ, vì hai thứ có thể lệch nhau thì phải thêm một điều khiển thứ ba để giải thích.
>
> **`meta.year` nay là trường chết nên đã xoá hẳn** — `at` thay được hoàn toàn, và một trường không ai đọc là một trường âm thầm sai (đúng nguyên tắc §11 mục 16).
>
> **Đo được, và nó đổi cách vẽ:** trong 11.419 tệp của máy này, **chỉ 4,5% mang ngày chụp thật** (472 ảnh + 41 video); **95,5% chỉ có ngày của chính tệp**. Nhưng **ở đâu có cả hai thì chúng khớp**: lệch trung vị **0,0 ngày**, **98,1% cùng ngày**, **0% lệch quá một năm**, tệ nhất 44 ngày. Tức là lời cảnh báo có sẵn trong `analyzers/media.js` (*"tệp chép từ máy ảnh có mtime hôm nay và ngày chụp từ nhiều năm trước"*) **không xảy ra trên máy này**. Và với hai nhóm lớn nhất, ngày tệp *chính là* ngày đúng: ảnh chụp màn hình (3.560, **0%** EXIF — mtime là lúc chụp) và ảnh chat (4.710 — mtime là lúc nhận). Nhóm duy nhất có thể gây hiểu nhầm là `camera` (3.007, 15,4% EXIF). Nên app **vẫn vẽ**, và mỗi mốc **nói ra bao nhiêu tệp được đề ngày bởi ảnh và bao nhiêu bởi tệp** — thêm `meta.dateFrom` để nói được điều đó cho cả video.
>
> ### Nửa bản đồ — đảo một quyết định riêng tư, và mở đường mạng thứ hai
>
> **Đo trước khi làm: chỉ 38/11.419 tệp (0,3%) ghi vị trí** — 25 ảnh, 13 video, máy ảnh toàn iPhone 4S/5s/6 Plus. Tôi đã đề nghị **không làm**; người dùng chốt **làm, và cho phép online** (2026-10-01), lý do: gần như máy nào cũng có mạng. Tôi nêu ba hệ quả mà lý do đó không chạm tới, người dùng nghe xong **giữ nguyên quyết định**. Ghi lại cả ba ở đây vì chúng là cái giá thật:
>
> 1. **Rò vị trí sang bên thứ ba.** Mảnh bản đồ được tải *cho đúng vùng có ảnh*, nên bên cung cấp biết đại khái ảnh chụp ở đâu. Lưu toạ độ trong máy là một sự thật cục bộ; tải mảnh bản đồ biến nó thành quan sát của người khác — ngược hẳn lý do đã ghi trong `exif.js`.
> 2. **Câu "thứ duy nhất có kết nối internet" thành sai**, nên **đã sửa ở cả hai ngôn ngữ** (`index.html`, `vi.js`, và toast trong `updates.js`) thay vì để nó đứng đó nói dối.
> 3. **CSS `default-src 'none'` không bị nới một chữ.** Cửa sổ gửi toạ độ ô bản đồ qua IPC và nhận lại **PNG dạng `data:`** — đúng đường mà thumbnail vẫn đi, và đúng cách §11 đã chốt cho thanh toán ở Giai đoạn 6.
>
> **Phép đảo được ghi thành lời, không xoá lặng lẽ.** `exif.js` và `bmff.js` từng từ chối đọc toạ độ, và comment của `bmff.js` ghi rõ vì sao: một lượt kiểm thật **đã in ra toạ độ nhà của tác giả tới sáu chữ số thập phân**. Cả hai comment nay kể lại chuyện đó rồi mới nói cái gì thay thế. Thứ thay thế **không phải một lời hứa mà là một ranh giới có test**:
> - toạ độ chỉ vượt sang cửa sổ khi bản đồ **đã bật**, mà mặc định là tắt. Cổng nằm ở `analyzers/media.js`, chỗ cuối trước ranh giới IPC — và nó **vắng mặt hẳn** chứ không phải `null`;
> - **không thứ gì ghi ra tệp được đưa toạ độ.** `test-media-map.js` đọc mã nguồn của `report/`, `snapshots/` và `journal.js` và fail nếu có chữ `latitude`/`longitude`/`.lat`/`.lon` — đúng nỗi sợ mà comment cũ đã nêu.
>
> **Đo được về mạng, và nó quyết định nhà cung cấp.** 11/12 nhà cung cấp tile với tới được từ máy này — và cái **không** với tới được chính là `tile.openstreetmap.org` (reset sau 155 ms), trong khi `a.tile.openstreetmap.org` trả lời sau 190 ms. Tức là chặn theo đúng hostname, không phải chặn mạng. Trong số với tới được, **chỉ OpenStreetMap có điều khoản hợp với một sản phẩm có bán**: Carto free là non-commercial, Wikimedia dành cho dự án Wikimedia, Esri đòi tài khoản ArcGIS. OSM đòi User-Agent định danh, ghi công hiện trên màn, và dùng lượng vừa phải — đáp ứng cả ba, và mỗi mảnh tải một lần rồi nằm trên đĩa.
>
> **Không thêm dependency.** Bản đồ trượt là một lưới ảnh 256px và hai công thức; `project`/`zoomToFit` trong `renderer/map.js` là Web Mercator viết tay. Chế độ tối **không** lấy bộ tile thứ hai (điều khoản không hợp) mà lật màu bộ đang có bằng CSS filter.
>
> **Mảnh bản đồ đã tải là tệp app tự ghi lên đĩa người dùng, nên có thẻ riêng ở Cài đặt** để xem và xoá — trong một app dọn ổ đĩa thì đó là điều bắt buộc.
>
> Code: `renderer/map.js` **mới**, `main/map/tiles.js` **mới**, `scripts/lib/exif-fixture.js` **mới**; sửa `lib/media/exif.js`, `lib/media/bmff.js`, `lib/media/probe.js`, `analyzers/media.js`, `renderer/media.js`, `ipc.js` (+3 kênh), `preload.js`, `ipc-manifest.js`, `lib/settings.js` (**v12**), `index.html`, `styles.css`, 33 khoá `vi.js`.
>
> Harness: `scripts/test-media-map.js` (**37 kiểm tra**, trong `npm test`) — **không chạm mạng**, vì máy chủ tile giới hạn tần suất và một bộ test phụ thuộc nó sẽ fail vì lý do không liên quan tới mã. 19 kiểm tra trong `smoke.js`, `npm run shoot:e4` (21 ảnh). `npm test` **2.828/0** (60 bộ), `test:e2e` **588/0**, `test:a11y` **188/0**, `test:idle` **45/0**.
>
> **Ảnh chụp và log bắt được 3 lỗi thật:** (1) hai mảnh bản đồ **trắng vĩnh viễn** — `state.busy` vẫn bật khi lượt vẽ lại hỏi tiếp, nên mảnh hỏng không bao giờ được hỏi lần hai, và một lô có vài mảnh về đã **xoá luôn thông báo lỗi** của những mảnh không về; (2) thu cửa sổ còn 720px thì ghim **nằm ngoài khung** vì bản đồ không hề vẽ lại khi đổi kích thước; (3) trong harness, phép bấm vào thanh ngày dựa trên tiền tố **âm thầm không bấm trúng gì** vì `toLocaleDateString` trả "Sep 17" chứ không phải "17 Sep" — hai ảnh chụp giống hệt nhau mà không ai kêu.
>
> **Chưa làm / còn hở, cố ý:**
> - **Không có reverse geocoding.** Gạch đầu dòng thứ ba của đặc tả (gán tên tỉnh/thành offline) **chưa làm**: nó cần một bộ dữ liệu chưa được duyệt, và với 38 tệp thì chưa đáng.
> - **Không kéo thả bản đồ.** Chỉ có phóng to, thu nhỏ và "Vừa hết". Với vài chục điểm thì ba nút là đủ, và kéo thả là nơi một bản đồ tự viết sẽ sai trước tiên.
> - **Mảnh bản đồ không bao giờ hết hạn.** Chúng chỉ mất khi người dùng tự xoá ở thẻ Cài đặt.
> - **`a.tile.openstreetmap.org` với tới được *hôm nay, từ máy này*.** Nếu nhà mạng chặn nốt thì bản đồ hiện nền trống kèm câu giải thích, và ghim vẫn đúng chỗ — đã có ảnh chụp đúng trạng thái đó, vì OSM giới hạn tần suất trong một lượt chụp lặp.

---

#### E5. Ảnh theo cuộc trò chuyện

| | |
| --- | --- |
| **Gói** | Pro · `pro.chat` + `pro.photos` |
| **Phụ thuộc** | D3 Mức 3 |

Thêm trục **"Cuộc trò chuyện"** vào màn Photos & video, dùng thanh tỷ lệ giống trục "Where from". Nếu D3 Mức 3 không làm được thì tính năng này không xuất hiện, và UI không để lại dấu vết gì của nó.

> **✅ Đã code xong (2026-09-29).**
>
> Code: `chat/known.js` (`conversationOf`, `isChatFolder`), gốc mới trong
> `lib/media/roots.js`, ngoại lệ `Cache` trong `excludeDir`, cổng đuôi trong
> `lib/media/scan.js`, `meta.conversation` trong `analyzers/media.js`, thẻ
> Conversation + `renderConversations` + `pickConversation` trong
> `renderer/media.js`. Harness: 22 kiểm tra mới trong `scripts/test-chat.js`,
> 15 trong `smoke.js`, thẻ mới vào vòng quét `test-a11y.js`, ảnh chụp
> `npm run shoot:conversations`. Khác với đặc tả ở trên:
>
> - **"Giống trục Where from" đúng về hình dạng, sai về phạm vi.** Where from
>   là một **phân hoạch**: mỗi tệp thuộc đúng một nguồn, nên thanh chia cả thư
>   viện. Cuộc trò chuyện thì **hầu hết ảnh không thuộc cái nào**, và một thanh
>   trên cả thư viện sẽ là một đoạn "không thuộc chat nào" nuốt hết phần còn
>   lại — đúng thứ luật 2 của bài học facet sinh ra để từ chối. Nên thanh chia
>   **riêng phần ảnh chat**, và dòng cạnh tiêu đề nói đó là bao nhiêu trên tổng.
> - **Câu "không để lại dấu vết gì" được làm đúng chữ**, và có ảnh chụp chứng
>   minh: thư viện không có ảnh chat thì thẻ không tồn tại — không phải một thẻ
>   rỗng, không phải một lời giải thích về thứ không dùng được.
> - **⚠️ Hai cổng, không phải một.** Quyết định 2026-09-29 chỉ nhắc luật đuôi ở
>   `media/scan.js:214`. Nhưng ảnh JPEG không đuôi của Zalo nằm trong thư mục
>   tên `Cache`, mà `REFUSED_DIR_NAMES` từ chối mọi thư mục tên đó. Mở mỗi cổng
>   đuôi thì màn Photos vẫn ra **0 tệp**. Đo được phần hai cổng này giấu:
>   **4.005 ảnh JPEG đọc được (293 MB)** và **57 video xem được (305 MB)**.
>   Cả hai ngoại lệ đều hẹp — chỉ tên `cache`, chỉ trong thư mục tải về của app
>   chat, quyết bằng chính `chat/known.js`; `appdata` vẫn bị từ chối ở đó, và
>   `Chrome\...\Cache` vẫn bị từ chối y như cũ.
> - **5.508 tệp `.jxl` (342 MB) không vào lưới** (đã chốt), và **nói ra thành
>   câu trên dòng trạng thái** thay vì rơi im lặng. Chúng là ảnh thật, nhưng
>   đo bằng đúng hai bộ giải mã `thumbs.js` dùng thì không cái nào vẽ được —
>   **49% số tệp một thư mục chat đóng góp** sẽ là ô báo lỗi. Không mất gì:
>   bản đọc được của chính tấm ảnh đó nằm ở thư mục bên cạnh và vẫn vào lưới,
>   còn 342 MB kia đã được màn Chat tính đủ.
> - **Một luật nhỏ đặc tả không có, và cần:** tệp được nhận **chỉ vì nó nằm ở
>   đâu** thì phải tự chứng minh bằng bytes. Ở mọi nơi khác, tệp mà nội dung
>   không khớp gì vẫn được giữ và báo — vì nó vào được là do **cái tên** khai
>   `.jpg`, và một `.jpg` không phải JPEG là một phát hiện. Tệp không đuôi thì
>   không khai gì, nên không có gì để mâu thuẫn. Đo được **183 tệp** như vậy
>   (`fileNoise`, `voice`); không có luật này chúng lên lưới thành 183 ô không
>   kích thước, không ngày, không ảnh.
> - **Gốc mới trỏ `ZaloDownloads\resource`, không phải cả `ZaloData`** — đó là
>   thư mục duy nhất chia theo cuộc trò chuyện. Nhãn dán (39,1 MB / 962 tệp)
>   và mảnh giao diện cố ý nằm ngoài: chúng không thuộc cuộc trò chuyện nào và
>   sẽ là 39 MB nhiễu trong thư viện ảnh của người ta. **Bật sẵn** (đã chốt),
>   như mọi thư mục app chat đã có từ trước.
> - **Không khoá sau `pro.photos` hay `pro.chat`** (đã chốt), khác đặc tả.
>   `analyzers/media.js` khai `feature: 'free'`, `pro.photos` xuất hiện đúng
>   một lần trong cả repo — dòng khai — và **E1 cũng ghi `pro.photos` trong
>   đặc tả rồi ship không khoá**. Khoá một trục của một màn miễn phí trong khi
>   lưới ảnh, màn so sánh và phép gom nhóm gần giống đều Free là tuỳ tiện.
>   Để Giai đoạn 6 quyết cả cụm.
> - **Sửa kèm, một lỗi có sẵn:** `#media-status` mang `data-i18n`, nên
>   `translateDom` **xoá kết quả quét** và thay bằng "sẵn sàng quét" mỗi lần
>   đổi ngôn ngữ — ảnh chụp tiếng Việt bắt được. Đây là **lần thứ ba** dự án
>   này dính đúng cái bẫy đó. Nay dòng trạng thái giữ **các con số**, không giữ
>   câu đã dựng, và `renderStatus()` nói lại bằng ngôn ngữ mới với số được định
>   dạng theo ngôn ngữ đó. Màn Game không bao giờ dính vì `#games-status` không
>   mang thuộc tính ấy; nay hai màn giống nhau.

---

### Nhóm F — Trùng lặp nâng cao

#### F1. Trùng lặp xuyên thư mục / xuyên ổ

| | |
| --- | --- |
| **Gói** | Pro · `pro.dupes.advanced` |
| **Phụ thuộc** | A4 |

- Chọn nhiều gốc trên nhiều volume. Pipeline 4 pha hiện có được giữ nguyên, hash cache dùng chung.
- **Gợi ý bản giữ lại** có thêm tiêu chí: *ưu tiên bản trên ổ nội bộ* hoặc *ưu tiên bản trên ổ sao lưu*, do người dùng chọn. Mặc định vẫn là bản cũ nhất.
- Nhóm có bản trên ổ mạng thì hash qua mạng. Có cảnh báo về tốc độ, và dừng được ở mọi pha.

> **✅ Đã code xong (2026-09-28).**
>
> **Hai phần ba mục này A4 đã giao rồi**, và nói thẳng ra thì đó là điều đáng ghi nhất: chọn nhiều gốc trên nhiều volume, pipeline 4 pha giữ nguyên, hash cache dùng chung — tất cả đã chạy từ `3f13ff9`. Mục F1 chỉ còn lại tiêu chí chọn bản giữ.
>
> Code:
> - `src/main/lib/duplicate.js` — nhận `opts.keeperRank(file)`, số nhỏ thắng, **bản cũ nhất vẫn phá hoà**. Mặc định mọi bản cùng hạng, nên luật cũ ("bản cũ nhất là bản gốc") không đổi một ly.
> - `src/main/analyzers/scan-roots.js` — `keeperRankFor(roots, prefer)` dịch loại ổ thành thứ hạng. Đặt ở đây chứ không trong closure của `ipc.js` vì **bài học từ A2**: cái gì nằm trong closure thì không test được.
> - `src/main/ipc.js` — `dupes:run` nhận `options.prefer`, trả về `prefer` và `preferRefused`.
> - `src/renderer/index.html` + `app.js` — hộp chọn "Đề xuất giữ", và một dòng trạng thái nói **luật nào đã thật sự áp dụng**.
>
> Harness: 6 kiểm tra trong `test-roots.js` (bảng thứ hạng), 4 trong `test-duplicate.js` (thư viện có nghe không, trên tệp thật), 3 trong `smoke.js` (cửa sổ thật, cả Free lẫn Pro). `npm test` **2.133 / 0**, 47 bộ; `test:e2e` ALL PASS.
>
> Khác với đặc tả:
> - **Từ chối, không âm thầm hạ cấp.** Free chọn "giữ bản trên ổ sao lưu" thì main trả `preferRefused: 'locked'` và dòng trạng thái nói rõ, thay vì lặng lẽ giữ bản cũ nhất rồi để người dùng nhìn một danh sách keeper không phải cái họ yêu cầu. Cùng hình dạng với `fastRefused` của A2. Đặc tả không nói gì về chuyện này.
> - **"Ổ nội bộ" nghĩa là đĩa của chính máy này**, còn "ổ sao lưu" là mọi thứ mang đi được: `external` theo bus (USB), hoặc `readOnly` vì bất kỳ lý do gì (ổ mạng, ổ rời). Tệp không nằm dưới gốc nào đang tìm thì xếp hạng bét — không có đường nào để một thứ ngoài phạm vi tìm kiếm trở thành bản được giữ.
> - **Không làm nhánh hash qua ổ mạng** (mục 3 của đặc tả). Hai lý do:
>   1. A4 đã chốt **bỏ qua gốc trên ổ mạng** trong Duplicates, và lý do vẫn đúng: ổ mạng chỉ đọc (đo được — `shell.trashItem` trên UNC bị từ chối), nên một bản trùng tìm thấy ở đó không có hành động nào đi kèm.
>   2. Đặc tả đòi "có cảnh báo về tốc độ". **Tôi không đo được tốc độ đó trên máy này.** Đã thử hash qua `\\<địa chỉ LAN>\D$\…` như `test-multiroot.js` làm, kết quả: 363–795 MB/s, *không chậm hơn đọc cục bộ chút nào* — vì địa chỉ đó là link-local `169.254.x.x` và byte không hề rời khỏi máy. Phép đo ấy **vô dụng** làm đại diện cho mạng thật. Theo nguyên tắc D4 (chỉ phát hành phần kiểm chứng được trên máy này), không ship một cảnh báo tốc độ mà mình không có số để đỡ.
>
> **Còn mở:** cần một NAS hoặc một máy thứ hai thật để đo, rồi mới quyết có mở nhánh ổ mạng hay không. Đã ghi vào mục 11.


#### F2. Thư mục trùng toàn bộ

| | |
| --- | --- |
| **Gói** | Pro · `pro.dupes.advanced` |

- Hai thư mục được coi là trùng khi **cùng tập đường dẫn tương đối và cùng hash** cho mọi file. Không tính file ẩn nếu người dùng chọn như vậy (mặc định có tính).
- Thư mục **gần trùng** (≥ 90% file giống nhau): hiện riêng, verdict `review`, và có màn so sánh cây để thấy file nào chỉ có ở một bên.
- Hành động trên thư mục trùng: `recycle` **từng file** trong thư mục (giữ nguyên quy tắc "interface không xoá thư mục"), hoặc `archive` / `quarantine` cả thư mục.

> **✅ Đã code xong (2026-09-28).**
>
> Code:
> - `src/main/lib/folder-dupes.js` — **mới**, thuần, không I/O (hàm `hashOf` truyền từ ngoài vào). Bốn pha: dựng cây từ danh sách tệp → **chữ ký hình dạng** (tên + kích thước, đệ quy, *không đọc byte nào*) → **chữ ký nội dung** (SHA-256 mọi tệp, chỉ cho thư mục đã khớp hình dạng) → **gần trùng** bằng sketch bottom-k rồi đếm lại chính xác.
> - `src/main/lib/duplicate.js` — cờ `folders`. Khi bật thì đi cây **một lần, rộng**, và danh sách của màn tệp được *lọc ra từ* cây rộng đó chứ không đi cây lần hai. `projectFolders()` làm phẳng cây thành thứ qua được IPC và chốt luôn bản giữ bằng `keeperRank` của F1.
> - `src/main/analyzers/duplicates.js` — ba loại candidate mới, **ba không gian id riêng**: một đường dẫn giờ mang được nhiều hơn một quyết định.
> - `src/main/analyzers/categories.js`, `src/main/ipc.js`, `src/renderer/*`, `src/i18n/vi.js`.
> - `src/main/lib/util.js` — `skipReason` nhận `includeNoiseDirs`, chỉ F2 dùng.
>
> Harness: `scripts/test-folder-dupes.js` **mới, 42 kiểm tra** (`npm run test:folderdupes`, đã vào `npm test`) — nửa đầu là danh sách tệp dựng sẵn, nửa sau là thư mục thật trên `D:` chạy cả pipeline; 11 kiểm tra trong `smoke.js`; 1 trong `test-a11y.js` (axe soi cả ba theme). `scripts/shoot-folder-dupes.js` chụp 9 ảnh: hai theme, cửa sổ hẹp, tiếng Việt, và màn bị từ chối trên Free.
>
> **Khác đặc tả — bốn chỗ:**
>
> 1. **Không có hành động trên cả thư mục.** Đặc tả cho phép `archive`/`quarantine` cả thư mục. `archive` **không có handler nào** trong `actions/handlers.js` (nó là B5, Giai đoạn 4), còn `quarantine.js:247` là `allowsFolders: false` y như `recycle.js:129`. Nên dòng thư mục là **tiêu đề, `actions: []`**, và thứ bấm được là từng tệp bên trong — đúng nghĩa đen của "giao diện không bao giờ xoá thư mục": app chuyển N tệp vào Thùng rác.
> 2. **Ngược lại với đặc tả về tệp ẩn.** Đặc tả viết *"mặc định có tính file ẩn"*; app thì `ignoreHidden: true` và bỏ `node_modules`/`.git`/`.venv`/`__pycache__` **vô điều kiện** (`util.js:141`). Nếu giữ nguyên, hai thư mục khác nhau đúng ở `.env` sẽ được tuyên bố trùng khớp `certain` — đường mất dữ liệu. **Người dùng chốt 2026-09-28: F2 nhìn tất cả.** Giá đã đo: `D:\personal_projects` 15.518 → 87.371 tệp, 5,9 → 21,6 s; cả `D:` 173.664 → 464.617 tệp, 41,8 → 79,5 s. Chỉ là giá đi cây — pha hash chỉ chạm thư mục đã khớp hình dạng. **Không thêm công tắc**: một công tắc mà chọn sai thì mất tệp.
> 3. **Chỉ báo thư mục ngoài cùng.** Đặc tả không nói. `A\` trùng `B\` thì `A\sub\` cũng trùng — báo cả hai là đếm đôi, và Space Planner sẽ cộng đôi theo. Đo trên `D:\personal_projects`: 67 thư mục bị loại vì nằm trong một bản sao khác.
> 4. **Có sàn 1 MB, và sàn ấy tự trả giá cho mình.** Đo được: bỏ sàn → **233 nhóm / 307 MB**, 29,2 s; sàn 1 MB → **13 nhóm / 286 MB**, 18,4 s. Tức là 220 dòng nữa để tìm thêm 21 MB. Nhóm nhỏ nhất còn lại 1,3 MB, trung vị 12,8 MB.
>
> **"≥ 90%" tính thế nào:** `số tệp khớp / max(|A|, |B|)` theo **số tệp**. Ngưỡng 0,9 tự nó bắt cặp gần trùng phải có ít nhất 10 tệp bên lớn và 9 bên nhỏ — con số ấy **suy ra từ tỉ lệ** (`nearFloor`) chứ không đặt tay. Tệp chỉ có ở một bên, hoặc cùng đường dẫn mà khác byte, **hiện trong màn so cây nhưng không bao giờ nằm trong danh sách nút bấm chạm tới** — nó chính là thứ sẽ mất.
>
> **Một quyết định nữa, không có trong đặc tả:** một thư mục đã nằm trong nhóm trùng hoàn toàn vẫn được để lại **một đại diện** làm nửa kia của một cặp gần trùng, vì "còn một bản cũ hơn giống 90%" là thứ đáng thấy. Các bản sinh đôi của nó và mọi thứ bên dưới thì loại, nếu không màn hình sẽ lặp lại cùng một phát hiện.
>
> **Đã đo ở quy mô cả ổ:** toàn bộ `D:` — 464.655 tệp → **62.851 thư mục, 5.777 nhóm hình dạng, 3,0 s**, đỉnh **245 MB heap / 419 MB RSS** (phần giữ bộ nhớ: cây, chữ ký hình dạng, sketch; pha hash bị chặn bằng sàn không với tới nên phép đo này chỉ tính phần trong RAM). Đi cây chiếm 19,9 s, tức là phần thư mục **rẻ hơn chính cái walk nuôi nó**.
>
> **Còn mở:** chưa chạy trọn vẹn cả pha hash trên một ổ đầy — `D:\personal_projects` là lần chạy đủ lớn nhất (87.371 tệp, 15.761 thư mục, 9.553 tệp/2,9 GB đã hash, 18,4 s). Sketch gần trùng có trần 200 cặp được đối chiếu, lấy cặp to trước; trên `D:\personal_projects` trần này **đã chạm** (200 đề xuất, giữ lại 2), nên một cặp gần trùng nhỏ hơn trần có thể bị bỏ sót — chưa có số để nói bỏ sót bao nhiêu.

#### F3. Phiên bản tài liệu

| | |
| --- | --- |
| **Gói** | Pro · `pro.dupes.advanced` |

- Gom nhóm theo tên đã chuẩn hoá: bỏ các hậu tố như `_final`, `_v2`, `(1)`, `- Copy`, `bản sao`, ngày tháng trong tên.
- Độ tin cậy **luôn là `guess`**, nâng lên `likely` nếu cùng thư mục và cùng định dạng.
- Mở viewer cạnh nhau (dùng viewer Word/Excel/PDF sẵn có) để người dùng tự xem.
- **Không** có "select all but newest".

**✅ Đã code xong (2026-09-28).** `src/main/lib/doc-versions.js` (thuần, không
đọc tệp nào), pha 5 của `duplicate.js`, mục `dupes.version` trên màn Trùng lặp,
và chế độ hai tệp cạnh nhau trong viewer sẵn có. Chạy được:
`npm run test:docversions` (49 kiểm tra), `npm run shoot:docversions` (10 ảnh),
và 21 kiểm tra nữa trong `npm run test:e2e`.

Chỗ lệch với đặc tả, và vì sao:

1. **Ngày tháng không bị bỏ vô điều kiện.** Đặc tả xếp ngày chung với `_v2`.
   Đếm trước khi viết: 1.755 trong 6.503 tên tài liệu trên máy này có ngày, và
   bỏ ngày đi tạo ra 38 nhóm **chỉ tồn tại vì đã bỏ ngày** — `Log 2026-06-13`
   với `Log 2026-09-26`, mỗi hoá đơn một ngày. Cả 38 đều sai. Nên mỗi tệp mang
   **hai khoá** (có ngày và không ngày), và khoá không ngày chỉ được dùng khi
   trong bộ có thứ khác tự nhận là phiên bản.
2. **Thêm một điều kiện đặc tả không có.** Cùng tên ở hai thư mục không liên
   quan thì không phải bản nháp. Quy tắc trần của đặc tả cho **216 nhóm** trên
   đĩa thật, và **180 trong số đó** chỉ là tên trùng: 143 bản `CHANGELOG.md`
   trong một cache gói Dart, 135 `README.md`, 25 `LICENSE.txt` — tổng 856 tệp.
   Sau khi đòi hỏi "phải có hậu tố, hoặc phải cùng một thư mục": **36 nhóm**,
   19 `likely` / 17 `guess`, gom mất 0,01 giây.
3. **`(n)` và `v2` bị thu hẹp.** 6 trong 27 tên kết thúc bằng `(n)` là năm xuất
   bản (`… -Wiley (2018)`), và 2 trong 26 tên có `v2` là `GPLv3`/`LGPLv3`. Nên
   `(n)` chỉ tính khi n ≤ 99, và `v2` chỉ tính sau một dấu phân cách.
4. **Sàn 4 KB, và nó không đi theo sàn của màn hình.** Ô "kích thước tối thiểu"
   của màn Trùng lặp mặc định 100 KB, mà bản nháp Word hiếm khi to thế. Một
   con số chọn cho câu hỏi "bản sao nào đáng xoá" không được quyết định hộ câu
   hỏi "có những tài liệu nào" — nên khi bật F3, cây thư mục được đi ở sàn 4 KB
   và **nửa tệp của màn hình được lọc lại ra** (đúng mẹo pha thư mục của F2).
5. **Không có `archive`, không có hành động hàng loạt, không tự tích gì.** Mỗi
   dòng phải tự tay tích. Hành động là `recycle`/`quarantine` từng tệp,
   `unattendedEligible: false`, và bộ này **không bao giờ** vào dọn dẹp tự động.

Hai lỗi do **nhìn ảnh chụp màn hình** mới thấy, đã sửa và đã có kiểm tra:
ba bản nháp chép cùng một lúc làm **hai dòng cùng ghi "mới nhất"** (cờ trước đó
là "mtime bằng mtime lớn nhất"); và **Reveal / Mở** trên đầu khung hai tệp bấm
không ra gì, vì chúng dựa vào `viewer.file` mà chế độ so sánh không đặt.

#### F4. Hardlink bản trùng

| | |
| --- | --- |
| **Gói** | Pro·Dev · `pro.dev` |
| **Đối tượng** | P5 |

**Rủi ro cao. Đặt sau cờ ẩn trong Settings → Developer → "Cho phép hardlink".**

- Chỉ áp dụng cho các bản trùng **trên cùng volume NTFS**.
- Hộp thoại xác nhận có đoạn giải thích bắt buộc phải cuộn qua: *"Sau khi hardlink, các bản sao là cùng một file. Sửa một bản sẽ sửa tất cả. Xoá một bản không giải phóng dung lượng cho tới khi xoá hết."*
- Không áp dụng cho file trong thư mục cloud-sync, file trong Photos, hoặc file Office (Office thường lưu bằng cách thay file, làm vỡ hardlink một cách âm thầm [Unverified]).
- Hoàn tác: copy tách từng liên kết ra lại thành file độc lập (cần đủ dung lượng, và phải kiểm tra trước khi hoàn tác).

> **✅ Đã code xong (2026-10-01).**
>
> Code:
> - `src/main/lib/hardlink.js` — **mới**. Danh tính tệp (`dev`+`ino` đọc bằng `bigint`), tạo liên kết, và **tách liên kết** (chép cạnh bên → đối chiếu sha256 → `rename` đè lên, một lệnh, nên đường dẫn không bao giờ trỏ vào khoảng trống). Giữ ADS.
> - `src/main/actions/hardlink.js` — **mới**. Handler thứ 9; từ nay **mọi kind trong contract đều có handler** (`test-actions.js` kiểm điều này). `freesOnVolume() === true`, `reversible: 'journal'`, `undo` có `inPlace`.
> - `src/main/lib/duplicate.js` + `lib/scanner.js` — engine biết tới inode (xem bên dưới).
> - `src/main/analyzers/duplicates.js`, `actions/handlers.js`, `actions/restore.js`, `ipc.js`, `preload.js`, `lib/settings.js` (**v11**).
> - `src/renderer/hardlink.js` **mới** + thẻ **Cài đặt → Nhà phát triển** + hộp thoại `<dialog>` + `styles.css` + 57 khoá `vi.js`.
>
> Harness: `scripts/test-hardlink.js` (**67 kiểm tra**, trong `npm test`), 22 kiểm tra trong `smoke.js`, `npm run shoot:hardlink` (22 ảnh). `npm test` **2.789/0** (59 bộ), `test:e2e` **569/0**, `test:a11y` **188/0**.
>
> **Câu `[Unverified]` về Office: đã đo, đúng — nhưng đặc tả nói sai hệ quả.** Word/Excel 16.0.20326, `.docx` do chính Word tạo, trên `D:` (NTFS). Sau **một** lần `Save()` bình thường: `report.docx` đổi `ino 562949954013800 → 281474977303146`, `nlink 2 → 1`; `report-link.docx` **giữ ino cũ, byte cũ, mtime cũ** (13.457 B so với 13.540 B). Excel y hệt (`ino …147 → …148`). Không lỗi, không cảnh báo. Nhưng câu bắt buộc của đặc tả — *"Sửa một bản sẽ sửa tất cả"* — **sai với tệp Office**: sửa một bản thì bản kia đứng im ở nội dung cũ, liên kết tan, dung lượng lặng lẽ quay lại. Một cảnh báo sai theo hướng trấn an còn tệ hơn không cảnh báo, nên hộp thoại nói **cả hai** điều: câu của đặc tả, và một đoạn riêng kể đúng phép đo này.
>
> **Luật thật không phải "Office" mà là "lưu bằng cách thay tệp".** Đo 4 kiểu lưu trên cùng một cặp liên kết: ghi đè tại chỗ `nlink` **giữ 2**, append **giữ 2**, tệp tạm + `rename` **rớt về 1**, xoá rồi tạo lại **rớt về 1**. Nên danh sách đuôi chỉ là **đại diện** cho một luật nó không diễn đạt được — mọi trình soạn thảo "lưu nguyên tử" đều làm đứt, kể cả `lib/atomic.js` của chính app này. Người dùng chốt **không mở rộng danh sách bằng phỏng đoán** (2026-10-01); thay vào đó hộp thoại **nói thẳng giới hạn đó ra** thay vì để danh sách trông như đã đầy đủ.
>
> **Chỗ hở lớn nhất, đặc tả không nhắc, và là lý do mục này đụng vào máy móc dùng chung.** `lib/duplicate.js` gom theo kích thước rồi SHA-256 và **không một dòng nào đọc `ino` hay `nlink`**. Nghĩa là sau khi hardlink, lượt quét sau vẫn thấy đúng nhóm đó, vẫn cộng vào "Reclaimable", và xoá một bản **giải phóng 0 byte** — F4 sẽ tự tạo ra tình huống khiến màn Trùng lặp nói dối ở mọi lượt quét tiếp theo. Người dùng chốt **sửa** (2026-10-01): `collectFiles` mang theo `nlink` (**miễn phí** — đã nằm trên `lstat` mà lượt đi cây vẫn trả tiền), và một pha 3b đọc lại `ino` **chỉ cho những nhóm có tệp nhiều hơn một tên**. Mỗi nhóm nay mang `distinctFiles`, và **mọi con số về dung lượng đếm tệp chứ không đếm dòng**. Đo trên fixture 3 nhóm: 3 bản rời = 400 KB lãng phí, 3 tên một tệp = **0 KB**, 4 tên 2 tệp = 200 KB.
>
> **Hoàn tác nằm ở Trung tâm khôi phục** (người dùng chốt 2026-10-01, phương án A). Thêm trạng thái `linked` vào `RESTORABLE`. Nhưng nó là trạng thái **khác hẳn** mọi trạng thái còn lại: tệp chưa từng rời chỗ. Nên `hardlink.undo` khai `inPlace`, và `restore.js` **bỏ qua phép kiểm "có gì đang chắn chỗ"** cho loại này — không bỏ thì mọi mục đều bị tính là xung đột và, với mặc định `skip`, **hoàn tác âm thầm không làm gì cả**.
>
> **Hoàn tác trả lại sự tách rời, không trả lại nội dung cũ.** Byte cũ của bản sao đã mất ngay lúc tạo liên kết, và không gì trong app hay trong NTFS giữ chúng. Nếu có chương trình ghi tại chỗ trong lúc còn liên kết thì mọi tên mang nội dung mới, và tách ra là mỗi tên một bản **của nội dung mới**. `splitOff` trả `changed: true` khi hash lệch với hash lúc nối, và hộp thoại lẫn Trung tâm khôi phục đều nói điều này thành câu.
>
> **Ba cổng, không cổng nào nằm trong cửa sổ.** (1) `pro.dev` — `execute` kiểm. (2) Cờ ẩn `developer.hardlink`, tắt sẵn — `ipc.js` kiểm, vì đây là *cài đặt* và handler không có việc gì đọc tệp cài đặt. (3) `options.acknowledged`, chỉ hộp thoại đã cuộn hết mới đặt — **`apply` từ chối nếu thiếu**, nên một caller bỏ qua hộp thoại thì không nối được gì. Từ chối vì cờ tắt **nói thành lời**, không âm thầm.
>
> **Hộp thoại là cái duy nhất trong app không phải message box của Windows.** Đặc tả đòi "phải cuộn hết mới bấm được"; `dialog.showMessageBox` không làm được (E2 đã xác lập: ngoài các nút, nó chỉ chứa nổi **một** checkbox). Nên nó là `<dialog>` HTML trong cửa sổ. Cổng là *cuộn tới cuối*, cố ý không phải ô tick "tôi đã đọc" — một ô tick là một cú bấm dù có đọc hay không. Thân hộp thoại vừa đủ để không cần cuộn thì tính là đã đọc, nếu không thì nút sẽ **không bao giờ** bật được.
>
> **Không bao giờ tin cửa sổ về chuyện hai tệp giống nhau.** Cửa sổ gửi các *cặp* vì màn Trùng lặp là nơi biết về nhóm, nhưng một hash từ lượt quét vài phút trước là lời khai về tệp *lúc đó* — nối dựa trên lời khai cũ là **phá huỷ nội dung bản sao**. Nên `plan` tự đọc và tự băm cả hai ngay trước khi nối, và `apply` đọc lại lần nữa (giữa `plan` và `apply` có một hộp thoại người ta có thể để mở rất lâu).
>
> **Đo được, đáng ghi:** hardlink **không cần quyền quản trị** — `fs.link` chạy được bằng tài khoản thường trên máy này, khác symlink. Nên F4 không bao giờ bật UAC.
>
> **Ảnh chụp bắt được 3 lỗi thật.** (1) Nút thứ ba đẩy **"Chuyển mục đã chọn vào Thùng rác" lòi ra khỏi mép phải ở 1180px** — đúng lớp lỗi E2 đã gặp; nay thanh hành động mang `is-crowded` đúng lúc nút thứ ba xuất hiện. (2) Sau khi nối, tổng "Reclaimable" đã đúng nhưng **từng dòng vẫn chỉ ghi "identical"**, đọc ra vẫn như một bản sao đáng xoá — nay ghi **"một tệp · N tên"**. (3) Trung tâm khôi phục hiện **"hardlink: 3 items"**, tên kind thô chưa dịch, vì `titleOf` rơi vào nhánh `default`. Ngoài ra log e2e bắt được **"1 documents"** trong hộp thoại.
>
> **Chưa làm / còn hở, cố ý:**
> - **Ổ không phải NTFS là `[Unverified]`.** Máy này chỉ có NTFS (C: 474,7 GB, D: 476,9 GB), nên nhánh từ chối chỉ kiểm được bằng dependency injection — giống §11 mục 4.
> - **Cổng "acknowledged" là một cờ do cửa sổ gửi**, nên nó không chống được một cửa sổ nói dối. Nó chống được một *caller mới* quên hộp thoại, và đó là đúng điều nó được dựng để chống.
> - **`titleOf` trong `restore.js` vẫn có nhánh `default` in tên kind thô.** F4 đã có nhánh riêng; `relocate` và `compress` thì chưa — chúng chưa có `undo` nên hiếm khi lên màn, nhưng lỗ thì vẫn còn đó.

---
### Nhóm G — Lập kế hoạch & báo cáo

#### G1. Space Planner

| | |
| --- | --- |
| **Gói** | Pro · `pro.planner` |
| **Đối tượng** | P1 |
| **Vấn đề** | Người dùng biết mình cần bao nhiêu dung lượng trống, nhưng không biết lấy từ đâu cho hợp lý |

**Hành vi:**
1. Người dùng nhập mục tiêu: *"Tôi cần thêm 30 GB trên C:"* hoặc *"Đưa C: về dưới 80%"*.
2. Planner dựng một **kế hoạch theo từng bước**, sắp theo rủi ro tăng dần:

| Bước | Nguồn | Rủi ro |
| --- | --- | --- |
| 1 | `safe` cache, temp, log (What to delete, D4) | Thấp nhất |
| 2 | OneDrive dehydrate (B3) | Thấp, cần mạng để mở lại |
| 3 | Build output, dev cache (C) | Thấp, cần build lại |
| 4 | Quarantine / relocate file lớn ít dùng (B1, B2) | Thấp, có thể hoàn tác |
| 5 | Nén (B4) | Thấp, có thể hoàn tác |
| 6 | `handoff` hệ thống: hiberfil, Windows.old, restore points (A1) | Trung bình, có hệ quả |
| 7 | `review`: installer cũ, archive lớn, trùng lặp | Cần xem xét |
| 8 | App / game không dùng (D1, D2) | Cần xem xét |

3. Mỗi bước hiện số dung lượng **thực sự giải phóng trên volume** (dựa vào `freesOnVolume`). Số tích luỹ được tính tới khi đạt mục tiêu. Các bước còn lại mờ đi nhưng vẫn xem được.
4. **Không có nút "Thực hiện kế hoạch".** Mỗi bước là một liên kết sang đúng màn đó với bộ lọc đã áp sẵn. Người dùng tự tick và tự xác nhận như bình thường.
5. Nếu không đạt được mục tiêu: *"Các nguồn đã biết chỉ giải phóng được 18 GB trong 30 GB. Phần còn lại cần xoá dữ liệu cá nhân — xem Disk usage."*

**Tiến độ:** thanh trên cùng của Planner cập nhật theo dung lượng volume thật sau mỗi hành động (đo lại, không cộng dồn ước tính).

> **✅ Đã code xong (2026-09-28).** Code nằm ở:
> - `src/main/planner/plan.js` — **thuần, không I/O**: nhận candidate của mọi analyzer, trả ra các bước theo rủi ro tăng dần, cộng dồn, và nói kế hoạch chạm mục tiêu ở bước nào.
> - `src/main/ipc.js` — `planner:run` đo từng nguồn rồi **gửi kế hoạch một phần sau mỗi nguồn**; `planner:cancel`, `planner:volume`. Ba kênh invoke mới (66 kênh) và một kênh sự kiện.
> - `src/renderer/planner.js` + tab **Kế hoạch** + `styles.css` + 45 key trong `src/i18n/vi.js`.
>
> Harness: `scripts/test-planner.js` (**30 kiểm tra**, nằm trong `npm test`), `npm run shoot:planner` (8 ảnh, hai theme + tiếng Việt + cửa sổ hẹp).
>
> **Chỗ đặc tả sai, và đây là chỗ quan trọng nhất của mục này.** Đặc tả viết: *"Mỗi bước hiện số dung lượng thực sự giải phóng trên volume (dựa vào `freesOnVolume`)"*. Nhưng `actions/recycle.js` trả `freesOnVolume() === false` — và comment ngay trên nó gọi đó là *"the most important line in the file"*: Thùng rác nằm cùng volume. `actions/handoff.js` cũng `false`. Trong 8 bước đặc tả liệt kê, **5 bước dùng hai action đó**, nên hiểu đúng từng chữ thì Planner hiện **0 GB cho 5/8 bước và không bao giờ đạt mục tiêu**.
>
> Cách sửa: mỗi bước mang **ba** con số thay vì một, và mỗi con số nói rõ dung lượng quay về **bằng đường nào** — `freesNow` (ngay: dehydrate), `afterBin` (vào Thùng rác, thật khi dọn bin), `viaWindows` (Windows làm: hiberfil, Windows.old, restore point, gỡ cài đặt). Và kế hoạch có thêm **một bước của riêng nó: "dọn phần CleanDrive đã bỏ vào Thùng rác"**, đặt ngay sau bước cuối cùng còn bỏ gì vào bin. Tổng cộng dồn **không** tăng ở các bước recycle mà nhảy đúng ở bước đó — vì đó là lúc dung lượng thật sự rời ổ đĩa. Ảnh chụp cho thấy điều này: bước 1 "chuyển 10,1 GB vào Thùng rác", cộng dồn vẫn "0 B trên 30,0 GB".
>
> Khác với đặc tả ở những chỗ còn lại:
> - **Bước 5 của đặc tả (nén, B4) và nửa relocate của bước 4 (B2) không có**, vì cả hai thuộc Giai đoạn 4. Bỏ hẳn chứ không hiện mờ (nguyên tắc D4).
> - **Quarantine không có bước riêng.** Nó là một *action* trên chính những tệp mà bước "lâu không đụng" đã liệt kê, nên cho nó một bước nữa là đếm hai lần cùng một byte.
> - **Duplicates không được đo trong lượt của Planner.** Sàn của nó là 1 KB (`lib/duplicate.js`), nên chạy trên cả ổ nghĩa là **đọc nội dung gần như mọi tệp**; mọi nguồn khác chỉ đọc metadata. Nó nằm trong danh sách "chưa đo" kèm lý do và một đường dẫn sang màn Trùng lặp.
> - **Vùng hệ thống là một ô tick, mặc định tắt.** Người dùng chốt "tự đo hết khi mở Planner" (2026-09-28), nhưng `helper/client.js` ghi rõ *"a UAC prompt the user did not ask for is exactly the kind of thing this app does not do"*. Ô tick chính là cú bấm xin phép, giống hệt công tắc quét nhanh của A2.
> - **Kế hoạch hiện dần.** Đo cả ổ cộng công cụ, chương trình và game là vài phút; main gửi một kế hoạch một phần sau mỗi nguồn, nên màn hình có gì để xem ngay từ nguồn đầu tiên. Dừng giữa chừng vẫn còn kế hoạch của phần đã đo.
> - **Một candidate chỉ thuộc một bước.** Bước có rủi ro thấp hơn lấy trước. Không có luật này thì một tệp vừa `review` vừa trùng lặp sẽ được hứa hẹn hai lần.
> - **Dùng `bytesOnDisk` khi analyzer biết**, không dùng `bytes`. Một placeholder OneDrive 4 GB không nằm trên đĩa này thì giải phóng 0 — có kiểm tra.
> - Nút của mỗi bước cuộn tới đúng nhóm trên màn đích và **không tick gì cả**; việc chọn vẫn là của người dùng.
> - **Thứ tự tab đổi:** Kế hoạch nằm giữa Hệ thống và Danh sách cần xoá — nhìn (Dung lượng, Hệ thống) → quyết (Kế hoạch) → làm (Danh sách cần xoá). `smoke.js` có kiểm tra thứ tự này và nó đã được sửa lại cho đúng chủ ý mới, không phải nới ra.
>
> **Một phép kiểm chống trôi đáng nói:** `test-planner.js` đọc chính các handler trong `actions/*.js` và fail nếu bảng `WHEN` của planner nói khác chúng về việc action nào giải phóng ngay. Planner không thể âm thầm lệch khỏi thứ mà pipeline thật sự làm.
>
> **Chưa làm:** đặc tả nói thanh tiến độ "đo lại dung lượng volume thật sau mỗi hành động". Hiện `planner:volume` đo lại khi có `app:data-changed`, nhưng **chưa ai chạy một lượt xoá thật từ màn khác rồi quay lại xem thanh đó nhúc nhích** — [Unverified].


---

#### G2. Báo cáo HTML

| | |
| --- | --- |
| **Gói** | Pro · `pro.reports` |
| **Đối tượng** | P1 (gửi người nhà hoặc thợ sửa máy), P6 |

- Xuất **một file HTML tự chứa**: không script bên ngoài, không request mạng, CSS nội tuyến, biểu đồ SVG nội tuyến, dữ liệu gốc nhúng dưới dạng JSON trong `<script type="application/json">` để có thể trích xuất lại.
- Nội dung có thể chọn: tổng quan volume, bóc tách hệ thống, top thư mục, trends, diff, lịch sử hành động.
- **Chế độ riêng tư:** tuỳ chọn thay đường dẫn bằng tên chung (*"Thư mục 1"*) và ẩn tên file, bật mặc định khi báo cáo có chứa danh sách file.
- JSON và CSV hiện có vẫn giữ nguyên, và vẫn miễn phí.

> **✅ Đã code xong (2026-09-28).**
>
> Code:
> - `src/main/report/html.js` — **mới**, thuần, không I/O: nhận dữ liệu, trả về một chuỗi HTML. CSS nội tuyến, SVG nội tuyến dựng bằng chuỗi, JSON nhúng. Không `<link>`, không `src=`, không `@import`, không `url()` — đo bằng test.
> - `src/main/report/redact.js` — **mới**. Bí danh **ổn định** và **giữ cây**: cùng một thư mục đọc ra cùng một tên ở mọi chỗ, và `Thư mục 3\Thư mục 6` vẫn nằm trong `Thư mục 3`.
> - `src/main/report/collect.js` — **mới**. Gom từ những thứ app **đã đo và đã ghi**: `history.json`, kho snapshot, journal, danh sách ổ.
> - `src/main/ipc.js` (+ manifest, preload), `src/renderer/report.js` **mới**, `index.html`, `styles.css`, `src/i18n/vi.js` (88 khoá).
>
> Harness: `scripts/test-report.js` **mới, 46 kiểm tra** (`npm run test:report`, đã vào `npm test`); 14 trong `smoke.js`; 2 trong `test-a11y.js`. `scripts/shoot-report.js` chụp cả hộp thoại **và bản báo cáo thật**, mở trong một cửa sổ thứ hai. `npm test` **2.269/0** (50 bộ), `test:e2e` **449/0**, a11y **176/0**.
>
> **Khác đặc tả — bốn chỗ:**
>
> 1. **Chế độ riêng tư che luôn khối JSON.** Đặc tả đòi hai thứ trong cùng một tệp: thay đường dẫn bằng tên chung, **và** nhúng "dữ liệu gốc" để trích xuất lại. Đọc đúng chữ thì chúng triệt tiêu nhau — ai mở khối JSON là có lại đường dẫn thật, và "riêng tư" chỉ còn là cái nhãn. Nên việc che xảy ra **trước khi dựng trang**, và JSON trong tệp là dữ liệu đã che. Không có bản thứ hai.
> 2. **Tên máy cũng bị che.** Đặc tả không nhắc tới vì nó không phải đường dẫn, nhưng "DUNG-PC" chỉ đích danh một người chẳng kém gì một thư mục trong hồ sơ người dùng — mà cả điểm của chế độ này là một tệp gửi đi được.
> 3. **Không tự đo gì để lấp chỗ trống.** Mục "bóc tách hệ thống" chỉ có nếu đã bấm đo ở màn Hệ thống trong phiên này: kết quả ấy **chỉ nằm trong RAM** (`ipc.js` `systemState`), và một nút "Lưu báo cáo" không được phép đi quét cả ổ hay bật hộp UAC. Mục nào chưa có thì báo cáo nói rõ là chưa có, kèm tên màn hình cần mở.
> 4. **Nhãn các dòng của mục hệ thống do cửa sổ gửi sang.** Chúng chỉ tồn tại trong `renderer/system.js`, nơi `test:i18n` đọc được key literal; chép 20 chuỗi ấy sang tiến trình chính là đặt từ vựng của app ở hai nơi, và bản thứ hai là bản sẽ lạc hậu.
>
> **Hai lỗi thật tìm được khi chạy:**
> - `chart()` **ném lỗi** trên một lần đo thiếu `usedPercent` — mà tệp lịch sử do bản cũ ghi, hoặc sửa tay, đúng là thứ báo cáo được yêu cầu mô tả. Nay dòng hỏng bị bỏ, và nếu còn quá ít thì mục nói lý do thay vì gục.
> - Cột "Do ai đo" **luôn rỗng**: `volumeSeries` trải các trường của volume, còn `source` nằm ở snapshot bao ngoài. Nay tra ngược lại.
>
> **Đo được, và nó đổi cả tiền đề của test:** Windows **chấp nhận** `&` và `'` trong tên tệp, **từ chối** `"` và `<`. Nên `</script>` không thể đến từ một tên tệp — nhưng `&` thì có, và nếu không escape thì nó nuốt luôn phần sau. Test ghi rõ chuỗi nào là thật và chuỗi nào là để thử cho chắc.
>
> **Nút đặt cạnh Export JSON/CSV trên màn Xu hướng** (đặc tả không nói chỗ). JSON và CSV **không đổi một dòng nào** và vẫn miễn phí, đúng như đặc tả đòi.

---

#### G3. Tóm tắt định kỳ

| | |
| --- | --- |
| **Gói** | Pro · `pro.reports` |
| **Phụ thuộc** | A5, Trends |

- Tuỳ chọn thông báo hàng tuần hoặc hàng tháng qua tray / Windows notification: *"Tháng 9: C: tăng 6,2 GB. Lớn nhất: Zalo +2,1 GB, Downloads +1,8 GB."*
- **Chỉ gửi khi có đủ dữ liệu** (theo đúng quy tắc từ chối của Trends). Nếu không đủ thì không gửi gì. Không có thông báo kiểu "nhắc bạn mở app".
- Bấm vào thông báo thì mở màn Diff. **Không** bắt đầu cleanup (giữ nguyên quy tắc hiện có).
- Không bao giờ chứa nội dung upsell.

> **✅ Đã code xong (2026-09-28).**
>
> Code:
> - `src/main/recap.js` — **mới**, thuần, không I/O: nhận history + settings + `now`, trả về "có tới hạn không, và nó sẽ nói gì". Mọi luật nằm ở đây nên test được hết mà không cần cửa sổ.
> - `src/main/sample-only.js` — quyết định **trước** `whenReady`, chỉ khởi động Chromium khi thật sự có gì để nói.
> - `src/main/launch-target.js` — thêm `kind: 'changes'`, **không mang đường dẫn**.
> - `src/main/lib/settings.js` — **schema v8**: `trends.recap` (`off`/`weekly`/`monthly`, mặc định off) và `trends.recapLastAt`.
> - `src/renderer/trends.js` + `index.html` + `changes.js` (`openBest`), `src/main/ipc.js`, `src/i18n/vi.js` (17 khoá).
>
> Harness: `scripts/test-recap.js` **mới, 34 kiểm tra** (`npm run test:recap`, đã vào `npm test`); 10 trong `smoke.js`. `scripts/shoot-recap.js` chụp 6 ảnh và **in ra đúng câu sẽ hiện**. `npm test` **2.307/0** (51 bộ), `test:e2e` **459/0**.
>
> **Khác đặc tả — ba chỗ:**
>
> 1. **Nó cưỡi trên phép đo hằng ngày, và cần phép đo ấy.** Chỉ có hai thứ trong app chạy khi cửa sổ đóng. Cái kia là tác vụ dọn dẹp — gắn vào đó nghĩa là *"muốn có tóm tắt hằng tháng thì phải cho app xoá tệp lúc 2h sáng"*, đúng cái đánh đổi mà comment đầu `sample-only.js` nói đã từ chối. Một tác vụ Windows thứ ba là thêm một thứ để đăng ký, kiểm, sửa và quét, cho một việc **không có công việc của riêng nó** — nó chỉ đọc thứ mà tiến trình kia vừa ghi. Giao diện nói thẳng chỗ phụ thuộc này, và cảnh báo khi bật tóm tắt mà tắt phép đo.
> 2. **Quyết định đứng trước `whenReady`.** Hiện thông báo cần Chromium — một tiến trình trình duyệt, một tiến trình GPU, vài chục MB — mà cả lý do tồn tại của `sample-only.js` là *không* làm thế. Nên nó quyết định trên phía Node từ history đã nạp sẵn, và chỉ khởi động Chromium vào một ngày trong bảy hoặc hai mươi tám. **Đo được:** ngày thường **612 / 712 / 753 ms**, đúng khoảng 672 ms mà tài liệu đã ghi.
> 3. **Ví dụ của đặc tả đòi dữ liệu sampler không có.** *"Lớn nhất: Zalo +2,1 GB, Downloads +1,8 GB"* là các thư mục **bên trong** một gốc — thứ đó đến từ diff snapshot, cần hai lần quét tay. Sampler chỉ đọc chỗ trống, không thu cây. Nên tóm tắt nói **tăng trưởng của ổ** (luôn có) và **các gốc đã quét phình nhanh nhất** (khi có hai lần quét), và bỏ hẳn vế thứ hai khi không có gì để điền — chứ không viết "Lớn nhất: không có", đọc như một lỗi.
>
> **Ba quyết định nhỏ, ghi ra để khỏi bị coi là ngẫu nhiên:** "hằng tháng" là **28 ngày** chứ không phải 30, để nó rơi đúng thứ trong tuần thay vì trôi; lần đầu tiên **đợi trọn một kỳ** kể từ phép đo đầu, vì tóm tắt của hư không không phải tóm tắt; và `recapLastAt` chỉ ghi khi **thật sự có gì hiện ra**, nên một lượt không hiện được sẽ thử lại hôm sau chứ không bỏ cả kỳ.
>
> **Luật từ chối là luật của Trends, không phải ý kiến thứ hai:** `historyLib.growth()` đòi **≥ 4 phép đo trong ≥ 7 ngày**. Không đủ thì **không hiện gì** — không có thông báo kiểu "mở app lên xem". Harness kiểm cả "ba phép đo dù cách nhau 20 ngày cũng không phải xu hướng" và "sáu phép đo trong nửa ngày cũng không".
>
> **Không upsell**, và có một kiểm tra regex tìm *pro / upgrade / unlock / buy / trial / premium / licence* trong câu, để nó là tính chất của mã chứ không phải thói quen của người viết.

---

#### G4. Nhiều hồ sơ tự động

| | |
| --- | --- |
| **Gói** | Free (1 hồ sơ, như hiện tại) · Pro `pro.automatic.profiles` (không giới hạn) |
| **Đối tượng** | P1, P5, P6 |

- Mỗi hồ sơ có đầy đủ bộ control hiện có (tần suất, danh mục, tuổi, ngưỡng đĩa, giới hạn, gốc, whitelist, app đang mở), cộng thêm **hành động**: `recycle` (mặc định) hoặc `quarantine` (Pro, cần B1).
- Mỗi hồ sơ là **một scheduled task riêng**, với tên có hậu tố hồ sơ. Màn Automatic hiện trạng thái Windows Task của từng hồ sơ (giống hiện tại).
- Mọi hồ sơ mới đều bắt đầu ở **report-only**.
- Không có hai hồ sơ nào được chạy cùng lúc. Có một khoá toàn cục (mutex có tên) và hồ sơ đến sau sẽ chờ hoặc bỏ lượt, ghi lý do vào log.

**Mẫu hồ sơ gợi ý** (người dùng vẫn phải lưu và vẫn bắt đầu ở report-only):
- *Cache hàng tuần*: temp, cache trình duyệt, cache app, ≥ 7 ngày.
- *Installer hàng tháng*: installer ≥ 30 ngày trong Downloads.
- *Dev hàng tháng* (Pro·Dev): build output ≥ 60 ngày.

> **✅ Đã code xong (2026-09-28).**
>
> Code:
> - `src/main/lib/settings.js` — **schema v7**. `autoClean` giờ chỉ còn `profiles: [...]`; mỗi hồ sơ mang **trọn** một chính sách, không có kiểu "cài đặt chung cộng phần hồ sơ ghi đè". Migration 6→7 biến chính sách cũ thành hồ sơ đầu tiên, **id cố định `main`** để task Windows người dùng đã có không bị mồ côi.
> - `src/main/lib/runlock.js` — **mới**. Khoá liên tiến trình bằng `open(..., 'wx')`, có pid + thời điểm, tự nhận ra khoá của tiến trình đã chết và khoá quá hạn.
> - `src/main/lib/scheduler.js` — `cleanupTaskPath(profileId)`, `profileOfTaskName()`, `listCleanupTasks()` (liệt kê qua COM `Schedule.Service`).
> - `src/main/tasks.js` — `reconcile` lặp qua từng hồ sơ; `sweepOrphans` gỡ task của hồ sơ đã xoá.
> - `src/main/lib/autoclean.js` — nhận `profile`, hiểu `action`, và **từ chối** quarantine khi chưa có zone hoặc ổ không cắm.
> - `src/main/scheduled-run.js` — đọc `--profile=<id>`, lấy khoá, trả khoá trong `finally`.
> - `src/main/ipc.js` (+ manifest, preload), `src/renderer/automatic.js` + `index.html` + `styles.css`, `src/i18n/vi.js`.
>
> Harness: `scripts/test-profiles.js` **mới, 40 kiểm tra** (`npm run test:profiles`, đã vào `npm test`) — tầng settings, quy tắc đặt tên task, và khoá **với một tiến trình thật thứ hai** (`fork`); 12 kiểm tra trong `smoke.js`. `scripts/shoot-profiles.js` chụp 8 ảnh. `npm test` **2.227/0** (49 bộ), `test:e2e` **435/0**, a11y/onboarding/explorer/idle/i18n đều pass.
>
> **Khác đặc tả — bốn chỗ:**
>
> 1. **"Mutex có tên" không tồn tại.** Node và Electron không có. Thay bằng tệp khoá trong `userData`, làm đúng việc đó trên Windows vì `open(..., 'wx')` để **hệ điều hành** quyết ai thắng. Không dùng `requestSingleInstanceLock` được: `main.js:239-249` cố ý không lấy khoá đó cho lượt chạy theo lịch, vì nếu lấy thì dọn dẹp sẽ bị huỷ mọi đêm người dùng mở app. **Lý do cụ thể hơn đặc tả đưa ra:** `RunLog.append` đọc cả tệp rồi ghi đè nguyên tệp — hai lượt song song làm **mất hẳn** bản ghi của một lượt.
> 2. **"chờ hoặc bỏ lượt" → chờ có giới hạn 90 giây rồi bỏ lượt**, ghi lý do vào nhật ký. Chờ vô hạn trong một tiến trình của Task Scheduler là một tiến trình treo đến sáng.
> 3. **Mẫu *Installer hàng tháng* không dựng được.** `installer` **không** nằm trong `automatic/allowed-categories.js`, nên một hồ sơ khai nó sẽ còn **0 danh mục** và không khớp gì. Danh sách trắng ấy là luật cứng, được kiểm hai lần (`contract.js`), và nó đúng: một bộ cài là thứ người ta có thể muốn giữ. Hai mẫu còn lại dựng được.
> 4. **`deleteOriginal` là cờ **riêng của từng hồ sơ**** (người dùng chốt 2026-09-28), không dùng chung `quarantine.deleteOriginal` — vì cờ toàn cục ấy là thứ **nút bấm trên màn hình** dùng, và Giai đoạn 1 mục 5 đã cố ý để nó tắt. Một hồ sơ cần bật nó không được với tay sang đổi hành vi của cái nút kia.
>
> **Ba lỗi thật do harness bắt được, không phải lỗi test:**
> - Migration 6→7 **bọc lại dữ liệu đã ở dạng mới**: một object settings không có `version` bị coi là v1 và đi qua mọi bước, nên `coerceSettings` trả về **hai** hồ sơ, một cái rỗng. Nay bước này idempotent.
> - `coerceProfileId('p!!!@@@')` trả về `'p'` — một id **không** khớp `PROFILE_ID_PATTERN`, nên task của nó sẽ không bao giờ được `profileOfTaskName` nhận ra và **sweep sẽ không bao giờ gỡ nó**. Nay id phải đi trọn vòng qua tên task rồi quay lại, nếu không thì sinh id mới.
> - Tệp khoá **đọc không được bị coi là không có ai giữ** — đúng chiều nguy hiểm, vì một khoá đang được ghi dở cũng đọc không được. Nay tuổi lấy từ `mtime` của tệp khi nội dung không nói được.
>
> **Quét task mồ côi chỉ chạy khi cần.** Liệt kê thư mục `\CleanDrive` tốn một tiến trình PowerShell (~3 giây), và lúc đầu tôi đặt nó vào **mọi** lần lưu — khiến màn Automatic chậm hẳn. Nay chỉ chạy khi **khởi động**, khi **xoá hồ sơ**, và khi bấm **Kiểm tra** — đó là mọi đường một task có thể thành mồ côi.
>
> **Quét chỉ chạm task cùng hậu tố.** Đo được trên máy này: thư mục `\CleanDrive` đang có `DiskSample`, `DiskSample_dev`, `DiskSample_explorer`, `DiskSample_shootq` — ba cái sau là harness bỏ lại. `profileOfTaskName` **từ chối đoán** một tên nhập nhằng (`AutomaticCleanup_dev` là hồ sơ "dev" hay hậu tố "dev"?), nên không cái nào trong ba cái đó bị đụng tới.

---

### Nhóm H — Doanh nghiệp / IT

#### H1. CLI

| | |
| --- | --- |
| **Gói** | Business · `biz.cli` |
| **Đối tượng** | P5, P6 |

```text
cleandrive scan <path...> [--mft] [--json] [--snapshot]
cleandrive suggest <path...> [--category <c>] [--verdict safe|review] [--json]
cleandrive diff <snapshotA> <snapshotB> [--json]
cleandrive system [--json]                  # A1, cần chạy với quyền admin
cleandrive policy validate <file>
cleandrive policy apply <file>              # đăng ký scheduled task theo policy
cleandrive run --profile <name> [--report-only]
cleandrive journal list|show <session> [--json]
cleandrive restore <session> [--dry-run]
```

**Quy tắc:**
- CLI **không có lệnh xoá tự do** kiểu `cleandrive delete <path>`. Hành động chỉ xảy ra qua `run --profile`, tức là qua đúng các gate của Automatic.
- `--json` có schema được version hoá (`"schema": "cleandrive.scan/1"`).
- Mã thoát có tài liệu: `0` OK, `2` bị từ chối do gate, `3` license, `4` cần quyền admin, `5` bị dừng.
- CLI dùng cùng binary với app (`CleanDrive.exe --cli`) để chữ ký số áp dụng cho cả hai.

> **✅ Đã code xong (2026-10-01).** Code ở `src/main/cli/` (`args.js` bảng lệnh và bộ đọc tham số, `index.js` gate licence và mã thoát, `output.js` JSON ASCII, `context.js`, `shim.js`, `commands/*.js`), `src/main/scan-session.js` (**chuỗi quét tách ra khỏi `scan:run`** để cửa sổ và CLI chạy đúng một phép quét), nhánh `--cli` đầu tiên trong `main.js`, `run.session` trong `lib/autoclean.js`, nhãn "từ dòng lệnh" ở `renderer/restore.js` và `renderer/automatic.js`, `build.js` ship `bin\cleandrive.cmd`. Harness: `scripts/test-cli.js` (**101 kiểm tra**, trong `npm test`: mọi lệnh chạy trên module thật dưới Node thường, fixture trên D:), `scripts/verify-cli.js` (tiến trình thật: **39** trên checkout, **15** trên bản build `stable`, **35** trên bản build kênh `dev`), ảnh chụp `npm run shoot:cli` (12 ảnh). Harness **đã được chứng minh là bắt được lỗi**: cài lại `process.exitCode` + `app.quit()` vào nhánh CLI thì `verify-cli` FAIL 8, `test-cli` FAIL 1. **Đo trước khi thiết kế** (probe app riêng, cả `electron.exe` lẫn `CleanDrive.exe` thật, console thật đọc lại từ bộ đệm màn hình) — và các con số đó định hình mọi thứ dưới đây:
>
> - **Exe là GUI subsystem.** PowerShell gõ thẳng **không chờ** (trả prompt sau 9 ms, `$LASTEXITCODE` rỗng); `$x = & CleanDrive.exe --cli …` **không bắt được gì**; cmd tương tác cũng không chờ (`errorlevel=0`). `cmd /c`, tệp `.cmd` và `Start-Process -Wait` thì chờ và trả đúng mã. Nên **người dùng gọi qua `bin\cleandrive.cmd`** (hai dòng, không logic; thứ chạy vẫn là exe đã ký). Nó phải nằm trong `bin\`: PATHEXT xếp `.EXE` trước `.CMD`, đặt cạnh exe thì gõ `cleandrive` mở cửa sổ. **Không đụng PATH** (người dùng chốt): không chạy được installer thật để kiểm. Không dựa vào `ELECTRON_RUN_AS_NODE` — fuse `RunAsNode` đang bật ở bản phát hành và Giai đoạn 7 nên tắt nó (§11 mục 26); shim còn xoá biến đó cho chính nó.
> - **`process.exitCode = n; app.quit()` thoát với 0**, chỉ `app.exit(n)` trả `n`. CLI thoát bằng `app.exit(code)`. Phép đo này lộ ra lỗi có sẵn ở lượt chạy 02:00 — đã sửa riêng trước (§11 mục 22).
> - **Ctrl+C giết thẳng Electron** (`0xC000013A`), handler `SIGINT` không bao giờ chạy (đối chứng Node thường: chạy và trả 5). Nên **mã 5 không bao giờ là Ctrl+C**: nó là "bắt đầu hành động rồi dừng giữa chừng" (không ghi được journal). Qua `.cmd`, cmd còn hỏi *Terminate batch job (Y/N)?* — ghi vào README.
> - **stdout trong console thật là kiểu `fs`, không phải TTY**; tiếng Việt UTF-8 ở code page 437 thành `tiß║┐ng Viß╗çt`, và đổi code page từ bên trong **không ăn** (thử hai cách), mở lại `CONOUT$` thì lỗi. Nên **CLI in tiếng Anh** (người dùng chốt) và **`--json` chỉ ASCII** (`\uXXXX`): đi qua `ConvertFrom-Json` ra đúng `Ảnh của tôi`, đối chiếu từng code point.
>
> **Khác đặc tả:**
>
> 1. **Business vẫn đóng trên bản stable** (người dùng chốt, nhất quán với H4). Trên bản cài, `scan`, `suggest`, `snapshots`, `diff`, `system`, `profiles`, `run` trả **3** kèm một câu trên stderr, không bao giờ chạy phần nhỏ hơn thay vào. **`journal list|show|verify`, `restore`, `version`, `help` không bao giờ hỏi licence** — đặc tả gắn cả CLI vào `biz.cli`, nhưng quy tắc 4 (§2) nói khôi phục có ở mọi gói, và H4 đã chốt việc kiểm là đọc. Hai module đó **không nạp** module licence (`test-entitlements.js` kiểm), và bảng lệnh được kiểm: mọi lệnh khác đều là `biz.cli`.
> 2. **`policy validate|apply` không có ở H1**, sang H2: chưa có schema policy thì hai lệnh ấy là vỏ rỗng. `test:dead` **không** bắt được loại tính năng chết này (nó quét preload, IPC, sự kiện, action, tab — một lệnh CLI không thuộc loại nào), nên ghi ở đây và ở H2.
> 3. **Mã thoát thêm hai:** `6` khi `journal verify` thấy phiên đã niêm phong bị sửa, xoá hay trùng số (đúng tiêu chí màn Khôi phục; phiên chưa từng niêm phong không phải phát hiện), và `64` khi dòng lệnh không chỉ tới thứ gì làm được. `1` là lỗi không lường trước — đặc tả chưa có.
> 4. **Hai lệnh đặc tả không có:** `profiles` (vì `run --profile <name>` không dùng được — tên hồ sơ đầu tiên là `null` có chủ đích, màn hình gọi nó theo ngôn ngữ người đọc; **id** mới là thứ luôn có, nên `run` nhận id) và `snapshots` (vì `diff <A> <B>` cần id mà không lệnh nào in ra). Id snapshot là khoá thư mục trong kho + tên tệp, chỉ đọc qua index của kho, không bao giờ thành đường dẫn (harness thử `..\..\Windows`).
> 5. **`run` chặt hơn nút "Chạy ngay"**: hồ sơ đang tắt bị từ chối (2) thay vì chạy luôn — bấm nút là đồng ý tại chỗ, còn dòng lệnh có thể là một script. Hồ sơ report-only vẫn report-only; `--report-only` chỉ hạ một hồ sơ đang chạy thật xuống report. Cùng khoá `runlock`, chờ 90 s như lượt 02:00, ghi vào run log với `via: 'cli'`.
> 6. **`restore` không bao giờ ghi đè**: tệp chắn đường luôn bị bỏ qua và trả 2 — cửa sổ hỏi giữ cả hai / bỏ qua / thay thế vì có người trả lời, ở đây không có ai.
> 7. **`scan` không ghi gì nếu không có `--snapshot`**, kể cả điểm Trends mà cửa sổ ghi mỗi lần quét. **`scan --mft` chặt hơn công tắc Quét nhanh**: thư mục không phải nguyên một ổ NTFS bị từ chối (2) trước khi đọc gì, thay vì lặng lẽ walk; không có quyền admin là 4; **không bao giờ bật UAC** — CLI có quyền admin thì khởi chạy helper làm tiến trình con (kế thừa quyền), vẫn chỉ danh sách thao tác chỉ-đọc cố định. `system` cũng vậy.
> 8. **Single-instance:** khoá chỉ được xin ở nhánh cửa sổ, và CLI đứng trước mọi nhánh — `verify-cli` chạy CLI khi cửa sổ đang mở: trả 0, cửa sổ không bị đụng. **Lỗ thật tìm thấy khi đối chiếu:** các chế độ được nhận bằng `argv.includes()` và nhánh helper được xét trước tiên, nên `cleandrive scan "--helper"` đã có thể rơi vào nhánh helper. Nay `--cli` phải là tham số đầu tiên, được xét trước, và tắt mọi cờ chế độ khác (`modeArgs`).
> 9. **Màn hình:** phiên journal có `source: 'cli'` trước đây sẽ hiện chữ `cli` trần trụi ở Restore Center, và lượt `run` ghi vào run log khi cửa sổ đang mở sẽ được báo là *"Scheduled cleanup …"*. Nay là *"from the command line" / "từ dòng lệnh"* ở cả hai màn, và không có toast gọi sai tên.
>
> **Phần cần quyền admin** (`npm run verify:cli -- --elevated`, người dùng chạy 2026-10-01): **41/1**. `system` đạt **0,10%** chưa giải thích được (ngưỡng 1%). `scan D:\ --mft` **FAIL** — và đó là lỗi có sẵn của A2, không phải của H1: helper thật chạy trong Electron chưa từng đọc được bảng nào (§11 mục 24, đã sửa riêng). Lượt FAIL ấy còn lộ một lỗi của chính H1: câu báo lỗi giấu mất lý do (*"could not be read from its catalogue"*) — nay CLI in kèm lời của helper. **Chạy lại sau bản sửa: 42/0** (§11 mục 25). [Unverified] Hành vi trong Windows Terminal: các phép đo console ở trên chạy trong cửa sổ console ẩn do `Start-Process` mở.

---

#### H2. Policy qua GPO / Intune

| | |
| --- | --- |
| **Gói** | Business · `biz.policy` |

- File **ADMX / ADML** (tiếng Anh và tiếng Việt) ghi vào `HKLM\Software\Policies\CleanDrive`.
- Policy có thể: bắt buộc bật/tắt Automatic, khoá danh mục được phép, khoá whitelist, tắt kiểm tra update, đặt vùng quarantine, tắt hoàn toàn các hành động xoá (chỉ cho xem), đặt đường dẫn xuất báo cáo cho H3.
- Mọi control bị policy khoá đều hiện biểu tượng khoá kèm dòng *"Do tổ chức của bạn quản lý"*.
- Policy **không được phép** vượt qua các guard cứng: `review` vẫn không bao giờ chạy tự động, vùng hệ thống vẫn bị từ chối, và điều kiện purge vẫn là bốn điều kiện.

> **Chuyển từ H1 (2026-10-01):** `cleandrive policy validate <file>` và `cleandrive policy apply <file>` đi cùng mục này, vì chỉ ở đây mới có schema policy cho chúng đọc. Bảng lệnh ở `src/main/cli/args.js`; `test-cli.js` hiện kiểm rằng **chưa có** lệnh `policy` — khi thêm thì đổi phép kiểm đó.

> **✅ Đã code xong (2026-10-02).** Code ở `src/main/policy/` (`schema.js` bảng giá trị duy nhất, `read.js` đọc registry, `interpret.js` từ cây registry ra policy, `effective.js` bản hiệu lực và chiều về tệp, `source.js`, `store.js` lớp bọc `SettingsStore`, `admx.js` sinh ADMX/ADML), `src/main/cli/commands/policy.js`, quyết định `biz.policy` và chọn khoá ở `services.js` (`policy`, `policyKeyFor`), các cổng ở `actions/execute.js`, `lib/autoclean.js`, `ipc.js` (`managedNow`, `policy:state`), `updater.js`, `tasks.js`, `scheduled-run.js`, `cli/commands/run.js`; phía cửa sổ `renderer/managed.js` (dòng thông báo, ổ khoá, `Managed.hold`), `ActionBar` trong `components.js`, `applyManaged` trong `automatic.js`, và các màn media, chat, dev, cloud, hardlink, treemap, updates, quarantine. Tệp cho IT ở `policy/` (`CleanDrive.admx`, `en-US` và `vi-VN\CleanDrive.adml`), `npm run policy:files` viết lại; `build.js` ship chúng thành `<thư mục cài>\policy\`; `.gitattributes` giữ nguyên byte. Harness: `scripts/test-policy.js` (**149 kiểm tra**, trong `npm test`), `scripts/verify-policy.js` (registry thật, Electron thật, Task Scheduler thật: **29/0**; `--elevated` cho người dùng chạy), ảnh `npm run shoot:policy` (**23 ảnh**: hai theme, tiếng Việt và Anh, 1180/720/560). Harness **đã được chứng minh là bắt được lỗi**: cài lần lượt 6 lỗi (bỏ cổng chỉ cho xem trong pipeline, quên trả `enabled` về tệp, bỏ chặn nút update, một lời gọi pipeline thiếu `viewOnly`, thay giá trị sai bằng mặc định, chọn tệp mà không áp trần danh mục) → `test-policy` FAIL cả 6, tệp được trả lại đúng từng byte.
>
> **Đo trước khi thiết kế** (2026-10-01, không nâng quyền):
>
> - `reg export HKLM\SOFTWARE\Policies` chạy được không cần admin, 25–45 ms. Khoá `…\CleanDrive` chưa có: mã 1, 21–26 ms — **cùng mã với "bị từ chối"**, khác nhau chỉ ở câu báo (và câu đó theo ngôn ngữ Windows). Nên khi khoá không đọc được, app hỏi khoá cha: cha đọc được mà không có khoá con thì là "không có policy"; cha cũng không đọc được thì nghi chính `reg.exe` và đọc lại bằng PowerShell.
> - `reg query` làm **mất hẳn** tiếng Việt: `Thư mục của tôi — Ảnh` thành `Thu m?c c?a ti - ?nh`. `reg export` ghi UTF-16 và giữ nguyên. REG_EXPAND_SZ ra `hex(2)`, REG_MULTI_SZ ra `hex(7)` — ADMX chỉ dùng phần tử `list` (REG_SZ/REG_EXPAND_SZ) nên không cần giải `hex(7)`.
> - `HKLM\SOFTWARE\WOW6432Node\Policies` là **một khoá riêng**, nội dung khác (11.064 so với 9.828 ký tự) → luôn truyền `/reg:64`.
> - Người dùng **không ghi được** `HKCU\Software\Policies\*`, và không tạo được `HKCU\…\CurrentVersion\Policies\System` (nơi đặt `DisableRegistryTools`). Hệ quả tốt: người dùng thường không tự bịt mắt bộ đọc được. Hệ quả cho harness: khoá thử nằm ở `HKCU\Software\CleanDrive-Harness\…`, ngoài mọi nhánh `Policies`.
> - **`reg.exe` bị chặn bởi `DisableRegistryTools`** — đo được (người dùng chạy `verify:policy -- --elevated`, 2026-10-02): đặt giá trị 1 hay 2 cho tài khoản thì `reg export` trả **mã 1** kèm *"ERROR: Registry editing has been disabled by your administrator."*, và app vẫn đọc được policy **qua PowerShell** (`via: powershell`). Nên đường dự phòng PowerShell **ở lại** (đúng điều người dùng chốt: bị chặn thì giữ). Trước lượt đo, chỉ có bằng chứng gián tiếp là câu đó nằm trong `reg.exe.mui`.
> - Khoá do admin tạo dưới `HKLM\SOFTWARE\Policies` **thừa kế quyền đọc của Authenticated Users** (S-1-5-11, `ReadKey`) — đọc từ khoá `Policies\Microsoft` có sẵn trên máy này; lần chạy admin đầu không kiểm được vì `Get-Acl -LiteralPath` của PowerShell 5.1 báo "không tìm thấy" với khoá registry có thật (lỗi của harness, đã sửa).
> - `C:\Windows\PolicyDefinitions` có trên bản Home (33 ADMX, ADML `en-US`/`vi-VN`). **Microsoft dùng hai namespace**: 27/29 ADMX dùng `http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions`, GameDVR và PowerShellExecutionPolicy dùng `http://www.microsoft.com/GroupPolicy/PolicyDefinitions`. Bản đầu tôi chép theo tệp thiểu số; harness so với số đông và bắt được.
>
> **Khác đặc tả:**
>
> 1. **Nửa siết áp dụng ở mọi gói** (người dùng chốt): Business vẫn đóng trên stable, nên ở đó chỉ nửa "làm thay" (hồ sơ của tổ chức, `QuarantineFolder`) bị bỏ qua — **và nói ra** ở dòng thông báo và ở `policy validate` (mã 3). Lý do: một "chỉ cho xem" mà thiếu licence là lặng lẽ mất thì là rào an toàn không có thật (quy tắc 4). Hệ quả đã chấp nhận: Giai đoạn 6 không khoá lại được nửa siết. Không module nào dưới `policy/` nạp licence (`test-entitlements.js` kiểm); `services.js` hỏi `canNow()('biz.policy')` một lần mỗi tiến trình rồi đưa `acting` vào — đúng khuôn H4.
> 2. **"Bắt buộc bật/tắt Automatic"**: từ G4 Automatic là danh sách hồ sơ (`settings.js:411`), và bật mà không có thư mục thì bị tắt lại (`settings.js:825`). Nên *tắt* là tắt mọi hồ sơ; *bật* là **một hồ sơ riêng của tổ chức** (id `policy`), đi qua đúng `coerceSettings` như hồ sơ người dùng, **mặc định chỉ báo cáo** — IT phải bỏ chọn "Report only" mới xoá thật (người dùng chốt) — và luôn báo sau mỗi lượt có chuyển tệp. Một giá trị sai **làm hỏng cả hồ sơ** chứ không bị thay bằng mặc định; chỉ giá trị *thiếu* mới lấy mặc định.
> 3. **"Khoá danh mục" là trần, "khoá whitelist" là cộng thêm** — cả hai chỉ siết. Danh mục chỉ chọn được trong danh sách trắng cứng `allowed-categories.js`, nên không policy nào mở được danh mục mới; `runAutoClean` áp lại trần và thư mục bảo vệ ngay chỗ chọn tệp, cho cả hồ sơ dựng ở nơi khác.
> 4. **"Tắt hoàn toàn hành động xoá" có sáu cửa**: `action:execute`; nút "Chạy ngay" (vốn ép `enabled: true`); lượt 02:00; `cleandrive run`; nút dọn Thùng rác (đi thẳng `purgeRecorded`, không qua `execute()`); và lựa chọn **"Thay thế" của Khôi phục**, vì nó chuyển tệp chắn đường vào Thùng rác. Cả sáu bị chặn; `execute()` từ chối mọi loại trừ `restore` và `handoff`, và một phép kiểm tĩnh đòi **mọi** lời gọi `execute(` trong `src/main` truyền `viewOnly`. "Chỉ cho xem" chặn mọi loại hành động thay đổi tệp, không chỉ xoá. **Vẫn cho**: khôi phục (giữ cả hai / bỏ qua), handoff, bản video nhẹ hơn và lưu báo cáo (chúng chỉ ghi tệp mới) — ghi rõ trong ADML. Lượt chỉ báo cáo vẫn chạy.
> 5. **"Tắt kiểm tra update"** phải chặn cả nút "Kiểm tra ngay": `check({ manual: true })` vốn bỏ qua `enabled` (`updater.js:303`).
> 6. **Vùng quarantine của tổ chức** phải là một thư mục **có sẵn** trên ổ cục bộ; app tạo `CleanDrive Quarantine` bên trong khi cần, như với thư mục người dùng tự chọn, và từ chối bằng cùng lời của B1.
> 7. **`policy apply` không nhận tệp.** Một tệp mà `apply` đọc là nguồn policy thứ hai bên cạnh registry, và là nguồn ai cũng ghi được. `apply` đọc registry rồi đưa tác vụ dọn dẹp **của người đang chạy** về khớp policy ngay — tác vụ đăng ký theo tài khoản (`InteractiveToken`), nên chạy dưới SYSTEM (script khởi động) thì **từ chối (2)** và nói vì sao; không đọc được policy thì **không đổi gì (1)**; không đụng tác vụ đo đĩa hằng ngày. `validate` nhận một tệp `.reg` (UTF-16 của `reg export` hoặc UTF-8 viết tay) để kiểm trước khi đẩy; không có tệp thì kiểm registry. Mã: 0, 1 không đọc được, 2 có giá trị bị từ chối hoặc không hiểu, 3 có chính sách cần Business, 64. `--json` là `cleandrive.policy-validate/1` / `cleandrive.policy-apply/1`, chỉ ASCII. **App không bao giờ ghi HKLM.**
> 8. **Hồ sơ của tổ chức chạy được trên máy chưa có settings.json** — đúng loại máy GPO hay đẩy tới. Quy tắc cũ "không có tệp thì không đụng tác vụ" là về ý định *của người dùng*; ý định của tổ chức nằm trong policy. Gỡ policy thì tác vụ của nó bị gỡ, kể cả khi không có tệp (`sweepManaged`).
> 9. **Policy thắng mà không vào tệp.** `patch()` gộp vào bộ nhớ rồi ghi cả khối, nên nếu `load()` trả bản đã áp policy thì lần lưu sau sẽ ghi policy vào tệp, và khi IT gỡ policy thì lựa chọn cũ mất. `ManagedSettingsStore` giữ bản tệp và bản hiệu lực; mọi chỗ đọc nhận bản hiệu lực, mọi chỗ ghi qua `toFile()` trả trường bị khoá về giá trị của tệp, và hồ sơ của tổ chức không bao giờ được ghi. Phần `managed` của bản hiệu lực không tệp nào tạo ra được (`coerceSettings` không đọc nó). Sampler hằng ngày không đọc policy (`load({ policy: false })`).
> 10. **Không đọc được policy = không có policy, nói ra** (người dùng chốt): "chỉ cho xem" là rào an toàn của tổ chức, không phải phân quyền — người dùng vẫn xoá được tệp của mình bằng Explorer.
> 11. **Đường dẫn xuất báo cáo cho H3 dời sang H3**: chưa có gì đọc nó, đưa vào đây là tính năng chết mà `test:dead` không thấy (giống `policy` dời từ H1).
> 12. **Đọc lại trước mỗi quyết định**: trước mỗi hành động, mỗi lượt chạy, và khi cửa sổ được đưa lên trước (`policy:state`; áp lại updater chỉ khi cờ đổi, vì áp lại là khởi động lại bộ hẹn giờ của nó). Harness chụp bắt được **một race thật**: một lần đọc rơi đúng lúc khoá đang được xoá rồi ghi lại thì ra "không có policy", và kết quả đó về sau cùng. [Inference: chưa đo vì không có domain] Group Policy cũng ghi lại khoá kiểu đó khi làm mới. Nên một policy *đang có* mà lần đọc sau *không thấy* thì được đọc lại sau 750 ms rồi mới tin.
> 13. **Cô lập harness**: 13 harness chạy Electron mà không đặt `CLEANDRIVE_TASK_SUFFIX`, nên không dựa vào suffix được. Khoá HKLM thật chỉ được đọc khi app đã đóng gói, hoặc khi chạy từ checkout với userData mặc định; còn lại thì không có policy, trừ khi `CLEANDRIVE_POLICY_KEY` trỏ vào `HKCU\Software\CleanDrive-Harness\…` (hoặc là chữ `machine`, dành cho harness có quyền admin). Bản cài bỏ qua biến này.
> 14. **ADMX/ADML được sinh từ `schema.js`**, câu chữ đi qua `t()` nên ADML tiếng Việt lấy từ `vi.js`. `test-policy` đòi: tệp trong `policy/` trùng từng byte với bản sinh; mọi cặp khoá/giá trị ADMX ghi đều là thứ app đọc **và ngược lại**; mọi `$(string.*)`/`$(presentation.*)` có trong cả hai ADML; parser XML của .NET nạp được cả ba tệp; namespace trùng số đông của Microsoft; và **bật mọi chính sách theo đúng cách ADMX ghi rồi đọc lại thì tất cả đều "áp dụng"**.
>
> **Màn hình** (ảnh chụp bắt **3 lỗi** của chính mục này): (a) chip và dòng trạng thái của hồ sơ người dùng ghi **"Bật" màu xanh** trong khi chỉ cho xem chặn mọi lượt chạy thật — nay là *"Bị giữ: chỉ cho xem"*, màu trung tính, kèm câu giải thích; (b) ô tick danh mục bị giữ **trông y như ô chưa tick** — nay chữ mờ và có ổ khoá ngay tại ô; (c) ở 720 px thanh hành động **đẩy nút xoá ra ngoài 28 px** — quy tắc xuống dòng chỉ nhìn thấy badge, mà chỉ cho xem thì badge ẩn. Mọi control bị giữ có ổ khoá và dòng *"Do tổ chức của bạn quản lý"*; một dòng thông báo trên mọi màn nói tổ chức quản lý những gì, và chính sách nào được đặt mà bản này không áp dụng. Xanh lá/vàng/đỏ không dùng cho khoá: ổ khoá nói ai quyết, không phải kết luận về tệp nào.
>
> **Phần cần quyền admin** (`npm run verify:policy -- --elevated`, người dùng chạy 2026-10-02): **8/1** — ghi khoá HKLM thật, CLI đọc nó bằng `reg.exe`, nửa siết áp dụng không cần Business, đo `DisableRegistryTools` = 1 và = 2 (ở trên), gỡ cả hai và kiểm đã mất. Một FAIL là **lỗi của chính harness** ở phép kiểm quyền đọc (`Get-Acl -LiteralPath`, và tôi đoán sai nhóm là BUILTIN\Users); đã sửa. **Chạy lại (người dùng, 2026-10-02): 8/0** — khoá do admin tạo dưới `Policies` thừa kế `S-1-5-11 ReadKey Allow`, tức người dùng thường đọc được; `reg.exe` vẫn mã 1 dưới `DisableRegistryTools` = 1 và = 2, PowerShell vẫn đọc được.
>
> **Chưa kiểm được trên máy này:** [Unverified] nạp ADMX trong GPMC/gpedit và Intune (Windows 11 Home không có); lượt chạy thật của hồ sơ tổ chức cùng lần khôi phục nó trong tiến trình thật — Code.exe luôn mở trên máy này, nằm trong danh sách bỏ qua mặc định, nên harness dừng đúng ở cổng đó và nói ra (đường xoá thật là cùng một hàm `runAutoClean` mà `verify:cli` chạy thật); hành vi khi Group Policy làm mới trên máy có domain.

---

#### H3. Console tổng hợp nhiều máy (không cloud)

| | |
| --- | --- |
| **Gói** | Business · `biz.console` |

- Mỗi máy (qua policy H2) định kỳ ghi một file `<hostname>.cleandrive.json` vào một **share nội bộ** do IT chỉ định. Không có server của CleanDrive, không có cloud.
- **Console** là một chế độ của chính app (`--console <share>`) đọc các file này và hiện: danh sách máy, % đầy, tốc độ tăng, "khi nào đầy", lần chạy tự động cuối kèm mã thoát, các máy có task bị hỏng.
- Nội dung file mặc định **không chứa tên file cá nhân**, chỉ chứa số liệu volume, danh mục và trạng thái task. Tuỳ chọn gửi top thư mục phải được bật riêng trong policy.
- Có thể lọc, sắp xếp và xuất CSV.

> **Chuyển từ H2 (2026-10-02):** chính sách *"đặt đường dẫn xuất báo cáo"* đi cùng mục này, vì chỉ ở đây mới có thứ đọc nó — đưa vào H2 là một khoá registry không ai đọc, loại tính năng chết `test:dead` không thấy. Khi thêm: một mục trong `src/main/policy/schema.js` (`VALUES` + `POLICIES`, là phần "làm thay" nên cần `biz.console`/`biz.policy`), phần đọc trong `interpret.js`, câu chữ trong `admx.js`, rồi `npm run policy:files`; `test-policy.js` tự đòi ADMX và bộ đọc khớp nhau.

> **✅ Đã code xong (2026-10-02).** Code ở `src/main/fleet/` (`report.js` dựng, viết và đọc lại tệp báo cáo; `collect.js` thu thập trên máy thật; `share.js` ghi và đọc share; `console-model.js` phán đoán của Console và CSV; `console.js` dịch vụ không phụ thuộc Electron; `console-state.js` trí nhớ con dấu; `console-args.js`; `console-main.js` cửa sổ, hộp thoại và IPC), `src/main/console-preload.js`, `src/renderer/console.html` + `console.js` (và một mục trong `styles.css`), nhánh `--console` trong `main.js`, `maybeReport` trong `sample-only.js`, chính sách `MachineReport` trong `policy/schema.js` + `interpret.js` + `effective.js` + `admx.js` (và `policy/*` sinh lại), `policy apply` cùng lệnh mới `report` trong CLI, ổ khoá ở Trends (`trends.js`) và câu trong dòng thông báo (`managed.js`), `verifyJournal` trả thêm hash và khoá của con dấu cuối. Harness: `scripts/test-fleet.js` (**73 kiểm tra**, trong `npm test`), `scripts/verify-console.js` (tiến trình thật, **20/0**), cửa sổ Console trong `test:a11y` (**+14**), ảnh `npm run shoot:console` (**19 ảnh**: hai theme, tiếng Việt, 1180/720/560, cùng màn Trends có ổ khoá). Harness **đã được chứng minh là bắt được lỗi**: cài lần lượt 6 lỗi (giữ tham số đường dẫn trong lý do; để bản viết lại thành chuẩn khi đọc lần hai; bỏ chặn công thức trong CSV; tự tạo thư mục share; ghi báo cáo trước tóm tắt; thôi ép bật phép đo) → cả 6 bị bắt, tệp trả lại đúng từng byte.
>
> **Đo trước khi thiết kế** (2026-10-02, không nâng quyền):
>
> - **SMB loopback** `\\localhost\D$` ghi được không cần admin: ghi 4 KB vào tên tạm, rename đè, đọc lại **10–11 ms** (trung vị), tối đa 17 ms; chạm lần đầu 121 ms (`localhost`) / 12 ms (IP); Console đọc 500 tệp **111 ms**. Đó là SMB thật nhưng byte không rời máy, nên tốc độ trên LAN thật là [Unverified] (§11 mục 12, 31).
> - **Share hỏng**: tên máy không có 2,7 s; share sai tên 4,2 s; thư mục không có 2 ms; **IP không trả lời 42,3 s**. Và đây là số định hình thiết kế: `process.exit()` (Node) và `app.exit()` (Electron) **không thoát được** khi đang có lệnh ghi treo — 42,3 s và 43,6 s; giết tiến trình con cũng phải chờ I/O (42,3 s), chỉ tiến trình cha không chờ con mới thoát ngay (3,1 s).
> - Hỏi Task Scheduler qua COM (`taskInfo`) **447–523 ms**; `isInstalled` 34–67 ms. Giới hạn chạy của tác vụ đo đĩa là `PT5M`.
> - Git Bash làm hỏng tham số `\\host\share` (chuyển đường dẫn kiểu MSYS): mọi phép thử UNC đầu tiên đều "ENOENT sau 1 ms". Phép đo UNC phải chạy từ PowerShell.
>
> **Người dùng chốt trước khi code (2026-10-02):** (1) con dấu H4 lên share, Console nhớ; (2) phép đo hằng ngày ghi báo cáo ngay trong tiến trình của nó; (3) danh mục và top thư mục lấy từ lần quét bằng tay, top thư mục bật riêng; (4) có policy báo cáo thì phép đo hằng ngày bị ép bật, có ổ khoá.
>
> **Khác đặc tả:**
>
> 1. **"Các máy có task bị hỏng" không thể đến từ chính tệp**: tác vụ ghi báo cáo mà hỏng thì im lặng. Console coi **không báo cáo quá 2 ngày** là tín hiệu mạnh nhất. Tác vụ dọn dẹp thì máy tự báo: đã đăng ký chưa, có khớp hồ sơ không (`verify`), Windows chạy lần cuối lúc nào với mã gì (`LastTaskResult`, Console nói thành lời bằng `describeTaskResult`).
> 2. **"Danh mục" chỉ có từ lần quét bằng tay**: phép đo hằng ngày chỉ có `statfs`. Tệp mang ngày quét và loại gốc (cả ổ hay một thư mục), không bao giờ đường dẫn. Máy chưa ai quét thì Console nói đúng như vậy. Top thư mục cần tick riêng `ReportTopFolders`, vì thư mục dưới `C:\Users` là tên người.
> 3. **Phép đo hằng ngày nay đọc policy** — H2 cố ý không đọc ("một reg.exe mỗi ngày để làm gì"), nay có việc để làm: 25–45 ms mỗi ngày trên mọi máy; phần báo cáo (~0,6 s) chỉ trên máy có policy. Báo cáo được ghi **sau cùng**, sau phép đo và tóm tắt G3: share chết giữ tiến trình ẩn **44,2 s** (đo qua `verify-console`), mã thoát vẫn 0, lịch sử đã ghi, lỗi được ghi log. Không thêm tác vụ Windows thứ ba, không tiến trình con (tiến trình con sẽ cần một chế độ Electron mới, vì `ELECTRON_RUN_AS_NODE` sẽ tắt ở Giai đoạn 7).
> 4. **`policy apply`** — H2 cố ý không đụng tác vụ đo đĩa — nay đăng ký nó khi policy đòi báo cáo, và ghi một báo cáo ngay để máy hiện trong Console ngay sáng chạy logon script. Không có policy báo cáo thì vẫn để yên.
> 5. **Thêm `cleandrive report [--json]`** (đặc tả không có): in đúng tệp sẽ gửi, không ghi gì, để IT hay chính người ngồi máy tự kiểm lời hứa "không chứa tên tệp cá nhân". `--json` trùng từng byte với tệp trên share (`test-fleet` kiểm). Là `biz.cli` như mọi lệnh khác.
> 6. **Không gì riêng tư trong tệp, kể cả thứ đặc tả không nhắc**: hồ sơ chỉ gửi **id** (tên do người gõ, thư mục là đường dẫn); lý do của lượt chạy bị **xoá phần tham số chữ** (đường dẫn vùng quarantine, tên chương trình đang chạy), giữ tham số số; lỗi của Windows về một tác vụ chỉ gửi "có lỗi", không gửi câu (có thể nêu đường dẫn); ổ mạng bị bỏ (gốc của nó nêu tên máy chủ). `test-fleet` dựng tệp từ đầu vào đầy dữ liệu riêng tư rồi tìm từng chuỗi; `verify-console` tìm tên tài khoản, thư mục nhà và thư mục dữ liệu thật trong tệp thật.
> 7. **Con dấu H4** (người dùng chốt): Console nhớ (số, hash) của từng máy trong userData của chính nó. Con dấu mới nhất lùi số thì là các phiên mới nhất bị xoá; một số đã thấy mang hash khác thì là journal bị viết lại và ký lại. `test-fleet` chạy lại đúng hai đòn THE LIMIT trên journal niêm phong thật: máy tự kiểm không thấy gì, Console thấy cả hai. **Hash thấy lần đầu được giữ** — đọc bản viết lại hai lần không biến nó thành chuẩn. Giới hạn nói ra ở cả README lẫn màn hình: chỉ bắt được thay đổi xảy ra sau khi Console đã đọc một báo cáo; không bắt được người giả mọi báo cáo về sau (họ ghi được tệp của chính máy mình). Có nút "bắt đầu lại từ báo cáo tới" (sau khi cài lại chẳng hạn). Khoá đổi mà số vẫn tăng là ghi chú, không phải báo động.
> 8. **Console là một cửa sổ riêng**, preload riêng 5 API, IPC đăng ký ở `console-main.js` chứ không ở `ipc.js` (để cửa sổ đọc JSON không phải nạp scanner, tray, updater). `test-ipc-manifest` và `test:dead` mở rộng để giữ mỗi cửa sổ trong đúng danh sách của nó; `test:dead` lần theo cả chuỗi `main.js` → `console-main.js` → `console.html` → `console.js`, vì nó không thấy tham số dòng lệnh. `--console` phải là tham số đầu tiên, tắt mọi cờ chế độ khác (bài học H1); không khoá single-instance.
> 9. **Không màu kết luận**: "cần xem" là chữ và độ đậm, như con dấu ở Restore. Ngưỡng 2 ngày / 30 ngày / 95% là của Console, ghi ở chân cửa sổ. Thanh đo ổ dùng màu accent vì độ đầy là một lượng, không phải phán xét.
> 10. **Mọi tệp trên share là dữ liệu không tin được** (ai báo cáo được thì cũng ghi được): giới hạn 256 KB, dựng lại từ các trường đã biết với giới hạn số lượng, bỏ khoá/tham số lạ, chỉ vẽ bằng `textContent`. Hai tệp tự nhận cùng một máy thì liệt kê thay vì vẽ hai lần. Tệp cũ hơn bản đã thấy là "cần xem". CSV chặn công thức (`= + - @`) và có BOM cho Excel.
> 11. **Licence**: phần ghi đi theo `acting` (`biz.policy`) mà `services.js` đã đưa vào sẵn; Console là `biz.console`, hỏi ở `main.js` rồi đưa vào. Không có Business thì `policy validate` báo `MachineReport` cần Business (mã 3), phép đo không ghi gì, Console hiện một câu và không đọc gì (đều có trong `verify-console`).
> 12. **Tên tệp `<hostname>.cleandrive.json`** như đặc tả: tác vụ đăng ký theo từng người, nên máy có hai người dùng CleanDrive sẽ ghi đè nhau (ghi trong README). Thư mục share không bao giờ được tạo: gõ sai đường dẫn trong policy phải hỏng, không được tạo thư mục lạ.
>
> **Màn hình** (ảnh chụp và `test:a11y` bắt **7 lỗi** của chính mục này): ở 1180 tên máy gãy giữa chữ; ở 720/560 mỗi phần tử con của ô thành một ô lưới riêng nên nhãn và giá trị lệch cột; dòng quét ghi "toàn bộ C:: 196 GB"; phần chính sách hiện tên registry thay vì tên trong Group Policy; lệnh `--console` bị ngắt dòng ngay ở `--`; chip lọc đang bật thiếu tương phản ở theme sáng (nằm trên nền trang, không trên thẻ); và **bấm tên máy làm mất tiêu điểm bàn phím** vì bảng vẽ lại — nay tiêu điểm về đúng tên máy đó, cả khi đóng chi tiết.
>
> **Chưa kiểm được trên máy này:** tốc độ và độ trễ qua LAN thật (§11 mục 31); share trên máy chủ có quyền chỉ-tạo; Group Policy thật (§11 mục 29). `shoot:console` một lần báo "the dark palette did not settle", không tái hiện trong 5 lượt sau (§11 mục 33).

---

#### H4. Audit log ký số

| | |
| --- | --- |
| **Gói** | Business · `biz.audit` |
| **Phụ thuộc** | 0.3 Action Journal |

- Mỗi dòng journal chứa `prev` (hash của dòng trước), tạo thành một chuỗi.
- Mỗi phiên (session) kết thúc bằng một dòng `seal` được ký bằng khoá riêng của máy. Khoá này được tạo lần đầu và lưu bằng DPAPI (phạm vi máy).
- Lệnh `cleandrive journal verify` báo dòng nào bị sửa, xoá hoặc chèn thêm.
- [Inference] Cơ chế này **phát hiện** được việc sửa đổi, nhưng không ngăn được người có quyền admin trên máy xoá toàn bộ log. Tài liệu phải nói rõ giới hạn này. Để chống xoá toàn bộ, cần xuất định kỳ ra share (H3).

> **✅ Đã code xong (2026-10-01).** Code ở `src/main/journal/seal.js` (`Sealer`, `verifyJournal`), `src/main/journal/seal-key.js` (tệp khoá `seal-key.json`), `src/main/lib/dpapi.js`, phần chuỗi và niêm phong trong `src/main/journal/journal.js` (`_chain`, `_finish`, `_lastSeal`, `readRaw`, `prune`), quyết định niêm phong hay không ở `src/main/services.js` (`sealer`), IPC `journal:verify` trong khối Restore Center của `src/main/ipc.js`, dòng tổng và badge trên `src/renderer/restore.js`. Harness: `scripts/test-journal-seal.js` (**54 kiểm tra**, phần lớn viết từ phía kẻ tấn công, một khối chạy DPAPI thật), 8 kiểm tra mới trong `smoke.js` trên chính 40 tệp thật trong Thùng rác (khoá thật, sửa một dòng bằng tay rồi trả lại từng byte), ảnh chụp `npm run shoot:seal`. Harness **đã được chứng minh là bắt được lỗi**: tắt kiểm chữ ký thì phép "tính lại mọi hash" FAIL; tắt báo dòng thừa thì phép "chèn một dòng" FAIL. Khác với đặc tả ở trên:
> - **Khoá sau `biz.audit` mà không phá nguyên tắc journal** (người dùng chốt: không mở cho mọi người). `test-entitlements.js` cấm journal nạp module licence, và journal chính là chỗ ghi con dấu. Cách giải: journal **không bao giờ hỏi**; `services.js` hỏi `canNow()('biz.audit')` rồi đưa vào một `Sealer` hoặc `null`. Journal không có bộ niêm phong thì ghi **y hệt từng byte** như trước (harness kiểm). Việc kiểm là đọc nên **không bao giờ khoá**: licence Business hết hạn thì con dấu mới dừng, con dấu cũ vẫn được kiểm — đúng tinh thần `canRead`. Bản stable vẫn đóng Business (`OPEN_PRO`), nên ở đó màn Restore **nói thành lời** rằng niêm phong thuộc Business. Quyết định được đưa ra **một lần cho mỗi tiến trình** — đúng khi licence chưa đổi được lúc app đang chạy; **Giai đoạn 6 phải hỏi lại**.
> - **`prev` theo phiên, không theo tệp.** Ba chỗ trong code có hai phiên ghi xen nhau vào một tệp: cửa sổ và lượt chạy tự động là hai tiến trình và khoá chạy cố ý không khoá với cửa sổ (`runlock.js`); Restore mở một phiên `recycle` phụ khi phiên `restore` còn mở (`actions/restore.js`); và phiên vắt qua nửa đêm cuối tháng vẫn ghi vào tệp tháng nó bắt đầu. Chuỗi theo tệp sẽ cần khoá liên tiến trình cho **từng** dòng, và sẽ gọi mỗi lần mất điện là "bị sửa" vì `read()` bỏ qua dòng rách. Theo phiên thì người ghi giữ hash trong bộ nhớ, không đọc lại, không khoá. Các lần ghi của một phiên đi qua một hàng đợi, nên dòng nằm trong tệp đúng thứ tự đã gọi.
> - **Con dấu được đánh số** (`n`) và nối vào con dấu trước (`after`), nên xoá trọn một phiên ở giữa là một số bị thiếu. Chỉ bước niêm phong lấy khoá — một tệp `.seal.lock` cạnh journal, giữ vài mili giây. Số kế tiếp đọc từ chính các tệp tháng mỗi lần, **không** từ một tệp ghi chú: ghi chú và journal có thể lệch nhau sau một lần sập máy giữa hai lần ghi, và khi đó hai con dấu mang cùng một số. Chỉ con dấu có chữ ký hợp lệ mới được đặt số tiếp theo, và chỉ chúng mới vạch khung đánh số khi kiểm: một dòng giả mang `n: 1e9` **không** làm ra một khoảng trống một tỷ phiên (harness kiểm, 1 ms).
> - **Dòng `end` và `seal` đi chung một lần ghi.** Khi không niêm phong được — khoá bị giữ quá 15 s, PowerShell bị chặn, khoá không mở được — các dòng **vẫn được ghi đủ**, phiên hiện là "chưa niêm phong", và màn hình nói lý do. Bản ghi về tệp của người ta đi trước; con dấu trên nó đi sau.
> - **DPAPI phạm vi người dùng** (người dùng chốt), qua PowerShell theo đúng khuôn `ads.js`: script cố định gửi qua `-EncodedCommand`, dữ liệu đi qua stdin, có entropy riêng của app. Đo được, không nâng quyền: tạo khoá **438–529 ms**, mở khoá **364–483 ms**, một lần cho mỗi tiến trình. Script trả **mã thoát 3** khi chính DPAPI từ chối blob — chỉ khi đó khoá mới bị thay; PowerShell không chạy được thì **không bao giờ** là lý do làm khoá mới. **`safeStorage` của Electron bị loại sau khi đo**: nhanh (1,7 ms) và cũng là DPAPI, nhưng khoá của nó nằm trong `Local State` của Chromium, tệp này được ghi khi app thoát bằng `app.quit()` và **không** được ghi khi thoát bằng `app.exit()` — blob mã hoá ở tiến trình trước không giải được ở tiến trình sau. `app.exit(code)` lại đúng là cách lượt chạy theo lịch thoát — **câu này chỉ đúng từ bản sửa ngày 2026-10-01** (§11 mục 22): lúc H4 được viết, lượt chạy theo lịch vẫn thoát bằng `app.quit()`. Lý do loại `safeStorage` nay mới đứng thật: lượt chạy theo lịch thoát bằng `app.exit(code)` vì đo được đó là cách duy nhất đưa mã thoát ra ngoài.
> - **Giới hạn thật nặng hơn câu `[Inference]` của đặc tả.** Không chỉ người có quyền admin: **chính người dùng của máy** viết lại được journal *và ký lại*, vì lượt chạy tự động chạy dưới tài khoản họ (`InteractiveToken`, `LeastPrivilege`), nên khoá nào nó mở được lúc không có ai thì người đó cũng mở được. Con dấu bắt được: sửa tay mà không ký lại, công cụ khác chạm vào, đĩa hỏng. Nó không bắt được người cố ý xoá dấu vết trên máy của chính mình, và không bắt được việc xoá **các phiên mới nhất**. `test-journal-seal.js` có hai phép kiểm mang chữ **THE LIMIT** chứng minh đúng hai đòn đó *qua mặt được* — để tài liệu không bao giờ hứa nhiều hơn. Chống được hai đòn này cần một bản sao nằm ngoài máy: việc của H3. **H3 đã làm (2026-10-02):** báo cáo mang số, hash và khoá của con dấu mới nhất, Console nhớ chúng cho từng máy; `test-fleet.js` chạy lại đúng hai đòn trên journal niêm phong thật và Console bắt được cả hai — với điều kiện nó đã đọc một báo cáo trước lúc sửa.
> - **Bản ghi `prune` có niêm phong**, đặc tả không có. Không có nó thì mỗi lần dọn tháng cũ hơn 13 tháng trông y hệt người ta xoá các tháng cũ nhất. Ghi **trước** khi xoá tệp: bản ghi của một lần xoá mà sập máy chặn lại thì vô hại, còn một lần xoá không có bản ghi chính là thứ cần báo. Bản ghi `prune` **không có chữ ký hợp lệ thì không được tin** (harness kiểm).
> - **Kiểm báo chỗ hỏng tới từng dòng.** Có sửa hay không là chính xác; *chỗ nào* là mức tốt nhất mà hash cho phép: một dòng bị sửa và một dòng bị xoá đều để dòng sau trỏ vào hư không, và số dòng trong con dấu phân biệt được hai trường hợp khi chỉ có một chỗ gãy. Có nhiều chỗ gãy mà không phân biệt được thì báo "đã bị sửa hoặc bị xoá" chứ không đoán. Hai dòng đổi chỗ cho nhau thì **vẫn là đã niêm phong**: thứ tự trong tệp không thuộc bản ghi. Lưu tệp bằng trình soạn thảo đổi xuống dòng thành CRLF thì **mọi phiên trong tệp đều bị sửa** — vì mọi dòng đã bị sửa thật.
> - **Đo trên một journal của một năm bận rộn** (201 phiên, 10.604 dòng, 3,0 MB): thêm một con dấu mất **14 ms**, kiểm cả journal mất **62 ms**. Hai tiến trình con cùng niêm phong 15 phiên mỗi bên: 31 con dấu đánh số 1–31, không trùng, không thiếu. Ed25519 ký 43 µs, kiểm 124 µs — đo trên Node 24 của hệ thống, [Unverified] trên Node 20 của Electron. Journal thật của máy này: **82 dòng, 1 phiên, 0 dòng có `prev`** — toàn bộ hiện là "chưa niêm phong", đúng là như vậy.
> - **Toạ độ:** `test-media-map.js` nay quét **cả thư mục `journal/`** (journal, con dấu, khoá) chứ không chỉ `journal.js`, và kiểm rằng ba tệp đó có trong vòng quét. Con dấu chỉ mang hash, số đếm, thời điểm và dấu vân tay khoá. Báo cáo kiểm chỉ nêu tên tệp journal và số dòng, **không bao giờ** một đường dẫn trong dòng.
> - **Chưa kiểm được trên máy này** (§11 mục 11, chỉ một máy, một tài khoản): [Unverified] tài khoản khác có mở được khoá không (theo thiết kế phạm vi người dùng thì không); [Unverified] khoá có mất khi admin đặt lại mật khẩu một tài khoản local không — nếu mất thì app làm khoá mới và con dấu cũ vẫn kiểm được (harness kiểm nhánh đó bằng DPAPI giả); PowerShell bị AppLocker/CLM chặn chỉ được mô phỏng.
> - Lệnh `cleandrive journal verify` của đặc tả sẽ đến với **H1**, gọi đúng `verifyJournal`; báo cáo đã mang `"schema": "cleandrive.journal-verify/1"` theo quy tắc `--json` của H1.

---

### Nhóm I — Trải nghiệm & giữ chân người dùng (miễn phí)

#### I1. Restore Center

| | |
| --- | --- |
| **Gói** | **Free, luôn luôn** · không đi qua `can()` |

- Màn mới **"Khôi phục"** (hoặc tab con trong Trends). Liệt kê các phiên hành động theo thời gian: *"24/9 09:12 — Cách ly 410 file, 18,8 GB"*.
- Mỗi phiên có nút **Khôi phục phiên này** và cho phép chọn từng file.
- Trạng thái từng mục: *còn trong bin*, *còn trong vùng cách ly*, *đã bị purge*, *đã bị người dùng xoá khỏi bin*, *vùng cách ly không truy cập được*. App kiểm tra trạng thái thật trên đĩa, không tin vào journal (giống nguyên tắc "record là tuyên bố, metadata là bằng chứng").
- Khôi phục từ Recycle Bin dùng API Shell để khôi phục đúng mục của phiên, không phải "Restore all".
- **License hết hạn vẫn khôi phục được mọi thứ**, kể cả những gì được cách ly bằng tính năng Pro.

> **✅ Đã code xong (2026-09-24).** Code ở `src/main/actions/restore.js` (`inspect`, `listSessions`, `listItems`, handler `restore`), `undo` trong `src/main/actions/recycle.js`, `matchRecorded`/`putBack` trong `src/main/lib/recyclebin.js`, IPC `journal:sessions`/`journal:items`/`journal:restore` cùng `confirmRestore` trong `src/main/ipc.js`, màn `src/renderer/restore.js`. Harness: `scripts/test-restore.js` (38 kiểm tra, bin tự dựng, viết từ phía kẻ tấn công), `scripts/verify-restore.js` (Electron, Recycle Bin thật, file giả), 13 kiểm tra mới trong `smoke.js` chạy trên 40 file thật trong bin, ảnh chụp `npm run shoot:restore`. Khác với đặc tả ở trên:
> - **Không dùng API Shell.** Đo trên file giả ở máy này, bốn cách: (A) `fs.rename` `$R` về chỗ cũ mất 3,3 ms, nhưng **ghi đè im lặng** file đang nằm ở đó (libuv yêu cầu Windows thay file có sẵn); (A2) hard link `$R` sang đường dẫn gốc rồi unlink `$R` mất 2,3 ms, gặp file có sẵn thì báo `EEXIST` và không đụng vào gì; (B) Shell COM `InvokeVerb('undelete')` mất 431 ms mỗi mục cộng 2,5 s khởi động PowerShell, và khi có file trùng tên thì bật hộp thoại của Explorer ngoài tầm app, treo tới timeout 15 s. Đã chọn A2. Ổ không có hard link thì chép với `COPYFILE_EXCL` (cũng không ghi đè). Mục chỉ rời bin khi đã nằm đúng chỗ; nếu không gỡ được `$R` thì bản vừa đặt vào bị gỡ lại. Thùng rác mà Windows tự hiển thị (Shell namespace) cũng thôi liệt kê mục đó (có kiểm tra trong `verify-restore.js`).
> - **Nhận diện mục trong bin** giống purge: đường dẫn gốc, cộng thời điểm xoá lệch ≤ 5 phút so với journal. Thêm một điều purge không cần: mỗi mục trong bin chỉ khớp với một bản ghi, ưu tiên bản ghi gần nhất về thời gian. Ngoài ra `$R` phải còn thật. Đo được: sau `undelete` của Shell, `$I` vẫn nằm lại một mình.
> - **Trạng thái từng mục:** `inBin` (khôi phục được), `restored` (kèm "còn ở đó không"), `purged`, `gone`, `unavailable` (ổ không kết nối). Câu "đã bị người dùng xoá khỏi bin" đổi thành "không còn trong Thùng rác", vì app không biết ai đã dọn (Storage Sense cũng dọn bin). Nếu đường dẫn cũ đang có file thì dòng đó nói thêm "có thể đã được khôi phục bằng Explorer". Trạng thái của vùng cách ly sẽ đi cùng B1, qua `undo` của handler `quarantine`.
> - **Trùng tên** (đặc tả: hỏi đổi tên / bỏ qua / thay thế): hộp thoại hỏi ba lựa chọn "giữ cả hai" (bản khôi phục mang tên `tên (restored).ext`, bản tiếng Việt là `(đã khôi phục)`), "bỏ qua" và "thay thế". "Thay thế" chuyển file đang nằm đó vào Recycle Bin trước, ghi thành một session `recycle` riêng (nên nó cũng khôi phục được), và chỉ làm sau khi chắc `$R` còn đó. Thư mục chắn đường thì không bao giờ thay. Mặc định là bỏ qua. Chỉ hộp thoại chọn được "thay thế": request từ cửa sổ không chọn được (smoke kiểm tra trên app thật).
> - **Sửa một lỗi có sẵn (ledger):** trước đây ledger chỉ trừ các mục đã purge. Kịch bản: app xoá X lúc 10:00, người dùng khôi phục lúc 10:02, rồi tự xoá X bằng Explorer lúc 10:03. Hết grace period, purge xoá vĩnh viễn bản người dùng tự xoá, vì 10:03 nằm trong khoảng lệch 5 phút. Giờ ledger trừ cả session `restore`. Harness tái hiện đúng kịch bản này; chạy với `ledger.js` cũ thì fail ("1 purged").
> - **Dòng trong Restore Center là bản ghi journal, không phải candidate** (đã chốt): không có verdict nào hợp lý cho chúng. Vẫn dùng chung `CandidateList` (thêm `selectable`, `rowActions`, `onOpen`) để bàn phím chạy giống mọi màn khác. Trạng thái dùng badge trung tính, không dùng màu verdict. Nút "Khôi phục" không có `FreesBadge` (khôi phục không giải phóng mà cũng không tốn thêm dung lượng).
> - Là **tab mới trên sidebar** (đã chốt), nằm dưới Trends. Mỗi lần mở tab, trạng thái được đọc lại từ đĩa.
> - **Không đi qua `can()`:** handler `restore` có `feature: 'free'`, còn các IPC `journal:*` không được truyền `can`. `test-entitlements.js` đọc mã nguồn để kiểm tra `restore.js`, `execute.js` và khối IPC không nạp module license.
> - Cửa sổ chỉ gọi mục bằng id journal (`s_xxxxxxxx:n`), không bao giờ bằng đường dẫn. Journal ghi gì thì mới khôi phục được cái đó. Đích là vị trí hệ thống hoặc thư mục ứng dụng đã cài thì bị từ chối, kể cả khi thư mục cha đã bị tráo thành junction trỏ vào Windows (đi theo junction rồi mới kiểm tra).
> - Sửa kèm: câu ước tính thời gian trong hộp thoại xoá viết cứng tiếng Anh (lọt qua `test:i18n`), giờ đã dịch; `formatDuration` ở main process cũng dịch. Nút đường tắt thư mục trên thanh trên cùng không đổi ngôn ngữ khi chuyển tiếng lúc đang chạy (thấy qua ảnh chụp), đã sửa.

#### I2. Accessibility

- **High-contrast theme:** theo `forced-colors` của Windows, cộng thêm một theme high-contrast riêng của app.
- **Bàn phím:** mọi control đều tới được bằng Tab; danh sách dùng mũi tên / Space / Shift+mũi tên; phím tắt được liệt kê trong `?`.
- **Screen reader:** ARIA cho danh sách ảo hoá (`aria-rowcount`, `aria-rowindex`), live region cho progress và toast, nhãn đầy đủ cho các thanh tỷ lệ và biểu đồ (kèm bảng dữ liệu ẩn có thể đọc được).
- **Tuỳ chọn màu accent** (README liệt kê điều này là một giới hạn hiện tại).
- Harness: chạy axe-core [Unverified: đây sẽ là dependency dev-only, không phải runtime] hoặc một bộ kiểm tra tự viết trên DOM E2E.

> **✅ Đã code xong (2026-09-25).** Code ở `src/shared/theme-palette.js` (định dạng tệp theme, luật tương phản, CIEDE2000, sinh token; main và cửa sổ cùng dùng), `src/main/appearance.js` (theme đang dùng, truyền qua URL trước khung hình đầu), IPC `theme:saveCustom`, `theme:import`, `theme:export` và `theme:set` nhận thêm `custom` trong `ipc.js` (manifest lên 59 kênh), settings v5 (`appearance.custom`), `src/renderer/theme.js` (lựa chọn Tuỳ chỉnh, token inline), `theme-editor.js` (card "Màu của riêng bạn"), `keys.js` (bảng phím `?`), khối `forced-colors` cuối `styles.css`, cùng các chỗ sửa trong `app.js` (tab ARIA, `announce()`, toast, `role=progressbar`), `components.js` (nút của dòng tới được bằng Tab, tên dòng có trạng thái đã đánh dấu), `media.js` (`aria-activedescendant`, tên ô ảnh), `trends.js` (bảng dữ liệu ẩn), `viewer.js` (`inert`), `treemap.js` (vẽ bằng màu hệ thống). Harness: `scripts/test-a11y.js` (118 kiểm tra, Electron: axe-core trên 9 màn × sáng/tối/Tuỳ chỉnh/tiếng Việt, cây AX của Chromium qua CDP, đi Tab hết từng màn, bấm thử các phím trong bảng `?`, theme tương phản giả lập qua CDP, luồng trình chỉnh màu qua IPC thật với hộp chọn tệp do harness trả lời), `scripts/test-theme.js` (42 kiểm tra, trong `npm test`), 6 kiểm tra mới trong `test-settings-migration.js`, ảnh chụp `npm run shoot:a11y`. Khác với đặc tả ở trên:
> - **Harness (đã chốt): axe-core 4.13.0 là devDependency ghim đúng bản, cộng kiểm tra tự viết, cộng checklist Narrator.** Đã build thử (`build.js dir`, vào thư mục tạm): `app.asar` có 1.365 mục, **0 mục axe-core**, có `src/shared/theme-palette.js` và `mammoth`. axe không kiểm được bàn phím, live region hay forced-colors, nên phần đó tự viết. **Đo được:** UI Automation của Windows đọc từ ngoài tiến trình chỉ thấy tới `Chrome Legacy Window` trong Electron 33, kể cả khi bật `setAccessibilitySupportEnabled(true)`; vì vậy không kiểm tự động được "Narrator đọc đúng", và cây AX của Chromium là thứ gần nhất kiểm được.
> - **Không có `aria-rowcount`/`aria-rowindex`.** Theo ARIA 1.2 hai thuộc tính này chỉ dành cho grid/table/treegrid; danh sách ở đây là `role=list`, nên giữ `aria-setsize`/`aria-posinset` (đã có từ 0.8).
> - **Bỏ tuỳ chọn màu accent** (đã chốt): không phải tính năng trợ năng, và theme tương phản của Windows đã cho người dùng tự chọn mọi màu.
> - **Theme high-contrast riêng → màu tự thiết kế** (đã chốt): mặc định theo theme tương phản của Windows; thêm lựa chọn Tuỳ chỉnh với 11 ô chọn màu (kèm ô gõ `#rrggbb`), xem trước ngay trong card, nhập/xuất tệp JSON. **Tuỳ chỉnh thắng theme tương phản của Windows** (người dùng chọn, không phải phương án tôi đề xuất): khi đang chọn Tuỳ chỉnh, cả trang đặt `forced-color-adjust: none`.
> - **Luật (đã chốt):** tệp ≤ 32 KB (đo trước khi đọc), `format`/`version`/`base`, chỉ 11 key đã biết, giá trị chỉ `#rrggbb` (không tên màu, không alpha, không `url()`/`var()`), key thiếu lấy từ theme gốc; chữ ≥ 4,5:1 trên mọi nền, viền ô nhập ≥ 3:1, chữ trên màu nhấn ≥ 4,5:1 cả khi hover, ba màu verdict ≥ 4,5:1 trên nền nhãn của chính chúng; bốn màu verdict + accent cách nhau ΔE2000 ≥ 20 [ngưỡng do app tự chọn]. Hover/ring/nền mờ do app tự sinh. Lưu bản sao vào settings, không lưu đường dẫn. Khác một chút so với "từ chối cả tệp": tệp **sai cấu trúc** thì bị từ chối, không nhận gì; tệp **đúng cấu trúc nhưng trượt luật tương phản** được nạp vào trình chỉnh kèm danh sách lỗi để sửa, và không dùng được cho tới khi đạt hết. Main kiểm lại mọi palette khi lưu (harness gửi thẳng một palette trượt qua IPC: bị từ chối, không lưu gì).
> - **Hai theme có sẵn trượt chính các luật này, đã sửa:** `--text-3` 3,4–4,1:1 → `#616873` / `#8a92a3`; viền ô nhập 1,3:1 → token mới `--control-border` 3,1:1; chữ trắng trên nút xanh ở theme tối 3,2:1 → `--on-accent` tối `#0b1220`; xanh của nhãn "safe" ở theme sáng 4,46:1 → `#147739`; vàng ở theme sáng 4,43:1 → `#945a06`; badge dung lượng trên sidebar 4,0:1 → nền accent đặc. `test-theme.js` đọc `styles.css` để giữ hai theme khớp với luật và với template.
> - **Theme tương phản của Windows** kiểm bằng giả lập của Chromium (`Emulation.setEmulatedMedia forced-colors`), vốn ép bảng màu thật chứ không chỉ media query. Trước khi sửa, đo được: thanh tiến độ 40% cùng màu với rãnh, tab đang mở giống hệt tab khác. Sau khi sửa: tab, lựa chọn đang bật, dòng đã tick, ảnh đã chọn, thanh tiến độ đều khác biệt; 5 phần của thanh ổ đĩa thành 5 hoạ tiết; bản đồ vẽ 93–95% pixel bằng đúng hai màu Canvas/CanvasText. **Chưa thử trên từng theme tương phản thật của Windows.**
> - **Bàn phím:** sidebar là tablist đúng mẫu ARIA (`aria-selected`, `aria-controls`, ↑/↓/Home/End mở luôn màn); nút View/Reveal/Open của dòng đang chọn tới được bằng Tab (trước đây Reveal và Open không tới được bằng bàn phím, trái với câu README "The keyboard does everything the mouse does"); viewer đặt `inert` cho phần nền; bảng `?` là `<dialog>` gốc. Harness đi Tab hết 9 màn (15–57 điểm dừng mỗi màn) và kiểm rằng mọi control nằm ngoài thứ tự Tab đều ở trong một vùng đi bằng phím mũi tên.
> - **Screen reader:** hai live region (polite/assertive) chỉ ghi khi có việc (quét xong, đổi giai đoạn xoá, biên lai, số đã chọn), không ghi mỗi nhịp tiến độ; `role=progressbar` có giá trị và chữ; lưới ảnh có `aria-activedescendant`, mỗi ô đọc tên tệp, loại, dung lượng, ngày (trước đây chỉ đọc "2.1 MB"); biểu đồ Trends có bảng số liệu ẩn (100 lần đo mới nhất); `<main>` mang tên màn đang mở.
> - **Khác với trước, có đổi một kiểm tra cũ:** nút tick trên ô ảnh không còn là `<button>` (axe: `nested-interactive`, control nằm trong `option`; `tabindex=-1` không đủ). Nó vẫn bấm được bằng chuột, Space trên lưới là phím tương đương. Kiểm tra cũ trong `smoke.js` "the tick is a real button" đổi thành "the tick is for the pointer, not a control inside the option"; các kiểm tra "tick ba ảnh chọn ba" giữ nguyên và vẫn pass.
> - **Sửa kèm:** evidence panel dùng `role=note` trên chính `<li>` làm list sai cấu trúc (axe `aria-required-children`), ở cả Largest files lẫn danh sách của bản đồ; toast giờ đứng yên khi trỏ chuột hoặc focus vào, và ở lâu hơn khi dài; `render()` của i18n dịch được tham số là message lồng nhau.
> - **Checklist Narrator (người dùng tự chạy, chưa chạy):** (1) Win+Ctrl+Enter bật Narrator, mở app. (2) Tab vào sidebar: nghe "Disk usage, tab, selected, 1 of 9"; ↓ sang System. (3) Quét Home: nghe "Scanned … files." dù focus không đổi. (4) Largest files: ↓ đọc đường dẫn, dung lượng, tuổi, verdict, "not ticked"; Space → "1 selected · …". (5) Tab từ một dòng: View → Reveal → Open. (6) Photos: mũi tên đọc tên ảnh, "photo", dung lượng, ngày. (7) Trends: đọc được bảng số liệu sau biểu đồ. (8) Xoá thử một tệp của riêng mình: nghe giai đoạn và biên lai. (9) Settings → Màu của riêng bạn: mỗi ô màu có tên; dòng tổng kết đọc số phép kiểm đạt/trượt. (10) Bật một theme tương phản thật của Windows (Settings → Accessibility → Contrast themes): tab đang mở, thanh tiến độ, ô bản đồ vẫn thấy; chọn Tuỳ chỉnh thì màu của mình được giữ.
> - **Sửa sau lần thử Narrator đầu tiên (2026-09-26):** người dùng báo Narrator vẫn đọc, nhưng thỉnh thoảng tự nhảy sang một chỗ trông trống trơn trong lúc không thao tác gì. **Đo trên app thật** (CDP, monitor 15 s): mỗi lần monitor đọc số thì history.json được ghi, rồi `app:data-changed`. Có hai màn dựng lại DOM đang hiển thị: **Automatic** (12 ô tick danh mục, 4 danh sách thư mục, bảng task) và **Trends** (menu ổ, biểu đồ cùng bảng số liệu ẩn, 3 danh sách). 7 màn còn lại không thay gì. Focus đang ở ô tick bị xoá khỏi trang và rơi về `body`. Ở Automatic, chữ đang gõ bị đè lại giá trị đã lưu, kể cả khi đã Tab và đã hiện "Unsaved changes." Ở Trends, ô "đo hằng ngày" chưa lưu cũng bị đè. Một nút mở màn khác (vd. "Open Restore" ở System) cũng làm focus rơi về `body`. Máy người dùng bật monitor 60 s, tức mỗi phút một lần. **Sửa:** `setText`/`replaceChildrenIfChanged` trong app.js (chỉ thay khi khác; nếu có thay thì trả focus về control cùng vị trí). Automatic chỉ đọc lại phần mà tệp vừa ghi có thể đổi. Form chỉ được nạp lại khi chính settings.json đổi và không có chỗ nào đang sửa dở; "đang sửa" được đánh dấu ngay khi gõ (`input`). Ô tick danh mục dựng một lần rồi chỉ cập nhật. Biểu đồ Trends được vá tại chỗ (`patchTree`). Trends có cờ "đang sửa" riêng cho phần đo hằng ngày. `selectTab` chuyển focus lên tab mới khi focus còn nằm trong màn vừa bị ẩn. **Harness:** `npm run test:idle` (45 kiểm tra). Nó đọc số thật qua `sampler` với source `monitor` và đi qua watcher thật. Trên code cũ nó báo 13 FAIL, đúng các lỗi trên; trên code mới pass hết. **Sửa kèm harness:** `test-explorer` trượt 2/5 lần ở `color-contrast` (4.34:1, `#2e69ec` trên `#f1f3f7`). Nguyên nhân: con trỏ chuột thật nằm trên dòng đầu, và axe đo đúng lúc transition hover 120 ms đang chạy dở (màu cuối là chữ `--text` trên `--surface-3`, đạt). Giờ harness giả lập `prefers-reduced-motion: reduce` như test-a11y, và pass 6/6 lần. **Chưa tách được nguyên nhân của lần nhảy:** nó xảy ra khi người dùng đang chạy một job nặng khác song song. Sau khi dừng job đó, người dùng xác nhận Narrator chạy ổn trên 0.1.16, tức bản vẫn còn lỗi dựng lại. Dù vậy, lỗi dựng lại vẫn là lỗi thật và đã đo được (focus rơi về `body`, mất chữ đang gõ), nên vẫn sửa.

#### I3. Menu chuột phải trong Explorer

- Mục **"Phân tích bằng CleanDrive"** cho thư mục và ổ. Mục **"Tìm bản trùng của file này"** cho file.
- Windows 11: [Unverified] menu chuột phải kiểu mới yêu cầu một `IExplorerCommand` đăng ký qua package identity (sparse package). Nếu chưa làm được thì dùng menu cổ điển (*Show more options*) qua registry HKCU.
- Có thể bật/tắt trong Settings. Gỡ cài đặt app thì xoá sạch các khoá này.

> **✅ Đã code xong (2026-09-25).** Code ở `src/main/lib/context-menu.js` (danh sách khoá, tệp `.reg`, đọc lại, `reconcile`, script gỡ cài đặt), `src/main/launch-target.js` (đọc `--analyze=`/`--duplicates-of=` như dữ liệu không tin cậy), `main.js` (đọc đích từ argv, chuyển qua single-instance lock, gửi vào cửa sổ khi trang đã tải, đối chiếu menu mỗi lần mở app), IPC `explorer:status`, `explorer:set`, `dupes:copiesOf` và sự kiện `app:target` (manifest lên 62 kênh), chế độ `copiesOf` trong `lib/duplicate.js`, settings v6 (`explorer.contextMenu`), `scripts/build.js` (sinh `build/installer.nsh`, `nsis.include`), card `src/renderer/explorer.js`, phần nhận đích trong `app.js`. Harness: `scripts/test-contextmenu.js` (51 kiểm tra, trong `npm test`; reg.exe giả lập `scripts/fake-reg.js`, parser chạy trên một bản `reg export` thật), `scripts/verify-contextmenu.js` (22 kiểm tra, **registry thật**, khoá `CleanDrive.harness.*`, người dùng đồng ý trước khi chạy), `scripts/verify-launch-target.js` (13 kiểm tra, **app thật** mở bằng `--analyze=`, bản thứ hai bằng `--duplicates-of=`, đọc DOM qua cổng debug), `scripts/test-explorer.js` (21 kiểm tra, Electron, card và kết quả tìm bản sao, có axe), 4 kiểm tra mới trong `test-settings-migration.js`, ảnh chụp `npm run shoot:explorer`. Khác với đặc tả ở trên:
> - **Chỉ menu cổ điển** qua `HKCU\Software\Classes` (Directory, Directory\Background, Drive, `*`). Menu kiểu mới cần một COM DLL native trong một sparse package MSIX **đã ký**; app không có chứng chỉ và không dùng addon native. Trên Windows 11 hai mục nằm trong "Show more options" (Shift+F10). Đo trên máy này qua Shell COM: thư mục có mục "Phân tích…", tệp có mục "Tìm bản trùng…" và không có "Phân tích…".
> - **Tắt sẵn, bật trong Settings** (đã chốt). Card đọc lại registry mỗi lần mở tab, không tin vào setting. Bật/tắt ghi registry trước rồi mới lưu setting, nên Windows từ chối thì setting vẫn nói đúng điều đang có. `settings:save` từ cửa sổ không đổi được mục này. Chỉ bản đã cài mới có (lệnh phải trỏ tới `CleanDrive.exe`; bản dev là electron.exe).
> - **Ghi bằng `reg.exe import`, đọc bằng `reg.exe export`**, không dùng `reg add` từng giá trị: một lần gọi, tệp UTF-16 do app tự viết, nên nhãn tiếng Việt nguyên vẹn và dấu ngoặc của lệnh là escape của định dạng `.reg`. `reg query` in theo code page của console, làm hỏng tiếng Việt (giống `attrib` ở B3), nên không dùng để đọc giá trị. `reg.exe` luôn được gọi bằng đường dẫn tuyệt đối trong System32, với tham số cố định.
> - **Lệnh là `"<exe>" --analyze="%1"`** (một token): Chromium đảo thứ tự switch và tham số rời. Bản thứ hai tự đọc argv của nó và gửi kết quả qua `additionalData` của single-instance lock; bản đang chạy kiểm lại. Ổ gốc `C:\` đến dạng `C:"` do cách Windows tách `"C:\"`; đã xử lý. Đường dẫn tương đối, không tồn tại, sai loại (tệp thay cho thư mục và ngược lại), có ký tự NUL đều bị bỏ qua, cửa sổ không nhận gì.
> - **Mỗi lần mở app đối chiếu lại** (như Task Scheduler): bật thì khoá phải trỏ đúng exe hiện tại và đúng ngôn ngữ (đổi ngôn ngữ thì ghi lại nhãn ngay), tắt thì không còn khoá nào. Không có gì khác thì không ghi.
> - **Chỉ một mục mỗi lần** (`MultiSelectModel=Single`): với menu cổ điển, chọn 40 mục sẽ chạy lệnh 40 lần.
> - **"Phân tích"** mở Disk usage và quét luôn (người dùng đã bấm "Phân tích" trong Explorer; quét chỉ đọc). **"Tìm bản trùng"** tìm bản sao **trong thư mục Home**, hoặc cả ổ nếu tệp nằm ngoài Home (đã chốt), bằng chế độ mới của trình tìm bản trùng: chỉ đọc hash các tệp cùng kích thước với tệp đích, chỉ trả về nhóm chứa tệp đó; không tick gì, bản cũ nhất vẫn là bản gợi ý giữ.
> - **Gỡ cài đặt:** `customUnInstall` trong `build/installer.nsh`, sinh từ đúng danh sách khoá app ghi (test đối chiếu hai bên), và không chạy khi cập nhật (`${ifNot} ${isUpdated}`; uninstaller của bản cũ cũng chạy lúc cập nhật). Đã build installer đầy đủ vào thư mục tạm: NSIS biên dịch được. [Unverified] **Chưa cài rồi gỡ thật** (bản cài thử có cùng `appId` với bản thật của người dùng và sẽ đè lên nó).
> - **Sửa kèm:** (a) `webContents.isLoading()` đo được vẫn trả `true` ngay trong `did-finish-load`, làm lần mở đầu tiên bằng `--analyze` không nhận được thư mục; thay bằng cờ riêng theo sự kiện tải trang (harness app thật bắt được). (b) Nhãn "bản giữ lại" (`.keeper-tag`) ở Duplicates là chữ accent trên nền accent mờ, dưới 4,5:1 khi dòng đang được trỏ, focus hoặc tick (axe bắt được); chữ giờ là `--text`, accent là viền. (c) Cùng lỗi đó ở nút View/Reveal/Open khi con trỏ nằm trên nút (4,13:1): chữ khi hover giờ là `--text`. (d) Một khung tiến độ đến sau câu trả lời ghi đè dòng kết quả của Duplicates ("Grouping by size…" thay cho "không có bản sao nào"); cửa sổ giờ bỏ qua khung tiến độ khi việc tìm (và việc quét) đã xong. Cả (b), (c), (d) đều có từ trước I3, chỉ lộ ra khi chạy lặp harness. (e) Vì (b) và (c) chỉ bị bắt khi con trỏ thật tình cờ nằm đúng chỗ, `test-a11y.js` giờ ép `:hover` và `:focus-within` qua CDP (`CSS.forcePseudoState`) lên từng loại control ở 6 màn × 2 theme rồi kiểm tương phản: thêm 25 kiểm tra, cộng một kiểm tra rằng việc ép thật sự đổi thứ được vẽ. Đã thử đảo ngược bản sửa (c): harness báo lỗi ngay (4,13:1 ở cả hai theme), rồi khôi phục.

#### I4. Onboarding

Ba màn, bỏ qua được, chỉ hiện lần đầu:
1. *"CleanDrive cho bạn thấy, rồi để bạn quyết định."* Minh hoạ màn hình với verdict và độ tin cậy.
2. *"Vào Thùng rác không có nghĩa là đã giải phóng."* Minh hoạ động: thanh dung lượng ổ C không thay đổi khi file vào bin.
3. *"Chọn thư mục đầu tiên."* Các nút shortcut hiện có.

Có thể xem lại trong Settings → Giới thiệu.

> **✅ Đã code xong (2026-09-25).** Code ở `src/main/intro.js` (quyết định có phải lần đầu hay không, trước khi có cửa sổ; truyền `intro=1` qua URL như theme và ngôn ngữ), `src/renderer/intro.js` (ba màn trong một `<dialog>` gốc), markup trong `index.html`, CSS phần "The introduction" và luật `forced-colors` cho hình minh hoạ trong `styles.css`, bản dịch trong `vi.js`. Harness: `scripts/test-intro.js` (11 kiểm tra, trong `npm test`: ai được giới thiệu), `scripts/test-onboarding.js` (40 kiểm tra, Electron: tự mở ở lần đầu, Tiếp/Quay lại/Bỏ qua/Esc/Xong, focus và tên dialog cho screen reader, axe trên cả ba màn ở theme sáng, tối và tiếng Việt, reduced motion, theme tương phản giả lập, nhớ đã xem, chọn thư mục thì không tự quét), ảnh chụp `npm run shoot:intro`. Khác với đặc tả ở trên:
> - **"Chỉ hiện lần đầu"** được hiểu là lần đầu app chạy trên tài khoản này, không phải lần đầu của phiên bản này. Main xem trên đĩa: `settings.json`, `history.json` (mỗi lần mở app đều ghi một lần đo), thư mục `journal`, `trash-ledger.json`; có một trong bốn thứ đó là đã từng dùng. Vì vậy **người nâng cấp từ bản cũ không thấy màn giới thiệu**. Thư mục không đọc được thì coi như đã dùng (không làm phiền). Cửa sổ còn nhớ trong localStorage để không hiện hai lần nếu lần ghi đầu tiên thất bại.
> - **Settings → Giới thiệu không tồn tại**; nút "Xem lại phần giới thiệu" nằm trong card Phiên bản và cập nhật.
> - **Màn 1** minh hoạ bằng chính các class của một dòng thật (badge verdict, danh sách lý do), nên theo đúng theme, cả theme Tuỳ chỉnh.
> - **Màn 2** là hai ổ đĩa đặt cạnh nhau (sau khi chuyển vào Thùng rác: đầy như cũ; sau khi dọn Thùng rác: vơi đi), cộng hai câu app ghi cạnh nút ("Chưa giải phóng cho tới khi dọn Thùng rác", "Giải phóng dung lượng, không xoá gì"). **Không có con số nào**, và ghi rõ là hình minh hoạ, không phải ổ của người dùng. Phần "động" là một tệp đi vào thùng rác; ai bật giảm chuyển động thì không có gì di chuyển, thùng rác chỉ hiện là đang chứa tệp.
> - **Màn 3**: các nút thư mục đường tắt (cùng đường dẫn thật trong tooltip), nút chọn thư mục, và thêm một nút mở màn Hệ thống. Chọn thư mục thì **chỉ chọn**, focus về nút "Quét thư mục"; việc quét vẫn do người dùng bấm (harness kiểm tra không có lần quét nào tự chạy).
> - Không có quảng cáo Pro nào trong ba màn (quy tắc 7), không có request mạng.
> - **Sửa kèm:** vài bản dịch của I2 viết "cần xem" cho verdict `review`, lệch với "nên xem lại" app dùng ở mọi chỗ khác; đã thống nhất.

## 6. Ma trận gói (Free / Pro / Business)

| Tính năng | Free | Pro | Pro·Dev | Business |
| --- | :-: | :-: | :-: | :-: |
| Toàn bộ tính năng hiện có của README | ✅ | ✅ | ✅ | ✅ |
| Xác nhận, cảnh báo cloud, nhãn tin cậy, Restore Center (I1) | ✅ | ✅ | ✅ | ✅ |
| A1 Bóc tách hệ thống | ✅ | ✅ | ✅ | ✅ |
| A3 Treemap cơ bản | ✅ | ✅ | ✅ | ✅ |
| A3 Treemap tô màu theo tuổi / verdict / nguồn | — | ✅ | ✅ | ✅ |
| B3 OneDrive dehydrate | ✅ | ✅ | ✅ | ✅ |
| D1 Danh sách app + dung lượng | ✅ | ✅ | ✅ | ✅ |
| D4 Cache app phổ biến | ✅ | ✅ | ✅ | ✅ |
| G4 Automatic — 1 hồ sơ | ✅ | ✅ | ✅ | ✅ |
| I2 Accessibility, I3 Menu Explorer, I4 Onboarding | ✅ | ✅ | ✅ | ✅ |
| A2 Quét MFT | — | ✅ | ✅ | ✅ |
| A4 Nhiều gốc / nhiều ổ / ổ ngoài / ổ mạng | — | ✅ | ✅ | ✅ |
| A5 Snapshot diff | — | ✅ | ✅ | ✅ |
| B1 Quarantine | — | ✅ | ✅ | ✅ |
| B2 Relocate · B4 Nén · B5 Đóng gói | — | ✅ | ✅ | ✅ |
| D1 Lần dùng cuối · D2 Game · D3 Chat | — | ✅ | ✅ | ✅ |
| E1–E5 Ảnh & video nâng cao | — | ✅ | ✅ | ✅ |
| F1–F3 Trùng lặp nâng cao | — | ✅ | ✅ | ✅ |
| G1 Planner · G2 Báo cáo · G3 Tóm tắt | — | ✅ | ✅ | ✅ |
| G4 Không giới hạn hồ sơ tự động | — | ✅ | ✅ | ✅ |
| C1–C5 Developer Pack · F4 Hardlink | — | — | ✅ | ✅ |
| H1 CLI · H2 Policy · H3 Console · H4 Audit | — | — | — | ✅ |

**Giới hạn của Free** là những chỗ mà `UpgradeHint` được phép xuất hiện:
- Chọn gốc thứ hai / chọn "Toàn bộ ổ" (A4).
- Trends phát hiện tăng → *"Xem cái gì đã tăng"* (A5).
- Trên màn Trends, khi cột *moved to the bin* của tháng lớn hơn đáng kể so với *actually freed* → *"Cách ly sang ổ khác để giải phóng ngay"* (B1). Gợi ý nằm dưới bảng, **không** nằm trong hộp thoại xác nhận hay toast kết quả (quy tắc 7), có nút *"Không nhắc lại"*.
- Thêm hồ sơ tự động thứ hai (G4).
- Mở tab Developer, Ứng dụng (cột lần dùng cuối), Game, Chat.

---
## 7. Thương mại hoá — giao diện production, thanh toán giả lập

**Mục tiêu của Giai đoạn 6:** mọi màn hình, trạng thái, câu chữ và luồng đều giống bản production. Chỉ có hai khác biệt:
1. `MockPaymentProvider` luôn trả về **thành công**.
2. License được ký bằng **khoá dev**, và chỉ bản build kênh `dev` mới tin khoá này.

Khi sang Giai đoạn 7, chỉ cần thay provider và khoá công khai, **không sửa UI**.

### 7.1. Trạng thái license

```
            ┌─────────── activate(key) ────────────┐
            ▼                                      │
 ┌──────┐ startTrial ┌───────┐  purchase  ┌────────┴┐  expires  ┌─────────┐
 │ free │──────────►│ trial │──────────►│ active  │─────────►│ expired │
 └──────┘           └───┬───┘            └────┬────┘           └────┬────┘
    ▲                   │ trial ends          │ deactivate          │ renew
    │                   ▼                     ▼                     │
    │              ┌─────────┐            ┌──────┐                  │
    └──────────────│ expired │            │ free │◄─────────────────┘ (không gia hạn)
                   └─────────┘            └──────┘
```

| Trạng thái | Tính năng Pro | Dữ liệu Pro (snapshot, báo cáo, vùng cách ly) | Automatic dùng tính năng Pro |
| --- | --- | --- | --- |
| `free` | Khoá, có `UpgradeHint` | — | — |
| `trial` | Mở, có banner số ngày còn lại | Đầy đủ | Chạy |
| `active` | Mở | Đầy đủ | Chạy |
| `expired` | **Chỉ đọc** | Xem, xuất, khôi phục được | Hồ sơ dùng tính năng Pro **tự chuyển sang report-only** và màn Automatic hiện rõ lý do. **Không bao giờ dừng âm thầm** |

### 7.2. Các màn hình

Tất cả nằm ở **Settings → Gói & bản quyền**, cộng thêm một modal **Nâng cấp** mở từ `UpgradeHint`.

#### 7.2.1. Màn "Gói & bản quyền"

```
┌──────────────────────────────────────────────────────────────┐
│ Gói & bản quyền                                              │
│                                                              │
│  Hiện tại: CleanDrive Pro · Hàng năm                         │
│  Hết hạn: 24/09/2027 · Tự gia hạn: Tắt                      │
│  Kích hoạt trên: 2 / 3 máy                                   │
│  Email: a@example.com                                        │
│                                                              │
│  [Quản lý máy đã kích hoạt]  [Nhập mã bản quyền]            │
│  [Gia hạn]  [Nâng cấp lên Business]  [Bỏ kích hoạt máy này] │
│                                                              │
│  Hoá đơn gần đây                                             │
│   24/09/2026  Pro · 1 năm   499.000 ₫   [Xem hoá đơn]        │
└──────────────────────────────────────────────────────────────┘
```

#### 7.2.2. Modal "Chọn gói"

- Ba cột: **Free** (gói hiện tại) · **Pro** · **Business**. Add-on **Dev** là checkbox trong cột Pro.
- Công tắc **Hàng năm / Trọn đời** (trọn đời = trọn major version, xem 7.6).
- Công tắc tiền tệ **VND / USD**. Mặc định theo ngôn ngữ giao diện: tiếng Việt → VND.
- Mỗi cột liệt kê tính năng, lấy từ bảng `FEATURES` để không bị lệch với code.
- Nút **Dùng thử Pro 14 ngày — không cần thanh toán** nếu máy chưa từng dùng thử.
- Dòng cam kết cố định cuối modal: *"Mọi tính năng an toàn và khôi phục luôn miễn phí. Hết hạn không làm mất dữ liệu."*

#### 7.2.3. Checkout

```
┌───────────────────────────────────────────────┐
│ Thanh toán                                    │
│                                               │
│ CleanDrive Pro · 1 năm            499.000 ₫   │
│ + Developer Pack                  199.000 ₫   │
│ Mã giảm giá [__________] [Áp dụng]            │
│ VAT (đã gồm)                                  │
│ ─────────────────────────────────────────     │
│ Tổng                              698.000 ₫   │
│                                               │
│ Email nhận bản quyền  [________________]      │
│ Số máy                [ 3 ▾ ]                 │
│                                               │
│ Phương thức                                   │
│  ( ) Thẻ quốc tế                              │
│  ( ) MoMo                                     │
│  ( ) VNPay                                    │
│  ( ) Chuyển khoản ngân hàng (QR)              │
│                                               │
│ [ ] Tôi đồng ý Điều khoản & Chính sách hoàn   │
│     tiền                                      │
│                                               │
│            [ Hủy ]   [ Thanh toán 698.000 ₫ ] │
└───────────────────────────────────────────────┘
```

Các con số giá ở trên chỉ là **dữ liệu mẫu**. [Speculation] Giá thật cần khảo sát thị trường. Giá được đọc từ `commerce/plans.json`, không hardcode trong UI.

**Quy tắc UI:**
- Nút Thanh toán chỉ bật khi email hợp lệ, đã chọn phương thức và đã tick điều khoản.
- Email chỉ được dùng để gắn vào license. Không lưu ở đâu khác ngoài payload license.
- Trạng thái của nút: `Thanh toán` → `Đang xử lý…` (spinner, khoá modal) → chuyển sang màn kết quả.
- Mọi lỗi đều có câu chữ riêng. Mock cũng phải mô phỏng được lỗi (xem 7.4), để UI lỗi được làm và kiểm thử ngay từ bây giờ.

#### 7.2.4. Màn kết quả

- **Thành công:** *"Cảm ơn bạn. CleanDrive Pro đã được kích hoạt trên máy này."* Hiện mã bản quyền (có nút sao chép), hạn dùng, số máy, và nút **Lưu mã vào file**. Các tính năng Pro mở ngay, không cần khởi động lại.
- **Thất bại / huỷ / chờ xác nhận:** mỗi trạng thái có một màn riêng (xem bảng lỗi ở 7.4).

#### 7.2.5. Banner

| Khi | Nội dung | Vị trí |
| --- | --- | --- |
| Trial còn ≤ 3 ngày | "Còn 3 ngày dùng thử Pro" + [Chọn gói] | Dải mỏng trên cùng, đóng được, hiện tối đa một lần mỗi ngày |
| Hết hạn | "Pro đã hết hạn. Tính năng Pro đang ở chế độ chỉ đọc; mọi dữ liệu vẫn còn." + [Gia hạn] | Settings → Gói & bản quyền, và màn Automatic nếu có hồ sơ bị ảnh hưởng |

Banner **không bao giờ** xuất hiện trong màn đang quét, đang xoá, hộp thoại xác nhận hay toast.

### 7.3. Giao diện provider

```js
// src/main/commerce/provider.js
/**
 * @typedef CheckoutRequest
 * @property {string}  planId        // 'pro-annual' | 'pro-lifetime' | 'business-annual'
 * @property {string[]} addons       // ['dev']
 * @property {number}  seats
 * @property {'VND'|'USD'} currency
 * @property {'card'|'momo'|'vnpay'|'bank_qr'} method
 * @property {string}  email
 * @property {string}  [coupon]
 * @property {string}  machineId     // xem 7.5
 */

/**
 * @typedef CheckoutResult
 * @property {'succeeded'|'failed'|'cancelled'|'pending'} status
 * @property {string}  [orderId]
 * @property {string}  [licenseToken]  // chỉ có khi succeeded
 * @property {string}  [errorCode]     // 'card_declined' | 'network' | 'timeout' | ...
 */

/** @interface */
export class PaymentProvider {
  /** @returns {Promise<Plan[]>} */ async plans() {}
  /** @returns {Promise<{valid:boolean, discount?:number, reason?:string}>} */ async coupon(code, planId) {}
  /** @returns {Promise<CheckoutResult>} */ async checkout(req, { signal }) {}
  /** @returns {Promise<CheckoutResult>} */ async status(orderId) {}
  /** @returns {Promise<Invoice[]>} */ async invoices(email) {}
}
```

### 7.4. MockPaymentProvider

```js
// src/main/commerce/mock-provider.js
import { issueDevLicense } from '../license/dev-issuer.js';
import plans from './plans.json' with { type: 'json' };

const delay = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); });
});

export class MockPaymentProvider {
  constructor({ outcome = process.env.CLEANDRIVE_MOCK_OUTCOME ?? 'succeeded', latencyMs = 1200 } = {}) {
    this.outcome = outcome;     // 'succeeded' | 'failed:card_declined' | 'cancelled' | 'pending' | 'failed:network'
    this.latencyMs = latencyMs;
    this.orders = new Map();
  }

  async plans() { return plans; }

  async coupon(code, planId) {
    if (code?.toUpperCase() === 'TEST10') return { valid: true, discount: 0.10 };
    return { valid: false, reason: 'coupon.notFound' };
  }

  async checkout(req, { signal } = {}) {
    await delay(this.latencyMs, signal);
    const orderId = `mock_${Date.now().toString(36)}`;
    const [status, errorCode] = this.outcome.split(':');

    if (status !== 'succeeded') {
      this.orders.set(orderId, { status, errorCode });
      return { status, orderId, errorCode };
    }

    const plan = plans.find(p => p.id === req.planId);
    const licenseToken = issueDevLicense({
      tier: plan.tier,
      addons: req.addons,
      seats: req.seats,
      email: req.email,
      orderId,
      expires: plan.period === 'annual' ? addYears(new Date(), 1).toISOString() : null,
      perpetualUpTo: plan.period === 'lifetime' ? currentMajor() : currentMajorPlusOneYear(),
    });
    this.orders.set(orderId, { status: 'succeeded', licenseToken });
    return { status: 'succeeded', orderId, licenseToken };
  }

  async status(orderId) { return this.orders.get(orderId) ?? { status: 'failed', errorCode: 'order.notFound' }; }
  async invoices() { return [...this.orders.entries()].filter(([, o]) => o.status === 'succeeded').map(([id]) => ({ id, url: null })); }
}
```

**Mặc định:** `succeeded`, đúng yêu cầu. Biến `CLEANDRIVE_MOCK_OUTCOME` cho phép kiểm thử các nhánh khác mà không phải sửa code.

**Bảng trạng thái mà UI phải xử lý** (mock phải mô phỏng được tất cả):

| Kết quả | Câu hiển thị | Hành động |
| --- | --- | --- |
| `succeeded` | "CleanDrive Pro đã được kích hoạt." | Đóng / Sao chép mã |
| `failed:card_declined` | "Ngân hàng từ chối giao dịch. Bạn chưa bị trừ tiền." | Thử phương thức khác |
| `failed:network` | "Không kết nối được máy chủ thanh toán. Bạn chưa bị trừ tiền." | Thử lại |
| `failed:timeout` | "Chưa nhận được xác nhận. Nếu bạn đã bị trừ tiền, bản quyền sẽ được gửi tới email." | Kiểm tra lại (`status(orderId)`) |
| `cancelled` | "Bạn đã huỷ thanh toán." | Quay lại |
| `pending` (chuyển khoản QR) | "Đang chờ xác nhận chuyển khoản." | Kiểm tra lại · Nhập mã khi nhận được email |

### 7.5. License: định dạng & phát hành

**Định dạng token:**

```jsonc
// payload (base64url) + "." + chữ ký Ed25519 (base64url)
{
  "v": 1,
  "kid": "dev-2026-01",        // key id: 'dev-*' chỉ được tin trong build kênh dev
  "tier": "pro",               // 'pro' | 'business'
  "addons": ["dev"],
  "seats": 3,
  "email": "a@example.com",
  "orderId": "mock_lx8k2",
  "issuedAt": "2026-09-24T09:30:00Z",
  "expires": "2027-09-24T09:30:00Z",   // null = không hết hạn
  "perpetualUpTo": "2.x",              // phiên bản được dùng vĩnh viễn sau khi hết hạn
  "trial": false
}
```

```js
// src/main/license/dev-issuer.js — CHỈ tồn tại trong build kênh dev
import { sign, createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

const DEV_PRIVATE_KEY_PEM = readFileSync(new URL('./dev-keys/private.pem', import.meta.url), 'utf8');

export function issueDevLicense(fields) {
  const payload = Buffer.from(JSON.stringify({
    v: 1, kid: 'dev-2026-01', issuedAt: new Date().toISOString(), trial: false, ...fields,
  }));
  const sig = sign(null, payload, createPrivateKey(DEV_PRIVATE_KEY_PEM));
  return `${payload.toString('base64url')}.${sig.toString('base64url')}`;
}
```

```js
// src/main/license/verify.js
import { verify } from 'node:crypto';
import { BUILD_CHANNEL } from '../build-info.js';
import PROD_KEYS from './keys/prod.json' with { type: 'json' };  // { "prod-2027-01": "-----BEGIN PUBLIC KEY-----..." }
import DEV_KEYS  from './keys/dev.json'  with { type: 'json' };

const trustedKeys = () => BUILD_CHANNEL === 'dev' ? { ...PROD_KEYS, ...DEV_KEYS } : PROD_KEYS;

export function readLicense(token, now = Date.now()) {
  try {
    const [p, s] = token.trim().split('.');
    const payload = Buffer.from(p, 'base64url');
    const lic = JSON.parse(payload.toString('utf8'));
    const pub = trustedKeys()[lic.kid];
    if (!pub) return { state: 'free', reason: 'license.unknownKey' };
    if (!verify(null, payload, pub, Buffer.from(s, 'base64url'))) return { state: 'free', reason: 'license.badSignature' };
    if (lic.expires && now > Date.parse(lic.expires)) return { ...lic, state: 'expired' };
    return { ...lic, state: lic.trial ? 'trial' : 'active' };
  } catch {
    return { state: 'free', reason: 'license.malformed' };
  }
}
```

**Kích hoạt và số máy:**
- `machineId` = SHA-256 của `MachineGuid` (registry) cộng một salt riêng của app. Không bao giờ gửi `MachineGuid` gốc đi đâu.
- **Giai đoạn 6:** giới hạn số máy chỉ được mô phỏng cục bộ. Màn "Quản lý máy đã kích hoạt" hiện danh sách giả lập.
- **Giai đoạn 7:** kích hoạt online một lần (có thể có đường kích hoạt offline qua file yêu cầu / file phản hồi cho doanh nghiệp).

**Lưu trữ:** token lưu trong `%APPDATA%\CleanDrive\license.dat`, mã hoá bằng DPAPI (phạm vi người dùng). Chú ý: đây là **file thứ năm** được ghi ngoài Recycle Bin, phải cập nhật README.

**Trial:**
- Tạo bằng `issueDevLicense({ trial: true, expires: +14d })` trong Giai đoạn 6. Ở Giai đoạn 7 sẽ do server phát hành.
- Chống dùng thử lại: lưu dấu `trialUsed` (theo `machineId`) trong registry HKCU. [Inference] Cơ chế này dễ vượt qua. Chấp nhận được, vì chống vượt quyền quá mức mâu thuẫn với triết lý của app.

### 7.6. Mô hình "perpetual fallback"

- License **theo năm**: hết hạn thì mất quyền dùng tính năng Pro **trên các phiên bản phát hành sau `expires`**. Các phiên bản phát hành trước ngày hết hạn vẫn dùng Pro vĩnh viễn.
  - Cài đặt: mỗi bản build có `releaseDate`. `can()` coi license là `active` nếu `releaseDate <= expires`.
  - [Inference] Cách này công bằng với người dùng và không cần kiểm tra online định kỳ.
- License **trọn đời**: dùng mọi bản thuộc major version đã mua (`perpetualUpTo: "2.x"`).
- Business: theo năm, không có perpetual fallback (thông lệ doanh nghiệp). [Speculation] Cần xác nhận bằng khảo sát khách hàng.

Điều chỉnh `can()` ở 4.4:

```js
export function effectiveState(lic, build = BUILD_INFO) {
  if (lic.state !== 'expired') return lic.state;
  if (lic.tier === 'business') return 'expired';
  if (lic.expires && Date.parse(build.releaseDate) <= Date.parse(lic.expires)) return 'active';
  if (lic.perpetualUpTo && satisfiesMajor(build.version, lic.perpetualUpTo)) return 'active';
  return 'expired';
}
```

### 7.7. Mạng & bảo mật cho luồng thanh toán

- Renderer vẫn **không được** truy cập mạng. Mọi request thanh toán đi qua IPC `commerce.checkout` sang main process.
- Giai đoạn 7, nếu cổng thanh toán cần trang web (3-D Secure, MoMo, VNPay): mở một `BrowserWindow` riêng với session riêng (`partition: 'checkout'`), không có preload, `contextIsolation: true`, `sandbox: true`, và chỉ cho phép điều hướng trong danh sách domain của cổng thanh toán. Hoặc mở trình duyệt mặc định, sau đó nhận license qua deep link `cleandrive://activate?token=…`.
- **Không bao giờ** nhập số thẻ vào form do app tự vẽ. Ở Giai đoạn 6, lựa chọn "Thẻ quốc tế" chỉ là radio button. Màn nhập thẻ thật sẽ là của cổng thanh toán ở Giai đoạn 7.
- Deep link `cleandrive://activate`: token vẫn phải qua `readLicense()`. Token không hợp lệ thì bỏ qua và báo lỗi, không làm gì khác.

### 7.8. Rào chắn để mock không lọt vào bản release

```js
// scripts/release-guard.mjs — chạy trong `npm run build`, fail thì dừng build
import { readFileSync, globSync } from 'node:fs';   // fs.globSync cần Node ≥ 22

const errors = [];
const channel = process.env.CLEANDRIVE_CHANNEL;
if (channel !== 'dev') {
  for (const f of globSync('dist-app/**/*.js')) {
    const src = readFileSync(f, 'utf8');
    if (src.includes('MockPaymentProvider')) errors.push(`${f}: MockPaymentProvider in release`);
    if (src.includes('dev-2026-01') || src.includes('BEGIN PRIVATE KEY')) errors.push(`${f}: dev key material in release`);
    if (src.includes('CLEANDRIVE_ENTITLEMENTS')) errors.push(`${f}: entitlement override in release`);
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
```

```js
// src/main/commerce/index.js
import { BUILD_CHANNEL } from '../build-info.js';
export async function getProvider() {
  if (BUILD_CHANNEL === 'dev') return new (await import('./mock-provider.js')).MockPaymentProvider();
  return new (await import('./real-provider.js')).RealPaymentProvider();   // Giai đoạn 7
}
```

- Thư mục `src/main/license/dev-keys/` và `mock-provider.js` bị loại khỏi `files` của electron-builder khi `CLEANDRIVE_CHANNEL !== 'dev'`.
- Trong kênh dev, Settings → Phiên bản hiện dòng nhỏ *"Kênh: dev · Thanh toán: giả lập"*. **Màn checkout thì không có dấu hiệu gì khác biệt**, đúng yêu cầu giống production. Có thể tắt dòng này bằng một cờ dev để chụp ảnh marketing.
- [Inference] Nếu Giai đoạn 7 chưa xong mà vẫn cần phát hành bản beta công khai, bản đó nên build ở kênh `beta` với entitlements mở toàn bộ và **ẩn hẳn** mục mua hàng, thay vì phát hành với mock.

### 7.9. Kiểm thử thương mại

| Harness | Kiểm tra |
| --- | --- |
| `scripts/license-verify.mjs` | Chữ ký đúng/sai, `kid` lạ, token cắt cụt, payload bị sửa, hết hạn, perpetual fallback theo `releaseDate` |
| `scripts/entitlements-matrix.mjs` | Với mỗi (tier × addon × state), mọi feature key cho đúng `can()`. So với bảng ở mục 6, được sinh ra thành Markdown để đối chiếu |
| `scripts/e2e-commerce.mjs` | Boot app → free → UpgradeHint → chọn gói → checkout (mỗi `CLEANDRIVE_MOCK_OUTCOME`) → kích hoạt → tính năng mở → giả lập hết hạn → chỉ đọc → Restore Center vẫn hoạt động |
| `scripts/release-guard.mjs` | Chính nó cũng có test: build thử kênh `stable` với một file chứa `MockPaymentProvider` và phải fail |
| `scripts/automatic-expiry.mjs` | Hồ sơ dùng quarantine gặp license hết hạn → chuyển sang report-only, có ghi log, màn Automatic hiện lý do |

---

## 8. Ký số & tích hợp thanh toán thật (giai đoạn cuối)

### 8.1. Code signing

| Hạng mục | Ghi chú |
| --- | --- |
| Chứng chỉ | OV hoặc EV code signing. [Unverified] Chính sách SmartScreen với từng loại chứng chỉ thay đổi theo thời gian. Cần kiểm tra yêu cầu hiện tại trước khi mua. Cũng nên cân nhắc Azure Trusted Signing |
| Ký gì | Installer, `CleanDrive.exe`, `cleandrive-helper.exe`, addon native (A2), mọi `.dll` tự viết |
| Timestamp | Luôn có RFC 3161 timestamp, để chữ ký vẫn hợp lệ sau khi chứng chỉ hết hạn |
| Helper | Tiến trình chính kiểm tra chữ ký của `cleandrive-helper.exe` **trước khi** khởi chạy nó bằng UAC |
| Update | Auto-update kiểm tra chữ ký của gói mới, và publisher phải khớp với publisher đang chạy |
| Scheduled task | Task trỏ tới binary đã ký. Cơ chế "app bị di chuyển thì tự sửa" hiện có vẫn giữ |
| MSIX (tuỳ chọn) | Cần cho menu Explorer kiểu mới trên Windows 11 (I3) qua sparse package |

### 8.2. Thanh toán thật

| Hạng mục | Nội dung |
| --- | --- |
| Cổng quốc tế | Merchant-of-record (Paddle, Lemon Squeezy, FastSpring…) để họ lo VAT và thuế. [Unverified] Cần kiểm tra điều kiện với doanh nghiệp / cá nhân Việt Nam |
| Cổng Việt Nam | MoMo, VNPay, chuyển khoản QR (VietQR). [Unverified] Cần kiểm tra thủ tục đăng ký merchant và yêu cầu pháp lý (hoá đơn điện tử) |
| License server | Nhận webhook từ cổng thanh toán → phát hành token bằng **khoá production** (lưu trong HSM hoặc KMS, không bao giờ nằm trên máy dev) → gửi email → lưu bản ghi kích hoạt |
| Kích hoạt | Online một lần; offline qua file cho Business |
| Thu hồi | Chỉ khi hoàn tiền hoặc gian lận. Danh sách thu hồi được **kiểm tra cùng lúc với kiểm tra update** (một request hiện có), không thêm request riêng. Nếu người dùng tắt update check thì không kiểm tra thu hồi. [Inference] Đây là đánh đổi có chủ đích để giữ đúng cam kết về mạng |
| Hoàn tiền | Chính sách rõ ràng (ví dụ 14 ngày). Hoàn tiền thì token bị thu hồi, và app chuyển về `free` — **vùng cách ly và dữ liệu vẫn giữ nguyên, vẫn khôi phục được** |

### 8.3. Việc cần làm khi chuyển từ mock sang thật

1. Viết `RealPaymentProvider` theo đúng interface 7.3.
2. Thêm khoá công khai production vào `keys/prod.json`.
3. Bật `release-guard.mjs` cho kênh `stable`.
4. Chạy lại `e2e-commerce.mjs` với sandbox của cổng thanh toán.
5. Cập nhật README (mục 9).
6. **Không sửa file UI nào.** Nếu phải sửa UI, đó là dấu hiệu Giai đoạn 6 chưa mô phỏng đủ, và cần bổ sung case đó vào mock.

---

## 9. Thay đổi cần cập nhật vào README

| Mục trong README | Thay đổi |
| --- | --- |
| *At a glance* | Thêm các màn: Hệ thống, Ứng dụng, Game, Developer, Khôi phục, Planner, Gói & bản quyền |
| *Deleting* | Đổi thành *Actions*: mô tả bảng ActionKind và cột "giải phóng volume gốc?" |
| *Rules the interface will not break* | Thêm quy tắc 4–8 của mục 2 |
| *What it deliberately does not do* | Giữ nguyên "no shred, no force, no empty-bin". Bổ sung: không đọc nội dung tin nhắn chat, không tự gỡ app, không tự chạy lệnh hệ thống (chỉ handoff), không có lệnh xoá tự do trong CLI |
| *Network* | Liệt kê đầy đủ các request: kiểm tra update (kèm danh sách thu hồi), thanh toán (chỉ khi bấm), kích hoạt license (chỉ khi bấm), tải bộ mã hoá video nếu chọn phương án đó (chỉ khi bấm) |
| *Files written outside the Recycle Bin* | Từ 4 lên: hash cache, settings, **Action Journal** (thay cho bản ghi bin cũ), log chạy tự động, **snapshot store**, **license.dat**, **vùng quarantine** (trên ổ do người dùng chọn), **file báo cáo H3** (khi bật policy) |
| *Limits* | Bỏ "one folder at a time" (chỉ còn là giới hạn của Free), bỏ "no high-contrast". Thêm giới hạn của D3 (phụ thuộc định dạng app chat), A2 (chỉ NTFS), H4 (phát hiện nhưng không ngăn được) |
| *Running and building it* | Thêm `CLEANDRIVE_CHANNEL`, `CLEANDRIVE_ENTITLEMENTS`, `CLEANDRIVE_MOCK_OUTCOME`, `npm run build:helper`, `npm run guard:release` |
| *Runtime dependencies* | Ghi lại quyết định cho addon native (A2), bộ mã hoá video (E3), bản đồ offline (E4) |

---

## 10. Rủi ro & câu hỏi mở

| # | Rủi ro / câu hỏi | Ảnh hưởng | Hướng xử lý |
| --- | --- | --- | --- |
| R1 | Định dạng dữ liệu Zalo / Telegram không công khai và có thể đổi | D3 Mức 3, E5 | Thiết kế ba mức; chỉ phát hành mức nào có harness pass trên nhiều phiên bản |
| R2 | ~~Đọc MFT cần addon native, mâu thuẫn quy tắc dependency~~ **Không xảy ra (2026-09-27).** Node đọc được volume khi đã elevated, nên toàn bộ là CommonJS thuần, không addon, không build step. Rủi ro còn lại là khác: bộ phân tích byte chạy trong tiến trình quyền quản trị | A2 | Threat model trong header `ops.js`; `test-helper.js` đọc cả `mft.js`/`ntfs.js`; parity chạy qua `scan()` trong `verify-mft.js` |
| R3 | Encode video cần bộ mã hoá bên ngoài | E3 | Chốt một trong ba phương án ở E3 trước khi bắt đầu Giai đoạn 4 |
| R4 | Hardlink làm người dùng hiểu sai | F4 | Chỉ Dev Pack, sau cờ ẩn, cảnh báo bắt buộc |
| R5 | Nhiều hành động mới = nhiều bề mặt tấn công hơn (junction swap, TOCTOU) | B1, B2, B5, F4 | Mở rộng harness "phía kẻ tấn công"; kiểm tra lại đường dẫn ngay trước mỗi `apply` bằng handle đã mở |
| R6 | Quarantine làm người dùng tưởng dữ liệu đã an toàn trong khi ổ quarantine là ổ USB dễ mất | B1, E2 | Hộp thoại xác nhận nói rõ loại ổ đích; cảnh báo khi đích là ổ rời |
| R7 | Tính năng Free quá mạnh làm giảm tỷ lệ chuyển đổi, hoặc quá yếu làm mất niềm tin | Doanh thu | [Speculation] Theo dõi được là khó vì app không có telemetry; cân nhắc khảo sát tự nguyện trong app (người dùng bấm mới gửi) |
| R8 | Không có telemetry thì không đo được hiệu quả của UpgradeHint | Doanh thu | Chỉ dùng số liệu phía cổng thanh toán (số đơn, trial → paid), không thêm tracking trong app |
| R9 | Mock lọt vào bản release | Mất doanh thu, uy tín | `release-guard.mjs` + loại file khỏi build + test của chính guard |
| R10 | Giai đoạn 7 (pháp lý, merchant VN) có thể mất nhiều thời gian hơn phần code | Thời điểm bán | Bắt đầu thủ tục pháp lý song song với Giai đoạn 4–5 dù code làm sau cùng |

**Câu hỏi cần anh quyết định:**
1. Giá và đơn vị tiền tệ chính thức (Giai đoạn 6 dùng dữ liệu mẫu).
2. Developer Pack là add-on riêng hay gộp vào Pro?
3. Phương án bộ mã hoá video (E3).
4. Có làm bản đồ offline (E4) không, hay chỉ gom nhóm theo toạ độ?
5. Có cần kênh `beta` công khai trước Giai đoạn 7 không (xem 7.8)?
6. Số máy mặc định cho mỗi license Pro.

---

## 11. Việc còn mở — ai làm được

Danh sách này là **việc còn nợ, không phải ý tưởng**: mỗi dòng là một thứ đã
code xong nhưng chưa được chứng minh trên máy thật, hoặc một quyết định còn
treo. Cập nhật ngày 2026-09-27, ngay sau khi phát hành v0.2.0.

Cột **Ai** chỉ có hai giá trị, và nó là thật chứ không phải quy ước:
**Người dùng** nghĩa là trợ lý *không thể* làm — cần quyền quản trị, cần phần
cứng, cần tai người nghe, hoặc cần một quyết định. **Trợ lý** nghĩa là làm
được ngay khi được bảo.

| # | Việc | Ai | Chạy cái gì / cần gì | Vì sao chưa xong |
| --- | --- | --- | --- | --- |
| 1 | Thùng rác trên ổ gắn ngoài (A4) | **Người dùng** | Cắm một ổ USB **dùng được**, rồi `npm run verify:external -- --drive X:` | Ổ PNY đang cắm báo 0 GB, RAW, offline — **không khởi tạo, không format nó**. Đã chạy đối chứng trên `D:` (kết quả "recycled", bản ghi `$I`/`$R` đúng từng byte). Tới khi đo được, ổ rời vẫn **chỉ đọc**. |
| 2 | ~~Lần chạy cuối của app, từ Prefetch (D1)~~ **Xong 2026-09-27** | — | — | Người dùng đã chạy. 68 chương trình đối chiếu: 67 đúng chiều, 10 trùng tới ngày. Ngoại lệ `TrGUI.exe` được giải thích bằng "một cú bấm không khởi động được gì". Ba lần FAIL đầu đều là **lỗi harness**, đã sửa: nó hỏi "tiến trình thường thấy gì" từ bên trong một tiến trình quyền quản trị, và nó đòi UserAssist phải thấy mọi lần chạy. |
| 3 | Gỡ game thật qua `steam://uninstall/...` (D2) | **Người dùng** | Bấm nút Gỡ trên một game **chấp nhận gỡ thật**, xem Steam có mở đúng hộp thoại không | Cần một game thật để hi sinh. App chỉ giao URI cho Steam, không tự xoá gì, nhưng chưa ai xác nhận Steam nhận đúng. |
| 4 | Ổ FAT / exFAT / ReFS thật (A2) | **Người dùng** | Cắm thẻ nhớ FAT32/exFAT bất kỳ, chọn "Toàn bộ ổ…", bật **Quét nhanh** — dòng trạng thái phải nói "ổ này không phải NTFS" và quét kiểu cũ | Máy này không có ổ nào như vậy. Đường `notNtfs` có **14 kiểm tra** trong `test-roots.js`, nhưng các dòng ổ lạ là **dữ liệu dựng**, ghi rõ trong test. **F4 thêm một nhánh nữa cần đúng thứ ổ này** (2026-10-01): hardlink chỉ làm được trên NTFS, và lời từ chối ấy mới chỉ kiểm bằng dependency injection. Cắm được thẻ nhớ thì chép hai bản giống hệt lên đó, bật cờ ở Cài đặt → Nhà phát triển, và hộp thoại phải nói *"{n} nằm trên ổ không phải NTFS"*. |
| 5 | Narrator trên bản đã sửa lỗi "để yên" (I2) | **Người dùng** | Bật Narrator, đi hết một lượt quét | `test:idle` chứng minh màn hình không bị dựng lại, nhưng **chưa ai nghe bằng tai**. Narrator đã được xác nhận chạy ổn trên 0.1.16, xác nhận chung chứ không theo từng bước. |
| 6 | Theme tương phản cao thật của Windows (I2) | **Người dùng** | Bật High Contrast trong Windows rồi mở app | Mới kiểm trên bản giả lập `forced-colors`. Canvas của treemap **chưa theo** `forced-colors` — đã biết, để I2 làm nốt. |
| 7 | Gỡ cài đặt thật để xác nhận menu Explorer bị xoá (I3) | **Người dùng** | Cài `CleanDrive-Setup-0.2.0.exe` rồi gỡ, kiểm khoá registry của menu chuột phải | Mới kiểm được là NSIS biên dịch được script gỡ. |
| 8 | Quét tăng dần qua USN journal (mục 3 của đặc tả A2) | — | **Quyết định: không làm** | Đo được: USN record **không mang kích thước tệp**, nên chỉ thay được 9% công việc, còn `stat` chiếm 91%. Ghi ở đây để đừng ai mở lại mà không biết lý do. |
| 9 | ~~Một lượt `test:a11y` cho 22 lỗi~~ **Đã chẩn đoán 2026-09-28** — | Chạy lại; nếu tái diễn thì tệp `%TEMP%\cleandrive-a11y-failures-*.txt` đã có sẵn danh sách | **Nguyên nhân: axe chạy trước khi theme mới thật sự tới trang.** Tái hiện được hai lần nữa (40 rồi 42 FAIL), và lần này **giữ được output**. Bằng chứng nằm ngay trong các con số: `.brand-name` có độ tương phản **1,01** — mực `#11151c` trên nền `#10131a`, tức là **mực của bảng sáng trên nền của bảng tối**. Không ai ship chữ ở 1,01; đó là hai bảng màu chồng nhau. Thứ tự trong log khớp hẳn: trong lượt `dark`, màn đầu PASS, sáu màn giữa FAIL, rồi `trends` trở đi PASS lại — một **cửa sổ**, không phải một trạng thái dính. **Cơ chế:** `styles.css` viết bằng `light-dark()` (dòng 31–46), mà hàm này giải theo `color-scheme`, còn `color-scheme` đi theo `nativeTheme.themeSource` — đặt ở **tiến trình chính** và tới renderer lúc nào thì tới. Harness cũ chỉ `await wait(250)`: một phỏng đoán về tải máy, và khi đang chạy nhiều tiến trình Electron thì không đủ. **Lần sửa đầu chưa đủ, và chỗ hụt ấy đáng ghi lại:** chờ "màu đã ổn định và đọc được" vẫn hỏng, vì một trang **vẫn sáng hoàn toàn** sau lệnh "đổi sang tối" thì cũng ổn định và cũng đọc được — hàm chờ trả về ngay, rồi bảng tối ập tới giữa lượt quét. **Lần sửa thứ hai vẫn hụt:** thêm điều kiện "đúng bảng màu được yêu cầu" đo trên `body` thì lượt axe hết lỗi, nhưng phần hover/focus vẫn hỏng — vì `light-dark()` giải **theo từng phần tử**, nên `body` đã tối hẳn mà `.brand-name` vẫn đang đeo mực sáng. **Đã sửa (2026-09-28):** `paletteSettled(mode)` lấy mẫu ở `body`, `.brand-name` và `.tab .tab-label`, chờ tới khi **mọi mực cùng một phía** và nền đúng bảng màu được yêu cầu. Tối đa 8 giây; quá hạn thì là một FAIL **nói rõ lý do**, chứ không phải một loạt lỗi tương phản khó hiểu. Harness cũng ghi danh sách lỗi ra `%TEMP%\cleandrive-a11y-failures-*.txt`. [Inference] Hai lần 22 và 42 lỗi trước đó rất có thể cùng nguyên nhân — cũng toàn lỗi tương phản, cũng không tái hiện được, số lượng đổi theo chỗ trang bị bắt gặp giữa chừng — nhưng output của hai lần ấy đã mất nên **không khẳng định được**. |
| 10 | ~~Ảnh chụp màn hình nằm trong thư mục tên `logs\`~~ **Đã quyết và làm xong 2026-09-27** | — | — | Người dùng chọn **phương án A**: trong thư mục mang nhãn `log`, chỉ tính là log khi **đuôi của chính tệp** cũng nói vậy (`log`, `txt`, `etl`, `out`, `err`, `trace`, `dbg`, đuôi số kiểu `.log.1`, hoặc không có đuôi). Mọi thứ khác rơi xuống các luật sau và được xử như ở bất kỳ đâu. Đo lại trên `D:\work\tow_tool\logs`: **82 ảnh / 78,9 MB trước đây là `safe`, nay còn 0**; 108 tệp `.log` vẫn dọn được như cũ. 8 kiểm tra trong `test-advisor.js`. |
| 11 | Chỉ có **một** máy test | **Người dùng** | Máy thứ hai, hoặc chấp nhận giới hạn | A1 ghi là ba máy. Mọi phép đo trong tài liệu này đều từ một máy Windows 11 duy nhất. |
| 12 | Tốc độ hash qua ổ mạng thật (F1) | **Người dùng** | Một NAS, hoặc một máy thứ hai trên cùng mạng, rồi hash một tệp vài trăm MB từ đó | Đã thử đo qua `\\<địa chỉ LAN>\D$\…` của chính máy này: **không chậm hơn đọc cục bộ** (363–795 MB/s), vì địa chỉ đó là link-local `169.254.x.x` và byte không hề rời khỏi máy — phép đo vô dụng. Chưa có số thật thì không mở nhánh hash ổ mạng trong Duplicates (nguyên tắc D4). |
| 13 | ~~Harness để lại tác vụ Windows chạy lúc đăng nhập~~ **Đã sửa 2026-09-28** | — | `npm run tasks:leftovers` để xem còn sót gì; `npm run verify:task-cleanup` để chứng minh harness tự dọn | **Triệu chứng:** mỗi lần khởi động máy hiện ba hộp thoại "Unable to find Electron app at `D:\personal_projects\cleandrive\scripts`". **Đo được trên máy thật:** Task Scheduler giữ 5 tác vụ trong `\CleanDrive\`; ba trong số đó (`DiskSample_explorer`, `_shootprofiles`, `_shootq`) trỏ `electron.exe "…\cleandrive\scripts" --sample-only` và trả `LastTaskResult = 1` lúc đăng nhập. **Hai nguyên nhân, không phải một.** (a) `selfInvocation()` tin `app.getAppPath()`. Đo trực tiếp: chạy `electron scripts/x.js` thì `getAppPath()` trả về **thư mục `scripts`**, không phải gốc dự án — mà `scripts\` không có `package.json`, nên Electron không nạp được. (b) `CLEANDRIVE_TASK_SUFFIX` chỉ cô lập **tên** tác vụ, không cô lập việc nó **tồn tại thật** trên máy: harness dùng userData mới nên nhận `trends.dailySample: true` mặc định (`lib/settings.js`), `reconcileSampler` đăng ký một tác vụ thật **có LogonTrigger**, và không ai xoá lúc harness thoát. **Đã sửa:** `resolveAppRoot()` đi ngược lên tìm `package.json` có `main`; `invocationProblem()` **từ chối đăng ký** thay vì tạo một tác vụ chết; scheduler ghi sổ tác vụ có suffix và xoá chúng bằng `execFileSync` trong `process.on('exit')`. 4 tác vụ rác đã gỡ khỏi máy (không cần quyền quản trị). **Còn hở, cố ý:** một harness bị **giết** (Ctrl+C, taskkill) vẫn để lại đúng một tác vụ — không có exit handler nào chạy. Lần chạy sau của chính harness đó ghi đè theo tên rồi dọn; ngoài ra thì `npm run tasks:leftovers -- --remove`. |
| 14 | Định dạng `.7z` cho B5 | — | **Quyết định: không làm** | Đặc tả để ngỏ và nói quyết theo harness đo tỷ lệ nén. Harness đã chạy trên tệp thật của máy này: các nhóm chiếm nhiều byte nhất **gần như không nén được** — `.exe` 216,5 MB tiết kiệm 6,1%, `.docx` 201,4 MB tiết kiệm **1,0%**, `.pdf` 144,0 MB tiết kiệm 12,5%, `.zip` 61,7 MB tiết kiệm 0,8%, `.mp4` **−0,0%**. Cả thư mục Downloads: 655,1 MB → 609,7 MB, tức 6,9%. Một thuật toán tốt hơn có thể đổi 6,9% thành khoảng 12% — **không đổi quyết định có đóng gói hay không**, mà phải trả bằng một dependency hoặc một bộ ghi tự viết khá lớn. Ghi ở đây để đừng ai mở lại mà không biết lý do, giống mục 8 (USN). |
| 15 | WOF / XPRESS / LZX cho B4 | — | **Quyết định: không làm** | Đặc tả để hai chế độ và đánh dấu `[Unverified]` rằng tệp WOF "trở về dạng không nén khi bị ghi lại". Đo được trên máy này, và **nặng hơn điều đặc tả ngờ**: một log 3,3 MB nén LZX còn **90.112 byte** trên đĩa, rồi **một lệnh ghi 40 byte tại chỗ** đưa nó về **3.348.890** — mất nén toàn bộ ngay lần ghi đầu, không cần ghi lại cả tệp. LZNT1 cùng phép thử: giữ nguyên 630.784 byte qua cả ghi tại chỗ lẫn thay cả tệp. Tỷ lệ: LZX 96,4% và XPRESS8K 96,4% so với LZNT1 87,5% trên 6,1 MB mã nguồn — **9 điểm**, đổi lấy một phép nén bốc hơi lần đầu có thứ gì chạm vào tệp, mà app thì không thể biết chắc sẽ không có. Mở lại được nếu sau này có cách nhận biết thư mục thật sự chỉ-đọc. |
| 17 | Bản đồ của E4 phụ thuộc một máy chủ ngoài | **Người dùng** | Mở màn Ảnh → bật bản đồ, ở một mạng khác và một thời điểm khác | Đo được **hôm nay, từ máy này**: `tile.openstreetmap.org` bị reset sau 155 ms, còn `a.tile.openstreetmap.org` trả lời sau 190 ms — chặn theo hostname. Một lượt chụp lặp lại cũng **bị giới hạn tần suất** và không lấy được mảnh nào. Cả hai trạng thái đều hiện đúng (ghim vẫn đúng chỗ, có câu giải thích, có ảnh chụp), nhưng *bản đồ có dùng được hay không* là tính chất của mạng chứ không phải của mã — nên nó không kiểm được bằng harness, và `test-media-map.js` **cố ý không chạm mạng**. |
| 18 | Gán tên tỉnh/thành cho ảnh có toạ độ (gạch đầu dòng 3 của E4) | **Người dùng** | Duyệt một bộ dữ liệu ranh giới cấp tỉnh/thành | **Chưa làm.** Cần dữ liệu ngoài, và trên máy này chỉ có **38 tệp** có toạ độ — chưa đủ để đáng một dependency. Ghi ở đây để đừng ai tưởng đặc tả đã giao đủ. |
| 19 | MP4 phân mảnh (`moof`) cho E3 | **Trợ lý** | Một tệp quay bằng trình duyệt, hoặc bất kỳ `.mp4` nào có hộp `moof` | `mp4/demux.js` đọc bảng mẫu trong `moov`, mà một tệp phân mảnh để mẫu trong `moof/trun`. Đo được: **0/73 video trên máy này** dùng dạng đó, nên chưa đáng viết bộ đọc thứ hai — nhưng `MediaRecorder` của chính Chromium ghi ra đúng dạng ấy, nên nó sẽ tới. **Tệp như vậy đã bị từ chối bằng đúng lý do** (`mvex` ⇒ "bị chia thành nhiều mảnh"), kiểm trên một tệp `MediaRecorder` thật — việc còn nợ là *đọc được* chúng, không phải *nói đúng về* chúng. |
| 20 | 308 video chỉ nằm trên `CrossDevice` | **Người dùng** | Quyết định xem có muốn app nói gì về chúng ngoài "chỉ nằm trên mây" không | Đo khi làm E3: **308/381 video (4.591,8 MB mang tên, 0 byte trên đĩa)** là điện thoại nhìn qua Phone Link. E3 từ chối chúng và nói lý do. Nhưng **không màn nào trong app giải thích rằng cả một thư mục là cửa sổ nhìn sang máy khác** — một người dọn ổ đĩa thấy "4,6 GB video" ở đó rất dễ tưởng mình đang chiếm chỗ. |
| 21 | `test:idle` lại fail một lần, và lại mất dòng lỗi | **Trợ lý** | Chạy lại; lần sau nó **tự giữ** danh sách ở `%TEMP%\cleandrive-idle-failures-*.txt` | Lần thứ hai bộ này fail chập chờn (2026-10-01, khi làm E3): **44/1** trong một lượt chạy **bốn bộ liên tiếp**, rồi **45/0 bốn lần liền** sau đó — ba lần chạy riêng và một lần chạy ngay sau `test:a11y`. **Không tái hiện được, và dòng lỗi lại mất** vì lượt chạy ấy chỉ giữ hai con số. Đó đúng là điều §11 mục 9 đã phàn nàn về `test:a11y`, nên **đã sửa theo cùng một cách**: harness ghi danh sách ra tệp. [Inference] Điều kiện duy nhất khác thường của lần fail: bốn bộ Electron chạy nối đuôi nhau, và cùng phiên đó một lượt `shoot:e3` **treo hẳn** ở bước encode fixture với bốn `electron.exe` còn sót từ lượt trước — cả hai đều hướng về tranh chấp tiến trình chứ không về mã, nhưng **chưa có bằng chứng**. |
| 16 | ~~Tính năng chết: code chạy được mà không cửa sổ nào với tới~~ **Đã quét và sửa 2026-09-29** | — | `npm run test:dead` | **Người dùng đặt thành quy tắc thường trực 2026-09-29:** màn nào chưa có thì phải làm, trừ khi roadmap đã hẹn nó ở một mục chưa tới lượt. Lý do: E1 phát hiện `media:similar` nối đủ đầu-tới-cuối — hash tri giác, phép gom nhóm, kênh IPC, một dòng trong preload — và **không cửa sổ nào từng gọi**, chết từ khi hệ ảnh ra đời mà không ai kêu vì không ai nhìn. **Đã quét toàn bộ:** 91 kênh IPC đều với tới được; 112 API trong preload chỉ **một** cái chết (`backupClear`, do chính phiên này thêm ở E2 — đã xoá thay vì dựng một nút không ai cần); 8 loại hành động đều tới được; mọi sự kiện main gửi đều có người nghe; 13 tab ↔ 13 panel không cái nào mồ côi; 27 nhánh settings đều có điều khiển hoặc là sổ sách nội bộ. **Còn lại 6 trường đo xong, gửi lên cửa sổ, không hiện ở đâu.** Ba cái là sự thật người dùng không có cách nào thấy, nay thành dòng bằng chứng: `installDate` của Apps (đo được **505/581 mục registry có ngày cài, 87%** — và ba định dạng: `YYYYMMDD`, `2025/10/06`, `5/6/2025`, kèm khoảng trắng thừa), `updatedAt` của Games, `hasGit` của Dev projects (chỉ nói khi **không** có git, vì đó mới là nửa đổi cách hành xử). Ba cái kia thừa thật — năng lực của chúng đã lên màn bằng đường khác — nên **xoá khỏi payload** để không ai tưởng là tính năng đang chờ giao diện: `steamAppId` (đã có dòng "A Steam game"), `installdir` (hàng đã mang `path`, nút "Mở thư mục" dùng nó), `buildFolders` (màn vẽ từ `summary.buildGroups`). **Và phép quét thành harness** — `scripts/test-deadfeatures.js`, trong `npm test` — nên lớp lỗi này không quay lại được. Harness đã được **chứng minh là bắt được**: thêm tạm một API chết thì nó FAIL, bỏ ra thì PASS. Hai dương tính giả nó phải học cách bỏ qua, và cả hai đều đáng ghi: cầu nối được gọi bằng ba cách (`api.x`, `window.cleandrive.x`, và **xuống dòng giữa chừng** như `language.js` viết), còn `relocate.js` có `kind: 'steam'` ở dòng 145 — một **kiểu handoff**, từ vựng khác trùng chữ — nên phải đọc `kind` trong `module.exports` chứ không phải cái đầu tiên gặp. |
| 22 | ~~Lượt chạy theo lịch luôn báo Windows là đã thành công, và không bao giờ hiện thông báo~~ **Đã sửa 2026-10-01** (tìm ra khi chuẩn bị H1) | — | `npm run verify:scheduled-exit` | **Hai lỗi chồng lên nhau, lỗi này che lỗi kia.** (a) `main.js` kết thúc lượt chạy bằng `process.exitCode = 1` rồi `app.quit()`, có từ v0.1.0. **Đo được dưới Electron 33, trên cả `electron.exe` lẫn `CleanDrive.exe` đã đóng gói: cách đó thoát với mã 0**; chỉ `app.exit(code)` đưa mã ra ngoài. Nên dòng "Task Scheduler code" ở màn Automatic (`describeTaskResult`) không bao giờ có thể nói *"the last run exited with an error"* — nhánh `0x1` của nó là nhánh chết. (b) Commit `0d4f0f6` (2026-09-19) chuyển mọi thông báo sang `lib/notify.js` và bỏ dòng `require` của `Notification` khỏi `scheduled-run.js`, nhưng **quên dòng `Notification.isSupported()`** ở đầu `notify()`. Từ đó mọi lượt chạy có điều cần nói đều ném `ReferenceError` ở bước cuối — sau khi nhật ký chạy đã ghi, nên lượt chạy vẫn được ghi lại đúng, nhưng **không một thông báo nào hiện ra**. (a) giấu (b): lỗi đó đặt `exitCode = 1`, rồi `app.quit()` nuốt mất. Sửa (a) mà không sửa (b) thì **mọi lượt chạy tốt đều thành lượt chạy hỏng** trong mắt Windows. **Harness** chạy `main.js` thật với `--scheduled-run` trên userData riêng, ba lượt: không có gì sai → 0; nhật ký chạy không ghi được (đường dẫn của nó bị một thư mục chiếm) → 1; hồ sơ report-only trên thư mục rỗng, lượt duy nhất đi tới bước thông báo → 0 và không ném lỗi. Trên code cũ: **3 FAIL**, đúng ba chỗ trên; trên code mới: pass hết. Không xoá gì, không thông báo nào lên màn hình (`CLEANDRIVE_TASK_SUFFIX`). Hệ quả cho người dùng: sau bản sửa, lượt chạy theo lịch **bắt đầu hiện thông báo** như README vẫn tả — với ai đã dùng từ 0.1.x thì đó là một thay đổi nhìn thấy được, nên ghi vào ghi chú phát hành. |
| 23 | ~~Bảy chỗ trong `styles.css` gọi một màu không tồn tại~~ **Đã sửa 2026-10-01** | — | `npm run test:theme` | Người dùng báo một chỗ (`.chat-chip` dùng `var(--text-1)`, từ D3). Quét cả stylesheet thì ra **bảy**: thêm sáu chỗ `var(--text-dim)` ở Planner (G1) và dòng Quét nhanh (A2). Trình duyệt không coi đó là lỗi: khai báo thành `unset`, và với `color` nghĩa là "lấy màu của cha". **Đo trong cửa sổ thật, cả hai theme:** cả bảy đều vẽ bằng `--text` — chữ phụ của Planner và Quét nhanh hiện đậm như chữ chính, ngược với điều CSS viết. axe không bắt được, vì màu rơi xuống *đạt* tương phản. **Sửa:** `--text-dim` → `--text-2` (đúng ý "mờ hơn"), `--text-1` → `--text` (màu của chip đo được không đổi, nay chỉ thôi là may mắn). **Harness:** `test-theme.js` có thêm phép kiểm đọc mọi `var(--x)` không fallback trong `src/renderer` và đòi `--x` được khai ở đâu đó (CSS, `setProperty`, hoặc tên do bảng màu sinh); trên code cũ nó FAIL đúng bảy chỗ. Hai chỗ có fallback (`--slow`, `--bg-sunken`) được để yên: chúng không vẽ sai. Ảnh chụp `shoot:planner`, `shoot:fastscan` sau khi sửa: dòng phụ mờ hơn tiêu đề, vẫn đọc rõ ở cả hai theme. |
| 24 | ~~Quét nhanh chưa từng đọc được bảng `$MFT` qua helper thật~~ **Đã sửa 2026-10-01** (lộ ra khi người dùng chạy `verify:cli -- --elevated` cho H1) | — | `npm run verify:mft-pipe`; từ terminal quyền quản trị thêm `-- --real D` | `cleandrive scan D:\ --mft` báo *"could not be read from its catalogue"* trên ổ mà `verify:mft` đọc trơn tru hôm 27/9. **Không harness nào từng gửi một bảng thật qua một helper thật**: `verify:mft` đọc trong tiến trình của chính nó và chỉ mô phỏng wire, `shoot:fastscan` dùng client giả. Harness mới chạy helper thật qua named pipe thật với bảng dựng sẵn — **pass** ở 40.000 và 520.000 tệp, cả helper Electron lẫn Node — nên nghi vấn còn lại là bước mở thiết bị. Chế độ `--real D` (chưa nâng quyền) cho ra câu trả lời ngay: helper Node bị từ chối `EPERM` như phải thế, còn **helper Electron mở được** rồi đọc thì `EISDIR`. Đo trực tiếp: dưới Electron 33 (Node 20.18), `path.toNamespacedPath('\\.\D:')` là `\\.\D:\` — thư mục gốc của D: — và `fs.open` áp nó cho mọi đường dẫn dạng chuỗi; `original-fs` y hệt, nên không phải lớp vá asar; Node 24 để nguyên chuỗi. **Sửa:** `openVolume` đưa đường dẫn dưới dạng Buffer — đo được: helper Electron chưa nâng quyền nay bị `EPERM` ở chính `\\.\D:`. Hệ quả cho người dùng từ Giai đoạn 2: công tắc *Quét nhanh* luôn lặng lẽ walk thay vào. **Đã kiểm trên ổ thật sau bản sửa** (người dùng chạy, terminal quyền quản trị, 2026-10-01): `verify:mft-pipe -- --real D` **7/0** — helper Electron đọc **518.136 tệp, 74.172 thư mục, 323,87 GiB trong 4,7 s**, helper Node 4,2 s, **cùng một bảng**; `verify:cli -- --elevated` **42/0**, `scan D:\ --mft` đọc từ bảng. |
| 25 | ~~Phần cần quyền quản trị của CLI (H1)~~ **Xong 2026-10-01** | — | Từ một terminal **quyền quản trị**: `npm run verify:cli -- --elevated` (checkout), và nếu muốn thì thêm `--packaged <thư mục win-unpacked>` của một bản build kênh `dev` | Harness tự từ chối chạy nếu chính nó không có quyền admin. Nó chạy `cleandrive system` (đòi ≤ 1% chưa giải thích được, ngưỡng của Giai đoạn 1) và `scan D:\ --mft` (đòi `scanner: 'mft'`, và không có hộp thoại UAC nào), và kiểm rằng `--mft` trên một thư mục không phải nguyên ổ trả 2. Chỉ đọc. Phần không cần admin đã chạy: **39/0** checkout, **15/0** bản build stable, **35/0** bản build dev. **Người dùng chạy lần một (2026-10-01): 41/1** — `system` **0,10%** chưa giải thích được trên 426,5 GiB (đạt ngưỡng 1%), `--mft` trên thư mục lẻ trả 2 đúng; **`scan D:\ --mft` FAIL** vì lỗi có sẵn ở mục 24, đã sửa. **Lần hai, sau bản sửa: 42/0** — `scan D:\ --mft` đọc từ bảng, không có hộp thoại UAC nào. |
| 26 | Hai fuse của Electron đang bật trong bản phát hành (Giai đoạn 7) | **Trợ lý**, khi làm ký số | `@electron/fuses`, hoặc tuỳ chọn tương ứng của electron-builder | Đọc trực tiếp từ `CleanDrive.exe` 0.4.0 (2026-10-01, khi làm H1): fuse `10110001` — **`RunAsNode` bật** (`ELECTRON_RUN_AS_NODE=1` biến exe đã ký thành một Node chạy được mọi script) và **`EnableNodeCliInspectArguments` bật** (`--inspect` mở cổng debug). Khi đã ký số thì cả hai biến chữ ký thành giấy phép cho code của người khác. **H1 cố ý không dựa vào cái nào** — CLI chạy ở chế độ Electron thường, và `bin\cleandrive.cmd` còn xoá `ELECTRON_RUN_AS_NODE` — nên tắt chúng không làm gãy gì của H1. Cần đo lại `test:e2e` và các harness dùng `--remote-debugging-port` sau khi tắt (đó là switch của Chromium, không phải fuse, [Inference] nên không bị ảnh hưởng). |
| 27 | ~~`scheduler.js` gọi `schtasks.exe` và `powershell.exe` qua PATH~~ **Đã sửa 2026-10-02** (tìm ra khi chuẩn bị H2) | — | `npm run test:scheduler` | Mọi module khác gọi chương trình Windows bằng đường dẫn tuyệt đối trong System32 — quy tắc có từ 0.5, sau khi đo thấy `whoami.exe` của Git chen trước bản Windows trong PATH. Riêng `scheduler.js` gọi tên trần ở **8 chỗ** (6 `schtasks.exe`, 2 `powershell.exe`). PATH của máy này hiện sạch (đã đo), nên chưa hỏng gì; nhưng cửa sổ và CLI đều có thể được mở từ terminal quyền admin và đều đi qua tệp này mỗi lần reconcile, và `policy apply` (H2) là lệnh IT chạy từ script. **Sửa:** đường dẫn tuyệt đối. **Harness:** `test-scheduler.js` quét toàn bộ `src/main` tìm lời gọi khởi chạy một `.exe` bằng tên trần; trên code cũ nó tìm đúng 8 chỗ. Commit riêng, trước H2. |
| 28 | ~~Phần cần quyền quản trị của H2~~ **Xong 2026-10-02**: lần một **8/1** (FAIL là của harness), chạy lại sau bản sửa **8/0** — đủ cả 8 phép kiểm; quyền đọc khoá là `S-1-5-11 ReadKey, thừa kế, Allow` (Authenticated Users) | — | `npm run verify:policy -- --elevated` từ terminal quyền quản trị | Harness tự từ chối nếu chính nó không có quyền admin, và **từ chối nếu `HKLM\SOFTWARE\Policies\CleanDrive` đã có** (đó là policy của ai đó). Nó ghi khoá thật (chỉ cho xem, thư mục bảo vệ có tên tiếng Việt, tắt update), đọc lại qua CLI bằng `reg.exe`, kiểm **BUILTIN\Users có quyền đọc** khoá (thừa kế từ `Policies`), rồi **đo `reg.exe` dưới `DisableRegistryTools` = 1 và = 2** cho chính tài khoản đó — in mã thoát của `reg export` và đường app đã dùng để đọc (`reg.exe` hay `powershell`) — rồi gỡ giá trị đó, gỡ khoá HKLM, và kiểm cả hai đã mất. Nếu bị ngắt giữa chừng, harness in sẵn lệnh gỡ tay. **Đo được:** `reg.exe` từ chối ở cả 1 và 2 (mã 1), PowerShell đọc được → đường dự phòng ở lại. Phép kiểm quyền đọc hỏng ở lần đầu vì `Get-Acl -LiteralPath` của PowerShell 5.1 không thấy khoá registry, và vì quyền đọc trên `Policies` ở máy này là của **Authenticated Users**, không phải BUILTIN\Users; nay đọc qua `GetAccessControl()` và nhận cả hai. |
| 29 | Nạp ADMX/ADML trong Group Policy thật hoặc Intune | **Người dùng** | Một máy Windows Pro/Enterprise hoặc một tenant Intune: chép `policy\*` vào central store (hoặc import trong Intune), mở *Administrative Templates → CleanDrive*, bật từng chính sách, rồi `cleandrive policy validate` | Máy này là Windows 11 Home, không có gpedit/GPMC. Đã kiểm thay: parser XML của .NET nạp được cả ba tệp, namespace trùng số đông ADMX của Microsoft, mọi khoá/giá trị ADMX ghi đúng là thứ app đọc và ngược lại, bật mọi chính sách theo đúng cách ADMX ghi rồi đọc lại thì tất cả "áp dụng". [Unverified] phần hiển thị trong trình soạn thảo, và việc Intune chấp nhận khoá `Software\Policies\CleanDrive`. |
| 30 | `.panel-bar` thừa 6–10 px mỗi bên ở cửa sổ hẹp | **Trợ lý**, khi được bảo | Đổi lề âm của `.panel-bar` theo đúng phần đệm của `.panel` (một biến CSS) | Tìm ra khi chụp H2 ở 720/560. Thanh dính ở đầu mỗi màn cố ý tràn ra hai mép bằng `margin: -24px`, nhưng ở ≤ 860 px phần đệm của `.panel` giảm còn 18 hoặc 14 px còn lề vẫn −24 px. `<main>` là `overflow-x: hidden` nên **không cuộn ngang được và không chữ nào bị che** — chỉ phần nền bị cắt, và phần đệm trên của thanh mỏng đi 4–8 px. Có từ trước H2; không sửa trong mục này vì không phải lỗi người dùng thấy, và đổi lề của mọi màn thì phải chụp lại mọi màn. |
| 31 | Báo cáo của H3 qua mạng thật | **Người dùng** | Một NAS hoặc máy thứ hai: một thư mục chia sẻ mà các máy được tạo và sửa tệp; trên một máy đặt policy `ReportFolder` trỏ tới đó (hoặc `reg import` vào khoá policy), chạy `cleandrive policy apply`; trên máy kia mở `CleanDrive.exe --console \\…` | Đã kiểm qua `\\localhost\D$` của chính máy này — client và server SMB thật, nhưng byte không rời máy: ghi một báo cáo 10–20 ms, Console đọc 500 tệp 111 ms (cùng lý do phép đo §11 mục 12 vô dụng cho tốc độ). Trường hợp share chết đo được thật (IP không trả lời: tiến trình ẩn sống thêm ~44 s, mã thoát vẫn 0). [Unverified] độ trễ và lỗi trên LAN thật, quyền chỉ-tạo trên máy chủ, share qua VPN. |
| 32 | ~~`test:a11y` để lại một thư mục userData mỗi lượt chạy~~ **Đã sửa 2026-10-02** | — | `npm test`, các bộ Electron, rồi xem `%TEMP%` | Thấy khi làm H3: `%TEMP%` có **118** thư mục `cleandrive-a11y-userdata-*`. Quét hết thì **780 mục, ~972 MB**, không chỉ của `test:a11y`: 52/53 harness Electron tự xoá userData từ *bên trong* tiến trình, mà Chromium (và một `.asar` Electron đã mở) giữ tệp tới khi tiến trình thoát, nên lần xoá bị từ chối. Chỉ `test-idle.js` làm đúng: một tiến trình nhỏ tách riêng chờ harness thoát rồi mới xoá. **Sửa:** cơ chế đó thành `scripts/lib/sandbox.js` (chỉ xoá thư mục `cleandrive*`/`cd-*` nằm thẳng trong `%TEMP%`, không đi theo link), gắn vào cả 53 harness và fixture `.asar` của `smoke.js`; `test-duplicate.js` dọn fixture tên cố định khi thoát. Đo sau khi sửa: `npm test`, `test:e2e`, `test:a11y`, `test:idle`, `test:onboarding`, `test:explorer`, `shoot:console` → **0** thư mục còn lại. Giết tiến trình chính giữa chừng: userData vẫn được dọn; giết cả cây (`taskkill /T`) thì không, và fixture tạo giữa chừng cũng không — ghi trong helper. 780 mục cũ đã xoá (người dùng đồng ý); một junction treo trong fixture cũ của B2 được gỡ riêng, không đi theo. |
| 33 | `shoot:console` một lần báo "the dark palette did not settle" | **Trợ lý** | Chạy lại; nếu tái diễn thì giữ output và xem trang nào | 1 lần trong 6 lượt chạy ngày 2026-10-02, rồi 5 lượt liền không lỗi. Cùng loại phép chờ của §11 mục 9 (8 giây). [Inference] tải máy lúc đó (lượt chạy ngay sau một lượt e2e), chưa có bằng chứng. |

### 11.1. Mục 10 đã quyết: phương án A

Một thư mục tên `logs` (hoặc `log`) được gắn `dirTag: 'log'`, và **mọi tệp bên
trong nó từng thừa hưởng nhãn đó bất kể đuôi của chính nó**. Đuôi `png` không có
trong `EXT_CATEGORY` nên không có gì phản đối; đủ cũ thì thành `safe`.

Người dùng chốt **phương án A** ngày 2026-09-27: trong thư mục mang nhãn `log`,
chỉ tính là log khi đuôi của chính tệp cũng nói vậy. `isLogLike` trong
`lib/advisor.js` giữ danh sách đó, cố ý ngắn — mở rộng thì rẻ, mở rộng sai thì
mất tệp của người ta.

**Đo sau khi sửa:** `D:\work\tow_tool\logs` từ 82 ảnh `safe` (78,9 MB) xuống
**0**; 108 tệp `.log` vẫn dọn được. 8 kiểm tra trong `test-advisor.js`, dựng theo
đúng tên tệp thật (`c1-xong.png`, `client1-vao-game.png`).

### 11.2. Chỗ còn lại, và quyết định giữ nguyên

Quét lại cả cây sau khi sửa thì **vẫn còn 91 ảnh / 21,8 MB được gọi là `safe`**,
nằm ở `D:\work\tow_tool\dist\ToWTool\logs\`. Luật bắt chúng **không phải** luật
log mà là `buildoutput`: `.gitignore` của dự án khai `dist/`, và C5 được thiết kế
đúng theo nguyên tắc "chỉ khi `.gitignore` của dự án khai".

**Người dùng chọn giữ nguyên** (2026-09-27). Lý do: `.gitignore` là lời khai duy
nhất app có về ý định của chủ dự án, và chính tệp đó biết cách chừa ngoại lệ — nó
mang dòng `!img/*.png` — mà không chừa cho `logs/`. Ghi vào README như một giới
hạn đã biết, ở mục Developer Pack.

[Inference] Hệ quả là hai tệp cùng loại có thể nhận hai câu trả lời khác nhau:
`tow_tool\logs\c1-xong.png` được giữ, còn `tow_tool\dist\ToWTool\logs\client1-vao-game.png`
thì `safe`. Khác biệt nằm ở chỗ đường dẫn thứ hai đi qua một thư mục mà chủ dự án
đã tự tay khai là tái tạo được.

