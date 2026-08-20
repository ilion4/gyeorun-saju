// 하루 동안 각 단계에 몇 명이 도달했는지 세는 퍼널 카운터.
// 자정(한국시간)이 지나면 날짜가 바뀌므로 자동으로 0부터 다시 센다.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'visit-count.json');

// 추적하는 단계들 (프론트에서 이 이름 그대로 보내야 함)
const EVENTS = ['main_visit', 'today_visit', 'fortune_selected', 'info_submitted'];

function todayKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`;
}

function emptyEvents() {
  return Object.fromEntries(EVENTS.map((e) => [e, 0]));
}

function load() {
  const fallback = { date: todayKST(), events: emptyEvents() };
  if (!fs.existsSync(FILE)) return fallback;
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (data.date !== todayKST()) return fallback; // 날짜 바뀌면 리셋
    return { date: data.date, events: { ...emptyEvents(), ...data.events } };
  } catch (e) {
    return fallback;
  }
}

function save(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data), 'utf8');
}

// 특정 단계 1건 기록 (알 수 없는 이름이면 무시)
function recordEvent(name) {
  if (!EVENTS.includes(name)) return null;
  const data = load();
  data.events[name] += 1;
  save(data);
  return data.events;
}

// 오늘 전체 현황 조회 (증가시키지 않음, 관리자 페이지 조회용)
function getFunnel() {
  return load();
}

module.exports = { recordEvent, getFunnel, EVENTS };
