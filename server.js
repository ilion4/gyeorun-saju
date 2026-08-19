require('dotenv').config();
const express = require('express');
const { getSaju } = require('./lib/saju.js');
const store = require('./lib/store.js');
const KoreanLunarCalendar = require('korean-lunar-calendar');
const { generateFortunePdf } = require('./lib/pdf.js');
const { getTodayFortune } = require('./lib/today-fortune.js');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || 'test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'gyeorun@example.com';
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();

// -------------------- 무통장입금 계좌 정보 --------------------
const BANK_NAME = process.env.BANK_NAME || '은행명 미설정';
const BANK_ACCOUNT_NO = process.env.BANK_ACCOUNT_NO || '000-000-000000';
const BANK_HOLDER = process.env.BANK_HOLDER || '예금주 미설정';
// 뱅크다가 우리 서버를 호출할 때 URL에 이 값을 넣어서 아무나 호출 못 하게 막는 용도.
// 뱅크다 상점관리 화면에 URL 등록할 때 이 값 그대로 넣으면 됨 (예: https://내주소/api/bankda/여기에값/pending-orders)
const BANKDA_SECRET = (process.env.BANKDA_SECRET || 'change-me').trim();

// 실패 시 재시도 간격: 1분 -> 5분 -> 15분, 그 후엔 자동 재시도 중단(관리자가 수동 재발송)
const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

// -------------------- 0) 음력 -> 양력 변환 --------------------
app.post('/api/lunar-to-solar', (req, res) => {
  const { year, month, day, isLeap } = req.body;
  if (!year || !month || !day) return res.status(400).json({ message: '생년월일을 입력해주세요.' });
  try {
    const cal = new KoreanLunarCalendar();
    const ok = cal.setLunarDate(Number(year), Number(month), Number(day), !!isLeap);
    if (!ok) return res.status(400).json({ message: '유효하지 않은 음력 날짜예요. (윤달 여부를 확인해주세요)' });
    const solar = cal.getSolarCalendar();
    res.json({ year: solar.year, month: solar.month, day: solar.day });
  } catch (err) {
    res.status(400).json({ message: '음력 날짜 변환에 실패했어요. 날짜를 다시 확인해주세요.' });
  }
});

// -------------------- 0-1) 무통장입금 계좌 안내 --------------------
app.get('/api/bank-info', (req, res) => {
  res.json({ bankName: BANK_NAME, accountNo: BANK_ACCOUNT_NO, holder: BANK_HOLDER });
});

// -------------------- 0-2) 오늘의 운세 (무료 코너, 하루 1회만 AI 호출) --------------------
app.get('/api/today-fortune', async (req, res) => {
  try {
    const data = await getTodayFortune(callClaude, !!ANTHROPIC_API_KEY);
    res.json(data);
  } catch (err) {
    console.error('[오늘의운세 생성 실패]', err.message);
    res.status(500).json({ message: '오늘의 운세를 불러오지 못했어요. 잠시 후 다시 시도해주세요.' });
  }
});

// -------------------- 1) 주문 생성 --------------------
app.post('/api/orders', (req, res) => {
  const { orderId, fortune, self, partner, email, depositorName } = req.body;
  if (!orderId || !fortune || !self || !email) {
    return res.status(400).json({ message: '주문 정보가 올바르지 않습니다.' });
  }
  // 무통장입금 방식이라 입금자명이 반드시 있어야 뱅크다가 자동으로 매칭할 수 있음
  if (!depositorName) {
    return res.status(400).json({ message: '입금자명을 입력해주세요.' });
  }
  store.createOrder(orderId, { fortune, self, partner, email, depositorName, paymentMethod: 'bank_transfer' });
  res.json({ ok: true });
});

