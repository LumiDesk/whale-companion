import { config } from "../../config.js";
import type { IImageInput } from "../../types/message.js";

const tooBig = (size: number) =>
  `图片过大 ${(size / 1024 / 1024).toFixed(1)}MB > ${(
    config.media.maxBytes /
    1024 /
    1024
  ).toFixed(1)}MB`;

/** 下载 QQ 附件里的图片，返回字节 + MIME；过大或不是图片就拒绝 */
export const downloadImage = async (url: string): Promise<IImageInput> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`图片下载失败 ${res.status}`);

  const mime = res.headers.get("content-type") ?? "image/jpeg";
  if (!mime.startsWith("image/")) {
    throw new Error(`附件不是图片：${mime}`);
  }

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > config.media.maxBytes) throw new Error(tooBig(declared));

  const data = await res.arrayBuffer();
  if (data.byteLength > config.media.maxBytes) {
    throw new Error(tooBig(data.byteLength));
  }

  return { data, mime };
};
