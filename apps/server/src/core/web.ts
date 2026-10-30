import { config } from "../config.js";
import { slog } from "../util.js";

/**
 * DeepSeek 官方 Search / Fetch 客户端。
 *
 * 文档：https://api-docs.deepseek.com/guides/search
 * - POST /v1/tools/search  { query, count, need_content }
 * - POST /v1/tools/fetch   { url }
 * 鉴权与 Chat API 相同（Bearer），按成功请求计费，不按 token。
 */

export interface IWebSearchResult {
  title: string;
  url: string;
  siteName: string;
  date: string;
  summary: string;
}

export interface IWebFetchResult {
  title: string;
  content: string;
}

const SEARCH_PATH = "/v1/tools/search";
const FETCH_PATH = "/v1/tools/fetch";
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** 把 Search 接口的响应收敛成内部结构；坏条目直接跳过，不抛异常 */
export const parseSearchResults = (raw: unknown): IWebSearchResult[] => {
  if (!raw || typeof raw !== "object") return [];

  const results = (raw as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  const out: IWebSearchResult[] = [];

  for (const item of results) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    const value = item as Record<string, unknown>;
    const title = asString(value.title);
    const url = asString(value.url);
    if (!title || !url) continue;

    out.push({
      title,
      url,
      siteName: asString(value.site_name),
      date: asString(value.date),
      summary:
        asString(value.summary) ||
        asString(value.snippet) ||
        asString(value.content),
    });
  }

  return out;
};

export const parseFetchResult = (raw: unknown): IWebFetchResult => {
  if (!raw || typeof raw !== "object") {
    throw new Error("网页抓取返回了无法解析的内容");
  }

  const value = raw as Record<string, unknown>;
  const content = asString(value.content);
  if (!content) throw new Error("网页没有可读正文");

  return { title: asString(value.title), content };
};

/** 只放行 http(s)、带主机、不带账号密码的 URL（与官方 Fetch 限制一致） */
export const normalizeWebUrl = (input: string): string => {
  const text = input.trim();
  if (!text) throw new Error("URL 不能为空");
  if (text.length > 8192) throw new Error("URL 太长（上限 8192 字符）");

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("URL 不合法");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("只支持 http / https 链接");
  }
  if (!url.hostname) throw new Error("URL 缺少主机名");
  if (url.username || url.password) {
    throw new Error("URL 不能包含账号或密码");
  }

  return url.toString();
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const endpointOf = (path: string): string =>
  `${config.llm.baseUrl.replace(/\/+$/, "")}${path}`;

const requestJson = async (
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> => {
  if (!config.llm.apiKey.trim()) {
    throw new Error("没有配置模型 API Key，联网搜索不可用");
  }

  const url = endpointOf(path);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    let res: Response;

    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.llm.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.web.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      lastError = new Error(
        `联网请求失败（${Math.round(config.web.timeoutMs / 1000)} 秒超时或网络错误）：${reason}`,
      );
      if (attempt === 0) {
        await sleep(600);
        continue;
      }
      throw lastError;
    }

    if (res.ok) {
      try {
        return await res.json();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`联网接口返回的不是合法 JSON：${reason}`);
      }
    }

    const text = await res.text().catch(() => "");
    lastError = new Error(`联网接口返回 ${res.status}: ${text.slice(0, 300)}`);

    if (attempt === 0 && RETRYABLE.has(res.status)) {
      slog(`联网接口 ${res.status}，稍后重试一次`);
      await sleep(600);
      continue;
    }

    throw lastError;
  }

  throw lastError ?? new Error("联网请求失败");
};

export const searchWeb = async (
  query: string,
  count: number,
): Promise<IWebSearchResult[]> => {
  const text = query.trim();
  if (!text) throw new Error("搜索关键词不能为空");

  const size = Math.max(1, Math.min(50, Math.floor(count)));
  const data = await requestJson(SEARCH_PATH, {
    query: text,
    count: size,
    need_content: false,
  });

  return parseSearchResults(data);
};

export const fetchWebPage = async (url: string): Promise<IWebFetchResult> => {
  const target = normalizeWebUrl(url);
  const data = await requestJson(FETCH_PATH, { url: target });
  return parseFetchResult(data);
};
