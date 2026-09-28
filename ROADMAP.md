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
| A2 | Quét nhanh qua MFT / USN | P1 | ✅ Đã code xong (2026-09-27) — chỉ `$MFT`, không làm nhánh USN (USN không mang kích thước); công tắc chỉ cho quét cả một ổ NTFS; bộ phân tích byte chạy trong tiến trình quyền quản trị, có ghi threat model |
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
| G2 | Báo cáo HTML | P1 | |
| G3 | Tóm tắt định kỳ | P2 | |
| G4 | Nhiều hồ sơ tự động | P1 | |
| F1 | Trùng lặp xuyên thư mục / xuyên ổ | P1 | |
| F2 | Thư mục trùng toàn bộ | P1 | |
| F3 | Phiên bản tài liệu | P2 | |

### Giai đoạn 4 — Ảnh, chat, di chuyển dữ liệu

| Mã | Tính năng | Ưu tiên |
| --- | --- | --- |
| D3 | Dữ liệu Zalo / Telegram theo cuộc trò chuyện | P1 |
| E1 | Màn so sánh cạnh nhau | P1 |
| E2 | Sao lưu trước khi xoá | P1 |
| E3 | Tạo bản video nhẹ hơn | P2 |
| E4 | Timeline & bản đồ | P2 |
| E5 | Ảnh theo cuộc trò chuyện | P1 (phụ thuộc D3) |
| B2 | Relocate | P1 |
| B4 | Nén NTFS có chọn lọc | P1 |
| B5 | Đóng gói lưu trữ | P1 |
| F4 | Hardlink bản trùng (Dev Pack, có cảnh báo mạnh) | P2 |

### Giai đoạn 5 — Doanh nghiệp

| Mã | Tính năng | Ưu tiên |
| --- | --- | --- |
| H1 | CLI | P1 |
| H2 | Policy qua GPO / Intune (ADMX) | P1 |
| H3 | Console tổng hợp nhiều máy (không cloud) | P1 |
| H4 | Audit log ký số | P1 |

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

---

#### E4. Timeline & bản đồ

| | |
| --- | --- |
| **Gói** | Pro · `pro.photos` |
| **Đối tượng** | P3 |

- **Timeline:** mở rộng histogram năm thành dạng năm → tháng → ngày, phóng to hoặc thu nhỏ được.
- **Bản đồ:** đặt ảnh có GPS lên bản đồ. Theo quy tắc hiện tại, *interface không được truy cập mạng*, nên bản đồ phải là **tile offline đóng gói sẵn ở mức zoom thấp** (đường biên quốc gia / tỉnh vẽ bằng vector). [Speculation] Cần cân nhắc dung lượng bộ cài. Phương án tối giản: chỉ gom nhóm theo toạ độ, hiển thị trên lưới, không có nền bản đồ.
- Việc gán tên địa danh (reverse geocoding) chỉ được làm offline với bộ dữ liệu nhỏ (cấp tỉnh/thành).

---

#### E5. Ảnh theo cuộc trò chuyện

| | |
| --- | --- |
| **Gói** | Pro · `pro.chat` + `pro.photos` |
| **Phụ thuộc** | D3 Mức 3 |

Thêm trục **"Cuộc trò chuyện"** vào màn Photos & video, dùng thanh tỷ lệ giống trục "Where from". Nếu D3 Mức 3 không làm được thì tính năng này không xuất hiện, và UI không để lại dấu vết gì của nó.

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

#### F2. Thư mục trùng toàn bộ

| | |
| --- | --- |
| **Gói** | Pro · `pro.dupes.advanced` |

- Hai thư mục được coi là trùng khi **cùng tập đường dẫn tương đối và cùng hash** cho mọi file. Không tính file ẩn nếu người dùng chọn như vậy (mặc định có tính).
- Thư mục **gần trùng** (≥ 90% file giống nhau): hiện riêng, verdict `review`, và có màn so sánh cây để thấy file nào chỉ có ở một bên.
- Hành động trên thư mục trùng: `recycle` **từng file** trong thư mục (giữ nguyên quy tắc "interface không xoá thư mục"), hoặc `archive` / `quarantine` cả thư mục.

#### F3. Phiên bản tài liệu

| | |
| --- | --- |
| **Gói** | Pro · `pro.dupes.advanced` |

- Gom nhóm theo tên đã chuẩn hoá: bỏ các hậu tố như `_final`, `_v2`, `(1)`, `- Copy`, `bản sao`, ngày tháng trong tên.
- Độ tin cậy **luôn là `guess`**, nâng lên `likely` nếu cùng thư mục và cùng định dạng.
- Mở viewer cạnh nhau (dùng viewer Word/Excel/PDF sẵn có) để người dùng tự xem.
- **Không** có "select all but newest".

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

---

#### H2. Policy qua GPO / Intune

| | |
| --- | --- |
| **Gói** | Business · `biz.policy` |

