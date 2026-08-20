// 하루 방문자 수 카운터. 자정(한국시간)이 지나면 날짜가 바뀌므로 자동으로 0부터 다시 센다.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'visit-count.json');

function todayKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`;
}

function load() {
  if (!fs.existsSync(FILE)) return { date: todayKST(), count: 0 };
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (data.date !== todayKST()) return { date: todayKST(), count: 0 }; // 날짜 바뀌면 리셋
    return data;
  } catch (e) {
    return { date: todayKST(), count: 0 };
  }
}

function save(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data), 'utf8');
}

// 방문 1건 기록 (같은 날짜면 누적, 날짜가 바뀌었으면 0에서 다시 시작)
function recordVisit() {
  const data = load();
  data.count += 1;
  save(data);
  return data.count;
}

// 현재 카운트만 조회 (증가시키지 않음, 관리자 페이지 조회용)
function getVisitCount() {
  return load();
}

module.exports = { recordVisit, getVisitCount };
