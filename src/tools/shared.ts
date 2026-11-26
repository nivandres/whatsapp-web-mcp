import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { GroupChat, MessageMedia } from "whatsapp-web.js";
import { z } from "zod";
import { serialize, toChatId } from "../jid.js";
import type { Session } from "../session.js";

const MAX_COMPLETIONS = 20;

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };
export const ACTION: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
};
export const IDEMPOTENT: ToolAnnotations = { ...ACTION, idempotentHint: true };
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
};

export const chatId = z
  .string()
  .describe("Chat ID, such as 15551234567@c.us or 123456789-987654321@g.us, or a phone number");
export const contactId = z
  .string()
  .describe("Contact ID, such as 15551234567@c.us, or a phone number with country code");
export const contactIds = z.array(contactId).min(1);
export const messageId = z.string().describe("Message ID, as returned in a message's `id`");
export const mediaId = z.string().describe("Media ID, from create_media or download_message_media");
export const page = {
  limit: z.number().int().positive().max(500).default(50).describe("Items to return"),
  offset: z.number().int().min(0).default(0).describe("Items to skip"),
};

export function structured<T extends Record<string, unknown>>(
  data: T,
  uri?: string,
): CallToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify(data) },
      ...(uri ? [{ type: "resource_link" as const, uri, name: uri }] : []),
    ],
    structuredContent: data,
  };
}

export function done(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function slice<T>(items: T[], { limit, offset }: { limit: number; offset: number }) {
  return { items: items.slice(offset, offset + limit), total: items.length };
}

export async function chatOf(session: Session, id: string) {
  const chat = await session.require().getChatById(toChatId(id));
  if (!chat) throw new Error(`Chat ${id} not found.`);
  return chat;
}

export async function groupOf(session: Session, id: string): Promise<GroupChat> {
  const chat = await chatOf(session, id);
  if (!chat.isGroup) throw new Error(`Chat ${id} is not a group.`);
  return chat as GroupChat;
}

export async function contactOf(session: Session, id: string) {
  const contact = await session.require().getContactById(toChatId(id));
  if (!contact) throw new Error(`Contact ${id} not found.`);
  return contact;
}

export async function messageOf(session: Session, id: string) {
  const message = await session.require().getMessageById(id);
  if (!message) throw new Error(`Message ${id} not found. Fetch the chat's messages first.`);
  return message;
}

export async function completeChatId(session: Session, value: string): Promise<string[]> {
  if (session.state !== "connected") return [];
  const needle = value.toLowerCase();
  return (await session.client.getChats())
    .filter(
      (chat) => serialize(chat.id).startsWith(value) || chat.name?.toLowerCase().includes(needle),
    )
    .slice(0, MAX_COMPLETIONS)
    .map((chat) => serialize(chat.id));
}

export function mediaOf(session: Session, id: string): MessageMedia {
  const media = session.media.get(id);
  if (!media) throw new Error(`Media ${id} not found. Create it with create_media first.`);
  return media;
}
