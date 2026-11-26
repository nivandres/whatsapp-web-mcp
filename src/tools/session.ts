import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { serialize } from "../jid.js";
import { toPng } from "../qr.js";
import type { Session, SessionState, SessionStatus } from "../session.js";
import { WWEBJS_VERSION } from "../wwebjs.js";
import { DESTRUCTIVE, READ_ONLY, structured } from "./shared.js";

const STOPPED = new Set<SessionState>(["idle", "disconnected", "logged_out", "closed"]);

const StatusSchema = {
  state: z.string(),
  code: z.string().optional(),
  linkUrl: z.string().optional(),
  account: z.object({ id: z.string(), name: z.string() }).optional(),
  error: z.string().optional(),
};

export function registerSessionTools(server: McpServer, session: Session): void {
  server.registerTool(
    "link_device",
    {
      title: "Link WhatsApp",
      description:
        "Link this server to a WhatsApp account. Returns a QR image to show the user, who scans it in WhatsApp → Linked devices → Link a device, and a page with the live QR. With phoneNumber it returns an 8-character code to type on the phone instead. Call it again when the QR expires.",
      inputSchema: {
        phoneNumber: z
          .string()
          .optional()
          .describe("Link with a code instead of a QR: phone number with country code"),
      },
      outputSchema: StatusSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ phoneNumber }, extra) => {
      if (STOPPED.has(session.state)) void session.start().catch(() => undefined);
      let status = await session.settle();
      if (phoneNumber && status.state === "qr") {
        await session.requestPairingCode(phoneNumber);
        status = session.status;
      }
      if (
        status.state === "qr" &&
        status.linkUrl &&
        server.server.getClientCapabilities()?.elicitation?.url
      ) {
        await openLinkPage(server, session, status.linkUrl, extra.requestId);
      }
      return linkResult(status);
    },
  );

  server.registerTool(
    "client_status",
    {
      title: "Session status",
      description:
        "Where the WhatsApp session stands: connected, waiting for a QR scan (qr) or a code (pairing), reconnecting, logged_out…",
      outputSchema: StatusSchema,
      annotations: READ_ONLY,
    },
    async () => structured(statusOf(session.status)),
  );

  server.registerTool(
    "get_info",
    {
      title: "Account info",
      description:
        "The linked account: ID, name and platform, with the WhatsApp Web and whatsapp-web.js versions",
      outputSchema: {
        id: z.string(),
        name: z.string(),
        platform: z.string(),
        webVersion: z.string(),
        wwebjsVersion: z.string(),
      },
      annotations: READ_ONLY,
    },
    async () => {
      const client = session.require();
      return structured({
        id: serialize(client.info.wid),
        name: client.info.pushname ?? "",
        platform: client.info.platform ?? "",
        webVersion: await client.getWWebVersion(),
        wwebjsVersion: WWEBJS_VERSION,
      });
    },
  );

  server.registerTool(
    "logout",
    {
      title: "Unlink WhatsApp",
      description:
        "Log this device out of WhatsApp and delete the stored session; linking again needs a new scan",
      annotations: DESTRUCTIVE,
    },
    async () => {
      await session.logout();
      return structured(statusOf(session.status));
    },
  );
}

async function linkResult(status: SessionStatus): Promise<CallToolResult> {
  const data = statusOf(status);
  const page = status.linkUrl ? ` The live QR is also at ${status.linkUrl}.` : "";
  const text = (message: string) => ({ type: "text" as const, text: message });
  if (status.state === "connected" && status.account) {
    return {
      content: [text(`Linked as ${status.account.name} (${status.account.id}).`)],
      structuredContent: data,
    };
  }
  if (status.code) {
    return {
      content: [
        text(
          `On the phone open WhatsApp → Linked devices → Link a device → Link with phone number instead, and enter the code ${status.code}.`,
        ),
      ],
      structuredContent: data,
    };
  }
  if (status.qr) {
    return {
      content: [
        { type: "image", data: await toPng(status.qr), mimeType: "image/png" },
        text(
          `Show this QR to the user to scan from WhatsApp → Linked devices → Link a device. It refreshes about every 20 seconds; call link_device again if it expires.${page}`,
        ),
      ],
      structuredContent: data,
    };
  }
  if (status.error) {
    return {
      content: [text(`WhatsApp could not start: ${status.error}`)],
      structuredContent: data,
    };
  }
  return {
    content: [text(`The session is ${status.state}. Call link_device again in a few seconds.`)],
    structuredContent: data,
  };
}

async function openLinkPage(
  server: McpServer,
  session: Session,
  url: string,
  relatedRequestId: string | number,
): Promise<void> {
  const elicitationId = randomUUID();
  const notify = server.server.createElicitationCompletionNotifier(elicitationId);
  const onChange = ({ state }: SessionStatus) => {
    if (state === "qr" || state === "pairing") return;
    session.off("change", onChange);
    if (state === "connected") void notify().catch(() => undefined);
  };
  session.on("change", onChange);
  await server.server
    .elicitInput(
      { mode: "url", url, elicitationId, message: "Scan the QR on this page to link WhatsApp." },
      { relatedRequestId },
    )
    .catch(() => session.off("change", onChange));
}

function statusOf({ state, code, linkUrl, account, error }: SessionStatus) {
  return { state, code, linkUrl, account, error };
}
