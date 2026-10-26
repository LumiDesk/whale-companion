import { Slide, ToastContainer, type CloseButtonProps } from "react-toastify";

import { IconClose } from "./ui/Icons";

const CloseButton = ({ closeToast }: CloseButtonProps) => (
  <button
    type="button"
    className="toast-close"
    title="关闭提示"
    aria-label="关闭提示"
    onClick={(event) => {
      event.stopPropagation();
      closeToast(true);
    }}
  >
    <IconClose />
  </button>
);

/**
 * 挂在 App 外面，切页不会卸载；提示从右上角进来，最多同时 3 条。
 * 颜色完全走 styles.css 的 CSS 变量，跟随深浅主题。
 */
const ToastHost = () => (
  <ToastContainer
    position="top-right"
    newestOnTop
    limit={3}
    autoClose={5000}
    closeOnClick={false}
    draggable={false}
    pauseOnHover
    pauseOnFocusLoss
    transition={Slide}
    closeButton={CloseButton}
    aria-label="提示"
  />
);

export default ToastHost;
