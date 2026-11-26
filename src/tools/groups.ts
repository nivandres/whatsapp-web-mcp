import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { serialize, toChatId } from "../jid.js";
import { GroupSchema, toGroup } from "../serialize.js";
import type { Session } from "../session.js";
import { chatUri } from "../uris.js";
import {
  ACTION,
  chatId,
  contactIds,
  DESTRUCTIVE,
  done,
  groupOf,
  IDEMPOTENT,
  mediaId,
  mediaOf,
  READ_ONLY,
  structured,
} from "./shared.js";

const INVITE_LINK = "https://chat.whatsapp.com/";

const invite = z.string().describe(`Invite code, or a link such as ${INVITE_LINK}AbCdEf123`);

export function registerGroupTools(server: McpServer, session: Session): void {
  server.registerTool(
    "create_group",
    {
      title: "Create group",
      description: "Create a group with the given participants",
      inputSchema: { title: z.string().min(1).max(100), participants: contactIds },
      outputSchema: { id: z.string(), title: z.string() },
      annotations: ACTION,
    },
    async ({ title, participants }) => {
      const group = await session.require().createGroup(title, participants.map(toChatId));
      if (typeof group === "string") throw new Error(group);
      const id = serialize(group.gid);
      return structured({ id, title: group.title }, chatUri(id));
    },
  );

  server.registerTool(
    "get_group",
    {
      title: "Get group",
      description: "A group's details: description, owner, settings and participants",
      inputSchema: { chatId },
      outputSchema: GroupSchema.shape,
      annotations: READ_ONLY,
    },
    async ({ chatId }) => {
      const group = toGroup(await groupOf(session, chatId));
      return structured(group, chatUri(group.id));
    },
  );

  server.registerTool(
    "update_group",
    {
      title: "Update group",
      description: "Change a group's subject, description, picture or who may edit it",
      inputSchema: {
        chatId,
        subject: z.string().min(1).max(100).optional(),
        description: z.string().optional(),
        pictureMediaId: mediaId.optional().describe("Image from create_message_media"),
        messagesAdminsOnly: z.boolean().optional().describe("Only admins send messages"),
        infoAdminsOnly: z.boolean().optional().describe("Only admins edit the group's info"),
        addMembersAdminsOnly: z.boolean().optional().describe("Only admins add members"),
      },
      annotations: IDEMPOTENT,
    },
    async ({ chatId, subject, description, pictureMediaId, ...settings }) => {
      const group = await groupOf(session, chatId);
      const changes: Array<[string, () => Promise<unknown>]> = [];
      if (subject !== undefined) changes.push(["subject", () => group.setSubject(subject)]);
      if (description !== undefined) {
        changes.push(["description", () => group.setDescription(description)]);
      }
      if (pictureMediaId) {
        changes.push(["picture", () => group.setPicture(mediaOf(session, pictureMediaId))]);
      }
      if (settings.messagesAdminsOnly !== undefined) {
        changes.push([
          "messagesAdminsOnly",
          () => group.setMessagesAdminsOnly(settings.messagesAdminsOnly),
        ]);
      }
      if (settings.infoAdminsOnly !== undefined) {
        changes.push(["infoAdminsOnly", () => group.setInfoAdminsOnly(settings.infoAdminsOnly)]);
      }
      if (settings.addMembersAdminsOnly !== undefined) {
        changes.push([
          "addMembersAdminsOnly",
          () => group.setAddMembersAdminsOnly(settings.addMembersAdminsOnly),
        ]);
      }
      if (changes.length === 0) throw new Error("Nothing to change.");
      const failed: string[] = [];
      for (const [name, change] of changes) if ((await change()) === false) failed.push(name);
      if (failed.length) throw new Error(`Not changed, admin rights needed: ${failed.join(", ")}.`);
      return done(`Group updated: ${changes.map(([name]) => name).join(", ")}`);
    },
  );

  server.registerTool(
    "add_participants",
    {
      title: "Add participants",
      description: "Add participants to a group; those who can't be added are sent an invite",
      inputSchema: { chatId, participants: contactIds },
      outputSchema: {
        results: z.array(z.object({ id: z.string(), code: z.number(), message: z.string() })),
      },
      annotations: ACTION,
    },
    async ({ chatId, participants }) => {
      const group = await groupOf(session, chatId);
      const results = await group.addParticipants(participants.map(toChatId));
      if (typeof results === "string") throw new Error(results);
      return structured({
        results: Object.entries(results).map(([id, result]) => {
          const { code, message } = result as unknown as { code: number; message: string };
          return { id, code, message };
        }),
      });
    },
  );

  for (const [name, title, method, annotations] of [
    ["remove_participants", "Remove participants from a group", "removeParticipants", DESTRUCTIVE],
    [
      "promote_participants",
      "Make participants admins of a group",
      "promoteParticipants",
      IDEMPOTENT,
    ],
    ["demote_participants", "Remove participants' admin rights", "demoteParticipants", IDEMPOTENT],
  ] as const) {
    server.registerTool(
      name,
      { title, description: title, inputSchema: { chatId, participants: contactIds }, annotations },
      async ({ chatId, participants }) => {
        const group = await groupOf(session, chatId);
        const { status } = await group[method](participants.map(toChatId));
        if (status !== 200) throw new Error(`WhatsApp answered ${status}; admin rights needed.`);
        return done(`${title}: done`);
      },
    );
  }

  server.registerTool(
    "get_group_invite",
    {
      title: "Get group invite",
      description: "A group's invite code and link",
      inputSchema: { chatId },
      outputSchema: { code: z.string(), link: z.string() },
      annotations: READ_ONLY,
    },
    async ({ chatId }) => {
      const code = await (await groupOf(session, chatId)).getInviteCode();
      return structured({ code, link: `${INVITE_LINK}${code}` });
    },
  );

  server.registerTool(
    "revoke_group_invite",
    {
      title: "Revoke group invite",
      description: "Invalidate a group's invite link and create a new one",
      inputSchema: { chatId },
      outputSchema: { code: z.string(), link: z.string() },
      annotations: DESTRUCTIVE,
    },
    async ({ chatId }) => {
      const group = await groupOf(session, chatId);
      await group.revokeInvite();
      const code = await group.getInviteCode();
      return structured({ code, link: `${INVITE_LINK}${code}` });
    },
  );

  server.registerTool(
    "get_invite_info",
    {
      title: "Get invite info",
      description: "What group an invite leads to, without joining it",
      inputSchema: { invite },
      annotations: READ_ONLY,
    },
    async ({ invite }) =>
      done(JSON.stringify(await session.require().getInviteInfo(toInviteCode(invite)))),
  );

  server.registerTool(
    "join_group",
    {
      title: "Join group",
      description: "Join a group with an invite",
      inputSchema: { invite },
      outputSchema: { id: z.string() },
      annotations: ACTION,
    },
    async ({ invite }) => {
      const id = await session.require().acceptInvite(toInviteCode(invite));
      return structured({ id }, chatUri(id));
    },
  );

  server.registerTool(
    "leave_group",
    {
      title: "Leave group",
      description: "Leave a group",
      inputSchema: { chatId },
      annotations: DESTRUCTIVE,
    },
    async ({ chatId }) => {
      await (await groupOf(session, chatId)).leave();
      return done("Left the group");
    },
  );

  server.registerTool(
    "get_membership_requests",
    {
      title: "Get membership requests",
      description: "People asking to join a group that requires admin approval",
      inputSchema: { chatId },
      outputSchema: {
        requests: z.array(
          z.object({ id: z.string(), addedBy: z.string(), method: z.string(), at: z.number() }),
        ),
      },
      annotations: READ_ONLY,
    },
    async ({ chatId }) => {
      const requests = await session.require().getGroupMembershipRequests(toChatId(chatId));
      return structured({
        requests: requests.map((request) => ({
          id: serialize(request.id),
          addedBy: serialize(request.addedBy),
          method: request.requestMethod,
          at: request.t,
        })),
      });
    },
  );

  server.registerTool(
    "answer_membership_requests",
    {
      title: "Answer membership requests",
      description: "Approve or reject requests to join a group, all of them or some",
      inputSchema: {
        chatId,
        approve: z.boolean().describe("Approve (true) or reject (false)"),
        requesterIds: contactIds.optional().describe("Requesters to answer; omit for all"),
      },
      outputSchema: {
        results: z.array(
          z.object({ id: z.string(), message: z.string(), error: z.number().optional() }),
        ),
      },
      annotations: ACTION,
    },
    async ({ chatId, approve, requesterIds }) => {
      const client = session.require();
      const options = { requesterIds: requesterIds?.map(toChatId) ?? null, sleep: null };
      const results = approve
        ? await client.approveGroupMembershipRequests(toChatId(chatId), options)
        : await client.rejectGroupMembershipRequests(toChatId(chatId), options);
      return structured({
        results: results.map(({ requesterId, message, error }) => ({
          id: [requesterId].flat().join(","),
          message,
          error,
        })),
      });
    },
  );
}

function toInviteCode(invite: string): string {
  return invite.trim().replace(INVITE_LINK, "").split(/[/?#]/)[0] ?? invite;
}
