import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseCommand, parseConfig } from "./config.js";
import { serveHttp } from "./http.js";
import { toTerminal } from "./qr.js";
import { createServer, version } from "./server.js";
import { Session, type SessionStatus } from "./session.js";
import { WWEBJS_VERSION } from "./wwebjs.js";

const SCAN = "Scan it in WhatsApp → Linked devices → Link a device.";
const ENTER =
  "Enter it in WhatsApp → Linked devices → Link a device → Link with phone number instead.";

try {
  const command = parseCommand(process.argv.slice(2));
  const config = parseConfig(process.env, command);
  const session = new Session(config);
  console.error(`whatsapp-web-mcp ${version} on whatsapp-web.js ${WWEBJS_VERSION}`);
  if (command === "login") await login(session);
  else await serve(session);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

async function login(session: Session): Promise<void> {
  session.on("change", (status) => void print(status, console.log));
  await session.start();
  console.log(
    `Linked as ${session.status.account?.name}. The session is stored; start the server.`,
  );
  await session.close();
  process.exit(0);
}

async function serve(session: Session): Promise<void> {
  const http = await serveHttp(session, session.config);
  const shutdown = async () => {
    await session.close().catch(() => undefined);
    http.close();
    process.exit(0);
  };
  session.on("change", (status) => void print(status, console.error));
  if (session.config.command === "stdio") {
    await createServer(session).connect(new StdioServerTransport());
    process.stdin.once("end", shutdown);
  } else {
    console.error(`MCP over Streamable HTTP at ${new URL(session.linkUrl!).origin}/mcp`);
  }
  session
    .start()
    .catch((error: Error) => console.error(`WhatsApp did not start: ${error.message}`));
}

async function print(
  { state, qr, code, account, linkUrl }: SessionStatus,
  log: typeof console.log,
) {
  if (qr) log(`${await toTerminal(qr)}\n${SCAN}${linkUrl ? `\nOr open ${linkUrl}` : ""}`);
  else if (code) log(`Pairing code: ${code}\n${ENTER}`);
  else if (state === "connected") log(`WhatsApp linked as ${account?.name} (${account?.id})`);
  else log(`WhatsApp ${state}`);
}
