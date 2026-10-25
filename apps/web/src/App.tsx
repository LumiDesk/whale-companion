import { useState } from "react";
import ChatBox from "./components/ChatBox";
import MessageArea from "./components/MessageArea";

interface IMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const App = () => {
  const [messages, setMessages] = useState<IMessage[]>([]);

  const handleSendMessage = async (text: string) => {
    const userMessage: IMessage = { role: "user", content: text };
    const newMessage = [...messages, userMessage];
    setMessages(newMessage);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: newMessage }),
    });
    if (!res.ok) {
      return;
    }

    const data = await res.json();
    setMessages([...newMessage, { role: "assistant", content: data.reply }]);
  };

  return (
    <div>
      <MessageArea messages={messages} />
      <ChatBox handleSendMessage={handleSendMessage} />
    </div>
  );
};

export default App;
