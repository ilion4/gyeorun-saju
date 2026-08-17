// 사주풀이 결과를 앱 디자인(네이비+금색+도장 컨셉)을 반영한 PDF로 만드는 모듈.
// 외부 브라우저(puppeteer 등) 없이 pdfkit만으로 렌더링하기 때문에
// Railway 같은 가벼운 호스팅에서도 별도 설정 없이 안정적으로 동작한다.
const PDFDocument = require('pdfkit');
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONT = {
  regular: path.join(FONT_DIR, 'Pretendard-Regular.ttf'),
  medium: path.join(FONT_DIR, 'Pretendard-Medium.ttf'),
  semibold: path.join(FONT_DIR, 'Pretendard-SemiBold.ttf'),
  bold: path.join(FONT_DIR, 'Pretendard-Bold.ttf'),
  extrabold: path.join(FONT_DIR, 'Pretendard-ExtraBold.ttf'),
};

const COLOR = {
  navy: '#12122A',
  surface: '#1B1B3D',
  paper: '#F3ECDD',
  gold: '#C9A24B',
  goldSoft: '#E4CE95',
  red: '#8B3A3A',
  ink: '#2A2620',
  inkSoft: '#6B6455',
};

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

/**
 * @param {object} params
 * @param {object} params.order        - 주문 정보 (order.self.name, order.fortune.name, order.fortune.tierKey 등)
 * @param {object} params.saju         - { yearSelf, monthSelf, daySelf, hourSelf, timeDescSelf, bdateSelf, [상대방도 동일 패턴] }
 * @param {object} params.content      - AI가 생성한 구조화 콘텐츠 { title, subtitle, sections:[{heading,body}], monthly:[{month,text}], closing }
 * @returns {Promise<Buffer>}
 */
