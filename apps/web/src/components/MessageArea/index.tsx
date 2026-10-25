import "./index.scss";

interface IMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface IProps {
  messages: IMessage[];
}

export default function MessageArea(props: IProps) {
  return (
    <div className="message-area-container">
      <div
        style={{
          height: "10px",
        }}
      ></div>
      {props.messages.map((message, index) => (
        <div key={index} className={`message-${message.role}`}>
          {message.content}
        </div>
      ))}
    </div>
  );
}
