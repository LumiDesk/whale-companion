export const downloadImage = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`图片下载失败 ${res.status}`);
  }
  return {
    data: await res.arrayBuffer(),
    mime: res.headers.get("content-type") ?? "application/octet-stream",
  };
};
