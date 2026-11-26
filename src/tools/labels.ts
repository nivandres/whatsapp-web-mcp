import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toChatId } from "../jid.js";
import { ChatSchema, LabelSchema, toChat, toLabel } from "../serialize.js";
import type { Session } from "../session.js";
import { chatId, chatOf, done, IDEMPOTENT, READ_ONLY, structured } from "./shared.js";

const labelId = z.string().describe("Label ID, from get_labels");

export function registerLabelTools(server: McpServer, session: Session): void {
  server.registerTool(
    "get_labels",
    {
      title: "List labels",
      description: "The labels of a WhatsApp Business account",
      outputSchema: { labels: z.array(LabelSchema) },
      annotations: READ_ONLY,
    },
    async () => structured({ labels: (await session.require().getLabels()).map(toLabel) }),
  );

  server.registerTool(
    "get_chat_labels",
    {
      title: "Get chat labels",
      description: "The labels on a chat of a WhatsApp Business account",
      inputSchema: { chatId },
      outputSchema: { labels: z.array(LabelSchema) },
      annotations: READ_ONLY,
    },
    async ({ chatId }) => {
      const labels = await session.require().getChatLabels(toChatId(chatId));
      return structured({ labels: labels.map(toLabel) });
    },
  );

  server.registerTool(
    "get_chats_by_label",
    {
      title: "List chats by label",
      description: "The chats carrying a label of a WhatsApp Business account",
      inputSchema: { labelId },
      outputSchema: { chats: z.array(ChatSchema) },
      annotations: READ_ONLY,
    },
    async ({ labelId }) => {
      const chats = await session.require().getChatsByLabelId(labelId);
      return structured({ chats: chats.map(toChat) });
    },
  );

  server.registerTool(
    "set_chat_labels",
    {
      title: "Set chat labels",
      description: "Replace the labels on a chat of a WhatsApp Business account",
      inputSchema: { chatId, labelIds: z.array(labelId).describe("Labels to keep; empty clears") },
      annotations: IDEMPOTENT,
    },
    async ({ chatId, labelIds }) => {
      await (await chatOf(session, chatId)).changeLabels(labelIds);
      return done("Chat labels updated");
    },
  );
}
