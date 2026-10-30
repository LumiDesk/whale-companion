import type {
  IRun,
  IScenarioResult,
  ITurnRecord,
  IVariantResult,
} from "./types.js";

const esc = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const msText = (ms: number): string =>
  ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

const toolSummary = (turn: ITurnRecord): string =>
  turn.toolCalls
    .map((call) => {
      try {
        const args = JSON.parse(call.args) as Record<string, unknown>;
        const detail =
          typeof args.query === "string"
            ? args.query
            : typeof args.url === "string"
              ? args.url
              : "";
        return detail ? `${call.name}(${detail})` : call.name;
      } catch {
        return call.name;
      }
    })
    .join("、");

const scoreRow = (
  scenarioId: string,
  label: string,
  axis: "human" | "smart" | "want",
  title: string,
): string => `
      <div class="score-row">
        <span class="score-label">${title}</span>
        <div class="pills">
          ${[1, 2, 3, 4, 5]
            .map(
              (value) => `
          <label>
            <input type="radio" name="s-${scenarioId}-${label}-${axis}" value="${value}" aria-label="${title} ${value} 分">
            <span>${value}</span>
          </label>`,
            )
            .join("")}
        </div>
      </div>`;

const turnHtml = (turn: ITurnRecord): string => {
  const tools = toolSummary(turn);
  const assistant =
    turn.assistant.length > 0
      ? turn.assistant
          .map(
            (text) => `
        <div class="msg bot"><span class="who">小鲸鱼</span><p>${esc(text)}</p></div>`,
          )
          .join("")
      : `
        <div class="msg bot silent"><span class="who">小鲸鱼</span><p>（这次没有发言${
          turn.silent ? "，选择沉默" : ""
        }）</p></div>`;

  return `
      <div class="turn">
        <div class="msg user"><span class="who">他</span><p>${esc(turn.user)}</p></div>
        ${assistant}
        ${
          turn.error
            ? `<div class="msg err"><span class="who">错误</span><p>${esc(turn.error)}</p></div>`
            : ""
        }
        ${
          tools
            ? `<div class="tools" title="${esc(toolSummary(turn))}">${turn.toolCalls
                .map((call) => `<span class="tool">${esc(call.name)}</span>`)
                .join("")}</div>`
            : ""
        }
      </div>`;
};

const cardHtml = (
  scenario: IScenarioResult,
  label: string,
  variant: IVariantResult,
): string => {
  const avg =
    scenario.turns.reduce((sum, turn) => sum + turn.latencyMs, 0) /
    Math.max(1, scenario.turns.length);

  return `
    <article class="card" data-scenario="${esc(scenario.id)}" data-label="${esc(label)}" data-variant="${esc(variant.variant)}">
      <header class="card-head">
        <span class="tag">${esc(label)}</span>
        <span class="real">${esc(variant.label)}</span>
        <span class="stat">${scenario.turns.length} 轮 · 平均 ${msText(Math.round(avg))}</span>
      </header>
      <div class="chat">
        ${scenario.turns.map(turnHtml).join("")}
      </div>
      <div class="scores">
        ${scoreRow(scenario.id, label, "human", "人味")}
        ${scoreRow(scenario.id, label, "smart", "聪明")}
        ${scoreRow(scenario.id, label, "want", "想继续聊")}
      </div>
      <textarea class="note" data-note rows="2" placeholder="备注（可选）：哪句最出戏？"></textarea>
    </article>`;
};

const scenarioHtml = (
  scenario: IScenarioResult,
  labels: string[],
  variants: Map<string, IVariantResult>,
  mapping: Record<string, string>,
): string => `
  <section class="scenario" data-scenario="${esc(scenario.id)}">
    <div class="scenario-head">
      <h2>${esc(scenario.title)}</h2>
      <p>${esc(scenario.note)}</p>
    </div>
    <div class="grid">
      ${labels
        .map((label) => {
          const variantId = mapping[label];
          const variant = variants.get(variantId);
          if (!variant) return "";
          const variantScenario =
            variant.scenarios.find((item) => item.id === scenario.id) ??
            scenario;
          return cardHtml(variantScenario, label, variant);
        })
        .join("")}
    </div>
    <div class="best" data-scenario="${esc(scenario.id)}">
      <span>这个场景里最像人的是：</span>
      ${labels
        .map(
          (label) =>
            `<label><input type="radio" name="best-${esc(scenario.id)}" value="${esc(label)}"> ${esc(label)}</label>`,
        )
        .join("")}
    </div>
  </section>`;

