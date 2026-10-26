import assert from "node:assert/strict";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const { getAccessToken } = await import("../src/channels/qq/token.js");

test("token 缓存命中，不重复请求", async () => {
  const original = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ access_token: "cached", expires_in: 7200 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    assert.equal(await getAccessToken(true), "cached");
    assert.equal(await getAccessToken(), "cached");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("force 会重新取 token", async () => {
  const original = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ access_token: `token-${calls}`, expires_in: 7200 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    assert.equal(await getAccessToken(true), "token-1");
    assert.equal(await getAccessToken(true), "token-2");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});
