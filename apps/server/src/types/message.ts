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
