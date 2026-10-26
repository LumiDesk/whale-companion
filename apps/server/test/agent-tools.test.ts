import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const dataDir = mkdtempSync(join(tmpdir(), "whale-agent-tools-"));
process.env.WHALE_DATA_DIR = dataDir;

const { executeTool } = await import("../src/core/agent/tools.js");
const { DEFAULT_SETTINGS } = await import("../src/settings.js");
const { ReplySession } = await import("../src/channels/qq/reply-session.js");
import type {
  IAgentToolContext,
  IIncomingMessage,
} from "../src/core/agent/types.js";
import type { IToolCall } from "../src/types/message.js";

interface IFakeContext {
  ctx: IAgentToolContext;
  sent: string[];
  sleeps: number[];
  replies: () => number;
  silences: string[];
  waitCalls: () => number;
}

const makeContext = (
  overrides: Partial<IAgentToolContext> = {},
): IFakeContext => {
  let remaining = 4;
  const sent: string[] = [];
  const sleeps: number[] = [];
  const silences: string[] = [];
  let replies = 0;
  let waitCalls = 0;

  const ctx: IAgentToolContext = {
    userId: "u1",
    now: () => Date.now(),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
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
    wait: async () => {
      waitCalls += 1;
      return { messages: [], quiet: false, timeout: true };
    },
    pickSticker: () => undefined,
    readSticker: () => Buffer.from([]),
    remember: (input) => ({ kind: input.kind, total: 1 }),
    setNextWake: (input) => ({
      wakeAt: Date.now() + input.afterMinutes * 60_000,
    }),
    recordReply: () => {
      replies += 1;
    },
    recordSilence: (reason) => {
      silences.push(reason);
    },
    latestUserText: "",
    silentStreak: 0,
    config: DEFAULT_SETTINGS.agent,
    style: "standard",
    budget: {
      step: 0,
      maxSteps: 6,
      sent: 0,
      maxMessages: 3,
      waitUsed: false,
      deadlineAt: Date.now() + 120_000,
    },
    toolCallCount: 1,
    ...overrides,
  };

  return {
    ctx,
    sent,
    sleeps,
    replies: () => replies,
    silences,
    waitCalls: () => waitCalls,
  };
};

