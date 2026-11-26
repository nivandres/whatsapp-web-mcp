export const SESSION_URI = "whatsapp://session";

export const chatUri = (chatId: string) => `whatsapp://chats/${encodeURIComponent(chatId)}`;

export const chatMessagesUri = (chatId: string) => `${chatUri(chatId)}/messages`;

export const contactUri = (contactId: string) =>
  `whatsapp://contacts/${encodeURIComponent(contactId)}`;

export const messageUri = (messageId: string) =>
  `whatsapp://messages/${encodeURIComponent(messageId)}`;

export const mediaUri = (mediaId: string) => `whatsapp://media/${encodeURIComponent(mediaId)}`;
