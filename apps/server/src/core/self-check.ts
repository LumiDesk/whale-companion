import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getAccessToken } from "../channels/qq/token.js";
import { config } from "../config.js";
import { buildModelBody } from "./llm.js";
import { getPersona } from "./persona.js";
import { listStickers } from "../store/stickers.js";

export interface ICheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

export type CheckEmitter = (result: ICheckResult) => void | Promise<void>;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const timeout = async <T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}超时（${ms / 1000} 秒）`)), ms);
  });

  try {
    return await Promise.race([promise, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const checkDataDir = (): ICheckResult => {
  const probe = join(config.paths.dataDir, `.self-check-${process.pid}`);

  try {
    mkdirSync(config.paths.dataDir, { recursive: true });
    writeFileSync(probe, "ok", "utf8");
    rmSync(probe, { force: true });
    return { name: "data", ok: true, detail: "数据目录可写" };
  } catch (error) {
    return { name: "data", ok: false, detail: errorText(error) };
  }
};

const checkPersona = (): ICheckResult => {
  const override = config.paths.persona;
  const fallback = config.paths.defaultPersona;

  try {
    const persona = getPersona();
    const source = existsSync(override)
      ? "自定义"
      : existsSync(fallback)
        ? "默认"
        : "兜底";

    return {
      name: "persona",
      ok: persona.trim().length > 0,
      detail: `${source}人设 / ${persona.length} 字`,
    };
  } catch (error) {
    return { name: "persona", ok: false, detail: errorText(error) };
  }
};

const checkStickers = (): ICheckResult => {
  try {
    const stickers = listStickers();
    const untagged = stickers.filter((item) => item.tags.length === 0).length;

    return {
      name: "stickers",
      ok: true,
      detail: `${stickers.length} 张 / ${untagged} 张未打标`,
    };
  } catch (error) {
    return { name: "stickers", ok: false, detail: errorText(error) };
  }
};

const checkQQ = async (): Promise<ICheckResult> => {
  try {
    await timeout(getAccessToken(), 10_000, "QQ token ");
    return { name: "qq", ok: true, detail: "access_token 获取成功" };
  } catch (error) {
    return { name: "qq", ok: false, detail: errorText(error) };
  }
};

const checkLlm = async (): Promise<ICheckResult> => {
  const baseUrl = config.llm.baseUrl.replace(/\/+$/, "");
  const body = buildModelBody(
    [
      { role: "system", content: "只回复 OK，不要解释。" },
      { role: "user", content: "ping" },
    ],
    {
      ...config.llm,
      maxTokens: 1,
      thinkingEffort: "off",
      temperature: null,
      extraBody: {},
    },
  );

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.llm.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        name: "llm",
        ok: false,
        detail: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;

    return {
      name: "llm",
      ok: Boolean(content),
      detail: content ? "模型响应正常" : "模型返回了空内容",
    };
  } catch (error) {
    return { name: "llm", ok: false, detail: errorText(error) };
  }
};

/** 依次检查；任何一项失败都不会中断后面的检查 */
export const runSelfCheck = async (emit: CheckEmitter): Promise<boolean> => {
  const results: ICheckResult[] = [];

  const report = async (result: ICheckResult): Promise<void> => {
    results.push(result);
    await emit(result);
  };

  await report({
    name: "config",
    ok: true,
    detail: `${config.llm.model} / 思考 ${config.llm.thinkingEffort}`,
  });

  await report(checkDataDir());
  await report(checkPersona());
  await report(checkStickers());
  await report(await checkQQ());
  await report(await checkLlm());

  return results.every((result) => result.ok);
};
