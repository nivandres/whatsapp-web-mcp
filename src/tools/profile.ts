import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Session } from "../session.js";
import { DESTRUCTIVE, done, IDEMPOTENT, mediaId, mediaOf } from "./shared.js";

export function registerProfileTools(server: McpServer, session: Session): void {
  server.registerTool(
    "set_display_name",
    {
      title: "Set display name",
      description: "Change this account's display name",
      inputSchema: { displayName: z.string().min(1).max(25) },
      annotations: IDEMPOTENT,
    },
    async ({ displayName }) => {
      if (!(await session.require().setDisplayName(displayName))) {
        throw new Error("WhatsApp refused the display name.");
      }
      return done(`Display name set to ${displayName}`);
    },
  );

  server.registerTool(
    "set_status",
    {
      title: "Set about",
      description: "Change this account's about text",
      inputSchema: { status: z.string().max(139) },
      annotations: IDEMPOTENT,
    },
    async ({ status }) => {
      await session.require().setStatus(status);
      return done("About updated");
    },
  );

  server.registerTool(
    "set_profile_picture",
    {
      title: "Set profile picture",
      description: "Change this account's profile picture to an image from create_message_media",
      inputSchema: { mediaId },
      annotations: IDEMPOTENT,
    },
    async ({ mediaId }) => {
      if (!(await session.require().setProfilePicture(mediaOf(session, mediaId)))) {
        throw new Error("WhatsApp refused the picture.");
      }
      return done("Profile picture updated");
    },
  );

  server.registerTool(
    "delete_profile_picture",
    {
      title: "Delete profile picture",
      description: "Remove this account's profile picture",
      annotations: DESTRUCTIVE,
    },
    async () => {
      await session.require().deleteProfilePicture();
      return done("Profile picture deleted");
    },
  );

  server.registerTool(
    "set_presence",
    {
      title: "Set presence",
      description: "Show this account as online or offline",
      inputSchema: { online: z.boolean() },
      annotations: IDEMPOTENT,
    },
    async ({ online }) => {
      const client = session.require();
      await (online ? client.sendPresenceAvailable() : client.sendPresenceUnavailable());
      return done(online ? "Shown as online" : "Shown as offline");
    },
  );
}
