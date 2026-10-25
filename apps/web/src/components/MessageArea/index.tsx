import { useState } from "react";
import "./index.scss";

interface IMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export default function MessageArea() {
  const [messages] = useState<IMessage[]>([
    { role: "user", content: "你是谁呀" },
    {
      role: "assistant",
      content: "我是小鲸鱼呀，住在你电脑里的鲸鱼少女 主人你在忙什么呀?",
    },
  ]);

  return (
    <div className="message-area-container">
      <div
        style={{
          height: "10px",
        }}
      ></div>
      {messages.map((message) => (
        <div className={`message-${message.role}`}>{message.content}</div>
      ))}
    </div>
  );
}
