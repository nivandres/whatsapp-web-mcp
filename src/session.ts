import { EventEmitter } from "node:events";
import type {
  Client as WAClient,
  ClientOptions,
  Message,
  MessageMedia as WAMessageMedia,
} from "whatsapp-web.js";
import type { Config } from "./config.js";
import { serialize } from "./jid.js";
import { freeProfile } from "./profile.js";
import { closeOnSignal } from "./shutdown.js";
import { Client, LATEST_WWEBJS, LocalAuth, WWEBJS_VERSION } from "./wwebjs.js";

export const RECOMMENDED_CHROMIUM_ARGS = [
  "--renderer-process-limit=1",
  "--disable-gpu",
  "--disable-component-update",
];

const CONNECT_TIMEOUT_MS = 120_000;
const SETTLE_TIMEOUT_MS = 30_000;
const WATCHDOG_INTERVAL_MS = 60_000;
const RECONNECT_MIN_MS = 5_000;
const RECONNECT_MAX_MS = 300_000;
const KILL_WAIT_MS = 2_000;
const LOOKUP_TIMEOUT_MS = 5_000;
const MAX_MEDIA = 100;
const OUTDATED = /auth timeout|Waiting failed/;

export type SessionState =
  | "idle"
  | "connecting"
  | "qr"
  | "pairing"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "logged_out"
  | "closed";

export interface SessionStatus {
  state: SessionState;
  qr?: string;
  code?: string;
  account?: { id: string; name: string };
  linkUrl?: string;
  error?: string;
}

const PENDING = new Set<SessionState>(["idle", "connecting", "reconnecting"]);

export class Session extends EventEmitter<{ change: [SessionStatus]; message: [Message] }> {
  readonly client: WAClient;
  readonly media = new Map<string, WAMessageMedia>();
  linkUrl?: string;

  private _state: SessionState = "idle";
  private _qr?: string;
  private _code?: string;
  private _error?: string;
  private _opening: Promise<void> | null = null;
  private _initialized = false;
  private _closed = false;
  private _strikes = 0;
  private _retry?: ReturnType<typeof setTimeout>;
  private _watchdog?: ReturnType<typeof setInterval>;
  private _launch?: AbortController;
  private _unsignal?: () => void;

  constructor(
    readonly config: Config,
    client?: WAClient,
  ) {
    super();
    this.client = client ?? new Client(clientOptions(config));
    this.client.on("qr", (qr) => this._update("qr", { qr }));
    this.client.on("code", (code) => this._update("pairing", { code }));
    this.client.on("ready", () => {
      this._strikes = 0;
      this._update("connected");
    });
    this.client.on("disconnected", (reason) => this._onDisconnected(String(reason)));
    this.client.on("message_create", (message) => this.emit("message", message));
  }

  get state(): SessionState {
    return this._state;
  }

  get status(): SessionStatus {
    const info = this._state === "connected" ? this.client.info : undefined;
    return {
      state: this._state,
      qr: this._qr,
      code: this._code,
      account: info && { id: serialize(info.wid), name: info.pushname },
      linkUrl: this.linkUrl,
      error: this._error,
    };
  }

  require(): WAClient {
    if (this._state !== "connected") {
      throw new Error(`WhatsApp is not linked (${this._state}). Call link_device to link it.`);
    }
    return this.client;
  }

  start(): Promise<void> {
    this._closed = false;
    clearTimeout(this._retry);
    this._retry = undefined;
    this._unsignal ??= closeOnSignal(
      () => this.close(),
      () => void this._killBrowser(),
    );
    this._watch();
    this._opening ??= this._open().catch((error: unknown) => {
      this._opening = null;
      const failure = new Error(describe(error));
      if (!this._closed && this._state !== "logged_out") {
        this._update("disconnected", { error: failure.message });
      }
      throw failure;
    });
    return this._opening;
  }

