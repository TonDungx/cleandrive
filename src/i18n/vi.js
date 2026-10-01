'use strict';

/**
 * Vietnamese.
 *
 * Keys only — the English is in the source, next to where it is used, and any
 * key missing here falls back to it. That is deliberate: a half-finished
 * dictionary shows English, not `auto.schedule.title`.
 *
 * ## House style for this file
 *
 * The English in this app is plain and specific, and says what is actually true
 * rather than what sounds reassuring — "moved to the Recycle Bin" is never
 * called "freed". The Vietnamese has to carry the same distinctions, because
 * that distinction is the product:
 *
 *   - *moved* → **chuyển vào Thùng rác**, *freed* → **giải phóng**. Never both
 *     as "xoá", which is exactly the confusion the English is written to avoid
 *   - *Recycle Bin* → **Thùng rác**; *scan* → **quét**; *volume* → **ổ đĩa**
 *   - *scheduled run* → **lần chạy theo lịch**
 *   - **Task Scheduler** is left in English: it is the name of the Windows
 *     window the user has to open to find the entry, and translating it would
 *     send them looking for something that is not there
 *   - Product names, versions, file names and paths are never translated
 *   - Vietnamese marks no plural, so `*.one` and `*.other` map to one word and
 *     the count stays a number next to it
 */