// -------------------- 2) 토스 결제 승인 --------------------
app.post('/api/payments/confirm', async (req, res) => {
  const { paymentKey, orderId, amount } = req.body;
  const order = store.getOrder(orderId);
  if (!order) return res.status(404).json({ message: '주문을 찾을 수 없습니다.' });
  if (order.fortune.price !== amount) {
    return res.status(400).json({ message: '결제 금액이 일치하지 않습니다.' });
  }

  try {
    const tossRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(TOSS_SECRET_KEY + ':').toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });
    const tossData = await tossRes.json();
    if (!tossRes.ok) {
      return res.status(400).json({ message: tossData.message || '결제 승인에 실패했습니다.' });
    }

    store.updateOrder(orderId, { paid: true, paymentKey });

    // 응답은 즉시 반환하고, 풀이 생성+발송은 비동기로 진행 (사용자 대기시간 단축)
    res.json({ ok: true, email: order.email });
    generateAndSend(orderId);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '결제 승인 처리 중 오류가 발생했습니다.' });
  }
});

// -------------------- 2-1) 뱅크다 자동 입금확인 연동 --------------------
// 뱅크다 서버가 우리 서버에 요청을 보내는 3개 API. URL에 포함된 :secret 값이 안 맞으면 401로 거절한다.
function checkBankdaSecret(req, res, next) {
  const given = (req.params.secret || '').trim();
  if (given !== BANKDA_SECRET) {
    console.warn(`[뱅크다 인증 실패] 받은 값: "${given}" (길이 ${given.length}) / 등록된 값 길이 ${BANKDA_SECRET.length}`);
    return res.status(401).json({ return_code: 401, description: '인증 정보 오류' });
  }
  next();
}

