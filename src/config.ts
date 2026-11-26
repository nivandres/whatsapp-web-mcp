import { z } from "zod";

const EnvSchema = z.object({
  DATA_DIR: z.string().default(".wwebjs_auth"),
  CLIENT_ID: z.string().optional(),
  PHONE_NUMBER: z
    .string()
    .regex(/^\d{7,15}$/, "PHONE_NUMBER is E.164 without the leading +")
    .optional(),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(0).optional(),
  AUTH_TOKEN: z.string().min(16).optional(),
  HEADLESS: z.stringbool().default(true),
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),
  CHROMIUM_ARGS: z.string().optional(),
  MAX_MEDIA_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(64 * 1024 * 1024),
});

export const COMMANDS = ["stdio", "http", "login"] as const;

export type Command = (typeof COMMANDS)[number];

export type Config = ReturnType<typeof parseConfig>;

export function parseConfig(env: Record<string, string | undefined>, command: Command = "stdio") {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  const { data } = parsed;
  return {
    command,
    dataDir: data.DATA_DIR,
    clientId: data.CLIENT_ID,
    phoneNumber: data.PHONE_NUMBER,
    host: data.HOST,
    port: data.PORT ?? (command === "http" ? 3000 : 0),
    authToken: data.AUTH_TOKEN,
    headless: data.HEADLESS,
    executablePath: data.PUPPETEER_EXECUTABLE_PATH,
    chromiumArgs: data.CHROMIUM_ARGS?.split(" ").filter(Boolean) ?? [],
    maxMediaBytes: data.MAX_MEDIA_BYTES,
  };
}

export function parseCommand(argv: string[]): Command {
  const [command = "stdio"] = argv;
  if (!COMMANDS.includes(command as Command)) {
    throw new Error(`Unknown command "${command}". Use one of: ${COMMANDS.join(", ")}.`);
  }
  return command as Command;
}
