export type ITextPart = { type: "text"; text: string };

export type IImagePart = {
  type: "image_url";
  image_url: { url: string }; // 注意：是对象，不是字符串
};

export type IContent = string | Array<ITextPart | IImagePart>;

export interface IMessage {
  role: "user" | "assistant" | "system";
  content: IContent;
}

export type IMessages = Array<IMessage>;

/** 下载下来的一张图：字节 + MIME */
export type IImageInput = { data: ArrayBuffer; mime: string };

export interface IToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** thinking 模式下同一回合内必须原样回传 reasoning_content */
export interface IAssistantWireMessage {
  role: "assistant";
  content: string | null;
  reasoning_content?: string;
  tool_calls?: IToolCall[];
}

export interface IToolWireMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

export type IModelMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: IContent }
  | { role: "assistant"; content: string }
  | IAssistantWireMessage
  | IToolWireMessage;

export interface IModelReply {
  content: string | null;
  reasoningContent?: string;
  toolCalls: IToolCall[];
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface IToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
