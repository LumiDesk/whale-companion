import { config } from "../config.js";
import { loadHistory, saveHistory } from "../store/history.js";
import { loadMemory, saveMemory, renderMemory } from "../store/memory.js";
import { listStickers } from "../store/stickers.js";
import { listUsers } from "../store/users.js";

export interface ICommandSpec {
  name: string;
  desc: string;
  run: (userId: string, args: string) => Promise<string> | string;
}

const helpText = () =>
  [
    "我会这些：",
    "/new      清空对话重新开始（记忆和表情包都留着）",
    "/forget   连记忆一起清空（表情包会保留）",
    "/memory   看看我记住了什么",
    "/remember 内容 —— 让我记住一件事",
    "/status   我的状态",
    "/help     这份清单",
    "",
    "平时直接说话就行。发图片我会看，也会悄悄存进表情包库。",
    "说「发个表情包」，我就挑一张给你 🐋",
  ].join("\n");

const rememberFact = (userId: string, fact: string): string => {
  const text = fact.trim();
  if (!text) return "要记住什么呀？用法：/remember 我不吃香菜";
  if (text.length > 80) return "太长了，我记不住…短一点好不好";

  const mem = loadMemory(userId);
  if (mem.facts.includes(text)) return "这个我已经记住啦，不用再说一遍。";

  const facts = [...mem.facts, text].slice(-20);
  saveMemory(userId, { ...mem, facts, updatedAt: Date.now() });
  return `记住啦：${text}`;
};

const statusText = (userId: string): string => {
  const history = loadHistory(userId);
  const mem = loadMemory(userId);
  const stickers = listStickers();
  const me = listUsers().find((u) => u.userId === userId);

  return [
    `对话记录：${history.length} 条（每次只带最近 ${config.history.send} 条给我看）`,
    `记忆摘要：${mem.summary ? `${mem.summary.length} 字` : "还没有"}`,
    `记住的事：${mem.facts.length} 条`,
    `表情包：${stickers.length} 张`,
    me?.lastProactiveAt
      ? `上次主动找你：${new Date(me.lastProactiveAt).toLocaleString("zh-CN")}`
      : "还没主动找过你",
  ].join("\n");
};

export const commands: ICommandSpec[] = [
  { name: "help", desc: "看看我能做什么", run: () => helpText() },
  {
    name: "new",
    desc: "清空对话重新开始",
    run: () => {
      return "__NEW__"; // 由调用方带上 userId 处理
    },
  },
  { name: "memory", desc: "看看她记得什么", run: (id) => renderMemory(loadMemory(id)) || "我现在脑子里空空的，还没记住什么呢。" },
  { name: "remember", desc: "让她记住一件事", run: (id, args) => rememberFact(id, args) },
  { name: "status", desc: "运行状态", run: (id) => statusText(id) },
  { name: "forget", desc: "连记忆一起清空", run: () => "__FORGET__" },
];

/** 解析 /xxx 参数；不是命令就返回 undefined */
export const parseCommand = (
  text: string,
): { name: string; args: string } | undefined => {
  const m = /^\/([a-zA-Z\u4e00-\u9fa5]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return undefined;
  return { name: m[1].toLowerCase(), args: (m[2] ?? "").trim() };
};

/** 执行命令，返回要发出去的文本 */
export const runCommand = async (
  name: string,
  args: string,
  userId: string,
): Promise<string> => {
  const spec = commands.find((c) => c.name === name);
  if (!spec) return `没有 /${name} 这个命令哦，/help 看看我会什么。`;

  const out = await spec.run(userId, args);

  // 需要 userId 的两个特殊命令在这里处理，避免在表里塞闭包
  if (out === "__NEW__") {
    saveHistory(userId, []);
    return "好，刚才那些都翻篇了。重新开始吧，主人 🐋";
  }
  if (out === "__FORGET__") {
    saveHistory(userId, []);
    saveMemory(userId, { summary: "", facts: [], updatedAt: Date.now() });
    return "……你确定要我忘掉？哼，好吧，那就从陌生开始。\n（表情包我都留着呢，这点没舍得删）";
  }

  return out;
};
