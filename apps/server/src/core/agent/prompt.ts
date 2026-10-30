import { config } from "../../config.js";
import { loadMemory, renderMemory } from "../../store/memory.js";
import { listStickers } from "../../store/stickers.js";
import { listUsers } from "../../store/users.js";
import { getPersona } from "../persona.js";
import { dailyMood, timeOfDay, toneHint } from "../mood.js";
import { loadBehavior, loadLegacyBehavior } from "./behavior.js";
import { humanTextOf } from "./text.js";
import { formatAge, formatClock } from "./time.js";
import { detectStickerRequest } from "../sticker-request.js";
import type {
  AgentTurnMode,
  IAgentDeps,
  IIncomingMessage,
  ITurnBudget,
} from "./types.js";

const truncate = (text: string, max: number): string => {
  const body = text.replace(/\s+/g, " ").trim();
  return body.length > max ? `${body.slice(0, max)}…` : body;
};

const contentText = (content: unknown): string => {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof part.text === "string"
          ? part.text
          : "",
      )
      .join("");
  }

  return "";
};

const recentTurns = (deps: IAgentDeps): string => {
  const lines = deps.history
    .filter((message) => message.role !== "system")
    .slice(-6)
    .map((message) => {
      const text = truncate(contentText(message.content), 100);
      if (!text) return "";
      return `${message.role === "user" ? "他" : "你"}：${text}`;
    })
    .filter(Boolean);

  return lines.length > 0 ? `【你们最近】\n${lines.join("\n")}` : "";
};

const STICKER_BOUNDARY =
  "【你看不到表情包的画面】对方发表情包时你只知道它的名字，不要描述图里的内容，也不要假装看到了。";

const stickerLabel = (sticker: {
  desc?: string;
  tags: string[];
  id: string;
}): string => sticker.desc || sticker.tags[0] || sticker.id.slice(0, 8);

const stickerCatalogLine = (): string => {
  if (!config.sticker.enabled)
    return "【图库】表情包功能已关闭，不要调用 send_sticker。";

  const stickers = listStickers();
  if (stickers.length === 0) {
    return "【图库】还是空的，不要调用 send_sticker。";
  }

  if (!config.sticker.catalogInPrompt) {
    return `【图库】${stickers.length} 张可发；想发先用 list_stickers 搜 id 或标签。\n${STICKER_BOUNDARY}`;
  }

  const max = Math.max(1, Math.min(100, Math.floor(config.sticker.catalogMax)));
  const sorted = [...stickers].sort(
    (a, b) =>
      (b.useCount ?? 0) - (a.useCount ?? 0) || b.createdAt - a.createdAt,
  );
  const shown = sorted.slice(0, max);

  const lines = shown.map((sticker) => {
    const label = stickerLabel(sticker);
    const tags = sticker.tags.filter((tag) => tag !== label).slice(0, 4);
    const used = sticker.useCount ? ` 用过${sticker.useCount}次` : "";
    return `- ${label}${tags.length > 0 ? ` [${tags.join("/")}]` : ""} id=${sticker.id.slice(0, 8)}${used}`;
  });

  const more =
    stickers.length > shown.length
      ? `\n（还有 ${stickers.length - shown.length} 张，用 list_stickers 搜）`
      : "";

  return `【图库】${stickers.length} 张，想发就调用 send_sticker：\n${lines.join("\n")}${more}\n${STICKER_BOUNDARY}`;
};

const stickerPolicyLine = (batch: IIncomingMessage[]): string => {
  if (!config.sticker.enabled) return "";

  // 只看"最后一句人话"：表情包本身没有文字，合并批次时别被它挡住
  const humanMessages = batch
    .map((message) => humanTextOf(message.text))
    .filter(Boolean);
  const lastHuman = humanMessages[humanMessages.length - 1] ?? "";
  const request = lastHuman
    ? detectStickerRequest(lastHuman)
    : { requested: false };

  const lines: string[] = [];

  if (request.requested) {
    lines.push(
      "【他在要表情包】这轮必须发一张：直接调用 send_sticker（不知道挑哪张就不传 sticker，随机发一张）。",
    );
  }

  if (!config.sticker.proactiveSticker) {
    lines.push(
      "【本轮限制】不要主动发表情包；只有对方先发了表情、或他明确要图时才发一张。",
    );
  }

  return lines.join("\n");
};

