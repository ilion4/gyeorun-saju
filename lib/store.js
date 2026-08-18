/**
 * store.js — 주문 및 발송 로그 저장소
 *
 * ⚠️ 데모/소규모용 파일 기반 저장소입니다 (data/orders.json).
 * 동시 결제가 몰리는 규모가 되면 SQLite나 PostgreSQL로 교체하는 걸 권장합니다.
 * (지금 구조에서 이 파일의 함수들만 DB 버전으로 바꿔치기하면 나머지 코드는 그대로 써도 됩니다)
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'orders.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '{}');

function loadAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch (e) {
    console.error('[store] 파일 읽기 실패, 빈 데이터로 시작', e);
    return {};
  }
}

function saveAll(data) {
  // 임시파일에 쓰고 이름 바꾸기 -> 쓰는 도중 서버가 죽어도 파일이 깨지지 않게
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

function getOrder(orderId) {
  return loadAll()[orderId] || null;
}

function createOrder(orderId, fields) {
  const all = loadAll();
  all[orderId] = {
    orderId,
    ...fields,
    paid: false,
    sendStatus: 'not_sent', // not_sent | pending | sent | failed
    sendAttempts: 0,
    lastError: null,
    lastAttemptAt: null,
    sentAt: null,
    nextRetryAt: null,
    createdAt: Date.now(),
  };
  saveAll(all);
  return all[orderId];
}

function updateOrder(orderId, patch) {
  const all = loadAll();
  if (!all[orderId]) return null;
  all[orderId] = { ...all[orderId], ...patch };
  saveAll(all);
  return all[orderId];
}

function listOrders() {
  const all = loadAll();
  return Object.values(all).sort((a, b) => b.createdAt - a.createdAt);
}

// 뱅크다 등 무통장입금 자동확인 서비스가 "아직 입금 미확인" 주문만 조회할 때 사용
function listUnpaidOrders() {
  return listOrders().filter((o) => !o.paid);
}

module.exports = { getOrder, createOrder, updateOrder, listOrders, listUnpaidOrders };
