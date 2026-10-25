import assert from "node:assert/strict";
import test from "node:test";

const {
  buildBotConfig,
  buildSpawnCommand,
  hasHiddenFlag,
  quoteArg,
} = await import("../src/lib/process");
const { normalizeConfig, validateConfig } = await import("../src/lib/config");

test("带空格的路径会被引号包起来", () => {
  assert.equal(quoteArg("C:\\Program Files\\node.exe"), '"C:\\Program Files\\node.exe"');

  assert.equal(
    buildSpawnCommand(
      "C:\\Program Files\\node.exe",
      "D:\\My App\\index.js",
      "C:\\Users\\me\\bot.json",
    ),
    '"C:\\Program Files\\node.exe" "D:\\My App\\index.js" --config "C:\\Users\\me\\bot.json"',
  );
});

test("开机自启的 --hidden 参数能被识别", () => {
  assert.equal(hasHiddenFlag(["--hidden"]), true);
  assert.equal(hasHiddenFlag(["C:\\WhaleCompanion.exe", "--hidden"]), true);
  assert.equal(hasHiddenFlag(["-hidden"]), true);
  assert.equal(hasHiddenFlag(["--hidden=true"]), true);
  assert.equal(hasHiddenFlag(["--show"]), false);
  assert.equal(hasHiddenFlag(undefined), false);
});

test("配置会翻译成机器人需要的环境变量", () => {
  const config = normalizeConfig({
    qq: { appId: "10001", appSecret: "qq-secret" },
    llm: {
      apiKey: "sk-test",
      model: "deepseek-chat",
      baseUrl: "https://example.com/v1",
    },
  });

  const env = buildBotConfig(config, {
    dataDir: "C:\\data",
    personaFile: "C:\\persona.md",
    parentPid: 4321,
  });

  assert.equal(env.QQBOT_APPID, "10001");
  assert.equal(env.QQBOT_SECRET, "qq-secret");
  assert.equal(env.DEEPSEEK_API_KEY, "sk-test");
  assert.equal(env.DEEPSEEK_MODEL, "deepseek-chat");
  assert.equal(env.DEEPSEEK_BASE_URL, "https://example.com/v1");
  assert.equal(env.WHALE_DATA_DIR, "C:\\data");
  assert.equal(env.WHALE_PERSONA_FILE, "C:\\persona.md");
  assert.equal(env.WHALE_PARENT_PID, "4321");
  assert.equal(env.WHALE_GUI, "1");
  assert.equal(validateConfig(config).length, 0);
});
