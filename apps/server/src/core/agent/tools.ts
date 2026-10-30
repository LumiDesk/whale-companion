import { config } from "../../config.js";
import { fetchWebPage, searchWeb } from "../web.js";
import { slog } from "../../util.js";
import { formatAge, formatClock } from "./time.js";
import type {
  IAgentToolContext,
  IToolExecutionResult,
  IWaitResult,
  MemoryKind,
} from "./types.js";
import type { IToolCall } from "../../types/message.js";

const error = (message: string): IToolExecutionResult => ({
  kind: "error",
  payload: { ok: false, error: message },
});

const errorText = (value: unknown): string =>
  value instanceof Error ? value.message : String(value);

const parseArgs = (raw: string): Record<string, unknown> | null => {
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const asInt = (value: unknown, fallback: number): number => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : fallback;
};

const asBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const randomBetween = (min: number, max: number): number =>
  Math.round(min + Math.random() * Math.max(0, max - min));

const CRISIS_RE = /想死|不想活|自残|自杀|活不下去/;
const HARD_STOP_RE = /别回|不用回|不要回/;
const SOFT_STOP_RE = /晚安|睡了|拜拜|下线|先忙/;
const MUST_REPLY_RE =
  /[?？]|在吗|理我|说话|回我|帮我看|怎么办|你觉得|你能不能|你是不是/;

const SILENT_REASONS = new Set([
  "user_ended",
  "late_night",
  "nothing_to_add",
  "wait_for_more",
  "not_addressed",
  "other",
]);

const MEMORY_KINDS = new Set<MemoryKind>(["fact", "topic", "thought"]);

const capacity = (ctx: IAgentToolContext): number =>
  Math.max(
    0,
    Math.min(ctx.config.maxMessages - ctx.budget.sent, ctx.remaining()),
  );

const gapFor = (ctx: IAgentToolContext, fixed: number): number => {
  if (fixed > 0) return clamp(fixed, 300, 8_000);

  const useLong = Math.random() < 0.2;
  return useLong
    ? randomBetween(4_000, 8_000)
    : randomBetween(ctx.config.gapMinMs, ctx.config.gapMaxMs);
};

const sendMessage = async (
  ctx: IAgentToolContext,
  args: Record<string, unknown>,
): Promise<IToolExecutionResult> => {
  if (!Array.isArray(args.messages)) {
    return error("messages 必须是字符串数组");
  }

  const messages = args.messages.map((item) => asString(item)).filter(Boolean);

  if (messages.length === 0) return error("messages 不能为空");
  if (messages.length > 4) return error("一次最多发 4 条");

  for (const text of messages) {
    if (text.length > 200) {
      return error("单条消息不能超过 200 字，拆成两条再发");
    }
  }

  const available = capacity(ctx);
  if (available <= 0) {
    return error("本轮/本条消息没有剩余回复额度了，等他再说一句");
  }
  if (messages.length > available) {
    return error(`现在最多还能发 ${available} 条，先少发一点`);
  }

  const fixedGap = asInt(args.gap_ms, 0);
  let sent = 0;
  let failed = 0;
  let remaining = ctx.remaining();
  let lastError = "";

  for (let index = 0; index < messages.length; index += 1) {
    if (index === 0) {
      if (ctx.config.replyDelayMs > 0) {
        await ctx.sleep(ctx.config.replyDelayMs);
      }
    } else {
      await ctx.sleep(gapFor(ctx, fixedGap));
    }

    try {
      const outcome = await ctx.sendText(messages[index]);
      if (outcome.sent > 0) sent += outcome.sent;
      if (outcome.failed > 0) failed += outcome.failed;
      remaining = outcome.remaining;
      if (remaining <= 0 && index < messages.length - 1) {
        failed += messages.length - index - 1;
        lastError = "QQ 回复额度用完了";
        break;
      }
    } catch (e) {
      failed += 1;
      lastError = errorText(e);
      slog("Agent 发送失败", e);
      break;
    }
  }

  if (sent > 0) ctx.recordReply();

  const payload: Record<string, unknown> = {
    ok: failed === 0,
    kind: "sent",
    sent,
    failed,
    remaining,
    texts: messages.slice(0, sent),
  };
  if (lastError) payload.error = lastError;

  if (sent === 0) return { kind: "error", payload };
  return {
    kind: "sent",
    sent,
    texts: messages.slice(0, sent),
    payload,
  };
};

