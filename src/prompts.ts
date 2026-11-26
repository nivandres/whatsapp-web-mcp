import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import type { Chat } from "whatsapp-web.js";
import { z } from "zod";
import { serialize } from "./jid.js";
import { toMessage } from "./serialize.js";
import type { Session } from "./session.js";
import { chatOf, completeChatId } from "./tools/shared.js";
import { chatMessagesUri } from "./uris.js";

const HISTORY = 100;
const MAX_UNREAD_CHATS = 20;

export function registerPrompts(server: McpServer, session: Session): void {
  const chatId = completable(z.string().describe("Chat ID or phone number"), (value: string) =>
    completeChatId(session, value),
  );

  server.registerPrompt(
    "summarize_chat",
    {
      title: "Summarize chat",
      description: `Summarize a chat's latest ${HISTORY} messages`,
      argsSchema: { chatId },
    },
    async ({ chatId }) =>
      prompt(
        "Summarize this WhatsApp conversation: the topics, decisions, open questions and anything waiting on me.",
        [await history(await chatOf(session, chatId), HISTORY)],
      ),
  );

  server.registerPrompt(
    "draft_reply",
    {
      title: "Draft reply",
      description: "Draft a reply to a chat in its own tone, ready to send with send_message",
      argsSchema: {
        chatId,
        intent: z.string().optional().describe("What the reply should say or achieve"),
      },
    },
    async ({ chatId, intent }) =>
      prompt(
        `Draft my next reply to this WhatsApp conversation, in its language and tone${intent ? `, to ${intent}` : ""}. Show it to me before sending it with send_message.`,
        [await history(await chatOf(session, chatId), HISTORY)],
      ),
  );

  server.registerPrompt(
    "catch_up",
    {
      title: "Catch up",
      description: "Go through the unread chats and say what needs attention",
    },
    async () => {
      const unread = (await session.require().getChats())
        .filter((chat) => chat.unreadCount > 0)
        .slice(0, MAX_UNREAD_CHATS);
      return prompt(
        unread.length
          ? "Catch me up on these unread WhatsApp chats: who wrote, what they want, and what needs a reply first."
          : "Tell me I have no unread WhatsApp chats.",
        await Promise.all(unread.map((chat) => history(chat, chat.unreadCount))),
      );
    },
  );
}

async function history(chat: Chat, limit: number) {
  const id = serialize(chat.id);
  const messages = await chat.fetchMessages({ limit });
  return {
    uri: chatMessagesUri(id),
    mimeType: "application/json",
    text: JSON.stringify({ chat: chat.name || id, messages: messages.map(toMessage) }),
  };
}

function prompt(
  instruction: string,
  resources: Array<{ uri: string; mimeType: string; text: string }>,
): GetPromptResult {
  return {
    messages: [
      { role: "user", content: { type: "text", text: instruction } },
      ...resources.map((resource) => ({
        role: "user" as const,
        content: { type: "resource" as const, resource },
      })),
    ],
  };
}
