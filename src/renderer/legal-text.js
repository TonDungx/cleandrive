'use strict';

/**
 * The Terms of use and the Refund policy, as data (drawn by legal.js).
 *
 * Written 2026-10-02 against what Vietnamese law asks of a seller that sells
 * online and of a standard-form contract, and against how established
 * software vendors handle refunds -- see ROADMAP §7.2.3, where the sources are
 * listed. Two rules shaped every line:
 *
 * - Nothing here may take away a right the law gives a consumer
 *   (Luật Bảo vệ quyền lợi người tiêu dùng 2023, Điều 25): no "as is, no
 *   liability", no forced arbitration, no changing the terms without a way
 *   out. Where an overseas template would say those things, this says what
 *   the app actually does instead.
 * - Nothing here may promise what the app does not do. Every sentence about
 *   the app -- what is stored, what is sent, what happens when a licence ends
 *   -- is a sentence the README also says, about code that exists.
 *
 * Not reviewed by a lawyer: that is to be done before selling begins (Phase 7,
 * ROADMAP §11 row 36). The Vietnamese text is the one that governs; if the two
 * ever differ, the reading more favourable to the customer applies (Điều 23).
 *
 * Each document has the same sections, in the same order, in both languages
 * -- test-commerce.js holds them to that.
 */
