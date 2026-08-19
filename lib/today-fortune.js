// 12띠 오늘의 운세 — 무료 코너용. 하루에 딱 한 번만 AI를 호출해서(12띠 전체를 한 번에)
// 그 결과를 파일에 캐싱해두고, 그날 방문하는 모든 사람에게 같은 내용을 보여준다.
// (방문자마다 AI를 새로 부르면 비용이 계속 나가기 때문에 이렇게 설계함)
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'today-fortune.json');

const ZODIAC = [
  { key: 'rat', name: '쥐띠', mod: 4 },
  { key: 'ox', name: '소띠', mod: 5 },
  { key: 'tiger', name: '호랑이띠', mod: 6 },
  { key: 'rabbit', name: '토끼띠', mod: 7 },
  { key: 'dragon', name: '용띠', mod: 8 },
  { key: 'snake', name: '뱀띠', mod: 9 },
  { key: 'horse', name: '말띠', mod: 10 },
  { key: 'goat', name: '양띠', mod: 11 },
  { key: 'monkey', name: '원숭이띠', mod: 0 },
  { key: 'rooster', name: '닭띠', mod: 1 },
  { key: 'dog', name: '개띠', mod: 2 },
  { key: 'pig', name: '돼지띠', mod: 3 },
];

// 오늘(한국시간) 날짜를 YYYY-MM-DD로
function todayKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`;
}

// 특정 띠(mod)에 해당하는 최근 출생연도 7개를 계산 (예: 소띠 -> 2021,2009,1997,1985,1973,1961,1949)
function recentYearsForAnimal(mod, count = 7) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear();
  let latest = now;
  while (((latest % 12) + 12) % 12 !== mod) latest -= 1;
  return Array.from({ length: count }, (_, i) => latest - i * 12);
}

function buildPrompt() {
  const animalBlocks = ZODIAC.map((z) => {
    const years = recentYearsForAnimal(z.mod);
    return `- ${z.name}(key: "${z.key}"): 대상 출생연도 [${years.join(', ')}]`;
  }).join('\n');

  return `당신은 사주 명리학에 능한 운세 상담가입니다. 오늘(${todayKST()}) 하루의 12띠별 운세를 작성하세요.

아래 12개 띠 각각에 대해 작성합니다:
${animalBlocks}

반드시 아래 JSON 형식으로만 응답하세요. JSON 앞뒤로 다른 설명이나 마크다운 코드블록을 절대 넣지 마세요.

{
  "animals": {
    "쥐띠의 key": {
      "summary": "그 띠 전체에 해당하는 오늘의 총운, 2~3문장 (60~90자)",
      "years": { "출생연도": "그 해 태생만을 위한 한 줄 콕 집은 조언, 12~20자" }
    }
  }
}

작성 지침:
- summary는 그 띠 전체에 공통되는 오늘의 흐름(대인관계, 재물, 건강 등 중에서 오늘 가장 두드러지는 것 하나를 중심으로)
- years의 각 한 줄은 같은 띠 안에서도 나이대(청년/중장년/노년)에 따라 다른 조언이 되도록 서로 다르게 작성 (예: 젊은 층은 이직·연애, 중장년은 건강·재물, 노년층은 건강·가족 등으로 자연스럽게 다르게)
- 반드시 위에 제시된 출생연도 목록 그대로 사용할 것 (연도를 임의로 바꾸지 말 것)
- 한자는 절대 쓰지 말 것, 모두 한글로 표기
- 미신적 단정("반드시 ~합니다") 대신 "~한 기운이 있어요", "~조심하세요" 톤 유지
- 12개 띠 모두 빠짐없이 작성`;
}

function parseAndValidate(raw) {
  let cleaned = String(raw || '').trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned); // 실패하면 호출부에서 catch
  if (!parsed || typeof parsed.animals !== 'object') throw new Error('animals 필드가 없음');
  return parsed.animals;
}

// ANTHROPIC_API_KEY 미설정 시 사용할 데모 데이터
function demoAnimals() {
  const out = {};
  ZODIAC.forEach((z) => {
    const years = recentYearsForAnimal(z.mod);
    out[z.key] = {
      summary: `[데모] ${z.name} 오늘의 운세입니다. 실제 서비스에서는 AI가 매일 새로 작성한 내용이 표시됩니다.`,
      years: Object.fromEntries(years.map((y) => [y, '데모용 예시 문구입니다'])),
    };
  });
  return out;
}

/**
 * 오늘 날짜 기준 캐시가 있으면 그대로 반환, 없으면 callClaude로 새로 생성해서 저장 후 반환.
 * @param {(prompt: string, maxTokens: number) => Promise<string>} callClaude
 * @param {boolean} hasApiKey
 */
async function getTodayFortune(callClaude, hasApiKey) {
  const today = todayKST();

  if (fs.existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (cached.date === today && cached.animals) return cached;
    } catch (e) {
      console.warn('[오늘의운세] 캐시 파일 파싱 실패, 새로 생성함:', e.message);
    }
  }

  let animals;
  if (hasApiKey) {
    // 12띠 × (총운+출생연도 7개) 분량이라 여유있게 잡음 — 하루 1회만 호출되니 비용 부담 적음
    const raw = await callClaude(buildPrompt(), 8000);
    try {
      animals = parseAndValidate(raw);
    } catch (e) {
      // 응답이 중간에 잘렸는지 등을 바로 알아볼 수 있도록 길이/끝부분을 함께 남긴다
      console.error(`[오늘의운세 파싱 실패] ${e.message} / 응답길이=${raw.length} / 응답끝부분="${raw.slice(-80)}"`);
      throw e;
    }
  } else {
    animals = demoAnimals();
  }

  const result = { date: today, animals, meta: Object.fromEntries(ZODIAC.map((z) => [z.key, { name: z.name, years: recentYearsForAnimal(z.mod) }])) };

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(result, null, 2), 'utf8');
  return result;
}

module.exports = { getTodayFortune, ZODIAC, recentYearsForAnimal, todayKST };
