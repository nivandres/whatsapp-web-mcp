import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Message } from "whatsapp-web.js";
import { serialize, toChatId } from "./jid.js";
import { toChat, toContact, toMessage } from "./serialize.js";
import type { Session } from "./session.js";
import { chatOf, completeChatId, contactOf, mediaOf, messageOf } from "./tools/shared.js";
import { chatMessagesUri, chatUri, mediaUri, messageUri, SESSION_URI } from "./uris.js";

const JSON_TYPE = "application/json";
const RECENT_CHATS = 50;
const RECENT_MESSAGES = 50;

export function registerResources(server: McpServer, session: Session): () => void {
  const json = (uri: string, data: unknown) => ({
    contents: [{ uri, mimeType: JSON_TYPE, text: JSON.stringify(data) }],
  });
  const variable = (value: string | string[] | undefined) =>
    decodeURIComponent([value].flat()[0] ?? "");
  const completeChat = (value: string) => completeChatId(session, value);

  server.registerResource(
    "session",
    SESSION_URI,
    {
      title: "WhatsApp session",
      description:
        "Where the session stands, with the QR or pairing code while linking and the live QR page. Subscribe to follow it.",
      mimeType: JSON_TYPE,
    },
    async (uri) => json(uri.href, session.status),
  );

  server.registerResource(
    "chat",
    new ResourceTemplate("whatsapp://chats/{chatId}", {
      list: async () => {
        if (session.state !== "connected") return { resources: [] };
        const chats = (await session.client.getChats()).slice(0, RECENT_CHATS);
        return {
          resources: chats.map((chat) => ({
            uri: chatUri(serialize(chat.id)),
            name: chat.name || serialize(chat.id),
            mimeType: JSON_TYPE,
          })),
        };
      },
      complete: { chatId: completeChat },
    }),
    { title: "Chat", description: "A chat and its latest message", mimeType: JSON_TYPE },
    async (uri, { chatId }) => json(uri.href, toChat(await chatOf(session, variable(chatId)))),
  );

  server.registerResource(
    "chat-messages",
    new ResourceTemplate("whatsapp://chats/{chatId}/messages", {
      list: undefined,
      complete: { chatId: completeChat },
    }),
    {
      title: "Chat messages",
      description: `A chat's latest ${RECENT_MESSAGES} messages, oldest first. Subscribe to hear of new ones.`,
      mimeType: JSON_TYPE,
    },
    async (uri, { chatId }) => {
      const chat = await chatOf(session, variable(chatId));
      return json(uri.href, (await chat.fetchMessages({ limit: RECENT_MESSAGES })).map(toMessage));
    },
  );

  server.registerResource(
    "contact",
    new ResourceTemplate("whatsapp://contacts/{contactId}", { list: undefined }),
    { title: "Contact", description: "A contact", mimeType: JSON_TYPE },
    async (uri, { contactId }) =>
      json(uri.href, toContact(await contactOf(session, variable(contactId)))),
  );

  server.registerResource(
    "message",
    new ResourceTemplate("whatsapp://messages/{messageId}", { list: undefined }),
    { title: "Message", description: "A message", mimeType: JSON_TYPE },
    async (uri, { messageId }) =>
      json(uri.href, toMessage(await messageOf(session, variable(messageId)))),
  );

  server.registerResource(
    "media",
    new ResourceTemplate("whatsapp://media/{mediaId}", {
      list: () => ({
        resources: [...session.media].map(([id, media]) => ({
          uri: mediaUri(id),
          name: media.filename || id,
          mimeType: media.mimetype,
        })),
      }),
    }),
    { title: "Media", description: "Media created or downloaded in this session" },
    async (uri, { mediaId }) => {
      const media = mediaOf(session, variable(mediaId));
      return { contents: [{ uri: uri.href, mimeType: media.mimetype, blob: media.data }] };
    },
  );

  const subscriptions = new Set<string>();
  server.server.setRequestHandler(SubscribeRequestSchema, ({ params }) => {
    subscriptions.add(params.uri);
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, ({ params }) => {
    subscriptions.delete(params.uri);
    return {};
  });
  const updated = (uri: string) => {
    if (subscriptions.has(uri))
      void server.server.sendResourceUpdated({ uri }).catch(() => undefined);
  };
  const onChange = () => updated(SESSION_URI);
  const onMessage = (message: Message) => {
    const chatId = toChatId(message.fromMe ? message.to : message.from);
    updated(chatUri(chatId));
    updated(chatMessagesUri(chatId));
    updated(messageUri(serialize(message.id)));
  };
  session.on("change", onChange);
  session.on("message", onMessage);
  return () => {
    session.off("change", onChange);
    session.off("message", onMessage);
  };
}