const mappingTable = (run: IRun, labels: string[]): string => `
  <table>
    <thead><tr><th>场景</th>${labels.map((label) => `<th>${esc(label)}</th>`).join("")}</tr></thead>
    <tbody>
      ${run.variants[0].scenarios
        .map(
          (scenario) => `
        <tr>
          <td>${esc(scenario.title)}</td>
          ${labels
            .map((label) => {
              const variantId = run.mapping[scenario.id]?.[label] ?? "";
              const variant = run.variants.find(
                (item) => item.variant === variantId,
              );
              return `<td>${esc(variant?.label ?? variantId)}</td>`;
            })
            .join("")}
        </tr>`,
        )
        .join("")}
    </tbody>
  </table>`;

const markdownFor = (run: IRun): string => {
  const lines: string[] = [
    `# 小鲸鱼拟人度对话报告`,
    "",
    `- 运行：${run.runId}`,
    `- 模型：${run.model}`,
    `- 变体：${run.variants.map((variant) => `${variant.variant}（${variant.label}）`).join("、")}`,
    "",
    "> 评分请打开同目录的 `report.html`；变体顺序在每个场景内是打乱的。",
    "",
  ];

  for (const scenario of run.variants[0].scenarios) {
    lines.push(`## ${scenario.title}`, "", scenario.note, "");

    const mapping = run.mapping[scenario.id] ?? {};
    for (const label of Object.keys(mapping)) {
      const variant = run.variants.find(
        (item) => item.variant === mapping[label],
      );
      if (!variant) continue;
      const result = variant.scenarios.find((item) => item.id === scenario.id);
      if (!result) continue;

      lines.push(`### ${label}（${variant.label}）`, "");
      for (const turn of result.turns) {
        lines.push(`**他**：${turn.user}`);
        if (turn.assistant.length === 0) {
          lines.push(
            turn.error
              ? `**小鲸鱼**：（错误）${turn.error}`
              : "**小鲸鱼**：（这次没有发言）",
          );
        } else {
          for (const text of turn.assistant) {
            lines.push(`**小鲸鱼**：${text}`);
          }
        }
        if (turn.toolCalls.length > 0) {
          lines.push(
            `> 工具：${toolSummary(turn)} / ${msText(turn.latencyMs)}`,
          );
        }
        lines.push("");
      }
    }
  }

  lines.push("## 揭晓", "");
  for (const scenario of run.variants[0].scenarios) {
    const mapping = run.mapping[scenario.id] ?? {};
    const pairs = Object.entries(mapping).map(([label, id]) => {
      const variant = run.variants.find((item) => item.variant === id);
      return `${label} = ${variant?.label ?? id}`;
    });
    lines.push(`- ${scenario.title}：${pairs.join("，")}`);
  }
  lines.push("");

  return lines.join("\n");
};

