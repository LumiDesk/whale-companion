import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const dataDir = mkdtempSync(join(tmpdir(), "whale-agent-loop-"));
process.env.WHALE_DATA_DIR = dataDir;

const { runAgentTurn } = await import("../src/core/agent/loop.js");
const { DEFAULT_SETTINGS } = await import("../src/settings.js");
import type {
  IAgentDeps,
  IAgentToolContextBase,
  IIncomingMessage,
  IPersistTurnInput,
} from "../src/core/agent/types.js";
import type {
  IModelMessage,
  IModelReply,
  IToolCall,
} from "../src/types/message.js";

const incoming = (text = "你好"): IIncomingMessage => ({
  seq: 1,
  userId: "u1",
  msgId: "m1",
  text,
  images: [],
  at: Date.now(),
});

const toolCall = (name: string, args: unknown): IToolCall => ({
  id: `call-${name}`,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

const reply = (
  toolCalls: IToolCall[] = [],
  content: string | null = null,
): IModelReply => ({
  content,
  reasoningContent: "think",
  toolCalls,
});

interface IFake {
  deps: IAgentDeps;
  sent: string[];
  persisted: IPersistTurnInput[];
  messages: IModelMessage[][];
}

const makeDeps = (script: IModelReply[], maxMessages = 3): IFake => {
  const sent: string[] = [];
  const persisted: IPersistTurnInput[] = [];
  const messages: IModelMessage[][] = [];
  let remaining = 4;

  const toolContext: IAgentToolContextBase = {
    userId: "u1",
    now: () => Date.now(),
    sleep: async () => {},
    sendText: async (text) => {
      sent.push(text);
      remaining -= 1;
      return { sent: 1, failed: 0, remaining };
    },
    sendImage: async () => {
      remaining -= 1;
      return { sent: 1, failed: 0, remaining };
    },
    remaining: () => remaining,
    wait: async () => ({ messages: [], quiet: false, timeout: true }),
    pickSticker: () => undefined,
    listStickers: () => [],
    readSticker: () => Buffer.from([]),
    markStickerUsed: () => {},
    remember: (input) => ({ kind: input.kind, total: 1 }),
    setNextWake: (input) => ({
      wakeAt: Date.now() + input.afterMinutes * 60_000,
    }),
    recordReply: () => {},
    recordSilence: () => {},
    latestUserText: "你好",
    silentStreak: 0,
    config: { ...DEFAULT_SETTINGS.agent, maxMessages },
    style: "standard",
  };

  const deps: IAgentDeps = {
    history: [],
    config: { ...DEFAULT_SETTINGS.agent, maxMessages },
    style: "standard",
    now: () => Date.now(),
    askModel: async (modelMessages) => {
      messages.push(modelMessages);
      return script.shift() ?? reply([], "");
    },
    persistTurn: async (input) => {
      persisted.push(input);
    },
    toolContext,
  };

  return { deps, sent, persisted, messages };
};

test("send_message 后能继续一步，并把 reasoning_content 带回", async () => {
  const fake = makeDeps([
    reply([toolCall("send_message", { messages: ["你好呀"] })]),
    reply([], "想你了"),
  ]);

  await runAgentTurn("u1", [incoming()], "reactive", fake.deps);

  assert.deepEqual(fake.sent, ["你好呀"]);
  assert.equal(fake.persisted.length, 1);
  assert.equal(fake.persisted[0].silent, false);
  assert.ok(
    fake.persisted[0].transcript.some(
      (entry) => entry.role === "assistant" && entry.content === "你好呀",
    ),
  );

  const second = fake.messages[1];
  const assistant = second.find((message) => message.role === "assistant") as
    { reasoning_content?: string } | undefined;
  assert.equal(assistant?.reasoning_content, "think");
});

test("stay_silent 结束回合，不发送任何消息", async () => {
  const fake = makeDeps([
    reply([toolCall("stay_silent", { reason: "late_night" })]),
  ]);

  await runAgentTurn("u1", [incoming("嗯")], "reactive", fake.deps);

  assert.deepEqual(fake.sent, []);
  assert.equal(fake.persisted[0].silent, true);
});

test("响应式回合没话说时发兜底", async () => {
  const fake = makeDeps([reply([], null)]);

  await runAgentTurn("u1", [incoming()], "reactive", fake.deps);

  assert.deepEqual(fake.sent, ["嗯？"]);
  assert.equal(fake.persisted[0].silent, false);
});

test("响应式兜底也会把换行压成一行", async () => {
  const fake = makeDeps([reply([], "第一段\n\n第二段")]);

  await runAgentTurn("u1", [incoming()], "reactive", fake.deps);

  assert.deepEqual(fake.sent, ["第一段，第二段"]);
  assert.equal(fake.persisted[0].silent, false);
});

test("主动回合没话说时不发兜底，记为沉默", async () => {
  const fake = makeDeps([reply([], null)]);

  await runAgentTurn("u1", [], "proactive", fake.deps);

  assert.deepEqual(fake.sent, []);
  assert.equal(fake.persisted[0].silent, true);
  assert.equal(fake.persisted[0].mode, "proactive");
});

test("对方只发了个表情包、模型没动作时不发兜底「嗯？」", async () => {
  const fake = makeDeps([reply([], null)]);

  await runAgentTurn(
    "u1",
    [incoming("[表情包：耳尖抖抖]")],
    "reactive",
    fake.deps,
  );

  assert.deepEqual(fake.sent, []);
  assert.equal(fake.persisted[0].silent, true);
});

test("步数用尽时按已有发送收尾，不重复发", async () => {
  const fake = makeDeps(
    [
      reply([toolCall("send_message", { messages: ["一"] })]),
      reply([toolCall("send_message", { messages: ["二"] })]),
    ],
    1,
  );

  await runAgentTurn("u1", [incoming()], "reactive", fake.deps);

  assert.deepEqual(fake.sent, ["一"]);
  assert.equal(fake.persisted[0].silent, false);
});

test("工具错误会作为 tool 结果回填，不中断回合", async () => {
  const fake = makeDeps([
    reply([toolCall("send_message", { messages: ["字".repeat(201)] })]),
    reply([], "算了"),
  ]);

  await runAgentTurn("u1", [incoming()], "reactive", fake.deps);

  assert.deepEqual(fake.sent, ["算了"]);
  const second = fake.messages[1];
  const tool = second.find((message) => message.role === "tool") as
    { content: string } | undefined;
  assert.ok(tool?.content.includes("200"));
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
