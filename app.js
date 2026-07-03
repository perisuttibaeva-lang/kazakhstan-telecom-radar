const state = {
  news: [],
  sources: [],
  meta: {},
  apiBase: "",
  staticMode: false,
  filters: {
    search: "",
    operator: "all",
    topic: "all",
    importance: "all",
  },
};

const els = {
  refreshTop: document.querySelector("#refreshTop"),
  refreshHero: document.querySelector("#refreshHero"),
  statusLine: document.querySelector("#statusLine"),
  lastRun: document.querySelector("#lastRun"),
  urgentCount: document.querySelector("#urgentCount"),
  coreCount: document.querySelector("#coreCount"),
  archiveCount: document.querySelector("#archiveCount"),
  totalMetric: document.querySelector("#totalMetric"),
  operatorsMetric: document.querySelector("#operatorsMetric"),
  tariffsMetric: document.querySelector("#tariffsMetric"),
  regulatorMetric: document.querySelector("#regulatorMetric"),
  newsList: document.querySelector("#newsList"),
  searchInput: document.querySelector("#searchInput"),
  operatorFilter: document.querySelector("#operatorFilter"),
  topicFilter: document.querySelector("#topicFilter"),
  importanceFilter: document.querySelector("#importanceFilter"),
  summaryDate: document.querySelector("#summaryDate"),
  summaryList: document.querySelector("#summaryList"),
  operatorBars: document.querySelector("#operatorBars"),
  topicStats: document.querySelector("#topicStats"),
  sourceGrid: document.querySelector("#sourceGrid"),
};

function setStatus(message, busy = false) {
  els.statusLine.textContent = message;
  els.refreshTop.disabled = busy;
  els.refreshHero.disabled = busy;
}

function importanceLabel(value) {
  return {
    high: "Высокая",
    medium: "Средняя",
    low: "Низкая",
  }[value] || "Средняя";
}

function tagClass(value) {
  return {
    high: "danger",
    medium: "warning",
    low: "calm",
  }[value] || "warning";
}

