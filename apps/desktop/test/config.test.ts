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
