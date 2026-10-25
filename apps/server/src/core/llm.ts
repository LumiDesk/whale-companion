import { config } from "../config.js";
import { slog } from "../util.js";
import type { IMessages } from "../types/message.js";

interface IChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/** 带"能不能重试"的错误，避免把 401 这种重试也没用的请求再打一遍 */
class LlmError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "LlmError";
    this.retryable = retryable;
  }
}

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const requestOnce = async (messages: IMessages): Promise<string> => {
  let res: Response;

  try {
    res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.llm.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages,
        stream: false,
      }),
      signal: AbortSignal.timeout(config.llm.timeoutMs),
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new LlmError(
      `模型请求失败（${Math.round(config.llm.timeoutMs / 1000)}s 超时或网络错误）：${reason}`,
      true,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LlmError(
      `模型调用失败 ${res.status}: ${body.slice(0, 300)}`,
      res.status === 429 || res.status >= 500,
    );
  }

  let data: IChatResponse;
  try {
    data = (await res.json()) as IChatResponse;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new LlmError(`模型返回的不是合法 JSON：${reason}`, true);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new LlmError("模型返回了空内容", true);
  }

  return content;
};

/**
 * 调一次模型，返回纯文本。
 * 网络错误、超时、429、5xx 会自动重试；4xx 直接抛，让调用方兜底。
 */
export const askModel = async (messages: IMessages): Promise<string> => {
  const retries = Math.max(0, Math.floor(config.llm.retries));
  let last: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await requestOnce(messages);
    } catch (e) {
      last = e;

      const retryable = e instanceof LlmError ? e.retryable : true;
      if (!retryable || attempt >= retries) break;

      slog(`模型请求失败，${attempt + 1}/${retries} 次重试`, e);
      await sleep(600 * (attempt + 1));
    }
  }

  throw last instanceof Error ? last : new Error(String(last));
};
