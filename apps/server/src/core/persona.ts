import {
  getActivePersonaCard,
  getPersonaText,
  type IPersonaCard,
} from "./persona-store.js";

export {
  getActivePersonaCard,
  getPersonaText,
  listPersonaSummaries,
  listPersonas,
  readPersonaCard,
  ensurePersonaLayout,
  DEFAULT_PERSONA_ID,
} from "./persona-store.js";

export type { IPersonaCard, IPersonaSummary } from "./persona-store.js";

/** 当前生效的人设正文；每次现读，改完下一条消息生效 */
export const getPersona = (): string => getPersonaText();

export interface IPersonaInfo {
  id: string;
  name: string;
  source: IPersonaCard["source"];
  path: string;
  chars: number;
  text: string;
}

export const getPersonaInfo = (): IPersonaInfo => {
  const card = getActivePersonaCard();
  const text = getPersonaText();

  return {
    id: card.id,
    name: card.name,
    source: card.source,
    path: card.path,
    chars: text.length,
    text,
  };
};
