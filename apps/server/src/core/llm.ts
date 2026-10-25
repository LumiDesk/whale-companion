import { config } from "../config.js";
import type { IMessages } from "../types/message.js";

interface IChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/** 调一次模型，返回纯文本；失败时抛出带状态码与响应体的错误 */
export const askModel = async (messages: IMessages): Promise<string> => {
  const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
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
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`模型调用失败 ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as IChatResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content || !content.trim()) throw new Error("模型返回了空内容");
  return content;
};