// 뱅크다가 요구하는 "YYYY-MM-DD HH:mm:ss" (한국시간) 형식으로 변환
function formatBankdaDate(ms) {
  const kst = new Date(ms + 9 * 60 * 60 * 1000); // UTC -> KST 보정
  const pad = (n) => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}`;
}

// 주문 1건을 뱅크다 규격(orders 배열의 원소 형태)으로 변환
function toBankdaOrder(order) {
  return {
    order_id: order.orderId,
    buyer_name: order.self.name,
    billing_name: order.depositorName || order.self.name, // 입금자명(결제자명)
    bank_account_no: BANK_ACCOUNT_NO,
    bank_code_name: BANK_NAME,
    order_price_amount: order.fortune.price,
    order_date: formatBankdaDate(order.createdAt),
    items: [{ product_name: order.fortune.name }],
  };
}

// (1) 미확인주문리스트 — 아직 입금 확인 안 된 주문들을 뱅크다에 알려줌
app.post('/api/bankda/:secret/pending-orders', checkBankdaSecret, (req, res) => {
  const orders = store.listUnpaidOrders().map(toBankdaOrder);
  res.json({ orders });
});

// (2) 주문상세 — 특정 주문 1건의 상세 정보를 알려줌
app.post('/api/bankda/:secret/order-detail', checkBankdaSecret, (req, res) => {
  const { order_id } = req.body;
  const order = store.getOrder(order_id);
  if (!order) return res.status(415).json({ return_code: 415, description: '존재하지 않는 주문번호' });
  res.json({ order: toBankdaOrder(order) });
});

// (3) 입금확인 — 뱅크다가 입금-주문 매칭에 성공한 건들을 알려주면, 그 주문들을 결제완료 처리하고 발송 시작
app.put('/api/bankda/:secret/confirm', checkBankdaSecret, (req, res) => {
  const { requests } = req.body;
  if (!Array.isArray(requests)) {
    return res.status(400).json({ return_code: 400, description: '요청 format 오류' });
  }

  const results = requests.map(({ order_id }) => {
    const order = store.getOrder(order_id);
    if (!order) return { order_id, description: '실패 — 존재하지 않는 주문번호' };
    if (order.paid) return { order_id, description: '실패 — 이미 입금확인 처리된 주문' };

    store.updateOrder(order_id, { paid: true, paidVia: 'bankda', paidAt: Date.now() });
    generateAndSend(order_id); // 비동기로 PDF 생성 + 이메일 발송 시작
    return { order_id, description: '성공' };
  });

  res.json({ return_code: 200, description: '정상', orders: results });
});

// -------------------- 3) AI 풀이 생성 + 이메일 발송 (+ 실패시 자동 재시도) --------------------
async function generateAndSend(orderId) {
  const order = store.getOrder(orderId);
  if (!order || !order.paid) return;
  if (order.sendStatus === 'sent') return; // 이미 성공적으로 보낸 건 다시 안 보냄

  const attemptNo = (order.sendAttempts || 0) + 1;
  store.updateOrder(orderId, { sendStatus: 'pending', sendAttempts: attemptNo, lastAttemptAt: Date.now() });
  console.log(`[발송 시도 ${attemptNo}/${MAX_ATTEMPTS}] ${orderId}`);

  try {
    const selfSaju = buildSajuText('본인', order.self);
    const partnerSaju = order.fortune.needsPartner && order.partner
      ? buildSajuText('상대방', order.partner)
      : '';

    // 티어(간략/심도)별 분량 — 주문에 값이 없는 옛 주문 호환용 기본값도 함께 지정
    // ※ 이 charMin/charMax는 "sections 본문 합계" 기준. 목차/월별운세/마무리는 아래에서 별도 자리수로 지정한다.
    // (PDF 페이지 수를 실측으로 맞춘 값: 간략=표지+목차+본문3장=총5쪽, 심도=표지+목차+본문6장(월별운세 포함)=총8쪽)
    const charMin = order.fortune.charMin || 3800;
    const charMax = order.fortune.charMax || 4300;
    // JSON 구조 + 심도 티어의 12개월 월별운세까지 담아야 해서 기존 예산보다 여유를 둔다
    const maxTokens = Math.ceil((order.fortune.maxTokens || 3600) * 1.4) + 500;
    const isDeep = order.fortune.tierKey === 'deep';
    const productName = order.fortune.baseName || order.fortune.name;

    // 상품별로 AI가 놓치기 쉬운 세부 주제를 명시적으로 짚어주는 보강 지침.
    // (예: "애정운/결혼운"은 이름에 결혼이 들어가 있어도 AI가 연애 위주로만 쓰는 경우가 있어 별도로 강조)
    const FORTUNE_FOCUS_NOTES = {
      love: '- "애정운/결혼운" 상품이므로 연애 흐름만이 아니라 결혼 관련 내용도 반드시 함께 다룰 것: 결혼 시기·배우자 인연이 들어오는 흐름, (기혼자라면) 결혼 생활의 흐름과 유의할 점까지 포함',
      compat: '- 두 사람의 궁합뿐 아니라 관계가 결혼까지 이어질 경우의 흐름도 함께 언급할 것',
    };
    const focusNote = FORTUNE_FOCUS_NOTES[order.fortune.id] || '';

    const prompt = `당신은 30년 경력의 사주 명리학 상담가입니다. 아래 사주 정보를 바탕으로 "${productName}" 풀이를 작성하세요. 이 결과는 PDF 리포트(A4, 표지·목차 포함 총 ${isDeep ? '8' : '5'}쪽 분량)로 만들어지므로, 반드시 아래 JSON 형식으로만 응답하세요. JSON 앞뒤로 다른 설명이나 마크다운 코드블록(\`\`\`)을 절대 넣지 마세요.

${selfSaju}
${partnerSaju}

응답 JSON 스키마:
{
  "subtitle": "표지에 들어갈 한 줄 요약, 25자 이내",
  "sections": [
    { "heading": "소제목", "body": "본문 (문단이 여러 개면 \\n\\n으로 구분)" }
  ],
  ${isDeep ? `"monthly": [ { "month": "1월", "text": "그 달의 흐름과 조언" }, ... 1월부터 12월까지 총 12개 항목 ],
  ` : ''}"closing": "마무리 총평"
}

분량 지침 (아래 자리수를 반드시 지킬 것 — 페이지 수가 정확히 맞아야 함):
- sections 본문 텍스트 합계: ${charMin}~${charMax}자 (공백 포함, 소제목 글자는 제외)
${isDeep ? `- monthly 각 항목: 70~85자씩, 12개 전부 채울 것 (합계 약 840~1,020자)
- closing: 200~260자` : `- closing: 120~180자`}
- 빈 문장이나 늘어지는 수사로 채우지 말고, 지정된 자리수 안에서 내용을 실제로 촘촘하게 채울 것 (여백 없이 알찬 문장으로)

작성 지침:
- 존댓말, 따뜻하지만 구체적인 어조
- 한자(漢字)는 절대 쓰지 말 것 — 오행(목·화·토·금·수), 육친 등 명리학 용어도 반드시 한글로만 표기 (PDF 폰트가 한자를 지원하지 않아 깨져 보임)
${focusNote ? focusNote + '\n' : ''}${isDeep ? `- sections는 아래 4개 구성으로 작성:
  1) 타고난 사주 원국 풀이 (일간 중심 성향 분석)
  2) ${productName}와 직접 관련된 심층 해석
  3) 올해~내년 흐름 (대운/세운 관점, 시기별 조언)
  4) 주의할 점과 활용하면 좋은 점
