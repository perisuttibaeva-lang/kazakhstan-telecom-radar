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
    els.summaryList.innerHTML = '<p class="empty">В опубликованном архиве пока нет событий для сводки.</p>';
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
      name: "Транстелеком",
      type: "Google News RSS",
      query: "Транстелеком Казахстан OR Transtelecom Kazakhstan OR TTC Казахстан тариф OR интернет OR связь OR 5G",
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
