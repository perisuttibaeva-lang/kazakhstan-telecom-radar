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
