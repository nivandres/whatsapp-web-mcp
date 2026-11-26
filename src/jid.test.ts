import { describe, expect, it } from "vitest";
import { serialize, toChatId } from "./jid";

describe("jid", () => {
  it("normalizes bare numbers and leaves chat IDs alone", () => {
    expect(toChatId("15551234567")).toBe("15551234567@c.us");
    expect(toChatId("+1 (555) 123-4567")).toBe("15551234567@c.us");
    expect(toChatId("1234567890-1234567890@g.us")).toBe("1234567890-1234567890@g.us");
  });

  it("serializes WhatsApp's ID objects, old and renamed", () => {
    expect(serialize("15551234567@c.us")).toBe("15551234567@c.us");
    expect(serialize({ _serialized: "15551234567@c.us" })).toBe("15551234567@c.us");
    expect(serialize({ $1: "99990000111122@lid" })).toBe("99990000111122@lid");
    expect(serialize(undefined)).toBe("");
  });
});
