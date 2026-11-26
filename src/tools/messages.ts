import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MessageContent } from "whatsapp-web.js";
import { z } from "zod";
import { serialize, toChatId } from "../jid.js";
import { MessageSchema, toMessage } from "../serialize.js";
import type { Session } from "../session.js";
import { messageUri } from "../uris.js";
import { Location, Poll } from "../wwebjs.js";
import {
  ACTION,
  chatId,
  chatOf,
  contactIds,
  DESTRUCTIVE,
  done,
  IDEMPOTENT,
  mediaId,
  mediaOf,
  messageId,
  messageOf,
  READ_ONLY,
  structured,
} from "./shared.js";

const PIN_DURATIONS = { "24h": 86_400, "7d": 604_800, "30d": 2_592_000 } as const;

const Receipts = z.array(z.object({ id: z.string(), at: z.number() }));

export function registerMessageTools(server: McpServer, session: Session): void {
  server.registerTool(
    "send_message",
    {
      title: "Send message",
      description:
        "Send a message to a chat: text, media created with create_message_media, a location or a poll. With media, the text is its caption.",
      inputSchema: {
        chatId,
        text: z.string().optional().describe("Message text, or the caption of the media"),
        mediaId: mediaId.optional(),
        location: z
          .object({
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180),
            name: z.string().optional(),
            address: z.string().optional(),
            url: z.string().url().optional(),
          })
          .optional()
          .describe("Send a location pin"),
        poll: z
          .object({
            question: z.string(),
            options: z.array(z.string()).min(2).max(12),
            allowMultipleAnswers: z.boolean().default(false),
          })
          .optional()
          .describe("Send a poll"),
        quotedMessageId: messageId.optional().describe("Message to reply to"),
        mentions: contactIds.optional().describe("Contacts to mention; write them as @number"),
        asSticker: z.boolean().optional().describe("Send an image or video as a sticker"),
        asVoice: z.boolean().optional().describe("Send audio as a voice note"),
        asDocument: z.boolean().optional().describe("Send media as a document"),
        viewOnce: z.boolean().optional().describe("Send media as view once"),
        linkPreview: z.boolean().optional().describe("Show a preview of the first link"),
      },
      outputSchema: MessageSchema.shape,
      annotations: ACTION,
    },
    async ({ chatId, text, mediaId, location, poll, ...options }) => {
      const content = toContent(session, text, mediaId, location, poll);
      const message = await session.require().sendMessage(toChatId(chatId), content, {
        caption: mediaId ? text : undefined,
        quotedMessageId: options.quotedMessageId,
        mentions: options.mentions?.map(toChatId),
        sendMediaAsSticker: options.asSticker,
        sendAudioAsVoice: options.asVoice,
        sendMediaAsDocument: options.asDocument,
        isViewOnce: options.viewOnce,
        linkPreview: options.linkPreview,
      });
      return structured(toMessage(message), messageUri(serialize(message.id)));
    },
  );

  server.registerTool(
    "get_message",
    {
      title: "Get message",
      description: "Get a message by its ID",
      inputSchema: { messageId },
      outputSchema: MessageSchema.shape,
      annotations: READ_ONLY,
    },
    async ({ messageId }) =>
      structured(toMessage(await messageOf(session, messageId)), messageUri(messageId)),
  );

  server.registerTool(
    "get_quoted_message",
    {
      title: "Get quoted message",
      description: "Get the message a reply quotes",
      inputSchema: { messageId },
      outputSchema: MessageSchema.shape,
      annotations: READ_ONLY,
    },
    async ({ messageId }) => {
      const message = await messageOf(session, messageId);
      if (!message.hasQuotedMsg) throw new Error(`Message ${messageId} quotes no message.`);
      const quoted = await message.getQuotedMessage();
      return structured(toMessage(quoted), messageUri(serialize(quoted.id)));
    },
  );

  server.registerTool(
    "fetch_messages",
    {
      title: "Fetch messages",
      description:
        "Load a chat's latest messages, oldest first. Fewer may return when the chat has fewer.",
      inputSchema: {
        chatId,
        limit: z.number().int().positive().max(1000).default(50).describe("Messages to load"),
        fromMe: z
          .boolean()
          .optional()
          .describe("Only messages sent by this account (true) or by others (false)"),
      },
      outputSchema: { messages: z.array(MessageSchema) },
      annotations: READ_ONLY,
    },
    async ({ chatId, limit, fromMe }) => {
      const chat = await chatOf(session, chatId);
      const messages = await chat.fetchMessages({ limit, fromMe });
      return structured({ messages: messages.map(toMessage) });
    },
  );

  server.registerTool(
    "search_messages",
    {
      title: "Search messages",
      description: "Search messages by text, in every chat or in one",
      inputSchema: {
        query: z.string().min(1).describe("Text to search for"),
        chatId: chatId.optional().describe("Search only this chat"),
        limit: z.number().int().positive().max(500).default(50).describe("Messages per page"),
        page: z.number().int().positive().default(1).describe("Page, starting at 1"),
      },
      outputSchema: { messages: z.array(MessageSchema) },
      annotations: READ_ONLY,
    },
    async ({ query, chatId, limit, page }) => {
      const messages = await session.require().searchMessages(query, {
        chatId: chatId && toChatId(chatId),
        limit,
        page,
      });
      return structured({ messages: messages.map(toMessage) });
    },
  );

  server.registerTool(
    "react_message",
    {
      title: "React to message",
      description: "React to a message with an emoji; an empty emoji removes the reaction",
      inputSchema: { messageId, emoji: z.string().describe("Emoji, or empty to remove") },
      annotations: IDEMPOTENT,
    },
    async ({ messageId, emoji }) => {
      await (await messageOf(session, messageId)).react(emoji);
      return done(emoji ? `Reacted with ${emoji}` : "Reaction removed");
    },
  );

  server.registerTool(
    "edit_message",
    {
      title: "Edit message",
      description: "Edit the text of a message this account sent, within WhatsApp's 15 minutes",
      inputSchema: { messageId, text: z.string().min(1).describe("New text") },
      outputSchema: MessageSchema.shape,
      annotations: IDEMPOTENT,
    },
    async ({ messageId, text }) => {
      const edited = await (await messageOf(session, messageId)).edit(text);
      if (!edited) throw new Error(`Message ${messageId} could not be edited.`);
      return structured(toMessage(edited), messageUri(messageId));
    },
  );

  server.registerTool(
    "delete_message",
    {
      title: "Delete message",
      description: "Delete a message for everyone, or only for this account",
      inputSchema: {
        messageId,
        everyone: z.boolean().default(true).describe("Delete for everyone, not only for me"),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ messageId, everyone }) => {
      await (await messageOf(session, messageId)).delete(everyone);
      return done(everyone ? "Message deleted for everyone" : "Message deleted for me");
    },
  );

  server.registerTool(
    "forward_message",
    {
      title: "Forward message",
      description: "Forward a message to another chat",
      inputSchema: { messageId, chatId: chatId.describe("Chat to forward to") },
      annotations: ACTION,
    },
    async ({ messageId, chatId }) => {
      await (await messageOf(session, messageId)).forward(toChatId(chatId));
      return done("Message forwarded");
    },
  );

  server.registerTool(
    "star_message",
    {
      title: "Star message",
      description: "Star a message",
      inputSchema: { messageId },
      annotations: IDEMPOTENT,
    },
    async ({ messageId }) => {
      await (await messageOf(session, messageId)).star();
      return done("Message starred");
    },
  );

  server.registerTool(
    "unstar_message",
    {
      title: "Unstar message",
      description: "Remove a message's star",
      inputSchema: { messageId },
      annotations: IDEMPOTENT,
    },
    async ({ messageId }) => {
      await (await messageOf(session, messageId)).unstar();
      return done("Message unstarred");
    },
  );

  server.registerTool(
    "pin_message",
    {
      title: "Pin message",
      description: "Pin a message in its chat for a while",
      inputSchema: {
        messageId,
        duration: z.enum(["24h", "7d", "30d"]).default("7d").describe("How long it stays pinned"),
      },
      annotations: IDEMPOTENT,
    },
    async ({ messageId, duration }) => {
      const pinned = await (await messageOf(session, messageId)).pin(PIN_DURATIONS[duration]);
      if (!pinned) throw new Error(`Message ${messageId} could not be pinned.`);
      return done(`Message pinned for ${duration}`);
    },
  );

  server.registerTool(
    "unpin_message",
    {
      title: "Unpin message",
      description: "Unpin a message",
      inputSchema: { messageId },
      annotations: IDEMPOTENT,
    },
    async ({ messageId }) => {
      const unpinned = await (await messageOf(session, messageId)).unpin();
      if (!unpinned) throw new Error(`Message ${messageId} could not be unpinned.`);
      return done("Message unpinned");
    },
  );

  server.registerTool(
    "get_message_info",
    {
      title: "Get message receipts",
      description: "Who received, read and played a message this account sent",
      inputSchema: { messageId },
      outputSchema: { delivered: Receipts, read: Receipts, played: Receipts },
      annotations: READ_ONLY,
    },
    async ({ messageId }) => {
      const info = await (await messageOf(session, messageId)).getInfo();
      if (!info) throw new Error(`Receipts are only kept for messages this account sent.`);
      const receipts = (list: Array<{ id: unknown; t: number }>) =>
        list.map(({ id, t }) => ({ id: serialize(id), at: t }));
      return structured({
        delivered: receipts(info.delivery),
        read: receipts(info.read),
        played: receipts(info.played),
      });
    },
  );

  server.registerTool(
    "get_message_reactions",
    {
      title: "Get message reactions",
      description: "The reactions to a message, by emoji and who sent them",
      inputSchema: { messageId },
      outputSchema: {
        reactions: z.array(
          z.object({
            emoji: z.string(),
            senders: z.array(z.object({ id: z.string(), at: z.number() })),
          }),
        ),
      },
      annotations: READ_ONLY,
    },
    async ({ messageId }) => {
      const reactions = (await (await messageOf(session, messageId)).getReactions()) ?? [];
      return structured({
        reactions: reactions.map(({ aggregateEmoji, senders }) => ({
          emoji: aggregateEmoji,
          senders: senders.map(({ senderId, timestamp }) => ({ id: senderId, at: timestamp })),
        })),
      });
    },
  );

  server.registerTool(
    "get_poll_votes",
    {
      title: "Get poll votes",
      description: "The votes cast on a poll",
      inputSchema: { messageId },
      outputSchema: {
        votes: z.array(
          z.object({ voter: z.string(), options: z.array(z.string()), at: z.number() }),
        ),
      },
      annotations: READ_ONLY,
    },
    async ({ messageId }) => {
      const votes = await (await messageOf(session, messageId)).getPollVotes();
      return structured({
        votes: votes.map(({ voter, selectedOptions, interractedAtTs }) => ({
          voter,
          options: selectedOptions.map(({ name }) => name),
          at: interractedAtTs,
        })),
      });
    },
  );

  server.registerTool(
    "vote_poll",
    {
      title: "Vote in poll",
      description: "Vote in a poll; an empty list removes the vote",
      inputSchema: { messageId, options: z.array(z.string()).describe("Names of the options") },
      annotations: IDEMPOTENT,
    },
    async ({ messageId, options }) => {
      await (await messageOf(session, messageId)).vote(options);
      return done(options.length ? `Voted ${options.join(", ")}` : "Vote removed");
    },
  );
}

function toContent(
  session: Session,
  text: string | undefined,
  mediaId: string | undefined,
  location:
    | { latitude: number; longitude: number; name?: string; address?: string; url?: string }
    | undefined,
  poll: { question: string; options: string[]; allowMultipleAnswers: boolean } | undefined,
): MessageContent {
  const kinds = [mediaId, location, poll].filter(Boolean).length;
  if (kinds > 1) throw new Error("Send one of mediaId, location or poll at a time.");
  if (mediaId) return mediaOf(session, mediaId);
  if (location) {
    const { latitude, longitude, ...options } = location;
    return new Location(latitude, longitude, options);
  }
  if (poll) {
    return new Poll(poll.question, poll.options, {
      allowMultipleAnswers: poll.allowMultipleAnswers,
      messageSecret: undefined,
    });
  }
  if (!text) throw new Error("Send text, mediaId, location or poll.");
  return text;
}