function generateFortunePdf({ order, saju, content }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN, autoFirstPage: false, bufferPages: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      registerFonts(doc);

      const isDeep = order.fortune.tierKey === 'deep';
      const tierLabel = isDeep ? '심도있게' : '간략하게';
      const productName = order.fortune.baseName || order.fortune.name;
      const customerName = order.self.name;
      const issueDate = formatDate(new Date());

      // 자동 배경/헤더용 플래그: true일 때만 pageAdded에서 종이 배경+러닝헤더를 그림
      let chromeMode = false;
      doc.on('pageAdded', () => {
        if (chromeMode) drawContentChrome(doc, productName);
      });

      // ---------- 표지 ----------
      doc.addPage();
      drawCoverPage(doc, { customerName, productName, tierLabel, issueDate, saju, subtitle: content.subtitle });

      // ---------- 목차 ----------
      chromeMode = true;
      doc.addPage();
      drawContentChrome(doc, productName, true);
      drawTocPage(doc, content);

      // ---------- 본문 섹션들 ----------
      doc.addPage();
      (content.sections || []).forEach((section, idx) => {
        drawSectionHeading(doc, `${idx + 1}. ${stripHanja(section.heading)}`);
        drawBodyParagraphs(doc, section.body);
        doc.moveDown(0.5);
      });

      // ---------- 월별운세 (있을 때만) ----------
      if (content.monthly && content.monthly.length) {
        ensureSpace(doc, 140);
        drawSectionHeading(doc, `${(content.sections || []).length + 1}. 월별 운세 흐름`);
        content.monthly.forEach((m) => drawMonthlyBlock(doc, m));
      }

      // ---------- 마무리 총평 ----------
      if (content.closing) {
        ensureSpace(doc, 160);
        doc.moveDown(0.8);
        drawClosingBox(doc, content.closing);
      }

      // ---------- 페이지 번호 스탬프 ----------
      stampPageNumbers(doc);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function registerFonts(doc) {
  doc.registerFont('regular', FONT.regular);
  doc.registerFont('medium', FONT.medium);
  doc.registerFont('semibold', FONT.semibold);
  doc.registerFont('bold', FONT.bold);
  doc.registerFont('extrabold', FONT.extrabold);
}

// ============================================================
// 표지
// ============================================================
function drawCoverPage(doc, { customerName, productName, tierLabel, issueDate, saju, subtitle }) {
  // 배경
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(COLOR.navy);

  // 이중 금색 테두리
  doc.rect(28, 28, PAGE_W - 56, PAGE_H - 56).lineWidth(1).stroke(COLOR.gold);
  doc.rect(34, 34, PAGE_W - 68, PAGE_H - 68).lineWidth(0.5).stroke(COLOR.gold);

  // 로고
  doc.font('semibold').fontSize(14).fillColor(COLOR.gold);
  doc.text('백 도 령', 0, 90, { width: PAGE_W, align: 'center', characterSpacing: 4 });

  // 얇은 구분선
  doc.moveTo(PAGE_W / 2 - 40, 122).lineTo(PAGE_W / 2 + 40, 122).lineWidth(0.75).stroke(COLOR.gold);

  // 상품명 (작게)
  doc.font('medium').fontSize(12).fillColor(COLOR.goldSoft);
  doc.text(productName, 60, 165, { width: PAGE_W - 120, align: 'center' });

  // 타이틀
  doc.font('extrabold').fontSize(28).fillColor('#FFFFFF');
  doc.text(`${customerName}님의 풀이`, 60, 190, { width: PAGE_W - 120, align: 'center' });

  if (subtitle) {
    doc.font('regular').fontSize(11).fillColor('#C9C6D8');
    doc.text(stripHanja(subtitle), 80, 234, { width: PAGE_W - 160, align: 'center' });
  }

  // 사주 8자 도장 4개
  drawStampRow(doc, saju, 320);

  // 생년월일시 정보
  doc.font('regular').fontSize(10).fillColor('#B9B6C8');
  doc.text(saju.bdateLabel, 60, 470, { width: PAGE_W - 120, align: 'center' });

  // 하단 정보
  doc.font('medium').fontSize(9.5).fillColor(COLOR.gold);
  doc.text(`${tierLabel} 풀이  ·  발행일 ${issueDate}`, 60, PAGE_H - 110, { width: PAGE_W - 120, align: 'center' });

  doc.font('regular').fontSize(8).fillColor('#8B87A0');
  doc.text('본 풀이는 AI가 명리학 이론을 바탕으로 생성한 참고용 자료이며,\n인생의 방향을 미리 정해두는 절대적 예언이 아닙니다.', 60, PAGE_H - 88, {
    width: PAGE_W - 120,
    align: 'center',
    lineGap: 2,
  });
}

function drawStampRow(doc, saju, top) {
  const stamps = [
    { label: '년주', value: saju.year },
    { label: '월주', value: saju.month },
    { label: '일주', value: saju.day },
    { label: '시주', value: saju.hour },
  ];
  const boxSize = 78;
  const gap = 18;
  const totalW = boxSize * 4 + gap * 3;
  let x = (PAGE_W - totalW) / 2;

  stamps.forEach((s) => {
    doc.roundedRect(x, top, boxSize, boxSize, 4).lineWidth(1.2).stroke(COLOR.gold);
    doc.font('semibold').fontSize(20).fillColor(COLOR.gold);
    // 두 글자를 위아래로 배치 (도장 느낌)
    const chars = String(s.value).split('');
    if (chars.length >= 2) {
      doc.text(chars[0], x, top + 14, { width: boxSize, align: 'center' });
      doc.text(chars.slice(1).join(''), x, top + 42, { width: boxSize, align: 'center' });
    } else {
      doc.text(s.value, x, top + 28, { width: boxSize, align: 'center' });
    }
    doc.font('regular').fontSize(9).fillColor('#B9B6C8');
    doc.text(s.label, x, top + boxSize + 8, { width: boxSize, align: 'center' });
    x += boxSize + gap;
  });
}

// ============================================================
// 컨텐츠 페이지 공통 배경/헤더
// ============================================================
function drawContentChrome(doc, productName, isFirstOfSection) {
  // 종이 배경
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(COLOR.paper);

  // 러닝 헤더
  doc.font('medium').fontSize(8.5).fillColor(COLOR.inkSoft);
  doc.text(`백도령 만세력  ·  ${productName}`, MARGIN, 34, { width: CONTENT_W, align: 'left' });
  doc.moveTo(MARGIN, 50).lineTo(PAGE_W - MARGIN, 50).lineWidth(0.75).stroke(COLOR.gold);

  // 본문 시작 y 좌표 재설정
  doc.y = 68;
  doc.x = MARGIN;
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > PAGE_H - MARGIN - 30) {
    doc.addPage();
  }
}

