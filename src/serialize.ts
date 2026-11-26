import type {
  Channel,
  Chat,
  Contact,
  GroupChat,
  Label,
  Message,
  MessageMedia,
} from "whatsapp-web.js";
import { z } from "zod";
import { serialize } from "./jid.js";

export const MessageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  from: z.string(),
  to: z.string(),
  author: z.string().optional(),
  body: z.string(),
  type: z.string(),
  timestamp: z.number(),
  fromMe: z.boolean(),
  hasMedia: z.boolean(),
  hasQuotedMsg: z.boolean(),
  hasReaction: z.boolean(),
  isForwarded: z.boolean(),
  isStarred: z.boolean(),
  ack: z.number(),
  mentionedIds: z.array(z.string()),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      name: z.string().optional(),
      address: z.string().optional(),
      url: z.string().optional(),
    })
    .optional(),
  poll: z.object({ name: z.string(), options: z.array(z.string()) }).optional(),
});

export const ChatSchema = z.object({
  id: z.string(),
  name: z.string(),
  isGroup: z.boolean(),
  isReadOnly: z.boolean(),
  unreadCount: z.number(),
  timestamp: z.number(),
  archived: z.boolean(),
  pinned: z.boolean(),
  isMuted: z.boolean(),
  muteExpiration: z.number(),
  lastMessage: MessageSchema.optional(),
});

export const ParticipantSchema = z.object({
  id: z.string(),
  isAdmin: z.boolean(),
  isSuperAdmin: z.boolean(),
});

export const GroupSchema = ChatSchema.extend({
  description: z.string(),
  owner: z.string().optional(),
  createdAt: z.string().optional(),
  participants: z.array(ParticipantSchema),
});

export const ContactSchema = z.object({
  id: z.string(),
  number: z.string(),
  name: z.string().optional(),
  pushname: z.string().optional(),
  shortName: z.string().optional(),
  isMe: z.boolean(),
  isUser: z.boolean(),
  isGroup: z.boolean(),
  isWAContact: z.boolean(),
  isMyContact: z.boolean(),
  isBusiness: z.boolean(),
  isEnterprise: z.boolean(),
  isBlocked: z.boolean(),
});

export const LabelSchema = z.object({ id: z.string(), name: z.string(), hexColor: z.string() });

export const ChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  isReadOnly: z.boolean(),
  isMuted: z.boolean(),
  unreadCount: z.number(),
  timestamp: z.number(),
});

export const MediaSchema = z.object({
  id: z.string(),
  mimetype: z.string(),
  filename: z.string().optional(),
  filesize: z.number().optional(),
});

export function toMessage(message: Message): z.infer<typeof MessageSchema> {
  const { location } = message;
  return {
    id: serialize(message.id),
    chatId: message.fromMe ? message.to : message.from,
    from: message.from,
    to: message.to,
    author: message.author || undefined,
    body: message.body ?? "",
    type: message.type,
    timestamp: message.timestamp ?? 0,
    fromMe: !!message.fromMe,
    hasMedia: !!message.hasMedia,
    hasQuotedMsg: !!message.hasQuotedMsg,
    hasReaction: !!message.hasReaction,
    isForwarded: !!message.isForwarded,
    isStarred: !!message.isStarred,
    ack: message.ack ?? 0,
    mentionedIds: (message.mentionedIds ?? []).map(serialize),
    location: location && {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      name: location.name || undefined,
      address: location.address || undefined,
      url: location.url || undefined,
    },
    poll: message.pollName ? { name: message.pollName, options: pollOptions(message) } : undefined,
  };
}

export function toChat(chat: Chat): z.infer<typeof ChatSchema> {
  return {
    id: serialize(chat.id),
    name: chat.name ?? "",
    isGroup: !!chat.isGroup,
    isReadOnly: !!chat.isReadOnly,
    unreadCount: chat.unreadCount ?? 0,
    timestamp: chat.timestamp ?? 0,
    archived: !!chat.archived,
    pinned: !!chat.pinned,
    isMuted: !!chat.isMuted,
    muteExpiration: chat.muteExpiration ?? 0,
    lastMessage: chat.lastMessage && toMessage(chat.lastMessage),
  };
}

export function toGroup(group: GroupChat): z.infer<typeof GroupSchema> {
  return {
    ...toChat(group),
    description: group.description ?? "",
    owner: group.owner ? serialize(group.owner) : undefined,
    createdAt: group.createdAt ? new Date(group.createdAt).toISOString() : undefined,
    participants: (group.participants ?? []).map((participant) => ({
      id: serialize(participant.id),
      isAdmin: !!participant.isAdmin,
      isSuperAdmin: !!participant.isSuperAdmin,
    })),
  };
}

export function toContact(contact: Contact): z.infer<typeof ContactSchema> {
  return {
    id: serialize(contact.id),
    number: contact.number ?? "",
    name: contact.name || undefined,
    pushname: contact.pushname || undefined,
    shortName: contact.shortName || undefined,
    isMe: !!contact.isMe,
    isUser: !!contact.isUser,
    isGroup: !!contact.isGroup,
    isWAContact: !!contact.isWAContact,
    isMyContact: !!contact.isMyContact,
    isBusiness: !!contact.isBusiness,
    isEnterprise: !!contact.isEnterprise,
    isBlocked: !!contact.isBlocked,
  };
}

export function toLabel(label: Label): z.infer<typeof LabelSchema> {
  return { id: String(label.id), name: label.name ?? "", hexColor: label.hexColor ?? "" };
}

export function toChannel(channel: Channel): z.infer<typeof ChannelSchema> {
  return {
    id: serialize(channel.id),
    name: channel.name ?? "",
    description: channel.description ?? "",
    isReadOnly: !!channel.isReadOnly,
    isMuted: !!channel.isMuted,
    unreadCount: channel.unreadCount ?? 0,
    timestamp: channel.timestamp ?? 0,
  };
}

export function toMedia(id: string, media: MessageMedia): z.infer<typeof MediaSchema> {
  return {
    id,
    mimetype: media.mimetype,
    filename: media.filename || undefined,
    filesize: media.filesize || undefined,
  };
}

function pollOptions(message: Message): string[] {
  return (message.pollOptions ?? []).map((option) =>
    typeof option === "string" ? option : (option as { name: string }).name,
  );
}
