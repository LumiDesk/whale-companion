import { config } from "../config.js";
import { loadHistory, saveHistory } from "../store/history.js";
import { loadMemory, saveMemory, renderMemory } from "../store/memory.js";
import { listStickers } from "../store/stickers.js";
import { listUsers } from "../store/users.js";

export interface ICommandSpec {
  name: string;
  desc: string;
  /** 帮助里的用法；不写就用 /name */
  usage?: string;
  run: (
    userId: string,
    args: string,
  ) => Promise<CommandResult> | CommandResult;
}

type CommandAction = "new" | "forget";
type CommandResult = string | { action: CommandAction };

const helpText = () => {
  const lines = commands.map((command) => {
    const usage = command.usage ?? `/${command.name}`;
    return `${usage.padEnd(14)}${command.desc}`;
  });

  return [
    "我会这些：",
    ...lines,
    "",
    "平时直接说话就行。发图片我会看，也会悄悄存进表情包库。",
    "说「发个表情包」，我就挑一张给你 🐋",
  ].join("\n");
};

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
    desc: "清空对话重新开始（记忆和表情包都留着）",
    run: () => ({ action: "new" }),
  },
  {
    name: "memory",
    desc: "看看她记得什么",
    run: (id) =>
      renderMemory(loadMemory(id), config.persona.ownerName) ||
      "我现在脑子里空空的，还没记住什么呢。",
  },
  {
    name: "remember",
    desc: "让她记住一件事",
    usage: "/remember 内容",
    run: (id, args) => rememberFact(id, args),
  },
  { name: "status", desc: "运行状态", run: (id) => statusText(id) },
  {
    name: "forget",
    desc: "连记忆一起清空（表情包会保留）",
    run: () => ({ action: "forget" }),
  },
];

/** 解析 /xxx 参数；不是命令就返回 undefined */
export const parseCommand = (
  text: string,
): { name: string; args: string } | undefined => {
  // 只认单行命令：聚合后如果还跟着别的话，就交给模型正常回复
  const m = /^\/([a-zA-Z\u4e00-\u9fa5]+)(?:[ \t]+([^\n]*))?$/.exec(text.trim());
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

  if (typeof out === "string") return out;

  if (out.action === "new") {
    saveHistory(userId, []);
    return "好，刚才那些都翻篇了。重新开始吧，主人 🐋";
  }

  saveHistory(userId, []);
  saveMemory(userId, { summary: "", facts: [], updatedAt: Date.now() });
  return "……好吧，那就从陌生开始。\n（表情包我都留着呢，这点没舍得删）";
};
