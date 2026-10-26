import assert from "node:assert/strict";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";

const { sendC2C } = await import("../src/channels/qq/send.js");

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("发送文本：带 msg_id / msg_seq，Authorization 正确", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return jsonResponse({ id: "msg-1" });
  }) as typeof fetch;

  try {
    await sendC2C("user-1", "msg-1", "token-1", "你好", 2);

    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("/v2/users/user-1/messages"));
    assert.equal(calls[0].body.content, "你好");
    assert.equal(calls[0].body.msg_id, "msg-1");
    assert.equal(calls[0].body.msg_seq, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("401 时强制刷新 token 并重试一次", async () => {
  const original = globalThis.fetch;
  let apiCalls = 0;
  let tokenCalls = 0;
  const authHeaders: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;

    if (url.includes("bots.qq.com")) {
      tokenCalls += 1;
      return jsonResponse({ access_token: "fresh-token", expires_in: 7200 });
    }

    apiCalls += 1;
    authHeaders.push(headers.Authorization ?? "");

    if (apiCalls === 1) {
      return new Response("expired", { status: 401 });
    }

    return jsonResponse({ id: "ok" });
  }) as typeof fetch;

  try {
    await sendC2C("user-1", "msg-1", "old-token", "你好");

    assert.equal(apiCalls, 2);
    assert.equal(tokenCalls, 1);
    assert.equal(authHeaders[0], "QQBot old-token");
    assert.equal(authHeaders[1], "QQBot fresh-token");
  } finally {
    globalThis.fetch = original;
  }
});
