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
    'app.unit.seconds': 'giây',
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

    /* ---- what to delete ----------------------------------------------- */
    'cleanup.safe': 'An toàn để xoá',
    'cleanup.review': 'Nên xem lại',
    'cleanup.protected': 'Vị trí được bảo vệ',
    'cleanup.selectSafe': 'Chọn tất cả mục được đánh dấu an toàn',
    'cleanup.selectAllInGroup': 'chọn tất cả',
    'cleanup.neverDeleted': 'Không bao giờ bị xoá',
    'cleanup.neverDeletedNote':
      'Những vị trí này đã bị bỏ qua khi quét và các lớp bảo vệ cũng từ chối xoá chúng, nên không ' +
      'thứ gì ở đây có thể bị ứng dụng này xoá — dù bạn cố ý hay nhầm lẫn.',
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

    /* ---- verdicts, as the badge says them ------------------------------ */
    'verdict.safe': 'an toàn',
    'verdict.review': 'nên xem lại',
    'verdict.protected': 'được bảo vệ',
    'verdict.keep': 'giữ lại',
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
    'run.cancelledBefore': 'Đã huỷ trước khi có gì bị xoá',
    'run.allRefused': 'Mọi ứng viên đều bị các lớp bảo vệ từ chối',
    'run.note.noDiskUsage': 'Không đọc được dung lượng đĩa; ngưỡng phần trăm không được áp dụng',
    'run.note.rootFailed': '{root}: {error}',
    'run.note.purgeFailed': 'Không gỡ được {n} mục trong Thùng rác',
    'run.note.purgeError': 'Dọn Thùng rác thất bại: {error}',
    'run.note.stillInBin':
      'Các tệp đang nằm trong Thùng rác, vốn ở cùng ổ đĩa — chưa có dung lượng nào trống ra cho tới khi ' +
      'thùng rác được dọn. Bật xoá vĩnh viễn có thời gian chờ để CleanDrive tự dọn phần của nó sau một ' +
      'khoảng thời gian.',

    'auto.describe.off': 'Dọn dẹp tự động đang tắt.',

    /* ---- the native confirmations -------------------------------------- */
    'dialog.confirmDelete.title': 'Xác nhận xoá',
    'dialog.confirmDelete.message': 'Chuyển {n} mục vào Thùng rác?',
    'dialog.confirmDelete.detail': 'Việc này giải phóng {size}. Các mục vẫn khôi phục được từ Thùng rác.',
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
    'dupes.cacheHits': 'Dùng lại {n} giá trị băm từ bộ đệm.',
    'dupes.unreadable': 'Không đọc được {n} tệp.',
    'dupes.withheld':
      '{n} bản sao thuộc về chương trình đã cài hoặc thư mục phụ thuộc nên không được chọn tự động — ' +
      'chỉ {selectable} trong tổng số {total} là an toàn để xoá hàng loạt.',
    'dupes.empty': 'Không tìm thấy tệp trùng nào trong thư mục này.',
    'dupes.groupTitle': '{n} bản giống hệt nhau · mỗi bản {size}',
    'dupes.reclaimableAmount': 'thu hồi được {size}',
    'dupes.oldest': 'cũ nhất',
    'dupes.oldestHint': 'Bản cũ nhất — nên giữ lại bản này',
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
    'delete.moved': 'Đã chuyển {n} {items} vào Thùng rác{took} · giải phóng {freed}',
    'delete.stopped':
      'Đã dừng. {n} {items} đã được chuyển vào Thùng rác · giải phóng {freed} · còn {left} chưa đụng tới.',
    'delete.cancelled': 'Đã huỷ xoá — không có gì bị gỡ đi.',
    'delete.needsAdmin': '{n} mục cần quyền quản trị',
    'delete.inUse': '{n} mục đang được chương trình khác sử dụng',
    'delete.otherSkipped': 'bỏ qua {n} mục',
    'delete.nothing': 'Không có gì bị xoá. {reason}',

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

    /* ---- automatic cleanup -------------------------------------------- */
    'auto.statState': 'Dọn dẹp tự động',
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
    'task.problem.removeFailed': '{label}: không gỡ được tác vụ Windows ({error}).',
    'task.problem.refused': '{label}: Windows Task Scheduler từ chối tác vụ ({error}).',
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
    'media.strength.certain': 'chắc chắn',
    'media.strength.strong': 'căn cứ vững',
    'media.strength.likely': 'nhiều khả năng',
    'media.strength.guess': 'chỉ là phỏng đoán',

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
  };
});
