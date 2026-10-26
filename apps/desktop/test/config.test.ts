import assert from "node:assert/strict";
import test from "node:test";

const {
  DEFAULT_CONFIG,
  configFromEnv,
  normalizeConfig,
  parseEnvFile,
  validateConfig,
} = await import("../src/lib/config");

test("空配置会给出默认值和必填错误", () => {
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);

  const errors = validateConfig(DEFAULT_CONFIG);
  assert.equal(errors.length, 3);
});

test("错误类型也能收敛成合法结构", () => {
  const parsed = normalizeConfig({
    qq: { appId: 123, appSecret: " secret " },
    llm: { apiKey: "sk-x" },
    behavior: { closeAction: "something", launchAtLogin: "yes" },
  });

  assert.equal(parsed.qq.appId, "");
  assert.equal(parsed.qq.appSecret, "secret");
  assert.equal(parsed.llm.model, "deepseek-flash");
  assert.equal(parsed.behavior.closeAction, "tray");
  assert.equal(parsed.behavior.launchAtLogin, false);
});

test("解析 .env：注释、引号、export", () => {
  const env = parseEnvFile(`
# comment
QQBOT_APPID=10001
QQBOT_SECRET="abc def"
export DEEPSEEK_API_KEY='sk-test'
EMPTY=

BAD LINE
`);

  assert.equal(env.QQBOT_APPID, "10001");
  assert.equal(env.QQBOT_SECRET, "abc def");
  assert.equal(env.DEEPSEEK_API_KEY, "sk-test");
  assert.equal(env.EMPTY, "");
  assert.equal(env.BAD, undefined);
});

test("从 .env 合并到配置", () => {
  const config = configFromEnv({
    QQBOT_APPID: "10001",
    QQBOT_SECRET: "secret",
    DEEPSEEK_API_KEY: "sk-test",
    DEEPSEEK_MODEL: "deepseek-chat",
  });

  assert.equal(config.qq.appId, "10001");
  assert.equal(config.llm.model, "deepseek-chat");
  assert.equal(validateConfig(config).length, 0);
});

test("接口地址必须是 http(s)", () => {
  const config = normalizeConfig({
    qq: { appId: "1", appSecret: "2" },
    llm: { apiKey: "3", baseUrl: "ftp://example.com" },
  });

  assert.ok(validateConfig(config).some((error) => error.includes("接口地址")));
});

test("模型名称与接口地址会被规范化", () => {
  const parsed = normalizeConfig({
    llm: { model: "  ", baseUrl: "https://example.com///" },
  });

  assert.equal(parsed.llm.model, "deepseek-flash");
  assert.equal(parsed.llm.baseUrl, "https://example.com");
});

test("模型名称不能为空", () => {
  const config = normalizeConfig({
    qq: { appId: "1", appSecret: "2" },
    llm: { apiKey: "3" },
  });
  config.llm.model = "";

  assert.ok(validateConfig(config).some((error) => error.includes("模型名称")));
});

test("v1 配置会迁移到 v2，旧字段保留、新字段补默认", () => {
  const parsed = normalizeConfig({
    version: 1,
    qq: { appId: "10001", appSecret: "secret" },
    llm: {
      apiKey: "sk-test",
      model: "deepseek-chat",
      baseUrl: "https://example.com/v1",
    },
    behavior: { closeAction: "exit", launchAtLogin: true },
    appearance: { theme: "dark" },
  });

  assert.equal(parsed.version, 2);
  assert.equal(parsed.qq.appId, "10001");
  assert.equal(parsed.llm.model, "deepseek-chat");
  assert.equal(parsed.llm.thinkingEffort, "high");
  assert.equal(parsed.llm.timeoutMs, 45_000);
  assert.equal(parsed.conversation.historySend, 40);
  assert.equal(parsed.behavior.closeAction, "exit");
  assert.equal(parsed.behavior.launchAtLogin, true);
  assert.equal(parsed.behavior.autoStartBot, true);
  assert.equal(parsed.appearance.theme, "dark");
  assert.equal(parsed.logs.keepDays, 7);
});

test("从 .env 导入全部新字段", () => {
  const config = configFromEnv({
    QQBOT_APPID: "10001",
    QQBOT_SECRET: "secret",
    DEEPSEEK_API_KEY: "sk-test",
    DEEPSEEK_THINKING_EFFORT: "max",
    DEEPSEEK_TEMPERATURE: "0.5",
    DEEPSEEK_TIMEOUT_MS: "30000",
    HISTORY_SEND: "60",
    VISION_ENABLED: "false",
    STICKER_CHANCE: "0.2",
  });

  assert.equal(config.llm.thinkingEffort, "max");
  assert.equal(config.llm.temperature, 0.5);
  assert.equal(config.llm.timeoutMs, 30_000);
  assert.equal(config.conversation.historySend, 60);
  assert.equal(config.llm.vision, false);
  assert.equal(config.stickers.spontaneousChance, 0.2);
});

test("范围错误会被校验拦住", () => {
  const config = normalizeConfig({
    qq: { appId: "1", appSecret: "2" },
    llm: { apiKey: "3" },
  });
  config.llm.timeoutMs = 999;
  config.conversation.historyStore = 10;

  const errors = validateConfig(config);
  assert.ok(errors.some((error) => error.includes("请求超时")));
  assert.ok(errors.some((error) => error.includes("历史落盘上限")));
});
