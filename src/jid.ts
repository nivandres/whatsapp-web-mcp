const USER_SUFFIX = "@c.us";

/**
 * An ID whatsapp-web.js hands over as one of WhatsApp's own objects, which
 * carry `_serialized` or, since WhatsApp renamed it, `$1`.
 */
export function serialize(id: unknown): string {
  if (typeof id === "string") return id;
  const wid = id as { _serialized?: string; $1?: string } | null | undefined;
  return wid?._serialized ?? wid?.$1 ?? "";
}

/** Normalize a bare phone number into a WhatsApp chat ID. */
export function toChatId(value: string): string {
  return value.includes("@") ? value : `${value.replace(/\D/g, "")}${USER_SUFFIX}`;
}