function formatDate(value) {
  if (!value) return "Дата не указана";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function pluralNews(count) {
  const last = count % 10;
  const lastTwo = count % 100;
  if (last === 1 && lastTwo !== 11) return "новость";
  if ([2, 3, 4].includes(last) && ![12, 13, 14].includes(lastTwo)) return "новости";
  return "новостей";
}

async function detectApiBase() {
  const candidates =
    window.location.protocol === "file:"
      ? ["http://localhost:3001", "http://localhost:3000"]
      : ["", "http://localhost:3001", "http://localhost:3000"];

  for (const base of candidates) {
    try {
      const response = await fetch(`${base}/api/news`, { cache: "no-store" });
      if (response.ok) {
        state.apiBase = base;
        return;
      }
    } catch {
      // Try the next local server candidate.
    }
  }

  state.staticMode = true;
  state.apiBase = "";
}

async function api(path, options) {
  if (state.staticMode && path === "/api/news") {
    const response = await fetch("data/archive.json", { cache: "no-store" });
    if (!response.ok) throw new Error("архив data/archive.json не найден");
    const archive = await response.json();
    return {
      items: archive.items || [],
      meta: archive.meta || {},
      sources: archive.sources || defaultSources(),
    };
  }

  if (state.staticMode && path === "/api/refresh") {
    throw new Error(
      "на GitHub Pages прямой поиск недоступен. Архив обновляется через GitHub Actions или локальный сервер",
    );
  }

  if (!state.apiBase && path !== "/api/news") {
    await detectApiBase();
  }

  const response = await fetch(`${state.apiBase}${path}`, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Ошибка ${response.status}`);
  }
  return response.json();
}

async function loadData() {
  await detectApiBase();
  const data = await api("/api/news");
  state.news = data.items || [];
  state.sources = data.sources || [];
  state.meta = data.meta || {};
  if (state.staticMode) {
    setStatus("Открыта статическая версия: показан последний опубликованный архив.");
  }
  render();
}

async function refreshNews() {
  setStatus("Ищу свежие новости в открытых источниках...", true);
  try {
    const data = await api("/api/refresh", { method: "POST" });
    state.news = data.items || [];
    state.sources = data.sources || [];
    state.meta = data.meta || {};
    setStatus(`Готово: найдено ${data.added || 0} новых ${pluralNews(data.added || 0)}.`);
    render();
  } catch (error) {
    setStatus(`Не получилось обновить: ${error.message}`);
  }
}

function filteredNews() {
  return state.news.filter((item) => {
    const text = `${item.title} ${item.summary} ${item.operator} ${item.topic}`.toLowerCase();
    const matchesSearch = !state.filters.search || text.includes(state.filters.search.toLowerCase());
    const matchesOperator = state.filters.operator === "all" || item.operator === state.filters.operator;
    const matchesTopic = state.filters.topic === "all" || item.topic === state.filters.topic;
    const matchesImportance =
      state.filters.importance === "all" || item.importance === state.filters.importance;
    return matchesSearch && matchesOperator && matchesTopic && matchesImportance;
  });
}

function renderMetrics() {
  const operators = new Set(state.news.map((item) => item.operator).filter(Boolean));
  const tariffs = state.news.filter((item) => item.topic === "Тарифы").length;
  const regulator = state.news.filter((item) => item.topic === "Регуляторика").length;
  const urgent = state.news.filter((item) => item.importance === "high").length;
  const core = state.news.filter((item) => ["Тарифы", "Регуляторика"].includes(item.topic)).length;

  els.lastRun.textContent = state.meta.lastRun ? formatDate(state.meta.lastRun) : "Еще не запускался";
  els.urgentCount.textContent = urgent;
  els.coreCount.textContent = core;
  els.archiveCount.textContent = state.news.length;
  els.totalMetric.textContent = state.news.length;
  els.operatorsMetric.textContent = operators.size;
  els.tariffsMetric.textContent = tariffs;
  els.regulatorMetric.textContent = regulator;
}

function renderOperatorOptions() {
  const current = els.operatorFilter.value;
  const operators = [...new Set(state.news.map((item) => item.operator).filter(Boolean))].sort();
  els.operatorFilter.innerHTML = '<option value="all">Все</option>';
  operators.forEach((operator) => {
    const option = document.createElement("option");
    option.value = operator;
    option.textContent = operator;
    els.operatorFilter.append(option);
  });
  els.operatorFilter.value = operators.includes(current) ? current : "all";
  state.filters.operator = els.operatorFilter.value;
}

function renderNews() {
  const items = filteredNews();
  els.newsList.innerHTML = "";

  if (!items.length) {
    els.newsList.innerHTML =
      '<div class="empty-box">Новостей по выбранным фильтрам нет. Запустите поиск или измените фильтры.</div>';
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "news-card";
    card.innerHTML = `
      <div class="news-top">
        <span class="tag ${tagClass(item.importance)}">${importanceLabel(item.importance)}</span>
        <span class="date">${formatDate(item.publishedAt)}</span>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.summary)}</p>
      <div class="news-meta">
        <span>${escapeHtml(item.operator)}</span>
        <span>${escapeHtml(item.topic)}</span>
        <span>${escapeHtml(item.source)}</span>
      </div>
      <a href="${item.link}" target="_blank" rel="noopener">Открыть источник</a>
    `;
    els.newsList.append(card);
  });
}

function renderSummary() {
  const important = state.news
    .filter((item) => item.importance === "high" || ["Тарифы", "Регуляторика"].includes(item.topic))
    .slice(0, 6);

  els.summaryDate.textContent = state.meta.lastRun ? formatDate(state.meta.lastRun) : "Нет данных";
  els.summaryList.innerHTML = "";

  if (!important.length) {
    els.summaryList.innerHTML = '<p class="empty">Запустите поиск, чтобы сформировать сводку.</p>';
    return;
  }

  important.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "summary-row";
    row.innerHTML = `
      <strong>${index + 1}. ${escapeHtml(item.operator)}: ${escapeHtml(item.topic)}</strong>
      <p>${escapeHtml(item.summary)}</p>
      <a href="${item.link}" target="_blank" rel="noopener">Источник</a>
    `;
    els.summaryList.append(row);
  });
}

function renderAnalytics() {
  const byOperator = countBy(state.news, "operator");
  const byTopic = countBy(state.news, "topic");
  const maxOperator = Math.max(1, ...Object.values(byOperator));

  els.operatorBars.innerHTML = "";
  Object.entries(byOperator)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .forEach(([name, count]) => {
      const bar = document.createElement("div");
      bar.style.setProperty("--height", `${Math.max(18, (count / maxOperator) * 100)}%`);
      bar.innerHTML = `<strong>${count}</strong><span>${escapeHtml(name)}</span>`;
      els.operatorBars.append(bar);
    });

  if (!els.operatorBars.children.length) {
    els.operatorBars.innerHTML = '<p class="empty">Нет данных для графика.</p>';
  }

  els.topicStats.innerHTML = "";
  Object.entries(byTopic)
    .sort((a, b) => b[1] - a[1])
    .forEach(([topic, count]) => {
      const row = document.createElement("div");
      row.className = "topic-row";
      row.innerHTML = `<span>${escapeHtml(topic)}</span><strong>${count}</strong>`;
      els.topicStats.append(row);
    });
}

function renderSources() {
  els.sourceGrid.innerHTML = "";
  state.sources.forEach((source) => {
    const card = document.createElement("article");
    card.className = "source-card";
    card.innerHTML = `
      <h3>${escapeHtml(source.name)}</h3>
      <p>${escapeHtml(source.query)}</p>
      <span>${escapeHtml(source.type)}</span>
    `;
    els.sourceGrid.append(card);
  });
}

function render() {
  renderMetrics();
  renderOperatorOptions();
  renderNews();
  renderSummary();
  renderAnalytics();
  renderSources();
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "Другое";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function defaultSources() {
  return [
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
      query: "Kcell OR Activ Казахстан тариф OR связь OR 5G",
    },
    {
      name: "Tele2 и Altel",
      type: "Google News RSS",
      query: "Tele2 OR Altel Казахстан тариф OR связь OR 5G",
    },
    {
      name: "Казахтелеком",
      type: "Google News RSS",
      query: "Казахтелеком тариф OR интернет OR связь OR 5G",
    },
    {
      name: "Регуляторика телеком Казахстан",
      type: "Google News RSS",
      query: "Казахстан телеком оператор штраф OR проверка OR антимонопольный OR регулятор",
    },
  ];
}

els.refreshTop.addEventListener("click", refreshNews);
els.refreshHero.addEventListener("click", refreshNews);
els.searchInput.addEventListener("input", (event) => {
  state.filters.search = event.target.value.trim();
  renderNews();
});
els.operatorFilter.addEventListener("change", (event) => {
  state.filters.operator = event.target.value;
  renderNews();
});
els.topicFilter.addEventListener("change", (event) => {
  state.filters.topic = event.target.value;
  renderNews();
});
els.importanceFilter.addEventListener("change", (event) => {
  state.filters.importance = event.target.value;
  renderNews();
});

loadData().catch((error) => setStatus(`Сервер не отвечает: ${error.message}`));