const CSS = `
:root {
  --bg: #f4f7fb;
  --card: #ffffff;
  --text: #0f172a;
  --soft: #334155;
  --muted: #64748b;
  --faint: #94a3b8;
  --line: #e2e8f0;
  --accent: #0284c7;
  --accent-soft: #e0f2fe;
  --bot: #f8fafc;
  --user: #eef6ff;
  --err: #fef2f2;
  --err-text: #b91c1c;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b1220;
    --card: #111a2b;
    --text: #e2e8f0;
    --soft: #cbd5e1;
    --muted: #94a3b8;
    --faint: #64748b;
    --line: #1e293b;
    --accent: #38bdf8;
    --accent-soft: #0c4a6e;
    --bot: #0f172a;
    --user: #12283f;
    --err: #2a1215;
    --err-text: #fca5a5;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.65 "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(10px);
}
.topbar strong { font-size: 15px; }
.meta { margin-left: 10px; color: var(--muted); font-size: 12px; }
.actions { display: flex; gap: 8px; align-items: center; }
button {
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--card);
  color: var(--soft);
  font: inherit;
  cursor: pointer;
}
button:hover { border-color: var(--accent); color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.primary:hover { opacity: .9; color: #fff; }
.progress { color: var(--muted); font-size: 12px; }
main { max-width: 1440px; margin: 0 auto; padding: 24px 24px 64px; }
.intro {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 20px 22px;
  margin-bottom: 22px;
}
.intro h1 { margin: 0 0 6px; font-size: 22px; }
.intro h2 { margin: 0 0 10px; font-size: 18px; }
.intro p { margin: 8px 0; color: var(--soft); }
.intro ul { margin: 10px 0; padding-left: 20px; color: var(--soft); }
.muted { color: var(--muted); font-size: 12px; }
.scenario { margin-bottom: 30px; }
.scenario-head h2 { margin: 0 0 4px; font-size: 18px; }
.scenario-head p { margin: 0 0 12px; color: var(--muted); font-size: 12px; }
.grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
}
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.tag {
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}
.real {
  display: none;
  padding: 2px 8px;
  border: 1px dashed var(--accent);
  border-radius: 999px;
  color: var(--accent);
  font-size: 11px;
}
body.reveal .real { display: inline-block; }
.stat { margin-left: auto; color: var(--faint); font-size: 11px; }
.chat { display: flex; flex-direction: column; gap: 7px; }
.turn { display: flex; flex-direction: column; gap: 6px; }
.msg { display: flex; gap: 6px; align-items: flex-start; }
.msg .who {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--faint);
  font-size: 11px;
}
.msg p {
  margin: 0;
  padding: 7px 10px;
  border-radius: 10px;
  background: var(--bot);
  border: 1px solid var(--line);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.msg.user { flex-direction: row-reverse; }
.msg.user p { background: var(--user); border-color: transparent; }
.msg.silent p { color: var(--muted); font-style: italic; }
.msg.err p { background: var(--err); color: var(--err-text); }
.tools { display: flex; flex-wrap: wrap; gap: 4px; padding-left: 42px; }
.tool {
  padding: 1px 7px;
  border: 1px dashed var(--line);
  border-radius: 999px;
  color: var(--muted);
  font-size: 10px;
}
.scores {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px dashed var(--line);
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.score-row { display: flex; align-items: center; gap: 10px; }
.score-label { width: 64px; color: var(--muted); font-size: 12px; }
.pills { display: flex; gap: 5px; }
.pills label { cursor: pointer; }
.pills input { position: absolute; opacity: 0; pointer-events: none; }
.pills span {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--muted);
  font-size: 12px;
}
.pills input:checked + span {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
.note {
  margin-top: 10px;
  width: 100%;
  resize: vertical;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 12px;
}
.best {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  padding: 10px 14px;
  border: 1px dashed var(--line);
  border-radius: 10px;
  color: var(--soft);
  font-size: 12px;
}
.best label { cursor: pointer; }
#reveal-box { display: none; overflow-x: auto; }
body.reveal #reveal-box { display: block; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; }
th { background: var(--bot); color: var(--muted); font-weight: 600; }
.modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, .55);
}
.modal[hidden] { display: none; }
.modal-card {
  width: min(760px, 100%);
  max-height: 90vh;
  overflow: auto;
  padding: 18px 20px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--card);
  box-shadow: 0 20px 60px rgba(0, 0, 0, .35);
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.modal-head h3 { margin: 0; font-size: 16px; }
.modal-close {
  width: 30px;
  height: 30px;
  padding: 0;
  font-size: 18px;
  line-height: 1;
}
#export-json {
  width: 100%;
  margin: 10px 0;
  padding: 10px;
  resize: vertical;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font: 12px/1.5 "Cascadia Mono", Consolas, monospace;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
@media (max-width: 720px) {
  main { padding: 16px 12px 48px; }
  .topbar { padding: 10px 12px; }
  .grid { grid-template-columns: 1fr; }
}
`;

