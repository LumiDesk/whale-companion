import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DEEPSEEK_API_KEY ??= "test-key";
process.env.QQBOT_APPID ??= "test-app";
process.env.QQBOT_SECRET ??= "test-secret";
process.env.WHALE_DATA_DIR ??= mkdtempSync(join(tmpdir(), "whale-web-"));

const {
  fetchWebPage,
  normalizeWebUrl,
  parseFetchResult,
  parseSearchResults,
  searchWeb,
} = await import("../src/core/web.js");

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("搜索结果：只收有标题和链接的条目，summary 缺失时回退 snippet", () => {
  const results = parseSearchResults({
    results: [
      {
        title: "DeepSeek V4",
        url: "https://example.com/a",
        summary: "长摘要",
        site_name: "Example",
        date: "2026-06-01T00:00:00+00:00",
      },
      {
        title: "只有 snippet",
        url: "https://example.com/b",
        snippet: "短摘要",
      },
      { title: "没有链接" },
      { url: "https://example.com/c" },
      null,
      "坏数据",
    ],
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].title, "DeepSeek V4");
  assert.equal(results[0].summary, "长摘要");
  assert.equal(results[0].siteName, "Example");
  assert.equal(results[1].summary, "短摘要");
});

test("搜索结果：结构不对时返回空数组", () => {
  assert.deepEqual(parseSearchResults(null), []);
  assert.deepEqual(parseSearchResults({ results: "nope" }), []);
});

test("网页抓取：返回标题与正文；没有正文时报错", () => {
  assert.deepEqual(parseFetchResult({ title: "标题", content: "# 正文" }), {
    title: "标题",
    content: "# 正文",
  });

  assert.throws(() => parseFetchResult({ content: "" }), /没有可读正文/);
  assert.throws(() => parseFetchResult(null), /无法解析/);
});

test("URL 只放行 http / https，且不允许账号密码", () => {
  assert.equal(
    normalizeWebUrl("https://example.com/a?b=1"),
    "https://example.com/a?b=1",
  );
  assert.throws(() => normalizeWebUrl(""), /不能为空/);
  assert.throws(() => normalizeWebUrl("ftp://example.com"), /http/);
  assert.throws(() => normalizeWebUrl("javascript:alert(1)"), /http/);
  assert.throws(
    () => normalizeWebUrl("https://user:pass@example.com"),
    /账号或密码/,
  );
  assert.throws(() => normalizeWebUrl("不是链接"), /不合法/);
});

test("searchWeb：调用官方 Search 接口并解析结果", async () => {
  const original = globalThis.fetch;
  let capturedUrl = "";
  let capturedBodyText = "";

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    capturedUrl = String(input);
    capturedBodyText = String(init?.body ?? "{}");
    return jsonResponse({
      results: [
        { title: "结果一", url: "https://example.com/1", summary: "摘要一" },
      ],
    });
  }) as typeof fetch;

  try {
    const results = await searchWeb("测试关键词", 3);
    const body = JSON.parse(capturedBodyText) as Record<string, unknown>;
    assert.equal(results.length, 1);
    assert.match(capturedUrl, /\/v1\/tools\/search$/);
    assert.equal(body.query, "测试关键词");
    assert.equal(body.count, 3);
    assert.equal(body.need_content, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchWebPage：调用官方 Fetch 接口并返回正文", async () => {
  const original = globalThis.fetch;
  let capturedUrl = "";
  let capturedBodyText = "";

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    capturedUrl = String(input);
    capturedBodyText = String(init?.body ?? "{}");
    return jsonResponse({ title: "页面", content: "# 正文" });
  }) as typeof fetch;

  try {
    const page = await fetchWebPage("https://example.com/post");
    const body = JSON.parse(capturedBodyText) as Record<string, unknown>;
    assert.deepEqual(page, { title: "页面", content: "# 正文" });
    assert.match(capturedUrl, /\/v1\/tools\/fetch$/);
    assert.equal(body.url, "https://example.com/post");
  } finally {
    globalThis.fetch = original;
  }
});

test("接口非 2xx 时带状态码与响应体抛错，且 4xx 不重试", async () => {
  const original = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    return jsonResponse(
      { error: { message: "bad request", type: "invalid_request_error" } },
      400,
    );
  }) as typeof fetch;

  try {
    await assert.rejects(() => searchWeb("测试", 3), /400.*bad request/s);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