- monthly는 반드시 1월부터 12월까지 12개 모두 채울 것` : `- sections는 3개로 구성 (예: ①타고난 성향과 사주 원국 ②${productName} 심층 해석 ③주의할 점과 활용하면 좋은 점), 소제목도 함께 작성`}
- 추상적인 말 대신 실제 생활에 적용 가능한 구체적 조언 포함
- 미신적 확신("반드시 ~됩니다") 대신 "~한 흐름이 보입니다" 톤 유지
- 지정된 분량을 정확히 채우되 내용을 억지로 반복하거나 늘리지 말 것`;

    console.log(`[1/3 AI 풀이 생성 시작] ${orderId}`);
    const rawResponse = ANTHROPIC_API_KEY ? await callClaude(prompt, maxTokens) : demoFortuneJson(order, isDeep);
    const content = parseFortuneJson(rawResponse);
    console.log(`[1/3 AI 풀이 생성 완료] ${orderId}`);

    const sajuMeta = buildSajuMeta(order.self);
    console.log(`[2/3 PDF 생성 시작] ${orderId}`);
    const pdfBuffer = await generateFortunePdf({ order, saju: sajuMeta, content });
    console.log(`[2/3 PDF 생성 완료] ${orderId}`);
    // 파일명에 못 쓰는 문자(/, \, :, * 등)가 상품명에 섞여 있어도 안전하도록 정리
    // (예: "애정운/결혼운" → "애정운_결혼운")
    const safeProductName = productName.replace(/[\\/:*?"<>|]/g, '_');
    const fileName = `백도령만세력_${order.self.name}_${safeProductName}.pdf`;

    console.log(`[3/3 이메일 발송 시작] ${orderId}`);
    await sendEmail(order.email, order.self.name, order.fortune.name, pdfBuffer, fileName);
    console.log(`[3/3 이메일 발송 완료] ${orderId}`);

    store.updateOrder(orderId, { sendStatus: 'sent', sentAt: Date.now(), lastError: null, nextRetryAt: null });
    console.log(`[발송 성공] ${orderId}`);
  } catch (err) {
    console.error(`[발송 실패 ${attemptNo}/${MAX_ATTEMPTS}]`, orderId, err.message);
    const willRetry = attemptNo < MAX_ATTEMPTS;
    const nextRetryAt = willRetry ? Date.now() + RETRY_DELAYS_MS[attemptNo - 1] : null;
    store.updateOrder(orderId, {
      sendStatus: 'failed',
      lastError: err.message || String(err),
      nextRetryAt,
    });
    if (willRetry) {
      console.log(`[재시도 예약] ${orderId} -> ${RETRY_DELAYS_MS[attemptNo - 1] / 1000}초 뒤`);
      setTimeout(() => generateAndSend(orderId), RETRY_DELAYS_MS[attemptNo - 1]);
    } else {
      console.error(`[자동 재시도 종료] ${orderId} — 관리자 페이지에서 수동 재발송 필요`);
    }
  }
}

