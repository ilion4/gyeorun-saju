// ---------- 별 배경 ----------
(function stars() {
  const wrap = document.getElementById('stars');
  for (let i = 0; i < 40; i++) {
    const s = document.createElement('span');
    s.style.left = Math.random() * 100 + '%';
    s.style.top = Math.random() * 100 + '%';
    s.style.animationDelay = (Math.random() * 4) + 's';
    wrap.appendChild(s);
  }
})();

// ---------- 상품 정의 ----------
// 운세 종류마다 "간략하게(A4 약 1장)" / "심도있게(A4 약 4장)" 두 옵션 제공
const TIER_BRIEF = { key: 'brief', label: '간략하게', pageDesc: 'A4 약 5장(표지·목차 포함)', charMin: 3800, charMax: 4300, maxTokens: 3600 };
const TIER_DEEP  = { key: 'deep',  label: '심도있게', pageDesc: 'A4 약 8장(표지·목차 포함)', charMin: 6800, charMax: 7600, maxTokens: 7200 };

const FORTUNES = [
  { id: 'compat',  name: '궁합',   img: '/media/fortune-compat.jpg',  priceBrief: 4900,  priceDeep: 9900, desc: '두 사람의 사주로 보는 궁합', needsPartner: true },
  { id: 'reunion', name: '재회운', img: '/media/fortune-reunion.jpg', priceBrief: 4900,  priceDeep: 9900, desc: '헤어진 인연, 다시 이어질까' },
  { id: 'newyear', name: '신년운', img: '/media/fortune-newyear.jpg', priceBrief: 4900,  priceDeep: 9900, desc: '올해 나에게 다가올 흐름' },
  { id: 'love',    name: '애정운/결혼운', img: '/media/fortune-love.jpg',    priceBrief: 4900,  priceDeep: 9900, desc: '지금 내 연애와 결혼의 흐름' },
  { id: 'money',   name: '재물운', img: '/media/fortune-money.jpg',   priceBrief: 4900,  priceDeep: 9900, desc: '돈이 들어오고 나가는 흐름' },
  { id: 'career',  name: '취업/사업운', img: '/media/fortune-career.jpg', priceBrief: 4900, priceDeep: 9900, desc: '일과 커리어의 방향' },
  { id: 'dates',   name: '택일',   img: null, emoji: '📅', priceBrief: 4900, priceDeep: 9900, desc: '결혼·이사·개업 좋은 날짜 추천', needsDateSelection: true },
  { id: 'lifetime', name: '평생사주', img: null, emoji: '🌳', priceBrief: 4900, priceDeep: 9900, desc: '타고난 사주로 보는 인생 전체 흐름' },
];

const state = {
  step: 1,
  fortune: null,
  gender: 'M',
  self: {},
  partner: {},
  email: '',
};

// ---------- 사주 계산 (lib/saju.js와 동일 로직의 브라우저 버전) ----------
const STEMS = ['갑','을','병','정','무','기','경','신','임','계'];
const BRANCHES = ['자','축','인','묘','진','사','오','미','신','유','술','해'];
const SOLAR_TERMS = [
  { branchIdx: 2, month: 2, day: 4 }, { branchIdx: 3, month: 3, day: 6 },
  { branchIdx: 4, month: 4, day: 5 }, { branchIdx: 5, month: 5, day: 6 },
  { branchIdx: 6, month: 6, day: 6 }, { branchIdx: 7, month: 7, day: 7 },
  { branchIdx: 8, month: 8, day: 8 }, { branchIdx: 9, month: 9, day: 8 },
  { branchIdx: 10, month: 10, day: 8 }, { branchIdx: 11, month: 11, day: 7 },
  { branchIdx: 0, month: 12, day: 7 }, { branchIdx: 1, month: 1, day: 6 },
];
const MONTH_ORDER_FROM_IN = { 2:0,3:1,4:2,5:3,6:4,7:5,8:6,9:7,10:8,11:9,0:10,1:11 };

