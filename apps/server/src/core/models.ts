import { config } from "../config.js";
import type { IModelInfo } from "../settings.js";

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

const asStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const list = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return list.length > 0 ? list : undefined;
};

/** 把 DeepSeek `/models` 的响应收敛成内部结构；字段缺失不报错 */
export const parseModelsResponse = (raw: unknown): IModelInfo[] => {
  if (!raw || typeof raw !== "object") return [];

  const data = (raw as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  const models: IModelInfo[] = [];

  for (const item of data) {
    if (!item || typeof item !== "object") continue;

    const value = item as Record<string, unknown>;
    const id = asString(value.id);
    if (!id) continue;

    const effort =
      value.effort && typeof value.effort === "object"
        ? (value.effort as Record<string, unknown>)
        : undefined;

    models.push({
      id,
      name: asString(value.name),
      contextWindow: asNumber(value.context_window),
      maxOutputTokens: asNumber(value.max_output_tokens),
      inputModalities: asStringArray(value.input_modalities),
      effortLevels: asStringArray(effort?.supported_levels),
      defaultEffort: asString(effort?.default_level),
    });
  }

  return models;
};

/** 调 GET /models；失败带状态码和响应体片段，方便桌面端展示 */
export const listModels = async (): Promise<IModelInfo[]> => {
  const baseUrl = config.llm.baseUrl.replace(/\/+$/, "");

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${config.llm.apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`请求模型列表失败（10 秒超时或网络错误）：${reason}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `模型列表接口返回 ${res.status}: ${body.slice(0, 300)}`,
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`模型列表返回的不是合法 JSON：${reason}`);
  }

  const models = parseModelsResponse(data);
  if (models.length === 0) {
    throw new Error("模型列表为空，或接口不支持 GET /models");
  }

  return models;
};
