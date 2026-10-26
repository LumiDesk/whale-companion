import assert from "node:assert/strict";
import test from "node:test";

const {
  DEFAULT_SETTINGS,
  fromEnv,
  normalizeSettings,
  toEnv,
  validateSettings,
} = await import("../src/settings.js");

const complete = () =>
  normalizeSettings({
    qq: { appId: "10001", appSecret: "qq-secret" },
    llm: { apiKey: "sk-test" },
  });

test("默认设置与必填项", () => {
  assert.equal(DEFAULT_SETTINGS.llm.model, "deepseek-flash");
  assert.equal(DEFAULT_SETTINGS.llm.thinkingEffort, "high");
  assert.equal(DEFAULT_SETTINGS.llm.temperature, null);
  assert.equal(DEFAULT_SETTINGS.conversation.historySend, 40);
  assert.equal(DEFAULT_SETTINGS.proactive.maxPerDay, 1);
  assert.equal(DEFAULT_SETTINGS.stickers.minScore, 0.12);
  assert.equal(DEFAULT_SETTINGS.agent.enabled, true);
  assert.equal(DEFAULT_SETTINGS.agent.style, "standard");
  assert.equal(DEFAULT_SETTINGS.agent.maxMessages, 3);
  assert.equal(DEFAULT_SETTINGS.agent.turnTimeoutMs, 120000);

  const errors = validateSettings(DEFAULT_SETTINGS);
  assert.equal(errors.length, 3);
});

test("env 往返：默认值、布尔、数字、JSON、可选温度", () => {
  const settings = complete();
  const env = toEnv(settings);

  assert.equal(env.DEEPSEEK_MODEL, "deepseek-flash");
  assert.equal(env.DEEPSEEK_THINKING_EFFORT, "high");
  assert.equal(env.VISION_ENABLED, "true");
  assert.equal(env.BATCH_SILENCE_MS, "3000");
  assert.equal(env.AGENT_ENABLED, "true");
  assert.equal(env.AGENT_STYLE, "standard");
  assert.equal(env.AGENT_MAX_MESSAGES, "3");
  assert.equal(env.AGENT_MAX_STEPS, "6");
  assert.equal(env.DEEPSEEK_EXTRA_BODY, "{}");
  assert.equal("DEEPSEEK_TEMPERATURE" in env, false);

  const round = fromEnv(env);
  assert.deepEqual(round, settings);
});

test("非法数字会被校验拦住", () => {
  const settings = fromEnv({
    ...toEnv(complete()),
    DEEPSEEK_TIMEOUT_MS: "abc",
    BATCH_SILENCE_MS: "0",
  });

  const errors = validateSettings(settings);
  assert.ok(errors.some((error) => error.includes("请求超时必须是数字")));
  assert.ok(errors.some((error) => error.includes("停口等待不能小于")));
});

test("交叉规则：历史窗口与压缩阈值", () => {
  const settings = complete();
  settings.conversation.historyStore = 100;
  settings.conversation.historySend = 200;
  settings.conversation.summarizeAt = 150;
  settings.conversation.keepAfterSummarize = 20;

  const errors = validateSettings(settings);
  assert.ok(errors.some((error) => error.includes("历史落盘上限")));
  assert.ok(errors.some((error) => error.includes("记忆压缩阈值")));
});

test("extraBody 不能覆盖程序控制的字段", () => {
  const settings = complete();
  settings.llm.extraBody = { model: "evil", top_p: 0.9 };

  const errors = validateSettings(settings);
  assert.ok(errors.some((error) => error.includes("不能覆盖 model")));

  settings.llm.extraBody = { tools: [] };
  assert.ok(
    validateSettings(settings).some((error) => error.includes("不能覆盖 tools")),
  );
});

test("agent 交叉规则：间隔与单轮预算", () => {
  const settings = complete();
  settings.agent.gapMinMs = 3000;
  settings.agent.gapMaxMs = 1000;
  settings.agent.replyDelayMs = 3000;
  settings.agent.waitMaxMs = 60000;
  settings.agent.maxMessages = 4;
  settings.agent.turnTimeoutMs = 30000;

  const errors = validateSettings(settings);
  assert.ok(errors.some((error) => error.includes("条间最小间隔")));
  assert.ok(errors.some((error) => error.includes("单轮超时")));
});

test("空模型名会回退默认，非法类型不会变成字符串", () => {
  const parsed = normalizeSettings({
    qq: { appId: 123, appSecret: " secret " },
    llm: { apiKey: "sk", model: "  ", baseUrl: "https://example.com///" },
  });

  assert.equal(parsed.qq.appId, "");
  assert.equal(parsed.qq.appSecret, "secret");
  assert.equal(parsed.llm.model, "deepseek-flash");
  assert.equal(parsed.llm.baseUrl, "https://example.com");
});