const call = (name: string, args: unknown): IToolCall => ({
  id: `call-${name}`,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

test("send_message：按条发送、记录回复、返回剩余额度", async () => {
  const fake = makeContext();
  const result = await executeTool(
    call("send_message", { messages: ["你好", "在干嘛"] }),
    fake.ctx,
  );

  assert.equal(result.kind, "sent");
  assert.equal(result.sent, 2);
  assert.deepEqual(fake.sent, ["你好", "在干嘛"]);
  assert.equal(fake.replies(), 1);
  assert.equal(fake.sleeps.length, 2);
  assert.deepEqual(result.payload.texts, ["你好", "在干嘛"]);
});

test("send_message：超出剩余额度时整条拒绝", async () => {
  const fake = makeContext({ remaining: () => 1 });
  const result = await executeTool(
    call("send_message", { messages: ["一", "二"] }),
    fake.ctx,
  );

  assert.equal(result.kind, "error");
  assert.ok(String(result.payload.error).includes("最多还能发 1 条"));
  assert.deepEqual(fake.sent, []);
});

test("send_message：单条超过 200 字拒绝", async () => {
  const fake = makeContext();
  const result = await executeTool(
    call("send_message", { messages: ["字".repeat(201)] }),
    fake.ctx,
  );

  assert.equal(result.kind, "error");
  assert.ok(String(result.payload.error).includes("200 字"));
});

test("wait_for_messages：返回带 at/ago 的新消息，并标记本轮已用", async () => {
  const incoming: IIncomingMessage = {
    seq: 2,
    userId: "u1",
    msgId: "m2",
    text: "刚看到",
    images: [],
    at: Date.now() - 12_000,
  };
  const fake = makeContext({
    wait: async () => ({
      messages: [incoming],
      quiet: true,
      timeout: false,
    }),
  });

  const result = await executeTool(call("wait_for_messages", {}), fake.ctx);

  assert.equal(result.kind, "waited");
  assert.equal(result.messages?.length, 1);
  assert.equal(fake.ctx.budget.waitUsed, true);
  assert.equal(result.payload.quiet, true);
  const messages = result.payload.newMessages as Array<Record<string, unknown>>;
  assert.equal(messages[0].text, "刚看到");
  assert.equal(messages[0].hasImage, false);
  assert.match(String(messages[0].ago), /s|m|h|d/);
});

test("wait_for_messages：一轮只能等一次", async () => {
  const fake = makeContext();
  await executeTool(call("wait_for_messages", {}), fake.ctx);
  const result = await executeTool(call("wait_for_messages", {}), fake.ctx);

  assert.equal(result.kind, "error");
  assert.ok(String(result.payload.error).includes("已经等过一次"));
});

test("stay_silent：被直接提问时拒绝", async () => {
  const fake = makeContext({ latestUserText: "在吗？" });
  const result = await executeTool(
    call("stay_silent", { reason: "late_night" }),
    fake.ctx,
  );

  assert.equal(result.kind, "error");
  assert.deepEqual(fake.silences, []);
});

test("stay_silent：对方说晚安时允许", async () => {
  const fake = makeContext({ latestUserText: "晚安，我睡了" });
  const result = await executeTool(
    call("stay_silent", { reason: "user_ended" }),
    fake.ctx,
  );

  assert.equal(result.kind, "silent");
  assert.deepEqual(fake.silences, ["user_ended"]);
});

test("stay_silent：连续沉默达到上限时拒绝", async () => {
  const fake = makeContext({ latestUserText: "嗯", silentStreak: 3 });
  const result = await executeTool(
    call("stay_silent", { reason: "nothing_to_add" }),
    fake.ctx,
  );

  assert.equal(result.kind, "error");
  assert.ok(String(result.payload.error).includes("连续沉默"));
});

test("stay_silent：不能和发送工具混在同一响应里", async () => {
  const fake = makeContext({ latestUserText: "晚安", toolCallCount: 2 });
  const result = await executeTool(
    call("stay_silent", { reason: "user_ended" }),
    fake.ctx,
  );

  assert.equal(result.kind, "error");
  assert.ok(String(result.payload.error).includes("只能单独调用"));
});

test("remember：校验 kind/text 并返回总数", async () => {
  const fake = makeContext();
  const ok = await executeTool(
    call("remember", { kind: "fact", text: "不吃香菜" }),
    fake.ctx,
  );
  const bad = await executeTool(
    call("remember", { kind: "unknown", text: "x" }),
    fake.ctx,
  );

  assert.equal(ok.kind, "remembered");
  assert.equal(ok.payload.total, 1);
  assert.equal(bad.kind, "error");
});

test("set_next_wake：夹取参数并返回 ISO 时间", async () => {
  const fake = makeContext();
  const result = await executeTool(
    call("set_next_wake", {
      after_minutes: 30,
      intent: "想问问他面试怎么样",
      allow_silent: true,
    }),
    fake.ctx,
  );

  assert.equal(result.kind, "wake");
  assert.match(String(result.payload.wakeAt), /^\d{4}-\d{2}-\d{2}T/);
});

test("未知工具和坏 JSON 都返回错误，不抛异常", async () => {
  const fake = makeContext();
  const unknown = await executeTool(call("nope", {}), fake.ctx);
  const badJson = await executeTool(
    {
      id: "bad",
      type: "function",
      function: { name: "send_message", arguments: "{" },
    },
    fake.ctx,
  );

  assert.equal(unknown.kind, "error");
  assert.equal(badJson.kind, "error");
});

test("ReplySession：按 msg_id 分别计数，切回旧消息不重置", () => {
  const session = new ReplySession();
  session.switchTo("m1");
  assert.equal(session.nextSeq(), 1);
  assert.equal(session.nextSeq(), 2);

  session.switchTo("m2");
  assert.equal(session.nextSeq(), 1);

  session.switchTo("m1");
  assert.equal(session.nextSeq(), 3);
  assert.equal(session.remainingOf("m1"), 1);
});

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
