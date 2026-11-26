import { createRequire } from "node:module";
import wwebjs from "whatsapp-web.js";

export const { Client, LocalAuth, Location, MessageMedia, Poll } = wwebjs;

export const WWEBJS_VERSION: string = createRequire(import.meta.url)(
  "whatsapp-web.js/package.json",
).version;

export const LATEST_WWEBJS =
  "npx -y -p whatsapp-web-mcp -p github:pedroslopez/whatsapp-web.js whatsapp-web-mcp";
