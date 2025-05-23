import wweb from "whatsapp-web.js";
import { Chat, Contact, Message, MessageMedia as Media } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const { Client, LocalAuth, MessageMedia } = wweb;

const Contacts = new Map<string, Contact>();
const Chats = new Map<string, Chat>();
const Messages = new Map<string, Message>();
const Medias = new Map<string, Media>();

let status: "ready" | (string & {}) = "";

const isConsole = process.argv.at(-1) === "console";

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer:
    process.platform !== "win32" ? { args: ["--no-sandbox"] } : undefined,
});

client.on("qr", (qr) => {
  if (isConsole) qrcode.generate(qr, { small: true });
  status = qr;
});
client.on("authenticated", () => {
  if (isConsole) console.log(`Session stored`);
});
client.on("ready", () => {
  if (isConsole) console.log(`Client is ready`);
  status = "ready";
});
client.on("disconnected", () => {
  status = "";
  if (isConsole) console.log(`Session disconnected`);
  client.initialize();
});

client.on("message_create", (message) => {
  Messages.set(message.id._serialized, message);
});
client.on("message_edit", (message) => {
  Messages.set(message.id._serialized, message);
});

client.initialize();

async function getChat(id: string = "") {
  const chat = (Chats.get(id) ||
    client.getChatById(id) ||
    Contacts.get(id)?.getChat() ||
    (await client.getContactById(id)).getChat()) as Chat | null;
  Chats.set(id, chat!);
  return chat;
}
async function getContact(id: string = "") {
  const contact = (Contacts.get(id) ||
    client.getContactById(id) ||
    Chats.get(id)?.getContact() ||
    (await client.getChatById(id)).getContact()) as Contact | null;
  Contacts.set(id, contact!);
  return contact;
}

const server = new McpServer({ name: "whatsapp-web", version: "1.0.0" });