function toJDN(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

function getSaju(year, month, day, hour, minute = 0) {
  const ipchun = new Date(year, 1, 4);
  const birth = new Date(year, month - 1, day, hour, minute);
  let sajuYear = year;
  if (birth < ipchun) sajuYear -= 1;

  const mod = (n, m) => ((n % m) + m) % m;
  const yStemIdx = mod(sajuYear - 4, 10);
  const yBranchIdx = mod(sajuYear - 4, 12);

  const candidates = [
    { branchIdx: 0, date: new Date(year - 1, 11, 7) },
    ...SOLAR_TERMS.map((t) => ({ branchIdx: t.branchIdx, date: new Date(year, t.month - 1, t.day) })),
  ].sort((a, b) => a.date - b.date);
  let monthBranchIdx = candidates[0].branchIdx;
  for (const c of candidates) { if (birth >= c.date) monthBranchIdx = c.branchIdx; else break; }

  const monthBase = (mod(yStemIdx, 5) * 2 + 2) % 10;
  const monthStemIdx = (monthBase + MONTH_ORDER_FROM_IN[monthBranchIdx]) % 10;

  const jdn = toJDN(year, month, day);
  const refJdn = toJDN(1900, 1, 31);
  const offset = mod(jdn - refJdn, 60);
  const dStemIdx = offset % 10, dBranchIdx = offset % 12;

  const adjHour = mod(hour + 1, 24);
  const hBranchIdx = Math.floor(adjHour / 2);
  const hourBase = mod(dStemIdx, 5) * 2 % 10;
  const hStemIdx = (hourBase + hBranchIdx) % 10;

  const p = (s, b) => STEMS[s] + BRANCHES[b];
  return {
    year: p(yStemIdx, yBranchIdx),
    month: p(monthStemIdx, monthBranchIdx),
    day: p(dStemIdx, dBranchIdx),
    hour: p(hStemIdx, hBranchIdx),
  };
}

// ---------- 렌더: 운세 카드 ----------
// 카드 이미지 자체에 상품명·가격이 이미 디자인되어 있어 별도 텍스트를 얹지 않는다.
// (img가 없는 신규 상품은 디자인 이미지 준비 전까지 이모지+텍스트로 임시 표시)
const grid = document.getElementById('fortuneGrid');
FORTUNES.forEach((f) => {
  const el = document.createElement('div');
  el.className = 'fortune-card';
  if (f.img) {
    el.style.backgroundImage = `url('${f.img}')`;
  } else {
    el.classList.add('fortune-card-fallback');
    el.innerHTML = `<span class="fc-emoji">${f.emoji || '🔮'}</span><span class="fc-name">${f.name}</span><span class="fc-price">${f.priceBrief.toLocaleString()}원~</span>`;
  }
  el.setAttribute('aria-label', `${f.name} ${f.priceBrief.toLocaleString()}원부터`);
  el.addEventListener('click', () => {
    document.querySelectorAll('.fortune-card').forEach((c) => c.classList.remove('selected'));
    el.classList.add('selected');
    if (window.trackEvent) trackEvent('fortune_selected');
    showTierPanel(f);
  });
  grid.appendChild(el);
});

// ---------- 간략하게 / 심도있게 선택 ----------
function showTierPanel(f) {
  const panel = document.getElementById('tierPanel');
  const options = document.getElementById('tierOptions');
  document.getElementById('tierPanelTitle').textContent = `[${f.name}] 어느 정도로 볼까요?`;

  const makeBtn = (tier, price) => {
    const btn = document.createElement('div');
    btn.className = 'tier-btn' + (tier.key === 'deep' ? ' deep' : '');
    btn.innerHTML = `
      <div>
        <div class="t-name">${tier.label}</div>
        <div class="t-desc">${tier.pageDesc} · ${tier.key === 'deep' ? '연도별 흐름까지 상세 풀이' : '핵심만 빠르게'}</div>
      </div>
      <div class="t-price">${price.toLocaleString()}원</div>
    `;
    btn.addEventListener('click', () => {
      state.fortune = {
        id: f.id,
        baseName: f.name,
        name: `${f.name} (${tier.label})`,
        needsPartner: f.needsPartner,
        needsDateSelection: f.needsDateSelection,
        price,
        tierKey: tier.key,
        tierLabel: tier.label,
        charMin: tier.charMin,
        charMax: tier.charMax,
        maxTokens: tier.maxTokens,
      };
      document.getElementById('partnerFieldset').style.display = f.needsPartner ? 'block' : 'none';
      document.getElementById('legend-self').textContent = f.needsPartner ? '본인 정보' : '내 정보';
      document.getElementById('dateSelectionFieldset').style.display = f.needsDateSelection ? 'block' : 'none';
      goTo(2);
    });
    return btn;
  };

  options.innerHTML = '';
  options.appendChild(makeBtn(TIER_BRIEF, f.priceBrief));
  options.appendChild(makeBtn(TIER_DEEP, f.priceDeep));

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// ---------- 시진(時辰) 정의 ----------
const SIJIN = [
  { branch: '자시', range: '23:00~01:00', repHour: 0 },
  { branch: '축시', range: '01:00~03:00', repHour: 2 },
  { branch: '인시', range: '03:00~05:00', repHour: 4 },
  { branch: '묘시', range: '05:00~07:00', repHour: 6 },
  { branch: '진시', range: '07:00~09:00', repHour: 8 },
  { branch: '사시', range: '09:00~11:00', repHour: 10 },
  { branch: '오시', range: '11:00~13:00', repHour: 12 },
  { branch: '미시', range: '13:00~15:00', repHour: 14 },
  { branch: '신시', range: '15:00~17:00', repHour: 16 },
  { branch: '유시', range: '17:00~19:00', repHour: 18 },
  { branch: '술시', range: '19:00~21:00', repHour: 20 },
  { branch: '해시', range: '21:00~23:00', repHour: 22 },
];

// ---------- 생년월일 드롭다운(년/월/일) 초기화 ----------
function initDateSelects(block) {
  const yearSel = block.querySelector('.date-year');
  const monthSel = block.querySelector('.date-month');
  const daySel = block.querySelector('.date-day');
  const hiddenInput = block.querySelector('.bdate-input');

  const thisYear = new Date().getFullYear();
  yearSel.innerHTML = '<option value="">년</option>' +
    Array.from({ length: 100 }, (_, i) => thisYear - i)
      .map((y) => `<option value="${y}">${y}년</option>`).join('');

  monthSel.innerHTML = '<option value="">월</option>' +
    Array.from({ length: 12 }, (_, i) => i + 1)
      .map((m) => `<option value="${m}">${m}월</option>`).join('');

  function daysInMonth(year, month) {
    if (!year || !month) return 31;
    return new Date(Number(year), Number(month), 0).getDate();
  }

  function renderDays() {
    const prevSelected = daySel.value;
    const max = daysInMonth(yearSel.value, monthSel.value);
    daySel.innerHTML = '<option value="">일</option>' +
      Array.from({ length: max }, (_, i) => i + 1)
        .map((d) => `<option value="${d}">${d}일</option>`).join('');
    if (prevSelected && Number(prevSelected) <= max) daySel.value = prevSelected;
  }
  renderDays();

  function syncHidden() {
    const y = yearSel.value, m = monthSel.value, d = daySel.value;
    if (y && m && d) {
      hiddenInput.value = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    } else {
      hiddenInput.value = '';
    }
  }

  yearSel.addEventListener('change', () => { renderDays(); syncHidden(); });
  monthSel.addEventListener('change', () => { renderDays(); syncHidden(); });
  daySel.addEventListener('change', syncHidden);
}
document.querySelectorAll('.person-block').forEach(initDateSelects);

// ---------- 택일 전용: 목적/기간 버튼 ----------
const dateSelection = { purpose: '결혼', rangeMonths: 1 };
document.querySelectorAll('.purpose-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.purpose-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    dateSelection.purpose = btn.dataset.purpose;
  });
});
document.querySelectorAll('.range-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.range-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    dateSelection.rangeMonths = Number(btn.dataset.range);
  });
});