// ============================================================
// 목차
// ============================================================
function drawTocPage(doc, content) {
  doc.font('extrabold').fontSize(20).fillColor(COLOR.navy);
  doc.text('목차', MARGIN, doc.y + 10);
  doc.moveDown(1.2);

  const items = [];
  (content.sections || []).forEach((s, i) => items.push(`${i + 1}. ${stripHanja(s.heading)}`));
  let n = (content.sections || []).length;
  if (content.monthly && content.monthly.length) items.push(`${n + 1}. 월별 운세 흐름`);
  if (content.closing) items.push(`${items.length + 1}. 마무리 총평`);

  items.forEach((label) => {
    const y = doc.y;
    doc.font('medium').fontSize(12).fillColor(COLOR.ink);
    doc.text(label, MARGIN + 6, y, { width: CONTENT_W - 12 });
    doc.moveTo(MARGIN, doc.y + 6).lineTo(PAGE_W - MARGIN, doc.y + 6).lineWidth(0.4).stroke('#D8CDA8');
    doc.moveDown(0.9);
  });
}

// ============================================================
// 섹션 본문
// ============================================================
function drawSectionHeading(doc, text) {
  ensureSpace(doc, 60);
  const y = doc.y + 4;
  doc.rect(MARGIN, y + 2, 4, 20).fill(COLOR.gold);
  doc.font('bold').fontSize(16.5).fillColor(COLOR.navy);
  doc.text(text, MARGIN + 14, y, { width: CONTENT_W - 14 });
  doc.moveDown(0.35);
}

// 폰트(Pretendard)가 한자 글리프를 지원하지 않아, 혹시 AI 응답에 한자가 섞여 들어와도
// 깨진 네모(tofu)로 보이지 않도록 렌더링 직전에 한자만 제거하는 안전장치
function stripHanja(text) {
  return String(text || '').replace(/[\u4E00-\u9FFF\u3400-\u4DBF]/g, '');
}

function drawBodyParagraphs(doc, bodyText) {
  const paragraphs = stripHanja(bodyText)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  doc.font('regular').fontSize(12.5).fillColor(COLOR.ink);
  paragraphs.forEach((p) => {
    doc.text(p, MARGIN, doc.y, { width: CONTENT_W, align: 'left', lineGap: 6.5 });
    doc.moveDown(0.35);
  });
}

function drawMonthlyBlock(doc, m) {
  ensureSpace(doc, 56);
  const y = doc.y + 4;
  doc.roundedRect(MARGIN, y, 48, 22, 3).fill(COLOR.navy);
  doc.font('semibold').fontSize(11).fillColor(COLOR.gold);
  doc.text(m.month, MARGIN, y + 5.5, { width: 48, align: 'center' });

  doc.font('regular').fontSize(11.5).fillColor(COLOR.ink);
  doc.text(stripHanja(m.text), MARGIN + 60, y + 3, { width: CONTENT_W - 60, lineGap: 5 });
  doc.moveDown(0.55);
}

function drawClosingBox(doc, closingTextRaw) {
  const closingText = stripHanja(closingTextRaw);
  ensureSpace(doc, 120);
  const boxY = doc.y;
  doc.font('bold').fontSize(13).fillColor(COLOR.navy);
  doc.text('마무리 총평', MARGIN, boxY);
  doc.moveDown(0.5);

  const textY = doc.y;
  doc.font('regular').fontSize(11).fillColor(COLOR.ink);
  const textHeight = doc.heightOfString(closingText, { width: CONTENT_W - 32, lineGap: 5 });

  doc.roundedRect(MARGIN, textY - 4, CONTENT_W, textHeight + 32, 6).lineWidth(1).stroke(COLOR.gold);
  doc.text(closingText, MARGIN + 16, textY + 12, { width: CONTENT_W - 32, lineGap: 5 });
  doc.y = textY + textHeight + 40;

  doc.font('medium').fontSize(9).fillColor(COLOR.inkSoft);
  doc.text('— 백도령 만세력 드림', MARGIN, doc.y + 4, { width: CONTENT_W, align: 'right' });
}

// ============================================================
// 페이지 번호
// ============================================================
function stampPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = 0; i < total; i++) {
    doc.switchToPage(i);
    if (i === 0) continue; // 표지는 번호 생략
    // 페이지 하단 여백(margin.bottom) 밖에 텍스트를 찍으면 pdfkit이 "안 들어간다"고
    // 판단해 새 페이지를 추가해버리므로, 스탬프를 찍는 동안만 하단 여백을 0으로 둔다.
    const prevBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('regular').fontSize(8.5).fillColor(COLOR.inkSoft);
    doc.text(`${i} / ${total - 1}`, 0, PAGE_H - 40, { width: PAGE_W, align: 'center' });
    doc.page.margins.bottom = prevBottom;
  }
}

function formatDate(d) {
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

module.exports = { generateFortunePdf };
