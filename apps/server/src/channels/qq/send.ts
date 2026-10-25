const API = "https://api.sgroup.qq.com";

/**
 * 统一调 QQ 接口：自动带 Authorization，非 2xx 抛错（带状态码与响应体片段）
 */
const callQQ = async (path: string, token: string, init: RequestInit) => {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `QQBot ${token}`,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`QQ ${path} ${res.status}: ${body.slice(0, 300)}`);
  }

  return res.json().catch(() => ({}));
};

/** 发一条纯文本（被动回复，必须带 msg_id） */
export const sendC2C = async (
  userId: string,
  msgId: string,
  token: string,
  text: string,
) => {
  await callQQ(`/v2/users/${userId}/messages`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text, msg_type: 0, msg_id: msgId }),
  });
};

/** 主动消息（不带 msg_id）：能不能发出去取决于平台额度，失败要兜住 */
export const sendC2CProactive = async (
  userId: string,
  token: string,
  text: string,
) => {
  await callQQ(`/v2/users/${userId}/messages`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text, msg_type: 0 }),
  });
};

/**
 * 发一张图片（两步）：
 * 1. JSON + file_data(base64) 换 file_info（C2C 不吃 multipart）
 * 2. msg_type=7 发富媒体消息
 */
export const sendImageC2C = async (
  userId: string,
  msgId: string,
  token: string,
  bytes: Uint8Array,
) => {
  const uploaded = await callQQ(`/v2/users/${userId}/files`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_type: 1,
      file_data: Buffer.from(bytes).toString("base64"),
      srv_send_msg: false,
    }),
  });

  const fileInfo = (uploaded as { file_info?: string })?.file_info;
  if (!fileInfo) throw new Error("上传成功但没拿到 file_info");

  await callQQ(`/v2/users/${userId}/messages`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: "",
      msg_type: 7,
      media: { file_info: fileInfo },
      msg_id: msgId,
    }),
  });
};
