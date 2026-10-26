import { toast, type ToastOptions } from "react-toastify";

export type NoticeKind = "ok" | "error" | "info";

/** 成功/提示自动收起的时间；错误不自动消失，等用户手动关 */
const AUTO_CLOSE_MS = 5000;

const optionsOf = (kind: NoticeKind): ToastOptions => ({
  autoClose: kind === "error" ? false : AUTO_CLOSE_MS,
  closeOnClick: false,
  draggable: false,
  pauseOnHover: true,
  pauseOnFocusLoss: true,
  role: kind === "error" ? "alert" : "status",
});

/**
 * 桌面端唯一的提示入口：所有一次性反馈、校验错误、状态提醒都走这里。
 * 页面里不要再放 banner / callout 提示框。
 */
export const notify = (kind: NoticeKind, text: string): void => {
  const body = text.trim();
  if (!body) return;

  const options = optionsOf(kind);

  if (kind === "error") toast.error(body, options);
  else if (kind === "ok") toast.success(body, options);
  else toast.info(body, options);
};