const JS = `
(function () {
  var run = JSON.parse(document.getElementById('run-data').textContent);
  var KEY = 'whale-bench:' + run.runId;
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { state = {}; }
  var total = document.querySelectorAll('.card').length;

  function updateProgress() {
    var done = 0;
    document.querySelectorAll('.card').forEach(function (card) {
      var item = state[card.dataset.scenario + '|' + card.dataset.label] || {};
      if (item.human && item.smart && item.want) done++;
    });
    document.getElementById('progress').textContent = done + ' / ' + total + ' 已评';
  }

  function read() {
    document.querySelectorAll('.card').forEach(function (card) {
      var sid = card.dataset.scenario;
      var label = card.dataset.label;
      var key = sid + '|' + label;
      var item = state[key] || {};
      ['human', 'smart', 'want'].forEach(function (axis) {
        var checked = card.querySelector('input[name="s-' + sid + '-' + label + '-' + axis + '"]:checked');
        if (checked) item[axis] = Number(checked.value);
      });
      var note = card.querySelector('[data-note]');
      if (note && note.value.trim()) item.note = note.value.trim();
      else delete item.note;
      if (Object.keys(item).length > 0) state[key] = item;
      else delete state[key];
    });
    document.querySelectorAll('.best').forEach(function (box) {
      var checked = box.querySelector('input[type=radio]:checked');
      if (checked) state['best|' + box.dataset.scenario] = checked.value;
      else delete state['best|' + box.dataset.scenario];
    });
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    updateProgress();
  }

  function restore() {
    document.querySelectorAll('.card').forEach(function (card) {
      var sid = card.dataset.scenario;
      var label = card.dataset.label;
      var item = state[sid + '|' + label] || {};
      ['human', 'smart', 'want'].forEach(function (axis) {
        if (!item[axis]) return;
        var input = card.querySelector('input[name="s-' + sid + '-' + label + '-' + axis + '"][value="' + item[axis] + '"]');
        if (input) input.checked = true;
      });
      var note = card.querySelector('[data-note]');
      if (note && item.note) note.value = item.note;
    });
    document.querySelectorAll('.best').forEach(function (box) {
      var value = state['best|' + box.dataset.scenario];
      if (!value) return;
      var input = box.querySelector('input[value="' + value + '"]');
      if (input) input.checked = true;
    });
    updateProgress();
  }

  document.addEventListener('change', read);
  document.addEventListener('input', read);

  function buildPayload() {
    read();
    return {
      runId: run.runId,
      model: run.model,
      scores: state,
      mapping: run.mapping,
      exportedAt: new Date().toISOString()
    };
  }

  function setExportStatus(text) {
    document.getElementById('export-status').textContent = text;
  }

  function openExport() {
    var text = JSON.stringify(buildPayload(), null, 2);
    var area = document.getElementById('export-json');
    area.value = text;
    document.getElementById('export-modal').hidden = false;
    area.focus();
    area.setSelectionRange(0, 0);
    area.scrollTop = 0;

    var scored = 0;
    Object.keys(state).forEach(function (key) {
      if (key.indexOf('best|') !== 0) scored++;
    });
    setExportStatus(
      scored > 0
        ? '已生成。下载没反应就点「复制 JSON」，把内容发我。'
        : '还没有评分；导出的 scores 会是空的，可以先评几项。'
    );
  }

  function closeExport() {
    document.getElementById('export-modal').hidden = true;
  }

  function downloadExport() {
    var text = document.getElementById('export-json').value;
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'whale-bench-' + run.runId + '.json';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    setExportStatus('已触发下载。没看到文件就点「复制 JSON」。');
  }

  function copyExport() {
    var area = document.getElementById('export-json');
    area.focus();
    area.select();

    var copied = false;
    try { copied = document.execCommand('copy'); } catch (e) { copied = false; }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(area.value).then(function () {
        setExportStatus('已复制到剪贴板。');
      }, function () {
        setExportStatus(copied ? '已复制到剪贴板。' : '复制失败：请手动全选复制。');
      });
      return;
    }

    setExportStatus(copied ? '已复制到剪贴板。' : '复制失败：请手动全选复制。');
  }

  document.getElementById('export').addEventListener('click', openExport);
  document.getElementById('export-close').addEventListener('click', closeExport);
  document.getElementById('export-download').addEventListener('click', downloadExport);
  document.getElementById('export-copy').addEventListener('click', copyExport);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeExport();
  });
  document.getElementById('export-modal').addEventListener('click', function (event) {
    if (event.target === this) closeExport();
  });

  document.getElementById('reveal').addEventListener('click', function () {
    document.body.classList.toggle('reveal');
    this.textContent = document.body.classList.contains('reveal') ? '隐藏变体' : '揭晓变体';
  });

  document.getElementById('reset').addEventListener('click', function () {
    if (!confirm('清空这台浏览器里的所有评分？')) return;
    state = {};
    try { localStorage.removeItem(KEY); } catch (e) {}
    document.querySelectorAll('input[type=radio]').forEach(function (input) { input.checked = false; });
    document.querySelectorAll('textarea').forEach(function (area) { area.value = ''; });
    updateProgress();
  });

  restore();
})();
`;

