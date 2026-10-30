import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const dataDir = mkdtempSync(join(tmpdir(), "whale-agent-prompt-"));
process.env.WHALE_DATA_DIR = dataDir;
process.env.WHALE_PERSONA_DIR = fileURLToPath(
  new URL("../personas", import.meta.url),
);
process.env.WHALE_PROMPTS_DIR = fileURLToPath(
  new URL("../prompts", import.meta.url),
);

const { buildAgentSystem, buildLegacySystem } =
  await import("../src/core/agent/prompt.js");
const { loadBehavior } = await import("../src/core/agent/behavior.js");
const { DEFAULT_SETTINGS } = await import("../src/settings.js");
import type {
  IAgentDeps,
  IIncomingMessage,
  ITurnBudget,
} from "../src/core/agent/types.js";

const deps = {
  history: [
    { role: "user", content: "上次说的那个面试" },
    { role: "assistant", content: "嗯，我记着呢" },
  ],
  config: DEFAULT_SETTINGS.agent,
  style: "standard",
  now: () => Date.now(),
  askModel: async () => ({ content: null, toolCalls: [] }),
  persistTurn: async () => {},
  toolContext: {},
} as unknown as IAgentDeps;

const budget: ITurnBudget = {
  step: 0,
  maxSteps: 6,
  sent: 0,
  maxMessages: 3,
  stickers: 0,
  maxStickers: 1,
  waitUsed: false,
  deadlineAt: Date.now() + 120_000,
};

const batch: IIncomingMessage[] = [
  {
    seq: 1,
    userId: "u1",
    msgId: "m1",
    text: "我面试过了",
    images: [],
    at: Date.now() - 30_000,
  },
];

test("Agent system 包含人格、行为、此刻三层", () => {
  const text = buildAgentSystem("u1", batch, budget, deps, "reactive");

  assert.match(text, /DeepSeek 小鲸鱼/);
  assert.match(text, /所有发言必须调用 `send_message`/);
  assert.match(text, /【此刻】/);
  assert.match(text, /【最新消息】/);
  assert.match(text, /【图库】/);
  assert.doesNotMatch(text, /一条住在主人电脑里的鲸鱼少女/);
});

test("行为风格会追加对应片段", () => {
  assert.match(loadBehavior("restrained"), /风格覆盖：克制/);
  assert.match(loadBehavior("chatty"), /风格覆盖：话痨/);
  assert.doesNotMatch(loadBehavior("standard"), /风格覆盖/);
});

test("legacy system 不包含工具协议", () => {
  const text = buildLegacySystem("u1");
  assert.match(text, /你现在没有工具/);
  assert.doesNotMatch(text, /send_message/);
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
