const API = "https://api.sgroup.qq.com";

/**
 * 统一调 QQ 接口：
 * - 自动带 Authorization 头
 * - 非 2xx 就抛错（带状态码 + 响应体前 300 字），不再静默失败
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
    body: JSON.stringify({
      content: text,
      msg_type: 0,
      msg_id: msgId,
    }),
  });
};

/**
 * 发一张图片（两步）：
 * 1. 先把 base64 传给 QQ 换回 file_info（注意：C2C 这个接口不吃 multipart，只吃 JSON+base64）
 * 2. 再用 msg_type=7 发一条富媒体消息
 */
export const sendImageC2C = async (
  userId: string,
  msgId: string,
  token: string,
  bytes: Uint8Array,
  mime: string,
) => {
  const uploaded = await callQQ(`/v2/users/${userId}/files`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_type: 1, // 1 = 图片
      file_data: Buffer.from(bytes).toString("base64"), // 不带 data: 前缀
      srv_send_msg: false, // 只上传，不直接发
    }),
  });

  const fileInfo = uploaded?.file_info;
  if (!fileInfo) {
    throw new Error(`上传成功但没拿到 file_info: ${JSON.stringify(uploaded)}`);
  }

  await callQQ(`/v2/users/${userId}/messages`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: "",
      msg_type: 7, // 7 = 富媒体
      media: { file_info: fileInfo },
      msg_id: msgId,
    }),
  });
};