// 서버가 재시작돼도 "재시도 예약이 밀린" 주문들을 찾아서 다시 돌려줌
function resumePendingRetries() {
  const now = Date.now();
  for (const order of store.listOrders()) {
    if (order.paid && order.sendStatus === 'failed' && order.sendAttempts < MAX_ATTEMPTS && order.nextRetryAt) {
      const delay = Math.max(0, order.nextRetryAt - now);
      setTimeout(() => generateAndSend(order.orderId), delay);
    }
  }
}

function buildSajuText(label, person) {
  const [y, m, d] = person.bdate.split('-').map(Number);
  const [hh, mm] = (person.btime || '12:00').split(':').map(Number);
  const timeUnknown = person.timeKnown === false;
  const saju = getSaju(y, m, d, timeUnknown ? 12 : hh, mm);
  const timeDesc = timeUnknown
    ? '(시간 모름)'
    : person.sijinLabel
      ? `약 ${person.btime} (${person.sijinLabel} 추정)`
      : person.btime;
  return `[${label}: ${person.name}]
생년월일시: ${person.bdate} ${timeDesc}
사주 8자 — 년주:${saju.year.ganji} 월주:${saju.month.ganji} 일주:${saju.day.ganji} 시주:${timeUnknown ? '(시간모름, 참고용 정오 기준)' + saju.hour.ganji : saju.hour.ganji}`;
}

// PDF 표지에 쓸 사주 8자 + 생년월일시 표기를 만든다 (buildSajuText와 계산 로직은 동일, 출력 형태만 PDF용)
function buildSajuMeta(person) {
  const [y, m, d] = person.bdate.split('-').map(Number);
  const [hh, mm] = (person.btime || '12:00').split(':').map(Number);
  const timeUnknown = person.timeKnown === false;
  const saju = getSaju(y, m, d, timeUnknown ? 12 : hh, mm);
  const [yy, mo, dd] = person.bdate.split('-').map(Number);
  const timeLabel = timeUnknown
    ? '시간 모름 (정오 기준 참고용)'
    : person.sijinLabel
      ? `약 ${person.btime} (${person.sijinLabel})`
      : `${person.btime}`;
  return {
    year: saju.year.ganji,
    month: saju.month.ganji,
    day: saju.day.ganji,
    hour: saju.hour.ganji,
    bdateLabel: `${yy}년 ${mo}월 ${dd}일 · ${timeLabel}`,
  };
}

// Claude 응답(JSON 문자열)을 안전하게 파싱한다. 형식이 어긋나도 PDF 발송 자체는 막히지 않도록,
// 실패 시 원문을 통째로 하나의 섹션에 담아 반환한다.
function parseFortuneJson(raw) {
  let cleaned = String(raw || '').trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
      throw new Error('sections가 비어있거나 없음');
    }
    return parsed;
  } catch (err) {
    console.error('[JSON 파싱 실패 — 원문을 단일 섹션으로 대체]', err.message);
    return { subtitle: '', sections: [{ heading: '풀이', body: cleaned || '풀이 생성에 문제가 있었습니다.' }], closing: '' };
  }
}

async function callClaude(prompt, maxTokens = 1700) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'AI 풀이 생성 실패');
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!text) throw new Error('AI 응답이 비어있습니다');
  return text;
}

// ANTHROPIC_API_KEY 미설정 상태에서도 PDF 파이프라인 전체를 테스트해볼 수 있도록 만든 데모용 JSON
function demoFortuneJson(order, isDeep) {
  const productName = order?.fortune?.baseName || order?.fortune?.name || '풀이';
  const base = {
    subtitle: '실제 서비스에서는 AI가 생성한 한 줄 요약이 이 자리에 표시됩니다',
    sections: [
      {
        heading: '데모 풀이 안내',
        body: `[데모 풀이 — ANTHROPIC_API_KEY 미설정 상태입니다]\n\n${order?.self?.name || '고객'}님의 "${productName}" 풀이입니다. 실제 서비스에서는 이 자리에 사주 8자를 바탕으로 한 AI 해석이 생성되어 도착합니다.\n\n.env 파일에 ANTHROPIC_API_KEY를 설정하면 실제 해석이 PDF로 발송됩니다.`,
      },
    ],
    closing: '이 문서는 데모용으로 생성된 예시입니다.',
  };
  if (isDeep) {
    base.monthly = Array.from({ length: 12 }).map((_, i) => ({
      month: `${i + 1}월`,
      text: 'ANTHROPIC_API_KEY 설정 후에는 이 자리에 해당 월의 실제 흐름과 조언이 채워집니다.',
    }));
  }
  return JSON.stringify(base);
}

