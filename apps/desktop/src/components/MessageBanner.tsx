import type { IController } from "../hooks/useController";
import { IconAlert, IconCheck, IconClose, IconInfo } from "./Icons";

interface IProps {
  controller: IController;
}

const MessageBanner = ({ controller }: IProps) => {
  const message = controller.message;
  if (!message) return null;

  const Icon =
    message.kind === "error"
      ? IconAlert
      : message.kind === "ok"
        ? IconCheck
        : IconInfo;

  return (
    <div className={`banner banner-${message.kind}`}>
      <Icon />
      <span>{message.text}</span>
      <button
        type="button"
        className="banner-close"
        title="关闭"
        onClick={controller.dismissMessage}
      >
        <IconClose />
      </button>
    </div>
  );
};

export default MessageBanner;