  async settle(timeoutMs = SETTLE_TIMEOUT_MS): Promise<SessionStatus> {
    if (!PENDING.has(this._state)) return this.status;
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.off("change", onChange);
        resolve(this.status);
      };
      const onChange = ({ state }: SessionStatus) => {
        if (!PENDING.has(state)) done();
      };
      const timer = setTimeout(done, timeoutMs);
      timer.unref();
      this.on("change", onChange);
    });
  }

  async requestPairingCode(phoneNumber: string): Promise<string> {
    if (this._state !== "qr" && this._state !== "pairing") {
      throw new Error(`A pairing code can only be requested while linking (${this._state}).`);
    }
    const code = await this.client.requestPairingCode(phoneNumber.replace(/\D/g, ""));
    this._update("pairing", { code });
    return code;
  }

  async logout(): Promise<void> {
    await this.client.logout();
    this._opening = null;
    this._update("logged_out");
  }

  async close(): Promise<void> {
    this._closed = true;
    clearTimeout(this._retry);
    clearInterval(this._watchdog);
    this._watchdog = undefined;
    this._unsignal?.();
    this._unsignal = undefined;
    this._opening = null;
    this._update("closed");
    await this._destroy();
  }

  remember(id: string, media: WAMessageMedia): void {
    this.media.delete(id);
    this.media.set(id, media);
    if (this.media.size > MAX_MEDIA) this.media.delete(this.media.keys().next().value!);
  }

  private async _open(): Promise<void> {
    this._update(this._initialized ? "reconnecting" : "connecting");
    if (this._initialized) await this._destroy().catch(() => undefined);
    this._initialized = true;
    const options = (this.client as unknown as { options: ClientOptions }).options;
    this._launch = new AbortController();
    options.puppeteer = { ...options.puppeteer, signal: this._launch.signal };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`WhatsApp was not ready within ${CONNECT_TIMEOUT_MS}ms.`)),
        CONNECT_TIMEOUT_MS,
      );
      timer.unref();
    });
    const waiting = () => clearTimeout(timer);
    let onReady!: () => void;
    let onFailure!: (message: string) => void;
    const ready = new Promise<void>((resolve, reject) => {
      onReady = resolve;
      onFailure = (message) => reject(new Error(`WhatsApp authentication failed: ${message}`));
    });
    ready.catch(() => undefined);
    this.client.once("qr", waiting);
    this.client.once("code", waiting);
    this.client.on("ready", onReady);
    this.client.on("auth_failure", onFailure);
    try {
      await Promise.race([
        this.client
          .initialize()
          .catch(async (error: unknown) => {
            if (!(await freeProfile(options.puppeteer?.userDataDir))) throw error;
            await this.client.initialize();
          })
          .then(() => ready),
        timedOut,
      ]);
    } catch (error) {
      await this._destroy().catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
      this.client.off("qr", waiting);
      this.client.off("code", waiting);
      this.client.off("ready", onReady);
      this.client.off("auth_failure", onFailure);
    }
  }

  private _update(
    state: SessionState,
    detail: { qr?: string; code?: string; error?: string } = {},
  ): void {
    this._state = state;
    this._qr = detail.qr;
    this._code = detail.code;
    this._error = detail.error;
    this.emit("change", this.status);
  }

  private _onDisconnected(reason: string): void {
    if (this._closed) return;
    this._opening = null;
    if (reason === "LOGOUT") return this._update("logged_out");
    this._reconnect(RECONNECT_MIN_MS);
  }

  private _reconnect(delayMs: number): void {
    if (this._closed) return;
    clearTimeout(this._retry);
    this._update("reconnecting");
    this._retry = setTimeout(() => {
      this._retry = undefined;
      this.start().catch(() => this._reconnect(Math.min(delayMs * 2, RECONNECT_MAX_MS)));
    }, delayMs);
    this._retry.unref();
  }

  private _watch(): void {
    if (this._watchdog) return;
    this._watchdog = setInterval(() => void this._check(), WATCHDOG_INTERVAL_MS);
    this._watchdog.unref();
  }

  private async _check(): Promise<void> {
    if (this._closed) return;
    if (this._state === "disconnected" && !this._retry) return this._reconnect(RECONNECT_MIN_MS);
    if (this._state !== "connected") return;
    const state = await within(this.client.getState());
    if (state === "CONNECTED") {
      this._strikes = 0;
      return;
    }
    if (++this._strikes < 2) return;
    this._strikes = 0;
    this._onDisconnected(`UNRESPONSIVE (${state ?? "no answer"})`);
  }

  private async _destroy(): Promise<void> {
    try {
      await this.client.destroy();
    } finally {
      await this._killBrowser();
    }
  }

  private _killBrowser(): Promise<unknown> {
    this._launch?.abort();
    const browser = this.client.pupBrowser?.process?.();
    if (!browser?.pid || browser.exitCode !== null || browser.signalCode !== null) {
      return Promise.resolve();
    }
    const exited = new Promise((resolve) => {
      browser.once("exit", resolve);
      setTimeout(resolve, KILL_WAIT_MS).unref();
    });
    try {
      process.kill(process.platform === "win32" ? browser.pid : -browser.pid, "SIGKILL");
    } catch {
      browser.kill("SIGKILL");
    }
    return exited;
  }
}

function clientOptions(config: Config): ClientOptions {
  return {
    authStrategy: new LocalAuth({ dataPath: config.dataDir, clientId: config.clientId }),
    puppeteer: {
      headless: config.headless,
      executablePath: config.executablePath,
      handleSIGHUP: false,
      handleSIGINT: false,
      handleSIGTERM: false,
      args: [...RECOMMENDED_CHROMIUM_ARGS, ...config.chromiumArgs],
    },
    ...(config.phoneNumber && { pairWithPhoneNumber: { phoneNumber: config.phoneNumber } }),
  };
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!OUTDATED.test(message)) return message;
  return `${message}: whatsapp-web.js ${WWEBJS_VERSION} no longer reads WhatsApp Web. Run its latest code with ${LATEST_WWEBJS}`;
}

function within<T>(lookup: Promise<T>): Promise<T | null> {
  return Promise.race([
    lookup.catch(() => null),
    new Promise<null>((resolve) => setTimeout(resolve, LOOKUP_TIMEOUT_MS, null).unref()),
  ]);
}