// -------------------- 4) 이메일 발송 --------------------
// SMTP(465/587)가 Railway 등 일부 클라우드 호스팅에서 통째로 막혀있는 경우가 많아서,
// Resend의 HTTP API(HTTPS 요청)로 직접 보낸다 — AI API 호출과 동일한 방식이라 막힐 일이 없다.
// RESEND_API_KEY가 없으면 기존 호환을 위해 SMTP_PASS 값을 그대로 사용한다 (Resend에서는 API 키와 SMTP 비밀번호가 같은 값).
const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.SMTP_PASS || '';

async function sendEmail(to, name, fortuneName, pdfBuffer, fileName) {
  const shortBody = `${name}님, 신청하신 "${fortuneName}" 풀이가 도착했어요.

첨부된 PDF 파일을 열어 확인해주세요.

감사합니다.
백도령 만세력 드림`;

  if (!RESEND_API_KEY) {
    console.log(`[이메일 미설정 - 콘솔 출력] to:${to}\n${shortBody}\n(PDF 첨부: ${fileName}, ${pdfBuffer.length} bytes)`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `백도령 만세력 <${MAIL_FROM}>`,
      to: [to],
      subject: `[백도령 만세력] ${name}님의 ${fortuneName} 풀이가 도착했어요`,
      text: shortBody,
      html: `<div style="font-family:sans-serif; line-height:1.8; white-space:pre-wrap;">${shortBody}</div>`,
      attachments: [{ filename: fileName, content: pdfBuffer.toString('base64') }],
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`[이메일 발송 실패] Resend API ${res.status} — ${data.message || JSON.stringify(data)}`);
  }
}

// -------------------- 5) 관리자: 발송 로그 조회 / 수동 재발송 --------------------
function checkAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ message: '.env 에 ADMIN_PASSWORD를 설정해야 관리자 페이지를 쓸 수 있어요.' });
  }
  const given = (req.get('x-admin-password') || '').trim();
  if (given !== ADMIN_PASSWORD) {
    console.warn(`[관리자 인증 실패] ${req.method} ${req.path} — 받은 값 길이 ${given.length} / 등록된 값 길이 ${ADMIN_PASSWORD.length}`);
    return res.status(401).json({ message: '비밀번호가 올바르지 않습니다.' });
  }
  next();
}

app.get('/api/admin/orders', checkAdmin, (req, res) => {
  const orders = store.listOrders().map((o) => ({
    orderId: o.orderId,
    name: o.self?.name,
    email: o.email,
    fortune: o.fortune?.name,
    price: o.fortune?.price,
    paid: o.paid,
    sendStatus: o.sendStatus,
    sendAttempts: o.sendAttempts,
    lastError: o.lastError,
    lastAttemptAt: o.lastAttemptAt,
    sentAt: o.sentAt,
    nextRetryAt: o.nextRetryAt,
    createdAt: o.createdAt,
  }));
  res.json({ orders });
});

app.post('/api/admin/orders/:orderId/resend', checkAdmin, (req, res) => {
  const order = store.getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ message: '주문을 찾을 수 없습니다.' });
  if (!order.paid) return res.status(400).json({ message: '결제가 확인되지 않은 주문입니다.' });
  // 재발송은 시도횟수를 다시 세도록 초기화하고 즉시 실행
  store.updateOrder(req.params.orderId, { sendAttempts: 0, sendStatus: 'not_sent', nextRetryAt: null });
  generateAndSend(req.params.orderId);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`백도령 만세력 서버 실행 중 http://localhost:${PORT}`);
  resumePendingRetries();
});
