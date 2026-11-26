import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MessageMedia as WAMessageMedia } from "whatsapp-web.js";
import { z } from "zod";
import { MediaSchema, toMedia } from "../serialize.js";
import type { Session } from "../session.js";
import { mediaUri } from "../uris.js";
import { MessageMedia } from "../wwebjs.js";
import { ACTION, messageId, messageOf, READ_ONLY } from "./shared.js";

export function registerMediaTools(server: McpServer, session: Session): void {
  server.registerTool(
    "create_message_media",
    {
      title: "Create media",
      description:
        "Load a file to send with send_message or use as a picture: from base64 data, a local file path or a URL. Returns its media ID.",
      inputSchema: {
        id: z.string().optional().describe("Media ID to assign; one is generated when omitted"),
        data: z.base64().optional().describe("Base64-encoded file"),
        mimetype: z.string().optional().describe("MIME type of data, such as image/png"),
        filename: z.string().optional().describe("File name shown to the recipient"),
        filePath: z.string().optional().describe("Absolute path of a local file"),
        url: z
          .url({ protocol: /^https?$/ })
          .optional()
          .describe("URL to download the file from"),
      },
      outputSchema: MediaSchema.shape,
      annotations: { ...ACTION, openWorldHint: false },
    },
    async ({ id = randomUUID(), data, mimetype, filename, filePath, url }) => {
      const media = await load(session.config.maxMediaBytes, {
        data,
        mimetype,
        filename,
        filePath,
        url,
      });
      if (filename) media.filename = filename;
      session.remember(id, media);
      const meta = toMedia(id, media);
      return {
        content: [
          { type: "text", text: JSON.stringify(meta) },
          {
            type: "resource_link",
            uri: mediaUri(id),
            name: meta.filename ?? id,
            mimeType: meta.mimetype,
          },
        ],
        structuredContent: meta,
      };
    },
  );

  server.registerTool(
    "download_message_media",
    {
      title: "Download media",
      description:
        "Download a message's photo, video, audio, document or sticker. It can then be forwarded with its media ID.",
      inputSchema: { messageId },
      outputSchema: MediaSchema.shape,
      annotations: READ_ONLY,
    },
    async ({ messageId }) => {
      const message = await messageOf(session, messageId);
      if (!message.hasMedia) throw new Error(`Message ${messageId} has no media.`);
      const media = await message.downloadMedia();
      if (!media?.data) throw new Error(`Media of ${messageId} is no longer available.`);
      assertSize(Buffer.byteLength(media.data, "base64"), session.config.maxMediaBytes);
      session.remember(messageId, media);
      const meta = toMedia(messageId, media);
      return {
        content: [
          { type: "text", text: JSON.stringify(meta) },
          {
            type: "resource",
            resource: { uri: mediaUri(messageId), mimeType: media.mimetype, blob: media.data },
          },
        ],
        structuredContent: meta,
      };
    },
  );
}

async function load(
  maxBytes: number,
  source: { data?: string; mimetype?: string; filename?: string; filePath?: string; url?: string },
): Promise<WAMessageMedia> {
  const given = [source.data, source.filePath, source.url].filter(Boolean).length;
  if (given !== 1) throw new Error("Give exactly one of data, filePath or url.");
  if (source.data) {
    if (!source.mimetype) throw new Error("data needs its mimetype.");
    assertSize(Buffer.byteLength(source.data, "base64"), maxBytes);
    return new MessageMedia(source.mimetype, source.data, source.filename ?? null);
  }
  if (source.filePath) {
    assertSize((await stat(source.filePath)).size, maxBytes);
    return MessageMedia.fromFilePath(source.filePath);
  }
  return MessageMedia.fromUrl(source.url!, {
    unsafeMime: true,
    filename: source.filename,
    reqOptions: { size: maxBytes } as RequestInit,
  });
}

function assertSize(size: number, maxBytes: number): void {
  if (size > maxBytes) throw new Error(`Media is ${size} bytes, over the ${maxBytes}-byte limit.`);
}