// ---------- 본인/상대방 입력 블록 초기화 (양력↔음력, 시간모드, 시진선택) ----------
document.querySelectorAll('.person-block').forEach((block) => {
  // 양력/음력 토글
  block.querySelectorAll('.cal-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      block.querySelectorAll('.cal-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const isLunar = btn.dataset.cal === 'lunar';
      block.querySelector('.bdate-label').textContent = isLunar ? '생년월일 (음력)' : '생년월일 (양력)';
      block.querySelector('.leap-check').style.display = isLunar ? 'flex' : 'none';
    });
  });

  // 시간 모드 토글 (정확히 / 시진 / 모름)
  const sijinWrap = block.querySelector('.time-sijin-wrap');
  const exactWrap = block.querySelector('.time-exact-wrap');
  const sijinHint = block.querySelector('.sijin-hint');

  SIJIN.forEach((s) => {
    const b = document.createElement('div');
    b.className = 'sijin-btn';
    b.innerHTML = `<div class="s-name">${s.branch}</div><div class="s-range">${s.range}</div>`;
    b.addEventListener('click', () => {
      sijinWrap.querySelectorAll('.sijin-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      block.dataset.sijinBranch = s.branch;
      block.dataset.sijinRepHour = s.repHour;
    });
    sijinWrap.appendChild(b);
  });

  block.querySelectorAll('.tm-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      block.querySelectorAll('.tm-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      block.dataset.timeMode = btn.dataset.mode;
      exactWrap.style.display = btn.dataset.mode === 'exact' ? 'block' : 'none';
      sijinWrap.style.display = btn.dataset.mode === 'sijin' ? 'grid' : 'none';
      if (sijinHint) sijinHint.style.display = btn.dataset.mode === 'sijin' ? 'block' : 'none';
    });
  });
  block.dataset.timeMode = 'exact';
});

