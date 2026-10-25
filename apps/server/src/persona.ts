import { readFileSync } from "fs";

export const getPersona = () => {
  return readFileSync(new URL("../persona.md", import.meta.url)).toString();
};
