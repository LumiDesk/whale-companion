import assert from "node:assert/strict";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const { buildModelBody } = await import("../src/core/llm.js");
const { DEFAULT_SETTINGS } = await import("../src/settings.js");

const messages = [{ role: "user" as const, content: "你好" }];

const llm = (overrides: Partial<typeof DEFAULT_SETTINGS.llm> = {}) => ({
  ...DEFAULT_SETTINGS.llm,
  model: "deepseek-flash",
  baseUrl: "https://api.deepseek.com",
  apiKey: "sk-test",
  ...overrides,
});

test("默认不发送 temperature / max_tokens，思考为 high", () => {
  const body = buildModelBody(messages, llm());

  assert.equal(body.reasoning_effort, "high");
  assert.deepEqual(body.thinking, { type: "enabled" });
  assert.equal("temperature" in body, false);
  assert.equal("max_tokens" in body, false);
});

test("思考强度 low / max 按文档发送", () => {
  const low = buildModelBody(messages, llm({ thinkingEffort: "low" }));
  const max = buildModelBody(messages, llm({ thinkingEffort: "max" }));

  assert.equal(low.reasoning_effort, "low");
  assert.equal(max.reasoning_effort, "max");
  assert.deepEqual(max.thinking, { type: "enabled" });
});

test("关闭思考时发送 disabled，并恢复 temperature", () => {
  const body = buildModelBody(
    messages,
    llm({ thinkingEffort: "off", temperature: 0.7 }),
  );

  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal("reasoning_effort" in body, false);
  assert.equal(body.temperature, 0.7);
});

test("非 DeepSeek 接口不带 thinking 对象", () => {
  const body = buildModelBody(
    messages,
    llm({
      model: "gpt-4o",
      baseUrl: "https://example.com/v1",
      thinkingEffort: "low",
    }),
  );

  assert.equal("thinking" in body, false);
  assert.equal(body.reasoning_effort, "low");
});

test("max_tokens 与额外参数会被合并", () => {
  const body = buildModelBody(
    messages,
    llm({
      maxTokens: 256,
      extraBody: { top_p: 0.9 },
    }),
  );

  assert.equal(body.max_tokens, 256);
  assert.equal(body.top_p, 0.9);
});
