import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "whatsapp-web.js";
import { parseConfig } from "./config";
import { Session } from "./session";

class FakeClient extends EventEmitter {
  options = { puppeteer: {} };
  info = { wid: { _serialized: "15551234567@c.us" }, pushname: "Ada" };
  initialize = vi.fn(async () => undefined);
  destroy = vi.fn(async () => undefined);
  logout = vi.fn(async () => undefined);
  getState = vi.fn(async () => "CONNECTED");
  requestPairingCode = vi.fn(async () => "ABCD1234");
}

function setup() {
  const client = new FakeClient();
  const session = new Session(parseConfig({}), client as unknown as Client);
  return { client, session };
}

describe("Session", () => {
  let session: Session | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await session?.close();
  });

  it("shows the QR, then the account once it is scanned", async () => {
    const setUp = setup();
    session = setUp.session;
    const states: string[] = [];
    session.on("change", ({ state }) => states.push(state));
    const started = session.start();
    await vi.waitFor(() => expect(setUp.client.initialize).toHaveBeenCalled());

    setUp.client.emit("qr", "2@qr");
    expect(session.status).toMatchObject({ state: "qr", qr: "2@qr" });
    expect(() => session!.require()).toThrow(/not linked \(qr\)/);

    setUp.client.emit("ready");
    await started;
    expect(session.status).toMatchObject({
      state: "connected",
      qr: undefined,
      account: { id: "15551234567@c.us", name: "Ada" },
    });
    expect(session.require()).toBe(setUp.client);
    expect(states).toEqual(["connecting", "qr", "connected"]);
  });

  it("settles once the session has something to show", async () => {
    const setUp = setup();
    session = setUp.session;
    void session.start();
    const settled = session.settle();
    setUp.client.emit("qr", "2@qr");
    expect((await settled).state).toBe("qr");
  });

  it("swaps the QR for a pairing code", async () => {
    const setUp = setup();
    session = setUp.session;
    void session.start();
    await expect(session.requestPairingCode("1 555 123")).rejects.toThrow(/while linking/);
    setUp.client.emit("qr", "2@qr");

    expect(await session.requestPairingCode("+1 555 123")).toBe("ABCD1234");
    expect(setUp.client.requestPairingCode).toHaveBeenCalledWith("1555123");
    expect(session.status).toMatchObject({ state: "pairing", code: "ABCD1234", qr: undefined });
  });

  it("retries a hung start, then waits for a scan however long it takes", async () => {
    vi.useFakeTimers();
    const setUp = setup();
    session = setUp.session;
    const hung = session.start().catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await hung).toMatchObject({ message: expect.stringMatching(/not ready within/) });
    expect(setUp.client.destroy).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(setUp.client.initialize).toHaveBeenCalledTimes(2);
    setUp.client.emit("qr", "2@qr");
    await vi.advanceTimersByTimeAsync(600_000);
    expect(session.state).toBe("qr");
  });

  it("reconnects when WhatsApp drops, but not after a logout", async () => {
    vi.useFakeTimers();
    const setUp = setup();
    session = setUp.session;
    void session.start();
    await vi.advanceTimersByTimeAsync(0);
    setUp.client.emit("ready");
    await vi.advanceTimersByTimeAsync(0);

    setUp.client.emit("disconnected", "NAVIGATION");
    expect(session.state).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(setUp.client.initialize).toHaveBeenCalledTimes(2);
    setUp.client.emit("ready");
    await vi.advanceTimersByTimeAsync(0);

    setUp.client.emit("disconnected", "LOGOUT");
    expect(session.state).toBe("logged_out");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(setUp.client.initialize).toHaveBeenCalledTimes(2);
  });

  it("treats a session that stops answering as dropped", async () => {
    vi.useFakeTimers();
    const setUp = setup();
    session = setUp.session;
    void session.start();
    await vi.advanceTimersByTimeAsync(0);
    setUp.client.emit("ready");
    setUp.client.getState.mockResolvedValue("TIMEOUT");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(session.state).toBe("connected");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(session.state).toBe("reconnecting");
  });

  it("says how to run the latest whatsapp-web.js when it no longer reads WhatsApp Web", async () => {
    const setUp = setup();
    session = setUp.session;
    setUp.client.initialize.mockRejectedValue("auth timeout");

    await expect(session.start()).rejects.toThrow(/github:pedroslopez\/whatsapp-web.js/);
    expect(session.status).toMatchObject({
      state: "disconnected",
      error: expect.stringMatching(/^auth timeout: whatsapp-web.js 1\.34\.8 no longer reads/),
    });
  });

  it("forgets the stored session on logout", async () => {
    const setUp = setup();
    session = setUp.session;
    await session.logout();
    expect(setUp.client.logout).toHaveBeenCalled();
    expect(session.state).toBe("logged_out");
  });

  it("keeps only the latest media", () => {
    const setUp = setup();
    session = setUp.session;
    for (let index = 0; index <= 100; index++) {
      session.remember(String(index), { mimetype: "image/png", data: "" } as never);
    }
    expect(session.media.size).toBe(100);
    expect(session.media.has("0")).toBe(false);
  });
});
