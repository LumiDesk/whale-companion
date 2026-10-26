import assert from "node:assert/strict";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const { resolveHeartbeatInterval } = await import(
  "../src/channels/qq/gateway.js"
);

test("心跳间隔只接受 1s–120s", () => {
  assert.equal(resolveHeartbeatInterval(5000), 5000);
  assert.equal(resolveHeartbeatInterval("6000"), 6000);
  assert.equal(resolveHeartbeatInterval(1000), 1000);
  assert.equal(resolveHeartbeatInterval(120_000), 120_000);
});

test("心跳间隔异常时回退默认值", () => {
  assert.equal(resolveHeartbeatInterval(0), 41_250);
  assert.equal(resolveHeartbeatInterval(999), 41_250);
  assert.equal(resolveHeartbeatInterval(120_001), 41_250);
  assert.equal(resolveHeartbeatInterval("abc"), 41_250);
  assert.equal(resolveHeartbeatInterval(null), 41_250);
});
