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

### Giai đoạn 1 — Nhìn thấy toàn bộ & giải phóng không mất dữ liệu

| Mã | Tính năng | Ưu tiên | Trạng thái |
| --- | --- | --- | --- |
| A1 | Bóc tách dung lượng hệ thống | P1 | |
| A3 | Treemap / Sunburst | P1 | |
| A5 | Snapshot diff | P1 | |
| B1 | Quarantine sang ổ khác | P1 | |
| B3 | OneDrive "Free up space" | P1 | |
| D4 | Cache app phổ biến | P1 | |
| I1 | Restore Center | P1 | ✅ Đã code xong (2026-09-24) |
| I2 | Accessibility (high-contrast, bàn phím, screen reader) | P1 | |
| I3 | Menu chuột phải trong Explorer | P2 | |
| I4 | Onboarding "Moved ≠ freed" | P2 | |

Thứ tự làm (chốt 2026-09-24): I1 → A1 → A3 → A5 → B3 → D4 → B1 → I2 → I4 → I3. Giai đoạn 0 được commit riêng trước (`37179d8`).

**Hoàn thành khi:** trên máy test, tổng của "đã giải thích được" (thư mục người dùng + A1) cộng với dung lượng trống lệch không quá một ngưỡng nhất định so với dung lượng volume. Phần còn lại phải được hiện rõ thành một dòng *"chưa giải thích được: X GB"*, không được che đi.

> **Quyết định đã chốt trước khi code Giai đoạn 1 (2026-09-24):**
> - Tính năng Pro ở bản `stable` trước Giai đoạn 6: **mở cho mọi người** (phương án a). Giai đoạn 6 sẽ phải khoá lại. Chưa quyết cho Pro·Dev và Business: hỏi lại trước Giai đoạn 2 và 5.
> - Helper UAC đã được bấm thử thật: `npm run verify:helper -- --elevated` → ALL PASS, integrity `high`.
> - Chỉ có **một** máy test, không phải ba như A1 ghi.
> - A1: thêm các dòng đặc tả thiếu (chương trình đã cài, phần còn lại của Windows, phần bị bỏ qua khi quét, người dùng khác), và thay `helper:request` dạng chung bằng hai kênh cố định. Fixture chỉ dùng output tiếng Anh thật, parser đọc theo cấu trúc (máy này không có bản dịch vssadmin/DISM).
> - A3: một màu accent đậm nhạt theo độ sâu, không tô theo loại file; bỏ Sunburst; dời tô màu Pro.
> - B1: bản gốc vào Recycle Bin theo mặc định và ghi thật là chưa giải phóng; tuỳ chọn "xoá bản gốc ngay" (tắt sẵn) là cách duy nhất giải phóng ổ C, kèm sửa quy tắc README về xoá vĩnh viễn.
> - B3: harness được tạo file thử trong OneDrive thật (thư mục riêng, tự dọn), nhưng phải hỏi lại ngay trước khi chạy.
> - D4: chỉ phát hành định nghĩa app đã kiểm đường dẫn trên máy này.

### Giai đoạn 2 — Quy mô & chuyên sâu

| Mã | Tính năng | Ưu tiên |
| --- | --- | --- |
| A2 | Quét nhanh qua MFT / USN | P1 |
| A4 | Quét nhiều gốc, nhiều ổ, ổ ngoài, ổ mạng | P1 |
| C1–C5 | Developer Pack | P1 |
| D1 | App đã cài: dung lượng & lần dùng cuối | P1 |
| D2 | Thư viện game | P1 |

### Giai đoạn 3 — Lập kế hoạch & trùng lặp nâng cao

| Mã | Tính năng | Ưu tiên |
| --- | --- | --- |
| G1 | Space Planner | P1 |
| G2 | Báo cáo HTML | P1 |
| G3 | Tóm tắt định kỳ | P2 |
| G4 | Nhiều hồ sơ tự động | P1 |
| F1 | Trùng lặp xuyên thư mục / xuyên ổ | P1 |
| F2 | Thư mục trùng toàn bộ | P1 |
| F3 | Phiên bản tài liệu | P2 |

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
> - Danh sách thao tác trong Giai đoạn 0 chỉ có `ping` (pid + integrity level của chính helper). `system.breakdown`, `shadowstorage.query`, `dism.analyze` đi cùng A1; `mft.enumerate`, `usn.query` đi cùng A2; `prefetch.list` đi cùng D1. Harness đọc `ops.js` và fail nếu xuất hiện API ghi/xoá/chạy lệnh.
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
> - Chưa có IPC `snapshot:list`/`snapshot:diff`: chúng đi cùng A5.
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

#### I3. Menu chuột phải trong Explorer

- Mục **"Phân tích bằng CleanDrive"** cho thư mục và ổ. Mục **"Tìm bản trùng của file này"** cho file.
- Windows 11: [Unverified] menu chuột phải kiểu mới yêu cầu một `IExplorerCommand` đăng ký qua package identity (sparse package). Nếu chưa làm được thì dùng menu cổ điển (*Show more options*) qua registry HKCU.
- Có thể bật/tắt trong Settings. Gỡ cài đặt app thì xoá sạch các khoá này.

#### I4. Onboarding

Ba màn, bỏ qua được, chỉ hiện lần đầu:
1. *"CleanDrive cho bạn thấy, rồi để bạn quyết định."* Minh hoạ màn hình với verdict và độ tin cậy.
2. *"Vào Thùng rác không có nghĩa là đã giải phóng."* Minh hoạ động: thanh dung lượng ổ C không thay đổi khi file vào bin.
3. *"Chọn thư mục đầu tiên."* Các nút shortcut hiện có.

Có thể xem lại trong Settings → Giới thiệu.

---

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
| R2 | Đọc MFT cần addon native, mâu thuẫn quy tắc dependency | A2 | Addon tự viết trong repo; harness parity với scanner thường |
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
