const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const ARCHIVE_FILE = path.join(DATA_DIR, "archive.json");
const RECENT_DAYS = 45;

const SOURCES = [
  {
    name: "Тарифы операторов Казахстана",
    type: "Google News RSS",
    query: 'Казахстан мобильный оператор тариф OR абонентская плата OR "мобильный интернет"',
  },
  {
    name: "Beeline Казахстан",
    type: "Google News RSS",
    query: 'Beeline Казахстан тариф OR связь OR 5G OR "абонентская плата"',
  },
  {
    name: "Kcell и Activ",
    type: "Google News RSS",
    query: 'Kcell OR Activ Казахстан тариф OR связь OR 5G',
  },
  {
    name: "Tele2 и Altel",
    type: "Google News RSS",
    query: 'Tele2 OR Altel Казахстан тариф OR связь OR 5G',
  },
  {
    name: "Казахтелеком",
    type: "Google News RSS",
    query: 'Казахтелеком тариф OR интернет OR связь OR 5G',
  },
  {
    name: "Регуляторика телеком Казахстан",
    type: "Google News RSS",
    query: 'Казахстан телеком оператор штраф OR проверка OR антимонопольный OR регулятор',
  },
];

const OPERATORS = [
  ["Beeline", ["beeline", "билайн", "кар-тел", "картел"]],
  ["Kcell / Activ", ["kcell", "кселл", "activ", "актив"]],
  ["Tele2", ["tele2", "теле2"]],
  ["Altel", ["altel", "алтел"]],
  ["Казахтелеком", ["казахтелеком", "kazakhtelecom"]],
  ["Jusan Mobile", ["jusan mobile", "жусан мобайл"]],
];

const TOPICS = [
  ["Тарифы", ["тариф", "абонентск", "подорож", "цена", "стоимост", "пакет", "роуминг", "безлимит"]],
  ["Регуляторика", ["штраф", "провер", "антимонополь", "регулятор", "министерств", "лицензи", "качество связи"]],
  ["Инфраструктура", ["5g", "4g", "базов", "сеть", "инфраструктур", "покрыти", "интернет"]],
  ["Акции", ["акци", "промо", "скидк", "бонус", "предложени"]],
  ["Рынок", ["сделк", "партнер", "выручк", "абонент", "рынок", "отчет", "продаж"]],
];

const HIGH_IMPORTANCE = [
  "повыш",
  "подорож",
  "изменил тариф",
  "абонентская плата",
  "штраф",
  "провер",
  "антимонополь",
  "регулятор",
  "сделк",
  "5g",
];

const MEDIUM_IMPORTANCE = ["тариф", "роуминг", "запуст", "интернет", "партнер", "акци", "качество"];
const RELEVANT_TOKENS = [
  "beeline",
  "билайн",
  "kcell",
  "кселл",
  "activ",
  "актив",
  "tele2",
  "теле2",
  "altel",
  "алтел",
  "казахтелеком",
  "kazakhtelecom",
  "связ",
  "сотов",
  "телеком",
  "оператор",
  "тариф",
  "абонент",
  "мобильный интернет",
  "5g",
  "4g",
  "базов",
  "провайдер",
];

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

async function main() {
  await ensureArchive();
  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      console.error(error);
      send(res, 500, { error: "Внутренняя ошибка сервера", detail: error.message });
    });
  });

  server.listen(PORT, () => {
    console.log(`Телеком-радар запущен: http://localhost:${PORT}`);
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/api/news" && req.method === "GET") {
    const archive = await readArchive();
    return send(res, 200, {
      items: archive.items,
      meta: archive.meta,
      sources: SOURCES,
    });
  }

  if (url.pathname === "/api/refresh" && req.method === "POST") {
    const result = await refresh();
    return send(res, 200, result);
  }

  if (url.pathname === "/api/sources" && req.method === "GET") {
    return send(res, 200, { sources: SOURCES });
  }

  return serveStatic(req, res, url);
}

