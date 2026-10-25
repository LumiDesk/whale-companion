export type IContent =
  | string
  | Array<{
      type: "text" | "image_url";
      text?: string;
      image_url?: string;
    }>;

export interface IMessage {
  role: "user" | "assistant" | "system";
  content: IContent;
}

export type IMessages = Array<IMessage>;