(function (root, factory) {
  const table = factory();
  const i18n = typeof module === 'object' && module.exports ? require('./index') : root.CleanDriveI18n;
  if (i18n) i18n.register('vi', table);
  if (typeof module === 'object' && module.exports) module.exports = table;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return {
    /* ---- chrome, and words used everywhere ---------------------------- */
    'app.tab.usage': 'Dung lượng đĩa',
    'app.tab.cleanup': 'Nên xoá gì',
    'app.tab.dupes': 'Trùng lặp',
    'app.tab.trends': 'Xu hướng',
    'app.tab.auto': 'Tự động',
    'app.sidebar.sections': 'Các mục',
    'app.sidebar.hide': 'Ẩn thanh bên',
    'app.sidebar.hideShort': 'Ẩn',
    'app.sidebar.show': 'Hiện thanh bên',
    'app.sidebar.resize': 'Kéo để đổi độ rộng; kéo hết cỡ để ẩn',
    'app.tab.settings': 'Cài đặt',

    'app.pickFolder': 'Chọn thư mục…',
    'app.noFolder': 'Chưa chọn thư mục',
    'app.pickToBegin': 'Chọn một thư mục để bắt đầu.',
    'app.appearance': 'Giao diện',
    'app.theme.system': 'Tự động',
    'app.theme.light': 'Sáng',
    'app.theme.dark': 'Tối',
    'app.theme.systemHint': 'Theo giao diện của hệ thống',
    'app.theme.lightHint': 'Luôn sáng',
    'app.theme.darkHint': 'Luôn tối',
    'app.theme.failed': 'Không lưu được cài đặt giao diện.',

    'app.cancel': 'Huỷ',
    'autoclean.busy': 'Đang có một lượt dọn dẹp tự động chạy. Thử lại sau một lát.',
    'app.stop': 'Dừng',
    'app.stopping': 'Đang dừng…',
    'app.add': 'Thêm',
    'app.addFolder': 'Thêm thư mục…',
    'app.remove': 'Xoá khỏi danh sách',
    'app.reveal': 'Mở thư mục chứa',
    'app.open': 'Mở',
    'app.checkNow': 'Kiểm tra ngay',
    'app.checking': 'Đang kiểm tra…',
    'app.saving': 'Đang lưu…',
    'app.loading': 'Đang tải…',
    'app.preparing': 'Đang chuẩn bị…',
    'app.notSaved': 'Không có gì được lưu.',
    'app.clearSelection': 'Bỏ chọn tất cả',
    'app.nothingSelected': 'Chưa chọn gì',
    'app.selectedCount': 'Đã chọn {n} · {size}',
    'app.moveSelected': 'Chuyển mục đã chọn vào Thùng rác',
    'app.on': 'Bật',
    'app.off': 'Tắt',
    'app.off.lower': 'tắt',
    'app.never': 'Chưa bao giờ',
    'app.never.lower': 'chưa bao giờ',
    'app.yes': 'có',
    'app.no': 'không',
    'app.at': 'Lúc',
    'app.days': 'ngày',
    'app.minutes': 'phút',
    'app.min': 'phút',
    'app.seconds': 'giây',
    'app.seconds': '{n} giây',
    'app.unknownError': 'Lỗi không xác định',
    'app.cancelledPartial': 'Đã huỷ — kết quả chưa đầy đủ.',

    // English needs two forms of each; Vietnamese needs one.
    'app.file.one': 'tệp',
    'app.file.other': 'tệp',
    'app.item.one': 'mục',
    'app.item.other': 'mục',
    'app.location.one': 'vị trí',
    'app.location.other': 'vị trí',

    'app.ago.unknown': 'không rõ',
    'app.ago.today': 'hôm nay',
    'app.ago.yesterday': 'hôm qua',
    'app.ago.days': '{n} ngày trước',
    'app.ago.months': '{n} tháng trước',
    'app.ago.years': '{n} năm trước',
    'app.lastOpened': 'Mở lần cuối {when}',
    'app.modified': 'Sửa lần cuối {when}',

    'app.eta.almost': 'sắp xong',
    'app.eta.seconds': 'còn {n} giây',
    'app.eta.minutes': 'còn {n} phút',
    'app.eta.hours': 'còn {h} giờ',
    // Một khoảng thời gian, không phải ước lượng còn lại: các khoá `eta` ở
    // trên đều mang chữ "còn".
    'app.span.seconds': '{n} giây',
    'app.span.minutes': '{n} phút',
    'app.span.hoursMinutes': '{h} giờ {m} phút',
    'app.span.hours': '{h} giờ',
    'app.eta.hoursMinutes': 'còn {h} giờ {m} phút',

    // Labels that only ever appear in front of an error message.
    'app.label.scan': 'Quét',
    'app.label.dupes': 'Tìm trùng lặp',
    'app.label.delete': 'Xoá',
    'app.label.paths': 'Đường dẫn',
    'app.label.folderPicker': 'Chọn thư mục',
    'app.label.chooseFolder': 'Chọn thư mục',
    'app.label.saveSettings': 'Lưu cài đặt',
    'app.label.settings': 'Cài đặt',
    'app.label.diskUsage': 'Dung lượng đĩa',

    'app.path.downloads': 'Tải xuống',
    'app.path.documents': 'Tài liệu',
    'app.path.pictures': 'Hình ảnh',
    'app.path.videos': 'Video',
    'app.path.music': 'Nhạc',
    'app.path.desktop': 'Màn hình nền',
    'app.path.home': 'Thư mục người dùng',
    'app.path.temp': 'Tệp tạm',
    'app.path.appdata': 'Dữ liệu ứng dụng',

    /* ---- days --------------------------------------------------------- */
    'day.sunday': 'Chủ nhật',
    'day.monday': 'Thứ hai',
    'day.tuesday': 'Thứ ba',
    'day.wednesday': 'Thứ tư',
    'day.thursday': 'Thứ năm',
    'day.friday': 'Thứ sáu',
    'day.saturday': 'Thứ bảy',

    /* ---- disk usage --------------------------------------------------- */
    'usage.scan': 'Quét thư mục',
    'usage.ready': 'Sẵn sàng quét.',
    'usage.failed': 'Quét thất bại.',
    'usage.totalSize': 'Tổng dung lượng',
    'usage.files': 'Tệp',
    'usage.folders': 'Thư mục',
    'usage.scanTime': 'Thời gian quét',
    'usage.whereSpaceWent': 'Dung lượng nằm ở đâu',
    'usage.byType': 'Theo loại tệp',
    'usage.largest': 'Tệp lớn nhất',
    'usage.scanned': 'Đã quét {n} tệp.',
    'usage.unreadable': 'Bỏ qua {n} mục không đọc được.',
    'usage.protectedExcluded': 'Đã loại trừ {n} {locations} hệ thống được bảo vệ — xem tab “Nên xoá gì”.',
    'usage.empty': 'Không tìm thấy tệp nào đọc được trong thư mục này.',
    'usage.typeRow': '{ext} · {n} {files}',
    'usage.noExtension': '(không có đuôi)',

    // The map of the folder on Disk usage.
    'map.view.aria': 'Hiển thị thư mục dạng',
    'map.view.map': 'Bản đồ',
    'map.view.list': 'Danh sách',
    'map.crumbs': 'Thư mục',
    'map.label': 'Bản đồ',
    'map.tree': 'Dung lượng nằm ở đâu trong {folder}',
    'map.rest': '({n} {files} nhỏ hơn)',
    'map.others': '({n} {folders} khác)',
    'map.folder.one': 'thư mục',
    'map.folder.other': 'thư mục',
    'map.small': '({n} mục nhỏ)',
    'map.share': '{share} của {parent}',
    'map.aria.folder': '{name}: {size}, {share} của {parent}, {n} {files}',
    'map.aria.item': '{name}: {size}, {share} của {parent}',
    'map.restHint':
      'Tệp dưới 10 MB, và các tệp nằm ngoài mười tệp lớn nhất, được đếm chung ở đây thay vì vẽ từng tệp.',
    'map.menu.open': 'Mở thư mục này',
    'map.menu.select': 'Thêm vào lựa chọn',
    'map.menu.deselect': 'Bỏ khỏi lựa chọn',
    'map.menu.aria': 'Thao tác với {name}',
    'map.stale': 'Bản đồ này thuộc một lần quét trước. Hãy quét lại để vẽ.',
    'map.empty': 'Không có gì trong thư mục này chiếm dung lượng.',
    'map.partial': 'Lần quét đã dừng sớm, nên đây chỉ là những gì đã đọc được tới lúc đó.',
    'map.movedSince':
      'Đã chuyển vào Thùng rác kể từ lần quét này, nên không còn được vẽ: {n} {files} ({size}). ' +
      'Chưa giải phóng cho tới khi dọn Thùng rác.',
    'map.movedAway':
      'Đã chuyển sang ổ khác kể từ lần quét này và xoá ở đây, nên không còn được vẽ: {n} {files} ({size}), đã giải phóng.',
    'map.hint':
      'Mỗi ô lớn theo dung lượng nó chứa. Tệp từ 10 MB trở lên có ô riêng; phần còn lại của một thư mục ' +
      'dùng chung một ô. Bấm vào thư mục để đi vào, hoặc bấm chuột phải vào một ô để xem thêm.',
    'map.listHint': 'Tệp từ 10 MB trở lên được liệt kê từng tệp; phần còn lại của một thư mục được đếm chung.',

    /* ---- what to delete ----------------------------------------------- */
    'cleanup.safe': 'An toàn để xoá',
    'cleanup.review': 'Nên xem lại',
    'cleanup.protected': 'Vị trí được bảo vệ',
    'cleanup.selectSafe': 'Chọn tất cả mục được đánh dấu an toàn',
    'cleanup.selectAllInGroup': 'chọn tất cả',
    'cleanup.neverDeleted': 'Được giữ lại',
    'cleanup.neverDeletedNote':
      'Các thư mục này chứa chương trình đã cài, hoặc cài đặt và dữ liệu mà chương trình giữ, nên lượt quét ' +
      'dè dặt ở đây: không gì trong này được gọi là an toàn, trừ thứ chương trình tự tạo lại — tệp GPU và tệp ' +
      'lỗi, cùng thư mục đệm riêng của một ứng dụng quen thuộc, hiện ở trên theo tên ứng dụng và chỉ khi ứng ' +
      'dụng đó đang đóng.',
    'cleanup.empty': 'Hãy quét một thư mục để xem thứ gì an toàn để xoá.',
    'cleanup.alreadyClean': 'Không có gì rõ ràng là bỏ được trong thư mục này — nó đã sạch.',
    'cleanup.showingLargest': 'Đang hiện {shown} tệp lớn nhất trong tổng số {total} tệp thuộc nhóm này.',

    'category.temp': 'Tệp tạm',
    'category.cache': 'Bộ nhớ đệm',
    'category.crashdump': 'Tệp ghi lỗi treo',
    'category.log': 'Nhật ký cũ',
    'category.gpucache': 'Đệm GPU và mã đã biên dịch',
    'category.buildoutput': 'Kết quả biên dịch',
    'category.installer': 'Bộ cài cũ',
    'category.archive': 'Tệp nén và ảnh đĩa lớn',
    'category.appcache': 'Bộ nhớ đệm của ứng dụng',
    'category.stale': 'Lớn và lâu không đụng tới',

    // The hint under each group heading. Keyed by category so switching
    // language re-words them without re-running the scan.
    'category.temp.hint': 'Do các ứng dụng bỏ lại mà không tự dọn.',
    'category.cache.hint': 'Sẽ được tạo lại tự động vào lần ứng dụng cần đến.',
    'category.crashdump.hint':
      'Ảnh chụp chẩn đoán từ các chương trình bị treo. Chỉ hữu ích với lập trình viên đang gỡ đúng lỗi đó.',
    'category.log.hint': 'Nhật ký chẩn đoán cũ hơn một tuần.',
    'category.buildoutput.hint': 'Sẽ có lại khi build lại dự án. Mã nguồn không bị đụng tới.',
    'category.installer.hint': 'Tệp cài đặt bạn đã chạy rồi. Tải lại được, nhưng tốn băng thông.',
    'category.archive.hint':
      'Kiểm tra từng tệp — một tệp nén hay ổ đĩa ảo có thể là bản duy nhất của thứ nằm bên trong nó.',
    'category.gpucache.hint':
      'Shader và bytecode đã biên dịch. Mọi ứng dụng nền Chromium đều tạo lại chúng ở lần chạy sau.',
    'category.appcache.hint':
      'Bộ nhớ đệm của các chương trình đã cài. Thường được tạo lại — nhưng chỉ chương trình đó mới biết nó ' +
      'giữ gì ở đây, nên không mục nào được chọn sẵn cho bạn.',
    'category.stale.hint': 'Tệp lớn bạn đã lâu không mở. Bản thân chúng không phải là rác.',

    // Known apps' caches (D4): one group per app.
    'category.app.chrome': 'Google Chrome — bộ nhớ đệm',
    'category.app.edge': 'Microsoft Edge — bộ nhớ đệm',
    'category.app.teams': 'Microsoft Teams — bộ nhớ đệm',
    'category.app.discord': 'Discord — bộ nhớ đệm',
    'category.app.zoom': 'Zoom — bộ nhớ đệm',
    'category.app.figma': 'Figma — bộ nhớ đệm',
    'category.app.zalo': 'Zalo — bộ nhớ đệm',
    'category.app.chrome.hint':
      'Trang, script và hình ảnh Chrome lưu lại để mở web nhanh hơn, cùng mã đồ hoạ nó đã biên dịch. Chrome tự tải ' +
      'lại hoặc tạo lại khi cần; không có gì bạn đã lưu, cũng không có phiên đăng nhập nào nằm ở đây.',
    'category.app.edge.hint':
      'Trang, script và hình ảnh Edge lưu lại để mở web nhanh hơn, cùng mã đồ hoạ nó đã biên dịch. Edge tự tải ' +
      'lại hoặc tạo lại khi cần; không có gì bạn đã lưu, cũng không có phiên đăng nhập nào nằm ở đây.',
    'category.app.teams.hint':
      'Những gì Teams mới lưu lại để mở nhanh hơn, trong trình duyệt nhúng nó chạy trên đó. Teams tự tải lại hoặc ' +
      'tạo lại; tin nhắn, tệp và phiên đăng nhập của bạn không nằm ở đây.',
    'category.app.discord.hint':
      'Hình ảnh, script và mã đồ hoạ Discord lưu lại để mở nhanh hơn. Discord tự tải lại hoặc tạo lại; tin nhắn ' +
      'và phiên đăng nhập của bạn không nằm ở đây.',
    'category.app.zoom.hint':
      'Những gì các khung web nhúng của Zoom lưu lại để mở nhanh hơn. Zoom tự tải lại hoặc tạo lại; cuộc họp, ' +
      'bản ghi và phiên đăng nhập của bạn không nằm ở đây.',
    'category.app.figma.hint':
      'Script, hình ảnh và mã đồ hoạ ứng dụng Figma lưu lại để mở nhanh hơn. Figma tự tải lại hoặc tạo lại; ' +
      'tệp thiết kế của bạn nằm trên đám mây của Figma, không nằm ở đây.',
    'category.app.zalo.hint':
      'Trang, hình ảnh và mã đồ hoạ Zalo lưu lại để mở nhanh hơn. Zalo tự tải lại hoặc tạo lại; tin nhắn, phiên ' +
      'đăng nhập và ảnh người ta gửi cho bạn không nằm ở đây — ảnh nằm ở màn Ứng dụng chat.',
    'cleanup.appOpen': 'đang mở',
    'cleanup.appUnknown': 'không kiểm được',
    'cleanup.appOpenHint': '{app} đang mở. Hãy đóng nó rồi quét lại để dọn bộ nhớ đệm của nó.',
    'cleanup.appUnknownHint': 'Không biết được {app} có đang mở không, nên không đề xuất mục nào ở đây.',
    'reason.appcache.known': 'Thư mục bộ nhớ đệm riêng của {app} — nó tự tạo lại những gì ở đây khi cần',
    'evidence.app.open': '{app} đang mở — hãy đóng nó rồi quét lại',
    'evidence.app.closed': '{app} không chạy lúc lượt quét kết thúc',
    'evidence.app.unknown': 'Không biết được {app} có đang mở không, nên không đề xuất mục nào của nó',

    /* ---- verdicts, as the badge says them ------------------------------ */
    'verdict.safe': 'an toàn',
    'verdict.review': 'nên xem lại',
    'verdict.protected': 'được bảo vệ',
    'verdict.keep': 'giữ lại',
    'cleanup.verdict.safe': 'xoá được an toàn',
    'cleanup.verdict.review': 'tuỳ bạn',
    'cleanup.blocked': 'bị chặn',
    'cleanup.inUse': 'đang dùng',

    /* ---- why a file got its verdict ------------------------------------
     *
     * These are produced by the scanner in the main process and rendered here,
     * so the language they appear in is the one being read *now* rather than
     * the one that was current when the scan ran.
     */
    'reason.dir.temp': 'Nằm trong thư mục tạm',
    'reason.dir.cache': 'Nằm trong thư mục đệm — ứng dụng tự tạo lại khi cần',
    'reason.dir.gpucache': 'Đệm GPU hoặc mã đã biên dịch — được tạo lại ở lần chạy sau',
    'reason.dir.crashdump': 'Tệp ghi lỗi do một chương trình ngừng phản hồi để lại',
    'reason.dir.log': 'Tệp nhật ký cũ',
    'reason.dir.buildoutput': 'Kết quả biên dịch — sẽ có lại khi build lại dự án',
    'reason.ext.temp': 'Tệp tạm hoặc tải xuống dở',
    'reason.ext.crashdump': 'Tệp ghi lỗi từ một chương trình ngừng phản hồi',
    'reason.ext.log': 'Tệp nhật ký cũ',
    'reason.lockFile': 'Tệp khoá của trình soạn thảo, từ một tài liệu không còn mở',
    'reason.appcache':
      'Bộ nhớ đệm của một chương trình đã cài. Thường được tạo lại, nhưng chỉ chương trình đó mới biết nó ' +
      'giữ gì ở đây — hãy kiểm tra trước khi xoá.',
    'reason.archive': 'Hãy chắc nội dung bên trong đã được lưu ở nơi khác trước khi xoá',
    'reason.dependency': 'Nằm trong "{dir}" — mỗi dự án cần bản sao riêng của thứ này',
    'reason.systemOwned': 'Thuộc về hệ điều hành hoặc một chương trình đã cài',
    'reason.binaryModule': 'Một tệp .{ext} được chương trình nào đó nạp — các bản sao thường không thay thế nhau được',

    // Evidence the analyzers add beside a verdict.
    'evidence.noRule': 'Không có quy tắc dọn dẹp nào khớp với tệp này, nên ứng dụng không có lý do gợi ý xoá nó',
    'evidence.atimeUntracked':
      'Windows không ghi lại lúc tệp được mở trên máy này, nên tuổi này là lần sửa đổi cuối cùng',
    'evidence.dupes.identical.one': 'Giống hệt từng byte với 1 bản sao khác, đã xác nhận bằng SHA-256 toàn bộ tệp',
    'evidence.dupes.identical.other':
      'Giống hệt từng byte với {n} bản sao khác, đã xác nhận bằng SHA-256 toàn bộ từng tệp',
    'evidence.dupes.oldest': 'Bản cũ nhất — được gợi ý là bản nên giữ lại',
    // F2 — thư mục trùng toàn bộ.
    'evidence.dupes.folder.one':
      'Cả {n} tệp bên trong đều giống hệt từng byte với tệp ở đúng vị trí đó trong 1 thư mục khác',
    'evidence.dupes.folder.other':
      'Cả {n} tệp bên trong đều giống hệt từng byte với tệp ở đúng vị trí đó trong {c} thư mục khác',
    'evidence.dupes.folder.keeper': 'Bản được đề xuất giữ lại — không có gì trong đây bị đem ra xoá',
    'evidence.dupes.folderFile': 'Nằm trong {folder}, một bản sao giống từng byte của thư mục đang được giữ',
    'evidence.dupes.near':
      'Giống {pct}% so với {other}: {same} tệp giống hệt, {differ} tệp khác nhau, {only} tệp chỉ có ở đây',
    'evidence.dupes.nearFile': 'Giống hệt tệp ở đúng vị trí đó trong {folder}, thư mục đang được giữ',
    // F3 — tài liệu trông như các bản nháp của nhau. Chỉ đọc tên, nên câu chữ
    // ở đây luôn để ngỏ khả năng đoán sai.
    'evidence.dupes.version.marked':
      'Một trong {n} tệp có tên chỉ khác nhau ở {markers} — thường là các bản nháp của cùng một tài liệu, nhưng không phải lúc nào cũng vậy',
    'evidence.dupes.version.formats':
      'Một trong {n} tệp cùng tên trong một thư mục, lưu ở các định dạng khác nhau — thường là một bài làm được xuất ra nhiều lần',
    'evidence.dupes.version.newest': 'Bản được sửa gần đây nhất trong nhóm',
    'evidence.dupes.version.older': 'Được sửa lâu hơn so với một bản khác trong nhóm',
    'evidence.dupes.version.sameTime':
      'Được sửa đúng cùng lúc với bản mới nhất trong nhóm, thường là do sao chép chứ không phải soạn lại',

    // The unit picks the key, so the number can sit where Vietnamese puts it.
    'reason.stale.years': 'Không mở trong {n} năm',
    'reason.stale.months': 'Không mở trong {n} tháng',
    'reason.stale.days': 'Không mở trong {n} ngày',
    'reason.stale.recent': 'Không mở trong ngày qua',
    'reason.archiveStale.years': 'Không mở trong {n} năm — hãy chắc nội dung đã được lưu ở nơi khác trước',
    'reason.archiveStale.months': 'Không mở trong {n} tháng — hãy chắc nội dung đã được lưu ở nơi khác trước',
    'reason.archiveStale.days': 'Không mở trong {n} ngày — hãy chắc nội dung đã được lưu ở nơi khác trước',
    'reason.archiveStale.recent': 'Hãy chắc nội dung bên trong đã được lưu ở nơi khác trước khi xoá',
    'reason.installer.years': 'Bộ cài tải về {n} năm trước — xoá nó không ảnh hưởng gì tới chương trình đã cài',
    'reason.installer.months': 'Bộ cài tải về {n} tháng trước — xoá nó không ảnh hưởng gì tới chương trình đã cài',
    'reason.installer.days': 'Bộ cài tải về {n} ngày trước — xoá nó không ảnh hưởng gì tới chương trình đã cài',
    'reason.installer.recent': 'Bộ cài tải về hôm nay — xoá nó không ảnh hưởng gì tới chương trình đã cài',
    'reason.log.years': 'Không có gì được ghi vào trong {n} năm',
    'reason.log.months': 'Không có gì được ghi vào trong {n} tháng',
    'reason.log.days': 'Không có gì được ghi vào trong {n} ngày',
    'reason.log.recent': 'Không có gì được ghi vào trong ngày qua',

    /* ---- folders the scan refuses to touch ----------------------------- */
    'protected.windows': 'Windows sở hữu thư mục này',
    'protected.programs': 'Hệ điều hành hoặc các chương trình đã cài nằm ở đây',
    'protected.dependency': 'Thư mục phụ thuộc hoặc quản lý phiên bản',
    'protected.hidden': 'Thư mục ẩn',
    'blocked.roaming': 'Dữ liệu ứng dụng dạng roaming — cài đặt, tài khoản và phiên đăng nhập nằm ở đây',
    'blocked.appData': 'Thư mục dữ liệu của một chương trình đã cài',

    /* ---- last-access times --------------------------------------------- */
    'atime.on': 'Windows có ghi nhận thời điểm mở lần cuối trên máy này.',
    'atime.off':
      'Windows không ghi nhận thời điểm mở lần cuối trên máy này, nên "mở lần cuối" được thay bằng ngày sửa đổi.',
    'atime.unknown': 'Không đọc được cài đặt last-access của NTFS.',
    'usage.atime.unavailable': 'Trên máy này không có dữ liệu ngày mở lần cuối.',
    'usage.atime.unconfirmed': 'Không xác nhận được dữ liệu ngày mở lần cuối trên máy này.',
    'usage.atime.fallback': 'Các mốc thời gian bên dưới dựa trên ngày sửa đổi.',
    'usage.scanning': 'Đang quét… {files} tệp, {size} ({elapsed})',

    /* ---- what a scheduled run did, as written to the run log ------------
     *
     * These end up in autoclean-log.json as keys rather than sentences, so a
     * run recorded months ago still reads in whatever language is set today.
     */
    'run.switchedOff': 'Dọn dẹp tự động đang tắt',
    'run.noFolders': 'Chưa cấu hình thư mục nào',
    'run.noCategories': 'Chưa bật nhóm tệp nào để dọn',
    'run.noProcessList': 'Không xác định được những ứng dụng nào đang chạy',
    'run.appsRunning': 'Bỏ qua vì các ứng dụng này đang chạy: {apps}',
    'run.nothingMatched': 'Không có tệp nào khớp với quy tắc dọn dẹp',
    'run.belowThreshold': 'Đĩa mới dùng {used}%, dưới ngưỡng {threshold}%',
    'run.wouldMove': 'Sẽ chuyển {n} tệp vào Thùng rác',
    // G4 — nhiều hồ sơ tự động.
    'run.wouldQuarantine': 'Sẽ chuyển {n} tệp sang ổ khác',
    'run.noSuchProfile': 'Lịch này thuộc về một hồ sơ không còn tồn tại nữa',
    'run.anotherRunning':
      'Một lượt dọn dẹp tự động khác đang chạy, nên lượt này bị bỏ qua. Nó sẽ tới lượt lại theo lịch của chính nó.',
    'run.waitedForLock': 'Đã đợi {s}s cho hồ sơ khác chạy xong rồi mới bắt đầu.',
    'run.noZone': 'Hồ sơ này chuyển tệp sang ổ khác, nhưng chưa chọn thư mục nào để chứa',
    'run.zoneAway': 'Ổ đĩa để chuyển tệp sang hiện không có: {zone}',
    'run.note.keepsOriginal':
      'Bản gốc được giữ lại, nên lượt này không giải phóng byte nào trên ổ vừa dọn — nó còn chép thêm sang ổ kia',
    'run.cancelledBefore': 'Đã huỷ trước khi có gì bị xoá',
    'run.allRefused': 'Mọi ứng viên đều bị các lớp bảo vệ từ chối',
    'run.note.noDiskUsage': 'Không đọc được dung lượng đĩa; ngưỡng phần trăm không được áp dụng',
    'run.note.rootFailed': '{root}: {error}',
    'run.note.purgeFailed': 'Không gỡ được {n} mục trong Thùng rác',
    'run.note.purgeError': 'Dọn Thùng rác thất bại: {error}',
    'run.note.recordFailed': 'Đã dừng sớm: không ghi được bản ghi về những gì đã chuyển đi ({error})',
    'run.note.stillInBin':
      'Các tệp đang nằm trong Thùng rác, vốn ở cùng ổ đĩa — chưa có dung lượng nào trống ra cho tới khi ' +
      'thùng rác được dọn. Bật xoá vĩnh viễn có thời gian chờ để CleanDrive tự dọn phần của nó sau một ' +
      'khoảng thời gian.',

    'auto.describe.off': 'Dọn dẹp tự động đang tắt.',

    /* ---- the native confirmations -------------------------------------- */
    'dialog.confirmDelete.title': 'Xác nhận xoá',
    'dialog.confirmDelete.message': 'Chuyển {n} mục vào Thùng rác?',
    'dialog.confirmDelete.detailBin': '{size} sẽ được chuyển vào Thùng rác, và vẫn khôi phục được từ đó.',
    'dialog.confirmAuto.withPurge':
      'Chúng vẫn khôi phục được trong {days} ngày, sau đó CleanDrive xoá vĩnh viễn phần của nó và dung ' +
      'lượng mới thật sự được giải phóng.',
    'dialog.confirmAuto.withoutPurge':
      'Chúng nằm lại trong Thùng rác. Lưu ý việc này chưa giải phóng dung lượng nào cho tới khi thùng rác được dọn.',
    'dialog.skipped.needsAdmin':
      '{n} tệp thuộc về một chương trình đã cài và cần quyền quản trị — chúng bị bỏ qua chứ không bị xoá.',
    'dialog.skipped.inUse': '{n} tệp đang được chương trình khác mở nên bị bỏ qua.',
    'dialog.purge.title': 'Xoá vĩnh viễn các mục trong Thùng rác',
    'dialog.purge.confirm': 'Xoá vĩnh viễn',
    'dialog.purge.message': 'Xoá vĩnh viễn {n} mục khỏi Thùng rác?',
    'dialog.purge.detail': 'Việc này giải phóng {size} và không thể hoàn tác.',
    'dialog.purge.scope':
      'Chỉ những mục do chính CleanDrive chuyển vào, từ hơn {days} ngày trước, mới bị ảnh hưởng. Những gì ' +
      'bạn tự xoá vẫn nằm nguyên trong Thùng rác.',

    /* ---- duplicates --------------------------------------------------- */
    'dupes.find': 'Tìm tệp trùng',
    'dupes.ready': 'Sẵn sàng tìm.',
    'dupes.failed': 'Tìm trùng lặp thất bại.',
    'dupes.ignoreUnder': 'Bỏ qua tệp nhỏ hơn',
    'dupes.groups': 'Nhóm trùng lặp',
    'dupes.reclaimable': 'Có thể thu hồi',
    'dupes.hashed': 'Tệp đã băm',
    'dupes.searchTime': 'Thời gian tìm',
    'dupes.selectExtra': 'Chọn tất cả trừ bản cũ nhất',
    'dupes.phase.indexing': 'Đang lập chỉ mục tệp',
    'dupes.phase.grouping': 'Đang nhóm theo kích thước',
    'dupes.phase.partial': 'Đang so phần đầu tệp',
    'dupes.phase.full': 'Đang đối chiếu toàn bộ nội dung',
    'dupes.detail.indexing': '{n} tệp',
    'dupes.detail.hashing': 'đã băm {done} trong {total} ứng viên',
    'dupes.checked': 'Đã kiểm tra {n} tệp.',
    // Chọn bản giữ lại theo loại ổ (F1).
    'dupes.keep': 'Đề xuất giữ',
    'dupes.keep.oldest': 'bản cũ nhất',
    'dupes.keep.internal': 'bản nằm trên máy này',
    'dupes.keep.backup': 'bản nằm trên ổ ngoài hoặc ổ mạng',
    'dupes.kept.internal': 'Bản nằm trên máy này là bản được đề xuất giữ lại.',
    'dupes.kept.backup': 'Bản nằm trên ổ ngoài hoặc ổ mạng là bản được đề xuất giữ lại.',
    'dupes.kept.locked': 'Chọn bản giữ lại theo loại ổ thuộc CleanDrive Pro, nên bản cũ nhất là bản được đề xuất.',
    'dupes.cacheHits': 'Dùng lại {n} giá trị băm từ bộ đệm.',
    'dupes.unreadable': 'Không đọc được {n} tệp.',
    'dupes.withheld':
      '{n} bản sao thuộc về chương trình đã cài hoặc thư mục phụ thuộc nên không được chọn tự động — ' +
      'chỉ {selectable} trong tổng số {total} là an toàn để xoá hàng loạt.',
    'dupes.empty': 'Không tìm thấy tệp trùng nào trong thư mục này.',
    'dupes.groupTitle': '{n} bản giống hệt nhau · mỗi bản {size}',
    'dupes.reclaimableAmount': 'thu hồi được {size}',
    'dupes.oldest': 'cũ nhất',

    // F2 — thư mục trùng toàn bộ và thư mục gần trùng.
    'dupes.folders.toggle': 'So cả thư mục',
    'dupes.folders.heading': 'Thư mục chứa cùng một thứ',
    'dupes.files.heading': 'Từng tệp một',
    'dupes.folders.groupTitle': '{n} thư mục giống hệt nhau · mỗi thư mục {size}',
    'dupes.folders.facts': '{size} · {n} tệp',
    'dupes.folders.keeping': 'đang giữ',
    'dupes.folders.copy': 'bản sao',
    'dupes.folders.selectCopy': 'Chọn mọi tệp trong bản sao này',
    'dupes.folders.tooMany':
      'Bản sao này chứa {n} tệp — quá nhiều để liệt kê ở đây. Hãy mở trong Explorer để xử lý.',
    'dupes.folders.locked':
      'So cả thư mục thuộc CleanDrive Pro, nên chỉ có từng tệp được đối chiếu.',
    'dupes.folders.checked':
      'Đã so {n} thư mục, đọc mọi thứ bên trong — kể cả tên ẩn, node_modules và .git.',
    'dupes.folders.nested':
      '{n} thư mục nằm bên trong một bản sao khác không được liệt kê riêng, nên không có gì bị tính hai lần.',
    'dupes.folders.unreadable':
      '{n} thư mục có tệp không đọc được, nên không được coi là bản sao.',
    'dupes.near.title': 'Giống nhau {pct}% · {n} tệp giống hệt',
    'dupes.near.shared': 'giữ hai lần {size}',
    'dupes.near.other': 'gần giống',
    'dupes.near.onlyIn': 'Chỉ có trong {name}',
    'dupes.near.changed': 'Cùng vị trí, khác nội dung',
    'dupes.near.nothingOnly': 'Không có gì ở đây mà bên kia không có.',
    'dupes.near.nothingChanged': 'Mọi tệp dùng chung đều giữ đúng cùng một nội dung.',
    'dupes.near.truncated': 'Chỉ liệt kê 200 khác biệt đầu tiên của mỗi loại.',
    'dupes.empty.filesOnly': 'Không có tệp trùng nào ngoài các thư mục ở trên.',

    // F3 — các bản nháp của cùng một tài liệu.
    'dupes.versions.toggle': 'Tìm cả các bản nháp của một tài liệu',
    'dupes.versions.locked':
      'Tìm các bản nháp của một tài liệu thuộc CleanDrive Pro, nên chỉ có các tệp giống hệt nhau được đối chiếu.',
    'dupes.versions.heading': 'Tài liệu trông như các bản nháp của nhau',
    'dupes.versions.note':
      'Nhóm theo phần giống nhau trong tên, và không đọc gì thêm. Đó là căn cứ yếu, nên ở đây không có gì được tích sẵn và cũng không có “chỉ giữ bản mới nhất”.',
    'dupes.versions.skippedDates':
      'Đã bỏ qua {n} {sets} chỉ khác nhau ở ngày tháng trong tên — ngày tháng thường cho biết đây là tài liệu nào, chứ không phải bản nháp nào.',
    'dupes.versions.skippedCommon':
      'Đã bỏ qua {n} {sets} chỉ trùng một cái tên phổ biến ở những thư mục chẳng liên quan gì đến nhau.',
    'dupes.versions.groupTitle': '{n} tệp đặt tên như cùng một tài liệu · tổng cộng {size}',
    'dupes.versions.by': 'khác nhau ở {markers}',
    'dupes.versions.byFormat': 'một cái tên, nhiều định dạng',
    'dupes.versions.compare': 'Mở hai bản mới nhất cạnh nhau',
    'dupes.versions.newest': 'mới nhất',
    // Tiếng Việt không đổi dạng số nhiều, nên cả hai giống nhau.
    'dupes.versions.setWord.one': 'nhóm',
    'dupes.versions.setWord.other': 'nhóm',
    'dupes.versions.older': 'cũ hơn',
    'dupes.versions.sameTime': 'cùng lúc',
    'dupes.empty.versionsOnly':
      'Không có tệp nào ở đây giống hệt từng byte với tệp khác — chỉ có các nhóm bản nháp ở trên.',
    'dupes.phase.shape': 'Đang so thư mục theo tên và kích thước',
    'dupes.phase.folders': 'Đang đối chiếu nội dung thư mục',
    'dupes.phase.near': 'Đang so các thư mục gần trùng',
    'dupes.skippedNote':
      '{n} {files} không được chọn — chúng thuộc về chương trình đã cài hoặc thư mục phụ thuộc. ' +
      'Nếu bạn chắc chắn thì hãy tự tích từng tệp.',

    /* ---- deleting ----------------------------------------------------- */
    'delete.title': 'Đang chuyển vào Thùng rác',
    'delete.checking': 'Đang kiểm tra thứ gì xoá được',
    'delete.checkedCount': 'đã kiểm tra {done} trong {total}',
    'delete.waiting': 'Đang chờ xác nhận',
    'delete.ready': '{n} {items} sẵn sàng · {size}',
    'delete.rate': '{n} tệp/giây',
    'delete.took': ' trong {n} giây',
    'delete.progress': '{done} / {total} · {moved} / {size}',
    'delete.movedToBin':
      'Đã chuyển {n} {items} ({size}) vào Thùng rác{took} — chưa giải phóng cho tới khi dọn Thùng rác',
    'delete.stoppedToBin':
      'Đã dừng. {n} {items} ({size}) đã ở trong Thùng rác · còn {left} chưa đụng tới.',
    'delete.cancelled': 'Đã huỷ xoá — không có gì bị gỡ đi.',
    'delete.needsAdmin': '{n} mục cần quyền quản trị',
    'delete.inUse': '{n} mục đang được chương trình khác sử dụng',
    'delete.otherSkipped': 'bỏ qua {n} mục',
    'delete.nothing': 'Không có gì bị xoá. {reason}',

    /* ---- shared components ------------------------------------------ */
    'frees.yes': 'Giải phóng dung lượng',
    'frees.bin': 'Chưa giải phóng cho tới khi dọn Thùng rác',
    'frees.yesHint': 'Dung lượng trở lại ổ này ngay khi việc này xong.',
    'frees.binHint': 'Thùng rác nằm trên cùng ổ đĩa, nên chuyển tệp vào đó không giải phóng gì cho tới khi dọn nó.',
    'frees.cloud': 'Giải phóng dung lượng, không xoá gì',
    'frees.cloudHint':
      'Ngay sau đó OneDrive gỡ nội dung khỏi ổ này và giữ nó trên đám mây; app báo con số đo được thật.',

    // OneDrive "free up space" (B3), on What to delete.
    'cloud.title': 'Có sẵn trên đám mây',
    'cloud.note':
      'OneDrive đã giữ các tệp này trên đám mây, và chúng cũng đang nằm trên ổ này. Chỉ giữ chúng trên đám mây sẽ ' +
      'giải phóng chỗ ở đây mà không xoá gì: chúng vẫn nằm trong thư mục cũ, và được tải về khi bạn mở.',
    'cloud.go': 'Chỉ giữ trên đám mây',
    'cloud.label': 'Giải phóng dung lượng',
    'cloud.selectAll': 'Chọn cả {n} tệp · {size} trên ổ này',
    'cloud.none': 'Trong thư mục này không có tệp OneDrive nào từ 1 MB trở lên vừa đồng bộ xong vừa còn nằm trên ổ.',
    'cloud.onDrive': 'trên ổ này',
    'cloud.unavailable':
      'Không hỏi được Windows xem tệp OneDrive nào đã đồng bộ ở máy này, nên không đề xuất tệp nào.',
    'cloud.notRunning':
      'OneDrive đang không chạy. Chính OneDrive mới giải phóng được dung lượng, nên hãy mở OneDrive trước khi dùng chức năng này.',
    'cloud.notSynced':
      'Chưa từng được tải lên nên không được đề xuất: {n} {files} ({size}) trong OneDrive không có bản nào trên đám mây. ' +
      'Chuyển chúng sang chỉ trên đám mây cũng không giải phóng được gì.',
    'cloud.pending': 'Đang chờ OneDrive tải lên vì đã thay đổi: {n} {files} ({size}).',
    'cloud.onlineOnly': 'Đã chỉ trên đám mây từ trước: {n} {files} ({size}).',
    'cloud.checking': 'Đang hỏi OneDrive về các tệp',
    'cloud.refused.off':
      'OneDrive đang không chạy nên lúc này không giải phóng được gì. Hãy mở OneDrive rồi thử lại — chưa có gì bị thay đổi.',
    'cloud.refused.check': 'Không hỏi được Windows về các tệp này, nên chưa có gì bị thay đổi.',
    'cloud.refused.notSynced': 'chưa có trên đám mây',
    'cloud.refused.pending': 'đang chờ đồng bộ',
    'cloud.refused.onlineOnly': 'đã chỉ trên đám mây',
    'cloud.refused.changed': 'đã thay đổi từ lúc quét',
    'cloud.cancelled': 'Đã huỷ — chưa có gì bị thay đổi.',
    'cloud.nothing': 'Không tệp nào được chuyển sang chỉ trên đám mây. {reason}',
    'cloud.done': 'Đã giao {n} {files} cho OneDrive. Dung lượng đã giải phóng trên ổ này, theo số đo: {freed}.',
    'cloud.stillPending':
      'Lúc app thôi theo dõi, OneDrive vẫn chưa giải phóng {n} tệp trong số đó; nó sẽ làm sau, theo nhịp của nó.',
    'cloud.skipped': '{n} tệp được để nguyên.',
    'cloud.progress.handing': 'Đang giao tệp cho OneDrive',
    'cloud.progress.waiting': 'Đang chờ OneDrive giải phóng dung lượng',
    'cloud.progress.handed': '{done} / {total}',
    'cloud.progress.freed': 'Đã giải phóng {done} / {total} · đo được {freed}',
    'evidence.cloud.inSync': 'Windows báo tệp đã đồng bộ với OneDrive, và nội dung của nó đang nằm trên ổ này',
    'evidence.cloud.alsoInCloud':
      'Tệp này cũng nằm trong OneDrive và đã đồng bộ: “Chỉ giữ trên đám mây”, ở card riêng trong màn Nên xoá gì, ' +
      'giải phóng cùng dung lượng mà không xoá nó trên mọi thiết bị',
    'evidence.cloud.pinned':
      'Đã có người chọn “Luôn giữ trên thiết bị này” cho tệp — chuyển sang chỉ trên đám mây sẽ bỏ lựa chọn đó',
    'evidence.cloud.notOpened': 'Không được mở trong {days} ngày',
    'evidence.cloud.notChanged': 'Không thay đổi trong {days} ngày (Windows không ghi lại lúc tệp được mở ở máy này)',
    'dialog.dehydrate.title': 'Giải phóng dung lượng với OneDrive',
    'dialog.dehydrate.message': 'Chỉ giữ {n} tệp trên đám mây?',
    'dialog.dehydrate.detail':
      'Không có gì bị xoá. Các tệp vẫn nằm nguyên chỗ, giữ tên và kích thước; OneDrive gỡ bản nội dung của chúng trên ổ ' +
      'này, tổng cộng {size}, và giữ trên đám mây.',
    'dialog.dehydrate.network':
      'Sau này mở một tệp trong số đó sẽ cần kết nối internet để OneDrive tải lại. Nếu OneDrive bị đăng xuất, các tệp ' +
      'sẽ không mở được cho tới khi đăng nhập lại.',
    'dialog.dehydrate.measured':
      'OneDrive tự giải phóng dung lượng ngay sau đó. App theo dõi và báo con số thật sự đo được.',
    'dialog.dehydrate.pinned': '{n} tệp trong số này đang đặt “Luôn giữ trên thiết bị này”; thao tác này bỏ lựa chọn đó.',
    'dialog.dehydrate.refused':
      '{n} tệp trong số đã chọn được để nguyên: chưa đồng bộ với OneDrive, hoặc đã chỉ trên đám mây.',
    'dialog.dehydrate.go': 'Chỉ giữ trên đám mây',
    'evidence.head': 'Vì sao — {confidence}',
    'evidence.open': 'Vì sao: {reasons}',
    'dupes.identical': 'giống hệt',

    /* ---- trends ------------------------------------------------------- */
    'trends.volume': 'Ổ đĩa',
    'trends.exportJson': 'Xuất JSON',
    'trends.exportCsv': 'Xuất CSV',
    'trends.exportLabel': 'Xuất dữ liệu',
    'trends.exported': 'Đã xuất {n} phép đo.',
    'trends.exportCancelled': 'Đã huỷ xuất dữ liệu.',
    'trends.inUse': 'Đang dùng',
    'trends.growth': 'Mức tăng',
    'trends.diskFull': 'Đầy đĩa',
    'trends.actuallyFreed': 'Thực sự giải phóng',
    'trends.chartTitle': 'Dung lượng đã dùng theo thời gian',
    'trends.perMonth': '{sign}{size}/tháng',
    'trends.measurement.one': 'phép đo',
    'trends.measurement.other': 'phép đo',
    'trends.scan.one': 'lần quét',
    'trends.scan.other': 'lần quét',
    'trends.in.days': 'sau {n} ngày nữa',
    'trends.in.weeks': 'sau {n} tuần nữa',
    'trends.in.months': 'sau {n} tháng nữa',
    'trends.in.years': 'sau {n} năm nữa',
    'trends.notYet': 'chưa đủ dữ liệu',
    'trends.notSoon': 'còn lâu',
    'trends.unknown': 'chưa rõ',
    'trends.noHistory': 'Chưa có dữ liệu lịch sử.',
    'trends.recorded': 'Đã ghi {n} phép đo.',
    'trends.freeOf': 'còn trống {free} trên tổng {total}',
    'trends.growthHint': 'Khớp từ {n} phép đo trải {days} ngày (r² {r2})',
    'trends.fullHint': 'Khoảng {date} nếu giữ nguyên tốc độ này (r² {r2})',
    'trends.freedHint':
      '{moved} đã được chuyển vào Thùng rác; trong đó {freed} đã bị xoá vĩnh viễn và thực sự trống ra.',
    'trends.axisCaveat':
      'Trục dọc được co giãn theo dữ liệu chứ không phải 0–100%, để thấy được cả thay đổi nhỏ.',
    'trends.chart.none':
      'Chưa có phép đo nào cho ổ đĩa này. Nút “Đo ngay” bên dưới sẽ đo lập tức, còn phép đo hằng ngày ' +
      'vẫn tiếp tục đo dù bạn có mở ứng dụng hay không.',
    'trends.chart.one': 'Mới có một phép đo. Cần thêm một phép đo nữa, vào ngày khác, mới thành một đường.',

    'trends.sourcesTitle': 'Các số đo này lấy từ đâu',
    'trends.sourcesNote':
      'Một xu hướng cần các phép đo theo lịch, chứ không phải lúc nào có người mở ứng dụng mới đo. ' +
      'Một tác vụ Windows hằng ngày sẽ đo chỗ trống ngay cả khi CleanDrive đã đóng — nó đọc ổ đĩa và ' +
      'ghi một dòng, không xoá gì cả.',
    'trends.daily': 'Đo dung lượng đĩa mỗi ngày một lần',
    'trends.measureNow': 'Đo ngay',
    'trends.measureLabel': 'Đo dung lượng đĩa',
    'trends.measuring': 'Đang đo…',
    'trends.saveMeasuring': 'Lưu cài đặt đo',
    'trends.unsaved': 'Cài đặt đo có thay đổi chưa lưu.',
    'trends.error.measure': 'Không đo được dung lượng đĩa',
    'trends.measured.new': 'Đã đo {n} ổ đĩa. Tổng cộng {total} phép đo.',
    'trends.measured.coalesced':
      'Đã đo, nhưng phép đo này thay thế một số đo chưa đầy nửa tiếng — chuỗi dữ liệu chỉ giữ một điểm ' +
      'mỗi nửa tiếng, nên bấm liên tục cũng không tạo ra được xu hướng.',
    'trends.sampler.daily': 'Tác vụ Windows hằng ngày',
    'trends.sampler.registered': 'đã đăng ký, chạy lúc {time}',
    'trends.sampler.notRegistered': 'đã bật nhưng chưa đăng ký — hãy lưu bên dưới',
    'trends.sampler.closedHint': 'Chạy cả khi CleanDrive đã đóng',
    'trends.sampler.next': 'Phép đo tự động kế tiếp',
    'trends.sampler.launch': 'Khi mở ứng dụng',
    'trends.sampler.launchHint': 'Mỗi lần mở đo một lần',
    'trends.sampler.always': 'luôn luôn',
    'trends.sampler.monitor': 'Khi đang theo dõi dung lượng',
    'trends.sampler.monitorOn': 'bật, nhiều nhất nửa tiếng một lần',
    'trends.sampler.monitorHint': 'Các số đọc mà bộ theo dõi vốn đã lấy nay được ghi lại thay vì bỏ đi',
    'trends.sampler.scan': 'Khi bạn chạy một lần quét',
    'trends.sampler.scanHint':
      'Một lần quét còn ghi lại kích thước thư mục, và đó là thứ danh sách thư mục bên dưới đem so sánh',
    'trends.sampler.lastMeasurement':
      'Phép đo gần nhất {when}. Hai phép đo là thành một đường; con số mức tăng cần bốn phép đo trải ' +
      'ít nhất một tuần.',
    'trends.sampler.noneYet': 'Chưa có phép đo nào.',
    'trends.saved.on': 'Đã lưu. Windows sẽ đo dung lượng đĩa mỗi ngày.',
    'trends.saved.off': 'Đã lưu. Phép đo hằng ngày đã tắt và tác vụ Windows của nó đã được gỡ.',
    'trends.saved.taskWrong': 'Đã lưu, nhưng tác vụ đo không đúng: {problems}',

    'trends.foldersTitle': 'Thư mục, theo tốc độ phình to',
    'trends.foldersNote':
      'Mỗi thư mục chỉ được so với các lần quét trước của chính nó. Quét hai lần thì có tốc độ; quét ' +
      'một lần thì nó nói thẳng là chưa đủ, chứ không đoán.',
    'trends.folders.none': 'Chưa quét thư mục nào.',
    'trends.reason.one': 'Mới có một lần đo — cần ít nhất hai lần mới có xu hướng.',
    'trends.reason.sameMoment': 'Mọi lần đo đều diễn ra cùng một thời điểm.',
    'trends.reason.tooLittle':
      'Lịch sử còn quá ít để đáng báo: {n} lần đo trong {days} ngày. Cần dữ liệu ít nhất một tuần.',
    'trends.reason.flat': 'Dung lượng dùng đang đi ngang hoặc giảm, nên không có gì để ngoại suy.',
    'trends.reason.erratic':
      'Dung lượng dùng dao động quá thất thường để ngoại suy (đường xu hướng chỉ giải thích được {pct}% mức biến thiên).',
    'trends.reason.full': 'Ổ đĩa đã báo không còn dung lượng trống.',
    'trends.reason.notSoon': 'Với tốc độ này, ổ đĩa không đầy trong vòng hai năm.',
    'trends.reason.scannedOnce': 'Mới quét một lần — hãy quét lại sau để thấy xu hướng.',
    'trends.reason.sameDay': 'Mọi lần quét thư mục này đều diễn ra trong cùng một ngày.',

    // What changed in a folder between two of its scans (Trends).
    'changes.title': 'Thay đổi trong một thư mục',
    'changes.note':
      'Hai lần quét của cùng một thư mục, đặt cạnh nhau. Mỗi lần quét giữ dung lượng của từng thư mục và mười ' +
      'tệp lớn nhất từ 10 MB trở lên của nó, nên phép so sánh chỉ thấy được tới đó.',
    'changes.folder': 'Thư mục',
    'changes.from': 'Từ',
    'changes.to': 'Đến',
    'changes.label': 'Thay đổi',
    'changes.stopped': 'dừng sớm',
    'changes.none':
      'Chưa quét thư mục nào. Hãy quét một thư mục ở tab Dung lượng đĩa, rồi quét lại sau, để thấy cái gì đã thay đổi trong đó.',
    'changes.onlyOne': 'Mới quét một lần — cần ít nhất hai lần quét cùng thư mục.',
    'changes.upgrade': 'So sánh hai lần quét của một thư mục là tính năng của CleanDrive Pro.',
    'changes.pickTwo': 'Hãy chọn hai lần quét khác nhau để so.',
    'changes.differentRoot': 'Đây là hai lần quét của hai thư mục khác nhau nên không so được.',
    'changes.differentRules': 'Hai lần quét dùng cách đo khác nhau nên không so được.',
    'changes.elsewhere': 'Chỗ khác trong {folder}',
    'changes.elsewhereHint': 'Tệp nằm ngay trong {path}, và các thư mục con quá nhỏ để liệt kê riêng',
    'changes.tag.new': 'mới',
    'changes.tag.newHint': 'Không chứa tệp nào ở lần quét trước',
    'changes.tag.empty': 'giờ trống',
    'changes.tag.emptyHint': 'Không chứa tệp nào ở lần quét sau — đã bị xoá, hoặc đã được dọn trống',
    'changes.morePlaces': 'và {n} chỗ khác, tổng cộng {size}',
    'changes.inFolder': 'trong {folder}',
    'changes.span': 'Từ {from} đến {to}, cách nhau {span}. Chỉ đo trong {folder}, không phải cả ổ {volume}.',
    'changes.incomplete':
      'Lần quét ngày {date} bị dừng sớm, so sánh sẽ sai lệch: kết quả dưới đây {guess}, và một phần trông như đã mất ' +
      'có thể chỉ là chưa được đọc.',
    'changes.grew': 'Tăng',
    'changes.shrank': 'Giảm',
    'changes.noGrowth': 'Không có gì tăng từ 1 MB trở lên.',
    'changes.noShrink': 'Không có gì giảm từ 1 MB trở lên.',
    'changes.filesRefused': 'Hai lần quét chọn tệp lớn theo quy tắc khác nhau, nên không so sánh tệp.',
    'changes.files.grew': 'Tệp lớn đã tăng',
    'changes.files.appeared': 'Tệp lớn mới',
    'changes.files.appearedNote':
      'Không nằm trong các tệp lớn của thư mục ở lần quét trước: là tệp mới, hoặc đã lớn quá 10 MB kể từ đó.',
    'changes.files.vanished': 'Tệp lớn không còn ở đó',
    'changes.files.vanishedNote':
      'Lần quét sau lẽ ra đã ghi tên các tệp này nếu chúng vẫn còn ở đó với kích thước này. Đã xoá, đã chuyển đi, ' +
      'hay đã nhỏ lại — hai lần quét không cho biết là trường hợp nào.',
    'changes.files.moved': 'Đã chuyển chỗ',
    'changes.files.movedNote': 'Mất khỏi một thư mục và xuất hiện ở thư mục khác với cùng tên, kích thước và ngày sửa.',
    'changes.files.shrank': 'Tệp lớn đã nhỏ lại',
    'changes.moreFiles': 'và {n} tệp khác',
    'changes.files.none': 'Hai lần quét không thấy tệp nào từ 10 MB trở lên thay đổi.',
    'changes.files.unknown':
      'Không rõ: {n} {files} lớn ({size}) đã vào hoặc ra khỏi nhóm mười tệp lớn nhất của một thư mục, nên hai lần ' +
      'quét này không cho biết chúng có thay đổi hay không.',
    'changes.day.one': 'ngày',
    'changes.day.other': 'ngày',
    'changes.hour.one': 'giờ',
    'changes.hour.other': 'giờ',
    'changes.minute.one': 'phút',
    'changes.minute.other': 'phút',
    'changes.underMinute': 'chưa tới một phút',
    'changes.link.row': 'Có gì thay đổi?',
    'changes.link.none':
      'Để biết cái gì đang tăng trên {volume}, hãy quét một thư mục của ổ này ngay bây giờ và quét lại sau.',
    'changes.link.lead': '{volume} đang tăng {rate}.',
    'changes.link.go': 'Xem cái gì đã tăng trong {folder}',
    'changes.link.scope': '— hai lần quét của thư mục đó, cách nhau {span}, không phải cả ổ {volume}.',
    'trends.folders.atLastScan': '{size} ở lần quét gần nhất',
    'trends.folders.rateHint': 'hiện {size}, qua {samples} lần quét trải {days} ngày',

    'trends.savingsTitle': 'Đã chuyển đi, và thực sự giải phóng',
    'trends.savingsNote':
      'Hai con số khác nhau. Tệp đã chuyển vào Thùng rác thì vẫn còn nằm trên đĩa; chỉ cột thứ hai mới ' +
      'là dung lượng bạn thật sự lấy lại được.',
    'trends.savings.month': 'Tháng',
    'trends.savings.toBin': 'Vào Thùng rác',
    'trends.savings.freed': 'Đã giải phóng',
    'trends.savings.total': 'Tổng cộng',
    'trends.savings.none': 'Chưa xoá gì qua CleanDrive.',


    /* ---- the HTML report (G2) ------------------------------------------ */
    'report.button': 'Lưu báo cáo…',
    'report.label': 'Báo cáo',
    'report.locked': 'Lưu báo cáo HTML thuộc CleanDrive Pro.',
    'report.nothingChosen': 'Hãy chọn ít nhất một mục.',
    'dialog.saveReport': 'Lưu báo cáo',
    'report.cancelled': 'Chưa lưu báo cáo.',
    'report.saved': 'Đã lưu báo cáo: {name} ({size}).',
    'report.savedPrivate': 'Tên đã được thay.',

    'report.dialog.title': 'Lưu báo cáo',
    'report.dialog.save': 'Lưu…',
    'report.dialog.what':
      'Một tệp HTML duy nhất, số liệu nhúng sẵn bên trong. Mở được bằng mọi trình duyệt, trên mọi máy, ' +
      'và khi mở không tải gì từ mạng.',
    'report.dialog.private': 'Thay tên thư mục và tên tệp bằng tên chung',
    'report.dialog.privateOn':
      'Thư mục thành “Thư mục 1”, tệp thành “Tệp 1.jpg”. Cùng một thư mục giữ nguyên một tên xuyên suốt, ' +
      'và dữ liệu nhúng trong tệp cũng được thay theo.',
    'report.dialog.privateOffWarn': 'Báo cáo sẽ chứa tên thật của các tệp trên máy này.',
    'report.dialog.privateOff': 'Báo cáo sẽ chứa tên thư mục thật, nhưng không có tên tệp.',

    'report.section.volumes': 'Các ổ đĩa',
    'report.section.volumes.what': 'Mỗi ổ lớn bao nhiêu và đầy bao nhiêu. Không có tên tệp hay tên thư mục.',
    'report.section.system': 'Ổ đĩa đi đâu mất',
    'report.section.system.what': 'Bảng bóc tách cả ổ của màn Hệ thống. Có tên thư mục, không có tên tệp.',
    'report.section.folders': 'Các thư mục đã quét',
    'report.section.folders.what': 'Từng thư mục đã quét kèm kích thước. Có tên thư mục, không có tên tệp.',
    'report.section.trends': 'Theo thời gian',
    'report.section.trends.what': 'Biểu đồ và mọi lần đo đằng sau nó. Không có tên tệp hay tên thư mục.',
    'report.section.diff': 'Những gì đã thay đổi',
    'report.section.diff.what':
      'Lần so sánh mới nhất của một thư mục với chính nó ở lần quét trước — gồm cả tệp nào mới xuất hiện và tệp nào biến mất.',
    'report.section.actions': 'CleanDrive đã làm gì',
    'report.section.actions.what': 'Mọi tệp ứng dụng này đã chuyển hoặc xoá, và chúng đi đâu.',

    'report.missing.system': 'Chưa đo lần nào — hãy mở màn Hệ thống và bấm đo.',
    'report.missing.folders': 'Chưa quét thư mục nào.',
    'report.missing.trends': 'Cần từ hai lần đo trở lên.',
    'report.missing.diff': 'Cần hai lần quét so sánh được của cùng một thư mục.',
    'report.missing.actions': 'CleanDrive chưa chuyển hay xoá gì cả.',

    'report.title': 'Báo cáo CleanDrive',
    'report.madeBy': 'Lập bởi',
    'report.footer':
      'Mọi con số ở đây đều do CleanDrive đo trên máy có tên ghi bên trên. Không có gì trong tệp này được gửi đi đâu, ' +
      'và khi mở nó cũng không tải gì — số liệu được nhúng ở cuối tệp dưới dạng JSON.',
    'report.privateOn':
      'Chế độ riêng tư: tên thư mục và tên tệp đã được thay bằng tên chung. Cùng một thư mục giữ nguyên một tên ' +
      'xuyên suốt nên báo cáo vẫn đọc được, và phần dữ liệu ở cuối tệp cũng được thay theo.',

    'report.volumes': 'Các ổ đĩa',
    'report.noVolumes': 'Không đo được ổ nào.',
    'report.system': 'Ổ đĩa đi đâu mất',
    'report.noSystem': 'Chưa đo trong phiên này. Hãy mở màn Hệ thống, bấm đo, rồi lưu lại báo cáo.',
    'report.folders': 'Các thư mục đã quét',
    'report.noFolders': 'Chưa quét thư mục nào. Hãy quét một thư mục ở màn Dung lượng đĩa.',
    'report.trends': 'Theo thời gian',
    'report.noTrends': 'Cần từ hai lần đo trở lên thì mới nói được gì về xu hướng.',
    'report.diff': 'Những gì đã thay đổi',
    'report.noDiff': 'Cần hai lần quét so sánh được của cùng một thư mục. Hãy quét lại thư mục đó sau vài ngày.',
    'report.actions': 'CleanDrive đã làm gì',
    'report.noActions': 'CleanDrive chưa chuyển hay xoá gì cả.',
    'report.actionsNote': 'Lấy từ nhật ký hành động, nơi ghi lại mọi tệp ứng dụng đã chuyển và chuyển đi đâu.',

    'report.col.drive': 'Ổ đĩa',
    'report.col.fileSystem': 'Định dạng',
    'report.col.total': 'Tổng',
    'report.col.free': 'Còn trống',
    'report.col.used': 'Đã dùng',
    'report.full': 'đã đầy',
    'report.of': 'trên',
    'report.col.row': 'Ở đâu',
    'report.col.size': 'Kích thước',
    'report.col.note': 'Ghi chú',
    'report.systemDrive': 'Ổ đĩa',
    'report.measured': 'đo lúc',
    'report.notElevated': 'đo không có quyền quản trị, nên một số dòng chưa đầy đủ',
    'report.col.folder': 'Thư mục',
    'report.col.files': 'Số tệp',
    'report.col.scanned': 'Quét lúc',
    'report.growth': 'Đang tăng',
    'report.perMonth': 'mỗi tháng',
    'report.noChart': 'Không vẽ được các lần đo bên dưới thành đường — không đủ lần đo nói rõ ổ đầy bao nhiêu.',
    'report.noGrowth': 'Chưa đủ số lần đo để nói là nó có đang tăng hay không.',
    'report.readings': 'lần đo',
    'report.col.at': 'Lúc',
    'report.col.from': 'Do ai đo',
    'report.whereChanged': 'Thay đổi ở đâu',
    'report.filesChanged': 'Những tệp đã thay đổi',
    'report.col.change': 'Thay đổi',
    'report.col.what': 'Là gì',
    'report.col.file': 'Tệp',
    'report.items': 'mục',
    'report.andMore': 'và {n} mục nữa',

    'report.kind.recycle': 'Đã chuyển vào Thùng rác',
    'report.kind.quarantine': 'Đã chuyển sang ổ khác',
    'report.kind.restore': 'Đã đưa về chỗ cũ',
    'report.kind.handoff': 'Đã giao cho công cụ của Windows',
    'report.kind.dehydrate': 'Đã chuyển thành chỉ-có-trên-mây',
    'report.kind.purge': 'Đã xoá khỏi Thùng rác',

    'report.pseudonym.folder': 'Thư mục',
    'report.pseudonym.file': 'Tệp',
    'report.pseudonym.drive': 'Ổ đĩa',


    /* ---- the weekly or monthly summary (G3) ---------------------------- */
    'recap.every': 'Báo cho tôi biết có gì thay đổi',
    'recap.off': 'không bao giờ',
    'recap.weekly': 'mỗi tuần một lần',
    'recap.monthly': 'mỗi tháng một lần',
    'recap.note.off':
      'Không hiện gì cả. CleanDrive không bao giờ gửi thông báo chỉ để đòi bạn chú ý.',
    'recap.note.needsDaily':
      'Mục này cần phép đo hằng ngày ở trên: không có nó thì chẳng có gì để tóm tắt, và sẽ không hiện gì.',
    'recap.note.on':
      'Một thông báo Windows nói ổ đĩa đã thay đổi thế nào và thư mục nào phình ra. Chỉ hiện khi đã đủ số lần ' +
      'đo để nói được điều gì đó đúng — ít nhất bốn lần trong một tuần — còn không thì thôi. Bấm vào nó sẽ mở ' +
      '“Thư mục đã thay đổi những gì”; nó không bao giờ bắt đầu dọn dẹp.',

    'recap.title': 'CleanDrive: {days} ngày qua trên {volume}',
    'recap.grew': '{volume} tăng thêm {size}. Hiện đã dùng {percent}%, còn trống {free}.',
    'recap.shrank': '{volume} giảm đi {size}. Hiện đã dùng {percent}%, còn trống {free}.',
    'recap.biggest.one': 'Nhiều nhất: {a} tăng {an}.',
    'recap.biggest.two': 'Nhiều nhất: {a} tăng {an}, rồi tới {b} tăng {bn}.',

    // Lý do không gửi — chỉ ra ở nhật ký, không hiện lên màn hình.
    'recap.no.off': 'Tóm tắt định kỳ đang tắt',
    'recap.no.tooSoon': 'Chưa đủ thời gian kể từ lần đo đầu tiên',
    'recap.no.notYet': 'Lần tóm tắt gần nhất chưa cách đây trọn một kỳ',
    'recap.no.noReadings': 'Chưa có gì đo đĩa này cả',
    'recap.no.thinWindow': 'Quá ít lần đo trong kỳ này để so sánh',

    /* ---- automatic cleanup -------------------------------------------- */
    // G4 — nhiều hồ sơ tự động.
    'auto.profile.heading': 'Hồ sơ',
    'auto.profile.groupLabel': 'Các hồ sơ dọn dẹp tự động',
    'auto.profile.name': 'Tên',
    'auto.profile.add': 'Thêm hồ sơ',
    'auto.profile.remove': 'Xoá hồ sơ này',
    'auto.profile.addLabel': 'Thêm hồ sơ',
    'auto.profile.removeLabel': 'Xoá hồ sơ',
    'auto.profile.first': 'Dọn dẹp tự động',
    'auto.profile.nth': 'Hồ sơ {n}',
    'auto.profile.locked': 'Nhiều hơn một hồ sơ thuộc CleanDrive Pro.',
    'auto.profile.full': 'Tối đa {n} hồ sơ.',
    'auto.profile.unsaved': 'Hãy lưu hoặc bỏ các thay đổi trên màn hình trước khi chuyển hồ sơ.',
    'auto.profile.added': 'Đã thêm một hồ sơ. Nó đang tắt và ở chế độ chỉ báo cáo cho tới khi bạn đổi ý.',
    'auto.profile.removed': 'Đã xoá “{name}”, và tác vụ Windows của nó cũng đã bị gỡ.',
    'auto.profile.confirmRemove':
      'Xoá “{name}”? Tác vụ Windows của nó sẽ bị gỡ theo, nên nó ngừng chạy. Những gì đã xoá không bị ảnh hưởng.',
    'auto.action': 'Nó làm gì',
    'auto.action.recycle': 'Chuyển vào Thùng rác',
    'auto.action.quarantine': 'Chuyển sang ổ khác',
    'auto.deleteOriginal': 'Xoá bản gốc sau khi chép — đây là cách duy nhất giải phóng được dung lượng',
    'auto.note.recycle':
      'Tệp đi vào Thùng rác, mà thùng rác nằm trên chính ổ đó — chưa có dung lượng nào quay lại cho tới khi dọn thùng rác.',
    'auto.note.noZone':
      'Chưa chọn thư mục nào để chứa tệp chuyển sang ổ khác, nên hồ sơ này sẽ bỏ qua mọi lượt chạy. ' +
      'Hãy chọn một thư mục ở mục “Chuyển sang ổ khác” trong màn Nên xoá gì.',
    'auto.note.quarantineFrees':
      'Mỗi tệp được chép sang {zone} rồi bản gốc bị xoá hẳn — không qua Thùng rác. ' +
      'Đây là lựa chọn duy nhất ở đây thật sự giải phóng dung lượng trên ổ vừa dọn.',
    'auto.note.quarantineKeeps':
      'Mỗi tệp được chép sang {zone} và bản gốc được giữ lại, nên việc này không giải phóng gì trên ổ vừa ' +
      'dọn — tính chung còn tốn thêm chỗ.',
    'auto.statState': 'Hồ sơ này',
    'auto.statNext': 'Lần chạy kế tiếp',
    'auto.statLast': 'Lần chạy gần nhất',
    'auto.statDisk': 'Đĩa đang dùng',
    'auto.state.reportOnly': 'Chỉ báo cáo',
    'auto.binNote':
      'Chuyển tệp vào Thùng rác không giải phóng được dung lượng nào — thùng rác nằm trên chính ổ đĩa đó. ' +
      'Không có gì thật sự được thu hồi cho tới khi thùng rác được dọn. Mục “Giải phóng dung lượng” bên ' +
      'dưới là cách ứng dụng này tự dọn phần của nó, và nó đang tắt cho tới khi bạn bật lên.',

    'auto.scheduleTitle': 'Lịch chạy',
    'auto.enabled': 'Tự động chạy dọn dẹp',
    'auto.dryRun': 'Chỉ báo cáo — liệt kê thứ sẽ bị xoá, không xoá gì',
    'auto.dryRunNote':
      'Lịch mới luôn bắt đầu ở chế độ chỉ báo cáo, và đó là cố ý. Hãy để một lần chạy cho bạn biết nó ' +
      'định lấy những gì, trước khi bạn cho phép nó lấy thật.',
    'auto.howOften': 'Bao lâu một lần',
    'auto.kind.minutes': 'Vài phút một lần (để thử)',
    'auto.kind.daily': 'Mỗi ngày',
    'auto.kind.weekly': 'Mỗi tuần',
    'auto.kind.monthly': 'Mỗi tháng',
    'auto.every': 'Mỗi',
    'auto.on': 'Vào',
    'auto.onDay': 'Vào ngày',
    'auto.catchUp': 'Chạy bù vài phút sau khi bạn đăng nhập',
    'auto.note.minutes':
      'Dùng để kiểm chứng rằng lịch này thật sự là một tác vụ Windows: nó vẫn chạy khi CleanDrive đã ' +
      'đóng và sau khi khởi động lại máy. Mỗi lần chạy là một lần dọn dẹp thật theo cài đặt của bạn, ' +
      'nên hãy để ở chế độ chỉ báo cáo trừ khi bạn thật sự muốn nó xoá.',
    'auto.note.monthly': 'Ngày chỉ tới 28, để lịch hằng tháng vẫn chạy vào tháng Hai.',
    'auto.note.missed': 'Lần chạy bị lỡ vì máy đang tắt sẽ chạy vào cơ hội gần nhất sau đó.',

    'auto.mayDeleteTitle': 'Nó được phép xoá gì',
    'auto.mayDeleteNote':
      'Chỉ những nhóm mà bản quét đánh giá là an toàn mới xuất hiện ở đây. Bất cứ thứ gì bị đánh dấu ' +
      '“nên xem lại” đều không bao giờ bị xoá khi không có người trông, dù danh sách này có ghi gì đi nữa.',
    'auto.age': 'Không đụng tới ít nhất',
    'auto.threshold': 'Chỉ khi đĩa đã dùng quá',
    'auto.thresholdUnit': '% (0 = luôn chạy)',
    'auto.max': 'Nhiều nhất',
    'auto.maxUnit': 'tệp mỗi lần chạy',

    'auto.rootsTitle': 'Thư mục nó được phép dọn',
    'auto.rootsNote': 'Không có gì chạy cho tới khi có ít nhất một thư mục trong danh sách.',
    'auto.roots.empty': 'Chưa có thư mục nào — dọn dẹp tự động sẽ không chạy.',
    'auto.whitelistTitle': 'Tuyệt đối không đụng vào',
    'auto.whitelistNote':
      'Được kiểm tra trước mỗi lần xoá, bên cạnh những vị trí hệ thống mà ứng dụng vốn đã từ chối.',
    'auto.whitelist.empty': 'Chưa loại trừ gì. Các vị trí hệ thống vẫn luôn được bảo vệ.',
    'auto.skipTitle': 'Bỏ qua khi các ứng dụng này đang mở',
    'auto.skipNote':
      'Tên tiến trình đúng như Task Manager hiển thị. Nếu ứng dụng không xác định được thứ gì đang chạy, ' +
      'cả lần chạy đó sẽ bị bỏ qua chứ không đoán bừa.',
    'auto.skip.empty': 'Chưa liệt kê gì — lần dọn sẽ chạy bất kể đang mở ứng dụng nào.',

    'auto.save': 'Lưu cài đặt',
    'auto.preview': 'Xem trước thứ sẽ bị xoá',
    'auto.runNow': 'Chạy dọn dẹp ngay…',
    'auto.lastResult': 'Kết quả gần nhất',
    'auto.recentRuns': 'Các lần chạy gần đây',
    'auto.unsaved': 'Có thay đổi chưa lưu.',
    'auto.label': 'Dọn dẹp',
    'auto.failed': 'Dọn dẹp thất bại.',
    'auto.needFolder': 'Hãy thêm ít nhất một thư mục trước.',
    'auto.savingSettings': 'Đang lưu cài đặt…',
    'auto.workingOut': 'Đang tính xem thứ gì sẽ bị lấy đi…',
    'auto.running': 'Đang dọn dẹp…',

    'auto.describe.reportOnly': 'Chỉ báo cáo, {when}. Sẽ không xoá gì cả.',
    'auto.describe.cleaning': 'Dọn dẹp {when}.',

    'auto.notice.windowsOnly': 'Lập lịch hiện chỉ làm cho Windows. Mọi thứ ở đây vẫn chạy tay được.',
    'auto.notice.orphaned':
      'Windows đang giữ một tác vụ CleanDrive nhưng ứng dụng lại không có cài đặt nào được lưu, nên khi ' +
      'chạy nó sẽ không thấy cấu hình gì. Hãy lưu cấu hình của bạn để sửa lại.',
    'auto.notice.noTask':
      'Dọn dẹp tự động đang bật nhưng chưa có tác vụ Windows nào được đăng ký — nó sẽ không chạy. ' +
      'Hãy bấm “Đăng ký lại”, hoặc lưu cài đặt một lần nữa, để tạo tác vụ đó.',
    'auto.notice.mismatch': 'Tác vụ Windows đã đăng ký không khớp với cài đặt này: {problems}',
    'auto.notice.adjusted': 'Cài đặt đã được điều chỉnh khi nạp: {warnings}',

    'auto.result.byHand': '{when} (chạy tay)',
    'auto.result.scanned': 'Số tệp đã quét',
    'auto.result.selected': 'Đã chọn',
    'auto.result.moved': 'Đã chuyển vào Thùng rác',
    'auto.result.purged': 'Đã xoá vĩnh viễn',
    'auto.result.diskChange': 'từ {before}% còn {after}%',
    'auto.result.tooRecent': '{n} mục quá mới',
    'auto.result.excluded': '{n} mục bị loại trừ',
    'auto.result.guarded': '{n} mục được bảo vệ',
    'auto.result.appOpen': '{n} mục được để lại vì ứng dụng của chúng đang mở',
    'auto.result.leftAlone': 'Đã bỏ qua',
    'auto.history.dryRun': 'chỉ báo cáo — {n} tệp sẽ bị lấy đi',
    'auto.history.real': 'đã chuyển {moved} · đã xoá vĩnh viễn {purged}',

    'auto.stage.checking': 'Đang kiểm tra dung lượng đĩa và ứng dụng đang chạy…',
    'auto.stage.scanning': 'Đang quét {root}…',
    'auto.stage.deleting': 'Đang chuyển {n} tệp vào Thùng rác…',
    'auto.stage.purging': 'Đang dọn các mục cũ trong Thùng rác…',

    'auto.saved.leftOff': 'Đã lưu, nhưng dọn dẹp tự động vẫn để tắt: {reason}',
    'auto.saved.notRunnable': 'cấu hình hiện tại chưa chạy được.',
    'auto.saved.taskWrong': 'Đã lưu, nhưng tác vụ Windows chưa đúng: {problems}',
    'auto.saved.registered': 'Đã lưu và đăng ký với Windows. Lần chạy kế tiếp {when}.',
    'auto.saved.off': 'Đã lưu. Dọn dẹp tự động đã tắt và tác vụ Windows của nó đã được gỡ.',

    'auto.toast.dryRun': '{n} tệp, {size} sẽ được chuyển đi.',
    'auto.toast.nothingDone': 'Không có gì được thực hiện.',
    'auto.toast.moved': 'Đã chuyển {n} tệp vào Thùng rác.',
    'auto.scheduled.report': 'Báo cáo theo lịch đã xong: {n} tệp sẽ được chuyển đi.',
    'auto.scheduled.skipped': 'Lần dọn theo lịch bị bỏ qua: {reason}',
    'auto.scheduled.moved': 'Lần dọn theo lịch đã chuyển {n} tệp vào Thùng rác.',

    /* ---- schedules, as prose ------------------------------------------ */
    'schedule.none': 'chưa có lịch',
    'schedule.everyMinute': 'mỗi phút',
    'schedule.everyMinutes': 'mỗi {n} phút',
    'schedule.everyDay': 'mỗi ngày lúc {time}',
    'schedule.everyWeek': '{day} hằng tuần lúc {time}',
    'schedule.everyMonth': 'ngày {day} mỗi tháng lúc {time}',
    'schedule.runEveryMinute': 'lịch chạy mỗi phút',
    'schedule.runEveryMinutes': 'lịch chạy mỗi {n} phút',
    'schedule.dailyRun': 'lịch chạy hằng ngày lúc {time}',
    'schedule.weeklyRun': 'lịch chạy hằng tuần vào {day} lúc {time}',
    'schedule.monthlyRun': 'lịch chạy hằng tháng vào ngày {day} lúc {time}',

    /* ---- the Windows task --------------------------------------------- */
    'task.title': 'Tác vụ Windows',
    'task.label': 'Tác vụ Windows',
    'task.note':
      'Lịch này là một mục trong Windows Task Scheduler, không phải bộ đếm giờ bên trong ứng dụng, nên nó ' +
      'chạy cả khi CleanDrive đã đóng và sau khi khởi động lại máy. Mọi thứ bên dưới đều được đọc ngược ' +
      'lại từ chính Windows.',
    'task.check': 'Hỏi Windows',
    'task.repair': 'Đăng ký lại',
    'task.runNow': 'Chạy tác vụ ngay',
    'task.runLabel': 'Chạy tác vụ',
    'task.notChecked': 'Chưa kiểm tra.',
    'task.registration': 'Đăng ký',
    'task.notCheckedYet': 'chưa kiểm tra',
    'task.windowsOnly': 'chỉ có trên Windows',
    'task.registeredTask': 'Tác vụ đã đăng ký',
    'task.none': 'không có',
    'task.nothing': 'không có gì',
    'task.visibleHint': 'Mở Task Scheduler sẽ thấy tác vụ dưới tên này',
    'task.matches': 'Có khớp cài đặt này không',
    'task.settingsAskFor': 'Cài đặt này yêu cầu',
    'task.windowsHolds': 'Windows đang giữ',
    'task.holdsNothing': 'không có gì — chưa đăng ký tác vụ nào',
    'task.holds.everyMinute': 'một lịch chạy mỗi phút',
    'task.holds.everyMinutes': 'một lịch chạy mỗi {n} phút',
    'task.holds.daily': 'một lịch chạy hằng ngày lúc {time}',
    'task.holds.weekly': 'một lịch chạy hằng tuần vào {day} lúc {time}',
    'task.holds.monthly': 'một lịch chạy hằng tháng vào ngày {day} lúc {time}',
    'task.holds.plusLogon': '{when}, cộng thêm một lần sau khi đăng nhập',
    'task.couldNotAsk': 'Không hỏi được Windows',
    'task.lastRun': 'Windows nói lần chạy gần nhất',
    'task.nextRun': 'Windows nói lần chạy kế tiếp',
    'task.noneScheduled': 'chưa có lịch nào',
    'task.pressCheck': 'hãy bấm “Hỏi Windows”',
    'task.result': 'Kết quả lần chạy đó',
    'task.resultCode': 'Mã Task Scheduler {code}',
    'task.missed': 'Số lần chạy bị lỡ',
    'task.state': 'Trạng thái tác vụ',
    'task.sampler': 'Phép đo đĩa hằng ngày',
    'task.samplerOk': 'đã đăng ký, {schedule}',
    'task.samplerMismatch': 'đã đăng ký nhưng không khớp',
    'task.samplerMissing': 'đang bật nhưng chưa đăng ký',
    'task.samplerHint': 'Được tab Xu hướng dùng; không xoá gì cả',
    'task.asking': 'Đang hỏi Windows…',
    'task.askFailed': 'Không hỏi được Windows.',
    'task.statusExact': 'Windows đang giữ đúng những gì cài đặt này mô tả.',
    'task.statusOther': 'Windows đang giữ một thứ khác với cài đặt này.',
    'task.statusNone': 'Windows chưa đăng ký tác vụ dọn dẹp nào của CleanDrive.',
    'task.statusUnsupported': 'Lập lịch chỉ có trên Windows.',
    'task.reRegistering': 'Đang đăng ký lại…',
    'task.nothingToChange': 'Không cần đổi gì — Windows vốn đã khớp với cài đặt này.',
    'task.starting': 'Đang nhờ Task Scheduler khởi động tác vụ…',
    'task.startFailed': 'Không khởi động được tác vụ.',
    'task.started':
      'Windows đã khởi động tác vụ. Kết quả sẽ hiện bên dưới khi lần chạy kết thúc, đúng như cách một ' +
      'lần chạy theo lịch vẫn làm.',
    'task.error.notRegistered': 'Chưa có tác vụ nào được đăng ký với Windows — hãy lưu cài đặt trước.',
    'task.error.refusedStart': 'Task Scheduler từ chối khởi động tác vụ',

    'task.label.cleanup': 'Dọn dẹp tự động',
    'task.label.sampler': 'Phép đo đĩa hằng ngày',
    'task.change.removed': '{label} đang tắt, nên tác vụ Windows của nó đã được gỡ.',
    // G4 — dọn tác vụ Windows còn sót của hồ sơ đã xoá.
    'task.change.orphanRemoved':
      'Một tác vụ Windows còn sót lại từ một hồ sơ không còn tồn tại ({task}); nó đã được gỡ.',
    'task.problem.orphanRemoveFailed':
      'Tác vụ Windows của một hồ sơ đã xoá ({task}) không gỡ được ({error}); nó sẽ vẫn tiếp tục chạy.',
    'task.problem.listFailed':
      'Không liệt kê được các tác vụ CleanDrive đã đăng ký ({error}), nên tác vụ do hồ sơ đã xoá để lại vẫn còn đó.',
    'task.problem.removeFailed': '{label}: không gỡ được tác vụ Windows ({error}).',
    'task.problem.refused': '{label}: Windows Task Scheduler từ chối tác vụ ({error}).',
    'task.problem.unrunnable':
      'Tác vụ chưa được đăng ký, vì Windows sẽ không chạy được nó: {problem}.',
    'action.refused.folder': 'Thao tác này không áp dụng cho thư mục',

    'map.menu.relocate': 'Chuyển sang ổ khác…',
    'map.menu.archive': 'Đóng gói lưu trữ…',
    'map.menu.compress': 'Nén bằng NTFS…',

    'compress.label': 'Nén NTFS',
    'compress.checking': 'Đang đo xem nén lại được bao nhiêu',
    'compress.checking.undo': 'Đang đọc thư mục',
    'compress.cancelled': 'Đã huỷ — không có gì thay đổi.',
    'compress.locked': 'Nén NTFS là tính năng của CleanDrive Pro.',
    'compress.done':
      '{name} giờ chiếm {after} thay vì {before} — lấy lại {freed}, ngay lập tức, không có gì nằm trong Thùng rác. {files} tệp, không đổi.',
    'compress.doneNothing':
      '{name} vẫn là {before} — NTFS không rút được gì từ {files} tệp này, chúng vốn đã nén sẵn bên trong. Không có gì thay đổi.',
    'compress.undone':
      '{name} không còn được nén — nó chiếm lại {size} trên đĩa. Không có gì bị xoá.',
    'compress.nothing': 'Không có gì thay đổi. {reason}',

    'compress.why.notThere': 'Thư mục đó không còn ở đó nữa',
    'compress.why.notAFolder': 'Cái này nén thư mục, mà đó không phải thư mục',
    'compress.why.root': 'Gốc ổ đĩa hay thư mục cá nhân không phải thứ để nén',
    'compress.why.system':
      'Đây là vị trí hệ thống của Windows — nén chính Windows là CompactOS, và Windows có thiết lập riêng cho việc đó',
    'compress.why.program': 'Chỗ này thuộc về một chương trình đã cài, nên để yên',
    'compress.why.network': 'Thư mục trên mạng thì để yên',
    'compress.why.empty': 'Thư mục đó không có gì để nén',
    'compress.why.unsupported': 'Ổ này không giữ được tệp nén — NTFS cần cluster từ 4 KB trở xuống',
    'compress.why.noRoom': 'Không có chỗ nào cạnh thư mục để thử nén',
    'compress.why.online':
      'Thư mục này có {n} tệp chỉ nằm trên OneDrive. Nén sẽ kéo tất cả chúng về máy — đúng phần dung lượng mà “Chỉ giữ trên đám mây” vừa giải phóng.',
    'compress.why.failed': 'Windows không nén được ({error})',

    'dialog.compress.title': 'Nén bằng NTFS',
    'dialog.compress.go': 'Nén thư mục',
    'dialog.compress.message': 'Cho Windows nén {n} thư mục?',
    'dialog.compress.messageOne': 'Cho Windows nén “{name}”?',
    'dialog.compress.saving':
      'Lấy lại khoảng {freed}, từ {before} còn chừng {after} — đo bằng cách đưa {n} tệp của chính thư mục này qua NTFS, không phải đoán.',
    'dialog.compress.noSaving':
      'Các tệp này vốn đã nén sẵn bên trong — ảnh, video và tương tự — nên NTFS gần như không rút được gì. Đo trên mẫu {n} tệp: lấy lại chừng {freed} trên {before}.',
    'dialog.compress.freesNow':
      'Đây là dung lượng về ngay — không có gì vào Thùng rác, và không phải dọn gì sau đó.',
    'dialog.compress.whatChanges':
      'Tệp giữ nguyên tên, nguyên nội dung và nguyên kích thước mà mọi chương trình nhìn thấy. Mở một tệp sẽ tốn thêm chút CPU thay vì tốn thêm chút đọc đĩa. Bạn có thể dừng nén thư mục bất cứ lúc nào từ chính menu này.',
    'dialog.compress.alreadyCompressed':
      '{n} trong {files} tệp là định dạng vốn đã nén và sẽ không nhỏ lại.',
    'dialog.compress.undoTitle': 'Dừng nén',
    'dialog.compress.undoGo': 'Dừng nén',
    'dialog.compress.undoMessage': 'Dừng nén {n} thư mục?',
    'dialog.compress.undoMessageOne': 'Dừng nén “{name}”?',
    'dialog.compress.undoDetail':
      'Tệp không đổi — chúng chỉ chiếm lại đủ {size} trên đĩa. Dù thế nào cũng không có gì bị xoá.',

    'archive.label': 'Đóng gói lưu trữ',
    'archive.checking': 'Đang đọc thư mục',
    'archive.cancelled': 'Đã huỷ — không có gì được đóng gói.',
    'archive.locked': 'Đóng gói cả thư mục là tính năng của CleanDrive Pro.',
    'archive.done':
      'Đã đóng gói {name} thành {archive} — {files} tệp, {from} còn {size}, và kiểm đủ từng tệp bên trong. {shrunk}Thư mục nằm trong Thùng rác, chưa giải phóng cho tới khi dọn Thùng rác.',
    'archive.noSmaller': 'Không nhỏ hơn được — các tệp này vốn đã nén sẵn.',
    'archive.nothing': 'Không có gì được đóng gói. {reason}',

    'archive.why.notThere': 'Thư mục đó không còn ở đó nữa',
    'archive.why.notAFolder': 'Cái này đóng gói thư mục, mà đó không phải thư mục',
    'archive.why.root': 'Gốc ổ đĩa hay thư mục cá nhân không phải thứ để đóng gói',
    'archive.why.system': 'Đây là vị trí hệ thống của Windows',
    'archive.why.network': 'Thư mục trên mạng thì để yên',
    'archive.why.empty': 'Thư mục đó không có gì để đóng gói',
    'archive.why.occupied': 'Đã có sẵn một tệp trùng tên ở nơi định đặt archive',
    'archive.why.inside': 'Archive sẽ nằm bên trong chính thư mục đang được đóng gói',
    'archive.why.full': 'Ổ {drive} không đủ chỗ',
    'archive.why.noDestination': 'Chưa chọn nơi để archive',
    'archive.why.destUnusable': 'Không ghi được vào nơi đó',
    'archive.why.writeFailed': 'Archive chưa hoàn tất, nên không có gì thay đổi ({error})',
    'archive.why.verifyFailed':
      'Archive đã ghi xong nhưng {n} tệp đọc lại không khớp, nên thư mục được để yên và archive đã bị xoá',
    'archive.why.binFailed':
      'Archive thì ổn, nhưng không chuyển được thư mục ({error}), nên không có gì thay đổi',

    'dialog.chooseArchive': 'Chọn nơi cất archive',
    'dialog.archive.title': 'Đóng gói lưu trữ',
    'dialog.archive.go': 'Đóng gói thư mục',
    'dialog.archive.message': 'Đóng gói {n} thư mục thành archive?',
    'dialog.archive.messageOne': 'Đóng gói “{name}” thành một tệp?',
    'dialog.archive.detail':
      '{files} tệp, {size}, sẽ được gói vào một tệp .zip và sau đó kiểm lại từng tệp bên trong.',
    'dialog.archive.saving':
      'Archive ước chừng {archive}, lấy mẫu từ các tệp — nhỏ hơn khoảng {percent}.',
    'dialog.archive.noSaving':
      'Thư mục này vốn đã gần nhỏ hết mức — archive ước chừng {archive}, nên đóng gói ở đây là để có một tệp thay vì {files} tệp, không phải để tiết kiệm dung lượng.',
    'dialog.archive.sameDrive':
      'Archive nằm cùng ổ, nên dọn Thùng rác sau đó sẽ lấy lại khoảng {freed}.',
    'dialog.archive.otherDrive':
      'Archive sang ổ {drive}, nên dọn Thùng rác sau đó sẽ lấy lại khoảng {freed} ở đây.',
    'dialog.archive.back':
      'Thư mục vào Thùng rác, và Khôi phục có thể giải nén archive về đúng chỗ cũ, giữ nguyên cả timestamp.',
    'dialog.archive.links': '{n} lối tắt bên trong được bước qua chứ không đi theo, và không được gói.',

    'restore.title.archive': 'Đã đóng gói {n} {items} vào archive',
    'restore.state.inArchive': 'trong archive',
    'restore.state.goneArchive': 'archive không còn',
    'restore.row.inArchive': 'Đã gói vào {path} {when}, và kiểm lại từng tệp bên trong',
    'restore.row.unavailableArchive': 'Ổ chứa archive không kết nối, nên không đọc được',
    'restore.row.goneArchive':
      'Archive không còn ở đó, hoặc không mở được nữa — không khôi phục được gì từ nó',
    'restore.why.goneArchive': 'Archive không còn ở đó, hoặc không mở được nữa',
    'restore.why.unavailableArchive': 'Ổ chứa archive không kết nối',
    'restore.why.extractFailed': 'Không giải nén được archive, nên không có gì được khôi phục',
    'restore.why.escape': 'Archive có tệp trỏ ra ngoài thư mục, nên không được giải nén',
    'relocate.label': 'Chuyển sang ổ khác',
    'relocate.checking': 'Đang đọc thư mục',
    'relocate.cancelled': 'Đã huỷ — không có gì được chuyển.',
    'relocate.locked': 'Chuyển cả thư mục sang ổ khác là tính năng của CleanDrive Pro.',
    'relocate.done': 'Đã chuyển {name} sang {drive}, đã kiểm đủ {files} tệp — {originals}',
    'relocate.freed': 'bản gốc đã xoá, giải phóng {size}',
    'relocate.inBin': 'bản gốc nằm trong Thùng rác, chưa giải phóng cho tới khi dọn Thùng rác',
    'relocate.nothing': 'Không có gì được chuyển. {reason}',

    'dialog.chooseRelocate': 'Chọn nơi chuyển thư mục này tới — trên một ổ khác',
    'dialog.relocate.title': 'Chuyển sang ổ khác',
    'dialog.relocate.go': 'Chuyển thư mục',
    'dialog.relocate.message': 'Chuyển {n} thư mục sang ổ khác?',
    'dialog.relocate.messageOne': 'Chuyển “{name}” sang ổ khác?',
    'dialog.relocate.detail':
      '{files} tệp, {size}, sẽ được chép sang {destination} và kiểm lại ở đó trước đã.',
    'dialog.relocate.binned':
      'Sau đó bản gốc vào Thùng rác — nên chưa giải phóng được gì trên ổ này cho tới khi dọn Thùng rác.',
    'dialog.relocate.deleting':
      'Sau đó bản gốc sẽ bị xoá vĩnh viễn. Đó là cách duy nhất việc này giải phóng dung lượng, và không hoàn tác được.',
    'dialog.relocate.links':
      '{n} lối tắt bên trong được bước qua chứ không đi theo, và không được chép.',
    'dialog.relocate.shortcut':
      'Một lối tắt được để lại ở chỗ cũ. Đó là shortcut, không phải junction, nên không thứ gì khác trên máy đi theo nó một cách vô tình.',

    'relocate.why.notThere': 'Thư mục đó không còn ở đó nữa',
    'relocate.why.notAFolder': 'Cái này chuyển thư mục, mà đó không phải thư mục',
    'relocate.why.root': 'Gốc ổ đĩa hay thư mục cá nhân không phải thứ để chuyển đi',
    'relocate.why.system': 'Đây là vị trí hệ thống của Windows',
    'relocate.why.network': 'Thư mục trên mạng thì để yên',
    'relocate.why.sameVolume': 'Vẫn là ổ đó, nên chẳng giải phóng được gì',
    'relocate.why.nested': 'Đích nằm bên trong chính thư mục đang chuyển',
    'relocate.why.destInSource': 'Thư mục đang chuyển nằm bên trong đích',
    'relocate.why.occupied': 'Ở đích đã có sẵn thứ trùng tên',
    'relocate.why.full': 'Ổ {drive} không đủ chỗ',
    'relocate.why.noDestination': 'Chưa chọn thư mục đích',
    'relocate.why.destUnusable': 'Không ghi được vào đích đó',
    'relocate.why.empty': 'Thư mục đó không có gì để chuyển',
    'relocate.why.app': '{app} có ghi nhớ chỗ này nằm ở đâu. Hãy chuyển từ trong {app}.',
    'relocate.why.steam': 'Steam có ghi nhớ game này nằm ở đâu — dùng “Move install folder” của chính Steam',
    'relocate.why.shell':
      'Windows có ghi nhớ {name} nằm ở đâu. Bấm chuột phải vào nó, rồi Properties → Location → Move.',
    'relocate.why.onedrive':
      'Thư mục này nằm trong OneDrive, nên tệp của nó còn ở các thiết bị khác. Chuyển ở đây sẽ xoá chúng ở đó.',
    'relocate.why.copyFailed': 'Bản sao chưa xong, nên không có gì được chuyển ({error})',
    'relocate.why.binFailed':
      'Bản sao thì ổn, nhưng không chuyển được bản gốc ({error}), nên không có gì thay đổi',
    'relocate.shortcut.note': 'CleanDrive đã chuyển sang {target}',

    'task.problem.noProgram': 'không có chương trình nào để tác vụ chạy',
    'task.problem.notAppDirectory': '{path} không phải thư mục khởi chạy được ứng dụng',
    'task.problem.windowsOnly': 'Hiện chỉ lập lịch được trên Windows',
    'task.problem.windowsOnlyLong': 'Lập lịch hiện chỉ làm cho Windows. Mọi thứ vẫn chạy tay được.',
    'task.problem.notRegistered':
      'Chưa có tác vụ nào được đăng ký trong Windows Task Scheduler, nên sẽ không có gì chạy cả.',
    'task.problem.wrongCommand': 'Tác vụ đã đăng ký khởi chạy {command}, không phải bản ứng dụng này.',
    'task.problem.wrongSchedule': 'Windows đang giữ {schedule}, không phải lịch đã lưu ở đây.',
    'task.problem.bounded': 'Chu kỳ lặp đã đăng ký có điểm kết thúc, nên nó sẽ dừng giữa chừng trong ngày.',
    'task.problem.disabled': 'Tác vụ đang bị tắt trong Task Scheduler.',
    'task.problem.orphaned':
      'Windows đang giữ một tác vụ CleanDrive nhưng ứng dụng lại không có cài đặt nào được lưu, nên khi ' +
      'chạy nó sẽ không thấy cấu hình gì và không làm gì cả. Hãy lưu cấu hình để sửa lại, hoặc tắt dọn ' +
      'dẹp tự động để gỡ tác vụ đó đi.',
    'task.repair.created': 'chưa có tác vụ Windows nào được đăng ký, nên một tác vụ vừa được tạo.',
    'task.repair.repointed': 'tác vụ đã đăng ký trỏ tới một bản ứng dụng khác; nay đã trỏ về đây.',
    'task.repair.rewritten': 'Windows đang giữ một lịch khác; lịch đó đã được ghi lại cho khớp cài đặt.',
    'task.repair.unusable': 'tác vụ đã đăng ký không dùng được như đang có nên đã được ghi lại.',

    'task.state.disabled': 'đang tắt',
    'task.state.queued': 'đang xếp hàng',
    'task.state.ready': 'sẵn sàng',
    'task.state.readyDisabled': 'sẵn sàng, nhưng đang bị tắt',
    'task.state.running': 'đang chạy',
    'task.state.unknown': 'Windows không rõ',

    'task.result.ok': 'lần chạy gần nhất đã hoàn tất thành công',
    'task.result.error': 'lần chạy gần nhất kết thúc với lỗi',
    'task.result.notStarted': 'tác vụ đã sẵn sàng và chưa khởi chạy lần nào',
    'task.result.running': 'tác vụ đang chạy',
    'task.result.disabled': 'tác vụ đang bị tắt',
    'task.result.never': 'tác vụ chưa từng chạy',
    'task.result.noFuture': 'không còn lần chạy nào được lên lịch',
    'task.result.stopped': 'lần chạy gần nhất đã bị dừng',
    'task.result.badWorkingDir': 'thư mục làm việc không hợp lệ',
    'task.result.missingProgram': 'không tìm thấy chương trình nó khởi chạy — ứng dụng đã bị chuyển đi',
    'task.result.missingPath': 'không tìm thấy đường dẫn nó khởi chạy — ứng dụng đã bị chuyển đi',
    'task.result.alreadyRunning': 'đã có một bản đang chạy, nên lần chạy này bị bỏ qua',
    'task.result.code': 'lần chạy gần nhất báo mã 0x{code}',

    /* ---- freeing the space -------------------------------------------- */
    'purge.title': 'Giải phóng dung lượng',
    'purge.label': 'Thùng rác',
    'purge.enabled': 'Xoá vĩnh viễn các mục do CleanDrive chuyển vào Thùng rác sau một thời gian chờ',
    'purge.grace': 'Thời gian chờ',
    'purge.note':
      'Đây là thứ duy nhất trong ứng dụng không thể hoàn tác. Nó đối chiếu từng mục với chính sổ ghi của ' +
      'Thùng rác về nơi mục đó đến từ đâu và vào lúc nào, nên những tệp do bạn tự xoá không bao giờ bị ' +
      'tính vào — kể cả một tệp nằm đúng đường dẫn đó.',
    'purge.now': 'Dọn ngay…',
    'purge.nothingRecorded': 'Chưa ghi nhận mục nào.',
    'purge.noneOldEnough': 'Đang theo dõi {n} mục, chưa mục nào quá {days} ngày.',
    'purge.ready': '{n} mục · {size} sẵn sàng giải phóng',
    'purge.switchOnHint': ' — bật ở trên để việc này chạy theo lịch',
    'purge.nothingDeleted': 'Không có gì bị xoá vĩnh viễn.',
    'purge.deleted': 'Đã xoá vĩnh viễn {n} mục, giải phóng {size}.',

    /* ---- disk alerts --------------------------------------------------- */
    'monitor.title': 'Cảnh báo trước khi đĩa đầy',
    'monitor.label': 'Theo dõi dung lượng đĩa',
    'monitor.enabled': 'Theo dõi dung lượng đĩa và cảnh báo tôi',
    'monitor.cost':
      'Đây là cài đặt duy nhất khiến CleanDrive tiếp tục chạy sau khi bạn đóng cửa sổ — không còn cách ' +
      'nào khác để nhận ra đĩa đang đầy dần. Tắt nó đi thì tiến trình kết thúc như trước.',
    'monitor.closeToTray': 'Đóng cửa sổ thì thu vào khay hệ thống thay vì thoát hẳn',
    'monitor.warnAt': 'Cảnh báo khi đạt',
    'monitor.criticalAt': 'Nguy cấp khi đạt',
    'monitor.checkEvery': 'Kiểm tra mỗi',
    'monitor.snoozeFor': 'Tạm ngưng trong',
    'monitor.volumesTitle': 'Ổ đĩa đang theo dõi',
    'monitor.volumesNote': 'Chọn thư mục bất kỳ; ổ đĩa chứa nó là thứ sẽ được theo dõi.',
    'monitor.volumes.empty': 'Chưa liệt kê ổ nào — mặc định theo dõi ổ chứa thư mục người dùng.',
    'monitor.notRunning': 'Không chạy.',
    'monitor.notRunningNote': 'Không chạy. CleanDrive không để lại gì trong bộ nhớ.',
    'monitor.snooze': 'Tạm ngưng',
    'monitor.resume': 'Bật lại cảnh báo',
    'monitor.noReadings': 'chưa có số đọc',
    'monitor.unreadable': 'Không đọc được ổ đĩa nào.',
    'monitor.volumeLine': '{root} {percent}% (còn trống {free})',
    'monitor.snoozedUntil': 'cảnh báo tạm ngưng tới {when}',
    'monitor.level.ok': 'ổn',
    'monitor.level.warn': 'sắp hết',
    'monitor.level.critical': 'gần đầy',

    /* ---- settings ------------------------------------------------------ */
    'settings.auto': 'Tự động',
    'settings.language.title': 'Ngôn ngữ',
    'settings.language.note':
      'Áp dụng ngay lập tức, cho cửa sổ này và cho cả thông báo lẫn hộp xác nhận mà ứng dụng hiện ra bên ' +
      'ngoài nó. “Tự động” theo ngôn ngữ hiển thị mà Windows đang đặt — đây không phải cùng một cài đặt ' +
      'với định dạng ngày tháng và số.',
    'settings.language.failed': 'Không lưu được cài đặt ngôn ngữ.',
    'settings.critters.title': 'Bạn đồng hành lúc quét',
    'settings.critters.note':
      'Quét một thư mục lớn là một quãng chờ không có gì để nhìn. Vài con vật sẽ đi dạo trên ' +
      'thanh tiến trình trong lúc đó, ngồi nghỉ, và thỉnh thoảng đuổi nhau. Chúng được vẽ bằng ' +
      'mã nguồn, chạy trên trình dựng hình, và không đụng gì tới việc quét.',
    'settings.critters.label': 'Ai đi trên thanh',
    'settings.critters.cat': 'Mèo',
    'settings.critters.dog': 'Chó',
    'settings.critters.bird': 'Chim',
    'settings.critters.mouse': 'Chuột',
    'settings.critters.mixed': 'Mỗi thứ một ít',
    'settings.critters.off': 'Không ai cả — chỉ thanh tiến trình',

    'settings.snapshots.title': 'Lịch sử quét',
    'settings.snapshots.note':
      'Sau mỗi lần quét, ứng dụng giữ lại một bản phác thảo đã nén của thư mục — mỗi thư mục con lớn bao nhiêu, ' +
      'và những tệp lớn nhất trong đó — để sau này so sánh hai lần quét với nhau. Bản này có tên tệp nên không ' +
      'bao giờ rời khỏi máy tính này. Giữ những bản mới nhất, cộng thêm mỗi tháng một bản.',
    'settings.snapshots.recent': 'Số lần quét mới nhất được giữ, cho mỗi thư mục',
    'settings.snapshots.monthly': 'Cộng thêm mỗi tháng một bản, trong ngần này tháng',
    'settings.snapshots.detail':
      'Tối đa {n} bản cho mỗi thư mục. Bản cũ hơn bị xoá sau lần quét kế tiếp của thư mục đó.',
    'settings.appearance.title': 'Giao diện',
    'settings.appearance.note':
      '“Tự động” theo hệ thống, nên máy nào chuyển sang tối lúc hoàng hôn thì cửa sổ này chuyển theo. ' +
      'Cụm nút y hệt cũng nằm trên thanh trên cùng.',
    'settings.version.title': 'Phiên bản và cập nhật',
    'settings.version.installed': 'Phiên bản đang cài',
    'settings.version.lastChecked': 'Kiểm tra lần cuối',
    'settings.version.signed': 'Chữ ký số',
    'settings.version.signedYes': 'đã ký',
    'settings.version.signedNo': 'chưa ký',
    'settings.version.signedHint':
      'Không có chữ ký thì thứ duy nhất bảo vệ một bản cập nhật là kết nối HTTPS tới máy chủ phát hành.',

    /* ---- updates ------------------------------------------------------- */
    'update.label': 'Cập nhật',
    'update.enabled': 'Kiểm tra phiên bản mới',
    'update.note':
      'Đây là thứ duy nhất trong ứng dụng có kết nối internet. Nó tải về một tệp từ trang phát hành và ' +
      'không gửi đi gì cả — không định danh, không dữ liệu sử dụng. Tắt nó đi thì ứng dụng không thực ' +
      'hiện bất kỳ yêu cầu mạng nào.',
    'update.download': 'Tải về',
    'update.install': 'Khởi động lại và cài',
    'update.notNow': 'Để sau',
    'update.installVersion': 'Cài {version} và khởi động lại',
    'update.badge.idle': 'Đã mới nhất',
    'update.badge.available': 'Có bản mới',
    'update.badge.downloading': 'Đang tải…',
    'update.badge.ready': 'Sẵn sàng cài',
    'update.badge.error': 'Kiểm tra thất bại',
    'update.badge.unsupported': 'Không áp dụng',
    'update.detail.unsupported':
      'Đang chạy từ mã nguồn, hoặc từ một bản dựng không cấu hình nguồn phát hành — không có gì để đối ' +
      'chiếu. Các bản đã cài đặt thì có kiểm tra trang phát hành.',
    'update.detail.off': 'Đang tắt. Ứng dụng không thực hiện yêu cầu mạng nào.',
    'update.detail.checking': 'Đang hỏi trang phát hành xem có phiên bản mới hơn không.',
    'update.detail.available':
      'Đã thấy phiên bản {version}. Đang tải về — bạn sẽ được hỏi trước khi có bất cứ thứ gì được cài.',
    'update.detail.downloading':
      'Đang tải phiên bản {version} — {percent}%. Không có gì được cài cho tới khi bạn đồng ý.',
    'update.detail.ready':
      'Phiên bản {version} đã tải xong và sẵn sàng. Cài mất vài giây và ứng dụng tự mở lại.',
    'update.detail.unsigned':
      'Bản dựng này chưa ký số, nên thứ duy nhất kiểm chứng tệp tải về là việc nó đến từ máy chủ phát ' +
      'hành qua HTTPS.',
    'update.detail.error': 'Không kiểm tra được: {error}',
    'update.detail.idle': 'Phiên bản {version}.',
    'update.detail.idleChecked': 'Phiên bản {version}. Kiểm tra lần cuối {when}.',
    'update.dialog.title': 'Bản cập nhật đã sẵn sàng',
    'update.dialog.message': 'CleanDrive {version} đã sẵn sàng để cài.',
    'update.dialog.detail':
      'Bạn đang dùng {current}. Bản cập nhật đã tải xong — cài mất vài giây và ứng dụng tự mở lại.',
    'update.dialog.elevation': 'Windows sẽ hỏi quyền, vì CleanDrive được cài cho mọi người dùng.',
    'update.dialog.notNowNote': 'Chọn “Để sau” thì nó sẽ được cài vào lần kế tiếp bạn thoát CleanDrive.',
    'update.pill.downloadingVersion': 'Đang tải {version}…',
    'update.pill.percent': 'Đang tải {percent}%',
    'update.pill.install': 'Cài {version}',
    'update.pill.fetchingHint': 'Đang tải bản cập nhật; bạn sẽ được hỏi trước khi nó được cài',
    'update.pill.installHint': 'Cài bản cập nhật rồi khởi động lại — mất vài giây',
    'update.toast.on': 'Đã bật kiểm tra cập nhật.',
    'update.toast.off': 'Đã tắt kiểm tra cập nhật. Ứng dụng không thực hiện yêu cầu mạng nào.',
    'update.toast.latest': 'Bạn đang dùng phiên bản mới nhất ({version}).',
    'update.toast.noFeed': 'Bản dựng này không có nguồn phát hành để kiểm tra.',
    'update.toast.deferred': 'Bản cập nhật sẽ được cài vào lần khởi động lại kế tiếp.',
    'update.toast.justUpdated': 'CleanDrive đã cập nhật lên {version}, từ {previous}.',

    /* ---- native dialogs ------------------------------------------------ */
    'dialog.chooseFolder': 'Chọn thư mục để phân tích',
    'dialog.exportHistory': 'Xuất lịch sử dung lượng',
    'dialog.moveToBin': 'Chuyển vào Thùng rác',
    'dialog.confirmAuto.title': 'Xác nhận dọn dẹp tự động',
    'dialog.confirmAuto.message': 'Chuyển {n} tệp vào Thùng rác?',
    'dialog.confirmAuto.detail':
      'Đây là các tệp thuộc những nhóm đang bật, không bị đụng tới ít nhất {days} ngày. Tổng cộng {size}.',
    'dialog.forExample': 'Ví dụ:',

    /* ---- notifications ------------------------------------------------- */
    'notify.runFailed.title': 'CleanDrive: lần chạy theo lịch đã thất bại',
    'notify.runFailed.body': '{reason} Hãy mở CleanDrive để xem nhật ký chạy.',
    'notify.dryRun.title': 'CleanDrive: chỉ báo cáo',
    'notify.dryRun.body':
      '{n} tệp, {size} sẽ được chuyển vào Thùng rác. Không có gì bị xoá — dọn dẹp tự động vẫn đang ở chế ' +
      'độ chỉ báo cáo.',
    'notify.nothing.title': 'CleanDrive: không có gì để dọn',
    'notify.nothing.body': 'Không có tệp nào khớp với quy tắc dọn dẹp.',
    'notify.done.title': 'CleanDrive: đã dọn xong',
    'notify.done.moved': 'Đã chuyển {n} tệp ({size}) vào Thùng rác.',
    'notify.done.freed': 'Đã xoá vĩnh viễn {size} các mục cũ hơn, nên chỗ đó giờ đã trống thật.',
    'notify.done.notFreed': 'Vẫn chưa có dung lượng nào được giải phóng — Thùng rác nằm trên cùng ổ đĩa.',
    // G4 — hồ sơ chuyển tệp sang ổ khác.
    'notify.quarantined.moved': 'Đã chép {n} tệp ({size}) sang ổ khác.',
    'notify.quarantined.freed': 'Bản gốc đã bị xoá, nên ổ vừa dọn có thêm {size} trống.',
    'notify.quarantined.kept': 'Bản gốc được giữ lại, nên ổ vừa dọn không có thêm chỗ trống nào.',
    'notify.disk.lowTitle': 'CleanDrive: sắp hết dung lượng đĩa',
    'notify.disk.criticalTitle': 'CleanDrive: đĩa gần đầy',
    'notify.disk.body': '{root} đã dùng {percent}% — còn {free} trên tổng {total}.',
    'notify.disk.criticalNote': 'Windows có thể bắt đầu trục trặc khi còn dưới khoảng một gigabyte.',
    'notify.updated.title': 'CleanDrive đã cập nhật',
    'notify.updated.body': 'Hiện dùng phiên bản {current}, lên từ {previous}.',

    /* ---- the scheduled run --------------------------------------------- */
    'run.noSettings': 'Không tìm thấy tệp cài đặt nào, nên không có cấu hình gì để thực hiện.',
    'run.expectedAt': 'Đáng lẽ nằm ở {path}',

    /* ---- the tray ------------------------------------------------------ */
    'tray.tooltip.unknown': 'CleanDrive — không rõ dung lượng đĩa',
    'tray.tooltip.usage': 'đã dùng {percent}% · còn trống {free} trên tổng {total}',
    'tray.volumeUsage': 'đã dùng {percent}% · còn trống {free}',
    'tray.unreadable': 'không đọc được',
    'tray.snoozed': 'Cảnh báo đang tạm ngưng',
    'tray.noVolumes': 'Chưa theo dõi ổ đĩa nào',
    'tray.open': 'Mở CleanDrive',
    'tray.snoozeFor': 'Tạm ngưng cảnh báo trong {n} phút',
    'tray.quit': 'Thoát',

    /* ---- photos and video: where the scan looks --------------------------- */
    'media.root.pictures': 'Thư mục Hình ảnh của bạn',
    'media.root.videos': 'Thư mục Video của bạn',
    'media.root.cameraRoll': 'Nơi Windows để ảnh nhập từ máy ảnh hoặc điện thoại',
    'media.root.screenshots': 'Nơi phím chụp màn hình của Windows lưu ảnh',
    'media.root.savedPictures': 'Ảnh được lưu lại từ các ứng dụng',
    'media.root.captures': 'Nơi Game Bar của Windows quay lại màn hình chơi game',
    'media.root.crossDevice': 'Ảnh mà Liên kết điện thoại chép sang từ điện thoại',
    'media.root.zalo': 'Tệp nhận được trong Zalo',
    'media.root.telegram': 'Ảnh và video Telegram Desktop lưu tạm',
    'media.root.zaloChats': 'Ảnh và video trong các cuộc trò chuyện Zalo',
    'media.root.whatsapp': 'Ảnh và video nhận được trong WhatsApp',
    'media.root.viber': 'Tệp nhận được trong Viber',
    'media.root.downloads':
      'Nơi các tệp tải về được lưu — thường là nguồn ảnh không phải của bạn nhiều nhất',

    /* ---- photos and video: folders the scan refuses ----------------------- */
    'media.skip.noise': 'Chứa dữ liệu của phần mềm, không phải ảnh chụp',
    'media.skip.program': 'Thuộc về một ứng dụng đã cài',
    'media.skip.assetDump':
      '{n} ảnh ở đây và gần như tất cả đều rất nhỏ — đây là hình hoạ của một phần mềm, không phải album ảnh',

    /* ---- photos and video: why a file was filed where it was --------------
     *
     * These are the sentences under a verdict, and they are written to be read
     * as a list of facts rather than as a conclusion — the Vietnamese keeps the
     * same grammar so several of them stacked still read as one argument.
     */
    'media.why.camera': 'Tệp tự khai là do {camera} chụp',
    'media.why.takenAt': 'và mang sẵn ngày chụp của chính nó',
    'media.why.lens': 'và có ghi ống kính đã dùng',
    'media.why.alsoEdited': 'và về sau được {software} lưu lại',
    'media.why.recorderSoftware': 'Do {software} tạo ra, đây là phần mềm quay màn hình',
    'media.why.editorSoftware': 'Được {software} lưu lại',
    'media.why.folder': 'Nằm trong thư mục tên “{folder}”',
    'media.why.appFolder': 'là nơi {app} để những gì nhận được',
    'media.why.downloadedFrom': 'Windows ghi lại rằng tệp này được tải về từ {host}',
    'media.why.messagingHost': 'tức là {app}',
    'media.why.noExif': 'và hoàn toàn không có thông tin máy ảnh nào',
    'media.why.cameraNameNoExif':
      'nhưng thông tin máy ảnh đã bị gỡ sạch — đúng như khi một tấm ảnh được gửi qua ứng dụng nhắn tin',
    'media.why.windowTitle': 'Có ghi tên cửa sổ, “{title}” — máy ảnh thì không có cửa sổ',
    'media.why.cloudOnly': 'Không có gì trong tệp cho biết nó từ đâu ra; nó đến qua {service}',
    'media.why.nothing': 'Không có gì trong tệp lẫn trong tên tệp cho biết nó từ đâu ra',
    'media.why.messagingName': 'Tên tệp theo đúng mẫu của {app}, dạng {what}',
    'media.why.screenshotName': 'Tên tệp bắt đầu bằng “{what}”, đúng cách các công cụ chụp màn hình đặt tên',
    'media.why.cameraName': 'Tên tệp theo quy ước máy ảnh dạng {what}',
    'media.why.exactScreen': 'và đúng bằng {w}×{h}, tức là kích thước màn hình này',
    'media.why.exactScreenLead': 'Đúng bằng {w}×{h}, tức là kích thước màn hình này',
    'media.why.windowWidth':
      'và rộng đúng bằng màn hình này ({w}px) nhưng thấp hơn, đúng hình dạng của một cửa sổ được chụp lại',
    'media.why.windowWidthLead':
      'Rộng đúng bằng màn hình này ({w}px) nhưng thấp hơn, đúng hình dạng của một cửa sổ được chụp lại',

    /* ---- photos and video: what a file actually is ------------------------ */
    'media.trait.mislabelled': 'Mang đuôi .{ext} nhưng nội dung thật là {actual}',
    'media.trait.tiny': 'Chỉ {kb} KB — cỡ một biểu tượng hay một emoji, không phải ảnh chụp',
    'media.trait.big': 'Thuộc nhóm tệp nặng nhất ở đây',
    'media.trait.thumbnail': '{w}×{h} — quá nhỏ để từng là ảnh chụp của ai',
    'media.trait.highres': '{mp} megapixel — độ phân giải đầy đủ của máy ảnh',
    'media.trait.lowres': 'Chỉ {w}×{h} — nhỏ hơn cả màn hình điện thoại',
    'media.trait.wide': 'Tỉ lệ {aspect}:1, rộng hơn là cao — ảnh toàn cảnh, hoặc một dải cắt ra từ màn hình',
    'media.trait.tall':
      'Tỉ lệ {aspect}:1, cao hơn là rộng — thường là ảnh chụp màn hình cuộn dài của một trang hay một cuộc trò chuyện',
    'media.trait.rotated': 'Được lưu nằm ngang kèm thẻ đánh dấu chiều đúng của ảnh',
    'media.trait.cloud': 'Đang đồng bộ với {service} — xoá ở đây là xoá trên mọi thiết bị',
    'media.trait.onlineOnly':
      'Chỉ lưu trên mạng — nội dung không nằm trên đĩa này, nên xoá đi cũng không giải phóng được gì ở đây',
    'media.trait.located': 'Có ghi lại nơi chụp',
    'media.trait.broken.empty': 'Không có byte nào — tệp vẫn còn đó nhưng bên trong rỗng',
    'media.trait.broken.unrecognised':
      'Mang đuôi .{ext} nhưng nội dung không khớp định dạng ảnh hay video nào — thường là một lần tải về hỏng',
    'media.trait.broken.dehydrated': 'Chỉ lưu trên mạng, nên nội dung chưa được đọc',
    'media.trait.broken.busy': 'Một chương trình khác đang mở tệp này',
    'media.trait.broken.unreadable': 'Không đọc được',
    'media.trait.screenSized': 'Đúng {w}×{h}, bằng kích thước màn hình này',
    'media.trait.recompressed.app':
      'Bị thu về {edge}px và gỡ sạch thông tin máy ảnh — đúng dạng {app} trả lại cho một tấm ảnh nó chuyển tiếp, ở mức {bpp} byte mỗi điểm ảnh',
    'media.trait.recompressed.generic':
      'Bị thu về đúng {edge}px và không còn thông tin máy ảnh, ở mức {bpp} byte mỗi điểm ảnh — một tấm ảnh đã đi qua đâu đó',
    'media.trait.hardCompressed':
      '{bpp} byte mỗi điểm ảnh — nén tay tới mức nhìn ra được. Ảnh có nhiều mảng phẳng vốn nén tốt như vậy một cách lành mạnh, nên hãy xem trước khi quyết định',
    'media.trait.generous': '{bpp} byte mỗi điểm ảnh — gần như không nén, nên nặng so với kích thước của nó',
    'media.trait.brief': 'Chỉ dài {n} giây',
    'media.trait.long': 'Dài {n} phút',
    'media.trait.noMetadata': 'Vỏ chứa của tệp không mang thời lượng lẫn độ phân giải',
    'media.trait.uhd': '{w}×{h} — 4K',
    'media.trait.lowBitrate': '{n} kbps — nén rất mạnh so với dung lượng',
    'media.trait.silent': 'Hoàn toàn không có tiếng',

    /* ---- photos and video: the screen ------------------------------------- */
    'app.tab.media': 'Ảnh & video',
    'app.done': 'Xong',
    'media.scan': 'Tìm ảnh & video',
    'media.whereToLook': 'Tìm ở đâu…',
    'media.readyToScan': 'Sẵn sàng tìm trong các thư mục ảnh của bạn.',
    'media.selectShown': 'Chọn tất cả đang hiện',
    'media.gridLabel': 'Ảnh và video',
    'media.sort': 'Sắp xếp',
    'media.sort.size': 'Nặng nhất trước',
    'media.sort.date': 'Mới nhất trước',
    'media.sort.dateAsc': 'Cũ nhất trước',
    'media.sort.name': 'Theo tên',
    'media.sort.detail': 'Ít chi tiết nhất trước',
    'media.rootsTitle': 'Chỗ này tìm ở đâu',
    'media.rootsNote':
      'Các thư mục ảnh, không phải cả ổ đĩa. Quét cả ổ sẽ lôi về hàng chục nghìn biểu tượng giao diện ' +
      'từ các tệp giải nén và phần mềm đã cài, mà gần như không cái nào là ảnh của bạn. Nếu ảnh của bạn ' +
      'ở chỗ khác thì thêm thư mục đó vào.',
    'media.addFolder': 'Thêm một thư mục…',
    'media.label.folders': 'Thư mục ảnh',
    'media.label.scan': 'Lần quét ảnh',
    'media.chip.origin': 'Từ đâu ra',
    'media.chip.what': 'Là loại gì',
    'media.chip.conversation': 'Cuộc trò chuyện',
    'media.conversationTotal': '{n} trên {total} tệp · {size}',
    'media.conversationRest': 'và {n} cuộc nữa, nằm trong thanh phía trên',
    'media.conversation.why':
      'Hiện bằng id: cái tên nằm trong database tin nhắn của app chat, mà app này không mở database tin nhắn.',
    'media.token.conversation': 'Cuộc trò chuyện {id}',
    'media.chip.year': 'Năm',
    'media.noPreview': 'không xem trước được',
    'media.videoShort': 'video',
    'media.cloudBadge': 'Đang đồng bộ với {service} — xoá ở đây là xoá trên mọi thiết bị',
    'media.cloudRoot': 'Thư mục này đồng bộ với {service}',
    'media.selectedSynced': '{n} mục đang đồng bộ đám mây',
    'media.progress.walking': 'Đang duyệt thư mục… đã thấy {n} ảnh và video',
    'media.progress.reading': 'Đang đọc {done} trên {total}…',
    'media.noFolders': 'Chưa tích thư mục nào — mở “Tìm ở đâu” và chọn ít nhất một cái.',
    'media.failed': 'Lần quét không hoàn tất được.',
    'media.found': 'Tìm thấy {n} ảnh và video · {size}.',
    'media.hiddenAssets': '{n} tệp nữa là hình hoạ của phần mềm nên không hiển thị.',
    'media.onlineOnly':
      '{n} tệp chỉ lưu trên mạng nên không được mở ra, tức là không có gì bị tải về.',
    'media.unreadable': '{n} tệp không đọc được.',
    'media.chatUndrawable':
      'Còn {n} tệp nữa ({size}) là bản do app chat mã hoá lại, ở định dạng không thứ gì ở đây hiện được. Bản gốc của chính những tấm ảnh đó vẫn có trong danh sách.',
    'media.empty':
      'Không có ảnh hay video nào trong các thư mục đang tích. Mở “Tìm ở đâu” để thêm thư mục.',
    'media.excludedTitle': 'Những thư mục đã không tìm tới',
    'media.overviewTotal': '{n} tệp · {size}',
    'media.yearEmpty': '{year} · không có gì',
    'media.showMore': 'thêm {n} mục',
    'media.showFewer': 'thu gọn',
    'media.removeFilter': 'Bỏ bộ lọc này',
    'media.showingCount': 'Đang hiện {n} · {size}',
    'media.tickHint': 'Thêm vào danh sách đang chọn (giữ Shift để lấy cả một dải)',

    /* ---- the file viewer ---------------------------------------------------
     *
     * Mọi màn hình trong app này đều hỏi cùng một câu: có nên xoá không. Với
     * thứ không phải cache hay log thì không nhìn vào là không trả lời được.
     * Nên phần chữ ở đây phải nói rõ cái gì xem được, cái gì không, và vì sao —
     * "không xem được" mà không nói lý do thì người dùng tưởng app hỏng.
     */
    'app.view': 'Xem',
    'app.close': 'Đóng',
    'viewer.title': 'Xem trước tệp',
    'viewer.label': 'Xem trước',
    'viewer.openWith': 'Mở bằng ứng dụng gốc',
    'viewer.reading': 'Đang đọc…',
    // F3 — hai tệp mở cùng lúc.
    'viewer.compare.title': 'Hai bản, đặt cạnh nhau',
    'viewer.compare.unreadable': 'Không đọc được',
    'viewer.lines': '{n} dòng',
    'viewer.truncated': 'mới hiện {size} đầu tiên',
    'viewer.noExtension': 'không có đuôi',
    'viewer.note.unknown': 'Đây không phải định dạng app này hiển thị được.',
    'preview.error.noPath': 'Chưa chỉ định tệp nào',
    'preview.note.empty': 'Tệp này rỗng, không có gì bên trong.',
    'preview.note.mislabelled':
      'Mang đuôi .{ext} nhưng nội dung là văn bản thuần — cũng chính vì thế mà Word không mở được nó',
    'preview.note.tooLarge': 'Quá lớn để hiện ở đây — hãy mở bằng ứng dụng gốc của nó.',
    'preview.note.legacyOffice':
      'Đây là định dạng Office đời cũ, lưu nội dung theo cách mà app này không đọc được nếu không thêm thư viện ngoài — thứ nó vốn không có. Hãy mở bằng ứng dụng gốc.',
    'preview.note.binary': 'Không phải định dạng app này hiển thị được. Dung lượng và ngày tháng ở phía trên.',
    'preview.note.missing': 'Tệp này không còn ở đó nữa.',
    'preview.note.notAFile': 'Đây là thư mục, không phải tệp.',
    'preview.note.busy': 'Một chương trình khác đang mở tệp này.',
    'preview.note.unreadable': 'Không mở được tệp này.',

    /*
     * Vì sao một tệp mang tên tài liệu lại không đọc được như tài liệu.
     *
     * Tách thành từng câu riêng chứ không gộp thành một lời xin lỗi chung, vì
     * mỗi lý do dẫn tới một việc khác nhau: tệp hỏng thì may ra cứu được, tệp
     * khoá thì cần mật khẩu chứ không cần sửa, còn tệp quá lớn thì vẫn bình
     * thường, chỉ là không hợp với một khung xem trước.
     */
    'preview.why.notADocument':
      'Mang đuôi .{ext} nhưng bên trong không phải một tài liệu. Thứ tạo ra nó đã không tạo ra tài liệu thật.',
    'preview.why.encrypted': 'Tệp này được đặt mật khẩu. Hãy mở bằng ứng dụng gốc của nó.',
    'preview.why.damaged': 'Tệp này hỏng, không đọc được tới cuối.',
    'preview.why.tooLarge': 'Quá lớn để mở ở đây — hãy mở bằng ứng dụng gốc của nó.',
    'preview.why.unsupported': 'Bên trong tệp này có thứ mà app không đọc được.',

    /* Word, Excel, PowerPoint và tệp nén, khi đã đọc được. */
    'viewer.doc.empty': 'Tài liệu này không có chữ nào.',
    'viewer.doc.truncated': 'Tệp này lớn — ở đây mới hiện phần đầu.',
    'viewer.doc.droppedImages': '{n} ảnh quá lớn nên không hiện ở đây.',
    'viewer.img.format': '[ảnh ở định dạng không hiển thị được: .{ext}]',
    'viewer.img.skipped': '[ảnh quá lớn để hiện ở đây]',
    'viewer.sheet.none': 'Bảng tính này không có trang nào.',
    'viewer.sheet.empty': 'Trang này trống.',
    'viewer.sheet.missing': 'Trang này được nhắc tới nhưng không có trong tệp.',
    'viewer.sheet.hidden': 'Đang bị ẩn trong Excel',
    'viewer.cell.true': 'ĐÚNG',
    'viewer.cell.false': 'SAI',
    'viewer.deck.empty': 'Bài trình chiếu này không có trang nào.',
    'viewer.deck.untitled': 'Trang không tiêu đề',
    'viewer.deck.notes': 'Ghi chú người trình bày',
    'viewer.archive.summary': '{n} tệp · {size} khi giải nén',
    'viewer.archive.encrypted': 'Một phần nội dung được đặt mật khẩu.',
    'viewer.archive.more': 'Mới liệt kê {n} mục đầu tiên.',
    'viewer.facts.sheets': '{n} trang tính',
    'viewer.facts.slides': '{n} trang chiếu',
    'viewer.facts.images': '{n} ảnh',
    'viewer.facts.entries': '{n} tệp',

    /*
     * How sure the app is.
     *
     * Kept as four clearly different words rather than four shades of the same
     * one: the whole reason this is on screen is so that "a guess" cannot be
     * mistaken for "certain" by somebody skimming before they delete.
     */
    'confidence.certain': 'chắc chắn',
    'confidence.strong': 'căn cứ vững',
    'confidence.likely': 'nhiều khả năng',
    'confidence.guess': 'chỉ là phỏng đoán',

    /* ---- photos and video: the filter chips -------------------------------
     *
     * Reached through a table in `media.js` rather than written at the call
     * site, so `test-i18n.js` knows about them through DYNAMIC_PREFIXES.
     */
    'media.origin.camera': 'Chụp từ máy ảnh',
    'media.origin.screenshot': 'Ảnh chụp màn hình',
    'media.origin.messaging': 'Nhận qua tin nhắn',
    'media.origin.download': 'Tải về',
    'media.origin.edited': 'Do phần mềm tạo hoặc chỉnh',
    'media.origin.screenrecord': 'Quay màn hình',
    'media.origin.gamecapture': 'Ghi hình game',
    'media.origin.unknown': 'Không rõ từ đâu',

    'media.trait.label.broken': 'Hỏng hoặc rỗng',
    'media.trait.label.mislabelled': 'Sai đuôi tệp',
    'media.trait.label.tiny': 'Cỡ biểu tượng',
    'media.trait.label.thumbnail': 'Cỡ ảnh thu nhỏ',
    'media.trait.label.big': 'Tệp nặng',
    'media.trait.label.highres': 'Độ phân giải đầy đủ',
    'media.trait.label.lowres': 'Độ phân giải thấp',
    'media.trait.label.wide': 'Rất rộng',
    'media.trait.label.tall': 'Rất cao',
    'media.trait.label.rotated': 'Lưu nằm ngang',
    'media.trait.label.screenSized': 'Bằng cỡ màn hình',
    'media.trait.label.recompressed': 'Đã đi qua app nhắn tin',
    'media.trait.label.hardCompressed': 'Nén tay',
    'media.trait.label.generous': 'Gần như không nén',
    'media.trait.label.cloud': 'Đồng bộ đám mây',
    'media.trait.label.onlineOnly': 'Chỉ lưu trên mạng',
    'media.trait.label.located': 'Có ghi vị trí',
    'media.trait.label.brief': 'Rất ngắn',
    'media.trait.label.long': 'Dài',
    'media.trait.label.uhd': '4K',
    'media.trait.label.lowBitrate': 'Bitrate thấp',
    'media.trait.label.silent': 'Không tiếng',
    'media.trait.label.noMetadata': 'Không có metadata',

    /* ---- photos and video: the detail panel -------------------------------- */
    'media.fact.size': 'Dung lượng',
    'media.fact.dimensions': 'Kích thước',
    'media.fact.megapixels': 'Megapixel',
    'media.fact.duration': 'Thời lượng',
    'media.fact.bitrate': 'Bitrate',
    'media.fact.format': 'Định dạng',
    'media.fact.camera': 'Máy ảnh',
    'media.fact.lens': 'Ống kính',
    'media.fact.software': 'Phần mềm',
    'media.fact.taken': 'Ngày chụp',
    'media.fact.modified': 'Sửa lần cuối',
    'media.fact.bpp': 'Byte mỗi điểm ảnh',
    'media.fact.cloud': 'Đồng bộ với',
    'media.fact.detail': 'Độ chi tiết',

    /* ---- the two warnings in front of a delete -----------------------------
     *
     * The first is the most important sentence in this whole subsystem: for a
     * synced file the Recycle Bin is not the safety net the rest of the app has
     * taught the user to rely on. The Vietnamese has to be as blunt as the
     * English, not politer.
     */
    'dialog.confirmDelete.synced':
      '{n} mục trong số này nằm trong thư mục đang đồng bộ với {service}. Xoá ở đây là xoá chúng trên ' +
      'mọi thiết bị đang đồng bộ, và Thùng rác của máy này không lấy lại được những bản đó.',
    'dialog.confirmDelete.binNote':
      'Chuyển vào Thùng rác vẫn chưa giải phóng được dung lượng nào — Thùng rác nằm trên cùng ổ đĩa. ' +
      'Chưa có gì thực sự được thu hồi cho tới khi dọn Thùng rác.',
    'dialog.confirmDelete.slow':
      'Windows chuyển được khoảng {rate} tệp mỗi giây, nên việc này mất chừng {duration}. Tiến độ hiện ' +
      'trong lúc chạy và bạn có thể dừng bất cứ lúc nào — những gì đã chuyển vẫn nằm trong Thùng rác.',

    /* ---- durations, inside the dialogs ---------------------------------- */
    'duration.unknown': 'không rõ',
    'duration.moment': 'một lát',
    'duration.seconds': '{n} giây',
    'duration.minute': '1 phút',
    'duration.minutes': '{n} phút',
    'duration.hour': '1 giờ',
    'duration.hours': '{h} giờ',
    'duration.hoursMinutes': '{h} giờ {m} phút',

    /* ---- the Restore Center ----------------------------------------------
     *
     * *Put back* → **khôi phục**, the word Explorer's own Recycle Bin uses, so
     * the button here and the one in Explorer read as the same act. A file
     * "no longer in the bin" is **không còn trong Thùng rác**, never "đã mất":
     * the app does not know that it is lost, only that it is not there.
     */
    'app.tab.restore': 'Khôi phục',
    'restore.refresh': 'Kiểm tra lại',
    'restore.intro':
      'Mọi việc ứng dụng đã làm với tệp, mới nhất ở trên. Mỗi lần mở trang này, vị trí hiện tại của từng ' +
      'tệp được đọc lại từ ổ đĩa chứ không lấy từ bản ghi: tệp đã được ai đó khôi phục bằng Explorer, hoặc ' +
      'đã bị dọn khỏi Thùng rác, sẽ được ghi đúng như vậy.',
    'restore.putBackSelected': 'Khôi phục mục đã chọn',
    'restore.empty':
      'Chưa có gì. Mỗi lần ứng dụng di chuyển một tệp, việc đó được ghi lại ở đây, và thứ gì khôi phục được ' +
      'thì khôi phục được từ đây.',
    'restore.progressTitle': 'Đang khôi phục từ Thùng rác',
    'restore.title.recycle': 'Đã chuyển {n} {items} vào Thùng rác',
    'restore.title.restore': 'Đã khôi phục {n} {items} từ Thùng rác',
    'restore.title.purge': 'Đã xoá vĩnh viễn {n} {items} khỏi Thùng rác',
    'restore.title.other': '{kind}: {n} {items}',
    'restore.source.manual': 'từ một màn hình',
    'restore.source.autoclean': 'dọn dẹp tự động, chạy bằng tay',
    'restore.source.scheduled': 'lần chạy theo lịch',
    'restore.source.migrated': 'từ bản ghi cũ',
    'restore.source.purge': 'dọn chọn lọc Thùng rác',
    'restore.source.restore': 'chuyển ra để nhường chỗ cho tệp được khôi phục',
    'restore.tally.inBin': '{n} còn trong Thùng rác',
    'restore.tally.restored': '{n} đã khôi phục',
    'restore.tally.purged': '{n} đã bị ứng dụng xoá vĩnh viễn',
    'restore.tally.gone': '{n} không còn trong Thùng rác',
    'restore.tally.unavailable': '{n} nằm trên ổ đang không kết nối',
    'restore.state.inBin': 'trong Thùng rác',
    'restore.state.restored': 'đã khôi phục',
    'restore.state.purged': 'đã xoá vĩnh viễn',
    'restore.state.gone': 'không còn trong Thùng rác',
    'restore.state.unavailable': 'ổ không kết nối',
    'restore.row.inBin': 'Chuyển vào Thùng rác {when} — Thùng rác ghi cùng thời điểm đó',
    'restore.row.restored': 'Đã khôi phục {when}, với tên {path}',
    'restore.row.restoredHere': 'Đã khôi phục {when}, về đúng chỗ cũ',
    'restore.row.restoredMoved': 'Đã khôi phục {when}, và hiện không còn ở {path}',
    'restore.row.purged':
      'Đã bị xoá hẳn khỏi Thùng rác {when} bởi lần dọn chọn lọc của ứng dụng — không khôi phục được nữa',
    'restore.row.unavailable': 'Ổ chứa tệp này đang không kết nối, nên không kiểm tra được tệp đang ở đâu',
    'restore.row.goneHere':
      'Không còn trong Thùng rác, và ở đường dẫn cũ đang có một tệp — có thể nó đã được khôi phục bằng Explorer',
    'restore.row.gone': 'Không còn trong Thùng rác — Thùng rác đã được dọn, hoặc tệp đã được lấy ra bên ngoài ứng dụng',
    'restore.putBackAll': 'Khôi phục cả {n}',
    'restore.showFiles': 'Xem các tệp',
    'restore.hideFiles': 'Ẩn các tệp',
    'restore.incomplete':
      'Việc này chưa chạy xong — ứng dụng đã dừng giữa chừng. Danh sách là những gì đã được ghi trước lúc đó.',
    'restore.cancelled': 'Đã dừng giữa chừng; phần còn lại vẫn để nguyên chỗ cũ.',
    'restore.purgeNote': 'Dọn chọn lọc là vĩnh viễn: không khôi phục được các tệp này. Lần đó đã giải phóng {size}.',
    'restore.status': '{n} {sessions} · {count} {items} khôi phục được ({size})',
    'restore.session.one': 'lần',
    'restore.session.other': 'lần',
    'restore.cancelledNothing': 'Chưa khôi phục gì.',
    'restore.done': 'Đã khôi phục {n} {items} ({size}) về chỗ cũ',
    'restore.skipped': '{n} mục không khôi phục được',
    'restore.nothing': 'Không khôi phục được gì. {reason}',
    'restore.fileSuffix': 'đã khôi phục',
    'restore.why.unknown': 'Không phải việc ứng dụng đã làm',
    'restore.why.restored': 'Đã được khôi phục rồi',
    'restore.why.purged': 'Đã bị ứng dụng xoá vĩnh viễn khỏi Thùng rác',
    'restore.why.gone': 'Không còn trong Thùng rác',
    'restore.why.unavailable': 'Ổ chứa tệp này đang không kết nối',
    'restore.why.notAbsolute': 'Không phải đường dẫn đầy đủ',
    'restore.why.system': 'Không ghi vào vị trí hệ thống',
    'restore.why.program': 'Không ghi vào thư mục của ứng dụng đã cài',
    'restore.why.inTheWay': 'Đường dẫn đó đang có thứ khác, nên để nguyên',
    'restore.why.folderInTheWay': 'Có một thư mục nằm chắn chỗ, và thư mục thì không bao giờ bị chuyển vào Thùng rác',
    'restore.why.displaceFailed': 'Không chuyển được tệp đang nằm ở đó vào Thùng rác',
    'restore.why.failed': 'Không khôi phục được',

    /* ---- the System screen (A1) ------------------------------------------
     *
     * *Not explained* → **chưa giải thích được**: the app is saying what it
     * could not account for, not that something is wrong. *Handoff* buttons
     * name the Windows page the way Windows names it in Vietnamese where one
     * exists (Tùy chọn nguồn, Bảo vệ hệ thống, Dọn dẹp ổ đĩa).
     */
    'app.tab.system': 'Hệ thống',



    /* ---- Developer Pack (C2, C4) ------------------------------------------ */

    'app.tab.dev': 'Lập trình',
    'progress.dev': 'Đang đo các công cụ lập trình',
    'dev.scan': 'Tìm công cụ lập trình',
    'dev.ready':
      'Tìm các kho cache gói, SDK và cache trình soạn thảo mà công cụ lập trình của bạn giữ lại, rồi đo từng cái.',
    'dev.done': '{n} công cụ, {size}, trong {time}.',
    'dev.needsPro': 'Developer Pack thuộc gói Pro·Dev.',
    'dev.none': 'Không tìm thấy công cụ lập trình nào trên máy này.',
    'dev.noneShort': 'Không tìm thấy gì.',

    'dev.stat.total': 'Tất cả',
    'dev.stat.packages': 'Cache gói',

    'dev.stat.machines': 'Linux và Docker',
    'dev.group.machines': 'Ổ đĩa Linux và container',
    'dev.group.machines.what':
      'Một bản Linux giữ mọi thứ bên trong nó trong đúng một tệp, còn Docker giữ mọi image và volume trong một tệp khác. Đây thường là những thứ to nhất trên máy của người lập trình, và app không đụng vào bất kỳ cái nào: thứ dọn được chúng là xoá thẳng, và không có gì đi qua Thùng rác cả.',

    'dev.step.shutdown': 'Dừng hết trước đã — không đổi được ổ đĩa khi nó đang chạy:',
    'dev.step.sparse': 'Rồi cho ổ đĩa trả lại chỗ mỗi khi bên trong nó được giải phóng:',
    'dev.step.unregister':
      'Hoặc gỡ hẳn cả bản phân phối. Mọi thứ bên trong sẽ mất vĩnh viễn, và không có gì đi qua Thùng rác:',
    'dev.step.df': 'Xem trong đó có gì trước đã:',
    'dev.step.prune':
      'Rồi xoá image, volume và container đã dừng. Việc này là vĩnh viễn và không có gì đi qua Thùng rác:',

    'evidence.dev.wslWhat':
      'Ổ đĩa ảo của bản Linux {name}. Mọi thứ cài bên trong nó đều nằm trong đúng một tệp này',
    'evidence.dev.wslSize':
      '{size}, và toàn bộ chỗ đó nằm thật trên ổ — đây không phải loại tệp khai nhiều hơn phần nó dùng',
    'evidence.dev.wslWritten':
      'Ghi lần cuối vào {when}. Đó là lúc ổ đĩa thay đổi, không phải lúc bạn khởi động bản phân phối lần cuối — không có cách nào đọc được mốc đó mà không khởi động nó lên',
    'evidence.dev.wslNoDisk':
      'Tệp ổ đĩa của nó không nằm ở chỗ registry khai, nên không thể nói gì về dung lượng',
    'evidence.dev.wslDocker':
      'Docker Desktop đã cài bản này và chạy bên trong nó. Gỡ nó đi là gỡ luôn engine của Docker, và đây cũng không phải nơi Docker giữ image',
    'evidence.dev.wslSparse':
      'WSL {version} có thể làm ổ đĩa này trả lại chỗ mỗi khi bên trong được giải phóng. Phải tắt nó trước, và app không bao giờ chạy lệnh nào trong hai lệnh đó',
    'evidence.dev.wslOld':
      'Bản WSL này quá cũ để ổ đĩa tự trả lại chỗ, nên tệp đó chỉ có phình to thêm',

    'evidence.dev.dockerWhat':
      'Ổ dữ liệu của Docker Desktop: mọi image bạn từng tải, mọi volume, và mọi container từng được dựng',
    'evidence.dev.dockerSize': '{size}, toàn bộ nằm thật trên ổ',
    'evidence.dev.dockerSeparate':
      'Đây không phải ổ đĩa riêng của bản phân phối docker-desktop, cái đó chỉ khoảng một phần mười gigabyte. Làm cái đó sparse sẽ không thu nhỏ được gì ở đây',
    'evidence.dev.dockerPrune':
      'Docker dọn nó bằng chính lệnh của Docker. “docker system df” cho xem trong đó có gì trước, còn lệnh prune bên dưới xoá hẳn image, volume và container đã dừng — không có gì đi qua Thùng rác',
    'dev.stat.free': 'Xoá được ngay',

    'dev.group.packages': 'Cache gói',
    'dev.group.packages.what':
      'Các gói mà công cụ của bạn đã tải về. Mỗi công cụ tự dọn cache của nó bằng lệnh hiện bên dưới — app không đụng vào, vì chính công cụ tạo ra chúng mới biết cái nào còn cần, còn đi bộ thư mục thì không.',
    'dev.group.sdk': 'SDK và bộ công cụ',
    'dev.group.sdk.what':
      'Nguyên cả bộ công cụ. Gỡ bớt một phần là việc của trình quản lý chính chủ; bốc thư mục ra bằng tay sẽ khiến nó vẫn tưởng các phần đó còn đấy.',
    'dev.group.ide': 'Cache trình soạn thảo',
    'dev.group.ide.what':
      'Dữ liệu mà trình soạn thảo sẽ ghi lại khi cần. Phần này app có chuyển vào Thùng rác — và chỉ khi trình soạn thảo sở hữu nó đang đóng.',

    'dev.files': '{n} tệp',
    'dev.isOpen': '{name} đang mở — hãy đóng nó rồi quét lại.',
    'dev.processesUnknown': 'Không kiểm được {name} có đang chạy hay không, nên không đề xuất gì ở đây.',
    'dev.clear': 'Chuyển {n} tệp vào Thùng rác',
    'dev.openApps': 'Mở danh sách ứng dụng của Windows',
    'dev.reveal': 'Mở thư mục',
    'dev.copied': 'Đã chép: {text}',

    'dev.phase.processes': 'Đang xem trình soạn thảo nào đang mở…',
    'dev.phase.measuring': 'Đang đo {name}…',

    'dev.note.cancelled': 'Lượt quét bị dừng giữa chừng.',
    'dev.note.noProcesses':
      'Không đọc được danh sách chương trình đang chạy, nên không cache trình soạn thảo nào được đề xuất — app sẽ không rút cache khỏi một trình soạn thảo mà nó không nhìn thấy.',
    'dev.note.missing': 'Không có trên máy này, và đã tìm: {list}.',
    'dev.note.neverRuns':
      'App không bao giờ chạy bất kỳ lệnh nào trong số này. Nó hiện ra lệnh mà từng công cụ dùng để bạn đọc trước, và chép lại nếu muốn.',

    /* ---- Dự án của bạn (C1, C5) ------------------------------------------ */

    'progress.devProjects': 'Đang xem qua các thư mục của bạn',
    'dev.projects.title': 'Dự án của bạn',
    'dev.projects.what':
      'Xem qua các thư mục đã chọn ở tab Dung lượng đĩa để tìm dự án của chính bạn: thư viện của chúng nặng bao nhiêu, và các lần build để lại những gì.',
    'dev.projects.scan': 'Xem qua các thư mục của tôi',
    'dev.projects.ready': 'Sẵn sàng xem qua {folder}.',
    'dev.projects.readyMany': 'Sẵn sàng xem qua {n} thư mục.',
    'dev.projects.noRoots':
      'Hãy chọn một thư mục ở tab Dung lượng đĩa trước — phần này xem qua đúng các thư mục đã chọn ở đó.',
    'dev.projects.noRootsShort': 'Chưa chọn thư mục nào.',
    'dev.projects.none':
      'Không tìm thấy dự án nào có thư mục thư viện hoặc thư mục build trong các thư mục đã chọn.',
    'dev.projects.done': '{n} dự án, {size}, trong {time}.',

    'dev.projects.stat.projects': 'Dự án',
    'dev.projects.stat.deps': 'Thư viện',
    'dev.projects.stat.build': 'Thư mục build',

    'dev.projects.group.deps': 'Thư viện, theo từng dự án',
    'dev.projects.group.deps.what':
      'Những gì mỗi dự án đã tải về để build chính nó. App không đụng tới thứ nào — lệnh trên từng dòng là cách nó quay lại.',
    'dev.projects.group.build': 'Kết quả biên dịch mà dự án của bạn đã khai',
    'dev.projects.group.build.what':
      'Mỗi thư mục ở đây đều nằm dưới một dòng .gitignore nói rằng nó sẽ được tạo lại. Chỉ những thư mục đó mới được đề xuất.',
    'dev.projects.group.guess': 'Những thư mục chỉ trông giống kết quả biên dịch',
    'dev.projects.group.guess.what':
      'Tên là build, dist hay bin, và không có gì nói chúng sẽ được tạo lại. Hiện ra để bạn biết là đã tìm thấy và đã để yên.',

    'dev.projects.files': '{n} {files}',
    'dev.projects.clear': 'Chuyển {count} vào Thùng rác',
    'dev.projects.lock': 'lockfile: {list}',
    'dev.projects.noLock': 'không có lockfile',
    'dev.projects.today': 'vừa chạm hôm nay',
    'dev.projects.idle': 'bỏ không {days} ngày',
    'dev.projects.declaredBy': '.gitignore của nó ghi “{line}”',
    'dev.projects.truncated':
      'Chỉ những tệp đầu tiên ở đây được liệt kê, nên cũng chỉ những tệp đó chuyển đi được.',

    'dev.projects.phase.walking': 'Đang xem qua thư mục… {dirs} thư mục, {projects} dự án',
    'dev.projects.phase.builds': 'Đang đọc thư mục build… {at}/{of}',
    'dev.projects.phase.measuring': 'Đang đo {name}… {at}/{of}',
    'dev.projects.phase.touched': 'Đang xem {name} lần cuối bị chạm khi nào…',

    'dev.projects.note.refused':
      'Có {n} thư mục không đọc được, nên một phần các con số ở đây là mức sàn chứ không phải tổng.',
    'dev.projects.note.rootAppData':
      '{root} không được xem qua: nó nằm trong AppData, nơi các ứng dụng giữ bản sao của mọi thứ.',
    'dev.projects.note.rootRefused':
      '{root} không được xem qua: Windows và các chương trình đã cài nằm ở đó.',
    'dev.projects.note.declared':
      'Một thư mục build chỉ được đề xuất khi chính .gitignore của dự án gọi nó là thứ tạo lại được. Thư mục chỉ đơn thuần mang tên build hay dist thì được để yên — thư viện dự án đem theo cũng có một cái, và thư mục chứa các bản phát hành ai đó cố ý giữ cũng vậy.',
    'dev.projects.note.dependencies':
      'Thư mục thư viện không bao giờ bị đụng tới. Lệnh hiện ra sẽ đặt nó lại, và công cụ sở hữu nó biết lockfile ghim những gì theo cách app không biết.',
    'dev.projects.note.notLookedIn':
      'Không xem vào: mọi thứ dưới AppData, thư mục có tên bắt đầu bằng dấu chấm, ruột của các ứng dụng đã cài, và các cache gói đã liệt kê ở trên.',

    'evidence.dev.what.npm': 'Các gói npm đã tải về, giữ lại để lần cài sau khỏi tải lại',
    'evidence.dev.what.pip': 'Các gói Python pip đã tải về, giữ lại để lần cài sau khỏi tải lại',
    'evidence.dev.what.maven': 'Mọi thư viện Java mà Maven đã tải về, cho mọi dự án trên máy này',
    'evidence.dev.what.gradle':
      'Thư viện đã tải và cache build của Gradle, cộng với chính các bản Gradle mà các dự án yêu cầu',
    'evidence.dev.what.nuget': 'Các gói .NET đã khôi phục cho các dự án trên máy này',
    'evidence.dev.what.androidSdk': 'Các bản Android platform, build tools, NDK và ảnh máy ảo',
    'evidence.dev.what.dotnetSdk':
      'Mọi phiên bản .NET SDK đã cài, kể cả những bản không còn gì build bằng nữa',
    'evidence.dev.what.vscode':
      'Dữ liệu biên dịch sẵn của Code cho phiên bản đang chạy, và các gói tiện ích nó tải về để cài',
    'evidence.dev.what.cursor':
      'Dữ liệu biên dịch sẵn của Cursor cho phiên bản đang chạy, và các gói tiện ích nó tải về để cài',
    'evidence.dev.what.jetbrains':
      'Chỉ mục và log mà IDE của JetBrains ghi cho từng dự án — sẽ dựng lại, chậm, ở lần mở dự án kế tiếp',
    'evidence.dev.what.visualstudio':
      'Các thư mục cache của chính Visual Studio. Bản sao lưu thiết lập và bản sao lưu tệp nằm ngay cạnh đó và không bao giờ bị đụng tới',
    'evidence.dev.what.generic': 'Một kho cache mà công cụ lập trình của bạn giữ lại',

    'evidence.dev.measured': '{size} trong {files} tệp, đo bằng cách đọc mọi thư mục bên trong',
    'evidence.dev.command':
      'Chính công cụ của nó dọn bằng “{command}”, lệnh đó biết cái gì còn cần. App chỉ hiện lệnh ra và không bao giờ chạy',
    'evidence.dev.noCommand':
      'Nó không có lệnh nào để dọn. Xoá thư mục đi thì công cụ sẽ tải lại thứ nó cần ở lần build kế tiếp',
    'evidence.dev.places': 'Nằm ở {n} thư mục: {list}',
    'evidence.dev.refused': 'Có {n} thư mục bên trong không đọc được, nên nó chứa ít nhất chừng này',
    'evidence.dev.projectNoGit': 'Thư mục này không có kho git, nên không thứ gì trong đây có lịch sử để lần về',
    'evidence.dev.androidManager':
      'Hãy gỡ bớt thành phần từ chính SDK Manager của Android Studio, nơi biết dự án nào còn cần cái gì. Bốc thư mục ra bằng tay sẽ khiến nó vẫn tưởng các thành phần đó còn đấy',
    'evidence.dev.sdkManager':
      'Hãy gỡ các phiên bản cũ đúng theo cách đã cài, từ danh sách ứng dụng đã cài của Windows',
    'evidence.dev.listCommand': '“{command}” liệt kê những bản đã cài, để bạn thấy bản nào đã cũ',
    'evidence.dev.rebuilt': '{name} sẽ ghi lại thứ này khi cần',
    'evidence.dev.ideOpen': '{name} đang mở — hãy đóng nó rồi quét lại',
    'evidence.dev.processesUnknown':
      'Không kiểm được {name} có đang chạy hay không, nên không đề xuất gì ở đây',

    /* ---- Dự án của bạn: thư viện và kết quả biên dịch (C1, C5) ------------ */

    'evidence.dev.projectWhat':
      'Thư viện của {name}, do chính công cụ của nó tải về: {size} trong {files} tệp',
    'evidence.dev.projectLock':
      'Có {lock}, ghim sẵn từng phiên bản — cài lại sẽ ra đúng những gì đang nằm đây',
    'evidence.dev.projectNoLock':
      'Không có lockfile, nên cài lại có thể ra phiên bản khác với những gì đang nằm đây',
    'evidence.dev.projectUnknownAge':
      'Không xác định được ngày tháng của thứ gì ở đây, nên không rõ nó bị bỏ không bao lâu',
    'evidence.dev.projectStale':
      'Ngoài thư mục thư viện ra, {days} ngày nay không có gì thay đổi',
    'evidence.dev.projectRecent':
      'Có thứ ở đây vừa đổi {days} ngày trước, nên đây là dự án đang dùng',
    'evidence.dev.projectUncommitted':
      'Các tệp của nó mới hơn mọi thứ git ghi lại — ở đây có việc chưa bao giờ được commit',
    'evidence.dev.projectRestore':
      'Nó quay lại bằng “{command}”, lệnh mà app chỉ hiện ra chứ không bao giờ chạy',
    'evidence.dev.projectNoProcess':
      'Chưa kiểm xem có chương trình nào đang chạy trong thư mục này: Windows cho biết tiến trình được khởi động từ đâu, chứ không cho biết nó đang làm việc ở thư mục nào',

    'evidence.dev.buildWhat': 'Nằm trong {folder}, thứ mà {project} build đi build lại',
    'evidence.dev.buildDeclared':
      'Chính .gitignore của dự án có dòng “{line}” — người viết dòng đó đã nói thư mục này sẽ được tạo lại',
    'evidence.dev.buildGuessWhat': 'Một thư mục tên {name}, chứa {size} trong {files} tệp',
    'evidence.dev.buildNotDeclared':
      'Không có .gitignore nào ở đây gọi nó là thứ tạo lại được, nên CleanDrive không coi đây là kết quả biên dịch. Một thư mục tên như vậy cũng rất có thể là thư viện dự án đem theo, hoặc những bản build ai đó cố tình giữ',
    'evidence.dev.buildBeside':
      'Có file dự án tương ứng nằm cạnh — điều đó một mình không đủ: mọi thư viện đem theo cũng có một cái',

    /* ---- Thư viện game (D2) ---------------------------------------------- */

    'app.tab.games': 'Game',
    'progress.games': 'Đang đọc thư viện game',
    'games.scan': 'Tìm game của tôi',
    'games.ready':
      'Đọc chính các tệp của Steam để liệt kê những game đã cài, mỗi game chiếm bao nhiêu, và lần chơi cuối là khi nào.',
    'games.done': '{n} game, {size}, trong {time}.',
    'games.noSteam': 'Không tìm thấy bản cài Steam nào trên máy này. Ở đây chỉ đọc Steam.',
    'games.needsPro': 'Thư viện game thuộc gói Pro.',

    'games.stat.count': 'Game',
    'games.stat.size': 'Trên ổ đĩa',
    'games.stat.stale': 'Lâu chưa chơi',
    'games.stat.leftovers': 'Đồ thừa',

    'games.tableLabel': 'Game đã cài',
    'games.col.name': 'Game',
    'games.col.size': 'Trên ổ đĩa',
    'games.col.size.what': 'Theo đúng con số Steam ghi. Đã đối chiếu với một lượt đo thật trên máy này và thấy khớp chính xác.',
    'games.col.played': 'Chơi lần cuối',
    'games.col.played.what':
      'Lấy mốc muộn hơn giữa con số Steam ghi cạnh game và con số từng tài khoản trên máy này ghi lại.',

    'games.neverPlayed': 'không có bản ghi',
    'games.sharedRuntime': 'Các game khác dùng chung',
    'games.viaAccount': 'Theo bản ghi của chính một tài khoản Steam',
    'games.uninstall': 'Gỡ trong Steam…',
    'games.reveal': 'Mở thư mục',
    'games.handedOver': 'Đã nhờ Steam gỡ {name}. Steam là bên thực hiện, và sẽ hỏi bạn trước.',

    'games.phase.finding': 'Đang tìm Steam…',
    'games.phase.libraries': 'Đang đọc xem Steam để game ở những thư mục nào…',
    'games.phase.manifests': 'Đang đọc những gì đã cài…',
    'games.phase.played': 'Đang đọc lần chơi cuối của từng game…',
    'games.phase.leftovers': 'Đang đo những thứ Steam để lại…',

    'games.note.cancelled': 'Lượt quét bị dừng giữa chừng.',
    'games.note.missingLibrary':
      'Steam có khai một thư mục game ở {where}, mà ổ đó không gắn vào máy. Game trong đó không được tính ở đây.',
    'games.note.accounts':
      'Lần chơi cuối của mỗi game là mốc muộn hơn giữa con số Steam ghi cạnh game và con số mà {n} tài khoản Steam trên máy này ghi lại. Chỉ đọc đúng một mốc thời gian đó từ các tệp ấy.',
    'games.note.neverDeletes':
      'App không bao giờ gỡ game. Xoá thư mục game sẽ khiến Steam vẫn liệt kê nó mà chạy lại không lên — nên việc gỡ được giao cho Steam.',

    'games.leftovers.title': 'Những thứ Steam để lại',
    'games.leftovers.downloads':
      '{size} trong {n} tệp thuộc các lần tải chưa xong. Nếu hoá ra vẫn cần, Steam sẽ tải lại.',
    'games.leftovers.reserved':
      'Còn {n} tệp nữa đã được đặt chỗ sẵn ở kích thước cuối cùng nhưng chưa ghi gì vào, nên chúng không chiếm chỗ và không được liệt kê.',
    'games.leftovers.orphans':
      '{n} thư mục trong thư mục game của Steam không thuộc game nào đang cài. Hãy kiểm tra từng cái trong Steam rồi tự xoá — app không xoá thư mục.',
    'games.leftovers.steamOpen': 'Steam đang mở nên không có mục nào được đề xuất xoá. Hãy đóng Steam rồi xem lại.',
    'games.leftovers.steamUnknown':
      'Không kiểm được Steam có đang chạy hay không, nên không có mục nào được đề xuất xoá.',
    'games.leftovers.more': 'và {n} mục nữa',

    'evidence.games.played': 'Chơi lần cuối cách đây {n} ngày',
    'evidence.games.viaManifest': 'Theo con số Steam ghi ngay cạnh game',
    'evidence.games.viaAccount':
      'Theo bản ghi của chính một tài khoản Steam trên máy này, mốc đó muộn hơn con số ghi cạnh game',
    'evidence.games.neverPlayed': 'Steam không có bản ghi nào về việc game này từng được chơi trên máy này',
    'evidence.games.redistributables':
      'Không phải game: đây là bộ thư viện dùng chung mà Steam cài để các game khác dùng. Gỡ nó đi sẽ khiến những game phụ thuộc vào nó không chạy được',
    'evidence.games.size': 'Steam ghi nhận nó là {size}, và máy này đã xác nhận con số đó là chính xác',
    'evidence.games.partial':
      'Steam không đánh dấu nó là đã cài xong, nên một phần chỗ này có thể là bản tải dở dừng giữa chừng',
    'evidence.games.staging': 'Còn {size} nữa đang chờ sẵn cho một bản cập nhật chưa hoàn tất',
    'evidence.games.updated': 'Steam cập nhật nó lần cuối cách đây {n} ngày',
    'evidence.games.library': 'Nằm trong thư viện Steam trên {library}',
    'evidence.games.accounts': 'Có {n} tài khoản Steam trên máy này từng chơi nó',
    'evidence.games.accountsUnread':
      'Có {n} trong {total} tài khoản Steam trên máy này không đọc được, nên có thể còn một lần chơi mới hơn chưa được tính',
    'evidence.games.uninstallOnly':
      'Chỉ Steam mới gỡ được nó. Xoá thư mục sẽ khiến Steam vẫn liệt kê game, và game sẽ không chạy được',

    'evidence.games.orphan':
      'Một thư mục trong thư mục game của Steam mà không game nào đang cài nhận — thường là thứ một lần gỡ bị gián đoạn để lại',
    'evidence.games.orphanSize': '{size} trong {files} tệp',
    'evidence.games.orphanCheck':
      'Hãy kiểm trong Steam trước: một game đang cài mà mất tệp manifest cũng trông y hệt thế này',
    'evidence.games.orphanNoAction': 'App sẽ không xoá thư mục. Hãy mở nó ra và tự xoá khi bạn đã chắc',

    'evidence.games.download': 'Một phần của lần tải Steam chưa xong, còn lại trong steamapps\\downloading',
    'evidence.games.downloadAge': 'Ghi lần cuối cách đây {n} ngày',
    'evidence.games.downloadRefetch':
      'Nếu hoá ra vẫn cần, Steam sẽ tải lại; không có thứ gì đã cài phụ thuộc vào nó',
    'evidence.games.downloadSparse':
      'Nó được đặt chỗ sẵn ở mức {claimed} nhưng mới ghi được {actual}, nên xoá đi cũng chỉ lấy lại được chừng đó',
    'evidence.games.steamOpen':
      'Steam đang mở — hãy đóng Steam trước khi xoá những thứ này, phòng khi một trong số đó là bản tải đang chạy',
    'evidence.games.steamUnknown': 'Không kiểm được Steam có đang chạy hay không, nên những mục này không được đề xuất',

    /* ---- Ứng dụng chat (D3) ---------------------------------------------- */

    'app.tab.chat': 'Ứng dụng chat',
    'progress.chat': 'Đang đọc những gì ứng dụng chat đã tải về',
    'chat.scan': 'Xem ứng dụng chat của tôi',
    'chat.ready':
      'Đo những gì Zalo và Telegram Desktop đã tải về máy này, và — với Zalo — mỗi phần thuộc cuộc trò chuyện nào. Không đọc tin nhắn nào.',
    'chat.done': '{size} do ứng dụng chat tải về, trong {time}.',
    'chat.needsPro': 'Dữ liệu ứng dụng chat thuộc gói Pro.',
    'chat.noApps': 'Không tìm thấy Zalo lẫn Telegram Desktop trên máy này.',
    'chat.tableLabel': 'Dữ liệu tải về theo cuộc trò chuyện',

    'chat.phase.finding': 'Đang tìm ứng dụng chat…',
    'chat.phase.zalo': 'Đang đọc những gì Zalo đã tải về…',
    'chat.phase.conversations': 'Cuộc trò chuyện {done} trên {total}…',
    'chat.phase.telegram': 'Đang đọc những gì Telegram Desktop giữ lại…',

    'chat.stat.size': 'Đã tải về',
    'chat.stat.conversations': 'Cuộc trò chuyện',
    'chat.stat.twice': 'Ảnh giữ hai bản',
    'chat.stat.selected': 'Đang chọn',

    'chat.delete': 'Chuyển mục đã chọn vào Thùng rác',
    'chat.deleteN': 'Chuyển {n} mục đã chọn vào Thùng rác',
    'chat.quarantine': 'Để riêng sang chỗ khác…',
    'chat.picking': 'Chọn',
    'chat.picked': 'Đã chọn',
    'chat.update.pick': 'Vẫn chọn',
    'chat.update.picked': 'Đã chọn — nó sẽ phải tải lại',

    'chat.kinds.title': 'Ở đây có gì, theo loại',
    'chat.kinds.what':
      'Mọi ứng dụng trên màn này, và mọi thứ nó đã tải về máy. Database tin nhắn không được tính và không bao giờ bị đụng tới.',
    'chat.appTotal': '{size} trong {n} tệp',

    'chat.months.title': 'Chúng đến khi nào',
    'chat.months.fromNames':
      'Zalo ghi thẳng thời điểm gửi tin nhắn vào tên tệp, nên đây là lúc từng thứ đến trong cuộc trò chuyện, không phải lúc máy này ghi tệp.',
    'chat.months.mixed':
      '{n} trong {total} mục mang sẵn thời điểm gửi trong tên; số còn lại xếp theo lúc máy này ghi tệp.',
    'chat.month.what': '{month}: {size} trong {n} tệp',
    'chat.biggest.title': 'Những tệp lớn nhất',

    'chat.conversations.title': 'Theo cuộc trò chuyện',
    'chat.conversations.what':
      '{n} cuộc trò chuyện, {size}. Chỉ những gì Zalo tải về mới chia được như vậy, và chỉ vì id của cuộc trò chuyện nằm sẵn trong tên thư mục lẫn tên từng tệp.',
    'chat.col.name': 'Cuộc trò chuyện',
    'chat.col.name.what':
      'Chính id của Zalo. Tên của nó nằm trong database tin nhắn, mà app này không mở database tin nhắn.',
    'chat.col.size': 'Đã tải về',
    'chat.col.when': 'Lần đến gần nhất',
    'chat.groupChat': 'Nhóm · {n} tệp',
    'chat.directChat': 'Một–một · {n} tệp',
    'chat.span': 'Từ {first} đến {last}',
    'chat.noDate': 'không rõ ngày',
    'chat.showKinds': 'Trong đó có gì',
    'chat.hideKinds': 'Ẩn phần trong đó',
    'chat.reveal': 'Mở thư mục',

    'chat.shared.title': 'Không gắn với cuộc trò chuyện nào',
    'chat.shared.what':
      '{size} không gắn được vào cuộc trò chuyện nào: mỗi loại một thư mục dùng chung cho cả tài khoản, bộ nhớ đệm của cả hai tài khoản Telegram, và phần một bản cập nhật đã giải nén ra.',

    'chat.note.cancelled': 'Lượt quét đã bị dừng giữa chừng.',
    'chat.note.appOpen':
      '{apps} đang mở, nên không thứ gì của nó được đề xuất xoá. Hãy đóng nó rồi quét lại.',
    'chat.note.processUnknown':
      'Không kiểm được các ứng dụng này có đang chạy hay không, nên không thứ gì ở đây được đề xuất xoá.',
    'chat.note.noDatabase':
      'Không database tin nhắn nào được mở và không tin nhắn nào được đọc. Đó chính là lý do một cuộc trò chuyện hiện bằng id: cái tên của nó nằm bên trong database.',
    'chat.note.telegramFlat':
      'Telegram Desktop không đặt tên thứ gì theo cuộc trò chuyện — bộ nhớ đệm của nó đánh địa chỉ theo nội dung — nên nó chỉ xuất hiện ở phần theo loại và theo tháng phía trên.',
    'chat.note.paired':
      'Zalo giữ {n} tấm ảnh trong số này hai bản: một bản đúng như lúc nhận và một bản đã mã hoá lại. Chỉ bản đúng như lúc nhận là thứ máy này mở được, nên bản nhỏ hơn không phải bản nên xoá.',

    'chat.kind.picture': 'Ảnh, do Zalo mã hoá lại',
    'chat.kind.cache': 'Ảnh đúng như lúc nhận',
    'chat.kind.video': 'Video',
    'chat.kind.voice': 'Tin nhắn thoại',
    'chat.kind.file': 'Tệp người ta gửi',
    'chat.kind.fileNoise': 'Tệp, ở dạng chỉ Zalo đọc được',
    'chat.kind.fileThumb': 'Ảnh thu nhỏ của tệp',
    'chat.kind.richThumb': 'Ảnh xem trước của liên kết',
    'chat.kind.zinstant': 'Mảnh giao diện Zalo tải về',
    'chat.kind.sticker': 'Nhãn dán',
    'chat.kind.tgCache': 'Mọi thứ Telegram lưu đệm',
    'chat.kind.tgMediaCache': 'Ảnh và video Telegram lưu đệm',
    'chat.kind.update': 'Một bản cập nhật đã tải',
    'chat.kind.other': 'Thứ tải về khác',

    'chat.removalNote':
      'Xoá ở đây là xoá khỏi máy này, không phải khỏi cuộc trò chuyện. Ứng dụng có tải lại được hay không còn tuỳ tệp đó còn trên máy chủ hay không — hãy coi như là không.',

    'evidence.chat.appOpen': '{app} đang mở — hãy đóng nó rồi quét lại',
    'evidence.chat.processUnknown':
      'Không kiểm được {app} có đang chạy hay không, nên không thứ gì ở đây được đề xuất xoá',
    'evidence.chat.group':
      'Một nhóm chat. Id của nó bắt đầu bằng “g”, và đó là dấu hiệu duy nhất phân biệt được ở đây',
    'evidence.chat.direct': 'Một cuộc trò chuyện một–một',
    'evidence.chat.noName':
      'Hiện bằng id vì cái tên nằm trong database tin nhắn của Zalo, mà app này không mở nó',
    'evidence.chat.oneDay': 'Mọi thứ ở đây đến trong ngày {day}',
    'evidence.chat.span': 'Từ {first} đến {last}',
    'evidence.chat.spread': 'Trải trên {n} loại tải về, mỗi loại một dung lượng riêng',
    'evidence.chat.paired':
      'Có {n} tấm trong số ảnh này được giữ hai bản — một bản đúng như Zalo nhận được và một bản mã hoá lại. Các bản đúng như lúc nhận cộng lại là {size}, và chúng mới là thứ máy này mở được',
    'evidence.chat.file': 'Do {app} tải về',
    'evidence.chat.shared':
      '{size} trong {n} tệp, và không có gì ở đây cho biết phần nào thuộc cuộc trò chuyện nào',
    'evidence.chat.sharedZalo':
      'Zalo để chung những thứ này trong một thư mục cho cả tài khoản, nên không có cách nào biết cái nào thuộc cuộc trò chuyện nào mà không đọc database tin nhắn',
    'evidence.chat.sharedTelegram':
      'Telegram không đặt tên thứ gì ở đây theo cuộc trò chuyện. Bộ nhớ đệm của nó đánh địa chỉ theo nội dung, và chỗ duy nhất định danh một cuộc trò chuyện là kho tin nhắn, mà app này không mở',
    'evidence.chat.updatePending':
      'Telegram {staged} đã được tải về và giải nén sẵn, đang chờ thay cho bản {installed} bạn đang chạy',
    'evidence.chat.updateApplied':
      'Telegram {staged} nằm giải nén ở đây còn bản đang chạy là {installed}, nên đây là bản sao của một lần cập nhật đã xong',
    'evidence.chat.updateUnknown':
      'Một bản cập nhật Telegram đã giải nén. Không đọc được hai số hiệu phiên bản, nên không biết được ở đây là nó còn đang chờ áp dụng hay không',
    'evidence.chat.updateWhen': 'Tải về ngày {day}',
    'evidence.chat.updateCost':
      'Xoá nó không phải là dọn rác: Telegram sẽ tải lại {size} đó vào lần cập nhật tới',

    'dialog.confirmDelete.chat':
      '{n} mục trong số này do {apps} tải về. Xoá chúng là xoá khỏi máy này, không phải khỏi cuộc trò chuyện. Ứng dụng có tải lại được hay không còn tuỳ tệp đó còn trên máy chủ hay không, mà điều đó không kiểm được từ đây — hãy coi như là không.',

    /* ---- Ứng dụng đã cài (D1) -------------------------------------------- */

    'app.tab.apps': 'Ứng dụng',
    'progress.apps': 'Đang đọc danh sách ứng dụng đã cài',
    'apps.scan': 'Liệt kê ứng dụng đã cài',
    'apps.prefetch': 'Thêm bản ghi khởi chạy của Windows…',
    'apps.ready':
      'Đọc danh sách chương trình đã cài mà Windows giữ, rồi đo các thư mục từng ứng dụng khai báo. Không cần quyền quản trị, mất khoảng nửa phút.',
    'apps.done': '{n} ứng dụng, đo được {size}, trong {time}.',
    'apps.declined': 'Hộp thoại quyền quản trị bị từ chối nên không đọc được bản ghi khởi chạy của Windows.',

    'apps.stat.count': 'Ứng dụng',
    'apps.stat.measured': 'Đo được',
    'apps.stat.unmeasured': 'Không có dung lượng',
    'apps.stat.review': 'Nên xem lại',

    'apps.tableLabel': 'Ứng dụng đã cài',
    'apps.col.name': 'Ứng dụng',
    'apps.col.measured': 'Đo được',
    'apps.col.measured.what': 'Các thư mục của nó, đọc và cộng lại. Để trống khi không có thư mục nào để đọc.',
    'apps.col.declared': 'Bên cài khai',
    'apps.col.declared.what':
      'Con số trình cài đặt tự ghi vào registry. Thường sai, và không bao giờ được cộng vào số đo được.',
    'apps.col.lastUsed': 'Mở lần cuối',
    'apps.col.lastUsed.what': 'Lấy từ các bản ghi Windows lưu về những gì đã được mở.',

    'apps.fromStore': 'Microsoft Store',
    'apps.uninstall': 'Gỡ cài đặt…',
    'apps.reveal': 'Mở thư mục',
    'apps.empty': 'Không có mục nào khớp.',
    'apps.noMeasure': 'Không có gì để đo: ứng dụng không ghi lại thư mục cài, hoặc thư mục đó không còn.',
    'apps.measureBreakdown': 'Thư mục cài {install}, thư mục dữ liệu {data}',
    'apps.declaredWhat': 'Con số của chính trình cài đặt, không phải số đo',
    'apps.lastUsed.none': 'không có bản ghi',
    'apps.lastUsed.locked': 'Pro',
    'apps.lastUsedVia': 'Theo {source}',
    'apps.source.prefetch': 'Prefetch',
    'apps.source.userAssist': 'Start menu và Explorer',
    'apps.source.shortcut': 'lối tắt của nó',

    'apps.sortBy': 'Sắp xếp theo',
    'apps.sort.size': 'Dung lượng',
    'apps.sort.lastUsed': 'Mở lần cuối',
    'apps.sort.name': 'Tên',
    'apps.onlyStale': 'Chỉ những ứng dụng không có bản ghi gần đây',
    'apps.onlyStaleDays': 'Chỉ những ứng dụng không có bản ghi trong {n} ngày',
    'apps.needsPro': 'Thời điểm mở lần cuối của từng ứng dụng, và việc sắp xếp theo nó, thuộc gói Pro.',

    'apps.protection.systemPackage': 'Một phần của Windows',
    'apps.protection.noRemove': 'Windows không cho gỡ',
    'apps.protection.inWindows': 'Cài bên trong Windows',
    'apps.protection.noUninstaller': 'Không có trình gỡ cài đặt',

    'apps.commandLabel': 'Lệnh mà trình gỡ cài đặt của chính ứng dụng này đã đăng ký. App không bao giờ chạy nó:',
    'apps.copied': 'Đã chép lệnh gỡ cài đặt',

    'apps.phase.registry': 'Đang đọc danh sách chương trình đã cài mà Windows giữ…',
    'apps.phase.store': 'Đang hỏi Windows về các ứng dụng từ Microsoft Store…',
    'apps.phase.folders': 'Đang tìm thư mục mà mỗi ứng dụng lưu dữ liệu…',
    'apps.phase.prefetch': 'Đang đọc bản ghi khởi chạy của Windows…',
    'apps.phase.measuring': 'Đang đo thư mục… {done}/{total}',

    'apps.note.cancelled': 'Danh sách bị dừng giữa chừng nên một số ứng dụng chưa có dung lượng.',
    'apps.note.unmeasured':
      '{n} ứng dụng không ghi lại nơi đã cài, hoặc thư mục của chúng không còn, nên không có gì để đo. Chỗ nào trình cài đặt để lại con số thì nó nằm ở cột “Bên cài khai”, và đó là lời khai của trình cài đặt, không phải số đo.',
    'apps.note.hidden':
      'Còn {n} mục nữa trong registry bị bỏ ra, đúng những mục Windows cũng bỏ khỏi danh sách của nó: runtime dùng chung, gói driver và bản cập nhật.',
    'apps.note.cover':
      'Các bản ghi khởi chạy trên máy này lùi về khoảng {n} tháng, và Windows chỉ ghi lại những gì bạn mở từ Explorer và Start menu. “Không có bản ghi” nghĩa là không có gì được ghi lại, không phải là ứng dụng không được dùng. Muốn thêm bản ghi Prefetch của chính Windows thì cần quyền quản trị.',
    'apps.note.noRecords':
      'Windows không có bản ghi khởi chạy nào cho tài khoản này, nên không thể nói gì về lần mở cuối của bất kỳ ứng dụng nào.',
    'apps.note.prefetch': 'Đã gộp cả bản ghi khởi chạy của chính Windows: {n} chương trình, đo với sự cho phép của bạn.',
    'apps.note.noAtime':
      'Thời điểm “mở lần cuối” của tệp không được dùng ở đây. Trên máy này, 70% chương trình trong Program Files đã bị đọc trong tuần vừa rồi — bởi phần mềm diệt virus, bộ lập chỉ mục tìm kiếm và bản sao lưu, chứ không phải do ai đó khởi chạy chúng.',
    'apps.note.noStore': 'Windows không chịu liệt kê các ứng dụng Microsoft Store, nên chúng vắng mặt trong danh sách này.',

    'evidence.apps.systemPackage': 'Windows đã ký gói này như một phần của chính nó',
    'evidence.apps.noRemove': 'Windows đánh dấu đây là mục không thể gỡ từ danh sách ứng dụng đã cài',
    'evidence.apps.inWindows': 'Nó được cài bên trong thư mục Windows',
    'evidence.apps.noUninstaller': 'Nó không đăng ký trình gỡ cài đặt nào, nên Windows không đưa ra cách nào để gỡ',
    'evidence.apps.viaPrefetch': 'Mở lần cuối cách đây {n} ngày, theo bản ghi Prefetch của chính Windows',
    'evidence.apps.viaUserAssist':
      'Mở lần cuối cách đây {n} ngày, theo những gì Windows ghi lại về thứ bạn mở từ Explorer và Start menu',
    'evidence.apps.viaShortcut':
      'Lối tắt của nó được mở lần cuối cách đây {n} ngày, theo những gì Windows ghi lại về thứ bạn mở từ Explorer và Start menu',
    'evidence.apps.matchedByPath': 'Bản ghi này trỏ tới một chương trình nằm trong chính thư mục của ứng dụng',
    'evidence.apps.matchedByName': 'Khớp theo tên tệp chương trình, mà một ứng dụng khác cũng có thể trùng tên',
    'evidence.apps.noRecord':
      'Không có bản ghi nào về việc nó được khởi chạy trong {n} tháng mà các bản ghi này bao phủ. Windows chỉ ghi lại thứ bạn mở từ Explorer và Start menu, nên một nút ghim trên thanh tác vụ hay một chương trình khác khởi chạy nó sẽ không để lại dấu vết',
    'evidence.apps.noRecords':
      'Windows không có bản ghi khởi chạy nào trên máy này, nên không thể nói gì về lần dùng cuối của mục này',
    'evidence.apps.measured': 'Thư mục cài được đo bằng cách đọc mọi thư mục bên trong: {size} trong {files} tệp',
    'evidence.apps.measuredPartial': 'Có {n} thư mục bên trong không đọc được, nên nó chứa ít nhất chừng này',
    'evidence.apps.locationGone': 'Thư mục mà nó khai là đã cài vào không còn nữa',
    'evidence.apps.steamGame':
      'Một game trên Steam. Vị trí và dung lượng của nó lấy từ chính các tệp của Steam, ở màn Game — mục mà Windows giữ cho nó sẽ cũ đi mỗi khi game được chuyển chỗ',
    'evidence.apps.locationBroad':
      'Nó khai cả một ổ đĩa hoặc một thư mục dùng chung là thư mục cài, đo chỗ đó sẽ ra nhiều hơn ứng dụng này rất nhiều',
    'evidence.apps.noLocation': 'Nó không ghi lại nơi đã cài vào, nên không đo được thư mục của nó',
    'evidence.apps.declared':
      'Trình cài đặt của nó khai {size}. Con số đó là thứ trình cài đặt tự ghi và thường sai — trên máy này nó dao động từ một phần tư dung lượng thật tới hai mươi lăm lần',
    'evidence.apps.dataStrong': '{size} trong {folder}, khớp với một cái tên mà ứng dụng này tự nhận',
    'evidence.apps.dataGuess': '{size} trong {folder}, chỉ khớp với ứng dụng này qua tên',
    'evidence.apps.shared':
      'Có {n} ứng dụng khác cũng cài vào đúng thư mục này, nên dung lượng này là của thư mục, không phải của riêng ứng dụng này. Tổng ở trên chỉ đếm nó một lần',
    'evidence.apps.alsoIn': 'Cùng một chương trình được đăng ký thêm {n} lần nữa, và ở đây chỉ đếm một lần',
    'evidence.apps.installedDays': 'Windows ghi nhận nó được cài cách đây {n} ngày',
    'evidence.apps.installedMonths': 'Windows ghi nhận nó được cài cách đây khoảng {n} tháng',
    'evidence.apps.installedYears': 'Windows ghi nhận nó được cài cách đây khoảng {n} năm',
    'system.measure': 'Đo ổ này',
    'system.measureElevated': 'Đo với quyền quản trị…',
    'system.size': 'dung lượng',
    'system.used': 'Đang dùng',
    'system.free': 'Còn trống',
    'system.unexplained': 'Chưa giải thích được',
    'system.barTitle': 'Dung lượng trên ổ này đã đi đâu',
    'system.barLabel': '{drive} — {parts}',
    'system.group.yours': 'Tệp của bạn',
    'system.group.programs': 'Chương trình',
    'system.group.windows': 'Windows và hệ thống',
    'system.needsAdminShort': 'cần quyền quản trị',
    'system.atLeast': 'trở lên',
    'system.filesAtTop': '(các tệp ở ngay gốc ổ)',
    'system.moreParts': 'và {n} mục khác',
    'system.copy': 'Sao chép',
    'system.copied': 'Đã sao chép: {text}',
    'system.copySelect': 'Đã chọn sẵn — nhấn Ctrl+C để sao chép',
    'system.handoffLabel': 'Mở',
    'system.openInUsage': 'Xem bên trong bằng Dung lượng đĩa',
    'system.openRestore': 'Mở Khôi phục',
    'system.ready': 'Việc đo sẽ đọc mọi thư mục trên ổ. Có thể mất vài phút, và có thể dừng bất cứ lúc nào.',
    'system.walking': 'Đang đọc ổ… {files} tệp, {folders} thư mục ({time})',
    'system.done': 'Đã đọc {files} tệp trong {folders} thư mục, mất {time}.',
    'system.declined': 'Hộp thoại quyền quản trị đã bị từ chối, nên không đo thêm được gì.',
    'system.phase.prompt': 'Đang chờ hộp thoại quyền quản trị…',
    'system.phase.folders': 'Đang đo {n} thư mục mà Windows không cho chương trình thường đọc…',
    'system.phase.tools': 'Đang hỏi Windows về điểm khôi phục, kho thành phần và hệ thống tệp…',
    'system.phase.dism': 'Đang chờ DISM đo kho thành phần — có thể mất một hai phút…',
    'system.note.cancelled': 'Việc đo đã bị dừng, nên một phần ổ chưa được đọc và đang tính vào phần chưa giải thích được.',
    'system.note.refused':
      '{n} thư mục không đọc được nếu không có quyền quản trị. Cho tới khi đo chúng, những gì bên trong đang nằm trong “Chưa giải thích được”.',
    'system.note.elevated':
      'Đã đo với quyền quản trị {when}: tìm thêm {size} trong các thư mục mà chương trình thường không được đọc.',
    'system.note.unexplained':
      '“Chưa giải thích được” là phần ổ báo là đang dùng mà không mục nào ở đây giải thích được: thư mục không tài khoản nào được mở, tệp xuất hiện hoặc biến mất trong lúc đang đọc ổ, và cấu trúc của hệ thống tệp mà Windows không báo ra.',

    'system.row.profile': 'Hồ sơ người dùng của bạn',
    'system.row.profile.what':
      'Mọi thứ trong thư mục người dùng của bạn: tài liệu, tệp tải về, dữ liệu ứng dụng, và phần OneDrive đang giữ trên máy này.',
    'system.row.profile.then': 'Dung lượng đĩa cho xem bên trong có gì, còn Nên xoá gì cho biết cái gì có thể bỏ.',
    'system.row.profileSkipped': 'Trong hồ sơ của bạn, nhưng các lần quét khác bỏ qua',
    'system.row.profileSkipped.what':
      'Các thư mục có tên bắt đầu bằng dấu chấm hoặc $, cùng node_modules, .git, .venv và __pycache__. Công cụ lập trình giữ cache, gói cài đặt và mô hình tải về ở đây.',
    'system.row.otherFolders': 'Thư mục khác ở gốc ổ',
    'system.row.otherFolders.what': 'Các thư mục được tạo thẳng ở gốc ổ, bởi chương trình hoặc bởi bạn.',
    'system.row.otherAccounts': 'Tài khoản khác và thư mục dùng chung',
    'system.row.otherAccounts.what': 'Hồ sơ của những người khác trên máy này, và các thư mục dùng chung Public và Default.',
    'system.row.recycleBin': 'Thùng rác',
    'system.row.recycleBin.what':
      'Các tệp đã xoá khỏi ổ này mà vẫn khôi phục được. Chưa phần nào trong đó là dung lượng trống cho tới khi dọn Thùng rác.',
    'system.row.recycleBin.app': '{size} trong số đó do ứng dụng này đưa vào; tab Khôi phục có thể trả chúng về chỗ cũ.',
    'system.row.programs': 'Chương trình đã cài',
    'system.row.programs.what': 'Program Files, Program Files (x86), và ứng dụng từ Microsoft Store.',
    'system.row.programs.then':
      'Gỡ cài đặt từ danh sách của chính Windows, để trình gỡ của từng chương trình xoá đúng những gì nó đã cài.',
    'system.row.programData': 'Dữ liệu dùng chung của chương trình',
    'system.row.programData.what': 'ProgramData: thiết lập, cache và cơ sở dữ liệu mà chương trình giữ cho mọi tài khoản.',
    'system.row.programData.then': 'Phần này thuộc về các chương trình; gỡ một chương trình mới là cách xoá phần của nó.',
    'system.row.windows': 'Windows',
    'system.row.windows.what': 'Phần còn lại của thư mục Windows: chính hệ điều hành, phông chữ, driver đang dùng, nhật ký.',
    'system.row.winsxs': 'Kho thành phần (WinSxS)',
    'system.row.winsxs.what':
      'Bản sao các thành phần của Windows, dùng để sửa và cập nhật nó. Phần lớn cũng nằm trong System32 dưới một tên thứ hai.',
    'system.row.winsxs.then':
      'Chỉ Windows mới nên dọn nó. Lệnh bên dưới yêu cầu Windows bỏ những gì đã được bản cập nhật thay thế; sau đó các bản cập nhật ấy không gỡ được nữa.',
    'system.row.driverStore': 'Kho driver',
    'system.row.driverStore.what': 'Mọi gói driver đã cài trên máy này, được giữ để cài lại cho thiết bị khi cần.',
    'system.row.driverStore.then': 'Xoá gói trong đây có thể khiến một thiết bị mất driver của nó.',
    'system.row.installer': 'Bộ đệm Windows Installer',
    'system.row.installer.what':
      'Bản sao gói cài đặt của các chương trình đã cài. Windows cần chúng để sửa hoặc gỡ những chương trình đó.',
    'system.row.installer.then': 'Đừng bao giờ tự tay xoá: chương trình tương ứng có thể không gỡ cài đặt được nữa.',
    'system.row.updateCache': 'Tệp tải về của Windows Update',
    'system.row.updateCache.what': 'Các tệp cập nhật Windows đã tải về, đã cài hoặc sắp cài.',
    'system.row.updateCache.then': 'Dọn dẹp ổ đĩa xoá những tệp không còn cần, trong mục “Clean up system files”.',
    'system.row.deliveryOptimization': 'Bộ đệm Delivery Optimization',
    'system.row.deliveryOptimization.what': 'Các mảnh bản cập nhật Windows giữ lại để chia sẻ với máy khác.',
    'system.row.deliveryOptimization.then': 'Trang thiết lập của nó có thể giới hạn và xoá bộ đệm này.',
    'system.row.windowsOld': 'Bản Windows trước',
    'system.row.windowsOld.what': 'Windows.old: bản Windows mà máy này đã nâng cấp lên từ đó.',
    'system.row.windowsOld.then': 'Khi đã xoá, bạn không quay lại bản đó được nữa.',
    'system.row.upgrade': 'Phần sót lại của nâng cấp và cài đặt',
    'system.row.upgrade.what': 'Các thư mục mà trình cài Windows và bản cập nhật để lại ở gốc ổ, như $WINDOWS.~BT và $WinREAgent.',
    'system.row.upgrade.then': 'Thiết lập Lưu trữ sẽ xoá chúng, trong mục tệp tạm, khi Windows không còn cần.',
    'system.row.recovery': 'Môi trường khôi phục',
    'system.row.recovery.what': 'Bộ công cụ Windows khởi động khi không thể khởi động bình thường.',
    'system.row.systemHidden': 'System Volume Information',
    'system.row.systemHidden.what': 'Một thư mục không tài khoản nào được mở, kể cả quản trị viên. Điểm khôi phục được giữ trong đó.',
    'system.row.hiberfil': 'Tệp ngủ đông',
    'system.row.hiberfil.what': 'Nơi Windows ghi bộ nhớ ra khi ngủ đông, và cũng là thứ khởi động nhanh sử dụng.',
    'system.row.hiberfil.then':
      'Tắt ngủ đông sẽ xoá tệp này, cùng với chế độ ngủ đông và khởi động nhanh. Kiểu thu gọn (reduced) giữ khởi động nhanh và làm tệp nhỏ lại. Cả hai đều cần dấu nhắc lệnh chạy với quyền quản trị.',
    'system.row.pagefile': 'Tệp hoán trang',
    'system.row.pagefile.what': 'Bộ nhớ Windows chuyển ra ổ đĩa khi RAM đầy.',
    'system.row.pagefile.then': 'Nên để Windows tự quyết kích thước; thiết lập nằm ở mục Virtual memory.',
    'system.row.swapfile': 'Tệp hoán đổi cho ứng dụng Store',
    'system.row.swapfile.what': 'Vùng hoán trang Windows giữ cho ứng dụng từ Microsoft Store. Tệp này luôn nhỏ.',
    'system.row.restorePoints': 'Điểm khôi phục',
    'system.row.restorePoints.what': 'Ảnh chụp tệp hệ thống mà Bảo vệ hệ thống giữ lại, để có thể đưa máy về trạng thái trước.',
    'system.row.restorePoints.then':
      'Bảo vệ hệ thống quy định chúng được dùng bao nhiêu chỗ, và có thể xoá chúng — sau đó máy không quay về các điểm ấy được nữa.',
    'system.row.reservedStorage': 'Dung lượng dành riêng',
    'system.row.reservedStorage.what': 'Chỗ Windows giữ lại để bản cập nhật cài được, hiện chưa tệp nào dùng tới.',
    'system.row.ntfsMetadata': 'Chỉ mục hệ thống tệp (MFT)',
    'system.row.ntfsMetadata.what': 'Bản ghi riêng của NTFS về mọi tệp và thư mục trên ổ. Nó lớn dần theo số tệp.',

    'system.handoff.powerOptions': 'Mở Tùy chọn nguồn',
    'system.handoff.virtualMemory': 'Mở Tùy chọn hiệu năng',
    'system.handoff.systemProtection': 'Mở Bảo vệ hệ thống',
    'system.handoff.diskCleanup': 'Mở Dọn dẹp ổ đĩa',
    'system.handoff.recycleBin': 'Mở Thùng rác',
    'system.handoff.storage': 'Mở thiết lập Lưu trữ',
    'system.handoff.deliveryOptimization': 'Mở Delivery Optimization',
    'system.handoff.apps': 'Mở Ứng dụng đã cài',
    'system.handoff.otherUsers': 'Mở thiết lập tài khoản',

    'evidence.system.unreadable': 'Windows có trả lời, nhưng không ở dạng ứng dụng đọc được, nên không hiện con số nào',
    'evidence.system.needsAdmin': 'Cần quyền quản trị để đo',
    'evidence.system.listing': 'Kích thước lấy từ danh sách thư mục: Windows luôn mở tệp này, nên không đo được theo cách khác',
    'evidence.system.vss': 'Theo vssadmin của Windows: đang dùng {used}, đã cấp {allocated}, tối đa {maximum}',
    'evidence.system.mft': 'Chỉ mục riêng của hệ thống tệp cho mọi tệp và thư mục, theo fsutil',
    'evidence.system.reserve': 'Chỗ Windows giữ lại cho bản cập nhật mà chưa tệp nào dùng, theo fsutil',
    'evidence.system.dism': 'Theo DISM: {actual}, trong đó {shared} dùng chung với Windows và {backups} là bản sao lưu và tính năng đã tắt',
    'evidence.system.dismRecommends': 'DISM khuyên nên dọn',
    'evidence.system.walked': 'Đo bằng cách đọc mọi thư mục bên trong: {files} tệp, mỗi tệp chỉ đếm một lần dù có bao nhiêu tên',
    'evidence.system.elevated': 'Gồm cả các thư mục chỉ quản trị viên đọc được, đo khi bạn cho phép',
    'evidence.system.partial': '{n} thư mục bên trong không đọc được, nên dung lượng ít nhất là bấy nhiêu',
    'evidence.system.winsxsWalk':
      'Tệp ở đây mà cũng thuộc Windows chỉ được đếm một lần, ở chỗ gặp trước; DISM cho con số chính xác khi có quyền quản trị',
    'evidence.system.skipped':
      'Các thư mục mà màn hình khác bỏ qua: tên bắt đầu bằng dấu chấm hoặc $, cùng node_modules, .git, .venv, __pycache__',
    'evidence.system.appBin': '{size} trong số này do ứng dụng đưa vào, và có thể khôi phục từ tab Khôi phục',

    'dialog.restore.title': 'Khôi phục từ Thùng rác',
    'dialog.restore.message': 'Khôi phục {n} mục từ Thùng rác?',
    'dialog.restore.detail': '{size} sẽ trở về đúng chỗ đã bị xoá.',
    'dialog.restore.refused':
      '{n} mục trong số đã chọn không khôi phục được — chúng không còn trong Thùng rác, hoặc ổ đĩa đang không kết nối.',
    'dialog.restore.conflicts': '{n} mục trong số này hiện đang có thứ khác nằm ở đường dẫn cũ.',
    'dialog.restore.conflictsHow':
      '“Giữ cả hai” đặt tệp được khôi phục ngay bên cạnh, tên có thêm “(đã khôi phục)”. “Thay thế” chuyển ' +
      'tệp đang nằm ở đó vào Thùng rác trước, nên tệp đó cũng khôi phục lại được.',
    'dialog.restore.keepBoth': 'Khôi phục, giữ cả hai',
    'dialog.restore.skip': 'Khôi phục, bỏ qua các mục đó',
    'dialog.restore.replace': 'Khôi phục, thay thế',
    'dialog.restore.go': 'Khôi phục',
    'dialog.restore.titleAny': 'Khôi phục',
    'dialog.restore.messageAny': 'Đưa {n} mục về đúng chỗ cũ?',
    'dialog.restore.fromQuarantine':
      '{n} mục trong số đó trở về từ thư mục cách ly: từng tệp được chép ngược lại, đối chiếu với bản đã chép ' +
      'lúc cách ly, rồi mới được gỡ khỏi thư mục đó. Chúng cần có chỗ trống trên ổ mà chúng trở về.',

    /* ---- ảnh giống nhau, và màn so sánh (E1) ---------------------------- */
    'similar.title': 'Ảnh trông giống nhau',
    'similar.total': '{n} nhóm · {size} nếu chỉ giữ một ảnh mỗi nhóm',
    'similar.none': 'chưa tìm thấy nhóm nào',
    'similar.looked': 'Đã xem {done} trong {total} ảnh.',
    'similar.cloud': '{n} ảnh chỉ có trên mây nên không được xét — mở một tấm là tải nó về.',
    'similar.measure': 'Xem nốt {n} ảnh còn lại',
    'similar.measureHint': 'Khoảng {duration}. Chỉ tốn một lần — kết quả đo được giữ lại.',
    'similar.progress': '{done} / {total}',
    'similar.finished': 'Đã xem {n} ảnh trong {duration}.',
    'similar.already': 'Mọi ảnh đều đã được xem rồi — không còn gì để làm.',
    'similar.stopped': 'Đã dừng sau khi xem {n} ảnh — phần đã đo vẫn được giữ.',
    'similar.group': '{n} ảnh · {size} nằm ở các bản trùng',
    'similar.identical': 'giống nhau tới mức không phân biệt được',
    'similar.close': 'lệch nhau {n} trên 64',
    'similar.open': 'So sánh',
    'similar.gone': 'Những tệp đó không còn trong danh sách.',
    'similar.showAll': 'Xem cả {n} nhóm',
    'similar.showFewer': 'Thu gọn',
    'similar.emptyDone': 'Đã xem hết ảnh, và không có hai tấm nào là cùng một ảnh.',
    'similar.emptyYet': 'Chưa có gì. Cuộn lưới ảnh, hoặc xem nốt phần còn lại, tấm nào trùng sẽ hiện ở đây.',

    'compare.title': 'Ảnh đặt cạnh nhau',
    'compare.label': 'So sánh',
    'compare.heading': '{n} ảnh đặt cạnh nhau',
    'compare.ofGroups': 'Nhóm {i} / {total} · lệch nhau {spread} trên 64',
    'compare.ownPick': 'Những tấm bạn đã tick',
    'compare.flicker': 'Lật qua lại hai ảnh',
    'compare.flicking': 'Đang lật giữa 1 và 2 — đang hiện {name}',
    'compare.reset': 'Vừa khung',
    'compare.prev': 'Nhóm trước',
    'compare.next': 'Nhóm sau',
    'compare.needTwo': 'Hãy chọn ít nhất hai ảnh để so sánh.',
    'compare.groupGone': 'Nhóm đó không còn trong danh sách.',
    'compare.unreadable': 'Không đọc được',
    'compare.hint':
      'Lăn chuột để phóng to, kéo để di chuyển — mọi ảnh cùng phóng và cùng di. Phím 1–4 tick một ảnh, ← và → đổi nhóm.',
    'compare.note':
      'Ô được tô là giá trị nổi bật — lớn nhất, riêng ISO là nhỏ nhất. Đó không phải lời khuyên, ' +
      'và thứ tự các ảnh chỉ là gợi ý chứ không phải lựa chọn thay bạn.',
    'compare.row.dimensions': 'Kích thước',
    'compare.row.megapixels': 'Megapixel',
    'compare.underTenth': 'dưới 0,1',
    'compare.row.size': 'Dung lượng',
    'compare.row.detail': 'Chi tiết',
    'compare.row.taken': 'Chụp lúc',
    'compare.row.camera': 'Máy ảnh',
    'compare.row.iso': 'ISO',
    'compare.row.shutter': 'Tốc độ',
    'preview.error.compareCount': 'Chỉ so sánh được từ 2 tới {n} tệp một lúc',

    /* ---- sao lưu trước khi xoá (E2) ------------------------------------- */
    'media.backup.label': 'Sao lưu trước khi xoá',
    'media.backup.off': 'Sao lưu trước khi xoá…',
    'media.backup.offHint': 'Chép từng tệp sang nơi khác và kiểm tra bản chép, trước khi tệp vào Thùng rác',
    'media.backup.on': 'Đang sao lưu sang {dest}',
    'media.backup.paused': 'Không sao lưu sang {dest}',
    'media.backup.change': 'Đổi thư mục',
    'media.backup.set': 'Bản chép sẽ nằm ở {dest}, và từng bản được kiểm tra trước khi bản gốc bị xoá.',
    'dialog.chooseBackup': 'Chọn nơi chứa bản chép trước khi xoá',
    'backup.refuse.write': 'Không ghi được gì vào thư mục đó: {reason}',
    'backup.progressTitle': 'Đang chép và kiểm tra từng bản chép trước khi xoá bất cứ thứ gì',
    'backup.error.path': 'Không phải đường dẫn sao lưu được',
    'backup.error.names': 'Đã có quá nhiều tệp trùng tên này ở đó',
    'backup.error.length': 'Bản chép có độ dài khác bản gốc',
    'backup.error.hash': 'Bản chép không khớp với bản gốc',
    'backup.error.manifestName': 'Không còn tên trống cho tệp manifest',
    'backup.error.manifest': 'Đã chép xong, nhưng không ghi được danh sách những gì đã chép: {reason}',
    'delete.backedUp': 'đã chép {n} tệp sang {dest} và kiểm tra trước',
    'delete.backupFailed': 'giữ nguyên {n} tệp — bản chép không kiểm chứng được',
    'dialog.confirmDelete.backupCheck': 'Sao lưu sang {dest} trước',
    'dialog.confirmDelete.backup':
      'Mỗi tệp được chép sang {dest}, đọc lại và đối chiếu với bản gốc (SHA-256) trước khi vào Thùng rác, ' +
      'và tệp manifest.json ở đó liệt kê những gì đã chép. Tệp nào có bản chép không khớp thì được giữ nguyên ' +
      'tại chỗ và được nêu tên trong thông báo kết quả. Bỏ chọn ô bên dưới để xoá mà không chép.',

    /* ---- chuyển sang ổ khác (cách ly, B1) ------------------------------- */
    'quarantine.label': 'Chuyển sang ổ khác',
    'quarantine.go': 'Chuyển sang {drive}',
    'quarantine.goNowhere': 'Chuyển sang ổ khác',
    'quarantine.chooseFirst': 'Hãy chọn nơi chứa tệp được chuyển trước — trong Cài đặt, mục “Chuyển sang ổ khác”.',
    'quarantine.checking': 'Đang kiểm tra những gì chuyển được',
    'quarantine.progressTitle': 'Đang chép sang {drive} và kiểm tra từng bản chép',
    'quarantine.rate': '{size}/giây',
    'quarantine.done': 'Đã chuyển {n} {items} ({size}) sang {drive}, từng bản chép đã được kiểm tra — {originals}',
    'quarantine.freed': 'bản gốc đã bị xoá, giải phóng {size}',
    'quarantine.inBin': 'bản gốc nằm trong Thùng rác, chưa giải phóng cho tới khi dọn Thùng rác',
    'quarantine.skipped': '{n} mục giữ nguyên chỗ cũ',
    'quarantine.stopped': 'Đã dừng. {n} {items} ({size}) đã nằm trên {drive} — {originals} · {left} mục giữ nguyên chỗ cũ.',
    'quarantine.cancelled': 'Đã huỷ — không có gì được chuyển.',
    'quarantine.nothing': 'Không có gì được chuyển. {reason}',
    'quarantine.type.fixed': 'ổ cố định',
    'quarantine.type.removable': 'ổ rời',

    'quarantine.why.none': 'Chưa có thư mục cách ly — hãy chọn một thư mục trong Cài đặt',
    'quarantine.why.unavailable': 'Ổ chứa thư mục cách ly đang không kết nối',
    'quarantine.why.missing': 'Thư mục cách ly không còn nữa',
    'quarantine.why.moved': 'Thư mục cách ly đã bị biến thành liên kết trỏ đi nơi khác, nên không được dùng',
    'quarantine.why.notAZone': 'Thư mục đó không phải thư mục cách ly của CleanDrive',
    'quarantine.why.network': 'Không thể đặt thư mục cách ly trên ổ mạng',
    'quarantine.why.synced': 'Không được đặt thư mục cách ly bên trong thư mục đồng bộ với dịch vụ đám mây',
    'quarantine.why.place': 'Thư mục cách ly nằm ở chỗ ứng dụng không ghi vào',
    'quarantine.why.sameVolume': 'Đã nằm trên ổ chứa thư mục cách ly — chuyển sang đó không giải phóng được gì',
    'quarantine.why.inZone': 'Đã nằm trong thư mục cách ly',
    'quarantine.why.link': 'Là liên kết, không phải tệp',
    'quarantine.why.onlineOnly': 'Chỉ nằm trên đám mây — ổ này không có gì để giải phóng',
    'quarantine.why.full': 'Không đủ chỗ trên {drive} cho tất cả, cộng dư ra một gigabyte',
    'quarantine.why.overLimit': 'Sẽ vượt quá dung lượng đã đặt cho thư mục cách ly trong Cài đặt',
    'quarantine.why.changed': 'Tệp đã thay đổi trong lúc chép hoặc kể từ lúc được chọn, nên được giữ nguyên',
    'quarantine.why.hash': 'Bản chép không khớp với bản gốc, nên bản gốc được giữ nguyên',
    'quarantine.why.lost': 'Ổ cách ly không còn phản hồi, nên phần còn lại được giữ nguyên',
    'quarantine.why.fullNow': 'Ổ cách ly đã đầy, nên phần còn lại được giữ nguyên',
    'quarantine.why.stuck': 'Đã chép, nhưng không chuyển được bản gốc vào Thùng rác, nên bản chép đã được gỡ ra',
    'quarantine.why.copyFailed': 'Không chép được tệp',

    'frees.quarantineBin': 'Bản gốc vào Thùng rác — chưa giải phóng',
    'frees.quarantineBinHint':
      'Bản chép sang ổ kia, bản gốc vào Thùng rác, mà Thùng rác nằm cùng ổ với bản gốc — nên chưa giải phóng gì ' +
      'cho tới khi dọn Thùng rác.',
    'frees.quarantineYes': 'Giải phóng dung lượng — bản gốc bị xoá',
    'frees.quarantineYesHint': 'Mỗi bản gốc bị xoá sau khi bản chép của nó trên ổ kia được kiểm tra; bản chép đó khi ấy là bản duy nhất.',

    'dialog.chooseQuarantine': 'Chọn nơi chứa tệp được chuyển — trên một ổ khác với ổ bạn muốn giải phóng',
    'dialog.quarantine.title': 'Chuyển sang ổ khác',
    'dialog.quarantine.message': 'Chuyển {n} mục sang {drive}?',
    'dialog.quarantine.go': 'Chuyển sang {drive}',
    'dialog.quarantine.copy':
      '{size} sẽ được chép sang {zone}. Mỗi bản chép được đọc lại và đối chiếu với bản gốc (SHA-256) trước khi ' +
      'bản gốc bị đụng tới.',
    'dialog.quarantine.bin':
      'Sau đó mỗi bản gốc vào Thùng rác, mà Thùng rác nằm cùng ổ với bản gốc — nên trên ổ đó chưa giải phóng gì ' +
      'cho tới khi dọn Thùng rác. Bật “Xoá bản gốc” trong Cài đặt để giải phóng ngay thay vì vậy.',
    'dialog.quarantine.deleteOriginal':
      'Sau đó mỗi bản gốc bị xoá khỏi ổ của nó — không vào Thùng rác. Bản chép trên {drive} là bản duy nhất còn ' +
      'lại. Thao tác này giải phóng {size}.',
    'dialog.quarantine.removable':
      '{drive} là ổ rời. Nếu ổ bị mất hoặc bị rút ra, các bản chép trên đó cũng mất theo — và khi bản gốc không ' +
      'còn, đó là bản duy nhất.',
    'dialog.quarantine.synced':
      '{n} mục trong số này đang đồng bộ với OneDrive. Gỡ chúng khỏi thư mục này là gỡ chúng khỏi OneDrive trên ' +
      'mọi thiết bị. “Chỉ giữ trên đám mây”, trong Nên xoá gì, giải phóng dung lượng của chúng mà không xoá gì.',
    'dialog.quarantine.unsynced':
      '{n} mục trong số này nằm trong OneDrive nhưng chưa đồng bộ: OneDrive chưa tải chúng lên, hoặc chưa tải ' +
      'những thay đổi mới nhất. Bản chép trên {drive} là bản đầy đủ duy nhất, và OneDrive sẽ gỡ mọi bản cũ hơn ' +
      'nó đang giữ vào lần chạy tới.',
    'dialog.quarantine.otherCloud':
      '{n} mục trong số này nằm trong thư mục đồng bộ với một dịch vụ đám mây, và ứng dụng không biết dịch vụ ' +
      'đó có giữ chúng hay không. Gỡ chúng khỏi thư mục có thể gỡ chúng trên mọi thiết bị đồng bộ thư mục đó.',
    'dialog.quarantine.kept':
      'Chúng nằm ở đó cho tới khi bạn đưa về từ Khôi phục, hoặc tự xoá. Sau {days} ngày ứng dụng sẽ nhắc là ' +
      'chúng vẫn còn đó; ứng dụng không bao giờ xoá chúng.',
    'dialog.quarantine.sameVolume': '{n} mục đã nằm trên {drive}.',
    'dialog.quarantine.onlineOnly': '{n} mục chỉ nằm trên đám mây, ổ này không có gì để giải phóng.',
    'dialog.quarantine.refused': '{n} mục khác được giữ nguyên chỗ cũ; lý do được liệt kê sau khi xong.',

    'notify.quarantine.title': 'CleanDrive: vẫn còn tệp trong thư mục cách ly',
    'notify.quarantine.body':
      '{n} tệp đã nằm trong thư mục cách ly quá {days} ngày. Không có gì bị xoá — chúng được liệt kê trong Khôi phục.',

    'settings.quarantine.title': 'Chuyển sang ổ khác',
    'settings.quarantine.note':
      'Dành cho những tệp bạn có thể muốn lấy lại nhưng không cần nằm trên ổ này. Mỗi tệp được chép sang một thư ' +
      'mục trên ổ khác, và bản chép được kiểm tra trước khi bản gốc bị đụng tới. Đưa chúng về từ Khôi phục; ứng ' +
      'dụng không bao giờ xoá chúng ở đó.',
    'settings.quarantine.choose': 'Chọn thư mục…',
    'settings.quarantine.change': 'Đổi thư mục…',
    'settings.quarantine.open': 'Mở trong Explorer',
    'settings.quarantine.days': 'Số ngày trước khi ứng dụng nhắc là chúng vẫn còn đó',
    'settings.quarantine.max': 'Dung lượng tối đa của thư mục, tính bằng GB (0 = không giới hạn)',
    'settings.quarantine.deleteOriginal': 'Xoá bản gốc khi bản chép đã được kiểm tra',
    'settings.quarantine.deleteOriginalNote':
      'Tắt: bản gốc vào Thùng rác — không mất gì, và chưa giải phóng gì cho tới khi dọn Thùng rác. Bật: dung ' +
      'lượng trở lại ngay — và bản chép trên ổ kia là bản duy nhất còn lại.',
    'settings.quarantine.none': 'Chưa chọn thư mục. Hãy chọn một thư mục trên ổ khác với ổ bạn muốn giải phóng.',
    'settings.quarantine.folder': 'Thư mục',
    'settings.quarantine.drive': 'Ổ đĩa',
    'settings.quarantine.driveValue': '{drive} · {type} · còn trống {free}',
    'settings.quarantine.holds': 'Đang chứa',
    'settings.quarantine.holdsValue': '{n} {files} · {size}',
    'settings.quarantine.systemDrive':
      'Thư mục này nằm trên {drive}, ổ cài Windows. Tệp từ {drive} không chuyển vào đây được — làm vậy không ' +
      'giải phóng được gì.',
    'settings.quarantine.removable': '{drive} là ổ rời. Nếu ổ bị mất, các bản chép trên đó cũng mất theo.',
    'settings.quarantine.expired':
      '{n} tệp đã nằm ở đó quá {days} ngày. Không có gì bị xoá — chúng được liệt kê trong Khôi phục.',
    'settings.quarantine.chosen': 'Tệp chuyển sang ổ khác sẽ nằm trong {zone}',

    'restore.title.quarantine': 'Đã chuyển {n} {items} sang {drive}',
    'restore.title.quarantineAnywhere': 'Đã chuyển {n} {items} sang ổ khác',
    'restore.tally.inQuarantine': '{n} mục vẫn nằm trong thư mục cách ly',
    'restore.tally.goneZone': '{n} mục không còn trong thư mục cách ly',
    'restore.tally.expired': '{n} mục đã nằm quá số ngày đặt trong Cài đặt',
    'restore.state.inQuarantine': 'đang cách ly',
    'restore.state.goneZone': 'không còn trong thư mục',
    'restore.row.inQuarantine': 'Đã chép sang {path} {when}, và bản chép đã được đối chiếu với bản gốc',
    'restore.row.expired': 'đã nằm quá số ngày đặt trong Cài đặt',
    'restore.row.unavailableZone': 'Ổ chứa thư mục cách ly đang không kết nối, nên không kiểm được bản chép',
    'restore.row.goneZone': 'Không còn trong thư mục cách ly — đã bị gỡ ra ngoài ứng dụng này',
    'restore.quarantineNote':
      'Bản gốc đã vào Thùng rác. Khôi phục sẽ chép từng tệp ngược lại từ thư mục cách ly và kiểm tra nó; bản gốc ' +
      'còn trong Thùng rác vẫn nằm yên ở đó.',
    'restore.quarantineDeleted':
      'Bản gốc đã bị xoá sau khi bản chép được kiểm tra, giải phóng {size}. Khôi phục sẽ chép từng tệp ngược lại và kiểm tra nó.',
    'restore.progressTitleAny': 'Đang khôi phục',
    'restore.why.goneZone': 'Không còn trong thư mục cách ly',
    'restore.why.unavailableZone': 'Ổ chứa thư mục cách ly đang không kết nối',
    'restore.why.hash': 'Bản chép không còn khớp với bản đã cách ly, nên không được khôi phục',

    /* ---- accessibility (I2) ---- */
    'progress.scan': 'Đang quét',
    'progress.system': 'Đang đọc ổ đĩa',
    'progress.media': 'Đang xem các thư mục ảnh',
    'progress.dupes': 'Đang tìm bản trùng',
    'progress.auto': 'Đang dọn dẹp',
    'progress.update': 'Đang tải bản cập nhật',
    'auto.skipInput': 'Tên tiến trình cần thêm',
    'list.ticked': 'đã đánh dấu',
    'list.notTicked': 'chưa đánh dấu',
    'media.photoShort': 'ảnh',
    'trends.chartSummary':
      'Dung lượng đã dùng theo thời gian: {from} ngày {fromDay}, {to} ngày {toDay}. Các lần đo nằm trong bảng ngay sau.',
    'trends.table.caption': 'Các lần đo dung lượng ổ đĩa, {n} lần',
    'trends.table.captionSome': 'Các lần đo dung lượng ổ đĩa: {n} lần mới nhất trong {total}',
    'trends.table.when': 'Lúc',
    'trends.table.used': 'Tỷ lệ đã dùng',
    'trends.table.usedBytes': 'Đã dùng',
    'trends.table.free': 'Còn trống',

    'keys.title': 'Phím tắt',
    'keys.anywhere': 'Ở mọi nơi',
    'keys.help': 'Danh sách này',
    'keys.tab': 'Tới nút hoặc ô tiếp theo, hoặc lùi lại',
    'keys.escape': 'Đóng phần xem tệp, menu hoặc danh sách này',
    'keys.sidebar': 'Thanh bên',
    'keys.sidebar.move': 'Màn trước hoặc màn sau — màn đó mở ngay khi di chuyển',
    'keys.sidebar.ends': 'Màn đầu tiên hoặc cuối cùng',
    'keys.resizer.width': 'Ở mép thanh bên: hẹp lại hoặc rộng ra (giữ Shift để bước dài hơn)',
    'keys.resizer.toggle': 'Ở mép thanh bên: ẩn đi hoặc hiện lại',
    'keys.lists': 'Danh sách tệp',
    'keys.lists.move': 'Dòng trước hoặc dòng sau',
    'keys.lists.extend': 'Đánh dấu từng dòng đi qua',
    'keys.lists.tick': 'Đánh dấu hoặc bỏ đánh dấu dòng',
    'keys.lists.view': 'Xem tệp ngay trong app',
    'keys.lists.buttons': 'Các nút của dòng: lý do, Xem, Mở thư mục chứa, Mở',
    'keys.map': 'Bản đồ thư mục',
    'keys.map.siblings': 'Ô trước hoặc ô sau ở cùng cấp',
    'keys.map.in': 'Vào trong một thư mục',
    'keys.map.out': 'Ra thư mục bao quanh',
    'keys.map.open': 'Mở thư mục, hoặc xem tệp',
    'keys.map.tick': 'Đánh dấu tệp',
    'keys.map.up': 'Lên một thư mục',
    'keys.map.menu': 'Menu của ô',
    'keys.grid': 'Ảnh & video',
    'keys.grid.move': 'Di chuyển giữa các ảnh',
    'keys.grid.ends': 'Ảnh đầu tiên hoặc cuối cùng',
    'keys.grid.tick': 'Đánh dấu hoặc bỏ đánh dấu ảnh',
    'keys.grid.clear': 'Bỏ chọn tất cả và đóng phần chi tiết',
    'settings.keys.title': 'Bàn phím',
    'settings.keys.note':
      'Mọi nút và ô đều tới được bằng Tab. Danh sách, bản đồ thư mục và lưới ảnh di chuyển bằng phím mũi tên, ' +
      'Space để đánh dấu. Nhấn ? ở bất kỳ đâu ngoài ô nhập chữ để xem toàn bộ danh sách.',
    'settings.keys.open': 'Xem phím tắt',

    'app.theme.custom': 'Tuỳ chỉnh',
    'settings.appearance.contrastNote':
      'Khi Windows bật theme tương phản, app dùng màu của Windows — trừ khi chọn Tuỳ chỉnh: màu của riêng bạn ' +
      'vẫn được dùng cả khi đó.',
    'custom.title': 'Màu của riêng bạn',
    'custom.note':
      'Chọn mười một màu, hoặc nhập một tệp theme người khác làm. Mỗi thay đổi được kiểm độ tương phản ngay lúc ' +
      'bạn đổi, và các màu chỉ dùng được khi mọi phép kiểm đều đạt. Khi đang chọn Tuỳ chỉnh, các màu này được ' +
      'dùng cả khi Windows bật theme tương phản.',
    'custom.name': 'Tên',
    'custom.base': 'Dựa trên',
    'custom.reset': 'Làm lại từ màu gốc',
    'custom.import': 'Nhập…',
    'custom.export': 'Xuất…',
    'custom.use': 'Dùng các màu này',
    'custom.forget': 'Bỏ màu của tôi',
    'custom.useHint': 'Màu của riêng bạn: {name}',
    'custom.noneHint': 'Hãy tạo màu của riêng bạn ở thẻ bên dưới trước.',
    'custom.preview.title': 'Tệp cài đặt',
    'custom.preview.second': 'Một bộ cài đã 90 ngày',
    'custom.preview.quiet': 'Sửa 3 tháng trước',
    'custom.preview.safe': 'an toàn',
    'custom.preview.review': 'nên xem lại',
    'custom.preview.danger': 'đang dùng',
    'custom.preview.field': '100 KB',
    'custom.preview.button': 'Quét thư mục',
    'custom.hexLabel': '{name}, viết dạng #rrggbb',
    'custom.rowFails': '{n} chỗ cần sửa',
    'custom.rowOk': 'đạt',
    'custom.allPass': 'Cả {n} phép kiểm đều đạt.',
    'custom.someFail': '{fail} trong {n} phép kiểm chưa đạt, nên chưa dùng được các màu này:',
    'custom.state.inUse': 'Đang dùng',
    'custom.state.saved': 'Đã lưu, chưa dùng',
    'custom.state.changed': 'Đã sửa, chưa dùng',
    'custom.state.none': 'Chưa lưu',
    'custom.resetDone': 'Đã quay về màu {base} có sẵn.',
    'custom.importRefused': 'Không nhận tệp đó: {why}',
    'custom.imported': 'Đã đọc {file}.',
    'custom.importFilled': 'Tệp thiếu {n} màu; các màu đó lấy từ theme {base} có sẵn.',
    'custom.importReady': 'Chưa có gì được dùng cho tới khi bạn bấm Dùng các màu này.',
    'custom.exported': 'Đã lưu các màu này thành {file}.',
    'custom.refusedByApp': 'App không nhận các màu này: {why}',
    'custom.used': 'Đang dùng các màu này.',
    'custom.forgotten': 'Đã bỏ. Các màu vẫn còn ở đây tới khi đóng app; bấm Dùng các màu này để giữ lại.',
    'theme.defaultName': 'Màu của tôi',
    'theme.noCustom': 'Chưa lưu màu của riêng bạn.',
    'dialog.importTheme': 'Chọn một tệp theme của CleanDrive',
    'dialog.exportTheme': 'Lưu các màu này thành tệp theme',
    'dialog.themeFiles': 'Theme CleanDrive',

    'theme.err.notObject': 'Đây không phải là theme: theme phải là một đối tượng JSON.',
    'theme.err.notFile': 'Đó không phải là một tệp.',
    'theme.err.unknownField': 'Trường không biết: “{key}”.',
    'theme.err.format': 'Tệp không ghi mình là theme của CleanDrive ("format": "{format}").',
    'theme.err.version': 'Phiên bản theme {got} không phải phiên bản bản này đọc được (bản này đọc {want}).',
    'theme.err.base': '"base" phải là "light" hoặc "dark".',
    'theme.err.name': '"name" phải là chữ.',
    'theme.err.colors': '"colors" phải là một đối tượng chứa các màu.',
    'theme.err.unknownColor': 'Màu không biết: “{key}”. Các màu một theme đặt được là: {keys}.',
    'theme.err.hex': '“{key}” phải là một màu viết dạng #rrggbb.',
    'theme.err.size': 'Tệp nặng {size} KB; một theme tối đa {max} KB.',
    'theme.err.json': 'Tệp không phải JSON hợp lệ.',
    'theme.rule.contrast': '{fg} trên {bg}: {value}:1, tối thiểu là {min}:1.',
    'theme.rule.distinct': '{a} và {b} trông quá giống nhau: cách nhau {value}, tối thiểu là {min}.',
    'theme.key.background': 'Nền trang',
    'theme.key.surface': 'Thẻ',
    'theme.key.border': 'Viền của ô nhập và ô đánh dấu',
    'theme.key.text': 'Chữ',
    'theme.key.textSecondary': 'Chữ phụ',
    'theme.key.textTertiary': 'Chữ mờ',
    'theme.key.accent': 'Màu nhấn',
    'theme.key.onAccent': 'Chữ trên màu nhấn',
    'theme.key.good': 'An toàn (mặc định là xanh lá)',
    'theme.key.warn': 'Nên xem lại (mặc định là vàng)',
    'theme.key.danger': 'Nguy hiểm (mặc định là đỏ)',
    'theme.key.surface2': 'Nền nổi',
    'theme.key.surface3': 'Nền khi trỏ chuột',
    'theme.key.accentHover': 'Màu nhấn khi bấm',
    'theme.key.goodSoft': 'Nền của nhãn an toàn',
    'theme.key.warnSoft': 'Nền của nhãn nên xem lại',
    'theme.key.dangerSoft': 'Nền của nhãn nguy hiểm',

    /* ---- the introduction (I4) ---- */
    'intro.skip': 'Bỏ qua',
    'intro.back': 'Quay lại',
    'intro.next': 'Tiếp',
    'intro.done': 'Xong',
    'intro.step': 'Bước {n}/{total}',
    'intro.again': 'Xem lại phần giới thiệu',
    'intro.1.title': 'CleanDrive cho bạn thấy, rồi để bạn quyết định',
    'intro.1.text':
      'Mỗi tệp app có nhận xét đều đi kèm nhận xét đó, lý do, và mức chắc chắn — chắc chắn, căn cứ vững, ' +
      'nhiều khả năng hay chỉ là phỏng đoán. Không có gì được đánh dấu sẵn, và không có gì bị chuyển đi cho tới ' +
      'khi bạn bấm nút và xác nhận.',
    'intro.1.rowMeta': 'Sửa 3 tháng trước · Bộ cài đã tải về 3 tháng trước',
    'intro.1.badge': 'nên xem lại · nhiều khả năng',
    'intro.1.why1': 'Tên và kích thước của nó là của một bộ cài',
    'intro.1.why2': 'Nó đã nằm trong Tải xuống ba tháng',
    'intro.1.caption': 'Một dòng đúng như app vẽ: verdict, mức chắc chắn, và lý do. Bấm vào nhãn để mở phần lý do.',
    'intro.2.title': 'Vào Thùng rác không có nghĩa là đã giải phóng',
    'intro.2.text':
      'Thùng rác nằm trên cùng ổ đĩa. Tệp chuyển vào đó vẫn chiếm chỗ cho tới khi dọn Thùng rác, nên app không ' +
      'bao giờ cộng “đã chuyển” với “đã giải phóng”: nút nào cũng nói nó có giải phóng gì không, và biên lai sau ' +
      'đó nói đó là loại nào.',
    'intro.2.moved': 'Đã chuyển vào Thùng rác',
    'intro.2.movedNote': 'Ổ C: vẫn đầy y như trước',
    'intro.2.emptied': 'Đã dọn Thùng rác',
    'intro.2.emptiedNote': 'Lúc này dung lượng mới trở lại',
    'intro.2.caption': 'Đây là hình minh hoạ, không phải ổ của bạn. Cạnh mỗi nút, app ghi rõ nút đó thuộc loại nào:',
    'intro.3.title': 'Chọn thư mục đầu tiên',
    'intro.3.text':
      'Quét chỉ đọc. Chọn một thư mục để xem — việc quét bắt đầu khi bạn bấm Quét thư mục — hoặc mở màn Hệ thống ' +
      'để xem cả ổ đã đi đâu.',
    'intro.3.system': 'Xem cả ổ đã đi đâu',

    /* ---- nhập bản trùng thành một tệp (F4) ------------------------------ */

    'developer.title': 'Nhà phát triển',
    'developer.note':
      'Những thứ hữu ích nếu bạn biết rõ nó làm gì, và phiền phức nếu không. Mọi mục ở đây đều tắt cho tới ' +
      'khi bạn tự bật.',
    'developer.hardlink.enable': 'Cho phép nhập các bản trùng thành một tệp',
    'developer.hardlink.note':
      'Thêm một nút thứ ba vào màn Trùng lặp. Nó biến các bản bạn chọn thành những cái tên khác của cùng một ' +
      'tệp, nên đĩa chỉ còn giữ nội dung một lần. Không xoá gì cả và mọi đường dẫn vẫn dùng được. Nhưng sửa ' +
      'qua một tên là sửa tất cả, và xoá một bản không giải phóng gì cho tới khi xoá hết. Chỉ làm được giữa ' +
      'các bản trên cùng một ổ NTFS, và bỏ qua tài liệu, tệp trong thư mục đồng bộ, tệp do màn Ảnh quản lý.',
    'developer.hardlink.on': 'Đang bật. Màn Trùng lặp có nút “Nhập thành một tệp”.',
    'developer.hardlink.off': 'Đang tắt. Không gì trên màn Trùng lặp nhập được.',

    'hardlink.button': 'Nhập thành một tệp',
    'hardlink.checking': 'Đang kiểm tra bản nào nhập được',
    'hardlink.joining': 'Đang nhập các bản thành một tệp',
    'hardlink.done': 'Đã nhập {n} {items} · giải phóng {size}. Hoàn tác ở Trung tâm khôi phục.',
    'hardlink.noneJoined': 'Không nhập được gì.',
    'hardlink.noneEligible': 'Không bản nào trong số đó nhập được. Không có gì thay đổi.',
    'hardlink.allAlready': 'Các bản đó vốn đã là một tệp — không có gì để nhập.',
    'hardlink.off':
      'Chức năng nhập bản trùng thành một tệp đang tắt. Cài đặt → Nhà phát triển → “Cho phép nhập các bản ' +
      'trùng thành một tệp”.',

    'hardlink.dialog.title': 'Nhập các bản này thành một tệp?',
    'hardlink.dialog.lead': 'Có {n} bản trong số bạn chọn nhập được, giải phóng {size}. Đọc hết để tiếp tục.',
    'hardlink.dialog.go': 'Nhập {n} bản thành một tệp',
    'hardlink.dialog.warn':
      'Sau việc này, các bản là cùng một tệp. Sửa một bản là sửa tất cả. Xoá một bản không giải phóng dung ' +
      'lượng nào cho tới khi xoá hết.',
    'hardlink.dialog.what':
      'Không xoá gì và không di chuyển gì. Mỗi bản bạn chọn thôi là một tệp riêng và trở thành một cái tên ' +
      'khác của bản được giữ. Mọi đường dẫn vẫn chạy, và mọi chương trình mở nó vẫn thấy đúng thứ trước đây.',
    'hardlink.dialog.measured':
      'Có đúng một cách việc này hỏng một cách âm thầm, và nó đã được đo trên chính máy này chứ không phải ' +
      'phỏng đoán. Một số chương trình lưu tệp bằng cách ghi một tệp mới đè lên tệp cũ thay vì ghi vào tệp ' +
      'đang có. Word và Excel đều vậy. Khi đó liên kết lặng lẽ đứt: bản bạn vừa lưu giữ thay đổi của bạn, ' +
      'các tên còn lại đứng nguyên ở nội dung cũ, và dung lượng quay lại mà không có gì báo. Tài liệu bị bỏ ' +
      'qua vì lý do đó — nhưng app không thể biết mọi chương trình trên máy bạn lưu kiểu gì, nên đây là một ' +
      'giới hạn thật chứ không phải chuyện đã giải quyết xong.',
    'hardlink.dialog.skipped':
      'Cũng bị bỏ qua: bản nằm trên ổ khác, ổ không phải NTFS, thứ nằm trong OneDrive hay thư mục đồng bộ ' +
      'khác, và thứ nằm trong các thư mục do màn Ảnh quản lý.',
    'hardlink.dialog.undo':
      'Bạn hoàn tác được ở Trung tâm khôi phục: nó tách từng cái tên trở lại thành một tệp riêng, và cần đủ ' +
      'chỗ cho một bản sao đầy đủ của mỗi cái. Thứ được khôi phục là sự tách rời của chúng, không phải nội ' +
      'dung cũ: những gì được ghi trong lúc chúng còn là một tệp chính là thứ mọi bản sẽ mang.',
    'hardlink.dialog.becomes': 'trở thành tên khác của',
    'hardlink.dialog.more': '…và {n} bản nữa',
    'hardlink.dialog.keepReading': 'Cuộn tiếp — nút sẽ bật ở cuối.',
    'hardlink.dialog.readEnd': 'Hết rồi. Nút đã bật.',

    'dupes.sharedNames': 'một tệp · {n} tên',
    'restore.title.hardlink': 'Đã nhập {n} {items}, mỗi bộ thành một tệp',
    'hardlink.refused.head': 'Để nguyên: {list}.',
    'hardlink.refused.office': '{n} {docs} (Word, Excel và loại tương tự)',
    'hardlink.doc.one': 'tài liệu',
    'hardlink.doc.other': 'tài liệu',
    'hardlink.refused.synced': '{n} nằm trong thư mục đồng bộ',
    'hardlink.refused.photos': '{n} nằm trong thư mục do màn Ảnh quản lý',
    'hardlink.refused.otherVolume': '{n} nằm trên ổ khác',
    'hardlink.refused.notNtfs': '{n} nằm trên ổ không phải NTFS',
    'hardlink.refused.differs': '{n} không còn giống hệt nhau',
    'hardlink.refused.system': '{n} nằm trong vùng hệ thống Windows',
    'hardlink.refused.program': '{n} thuộc một chương trình đã cài',
    'hardlink.refused.network': '{n} nằm trên ổ mạng',
    'hardlink.refused.other': '{n} bị bỏ qua',
    'hardlink.refused.already': '{n} vốn đã là một tệp',

    'hardlink.why.notThere': 'Tệp đó không còn nữa',
    'hardlink.why.notAFile': 'Chức năng này nhập tệp, mà đó không phải tệp',
    'hardlink.why.noKeeper': 'Không có bản nào được chỉ định để giữ, nên không có gì để nhập vào',
    'hardlink.why.keeperGone': 'Bản được giữ không còn nữa',
    'hardlink.why.itself': 'Đó chính là bản được giữ',
    'hardlink.why.already': 'Hai cái tên này vốn đã là một tệp',
    'hardlink.why.otherVolume': 'Hai bản nằm trên hai ổ khác nhau, mà hardlink không đi qua ổ được',
    'hardlink.why.notNtfs': 'Ổ này là {fs}, mà chỉ NTFS mới cho một tệp mang hai tên',
    'hardlink.why.office':
      'Word, Excel và loại tương tự lưu bằng cách ghi một tệp mới đè lên tệp cũ, làm đứt liên kết mà không ' +
      'báo gì',
    'hardlink.why.synced': 'Thứ này nằm trong {service}, nơi sẽ thấy một tệp mà nó không tự ghi ra',
    'hardlink.why.photos': 'Thứ này nằm trong thư mục do màn Ảnh quản lý',
    'hardlink.why.system': 'Đây là vùng hệ thống của Windows',
    'hardlink.why.program': 'Thứ này thuộc một chương trình đã cài, nên được để yên',
    'hardlink.why.network': 'Tệp trên ổ mạng được để yên',
    'hardlink.why.root': 'Gốc ổ đĩa hoặc thư mục cá nhân không phải thứ để nhập',
    'hardlink.why.differs':
      'Vừa đọc lại ngay lúc này, hai bản không còn giống hệt nhau — nên nhập chúng sẽ phá huỷ bản này',
    'hardlink.why.unreadable': 'Không đọc được ({error})',
    'hardlink.why.notAcknowledged': 'Cảnh báo chưa được xác nhận, nên không nhập gì cả',

    'evidence.dupes.shared.one': 'Vốn đã là cùng một tệp với 1 bản khác ở đây — xoá nó không giải phóng gì',
    'evidence.dupes.shared.other':
      'Vốn đã là cùng một tệp với {n} bản khác ở đây — xoá nó không giải phóng gì',

    'frees.hardlink': 'Giải phóng dung lượng, không xoá gì',
    'frees.hardlinkHint':
      'Các bản trở thành những cái tên khác của cùng một tệp. Mọi đường dẫn vẫn chạy; đĩa giữ nội dung một lần.',

    /* ---- Explorer's right-click menu (I3) ---- */
    'explorer.menu.analyze': 'Phân tích bằng CleanDrive',
    'explorer.menu.copies': 'Tìm bản trùng bằng CleanDrive',
    'explorer.title': 'Menu chuột phải trong Explorer',
    'explorer.enable': 'Thêm CleanDrive vào menu chuột phải của Explorer',
    'explorer.note':
      'Thêm “Phân tích bằng CleanDrive” vào thư mục và ổ đĩa, và “Tìm bản trùng bằng CleanDrive” vào tệp. Trên ' +
      'Windows 11 các mục này nằm trong “Show more options” của menu (hoặc bấm Shift+F10). Chúng chỉ được ghi ' +
      'cho tài khoản của bạn, và được gỡ đi khi tắt mục này hoặc khi gỡ cài đặt app.',
    'explorer.dev': 'Chỉ bản đã cài đặt mới tự thêm được vào menu của Explorer.',
    'explorer.failed': 'Windows không nhận thay đổi: {why}',
    'explorer.on': 'Đã có trong menu của Explorer: {n} mục, trỏ tới bản app này.',
    'explorer.stale':
      'Đang bật, nhưng {n} trong {total} mục bị thiếu hoặc đã cũ. Chúng sẽ được sửa lại ở lần mở app tới.',
    'explorer.leftover': 'Vẫn còn {n} mục trong menu của Explorer; chúng sẽ được gỡ ở lần mở app tới.',
    'explorer.off': 'Chưa có trong menu của Explorer.',
    'explorer.adding': 'Đang thêm các mục…',
    'explorer.removing': 'Đang gỡ các mục…',
    'explorer.busy': 'Đang có một lần quét chạy. Hãy dừng nó rồi thử lại.',
    'explorer.busyDupes': 'Đang tìm bản trùng. Hãy dừng lại rồi thử lại.',
    'dupes.copies.gone': 'Tệp đó không còn nữa.',
    'dupes.copies.looking': 'Đang tìm bản sao của {name}…',
    'dupes.copies.found': '{name}: có thêm {n} {copies} khác trong {scope}.',
    'dupes.copies.none': '{name}: không có bản sao nào khác trong {scope}.',
    'dupes.copies.empty': 'Không có bản sao nào khác của tệp này, giống từng byte, trong {scope}.',
    'dupes.copyWord.one': 'bản sao',
    'dupes.copyWord.other': 'bản sao',

    // A4: several folders, whole drives, and drives the app only reads
    'evidence.readOnly.network': 'Nằm trên ổ mạng, nơi Windows không có Thùng rác: CleanDrive chỉ đọc ở đây',
    'evidence.readOnly.removable': 'Nằm trên ổ rời: chưa đo được Thùng rác làm gì ở đó, nên CleanDrive chỉ đọc ở đây',
    'evidence.readOnly.cdrom': 'Nằm trên đĩa quang: không xoá được gì trên đó',
    'trash.refuse.network': 'Nằm trên ổ mạng: Windows không có Thùng rác ở đó, nên không xoá gì',
    'trash.refuse.removable': 'Nằm trên ổ rời: chưa đo được Thùng rác làm gì ở đó, nên không xoá gì',
    'trash.refuse.cdrom': 'Nằm trên đĩa quang: không xoá được gì trên đó',
    'app.target.many': '{n} thư mục',
    'usage.scanMany': 'Quét {n} thư mục',
    'usage.scanningMany': 'Đang quét thư mục {i}/{n}, {root}… {files} tệp, {size} ({elapsed})',
    'usage.scannedMany': 'Đã quét {n} tệp trong {roots} thư mục.',
    'usage.merged': '{root} nằm trong {into}, nên được quét cùng thư mục đó.',
    'usage.refused.notFolder': 'Không quét {root}: đó không phải thư mục.',
    'usage.refused.missing': 'Không quét {root}: thư mục không còn ở đó.',
    'usage.notReached': '{n} thư mục chưa kịp quét thì đã dừng.',
    'usage.readOnly.network': 'Trên ổ mạng: chỉ đọc, không đề xuất gì — Windows không có Thùng rác ở đó.',
    'usage.readOnly.removable': 'Trên ổ rời: chỉ đọc, không đề xuất gì cho tới khi đo được Thùng rác ở đó.',
    'usage.unscanned': '{size} đang dùng trên {volume} không nằm trong lần quét này — Windows, chương trình, thư mục của người khác; màn Hệ thống cho biết đó là gì.',
    // Quét nhanh qua $MFT (A2).
    'usage.fast': 'Quét nhanh (cần quyền quản trị)',
    'usage.fast.prompt': 'Đang chờ hộp thoại quyền quản trị…',
    'usage.fast.reading': 'Đang đọc bảng mục lục của ổ… {n} trên {of} bản ghi',
    'usage.fast.used': 'Đọc từ bảng mục lục của chính ổ {volume}: {records} bản ghi, {size}, trong {seconds}.',
    'usage.fast.torn': '{n} bản ghi trong bảng mục lục không khớp nên bị bỏ qua — hãy chạy chkdsk.',
    'usage.fast.declined': 'Hộp thoại quyền quản trị bị từ chối, nên app duyệt thư mục như thường.',
    'usage.fast.notNtfs': 'Ổ này không phải NTFS nên không có bảng mục lục để đọc — app duyệt thư mục như thường.',
    'usage.fast.notWholeDrive': 'Quét nhanh chỉ dành cho cả một ổ, nên thư mục này được duyệt như thường.',
    'usage.fast.network': 'Ổ mạng không có bảng mục lục mà app đọc được, nên app duyệt thư mục như thường.',
    'usage.fast.readOnly': 'Ổ này chỉ đọc, nên app duyệt thư mục như thường.',
    'usage.fast.locked': 'Quét nhanh thuộc CleanDrive Pro, nên app duyệt thư mục như thường.',
    'usage.fast.notElevated': 'Tiến trình trợ giúp khởi động mà không có quyền quản trị, nên app duyệt thư mục như thường.',
    'usage.fast.helper': 'Không khởi động được tiến trình trợ giúp có quyền quản trị, nên app duyệt thư mục như thường.',
    'usage.fast.unreadable': 'Không đọc được bảng mục lục của ổ, nên app duyệt thư mục như thường.',
    // Space Planner (G1).
    'app.tab.planner': 'Kế hoạch',
    'planner.title': 'Kế hoạch',
    'planner.need': 'Tôi cần',
    'planner.on': 'trên ổ',
    'planner.unit': 'Đơn vị',
    'planner.drive': 'Ổ đĩa',
    'planner.run': 'Tính kế hoạch',
    'planner.progress': 'Đang tính kế hoạch',
    'planner.includeSystem': 'Đo cả vùng hệ thống (cần quyền quản trị)',
    'planner.idle': 'Cho biết anh cần thêm bao nhiêu, app sẽ tính xem lấy từ đâu.',
    'planner.noGoal': 'Nhập số dung lượng cần trước đã.',
    'planner.measuring': 'Đang đo {source}… ({done} trên {total})',
    'planner.done': 'Đã đo mọi nguồn app đo được.',
    'planner.stopped': 'Đã dừng — kế hoạch dưới đây chỉ gồm phần đo xong trước lúc đó.',
    'planner.failed': 'Không tính được kế hoạch.',
    'planner.empty': 'Không tìm thấy gì có thể giải phóng trên ổ này.',
    'planner.upgrade': 'Kế hoạch dung lượng thuộc CleanDrive Pro.',
    'planner.reached': 'Các bước dưới đây cộng lại được {size}, đủ cho {target} anh cần.',
    'planner.short': 'Những nguồn CleanDrive biết chỉ được {size} trên {target} anh cần. Phần còn lại phải là dữ liệu của chính anh — xem màn Dung lượng ổ đĩa.',
    'planner.count': '{n} {items}, tổng {size}',
    'planner.running': 'Tới bước này là {size} trên {target}',
    'planner.go': 'Mở màn đó',
    'planner.go.bin': 'Mở màn Khôi phục',
    'planner.frees.now': 'Giải phóng {size} ngay',
    'planner.frees.here': 'Giải phóng {size} ở đây',
    'planner.frees.bin': 'Chuyển {size} vào Thùng rác — chưa giải phóng cho tới khi dọn Thùng rác',
    'planner.frees.windows': 'Windows giải phóng {size} khi anh làm nốt',
    'planner.frees.none': 'Bước này không giải phóng gì trên ổ này',
    'planner.step.caches': 'Tệp tạm, cache và log',
    'planner.step.cloud': 'Tệp OneDrive giữ được ở dạng chỉ trên mây',
    'planner.step.buildoutput': 'Thư mục build mà chính .gitignore của anh khai',
    'planner.step.devtools': 'Cache của công cụ lập trình',
    'planner.step.bin': 'Dọn phần CleanDrive đã bỏ vào Thùng rác',
    'planner.step.system': 'Vùng hệ thống Windows lấy lại được',
    'planner.step.review': 'Installer cũ, kho nén lớn, tệp lâu không đụng',
    'planner.step.dupes': 'Bản trùng lặp',
    'planner.step.apps': 'Chương trình đã lâu không mở',
    'planner.step.games': 'Game lâu rồi không chơi',
    'planner.note.bin': 'Mọi thứ phía trên đã chuyển vào Thùng rác vẫn còn nằm trên ổ cho tới bước này.',
    'planner.note.system': 'CleanDrive mở công cụ của chính Windows cho những mục này, không bao giờ tự xoá.',
    'planner.note.handoff': 'CleanDrive mở trình gỡ cài đặt; Windows mới là bên giải phóng dung lượng.',
    'planner.note.cloud': 'Tệp vẫn ở trong OneDrive và tải lại khi anh mở, miễn là có mạng.',
    'planner.missing.dupes': 'Chưa tìm bản trùng lặp: muốn tìm thì phải đọc nội dung mọi tệp trên ổ chứ không chỉ kích thước. Mở màn Trùng lặp nếu anh muốn tính cả phần đó.',
    'planner.missing.system': 'Chưa đo vùng hệ thống. Tick ô ở trên rồi chạy lại — phần đó cần quyền quản trị.',
    'planner.missing.other': 'Không đo được {source}, nên kế hoạch này không có gì từ đó.',
    'dupes.skippedNetwork': 'Không tìm trên ổ mạng: {roots}.',
    'roots.add': '+ Thư mục',
    'roots.addHint': 'Quét thêm một thư mục cùng lúc với thư mục này',
    'roots.drive': 'Toàn bộ ổ…',
    'roots.driveHint': 'Quét mọi thứ trên một ổ',
    'roots.list': 'Các thư mục trong lần quét này',
    'roots.upgrade': 'Quét nhiều thư mục cùng lúc, hoặc toàn bộ một ổ, là tính năng của CleanDrive Pro.',
    'roots.badge.merged': 'nằm trong {into}, quét cùng thư mục đó',
    'roots.badge.network': 'ổ mạng · chỉ đọc',
    'roots.badge.removable': 'ổ rời · chỉ đọc',
    'roots.badge.cdrom': 'đĩa quang · chỉ đọc',
    'roots.badge.external': 'ổ gắn ngoài · {bus}',
    'roots.remove': 'Bỏ {root} khỏi lần quét',
    'roots.drives.title': 'Quét toàn bộ một ổ',
    'roots.drives.note': 'Windows, chương trình đã cài và thư mục của người khác không được quét. Phần chúng chiếm là một ô trên bản đồ, và màn Hệ thống cho biết đó là gì.',
    'roots.drives.removable': 'ổ rời · chỉ đọc',
    'roots.drives.external': 'gắn ngoài · {bus}',
    'roots.drives.free': 'còn trống {free} / {total}',
    'roots.drives.none': 'Windows không liệt kê ổ nào quét được.',
    'map.unscanned': '(không có trong lần quét này)',
    'map.allRoots': '{n} thư mục',
    'map.unscannedHint': 'Đang dùng trên {volume} nhưng lần quét này không đếm: Windows, chương trình đã cài, thư mục của người khác, và những gì không đọc được. Là số ước tính. Bấm để xem trên màn Hệ thống.',
  };
});
