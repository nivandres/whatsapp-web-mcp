import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { serialize, toChatId } from "../jid.js";
import { ContactSchema, toContact } from "../serialize.js";
import type { Session } from "../session.js";
import { contactUri } from "../uris.js";
import {
  contactId,
  contactOf,
  done,
  IDEMPOTENT,
  page,
  READ_ONLY,
  slice,
  structured,
} from "./shared.js";

export function registerContactTools(server: McpServer, session: Session): void {
  server.registerTool(
    "get_contacts",
    {
      title: "List contacts",
      description: "List contacts known to this account",
      inputSchema: {
        ...page,
        query: z.string().optional().describe("Only contacts whose name or number contains this"),
        savedOnly: z.boolean().default(false).describe("Only contacts saved in the address book"),
      },
      outputSchema: { contacts: z.array(ContactSchema), total: z.number() },
      annotations: READ_ONLY,
    },
    async ({ query, savedOnly, ...range }) => {
      const needle = query?.toLowerCase();
      const contacts = (await session.require().getContacts()).filter(
        (contact) =>
          (!savedOnly || contact.isMyContact) &&
          (!needle ||
            [contact.name, contact.pushname, contact.number].some((value) =>
              value?.toLowerCase().includes(needle),
            )),
      );
      const { items, total } = slice(contacts, range);
      return structured({ contacts: items.map(toContact), total });
    },
  );

  server.registerTool(
    "get_contact",
    {
      title: "Get contact",
      description: "Get a contact by its ID or phone number",
      inputSchema: { contactId },
      outputSchema: ContactSchema.shape,
      annotations: READ_ONLY,
    },
    async ({ contactId }) => {
      const contact = toContact(await contactOf(session, contactId));
      return structured(contact, contactUri(contact.id));
    },
  );

  server.registerTool(
    "get_contact_about",
    {
      title: "Get contact about",
      description: "A contact's about text; empty when their privacy settings hide it",
      inputSchema: { contactId },
      outputSchema: { about: z.string() },
      annotations: READ_ONLY,
    },
    async ({ contactId }) =>
      structured({ about: (await (await contactOf(session, contactId)).getAbout()) ?? "" }),
  );

  server.registerTool(
    "get_contact_common_groups",
    {
      title: "Get common groups",
      description: "The groups this account shares with a contact",
      inputSchema: { contactId },
      outputSchema: { groupIds: z.array(z.string()) },
      annotations: READ_ONLY,
    },
    async ({ contactId }) => {
      const groups = await session.require().getCommonGroups(toChatId(contactId));
      return structured({ groupIds: groups.map(serialize) });
    },
  );

  server.registerTool(
    "get_profile_picture",
    {
      title: "Get profile picture",
      description:
        "The profile picture URL of a contact or group, or of this account when omitted, as privacy settings allow",
      inputSchema: { contactId: contactId.optional() },
      outputSchema: { url: z.string().optional() },
      annotations: READ_ONLY,
    },
    async ({ contactId }) => {
      const client = session.require();
      const url = await client.getProfilePicUrl(
        contactId ? toChatId(contactId) : serialize(client.info.wid),
      );
      return structured({ url: url || undefined });
    },
  );

  server.registerTool(
    "check_number",
    {
      title: "Check number",
      description: "Whether a phone number has WhatsApp, with its chat ID and formatted number",
      inputSchema: { number: z.string().describe("Phone number with country code") },
      outputSchema: {
        registered: z.boolean(),
        id: z.string().optional(),
        formatted: z.string().optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ number }) => {
      const client = session.require();
      const id = await client.getNumberId(number.replace(/\D/g, ""));
      if (!id) return structured({ registered: false });
      const serialized = serialize(id);
      return structured({
        registered: true,
        id: serialized,
        formatted: await client.getFormattedNumber(serialized),
      });
    },
  );

  server.registerTool(
    "get_blocked_contacts",
    {
      title: "List blocked contacts",
      description: "The contacts this account has blocked",
      outputSchema: { contacts: z.array(ContactSchema) },
      annotations: READ_ONLY,
    },
    async () => {
      const contacts = await session.require().getBlockedContacts();
      return structured({ contacts: contacts.map(toContact) });
    },
  );

  server.registerTool(
    "block_contact",
    {
      title: "Block contact",
      description: "Block a contact",
      inputSchema: { contactId },
      annotations: IDEMPOTENT,
    },
    async ({ contactId }) => {
      await (await contactOf(session, contactId)).block();
      return done("Contact blocked");
    },
  );

  server.registerTool(
    "unblock_contact",
    {
      title: "Unblock contact",
      description: "Unblock a contact",
      inputSchema: { contactId },
      annotations: IDEMPOTENT,
    },
    async ({ contactId }) => {
      await (await contactOf(session, contactId)).unblock();
      return done("Contact unblocked");
    },
  );
}
