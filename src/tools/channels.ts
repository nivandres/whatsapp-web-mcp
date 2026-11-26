import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ChannelSchema, toChannel } from "../serialize.js";
import type { Session } from "../session.js";
import { done, IDEMPOTENT, READ_ONLY, structured } from "./shared.js";

const channelId = z.string().describe("Channel ID, such as 120363000000000000@newsletter");

export function registerChannelTools(server: McpServer, session: Session): void {
  server.registerTool(
    "get_channels",
    {
      title: "List channels",
      description: "The channels this account follows or owns",
      outputSchema: { channels: z.array(ChannelSchema) },
      annotations: READ_ONLY,
    },
    async () => structured({ channels: (await session.require().getChannels()).map(toChannel) }),
  );

  server.registerTool(
    "search_channels",
    {
      title: "Search channels",
      description: "Search the public channel directory",
      inputSchema: {
        query: z.string().min(1).describe("Text to search for"),
        limit: z.number().int().positive().max(100).default(20),
      },
      outputSchema: { channels: z.array(ChannelSchema) },
      annotations: READ_ONLY,
    },
    async ({ query, limit }) => {
      const channels = await session.require().searchChannels({ searchText: query, limit });
      return structured({ channels: channels.map(toChannel) });
    },
  );

  server.registerTool(
    "subscribe_channel",
    {
      title: "Follow channel",
      description: "Follow a channel",
      inputSchema: { channelId },
      annotations: IDEMPOTENT,
    },
    async ({ channelId }) => {
      if (!(await session.require().subscribeToChannel(channelId))) {
        throw new Error(`Channel ${channelId} could not be followed.`);
      }
      return done("Channel followed");
    },
  );

  server.registerTool(
    "unsubscribe_channel",
    {
      title: "Unfollow channel",
      description: "Stop following a channel",
      inputSchema: { channelId },
      annotations: IDEMPOTENT,
    },
    async ({ channelId }) => {
      if (!(await session.require().unsubscribeFromChannel(channelId))) {
        throw new Error(`Channel ${channelId} could not be unfollowed.`);
      }
      return done("Channel unfollowed");
    },
  );
}