- File **ADMX / ADML** (tiếng Anh và tiếng Việt) ghi vào `HKLM\Software\Policies\CleanDrive`.
- Policy có thể: bắt buộc bật/tắt Automatic, khoá danh mục được phép, khoá whitelist, tắt kiểm tra update, đặt vùng quarantine, tắt hoàn toàn các hành động xoá (chỉ cho xem), đặt đường dẫn xuất báo cáo cho H3.
- Mọi control bị policy khoá đều hiện biểu tượng khoá kèm dòng *"Do tổ chức của bạn quản lý"*.
- Policy **không được phép** vượt qua các guard cứng: `review` vẫn không bao giờ chạy tự động, vùng hệ thống vẫn bị từ chối, và điều kiện purge vẫn là bốn điều kiện.

---

#### H3. Console tổng hợp nhiều máy (không cloud)

| | |
| --- | --- |
| **Gói** | Business · `biz.console` |

- Mỗi máy (qua policy H2) định kỳ ghi một file `<hostname>.cleandrive.json` vào một **share nội bộ** do IT chỉ định. Không có server của CleanDrive, không có cloud.
- **Console** là một chế độ của chính app (`--console <share>`) đọc các file này và hiện: danh sách máy, % đầy, tốc độ tăng, "khi nào đầy", lần chạy tự động cuối kèm mã thoát, các máy có task bị hỏng.
- Nội dung file mặc định **không chứa tên file cá nhân**, chỉ chứa số liệu volume, danh mục và trạng thái task. Tuỳ chọn gửi top thư mục phải được bật riêng trong policy.
- Có thể lọc, sắp xếp và xuất CSV.

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
| 4 | Ổ FAT / exFAT / ReFS thật (A2) | **Người dùng** | Cắm thẻ nhớ FAT32/exFAT bất kỳ, chọn "Toàn bộ ổ…", bật **Quét nhanh** — dòng trạng thái phải nói "ổ này không phải NTFS" và quét kiểu cũ | Máy này không có ổ nào như vậy. Đường `notNtfs` có **14 kiểm tra** trong `test-roots.js`, nhưng các dòng ổ lạ là **dữ liệu dựng**, ghi rõ trong test. |
| 5 | Narrator trên bản đã sửa lỗi "để yên" (I2) | **Người dùng** | Bật Narrator, đi hết một lượt quét | `test:idle` chứng minh màn hình không bị dựng lại, nhưng **chưa ai nghe bằng tai**. Narrator đã được xác nhận chạy ổn trên 0.1.16, xác nhận chung chứ không theo từng bước. |
| 6 | Theme tương phản cao thật của Windows (I2) | **Người dùng** | Bật High Contrast trong Windows rồi mở app | Mới kiểm trên bản giả lập `forced-colors`. Canvas của treemap **chưa theo** `forced-colors` — đã biết, để I2 làm nốt. |
| 7 | Gỡ cài đặt thật để xác nhận menu Explorer bị xoá (I3) | **Người dùng** | Cài `CleanDrive-Setup-0.2.0.exe` rồi gỡ, kiểm khoá registry của menu chuột phải | Mới kiểm được là NSIS biên dịch được script gỡ. |
| 8 | Quét tăng dần qua USN journal (mục 3 của đặc tả A2) | — | **Quyết định: không làm** | Đo được: USN record **không mang kích thước tệp**, nên chỉ thay được 9% công việc, còn `stat` chiếm 91%. Ghi ở đây để đừng ai mở lại mà không biết lý do. |
| 9 | Một lượt `test:a11y` cho 22 lỗi | **Trợ lý** | Chạy lại và **giữ toàn bộ output** | Không tái hiện được trong 4 lượt sau, kể cả một lượt trên cây sạch `2e9a4eb`. Nguyên nhân mất dấu là output bị cắt bằng `tail`. Harness nay **in lại toàn bộ danh sách lỗi ở cuối**, nên lần sau `tail` cũng thấy. Chưa có chẩn đoán. |
| 10 | ~~Ảnh chụp màn hình nằm trong thư mục tên `logs\`~~ **Đã quyết và làm xong 2026-09-27** | — | — | Người dùng chọn **phương án A**: trong thư mục mang nhãn `log`, chỉ tính là log khi **đuôi của chính tệp** cũng nói vậy (`log`, `txt`, `etl`, `out`, `err`, `trace`, `dbg`, đuôi số kiểu `.log.1`, hoặc không có đuôi). Mọi thứ khác rơi xuống các luật sau và được xử như ở bất kỳ đâu. Đo lại trên `D:\work\tow_tool\logs`: **82 ảnh / 78,9 MB trước đây là `safe`, nay còn 0**; 108 tệp `.log` vẫn dọn được như cũ. 8 kiểm tra trong `test-advisor.js`. |
| 11 | Chỉ có **một** máy test | **Người dùng** | Máy thứ hai, hoặc chấp nhận giới hạn | A1 ghi là ba máy. Mọi phép đo trong tài liệu này đều từ một máy Windows 11 duy nhất. |

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