// 입력 블록에서 person 데이터 읽기 (양력 변환 필요시 서버에 물어봄)
async function readPersonBlock(blockEl) {
  const calType = blockEl.querySelector('.cal-btn.active').dataset.cal;
  const rawDate = blockEl.querySelector('.bdate-input').value;
  const isLeap = blockEl.querySelector('.leap-input').checked;
  const timeMode = blockEl.dataset.timeMode || 'exact';

  if (!rawDate) return null;
  let [y, m, d] = rawDate.split('-').map(Number);

  if (calType === 'lunar') {
    const res = await fetch('/api/lunar-to-solar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: y, month: m, day: d, isLeap }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || '음력 날짜 변환에 실패했어요.');
    y = data.year; m = data.month; d = data.day;
  }

  const bdate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  let btime = '12:00';
  let timeKnown = true;
  let sijinLabel = null;
  if (timeMode === 'exact') {
    const v = blockEl.querySelector('.btime-input').value;
    if (!v) { timeKnown = false; } else { btime = v; }
  } else if (timeMode === 'sijin') {
    const repHour = blockEl.dataset.sijinRepHour;
    if (repHour === undefined) { timeKnown = false; }
    else { btime = `${String(repHour).padStart(2, '0')}:00`; sijinLabel = blockEl.dataset.sijinBranch; }
  } else {
    timeKnown = false;
  }

  return { bdate, btime, timeKnown, sijinLabel, calType, lunarRaw: calType === 'lunar' ? rawDate : null };
}

// ---------- 성별 토글 ----------
document.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-g]').forEach((x) => x.classList.remove('active'));
  b.classList.add('active'); state.gender = b.dataset.g;
}));

// ---------- 스텝 이동 ----------
function goTo(n) {
  state.step = n;
  document.querySelectorAll('.step').forEach((s) => s.classList.remove('active'));
  document.getElementById('step-' + n).classList.add('active');
  document.getElementById('stepLabel').textContent = n + ' / 4';
  document.getElementById('backBtn').style.visibility = n === 1 ? 'hidden' : 'visible';
  for (let i = 1; i <= 4; i++) {
    document.getElementById('p' + i).style.width = i <= n ? '100%' : '0%';
  }
  window.scrollTo(0, 0);
}
document.getElementById('backBtn').addEventListener('click', () => goTo(Math.max(1, state.step - 1)));
document.getElementById('backTo2').addEventListener('click', () => goTo(2));