server.tool(
  "send_message",
  "Send a message to a specific chatId",
  {
    chatId: z.string().describe("Chat ID"),
    content: z.string().describe("Message content"),
    options: z
      .object({
        quotedMessageId: z.string().optional().describe("Quoted message ID"),
        mediaId: z.string().optional().describe("Message media ID"),
        caption: z
          .string()
          .optional()
          .describe("Image or videos caption for media"),
        mentions: z
          .array(z.string())
          .optional()
          .describe("User IDs to mention in the message"),
        sendMediaAsSticker: z
          .boolean()
          .optional()
          .describe("Send media as a sticker"),
        sendSeen: z
          .boolean()
          .optional()
          .describe("Send seen status. Default is true"),
      })
      .optional(),
  },
  async ({ chatId, content, options }) => {
    try {
      const message = await client.sendMessage(chatId, content, {
        ...options,
        media: Medias.get(options?.mediaId!),
      });
      Messages.set(message.id._serialized, message);

      return {
        content: [
          {
            type: "resource",
            resource: {
              uri: `messages://${message.id._serialized}`,
              text: JSON.stringify(message),
              mimeType: "application/json",
            },
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.resource(
  "message",
  new ResourceTemplate("messages://{messageId}", {
    list: undefined,
  }),
  async (uri, { messageId }) => {
    messageId = typeof messageId !== "object" ? [messageId] : messageId;
    const messages = await Promise.all(messageId.map((id) => Messages.get(id)));
    return {
      contents: messages.filter(Boolean).map((message) => ({
        uri: `messages://${message!.id._serialized}`,
        text: JSON.stringify(message),
        mimeType: "application/json",
      })),
    };
  }
);

server.resource(
  "contact",
  new ResourceTemplate("contacts://{contactId}", { list: undefined }),
  async (uri, { contactId }) => {
    contactId = typeof contactId !== "object" ? [contactId] : contactId;
    const contacts = await Promise.all(contactId.map(getContact));
    return {
      contents: contacts.filter(Boolean).map((contact) => ({
        uri: `contacts://${contact!.id._serialized}`,
        text: JSON.stringify(contact),
        mimeType: "application/json",
      })),
    };
  }
);

server.tool(
  "get_contact",
  "Get contact instance by ID",
  {
    contactId: z.string().describe("Contact ID").optional(),
    chatId: z.string().describe("Chat ID").optional(),
  },
  async ({ contactId, chatId }) => {
    const contact = await getContact(contactId || chatId);
    if (!contact)
      return {
        isError: true,
        content: [{ type: "text", text: "Contact not found" }],
      };
    return {
      content: [
        {
          type: "resource",
          resource: {
            uri: `contacts://${contact.id._serialized}`,
            text: JSON.stringify(contact),
            mimeType: "application/json",
          },
        },
      ],
    };
  }
);

server.tool(
  "get_contacts",
  "Get all current contact instances",
  {
    limit: z
      .number()
      .optional()
      .describe(
        "Limit the number of contacts returned. All contacts will be fetched but this is the limit of the response"
      ),
    page: z.number().optional(),
  },
  async ({ limit = Infinity, page = 1 }) => {
    const contacts = await client.getContacts();
    contacts.forEach((contact) =>
      Contacts.set(contact.id._serialized, contact)
    );
    return {
      content: contacts
        .slice(limit * (page - 1), limit * page)
        .map((contact) => ({
          type: "resource",
          resource: {
            uri: `contacts://${contact.id._serialized}`,
            text: JSON.stringify(contact),
            mimeType: "application/json",
          },
        })),
    };
  }
);

server.resource(
  "chat",
  new ResourceTemplate("chats://{chatId}", { list: undefined }),
  async (uri, { chatId }) => {
    chatId = typeof chatId !== "object" ? [chatId] : chatId;
    const chats = await Promise.all(chatId.map(getChat));
    return {
      contents: chats.filter(Boolean).map((chat) => ({
        uri: `chats://${chat!.id._serialized}`,
        text: JSON.stringify(chat),
      })),
    };
  }
);

server.tool(
  "get_chat",
  "Get chat instance by ID",
  {
    chatId: z.string().describe("Chat ID").optional(),
    contactId: z.string().describe("Contact ID").optional(),
  },
  async ({ contactId, chatId }) => {
    const chat = await getChat(chatId || contactId);
    if (!chat)
      return {
        isError: true,
        content: [{ type: "text", text: "Chat not found" }],
      };
    return {
      content: [
        {
          type: "resource",
          resource: {
            uri: `chats://${chat.id._serialized}`,
            text: JSON.stringify(chat),
            mimeType: "application/json",
          },
        },
      ],
    };
  }
);

server.tool(
  "get_chats",
  "Get all current chat instances",
  {
    limit: z
      .number()
      .optional()
      .describe(
        "Limit the number of chats returned. All chats will be fetched but this is the limit of the response"
      ),
    page: z.number().optional(),
  },
  async ({ limit = Infinity, page = 1 }) => {
    const chats = await client.getChats();
    chats.forEach((chat) => Chats.set(chat.id._serialized, chat));
    return {
      content: chats.slice(limit * (page - 1), limit * page).map((chat) => ({
        type: "resource",
        resource: {
          uri: `chats://${chat.id._serialized}`,
          text: JSON.stringify(chat),
          mimeType: "application/json",
        },
      })),
    };
  }
);

server.tool(
  "search_messages",
  "Searches for messages",
  {
    query: z.string().describe("Search query"),
    options: z
      .object({
        chatId: z.string().optional().describe("Chat ID"),
        limit: z
          .number()
          .optional()
          .describe("Limit the number of messages returned"),
        page: z.number().optional(),
      })
      .optional(),
  },
  async ({ query, options }) => {
    const messages = await client.searchMessages(query, options);
    return {
      content: messages.map((message) => {
        Messages.set(message.id._serialized, message);
        return {
          type: "resource",
          resource: {
            uri: `messages://${message.id._serialized}`,
            text: JSON.stringify(message),
            mimeType: "application/json",
          },
        };
      }),
    };
  }
);

server.tool(
  "fetch_messages",
  "Loads chat messages, sorted from earliest to latest",
  {
    chatId: z.string().describe("Chat ID"),
    fromMe: z
      .boolean()
      .describe(
        "Return only messages from the bot number or vise versa. To get all messages, leave the option undefined."
      ),
    limit: z
      .number()
      .describe(
        "The amount of messages to return. If no limit is specified, the available messages will be returned. Note that the actual number of returned messages may be smaller if there aren't enough messages in the conversation. Set this to Infinity to load all messages."
      ),
  },
  async ({ chatId, fromMe, limit }) => {
    const chat = await getChat(chatId);
    if (!chat)
      return {
        isError: true,
        content: [{ type: "text", text: "Chat not found" }],
      };
    const messages = await chat.fetchMessages({ fromMe, limit });
    return {
      content: messages.map((message) => {
        Messages.set(message.id._serialized, message);
        return {
          type: "resource",
          resource: {
            uri: `messages://${message.id._serialized}`,
            text: JSON.stringify(message),
            mimeType: "application/json",
          },
        };
      }),
    };
  }
);

server.tool(
  "get_contact_about",
  'Gets the Contact\'s current "about" info. Returns "" if you don\'t have permission to read their status',
  {
    contactId: z.string().describe("Contact ID"),
  },
  async ({ contactId }) => {
    const contact = await getContact(contactId);
    if (!contact)
      return {
        isError: true,
        content: [{ type: "text", text: "Contact not found" }],
      };
    const about = await contact.getAbout();
    return {
      content: [
        {
          type: "text",
          text: about || "",
        },
      ],
    };
  }
);

server.tool(
  "get_contact_common_groups",
  "Gets the Contact's common group Ids with you. Returns empty array if you don't have any common group",
  {
    contactId: z.string().describe("Contact ID"),
  },
  async ({ contactId }) => {
    const commonGroups = await client.getCommonGroups(contactId);
    return {
      content: commonGroups.map((groupId) => ({
        type: "text",
        text: groupId._serialized,
      })),
    };
  }
);

server.tool(
  "get_contact_profile_pic_url",
  "Returns the contact's profile picture URL, if privacy settings allow it",
  {
    contactId: z.string().describe("Contact ID"),
  },
  async ({ contactId }) => {
    const url = await client.getProfilePicUrl(contactId);
    return {
      content: [
        {
          type: "text",
          text: url || "No profile picture set",
        },
      ],
    };
  }
);

server.tool(
  "archive_chat",
  "Archives a chat",
  {
    chatId: z.string().describe("Chat ID"),
  },
  async ({ chatId }) => {
    await client.archiveChat(chatId);
    return {
      content: [
        {
          type: "text",
          text: `Chat archived`,
        },
      ],
    };
  }
);

server.tool(
  "unarchive_chat",
  "Unarchives a chat",
  { chatId: z.string().describe("Chat ID") },
  async ({ chatId }) => {
    await client.unarchiveChat(chatId);
    return {
      content: [
        {
          type: "text",
          text: `Chat unarchived`,
        },
      ],
    };
  }
);

server.tool(
  "create_group",
  "Creates a new group",
  {
    title: z.string().describe("Group title"),
    participants: z.array(z.string()).describe("Contact IDs"),
  },
  async ({ title, participants }) => {
    const group = await client.createGroup(title, participants);
    return {
      content: [
        {
          type: "text",
          text: typeof group === "string" ? group : group.gid._serialized,
        },
      ],
    };
  }
);

server.resource(
  "media",
  new ResourceTemplate("media://{mediaId}", {
    list: undefined,
  }),
  async (uri, { mediaId }) => {
    mediaId = typeof mediaId !== "object" ? [mediaId] : mediaId;
    const medias = await Promise.all(mediaId.map((id) => Medias.get(id)));
    return {
      contents: medias.filter(Boolean).map((media) => ({
        uri: `media://${media!.filename}`,
        text: media!.filename,
        mimeType: media!.mimetype,
        blob: media!.data,
      })),
    };
  }
);

server.tool(
  "download_message_media",
  {
    messageId: z.string().describe("Message ID"),
  },
  async ({ messageId }) => {
    const message = Messages.get(messageId);
    if (!message)
      return {
        isError: true,
        content: [{ type: "text", text: "Message not found" }],
      };
    const media = await message.downloadMedia();
    const id = `${message.id._serialized}/${media.filename}`;
    Medias.set(id, media);
    return {
      content: [
        {
          type: "resource",
          resource: {
            uri: `media://${id}`,
            text: media.filename,
            mimeType: media.mimetype,
            blob: media.data,
          },
        },
      ],
    };
  }
);

server.tool(
  "create_message_media",
  "Creates a new message media reference for other command references",
  {
    id: z.string().describe("Message media ID reference"),
    resource: z
      .object({
        mimetype: z.string().describe("MIME type of the attachment"),
        data: z.string().base64().describe("Base64-encoded data of the file"),
        filename: z
          .string()
          .nullable()
          .optional()
          .describe("Document file name. Value can be null"),
        filesize: z
          .number()
          .nullable()
          .optional()
          .describe("Document file size in bytes. Value can be null"),
      })
      .optional()
      .describe("Create message media from resource"),
    fromFilePath: z
      .string()
      .optional()
      .describe("Create message media from file"),
    fromUrl: z
      .string()
      .url()
      .optional()
      .describe("Create message media from URL"),
  },
  async ({ id, resource, fromFilePath, fromUrl }) => {
    let media: Media;
    if (fromFilePath) media = MessageMedia.fromFilePath(fromFilePath);
    else if (fromUrl) media = await MessageMedia.fromUrl(fromUrl);
    else if (resource)
      media = new MessageMedia(
        resource.mimetype,
        resource.data,
        resource.filename,
        resource.filesize
      );
    else
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Error: no media provided",
          },
        ],
      };
    Medias.set(id, media);
    return {
      content: [
        {
          type: "resource",
          resource: {
            uri: `media://${id}`,
            text: media.filename,
            mimeType: media.mimetype,
            blob: media.data,
          },
        },
      ],
    };
  }
);

server.tool(
  "pin_chat",
  "Pins a chat",
  {
    chatId: z.string().describe("Chat ID"),
  },
  async ({ chatId }) => {
    const chat = await getChat(chatId);
    if (!chat)
      return {
        isError: true,
        content: [{ type: "text", text: "Chat not found" }],
      };
    await chat.pin();
    return {
      content: [
        {
          type: "text",
          text: `Chat pinned`,
        },
      ],
    };
  }
);

server.tool(
  "unpin_chat",
  "Unpins a chat",
  {
    chatId: z.string().describe("Chat ID"),
  },
  async ({ chatId }) => {
    const chat = await getChat(chatId);
    if (!chat)
      return {
        isError: true,
        content: [{ type: "text", text: "Chat not found" }],
      };
    await chat.unpin();
    return {
      content: [
        {
          type: "text",
          text: `Chat unpinned`,
        },
      ],
    };
  }
);

server.tool(
  "mute_chat",
  "Mutes a chat for a specific duration",
  {
    chatId: z.string().describe("Chat ID"),
    unmuteDate: z.string().optional().describe("Unmute date in ISO format"),
  },
  async ({ chatId, unmuteDate }) => {
    const chat = await getChat(chatId);
    if (!chat)
      return {
        isError: true,
        content: [{ type: "text", text: "Chat not found" }],
      };
    await chat.mute(unmuteDate ? new Date(unmuteDate) : undefined);
    return {
      content: [
        {
          type: "text",
          text: "Chat muted",
        },
      ],
    };
  }
);

server.tool(
  "unmute_chat",
  "Unmutes a chat",
  {
    chatId: z.string().describe("Chat ID"),
  },
  async ({ chatId }) => {
    const chat = await getChat(chatId);
    if (!chat)
      return {
        isError: true,
        content: [{ type: "text", text: "Chat not found" }],
      };
    await chat.unmute();
    return {
      content: [
        {
          type: "text",
          text: `Chat unmuted`,
        },
      ],
    };
  }
);

server.tool(
  "block_contact",
  "Blocks a contact",
  {
    contactId: z.string().describe("Contact ID"),
  },
  async ({ contactId }) => {
    const contact = await getContact(contactId);
    if (!contact)
      return {
        isError: true,
        content: [{ type: "text", text: "Contact not found" }],
      };
    await contact.block();
    return {
      content: [
        {
          type: "text",
          text: `Contact blocked`,
        },
      ],
    };
  }
);

server.tool(
  "unblock_contact",
  "Unblocks a contact",
  {
    contactId: z.string().describe("Contact ID"),
  },
  async ({ contactId }) => {
    const contact = await getContact(contactId);
    if (!contact)
      return {
        isError: true,
        content: [{ type: "text", text: "Contact not found" }],
      };
    await contact.unblock();
    return {
      content: [
        {
          type: "text",
          text: `Contact unblocked`,
        },
      ],
    };
  }
);

server.tool(
  "get_blocked_contacts",
  "Retrieves all blocked contacts",
  async () => {
    const blockedContacts = await client.getBlockedContacts();
    return {
      content: [
        blockedContacts.map((contact) => ({
          type: "resource",
          resource: {
            uri: `contacts://${contact.id._serialized}`,
            text: JSON.stringify(contact),
            mimeType: "application/json",
          },
        })),
      ] as any,
    };
  }
);

server.tool(
  "get_profile_picture",
  "Gets the client's profile picture URL",
  {
    contactId: z
      .string()
      .optional()
      .describe(
        "Contact ID. If not provided, the profile picture of the client will be returned"
      ),
  },
  async ({ contactId = client.info.wid._serialized }) => {
    const url = await client.getProfilePicUrl(contactId);
    return {
      content: [
        {
          type: "text",
          text: url || "No profile picture",
        },
      ],
    };
  }
);

server.tool(
  "set_profile_picture",
  "Sets the client's profile picture",
  {
    mediaId: z.string().describe("Message media ID"),
  },
  async ({ mediaId }) => {
    const media = Medias.get(mediaId);
    if (!media)
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Media not found locally, try to run create_message_media first",
          },
        ],
      };
    await client.setProfilePicture(media);
    return {
      content: [
        {
          type: "text",
          text: `Profile picture updated`,
        },
      ],
    };
  }
);

server.tool(
  "delete_profile_picture",
  "Removes the current user's profile picture",
  () => {
    client.deleteProfilePicture();
    return {
      content: [
        {
          type: "text",
          text: `Profile picture deleted`,
        },
      ],
    };
  }
);

server.tool(
  "set_display_name",
  "Sets the client's display name",
  {
    displayName: z.string().describe("New display name"),
  },
  async ({ displayName }) => {
    await client.setDisplayName(displayName);
    return {
      content: [
        {
          type: "text",
          text: `Display name updated to ${displayName}`,
        },
      ],
    };
  }
);

server.tool("get_info", "Gets the client's information", async () => {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(client.info),
      },
    ],
  };
});

server.tool("client_status", "Get client session status", async () => {
  const ready = status === "ready";
  const qr = ready ? "" : status;
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ready: status === "ready",
          status: ready ? "ready" : qr ? "qr" : "loading",
          qr: status !== "ready" ? status : undefined,
        }),
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