const waitForMessages = async (
  ctx: IAgentToolContext,
  args: Record<string, unknown>,
): Promise<IToolExecutionResult> => {
  if (ctx.budget.waitUsed) {
    return error("本轮已经等过一次了，不要再等");
  }

  const max = clamp(Math.floor(ctx.config.waitMaxMs), 5_000, 60_000);
  const timeoutMs = clamp(
    asInt(args.timeout_ms, Math.min(15_000, max)),
    5_000,
    max,
  );
  const quietMs = clamp(asInt(args.quiet_ms, 4_000), 2_000, 10_000);

  ctx.budget.waitUsed = true;

  let result: IWaitResult;
  try {
    result = await ctx.wait({ timeoutMs, quietMs });
  } catch (e) {
    return error(`等待失败：${errorText(e)}`);
  }

  const now = ctx.now();
  const newMessages = result.messages.map((message) => ({
    text: message.text || "[图片]",
    at: formatClock(message.at, now),
    ago: formatAge(message.at, now),
    hasImage: message.images.length > 0,
  }));

  return {
    kind: "waited",
    messages: result.messages,
    payload: {
      ok: true,
      newMessages,
      quiet: result.quiet,
      timeout: result.timeout,
      remaining: capacity(ctx),
    },
  };
};

const sendSticker = async (
  ctx: IAgentToolContext,
  args: Record<string, unknown>,
): Promise<IToolExecutionResult> => {
  const available = capacity(ctx);
  if (available <= 0) {
    return error("本轮/本条消息没有剩余回复额度了");
  }

  const keyword = asString(args.keyword);
  const sticker = ctx.pickSticker(keyword);
  if (!sticker) {
    return error("图库没有合适的表情包，继续用文字");
  }

  try {
    const bytes = new Uint8Array(ctx.readSticker(sticker));
    const outcome = await ctx.sendImage(bytes);
    if (outcome.sent <= 0) {
      return error("表情包没有发出去");
    }
    ctx.recordReply();
    return {
      kind: "sent",
      sent: 1,
      texts: [],
      payload: {
        ok: true,
        kind: "sent",
        sent: 1,
        remaining: outcome.remaining,
        keyword,
        stickerId: sticker.id,
      },
    };
  } catch (e) {
    slog("Agent 发表情包失败", e);
    return error(`发表情包失败：${errorText(e)}`);
  }
};

const staySilent = async (
  ctx: IAgentToolContext,
  args: Record<string, unknown>,
): Promise<IToolExecutionResult> => {
  if (ctx.toolCallCount !== 1) {
    return error("stay_silent 只能单独调用，不能和发送/等待混在一起");
  }
  if (!ctx.config.silenceEnabled) {
    return error("沉默功能已关闭，这次要回一句");
  }
  if (ctx.budget.sent > 0) {
    return error("本轮已经说过话了，这次不需要再沉默");
  }

  const reason = asString(args.reason);
  if (!SILENT_REASONS.has(reason)) {
    return error("reason 不合法");
  }

  const text = ctx.latestUserText;
  if (CRISIS_RE.test(text)) {
    return error("他听起来很难受，这次不能沉默，认真回一句");
  }
  if (HARD_STOP_RE.test(text)) {
    // 明确说不用回，允许沉默
  } else if (MUST_REPLY_RE.test(text)) {
    return error("对方在直接问你，这次不能沉默；回一句或先等");
  } else if (SOFT_STOP_RE.test(text)) {
    // 晚安 / 先忙这类结束语，允许沉默
  }
  if (ctx.silentStreak >= ctx.config.maxSilentStreak) {
    return error(`已经连续沉默 ${ctx.silentStreak} 次了，这次至少回一句`);
  }

  ctx.recordSilence(reason);
  return {
    kind: "silent",
    payload: { ok: true, silent: true, reason },
  };
};

const remember = async (
  ctx: IAgentToolContext,
  args: Record<string, unknown>,
): Promise<IToolExecutionResult> => {
  const kind = asString(args.kind) as MemoryKind;
  if (!MEMORY_KINDS.has(kind)) {
    return error("kind 必须是 fact / topic / thought");
  }

  const text = asString(args.text);
  if (!text) return error("text 不能为空");
  if (text.length > 200) return error("text 不能超过 200 字");

  const pendingQuestion = asString(args.pending_question);
  if (pendingQuestion.length > 200) {
    return error("pending_question 不能超过 200 字");
  }

  const expiresInMinutes = clamp(asInt(args.expires_in_minutes, 120), 5, 1440);

  try {
    const result = ctx.remember({
      kind,
      text,
      ...(pendingQuestion ? { pendingQuestion } : {}),
      ...(kind === "thought" ? { expiresInMinutes } : {}),
    });

    return {
      kind: "remembered",
      payload: {
        ok: true,
        kind,
        total: result.total,
        ...(result.expiresAt
          ? { expiresAt: new Date(result.expiresAt).toISOString() }
          : {}),
      },
    };
  } catch (e) {
    return error(`记忆写入失败：${errorText(e)}`);
  }
};

