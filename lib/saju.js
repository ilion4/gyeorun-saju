/**
 * saju.js — 만세력(사주 8자) 계산 모듈
 *
 * ⚠️ 정확도 안내
 * - 일주(日柱)는 율리우스적일수(JDN) 기반이라 정확합니다.
 * - 년주/월주 경계는 실제 절입시각(입춘/경칩 등)을 써야 100% 정확합니다.
 *   여기서는 매년 거의 고정된 "평균 절기 날짜"를 사용한 근사치입니다.
 *   대부분의 해에 문제없지만, 절기 경계(예: 입춘 2/3~2/5) 근처 출생자는
 *   드물게 하루 오차가 날 수 있습니다.
 *   상용 서비스로 정밀도를 높이려면 한국천문연구원(KASI) 절기 API 또는
 *   정밀 천문 계산 라이브러리(예: astronomia)로 교체하세요.
 */

const STEMS = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
const BRANCHES = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];

// 절기(절/節) 근사 날짜: [월, 일] — 해당 날짜부터 새 월지(月支) 시작
const SOLAR_TERMS = [
  { branchIdx: 2, month: 2, day: 4 },  // 입춘 -> 인월
  { branchIdx: 3, month: 3, day: 6 },  // 경칩 -> 묘월
  { branchIdx: 4, month: 4, day: 5 },  // 청명 -> 진월
  { branchIdx: 5, month: 5, day: 6 },  // 입하 -> 사월
  { branchIdx: 6, month: 6, day: 6 },  // 망종 -> 오월
  { branchIdx: 7, month: 7, day: 7 },  // 소서 -> 미월
  { branchIdx: 8, month: 8, day: 8 },  // 입추 -> 신월
  { branchIdx: 9, month: 9, day: 8 },  // 백로 -> 유월
  { branchIdx: 10, month: 10, day: 8 }, // 한로 -> 술월
  { branchIdx: 11, month: 11, day: 7 }, // 입동 -> 해월
  { branchIdx: 0, month: 12, day: 7 },  // 대설 -> 자월
  { branchIdx: 1, month: 1, day: 6 },   // 소한 -> 축월
];

// 월지 순서(인=0 기준) — 월간(月干) 계산에 사용
const MONTH_ORDER_FROM_IN = { 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8, 11: 9, 0: 10, 1: 11 };

function toJDN(y, m, d) {
  // Fliegel & Van Flandern 공식 (그레고리력 -> 율리우스적일수)
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

/** 생년월일시(양력, 로컬시각) -> 사주 8자 */
function getSaju(year, month, day, hour, minute = 0) {
  // 1) 절기 기준 사주년(입춘 이전 출생이면 전년도로 취급)
  const ipchun = new Date(year, 1, 4); // 2/4 근사
  const birth = new Date(year, month - 1, day, hour, minute);
  let sajuYear = year;
  if (birth < ipchun) sajuYear -= 1;

  // 2) 년주(年柱)
  const yStemIdx = (sajuYear - 4) % 10 >= 0 ? (sajuYear - 4) % 10 : (sajuYear - 4) % 10 + 10;
  const yBranchIdx = (sajuYear - 4) % 12 >= 0 ? (sajuYear - 4) % 12 : (sajuYear - 4) % 12 + 12;

  // 3) 월지(月支) — 생일이 속한 절기 구간 찾기
  //    당해년도 절기들 + 전년도 대설(12/7, 자월 시작)까지 포함해 시간순 정렬 후
  //    출생일 이전(<=) 가장 마지막 절기를 채택
  const candidates = [
    { branchIdx: 0, date: new Date(year - 1, 11, 7) }, // 전년도 대설
    ...SOLAR_TERMS.map((t) => ({ branchIdx: t.branchIdx, date: new Date(year, t.month - 1, t.day) })),
  ].sort((a, b) => a.date - b.date);

  let monthBranchIdx = candidates[0].branchIdx;
  for (const c of candidates) {
    if (birth >= c.date) monthBranchIdx = c.branchIdx;
    else break;
  }

  // 4) 월간(月干) — 오호둔 규칙
  const monthBase = ((yStemIdx % 5) * 2 + 2) % 10;
  const monthOrder = MONTH_ORDER_FROM_IN[monthBranchIdx];
  const monthStemIdx = (monthBase + monthOrder) % 10;

  // 5) 일주(日柱) — JDN 기반, 1900-01-31 = 갑자일(offset 0) 기준
  const jdn = toJDN(year, month, day);
  const refJdn = toJDN(1900, 1, 31);
  let offset = (jdn - refJdn) % 60;
  if (offset < 0) offset += 60;
  const dStemIdx = offset % 10;
  const dBranchIdx = offset % 12;

  // 6) 시주(時柱)
  // 23:00~00:59=자, 01:00~02:59=축 ... 2시간 단위
  const adjHour = (hour + 1) % 24; // 23시를 다음 블록(자시)으로 밀기 위한 보정
  const hBranchIdx = Math.floor(adjHour / 2);
  const hourBase = ((dStemIdx % 5) * 2) % 10;
  const hStemIdx = (hourBase + hBranchIdx) % 10;

  const pillar = (s, b) => `${STEMS[s]}${BRANCHES[b]}`;

  return {
    sajuYear,
    year: { stem: STEMS[yStemIdx], branch: BRANCHES[yBranchIdx], ganji: pillar(yStemIdx, yBranchIdx) },
    month: { stem: STEMS[monthStemIdx], branch: BRANCHES[monthBranchIdx], ganji: pillar(monthStemIdx, monthBranchIdx) },
    day: { stem: STEMS[dStemIdx], branch: BRANCHES[dBranchIdx], ganji: pillar(dStemIdx, dBranchIdx) },
    hour: { stem: STEMS[hStemIdx], branch: BRANCHES[hBranchIdx], ganji: pillar(hStemIdx, hBranchIdx) },
  };
}

module.exports = { getSaju, STEMS, BRANCHES };