(function (root) {
  const SOURCE = 'https://github.com/TonDungx/cleandrive/issues';

  const terms = {
    vi: {
      title: 'Điều khoản sử dụng',
      version: '1.0',
      effective: '02/10/2026',
      notice:
        'CleanDrive chưa mở bán. Trong thời gian này, bấm Thanh toán sẽ kích hoạt gói mà không thu tiền, và bản quyền cấp theo cách đó hết hiệu lực khi bắt đầu bán. Thông tin người bán (tên, địa chỉ, mã số thuế) sẽ được công bố ở đây trước khi bán.',
      sections: [
        {
          heading: '1. Về văn bản này',
          body: [
            'Đây là điều kiện giao dịch chung giữa bạn và nhà phát triển CleanDrive ("chúng tôi") khi bạn dùng CleanDrive và khi bạn mua, dùng thử hay kích hoạt một gói. Văn bản luôn đọc được trong ứng dụng, trước khi bạn thanh toán, và bạn đồng ý bằng ô tick ở bước thanh toán.',
            'Bản tiếng Việt là bản có giá trị. Nếu bản tiếng Việt và bản tiếng Anh hiểu khác nhau, cách hiểu có lợi hơn cho bạn được áp dụng. Không điều nào ở đây hạn chế quyền mà pháp luật Việt Nam dành cho người tiêu dùng.',
          ],
        },
        {
          heading: '2. Liên hệ',
          body: [
            `Mọi câu hỏi, yêu cầu hoàn tiền, khiếu nại hay yêu cầu về dữ liệu cá nhân: gửi qua trang hỗ trợ của dự án, ${SOURCE}. Khi mở bán, địa chỉ email và số điện thoại hỗ trợ sẽ được ghi thêm ở đây.`,
          ],
        },
        {
          heading: '3. Các gói',
          body: [
            [
              'Free: miễn phí, không giới hạn thời gian.',
              'Pro: theo năm hoặc trọn đời. Developer Pack là phần mua thêm cho Pro.',
              'Business: theo năm, gồm mọi thứ của Pro và Developer Pack, cùng các tính năng cho tổ chức.',
              'Dùng thử Pro: 14 ngày, miễn phí, mỗi bản cài một lần, không cần thanh toán.',
            ],
            'Danh sách tính năng của từng gói được hiển thị khi bạn chọn gói. Tính năng mà một phiên bản về sau thêm vào gói bạn đã mua sẽ tự mở cho bạn, không phải trả thêm.',
            'Bản quyền theo năm có hiệu lực tới ngày ghi trên thẻ Gói & bản quyền. Sau ngày đó, các phiên bản CleanDrive phát hành trước ngày hết hạn vẫn giữ Pro vĩnh viễn; các phiên bản phát hành sau thì không. Bản quyền trọn đời dùng được cho mọi phiên bản về sau.',
          ],
        },
        {
          heading: '4. Máy dùng được và số máy',
          body: [
            'CleanDrive chạy trên Windows 10 hoặc Windows 11 bản 64-bit. Mỗi bản quyền dùng được cùng lúc trên số máy bạn chọn khi mua (ghi trên thẻ Gói & bản quyền). Muốn chuyển sang máy khác, hãy bấm "Bỏ kích hoạt máy này" trên máy cũ rồi nhập mã ở máy mới.',
            'Mã bản quyền là của bạn: hãy giữ nó (nút "Lưu mã vào file"). Bạn không được bán lại, chia sẻ công khai hay dùng mã vượt quá số máy đã mua, và không được tìm cách vượt qua việc kiểm tra bản quyền.',
          ],
        },
        {
          heading: '5. Giá và thanh toán',
          body: [
            'Giá tính bằng đồng Việt Nam. Con số trên nút Thanh toán là giá cuối cùng: đã gồm mọi thuế và phí, không cộng thêm gì khi thanh toán. Mã giảm giá, nếu có, được trừ trước khi bạn bấm.',
            'Phương thức thanh toán: thẻ quốc tế, MoMo, VNPay hoặc chuyển khoản ngân hàng qua QR. Ứng dụng không bao giờ hỏi số thẻ của bạn: thông tin thẻ chỉ được nhập trên trang của cổng thanh toán.',
            'Không có gia hạn tự động. Không khoản tiền nào bị thu nếu bạn không tự bấm thanh toán. Khi bắt đầu bán, hoá đơn của mỗi lần mua sẽ tải và in được; hiện thẻ Gói & bản quyền liệt kê các lần mua.',
          ],
        },
        {
          heading: '6. Khi bản quyền hết hạn, được hoàn tiền hoặc bị gỡ',
          body: [
            'CleanDrive trở về Free. Ứng dụng không xoá hay ẩn bất cứ thứ gì nó đã làm ra: Trung tâm khôi phục, nhật ký, các tệp đã chuyển sang ổ khác, ảnh chụp các lần quét và báo cáo vẫn nguyên đó, và việc khôi phục luôn miễn phí. Những lần quét chụp trước ngày hết hạn vẫn so sánh được với nhau.',
            'Hồ sơ dọn dẹp tự động cần Pro vẫn còn, nhưng chỉ báo cáo những gì nó sẽ làm, và nói rõ lý do. Không hồ sơ nào bị dừng mà không báo.',
          ],
        },
        {
          heading: '7. Dữ liệu cá nhân',
          body: [
            'CleanDrive không gửi dữ liệu sử dụng, không có mã định danh theo dõi và không đọc nội dung tệp của bạn để gửi đi đâu.',
            [
              'Khi mua, bạn cung cấp một địa chỉ email. Nó chỉ dùng để gắn bản quyền với bạn và để gửi bản quyền, hoá đơn và hỗ trợ cho chính lần mua đó.',
              'Trên máy của bạn, email được mã hoá cho tài khoản Windows của bạn (DPAPI) và không nằm trong mã bản quyền; mã bản quyền chỉ mang một giá trị băm của email.',
              'Mỗi đơn hàng lưu trên máy: gói, giá, phương thức, ngày và một mã máy đã băm. Không lưu email hay số thẻ.',
              'Khi bắt đầu bán, email và đơn hàng cũng được lưu bởi cổng thanh toán và máy chủ bản quyền, chỉ để thực hiện giao dịch. Chính sách này sẽ ghi rõ tên các đơn vị đó và nơi lưu.',
            ],
            'Bạn có quyền biết, xem, sửa, xoá hoặc yêu cầu hạn chế việc xử lý dữ liệu của mình, và rút lại sự đồng ý. Trên máy: "Bỏ kích hoạt máy này" xoá email khỏi máy. Với dữ liệu lưu ở phía chúng tôi: gửi yêu cầu qua mục 2.',
          ],
        },
        {
          heading: '8. Ứng dụng làm gì, và trách nhiệm',
          body: [
            'CleanDrive chỉ chuyển, nén hay xoá tệp sau khi bạn xác nhận, trừ các tính năng bạn tự bật để chạy theo lịch. Mọi thứ nó chuyển đi đều được ghi lại và khôi phục được từ Trung tâm khôi phục, trừ những gì bạn đã chọn xoá hẳn. Chúng tôi khuyên bạn vẫn sao lưu dữ liệu quan trọng.',
            'Chúng tôi chịu trách nhiệm theo pháp luật Việt Nam. Nếu ứng dụng không làm đúng như đã mô tả, bạn có quyền yêu cầu sửa, giảm giá hoặc chấm dứt và được hoàn tiền (xem Chính sách hoàn tiền).',
          ],
        },
        {
          heading: '9. Thay đổi điều khoản',
          body: [
            'Bản mới sẽ hiện trong ứng dụng, có số phiên bản và ngày có hiệu lực, trước khi có hiệu lực. Bản mới không làm xấu đi điều kiện của bản quyền bạn đã mua trong thời hạn của nó, trừ khi bạn đồng ý. Nếu bạn không đồng ý một thay đổi, bạn có thể chấm dứt và được hoàn phần chưa dùng theo Chính sách hoàn tiền.',
          ],
        },
        {
          heading: '10. Khiếu nại và tranh chấp',
          body: [
            'Gửi khiếu nại qua mục 2. Chúng tôi xác nhận đã nhận trong 3 ngày làm việc và trả lời kết quả trong 15 ngày làm việc.',
            'Nếu chưa thoả đáng, hai bên có thể thương lượng, nhờ hoà giải, đưa ra trọng tài (chỉ khi bạn đồng ý vào lúc đó) hoặc khởi kiện tại toà án có thẩm quyền theo pháp luật Việt Nam. Văn bản này được điều chỉnh bởi pháp luật Việt Nam.',
          ],
        },
      ],
    },
    en: {
      title: 'Terms of use',
      version: '1.0',
      effective: '2 October 2026',
      notice:
        'CleanDrive is not on sale yet. Until it is, pressing Pay activates a plan without taking any money, and a licence issued that way ends when selling begins. The seller’s details (name, address, tax code) will be published here before anything is sold.',
      sections: [
        {
          heading: '1. About this document',
          body: [
            'These are the general terms between you and the developer of CleanDrive ("we") when you use CleanDrive and when you buy, try or activate a plan. They can always be read in the app before you pay, and you agree to them with the box at checkout.',
            'The Vietnamese text is the one that governs. If the Vietnamese and the English read differently, the reading more favourable to you applies. Nothing here limits the rights Vietnamese law gives consumers.',
          ],
        },
        {
          heading: '2. Contact',
          body: [
            `Questions, refund requests, complaints and requests about your personal data: through the project’s support page, ${SOURCE}. A support email address and phone number will be added here when selling begins.`,
          ],
        },
        {
          heading: '3. Plans',
          body: [
            [
              'Free: no charge, no time limit.',
              'Pro: yearly or lifetime. The Developer Pack is an add-on for Pro.',
              'Business: yearly; everything in Pro and the Developer Pack, plus the features for organisations.',
              'Pro trial: 14 days, free, once per installation, no payment needed.',
            ],
            'What each plan includes is shown when you choose one. Features a later version adds to the plan you bought open for you at no extra charge.',
            'A yearly licence is valid until the date on the Plans and licence card. After that date, the versions of CleanDrive released before it keep Pro for good; versions released after it do not. A lifetime licence covers every later version.',
          ],
        },
        {
          heading: '4. Compatible computers, and how many',
          body: [
            'CleanDrive runs on 64-bit Windows 10 or Windows 11. Each licence can be active at the same time on the number of computers you chose when buying (shown on the Plans and licence card). To move to another computer, press "Deactivate this computer" on the old one and enter the key on the new one.',
            'The licence key is yours: keep it ("Save the key to a file"). You may not resell it, publish it, use it on more computers than you bought, or try to get round the licence check.',
          ],
        },
        {
          heading: '5. Price and payment',
          body: [
            'Prices are in Vietnamese đồng. The amount on the Pay button is the final price: it includes every tax and fee, and nothing is added at payment. A discount code, if any, is taken off before you press it.',
            'Payment methods: international card, MoMo, VNPay or bank transfer by QR. The app never asks for your card number: card details are entered only on the payment provider’s own page.',
            'There is no automatic renewal. Nothing is charged unless you press Pay yourself. Once selling begins, the invoice for each purchase can be downloaded and printed; for now the Plans and licence card lists the purchases.',
          ],
        },
        {
          heading: '6. When a licence ends, is refunded or is removed',
          body: [
            'CleanDrive goes back to Free. The app never deletes or hides anything it made: the Restore Center, the journal, files moved to another drive, the snapshots of scans and reports all stay, and restoring is always free. Scans taken before the end date can still be compared with each other.',
            'Automatic cleanup profiles that need Pro stay, but only report what they would do, and say why. No profile is ever stopped without saying so.',
          ],
        },
        {
          heading: '7. Personal data',
          body: [
            'CleanDrive sends no usage data, has no tracking identifiers, and does not read your files to send anything anywhere.',
            [
              'When you buy, you give an email address. It is used only to tie the licence to you and to send the licence, the invoice and support for that purchase.',
              'On your computer the email is encrypted for your Windows account (DPAPI) and is not in the licence key, which carries only a hash of it.',
              'Each order kept on your computer records the plan, the price, the method, the date and a hashed machine id. Never the email, never a card number.',
              'Once selling begins, the email and the order are also kept by the payment provider and the licence server, only to carry out the purchase. This policy will name them and where the data is kept.',
            ],
            'You have the right to know about, see, correct and delete your data, to ask for its processing to be restricted, and to withdraw consent. On your computer, "Deactivate this computer" removes the email. For data we hold, send a request through section 2.',
          ],
        },
        {
          heading: '8. What the app does, and liability',
          body: [
            'CleanDrive moves, compresses or deletes files only after you confirm, except for the features you switch on yourself to run on a schedule. Everything it moves is recorded and can be put back from the Restore Center, except what you chose to delete outright. We still recommend you back up important data.',
            'We are liable as Vietnamese law provides. If the app does not do what it is described as doing, you may ask for it to be fixed, for a discount, or to end the purchase with a refund (see the Refund policy).',
          ],
        },
        {
          heading: '9. Changes to these terms',
          body: [
            'A new version will appear in the app, with its version number and the date it takes effect, before it does. A new version does not worsen the conditions of a licence you bought for the rest of its term unless you agree. If you do not accept a change, you may end the purchase and get the unused part back under the Refund policy.',
          ],
        },
        {
          heading: '10. Complaints and disputes',
          body: [
            'Send complaints through section 2. We confirm receipt within 3 working days and give our answer within 15 working days.',
            'If that does not settle it, we can negotiate, use mediation, go to arbitration (only if you agree at that time) or go to the competent court under Vietnamese law. These terms are governed by Vietnamese law.',
          ],
        },
      ],
    },
  };

  const refund = {
    vi: {
      title: 'Chính sách hoàn tiền',
      version: '1.0',
      effective: '02/10/2026',
      notice: 'CleanDrive chưa mở bán, nên hiện chưa có khoản thanh toán nào để hoàn. Chính sách này áp dụng từ khi bắt đầu bán.',
      sections: [
        {
          heading: '1. Hoàn tiền trong 30 ngày, không cần lý do',
          body: [
            'Trong 30 ngày kể từ ngày thanh toán, bạn được hoàn toàn bộ số tiền của lần mua đó, không cần nêu lý do và không mất phí. Điều này áp dụng cho:',
            [
              'lần mua đầu tiên của mọi gói, theo năm hoặc trọn đời;',
              'mỗi lần gia hạn theo năm;',
              'Developer Pack, cùng với gói Pro mà nó đi kèm.',
            ],
            'Dùng thử 14 ngày là miễn phí nên không có gì để hoàn; 30 ngày được tính từ ngày bạn thanh toán, không phải từ ngày bắt đầu dùng thử.',
          ],
        },
        {
          heading: '2. Sau 30 ngày',
          body: [
            [
              'Gói theo năm: bạn có thể chấm dứt bất cứ lúc nào và được hoàn phần chưa dùng, tính theo số tháng trọn vẹn còn lại.',
              'Gói trọn đời: không hoàn sau 30 ngày, trừ trường hợp ở mục 3.',
            ],
          ],
        },
        {
          heading: '3. Khi ứng dụng không như mô tả',
          body: [
            'Nếu CleanDrive không làm được điều đã mô tả cho gói bạn mua, hoặc thông tin chúng tôi công bố khi bán bị sai hay thiếu, bạn được yêu cầu sửa, giảm giá, hoặc chấm dứt và được hoàn tiền, vào bất cứ lúc nào, theo pháp luật về bảo vệ quyền lợi người tiêu dùng.',
          ],
        },
        {
          heading: '4. Cách yêu cầu',
          body: [
            'Gửi yêu cầu qua trang hỗ trợ ghi ở mục 2 của Điều khoản sử dụng, kèm mã đơn hàng (trên thẻ Gói & bản quyền). Chúng tôi xác nhận trong 3 ngày làm việc. Tiền được hoàn về đúng phương thức bạn đã thanh toán, trong vòng 7 ngày làm việc kể từ khi chấp nhận và không quá 30 ngày; thời gian tiền về tài khoản còn tuỳ ngân hàng hay ví.',
          ],
        },
        {
          heading: '5. Sau khi hoàn tiền',
          body: [
            'Bản quyền của lần mua được hoàn sẽ hết hiệu lực và máy của bạn trở về Free. Không dữ liệu nào bị xoá: Trung tâm khôi phục, nhật ký, các tệp đã chuyển sang ổ khác và báo cáo vẫn nguyên đó, và việc khôi phục luôn miễn phí.',
            'Nếu bạn định yêu cầu ngân hàng huỷ giao dịch (chargeback), hãy liên hệ chúng tôi trước: thường cách đó nhanh hơn. Việc này không hạn chế quyền của bạn với ngân hàng hay theo pháp luật.',
          ],
        },
      ],
    },
    en: {
      title: 'Refund policy',
      version: '1.0',
      effective: '2 October 2026',
      notice: 'CleanDrive is not on sale yet, so there is no payment to refund. This policy applies from when selling begins.',
      sections: [
        {
          heading: '1. A refund within 30 days, no reason needed',
          body: [
            'Within 30 days of paying you get the whole amount of that purchase back, with no reason asked and no fee. This covers:',
            [
              'the first purchase of every plan, yearly or lifetime;',
              'each yearly renewal;',
              'the Developer Pack, with the Pro plan it came with.',
            ],
            'The 14-day trial is free, so there is nothing to refund; the 30 days count from the day you pay, not from the day the trial started.',
          ],
        },
        {
          heading: '2. After 30 days',
          body: [
            [
              'Yearly plans: you can end the plan at any time and get back the unused part, counted in whole months remaining.',
              'Lifetime plans: no refund after 30 days, except as in section 3.',
            ],
          ],
        },
        {
          heading: '3. When the app is not as described',
          body: [
            'If CleanDrive cannot do what was described for the plan you bought, or the information we published when selling was wrong or missing, you may ask for it to be fixed, for a discount, or to end the purchase with a refund, at any time, under consumer protection law.',
          ],
        },
        {
          heading: '4. How to ask',
          body: [
            'Send the request through the support page in section 2 of the Terms of use, with the order number (on the Plans and licence card). We confirm within 3 working days. The money goes back by the method you paid with, within 7 working days of accepting the request and never more than 30 days; how long it takes to reach your account depends on the bank or wallet.',
          ],
        },
        {
          heading: '5. After a refund',
          body: [
            'The licence from the refunded purchase stops being valid and your computer goes back to Free. No data is deleted: the Restore Center, the journal, files moved to another drive and reports all stay, and restoring is always free.',
            'If you are thinking of asking your bank to reverse the payment (a chargeback), please contact us first: it is usually faster. This does not limit your rights with your bank or under the law.',
          ],
        },
      ],
    },
  };

  root.LegalText = Object.freeze({ terms, refund });
  if (typeof module === 'object' && module.exports) module.exports = root.LegalText;
})(typeof window !== 'undefined' ? window : globalThis);
