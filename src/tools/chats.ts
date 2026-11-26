import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toChatId } from "../jid.js";
import { ChatSchema, MessageSchema, toChat, toMessage } from "../serialize.js";
import type { Session } from "../session.js";
import { chatUri } from "../uris.js";
import {
  chatId,
  chatOf,
  DESTRUCTIVE,
  done,
  IDEMPOTENT,
  page,
  READ_ONLY,
  slice,
  structured,
} from "./shared.js";

export function registerChatTools(server: McpServer, session: Session): void {
  server.registerTool(
    "get_chats",
    {
      title: "List chats",
      description: "List chats, most recent first",
      inputSchema: {
        ...page,
        query: z.string().optional().describe("Only chats whose name contains this text"),
        unreadOnly: z.boolean().default(false).describe("Only chats with unread messages"),
      },
      outputSchema: { chats: z.array(ChatSchema), total: z.number() },
      annotations: READ_ONLY,
    },
    async ({ query, unreadOnly, ...range }) => {
      const needle = query?.toLowerCase();
      const chats = (await session.require().getChats()).filter(
        (chat) =>
          (!unreadOnly || chat.unreadCount > 0) &&
          (!needle || chat.name?.toLowerCase().includes(needle)),
      );
      const { items, total } = slice(chats, range);
      return structured({ chats: items.map(toChat), total });
    },
  );

  server.registerTool(
    "get_chat",
    {
      title: "Get chat",
      description: "Get a chat by its ID or a phone number",
      inputSchema: { chatId },
      outputSchema: ChatSchema.shape,
      annotations: READ_ONLY,
    },
    async ({ chatId }) => {
      const chat = toChat(await chatOf(session, chatId));
      return structured(chat, chatUri(chat.id));
    },
  );

  server.registerTool(
    "get_pinned_messages",
    {
      title: "Get pinned messages",
      description: "The messages pinned in a chat",
      inputSchema: { chatId },
      outputSchema: { messages: z.array(MessageSchema) },
      annotations: READ_ONLY,
    },
    async ({ chatId }) => {
      const messages = await session.require().getPinnedMessages(toChatId(chatId));
      return structured({ messages: messages.map(toMessage) });
    },
  );

  server.registerTool(
    "archive_chat",
    {
      title: "Archive chat",
      description: "Archive a chat",
      inputSchema: { chatId },
      annotations: IDEMPOTENT,
    },
    async ({ chatId }) => {
      await session.require().archiveChat(toChatId(chatId));
      return done("Chat archived");
    },
  );

  server.registerTool(
    "unarchive_chat",
    {
      title: "Unarchive chat",
      description: "Unarchive a chat",
      inputSchema: { chatId },
      annotations: IDEMPOTENT,
    },
    async ({ chatId }) => {
      await session.require().unarchiveChat(toChatId(chatId));
      return done("Chat unarchived");
    },
  );

  server.registerTool(
    "pin_chat",
    {
      title: "Pin chat",
      description: "Pin a chat to the top of the list; WhatsApp allows three",
      inputSchema: { chatId },
      annotations: IDEMPOTENT,
    },
    async ({ chatId }) => {
      if (!(await session.require().pinChat(toChatId(chatId)))) {
        throw new Error("The chat could not be pinned; WhatsApp allows three pinned chats.");
      }
      return done("Chat pinned");
    },
  );

  server.registerTool(
    "unpin_chat",
    {
      title: "Unpin chat",
      description: "Unpin a chat",
      inputSchema: { chatId },
      annotations: IDEMPOTENT,
    },
    async ({ chatId }) => {
      await session.require().unpinChat(toChatId(chatId));
      return done("Chat unpinned");
    },
  );

  server.registerTool(
    "mute_chat",
    {
      title: "Mute chat",
      description: "Mute a chat's notifications, until a date or forever",
      inputSchema: {
        chatId,
        until: z.iso.datetime().optional().describe("ISO date to unmute at; omit to mute forever"),
      },
      annotations: IDEMPOTENT,
    },
    async ({ chatId, until }) => {
      await session.require().muteChat(toChatId(chatId), until ? new Date(until) : undefined);
      return done(until ? `Chat muted until ${until}` : "Chat muted");
    },
  );

  server.registerTool(
    "unmute_chat",
    {
      title: "Unmute chat",
      description: "Unmute a chat",
      inputSchema: { chatId },
      annotations: IDEMPOTENT,
    },
    async ({ chatId }) => {
      await session.require().unmuteChat(toChatId(chatId));
      return done("Chat unmuted");
    },
  );

  server.registerTool(
    "mark_chat_read",
    {
      title: "Mark chat read",
      description: "Mark every message in a chat as read, sending read receipts",
      inputSchema: { chatId },
      annotations: IDEMPOTENT,
    },
    async ({ chatId }) => {
      await session.require().sendSeen(toChatId(chatId));
      return done("Chat marked as read");
    },
  );

  server.registerTool(
    "mark_chat_unread",
    {
      title: "Mark chat unread",
      description: "Mark a chat as unread",
      inputSchema: { chatId },
      annotations: IDEMPOTENT,
    },
    async ({ chatId }) => {
      await session.require().markChatUnread(toChatId(chatId));
      return done("Chat marked as unread");
    },
  );

  server.registerTool(
    "send_chat_state",
    {
      title: "Show typing",
      description:
        "Show the chat that this account is typing or recording audio, for 25 seconds or until paused",
      inputSchema: { chatId, state: z.enum(["typing", "recording", "paused"]) },
      annotations: IDEMPOTENT,
    },
    async ({ chatId, state }) => {
      const chat = await chatOf(session, chatId);
      if (state === "typing") await chat.sendStateTyping();
      else if (state === "recording") await chat.sendStateRecording();
      else await chat.clearState();
      return done(`Chat state set to ${state}`);
    },
  );

  server.registerTool(
    "sync_chat_history",
    {
      title: "Sync chat history",
      description: "Ask the phone to send a chat's older history to this session",
      inputSchema: { chatId },
      annotations: IDEMPOTENT,
    },
    async ({ chatId }) => {
      const synced = await (await chatOf(session, chatId)).syncHistory();
      return done(synced ? "History sync requested" : "No more history to sync");
    },
  );

  server.registerTool(
    "clear_chat",
    {
      title: "Clear chat",
      description: "Delete every message in a chat for this account, keeping the chat",
      inputSchema: { chatId },
      annotations: DESTRUCTIVE,
    },
    async ({ chatId }) => {
      await (await chatOf(session, chatId)).clearMessages();
      return done("Chat cleared");
    },
  );

  server.registerTool(
    "delete_chat",
    {
      title: "Delete chat",
      description: "Delete a chat and its messages for this account",
      inputSchema: { chatId },
      annotations: DESTRUCTIVE,
    },
    async ({ chatId }) => {
      await (await chatOf(session, chatId)).delete();
      return done("Chat deleted");
    },
  );
}
