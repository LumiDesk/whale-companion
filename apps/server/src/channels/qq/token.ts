import { config } from "../../config.js";

interface ITokenResponse {
  access_token?: string;
  expires_in?: string | number;
}

let cache: { token: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;

const fetchToken = async (): Promise<string> => {
  let res: Response;
  try {
    res = await fetch("https://bots.qq.com/app/getAppAccessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId: config.qq.appId,
        clientSecret: config.qq.appSecret,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`换取 access_token 失败（15 秒超时或网络错误）：${reason}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `换取 access_token 失败 ${res.status}: ${body.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as ITokenResponse;
  if (!data.access_token) throw new Error("响应里没有 access_token");

  const ttlMs = Number(data.expires_in ?? 7200) * 1000;
  cache = { token: data.access_token, expiresAt: Date.now() + ttlMs };

  return cache.token;
};

/** 取 access_token；带缓存，过期前 60 秒自动重取 */
export const getAccessToken = async (force = false): Promise<string> => {
  if (!force && cache && Date.now() < cache.expiresAt - 60_000) {
    return cache.token;
  }

  // 并发请求合并成一次，避免 cold start 打两次 token 接口
  if (pending) return pending;

  pending = fetchToken().finally(() => {
    pending = null;
  });

  return pending;
};
