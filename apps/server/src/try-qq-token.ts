import { getAccessToken } from "./qq/token.js";

const token = await getAccessToken();
console.log(token);
