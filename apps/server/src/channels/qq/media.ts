import type { IImageInput } from "../../types/message.js";

/** 下载 QQ 附件里的图片，返回字节 + MIME */
export const downloadImage = async (url: string): Promise<IImageInput> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`图片下载失败 ${res.status}`);

  return {
    data: await res.arrayBuffer(),
    mime: res.headers.get("content-type") ?? "image/jpeg",
  };
};