export interface IBuiltReport {
  html: string;
  markdown: string;
}

export const buildReport = (run: IRun): IBuiltReport => {
  const variants = new Map(
    run.variants.map((variant) => [variant.variant, variant]),
  );
  const first = run.variants[0];
  const labels = Object.keys(run.mapping[first.scenarios[0]?.id ?? ""] ?? {});

  const scenarios = first.scenarios
    .map((scenario) =>
      scenarioHtml(scenario, labels, variants, run.mapping[scenario.id] ?? {}),
    )
    .join("\n");

  const dataJson = JSON.stringify(run).replace(/</g, "\\u003c");
  const total = first.scenarios.length * labels.length;

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>小鲸鱼拟人度评分 · ${esc(run.runId)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="topbar">
  <div>
    <strong>小鲸鱼拟人度评分</strong>
    <span class="meta">${esc(run.runId)} · ${esc(run.model)} · ${run.variants.length} 个变体</span>
  </div>
  <div class="actions">
    <span class="progress" id="progress">0 / ${total} 已评</span>
    <button id="reveal" type="button">揭晓变体</button>
    <button id="export" type="button" class="primary">导出评分</button>
    <button id="reset" type="button">清空</button>
  </div>
</header>
<main>
  <section class="intro">
    <h1>挑一个最像人的小鲸鱼</h1>
    <p>同一个场景下，${labels.length} 段对话来自不同提示词 / 采样配置，<b>顺序已打乱</b>。先读，再打分；不用管哪段是哪个版本，最后点「揭晓变体」。</p>
    <ul>
      <li><b>人味</b>：像不像真人在打字（长度、语气、接梗、具体性）。</li>
      <li><b>聪明</b>：事实对不对、有没有查资料、回答有没有信息量。</li>
      <li><b>想继续聊</b>：读完这段，你还想不想跟她聊下去。</li>
    </ul>
    <p class="muted">分数只存在这台浏览器里；评完点「导出评分」，会打开一个 JSON 窗口，可以复制或下载。备注可以写「哪句最出戏」。</p>
  </section>
  ${scenarios}
  <section class="intro">
    <h2>揭晓</h2>
    <p class="muted">下面是每个场景里「版本 N」对应的真实变体。</p>
    <div id="reveal-box">
      ${mappingTable(run, labels)}
      ${run.variants
        .map(
          (variant) => `
        <p class="variant-meta">
          <b>${esc(variant.label)}</b>（${esc(variant.variant)}）
          <span class="muted">thinking=${esc(variant.sampling.thinkingEffort)} ·
          temperature=${variant.sampling.temperature ?? "默认"} ·
          extra=${esc(JSON.stringify(variant.sampling.extraBody))}</span>
        </p>`,
        )
        .join("")}
    </div>
  </section>
</main>
<div id="export-modal" class="modal" hidden>
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="export-title">
    <div class="modal-head">
      <h3 id="export-title">评分 JSON</h3>
      <button type="button" id="export-close" class="modal-close" aria-label="关闭">×</button>
    </div>
    <p class="muted" id="export-status">已生成。</p>
    <textarea id="export-json" readonly rows="14" spellcheck="false"></textarea>
    <div class="modal-actions">
      <button type="button" id="export-copy">复制 JSON</button>
      <button type="button" id="export-download" class="primary">下载 .json</button>
    </div>
    <p class="muted">如果浏览器拦截下载，就点「复制 JSON」，把内容发我。</p>
  </div>
</div>
<script id="run-data" type="application/json">${dataJson}</script>
<script>${JS}</script>
</body>
</html>`;

  return { html, markdown: markdownFor(run) };
};
