import { EventEmitter } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ElicitRequestSchema,
  ResourceUpdatedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client as WAClient } from "whatsapp-web.js";
import { parseConfig } from "./config";
import { createServer } from "./server";
import { Session } from "./session";

const message = {
  id: { _serialized: "true_15551234567@c.us_3EB0" },
  from: "15550000000@c.us",
  to: "15551234567@c.us",
  body: "Hello",
  type: "chat",
  timestamp: 1_700_000_000,
  fromMe: true,
  hasMedia: false,
  hasQuotedMsg: false,
  hasReaction: false,
  isForwarded: false,
  isStarred: false,
  ack: 1,
  mentionedIds: [],
};

const chat = {
  id: { _serialized: "15551234567@c.us" },
  name: "Ada",
  isGroup: false,
  isReadOnly: false,
  unreadCount: 2,
  timestamp: 1_700_000_000,
  archived: false,
  pinned: false,
  isMuted: false,
  muteExpiration: 0,
  delete: vi.fn(async () => true),
};

class FakeClient extends EventEmitter {
  options = { puppeteer: {} };
  info = { wid: { _serialized: "15550000000@c.us" }, pushname: "Me" };
  sendMessage = vi.fn(async () => message);
  getChats = vi.fn(async () => [chat]);
  getChatById = vi.fn(async () => chat);
}

async function connect(capabilities = {}) {
  const whatsapp = new FakeClient();
  const session = new Session(parseConfig({}), whatsapp as unknown as WAClient);
  session.linkUrl = "http://localhost:4000/";
  const client = new Client({ name: "test", version: "1.0.0" }, { capabilities });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    createServer(session).connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, session, whatsapp };
}

describe("server", () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
  });

  it("declares tools with annotations and output schemas, resources and prompts", async () => {
    const setUp = await connect();
    client = setUp.client;
    const { tools } = await client.listTools();
    const tool = (name: string) => tools.find((candidate) => candidate.name === name);

    expect(tools.length).toBeGreaterThan(60);
    expect(tool("get_chats")?.annotations).toMatchObject({ readOnlyHint: true });
    expect(tool("delete_chat")?.annotations).toMatchObject({ destructiveHint: true });
    expect(tool("send_message")?.outputSchema?.properties).toHaveProperty("body");
    expect(client.getServerCapabilities()).toMatchObject({
      logging: {},
      completions: {},
      resources: { subscribe: true },
    });
    expect((await client.listResources()).resources.map(({ uri }) => uri)).toEqual([
      "whatsapp://session",
    ]);
    expect((await client.listResourceTemplates()).resourceTemplates).toHaveLength(5);
    expect((await client.listPrompts()).prompts.map(({ name }) => name)).toEqual([
      "summarize_chat",
      "draft_reply",
      "catch_up",
    ]);
  });

  it("hands the agent a QR image to show while linking", async () => {
    const setUp = await connect();
    client = setUp.client;
    setUp.whatsapp.emit("qr", "2@qr");

    const result = await client.callTool({ name: "link_device", arguments: {} });

    expect(result.content).toMatchObject([
      { type: "image", mimeType: "image/png" },
      { type: "text", text: expect.stringContaining("http://localhost:4000/") },
    ]);
    expect(result.structuredContent).toMatchObject({ state: "qr" });
  });

  it("opens the live QR page when the client takes URL elicitations", async () => {
    const setUp = await connect({ elicitation: { url: {} } });
    client = setUp.client;
    const elicit = vi.fn(async () => ({ action: "accept" as const }));
    client.setRequestHandler(ElicitRequestSchema, elicit);
    setUp.whatsapp.emit("qr", "2@qr");

    await client.callTool({ name: "link_device", arguments: {} });

    expect(elicit).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ mode: "url", url: "http://localhost:4000/" }),
      }),
      expect.anything(),
    );
  });

  it("asks to link before anything else", async () => {
    const setUp = await connect();
    client = setUp.client;

    const result = await client.callTool({ name: "get_chats", arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject([{ text: expect.stringContaining("link_device") }]);
  });

  it("sends a message and returns it structured", async () => {
    const setUp = await connect();
    client = setUp.client;
    setUp.whatsapp.emit("ready");

    const result = await client.callTool({
      name: "send_message",
      arguments: { chatId: "+1 555 123 4567", text: "Hello", quotedMessageId: "quoted" },
    });

    expect(setUp.whatsapp.sendMessage).toHaveBeenCalledWith(
      "15551234567@c.us",
      "Hello",
      expect.objectContaining({ quotedMessageId: "quoted" }),
    );
    expect(result.structuredContent).toMatchObject({
      id: "true_15551234567@c.us_3EB0",
      chatId: "15551234567@c.us",
      body: "Hello",
    });
  });

  it("pages and filters chats", async () => {
    const setUp = await connect();
    client = setUp.client;
    setUp.whatsapp.emit("ready");

    const found = await client.callTool({ name: "get_chats", arguments: { query: "ad" } });
    const missed = await client.callTool({ name: "get_chats", arguments: { query: "bob" } });

    expect(found.structuredContent).toMatchObject({ total: 1, chats: [{ name: "Ada" }] });
    expect(missed.structuredContent).toMatchObject({ total: 0, chats: [] });
  });

  it("tells subscribers when the session changes", async () => {
    const setUp = await connect();
    client = setUp.client;
    const updated = vi.fn();
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, updated);
    await client.subscribeResource({ uri: "whatsapp://session" });

    setUp.whatsapp.emit("qr", "2@qr");

    await vi.waitFor(() =>
      expect(updated).toHaveBeenCalledWith(
        expect.objectContaining({ params: { uri: "whatsapp://session" } }),
      ),
    );
    const { contents } = await client.readResource({ uri: "whatsapp://session" });
    expect(contents[0]).toMatchObject({ text: expect.stringContaining(`"qr":"2@qr"`) });
  });

  it("completes chat IDs", async () => {
    const setUp = await connect();
    client = setUp.client;
    setUp.whatsapp.emit("ready");

    const { completion } = await client.complete({
      ref: { type: "ref/resource", uri: "whatsapp://chats/{chatId}" },
      argument: { name: "chatId", value: "ad" },
    });

    expect(completion.values).toEqual(["15551234567@c.us"]);
  });
});
