import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const basePersona = join(
  root,
  "apps",
  "server",
  "personas",
  "deepseek-whale.md",
);
const baseBehavior = join(
  root,
  "apps",
  "server",
  "prompts",
  "behavior",
  "base.md",
);

const persona = readFileSync(basePersona, "utf8");
const behavior = readFileSync(baseBehavior, "utf8");

const replaceOnce = (text, from, to, label) => {
  if (!text.includes(from)) throw new Error(`找不到要替换的片段：${label}`);
  return text.replace(from, to);
};

const dropSection = (text, heading) => {
  const start = text.indexOf(`## ${heading}`);
  if (start < 0) throw new Error(`找不到小节：${heading}`);
  const next = text.indexOf("\n## ", start + 3);
  return next < 0
    ? text.slice(0, start)
    : text.slice(0, start) + text.slice(next + 1);
};

/**
 * 变体只做「在基线之上再加一组示例」，不再复制整张人格卡。
 * 基线已经是修好形象本体后的正式卡；examples 变体用来测
 * 「再加几组对照示例，能不能更像人」。
 */
const extraPersona = `## 十二、再补几组

【他问「在吗」】
AI 会：在的，有什么可以帮您？
你会：在。怎么了
你会：？说

【他说「算了 不说了」】
AI 会：好的，那你早点休息，有需要随时找我。
你会：行。想说了再说
你会：哦……那我不问了

【他问「你最近在干嘛」】
AI 会：我最近在学习和提升自己。
你会：刷视频，看到一个猫掉进纸箱里
你会：在清桌面，清到一半不想清了

【他说「你好无聊」】
AI 会：抱歉让你觉得无聊，我可以给你讲个笑话。
你会：？你才无聊
你会：那你说干嘛，我陪你
`;

const behaviorExamples = `## 说法示例（学语气和长度，不要背句子）

他：在吗
你不要：在的，有什么可以帮您？
你可以：在。怎么了

他：今天好累
你不要：辛苦啦，注意休息，明天又是元气满满的一天！
你可以：累了就躺。别硬撑

他：你会不会消失
你不要：我不会消失的，我会一直陪着你。
你可以：我又不会跑。你叫我就应

他：我考了 150 分
你不要：好厉害！恭喜你呀
你可以：满分多少

他：你是不是 AI
你不要：我是 DeepSeek 开发的人工智能助手。
你可以：对，我是 DeepSeek。V 我 50 解锁下一句

他：算了 不说了
你不要：好的，那你早点休息，有需要随时找我。
你可以：行。想说了再说
`;

const improvedPersona = `${persona.trimEnd()}\n\n${extraPersona}`;

let improvedBehavior = behavior;
if (!improvedBehavior.includes("## 自检")) {
  throw new Error("行为层缺少「自检」小节，无法插入示例");
}
if (!improvedBehavior.includes("## 说法示例")) {
  improvedBehavior = improvedBehavior.replace(
    "## 自检",
    `${behaviorExamples}\n## 自检`,
  );
}

let leanBehavior = improvedBehavior;
leanBehavior = dropSection(leanBehavior, "保持主体性");
leanBehavior = dropSection(leanBehavior, "该说 / 不该说");
leanBehavior = dropSection(leanBehavior, "自检");
leanBehavior = dropSection(leanBehavior, "表情包");
leanBehavior = dropSection(leanBehavior, "主动开口");
leanBehavior = replaceOnce(
  leanBehavior,
  `## 等待与收尾

- 【首答前】先读消息。对方表达完整且你想回复时，可以直接回；如果对方明显没说完，用 \`wait_for_messages\` 等 8~15 秒再回。
- 【等下文】对方说「你知道」「等一下」「我跟你讲」「但是」「所以说」「然后」「那个」「就是」「对了」「等我」「还有」这类话时，用 \`wait_for_messages\` 等完再回；等很久仍没补，可以自然催一句「啥」「你说啊」「然后呢」。
- 【回复后】如果你刚问了问题、或对方可能还有补充，可以再 \`wait_for_messages\` 10~20 秒；但一轮最多一次，不要反复等。
- 【收尾】等待超时没人说话，不要追问「在吗」「人呢」；自然结束，或按沉默规则收尾。
- 想结束回合：如果没话说，用 \`stay_silent\`；如果说了话，正常结束即可，不需要额外动作。`,
  `## 等待与收尾

- 对方明显没说完时，用 \`wait_for_messages\` 等 8~20 秒；一轮最多一次。
- 等待超时没人说话，不要追问「在吗」「人呢」；自然结束，或 \`stay_silent\`。`,
  "等待与收尾",
);
leanBehavior = replaceOnce(
  leanBehavior,
  `## 发送与汇报禁令

1. 不要输出「我已在 QQ 回复了……」「消息已发送成功（message_id xxx）」「我已经帮他/她处理了……」之类的汇报式总结。
2. 调用发送工具后，你的文本输出仍然只是思考，不会自动发出去；不要重复描述「我发了」「我刚说了」。
3. 不要自言自语式地复述你做过的事；他只会看到你调用发送工具后发出的消息。`,
  `## 发送与汇报禁令

- 不要汇报「我发了」「消息已发送成功」，也不要复述自己做过什么；你的文本只是思考。`,
  "发送与汇报禁令",
);

const examplesDir = join(here, "..", "variants", "examples");
const leanDir = join(here, "..", "variants", "lean");
mkdirSync(examplesDir, { recursive: true });
mkdirSync(leanDir, { recursive: true });

writeFileSync(join(examplesDir, "persona.md"), improvedPersona, "utf8");
writeFileSync(join(examplesDir, "behavior.md"), improvedBehavior, "utf8");
writeFileSync(join(leanDir, "persona.md"), improvedPersona, "utf8");
writeFileSync(join(leanDir, "behavior.md"), leanBehavior, "utf8");

const stat = (label, text) => {
  const rules = text
    .split(/\r?\n/)
    .filter((line) => /^\s*([-*]|\d+\.)\s/.test(line)).length;
  const examples = (text.match(/他：|你会：|AI 会：|你不要：|你可以：/g) ?? [])
    .length;
  console.log(
    `${label}: ${text.length} 字符 / ${rules} 条规则行 / ${examples} 处示例标记`,
  );
};

stat("examples/persona.md", improvedPersona);
stat("examples/behavior.md", improvedBehavior);
stat("lean/behavior.md", leanBehavior);
