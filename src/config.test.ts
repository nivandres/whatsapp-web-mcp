import { describe, expect, it } from "vitest";
import { parseCommand, parseConfig } from "./config";

describe("config", () => {
  it("defaults to a local stdio server on a free port", () => {
    expect(parseConfig({})).toMatchObject({
      command: "stdio",
      dataDir: ".wwebjs_auth",
      host: "127.0.0.1",
      port: 0,
      headless: true,
      chromiumArgs: [],
    });
  });

  it("serves HTTP on port 3000 unless told otherwise", () => {
    expect(parseConfig({}, "http").port).toBe(3000);
    expect(parseConfig({ PORT: "8080" }, "http").port).toBe(8080);
  });

  it("reads the browser and media settings from the environment", () => {
    const config = parseConfig({
      HEADLESS: "false",
      CHROMIUM_ARGS: "--no-sandbox  --lang=es",
      MAX_MEDIA_BYTES: "1024",
      PHONE_NUMBER: "15551234567",
    });
    expect(config).toMatchObject({
      headless: false,
      chromiumArgs: ["--no-sandbox", "--lang=es"],
      maxMediaBytes: 1024,
      phoneNumber: "15551234567",
    });
  });

  it("rejects a phone number with formatting and a short token", () => {
    expect(() => parseConfig({ PHONE_NUMBER: "+1 555 123 4567" })).toThrow(/PHONE_NUMBER/);
    expect(() => parseConfig({ AUTH_TOKEN: "short" })).toThrow(/AUTH_TOKEN/);
  });

  it("takes stdio, http or login as the command", () => {
    expect(parseCommand([])).toBe("stdio");
    expect(parseCommand(["http"])).toBe("http");
    expect(parseCommand(["login"])).toBe("login");
    expect(() => parseCommand(["serve"])).toThrow(/Unknown command "serve"/);
  });
});
