import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "../../config.js";
import type { AgentStyle } from "../../settings.js";
import { slog } from "../../util.js";

const warned = new Set<string>();

const FALLBACK_BASE = `# 行为规则（私聊）

你的文本输出只是思考，不会自动发给他。所有发言必须调用 send_message。
普通对话 1~2 条，最多 3 条；每条是一个完整意群，不要用空格假装分条。
对方明显没说完时调用 wait_for_messages，等 8~15 秒。
不想回时调用 stay_silent；直接提问、连续沉默 3 次、他明显难过时不要沉默。
只有值得长期记住的事才调用 remember；真的想再找他时调用 set_next_wake。
不要报告工具调用，不要说「我发了」「消息已发送成功」。`;

const FALLBACK_LEGACY = `你现在没有工具。直接输出你要发给他的话，不要输出 JSON、不要写工具名。
一次只发一条消息；超过 500 字才在自然停顿处切开。
不要 Markdown 标题、列表、加粗、引用块。`;

const readPrompt = (name: string): string => {
  const file = join(config.paths.promptsDir, "behavior", name);

  try {
    if (!existsSync(file)) return "";
    return readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
  } catch (error) {
    if (!warned.has(file)) {
      warned.add(file);
      slog(`读取行为提示词失败：${file}`, error);
    }
    return "";
  }
};

/** 行为基线 + 风格覆盖；文件缺失时用最小兜底，不阻塞启动 */
export const loadBehavior = (style: AgentStyle): string => {
  const base = readPrompt("base.md") || FALLBACK_BASE;
  const styleText =
    style === "standard" ? "" : readPrompt(`${style}.md`);

  if (base.includes("{{styleRules}}")) {
    return base.replace("{{styleRules}}", styleText).trim();
  }

  return [base, styleText].filter(Boolean).join("\n\n");
};

export const loadLegacyBehavior = (): string =>
  readPrompt("legacy.md") || FALLBACK_LEGACY;