const setNextWake = async (
  ctx: IAgentToolContext,
  args: Record<string, unknown>,
): Promise<IToolExecutionResult> => {
  const afterMinutes = asInt(args.after_minutes, 0);
  if (afterMinutes < 15 || afterMinutes > 720) {
    return error("after_minutes 需要在 15~720 之间");
  }

  const intent = asString(args.intent);
  if (!intent) return error("intent 不能为空");
  if (intent.length > 100) return error("intent 不能超过 100 字");

  const allowSilent = asBool(args.allow_silent, true);

  try {
    const result = ctx.setNextWake({
      afterMinutes,
      intent,
      allowSilent,
    });
    return {
      kind: "wake",
      payload: {
        ok: true,
        wakeAt: new Date(result.wakeAt).toISOString(),
        afterMinutes,
      },
    };
  } catch (e) {
    return error(`设置主动唤醒失败：${errorText(e)}`);
  }
};

const shorten = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

const webSearchTool = async (
  _ctx: IAgentToolContext,
  args: Record<string, unknown>,
): Promise<IToolExecutionResult> => {
  if (!config.web.enabled) return error("联网搜索已在设置里关闭");

  const query = asString(args.query);
  if (!query) return error("query 不能为空");
  if ([...query].length > 128) return error("query 不能超过 128 字");

  const limit = Math.max(1, Math.min(10, config.web.maxResults));
  const count = clamp(asInt(args.count, limit), 1, limit);

  try {
    const results = await searchWeb(query, count);

    if (results.length === 0) {
      return {
        kind: "searched",
        payload: {
          ok: true,
          query,
          results: [],
          note: "没有搜到结果；可以换个关键词，或者直接说不确定",
        },
      };
    }

    return {
      kind: "searched",
      payload: {
        ok: true,
        query,
        count: results.length,
        results: results.map((item) => ({
          title: shorten(item.title, 120),
          url: item.url,
          ...(item.siteName ? { site: item.siteName } : {}),
          ...(item.date ? { date: item.date } : {}),
          summary: shorten(item.summary, 350),
        })),
      },
    };
  } catch (e) {
    return error(`搜索失败：${errorText(e)}`);
  }
};

const webFetchTool = async (
  _ctx: IAgentToolContext,
  args: Record<string, unknown>,
): Promise<IToolExecutionResult> => {
  if (!config.web.enabled) return error("联网搜索已在设置里关闭");

  const url = asString(args.url);
  if (!url) return error("url 不能为空");

  try {
    const page = await fetchWebPage(url);
    const truncated = page.content.length > config.web.fetchMaxChars;
    const content = truncated
      ? `${page.content.slice(0, config.web.fetchMaxChars)}…（已截断）`
      : page.content;

    return {
      kind: "searched",
      payload: {
        ok: true,
        url,
        title: page.title,
        content,
        truncated,
      },
    };
  } catch (e) {
    return error(`打开网页失败：${errorText(e)}`);
  }
};

export const executeTool = async (
  call: IToolCall,
  ctx: IAgentToolContext,
): Promise<IToolExecutionResult> => {
  const args = parseArgs(call.function.arguments);
  if (!args) {
    return error("工具参数不是合法 JSON 对象");
  }

  switch (call.function.name) {
    case "send_message":
      return sendMessage(ctx, args);
    case "wait_for_messages":
      return waitForMessages(ctx, args);
    case "web_search":
      return webSearchTool(ctx, args);
    case "web_fetch":
      return webFetchTool(ctx, args);
    case "send_sticker":
      return sendSticker(ctx, args);
    case "stay_silent":
      return staySilent(ctx, args);
    case "remember":
      return remember(ctx, args);
    case "set_next_wake":
      return setNextWake(ctx, args);
    default:
      return error(`没有这个工具：${call.function.name}`);
  }
};
