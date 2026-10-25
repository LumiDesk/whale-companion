import { config } from "../../config.js";

interface ITokenResponse {
  access_token?: string;
  expires_in?: string | number;
}

let cache: { token: string; expiresAt: number } | null = null;

/** 取 access_token；带缓存，过期前 60 秒自动重取 */
export const getAccessToken = async (force = false): Promise<string> => {
  if (!force && cache && Date.now() < cache.expiresAt - 60_000) {
    return cache.token;
  }

  const res = await fetch("https://bots.qq.com/app/getAppAccessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appId: config.qq.appId,
      clientSecret: config.qq.secret,
    }),
  });

  if (!res.ok) {
    throw new Error(`换取 access_token 失败 ${res.status}`);
  }

  const data = (await res.json()) as ITokenResponse;
  if (!data.access_token) throw new Error("响应里没有 access_token");

  const ttlMs = Number(data.expires_in ?? 7200) * 1000;
  cache = { token: data.access_token, expiresAt: Date.now() + ttlMs };

  return cache.token;
};