// ---------- STEP2 -> STEP3 ----------
document.getElementById('toStep3').addEventListener('click', async () => {
  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const selfBlock = document.querySelector('.person-block[data-person="self"]');
  const rawSelfDate = selfBlock.querySelector('.bdate-input').value;
  if (!name || !rawSelfDate || !email) { alert('이름, 생년월일, 이메일은 필수예요.'); return; }

  let partnerBlock = null, pname = '';
  if (state.fortune.needsPartner) {
    pname = document.getElementById('pname').value.trim();
    partnerBlock = document.querySelector('.person-block[data-person="partner"]');
    const rawPDate = partnerBlock.querySelector('.bdate-input').value;
    if (!pname || !rawPDate) { alert('상대방 이름과 생년월일도 입력해주세요.'); return; }
  }

  if (window.trackEvent) trackEvent('info_submitted');

  const btn = document.getElementById('toStep3');
  btn.disabled = true; btn.textContent = '사주 계산 중...';

  try {
    const selfInfo = await readPersonBlock(selfBlock);
    state.self = { name, gender: state.gender, ...selfInfo };
    state.email = email;

    if (partnerBlock) {
      const partnerInfo = await readPersonBlock(partnerBlock);
      state.partner = { name: pname, ...partnerInfo };
    }

    if (state.fortune.needsDateSelection) {
      state.dateSelection = { ...dateSelection };
    }

    const [y, m, d] = state.self.bdate.split('-').map(Number);
    const [hh, mm] = state.self.btime.split(':').map(Number);
    const saju = getSaju(y, m, d, hh, mm);
    renderStamps('stampPreview', saju);
    renderStamps('stampFinal', saju);

    document.getElementById('orderSummary').textContent =
      `${name}님의 [${state.fortune.name}] 풀이를 ${email} 로 보내드려요.`;
    document.getElementById('priceText').textContent = state.fortune.price.toLocaleString() + '원';

    goTo(3);
    loadBankInfo();
  } catch (err) {
    alert(err.message || '입력값을 확인하는 중 오류가 발생했어요.');
  } finally {
    btn.disabled = false; btn.textContent = '사주 확인하고 결제하러 가기';
  }
});

function renderStamps(containerId, saju) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  const labels = [['년주','year'],['월주','month'],['일주','day'],['시주','hour']];
  labels.forEach(([label, key], i) => {
    const box = document.createElement('div');
    box.className = 'stamp';
    box.style.animationDelay = (i * 0.12) + 's';
    box.innerHTML = `<b>${saju[key]}</b><span>${label}</span>`;
    el.appendChild(box);
  });
}

// ---------- STEP3: 무통장입금 계좌 안내 ----------
async function loadBankInfo() {
  try {
    const res = await fetch('/api/bank-info');
    const info = await res.json();
    document.getElementById('bankNameText').textContent = info.bankName;
    document.getElementById('bankAccountText').textContent = info.accountNo;
    document.getElementById('bankHolderText').textContent = info.holder;
  } catch (err) {
    console.error('계좌 정보를 불러오지 못했어요', err);
  }
}

document.getElementById('copyAccountBtn').addEventListener('click', () => {
  const text = document.getElementById('bankAccountText').textContent;
  navigator.clipboard?.writeText(text).then(() => {
    const btn = document.getElementById('copyAccountBtn');
    const prev = btn.textContent;
    btn.textContent = '복사됨';
    setTimeout(() => (btn.textContent = prev), 1500);
  });
});

document.getElementById('payBtn').addEventListener('click', async () => {
  const depositorName = document.getElementById('depositorName').value.trim();
  if (!depositorName) { alert('입금자명을 입력해주세요.'); return; }

  const btn = document.getElementById('payBtn');
  btn.disabled = true; btn.textContent = '접수 중...';

  const orderId = 'order_' + Date.now();
  try {
    const res = await fetch('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId, fortune: state.fortune, self: state.self, partner: state.partner,
        email: state.email, depositorName, dateSelection: state.dateSelection,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || '주문 접수에 실패했어요.');

    document.getElementById('doneEmail').textContent = state.email;
    goTo(4);
  } catch (err) {
    alert(err.message || '주문 접수 중 오류가 발생했어요.');
  } finally {
    btn.disabled = false; btn.textContent = '입금 신청 완료';
  }
});

document.getElementById('restartBtn').addEventListener('click', () => location.href = '/');