const webLine = (): string => {
  if (!config.web.enabled) {
    return "【联网】已关闭，不确定就如实说，别编。";
  }

  return "【联网】可用：web_search / web_fetch。事实、时事、版本、价格先搜再答；搜不到就说不确定。";
};

const silentLine = (userId: string, now: number): string => {
  const user = listUsers().find((item) => item.userId === userId);
  if (!user?.lastSilentAt || !user.silentStreak) return "";

  const age = formatAge(user.lastSilentAt, now);
  return `【上次沉默】你上次选择没回（${age} 前，连续 ${user.silentStreak} 次）。`;
};

const proactiveLine = (
  deps: IAgentDeps,
  now: number,
  latest: IIncomingMessage | undefined,
): string => {
  if (!deps.proactiveIntent) return "";

  const minutes = deps.proactiveAfterMinutes ?? 0;
  const last = latest ? `他上次说话是 ${formatAge(latest.at, now)} 前。` : "";
  const allow =
    deps.proactiveAllowSilent === false
      ? "这次最好说点什么。"
      : "没话说也可以这次不说。";

  return `【主动机会】你${minutes > 0 ? `在 ${minutes} 分钟前想说：${deps.proactiveIntent}` : `想找他说：${deps.proactiveIntent}`}。${last}${allow}`;
};

export const buildAgentState = (
  userId: string,
  batch: IIncomingMessage[],
  budget: ITurnBudget,
  deps: IAgentDeps,
  mode: AgentTurnMode,
): string => {
  const now = deps.now();
  const latest = batch[batch.length - 1];
  const memory = renderMemory(
    loadMemory(userId),
    config.persona.ownerName,
    now,
  );
  const age = latest ? now - latest.at : 0;

  const clock = `【此刻】${new Date(now).toLocaleString("zh-CN")}，${timeOfDay(new Date(now))}。${toneHint(new Date(now))}。今天的心情：${dailyMood(userId, new Date(now))}。`;
  const latestLine = latest
    ? `【最新消息】他 ${formatAge(latest.at, now)} 前发来（${formatClock(latest.at, now)}）：${truncate(latest.text || "[图片]", 120)}`
    : "";
  const stale =
    latest && age > 10 * 60_000
      ? "（这条已经过了一段时间，别用秒回语气。）"
      : "";
  const budgetLine = `【本轮】已发 ${budget.sent} 条，还能发 ${Math.max(0, budget.maxMessages - budget.sent)} 条；等待${budget.waitUsed ? "已用过" : "未使用"}。`;
  const proactive =
    mode === "proactive" ? proactiveLine(deps, now, latest) : "";

  return [
    clock,
    latestLine,
    stale,
    recentTurns(deps),
    memory,
    stickerCatalogLine(),
    stickerPolicyLine(batch),
    webLine(),
    budgetLine,
    silentLine(userId, now),
    proactive,
  ]
    .filter(Boolean)
    .join("\n\n");
};

export const buildAgentSystem = (
  userId: string,
  batch: IIncomingMessage[],
  budget: ITurnBudget,
  deps: IAgentDeps,
  mode: AgentTurnMode,
): string =>
  [
    getPersona(),
    loadBehavior(deps.style),
    buildAgentState(userId, batch, budget, deps, mode),
  ]
    .filter(Boolean)
    .join("\n\n");

/** 无工具回退：人格 + 旧行为 + 记忆/此刻，直接输出文本 */
export const buildLegacySystem = (userId: string, now = Date.now()): string => {
  const memory = renderMemory(
    loadMemory(userId),
    config.persona.ownerName,
    now,
  );
  const clock = `【此刻】${new Date(now).toLocaleString("zh-CN")}，${timeOfDay(new Date(now))}。${toneHint(new Date(now))}。今天的心情：${dailyMood(userId, new Date(now))}。`;
  const sticker = config.sticker.enabled
    ? "【表情包】图库有货时，想发就在回复最后写 [表情包:关键词]；贴切才发。"
    : "【表情包】表情包功能已关闭，不要写 [表情包:关键词]。";

  return [getPersona(), loadLegacyBehavior(), memory, clock, sticker]
    .filter(Boolean)
    .join("\n\n");
};