async function refresh() {
  await ensureArchive();
  const archive = await readArchive();
  const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const existing = new Map(
    archive.items
      .filter((item) => {
        const text = `${item.title} ${item.summary} ${item.operator} ${item.topic}`.toLowerCase();
        return (
          item.publishedAt &&
          new Date(item.publishedAt).getTime() >= cutoff &&
          RELEVANT_TOKENS.some((token) => text.includes(token))
        );
      })
      .map((item) => [item.id, item]),
  );
  const found = [];

  for (const source of SOURCES) {
    try {
      const items = await fetchGoogleNews(source);
      found.push(...items.map((item) => normalizeItem(item, source)));
    } catch (error) {
      console.warn(`Источник не ответил: ${source.name}`, error.message);
    }
  }

  let added = 0;
  for (const item of found) {
    if (!item || !item.id || existing.has(item.id)) continue;
    existing.set(item.id, item);
    added += 1;
  }

  const merged = [...existing.values()]
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, 500);

  const nextArchive = {
    meta: {
      lastRun: new Date().toISOString(),
      total: merged.length,
    },
    items: merged,
  };

  await fs.writeFile(ARCHIVE_FILE, `${JSON.stringify(nextArchive, null, 2)}\n`, "utf8");

  return {
    added,
    items: merged,
    meta: nextArchive.meta,
    sources: SOURCES,
  };
}

async function fetchGoogleNews(source) {
  const rssUrl = new URL("https://news.google.com/rss/search");
  rssUrl.searchParams.set("q", `${source.query} when:${RECENT_DAYS}d`);
  rssUrl.searchParams.set("hl", "ru");
  rssUrl.searchParams.set("gl", "KZ");
  rssUrl.searchParams.set("ceid", "KZ:ru");

  const response = await fetch(rssUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 TelecomRadar/1.0",
      accept: "application/rss+xml, application/xml, text/xml",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const xml = await response.text();
  return parseRss(xml);
}

function parseRss(xml) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  for (const block of blocks) {
    const title = strip(readTag(block, "title"));
    const link = strip(readTag(block, "link"));
    const pubDate = strip(readTag(block, "pubDate"));
    const source = strip(readTag(block, "source"));
    const description = strip(readTag(block, "description"));

    if (!title || !link) continue;

    items.push({
      title,
      link,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      source: source || "Google News",
      description,
    });
  }

  return items;
}

function normalizeItem(raw, sourceConfig) {
  const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  if (raw.publishedAt && new Date(raw.publishedAt).getTime() < cutoff) return null;
  const text = `${raw.title} ${raw.description}`.toLowerCase();
  if (!RELEVANT_TOKENS.some((token) => text.includes(token))) return null;
  const operator = detectOperator(text);
  const topic = detectTopic(text);
  const importance = detectImportance(text, topic);
  const summary = buildSummary(raw.title, operator, topic, importance);
  const id = stableId(`${raw.title}|${raw.source}|${raw.publishedAt}`);

  if (operator === "Рынок Казахстана" && topic === "Другое") {
    return null;
  }

  return {
    id,
    title: raw.title,
    summary,
    link: raw.link,
    source: raw.source || sourceConfig.name,
    sourceQuery: sourceConfig.name,
    operator,
    topic,
    importance,
    publishedAt: raw.publishedAt,
    savedAt: new Date().toISOString(),
  };
}

function detectOperator(text) {
  for (const [name, tokens] of OPERATORS) {
    if (tokens.some((token) => text.includes(token))) return name;
  }
  if (text.includes("оператор") || text.includes("телеком") || text.includes("связ")) {
    return "Рынок Казахстана";
  }
  return "Рынок Казахстана";
}

function detectTopic(text) {
  for (const [name, tokens] of TOPICS) {
    if (tokens.some((token) => text.includes(token))) return name;
  }
  return "Другое";
}

function detectImportance(text, topic) {
  if (HIGH_IMPORTANCE.some((token) => text.includes(token))) return "high";
  if (topic === "Тарифы" || topic === "Регуляторика") return "high";
  if (MEDIUM_IMPORTANCE.some((token) => text.includes(token))) return "medium";
  return "low";
}

function buildSummary(title, operator, topic, importance) {
  const prefix = importance === "high" ? "Важный сигнал" : "Новость";
  return `${prefix}: ${operator}, тема "${topic}". Проверьте источник: ${title}`;
}

function readTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function strip(value) {
  return decodeXml(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stableId(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return `n_${Math.abs(hash)}`;
}

async function ensureArchive() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(ARCHIVE_FILE);
  } catch {
    await fs.writeFile(
      ARCHIVE_FILE,
      JSON.stringify({ meta: { lastRun: null, total: 0 }, items: [] }, null, 2),
      "utf8",
    );
  }
}

async function readArchive() {
  await ensureArchive();
  const text = await fs.readFile(ARCHIVE_FILE, "utf8");
  return JSON.parse(text);
}

async function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
    return sendText(res, 403, "Forbidden");
  }

  try {
    const body = await fs.readFile(filePath);
    const type = mime[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "access-control-allow-origin": "*" });
    res.end(body);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function send(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" });
  res.end(text);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
