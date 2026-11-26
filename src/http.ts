import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "./config.js";
import { LINK_PAGE } from "./link-page.js";
import { toSvg } from "./qr.js";
import { createServer } from "./server.js";
import type { Session } from "./session.js";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const ANY_HOST = new Set(["0.0.0.0", "::"]);

export async function serveHttp(session: Session, config: Config): Promise<Server> {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  let allowedHosts: string[] | undefined;

  const authorized = (request: IncomingMessage, url: URL) =>
    !config.authToken ||
    [request.headers.authorization?.replace(/^Bearer /, ""), url.searchParams.get("token")].some(
      (token) => token && safeEqual(token, config.authToken!),
    );

  const handleMcp = async (request: IncomingMessage, response: ServerResponse) => {
    const id = request.headers["mcp-session-id"];
    const existing = typeof id === "string" ? transports.get(id) : undefined;
    if (id && !existing) {
      return send(response, 404, "application/json", rpcError("Session not found"));
    }
    const transport =
      existing ??
      new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (sessionId) => void transports.set(sessionId, transport),
        enableDnsRebindingProtection: !!allowedHosts,
        allowedHosts,
      });
    if (!existing) {
      transport.onclose = () =>
        void (transport.sessionId && transports.delete(transport.sessionId));
      await createServer(session).connect(transport);
    }
    await transport.handleRequest(request, response);
  };

  const route = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!authorized(request, url)) return send(response, 401, "text/plain", "Unauthorized");
    if (url.pathname === "/mcp" && config.command === "http") return handleMcp(request, response);
    if (request.method !== "GET") return send(response, 405, "text/plain", "Method not allowed");
    if (url.pathname === "/") return send(response, 200, "text/html; charset=utf-8", LINK_PAGE);
    if (url.pathname === "/state.json") {
      const { state, qr, code, account } = session.status;
      const svg = qr && (await toSvg(qr));
      return send(
        response,
        200,
        "application/json",
        JSON.stringify({ state, qr: svg, code, account }),
      );
    }
    send(response, 404, "text/plain", "Not found");
  };

  const server = createHttpServer((request, response) => {
    route(request, response).catch((error: unknown) => {
      if (!response.headersSent) send(response, 500, "application/json", rpcError(String(error)));
    });
  });
  server.on("close", () => {
    for (const transport of transports.values()) void transport.close();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  const { port } = server.address() as AddressInfo;
  if (LOOPBACK.has(config.host)) {
    allowedHosts = ["127.0.0.1", "localhost", "[::1]"].map((host) => `${host}:${port}`);
  }
  const host = ANY_HOST.has(config.host) || config.host === "::1" ? "localhost" : config.host;
  const token = config.authToken ? `?token=${encodeURIComponent(config.authToken)}` : "";
  session.linkUrl = `http://${host}:${port}/${token}`;
  return server;
}

function send(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, { "content-type": type }).end(body);
}

function rpcError(message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null });
}

function safeEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
