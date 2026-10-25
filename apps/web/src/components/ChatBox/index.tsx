import { useState } from "react";
import "./index.scss";

interface IProps {
  handleSendMessage: (message: string) => void;
}

export default function ChatBox(props: IProps) {
  const [preSendText, setPreSendText] = useState("");
  const handleClickSend = () => {
    props.handleSendMessage(preSendText);
    setPreSendText("");
  };

  return (
    <div className="chat-box-container">
      <div className="box">
        <input
          placeholder="Say Hello to DeepSeek!"
          value={preSendText}
          onInput={(e) => {
            setPreSendText(e.currentTarget.value);
          }}
        />
        <div className="send-button" onClick={handleClickSend}>
          Send
        </div>
      </div>
    </div>
  );
}
