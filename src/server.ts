import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import type { Session, SessionState, SessionStatus } from "./session.js";
import { registerChannelTools } from "./tools/channels.js";
import { registerChatTools } from "./tools/chats.js";
import { registerContactTools } from "./tools/contacts.js";
import { registerGroupTools } from "./tools/groups.js";
import { registerLabelTools } from "./tools/labels.js";
import { registerMediaTools } from "./tools/media.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerSessionTools } from "./tools/session.js";

export const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const LOG_LEVELS: Partial<Record<SessionState, LoggingLevel>> = {
  qr: "notice",
  pairing: "notice",
  reconnecting: "warning",
  disconnected: "warning",
  logged_out: "error",
};

const INSTRUCTIONS =
  "Drives a WhatsApp account linked as a device. When a tool says WhatsApp is not linked, call link_device and show the user the QR image it returns, or its pairing code, then call it again until it reports the account. Chat and contact IDs look like 15551234567@c.us (people) or 123456789-987654321@g.us (groups); a phone number with country code works too.";

export function createServer(session: Session): McpServer {
  const server = new McpServer(
    { name: "whatsapp-web-mcp", title: "WhatsApp Web", version },
    {
      capabilities: {
        logging: {},
        completions: {},
        resources: { subscribe: true, listChanged: true },
      },
      instructions: INSTRUCTIONS,
    },
  );
  registerSessionTools(server, session);
  registerMessageTools(server, session);
  registerChatTools(server, session);
  registerContactTools(server, session);
  registerGroupTools(server, session);
  registerMediaTools(server, session);
  registerProfileTools(server, session);
  registerLabelTools(server, session);
  registerChannelTools(server, session);
  registerPrompts(server, session);
  const unsubscribe = registerResources(server, session);

  const onChange = ({ state, account, linkUrl }: SessionStatus) =>
    void server
      .sendLoggingMessage({
        level: LOG_LEVELS[state] ?? "info",
        logger: "whatsapp",
        data: { state, account, linkUrl },
      })
      .catch(() => undefined);
  session.on("change", onChange);
  server.server.onclose = () => {
    unsubscribe();
    session.off("change", onChange);
  };
  return server;
}
