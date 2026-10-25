import "./index.scss";

export default function ChatBox() {
  return (
    <div className="chat-box-container">
      <div className="box">
        <input placeholder="Say Hello to DeepSeek!" />
        <div className="send-button">Send</div>
      </div>
    </div>
  );
}
