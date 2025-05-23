import wweb from "whatsapp-web.js";
import { Chat, Contact, Message, MessageMedia as Media } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const { Client, LocalAuth, MessageMedia } = wweb;

const Contacts = new Map<string, Contact>();
const Chats = new Map<string, Chat>();
const Messages = new Map<string, Message>();
const Medias = new Map<string, Media>();

if (process.argv.length < 3) {
  console.error("Error: no provided data path for auth");
  process.exit(1);
}

const dataPath = process.argv.at(-1);

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath,
  }),
  puppeteer:
    process.platform !== "win32" ? { args: ["--no-sandbox"] } : undefined,
});

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log({ authed: false, dataPath, qr });
});
client.on("authenticated", () => {
  console.log({ authed: true, dataPath, ready: false });
});
client.on("ready", () => {
  console.log({ authed: true, dataPath, ready: true });
});

client.initialize();

const server = new McpServer({ name: "whatsapp-web", version: "1.0.0" });

server.tool(
  "send_message",
  "Send a message to a specific chatId",
  {
    chatId: z.string().describe("Chat ID"),
    content: z.string().describe("Message content"),
    options: z
      .object({
        quotedMessageId: z.string().describe("Quoted message ID"),
        mediaId: z.string().describe("Message media ID"),
        caption: z.string().describe("Image or videos caption for media"),
        mentions: z
          .array(z.string())
          .describe("User IDs to mention in the message"),
        sendMediaAsSticker: z.boolean().describe("Send media as a sticker"),
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
            type: "text",
            text: `Message successfully sent\nMessage ID: ${message.id._serialized}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error sending message: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
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
    let contact: Contact;
    if (!contactId) {
      if (!chatId)
        return {
          isError: true,
          content: [
            { type: "text", text: "Error: no contactId or chatId provided" },
          ],
        };
      const chat = await client.getChatById(chatId);
      Chats.set(chat.id._serialized, chat);
      contact = await chat.getContact();
    } else contact = await client.getContactById(contactId);
    Contacts.set(contact.id._serialized, contact);
    return {
      content: [
        {
          type: "resource",
          resource: {
            text: JSON.stringify(contact),
            mimeType: "application/json",
            blob: null,
            uri: contact.id._serialized,
          },
        },
      ],
    };
  }
);

server.tool("get_contacts", "Get all current contact instances", async () => {
  const contacts = await client.getContacts();
  return {
    content: [
      contacts.map((contact) => {
        Contacts.set(contact.id._serialized, contact);
        return {
          type: "resource",
          resource: {
            mimeType: "application/json",
            text: JSON.stringify(contact),
            blob: null,
            uri: contact.id._serialized,
          },
        };
      }),
    ] as any,
  };
});

server.tool(
  "get_chat",
  "Get chat instance by ID",
  {
    chatId: z.string().describe("Chat ID").optional(),
    contactId: z.string().describe("Contact ID").optional(),
  },
  async ({ contactId, chatId }) => {
    let chat: Chat;
    if (!chatId) {
      if (!contactId)
        return {
          isError: true,
          content: [
            { type: "text", text: "Error: no chatId or contactId provided" },
          ],
        };
      const contact = await client.getContactById(contactId);
      Contacts.set(contact.id._serialized, contact);
      chat = await contact.getChat();
    } else chat = await client.getChatById(chatId);
    Chats.set(chat.id._serialized, chat);
    return {
      content: [
        {
          type: "resource",
          resource: {
            mimeType: "application/json",
            text: JSON.stringify(chat),
            blob: null,
            uri: chat.id._serialized,
          },
        },
      ],
    };
  }
);

server.tool("get_chats", "Get all current chat instances", async () => {
  const chats = await client.getChats();
  return {
    content: [
      chats.map((chat) => {
        Chats.set(chat.id._serialized, chat);
        return {
          type: "resource",
          resource: {
            mimeType: "application/json",
            text: JSON.stringify(chat),
            blob: null,
            uri: chat.id._serialized,
          },
        };
      }),
    ] as any,
  };
});

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
      .max(100)
      .describe(
        "The amount of messages to return. If no limit is specified, the available messages will be returned. Note that the actual number of returned messages may be smaller if there aren't enough messages in the conversation. Set this to Infinity to load all messages."
      ),
  },
  async ({ chatId, fromMe, limit }) => {
    const chat = Chats.get(chatId);
    if (!chat)
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Chat not found locally, try to run get_chat first",
          },
        ],
      };
    const messages = await chat.fetchMessages({ fromMe, limit });
    return {
      content: [
        messages.map((message) => {
          Messages.set(message.id._serialized, message);
          return {
            type: "resource",
            resource: {
              mimeType: "application/json",
              text: JSON.stringify(message),
              blob: null,
              uri: message.id._serialized,
            },
          };
        }),
      ] as any,
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
    const contact = Contacts.get(contactId);
    if (!contact)
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Contact not found locally, try to run get_contact first",
          },
        ],
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
    const contact = Contacts.get(contactId);
    if (!contact)
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Contact not found locally, try to run get_contact first",
          },
        ],
      };
    const commonGroups = await contact.getCommonGroups();
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
    const contact = Contacts.get(contactId);
    if (!contact)
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Contact not found locally, try to run get_contact first",
          },
        ],
      };
    const url = await contact.getProfilePicUrl();
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
          type: "text",
          text: `Media created with ID ${id}`,
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
    const chat = Chats.get(chatId);
    if (!chat)
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Chat not found locally, try to run get_chat first",
          },
        ],
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
    const chat = Chats.get(chatId);
    if (!chat)
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Chat not found locally, try to run get_chat first",
          },
        ],
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
    unmuteDate: z.string().describe("Unmute date in ISO format"),
  },
  async ({ chatId, unmuteDate }) => {
    const chat = Chats.get(chatId);
    if (!chat)
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Chat not found locally, try to run get_chat first",
          },
        ],
      };
    await chat.mute(new Date(unmuteDate));
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
    const chat = Chats.get(chatId);
    if (!chat)
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Chat not found locally, try to run get_chat first",
          },
        ],
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
    const contact = Contacts.get(contactId);
    if (!contact)
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Contact not found locally, try to run get_contact first",
          },
        ],
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
    const contact = Contacts.get(contactId);
    if (!contact)
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Contact not found locally, try to run get_contact first",
          },
        ],
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
            mimeType: "application/json",
            text: JSON.stringify(contact),
            blob: null,
            uri: contact.id._serialized,
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
          text: url || "No profile picture set",
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

const transport = new StdioServerTransport();
await server.connect(transport);
