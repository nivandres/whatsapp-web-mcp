# whatsapp-web-mcp

> npm package: [`whatsapp-web-mcp`](https://www.npmjs.com/package/whatsapp-web-mcp)

[![npm version](https://img.shields.io/npm/v/whatsapp-web-mcp?style=flat-square&logo=npm&logoColor=white&labelColor=000&color=000)](https://www.npmjs.com/package/whatsapp-web-mcp)
[![npm downloads](https://img.shields.io/npm/dm/whatsapp-web-mcp?style=flat-square&labelColor=000&color=000)](https://www.npmjs.com/package/whatsapp-web-mcp)
[![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](./LICENSE)

[Model Context Protocol](https://modelcontextprotocol.io) server for WhatsApp, backed by [whatsapp-web.js](https://wwebjs.dev). It links to an ordinary WhatsApp account as a device, so an agent can read and send messages, manage chats, contacts, groups, labels and channels, and link the account itself by showing you a QR.

> [!WARNING]
> whatsapp-web.js drives WhatsApp Web in a real browser. It is not an official
> WhatsApp or Meta API, it can break when WhatsApp changes its web client, and
> WhatsApp may ban numbers that automate an ordinary account. Evaluate that
> before pointing an agent at an account that matters.

## Quick start

Add it to your MCP client, then ask the agent to **link WhatsApp**: it shows you a QR to scan from WhatsApp → **Linked devices** → **Link a device**. The session is stored, so you scan once.

### Claude Code

```bash
claude mcp add whatsapp -- npx -y -p whatsapp-web-mcp -p github:pedroslopez/whatsapp-web.js#38eb45b2759450cc6fccb6a7a3f2cbc3bdb87db2 whatsapp-web-mcp
```

### Claude Desktop, Cursor and others

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "npx",
      "args": [
        "-y",
        "-p",
        "whatsapp-web-mcp",
        "-p",
        "github:pedroslopez/whatsapp-web.js#38eb45b2759450cc6fccb6a7a3f2cbc3bdb87db2",
        "whatsapp-web-mcp"
      ]
    }
  }
}
```

### VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "whatsapp": {
      "command": "npx",
      "args": [
        "-y",
        "-p",
        "whatsapp-web-mcp",
        "-p",
        "github:pedroslopez/whatsapp-web.js#38eb45b2759450cc6fccb6a7a3f2cbc3bdb87db2",
        "whatsapp-web-mcp"
      ]
    }
  }
}
```

Node >= 20. Puppeteer downloads a Chromium build on install; set `PUPPETEER_EXECUTABLE_PATH` to use a browser you have instead.

## Choosing whatsapp-web.js

`whatsapp-web.js` is a peer dependency, so you pick the copy that runs. WhatsApp changes its web client often and whatsapp-web.js releases lag behind, so the commands above install the commit this server is tested against, `38eb45b` on [pedroslopez's `main`](https://github.com/pedroslopez/whatsapp-web.js). Every `-p` installs into the same place, and the server uses that copy.

| You want                   | Run                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| The tested commit          | `npx -y -p whatsapp-web-mcp -p github:pedroslopez/whatsapp-web.js#38eb45b2759450cc6fccb6a7a3f2cbc3bdb87db2 whatsapp-web-mcp`                        |
| The latest `main`          | `npx -y -p whatsapp-web-mcp -p github:pedroslopez/whatsapp-web.js whatsapp-web-mcp`                                                                 |
| The latest release on npm  | `npx -y whatsapp-web-mcp`, which installs the peer for you                                                                                          |
| A copy pinned in a project | `npm i whatsapp-web-mcp github:pedroslopez/whatsapp-web.js#38eb45b2759450cc6fccb6a7a3f2cbc3bdb87db2`, then run `node_modules/.bin/whatsapp-web-mcp` |

The same arguments go before `login`, such as `npx -y -p whatsapp-web-mcp -p github:pedroslopez/whatsapp-web.js#38eb45b2759450cc6fccb6a7a3f2cbc3bdb87db2 whatsapp-web-mcp login`. `get_info` and the server's first log line say which version runs, and when it no longer reads WhatsApp Web, `client_status` and `link_device` say so with the command for the latest `main`.

Installing from GitHub needs git, and a full commit SHA, as above, downloads over HTTPS without a GitHub SSH key. Puppeteer downloads Chromium in an install script, which recent package managers run only when allowed: on npm 11, `npm approve-scripts puppeteer`; on pnpm 10, `whatsapp-web.js` and `puppeteer` in `onlyBuiltDependencies`; on bun, `puppeteer` in `trustedDependencies`. Or skip the download and set `PUPPETEER_EXECUTABLE_PATH` to a Chrome you have, or install one with `npx puppeteer browsers install chrome`.

## Linking the account

The server opens the session as soon as it starts and never waits on it: tools answer at once, and the QR is offered every way at the same time. Use whichever is closest.

| Way                 | How                                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| From the agent      | `link_device` returns the QR as an image the agent shows you. Clients that take [URL elicitations](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation) also open the live page for you. |
| A pairing code      | `link_device` with `phoneNumber`, or the `PHONE_NUMBER` variable, returns an 8-character code to enter under **Link with phone number instead**. No camera needed.                                               |
| The live page       | A local page with the QR, which refreshes on its own and says when you are linked. Its URL is in `link_device`, `client_status`, the `whatsapp://session` resource and the server's log.                         |
| The terminal        | The `login` command prints the QR, waits for the scan, stores the session and exits. The server also prints each QR to its log (stderr).                                                                         |
| Following the state | Subscribe to `whatsapp://session` to hear of every QR and state change, or read the `notifications/message` log the server sends.                                                                                |

Linking again after `logout`, or after unlinking the device on the phone, works the same way.

## Commands

| Command                  | What it does                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whatsapp-web-mcp`       | MCP over stdio, for clients that start the server themselves. The live page listens on a free port.                                                  |
| `whatsapp-web-mcp http`  | MCP over [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) at `/mcp`, the live page at `/`, on port 3000. |
| `whatsapp-web-mcp login` | Link the account in the terminal and exit.                                                                                                           |

A Streamable HTTP client connects with:

```json
{
  "mcpServers": {
    "whatsapp": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer <AUTH_TOKEN>" }
    }
  }
}
```

## Configuration

All settings come from the environment.

| Variable                    | Default                             | Description                                                                                                                                                |
| --------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA_DIR`                  | `.wwebjs_auth`                      | Where the session is stored. It signs in as your WhatsApp account: keep it out of version control.                                                         |
| `CLIENT_ID`                 | —                                   | Name of the session inside `DATA_DIR`, to keep several accounts apart.                                                                                     |
| `PHONE_NUMBER`              | —                                   | Link with a pairing code instead of a QR. E.164 without the leading `+`, such as `15551234567`.                                                            |
| `HOST`                      | `127.0.0.1`                         | Address the HTTP server and the live page listen on.                                                                                                       |
| `PORT`                      | `3000` with `http`, a free one else | Port they listen on.                                                                                                                                       |
| `AUTH_TOKEN`                | —                                   | At least 16 characters. When set, `/mcp` needs `Authorization: Bearer <token>` and the live page `?token=<token>`. Set it whenever `HOST` is not loopback. |
| `HEADLESS`                  | `true`                              | `false` shows the browser, which helps when something goes wrong.                                                                                          |
| `PUPPETEER_EXECUTABLE_PATH` | Puppeteer's Chromium                | The browser to run.                                                                                                                                        |
| `CHROMIUM_ARGS`             | —                                   | Extra Chromium flags, space-separated, such as `--no-sandbox` when running as root. They come after `RECOMMENDED_CHROMIUM_ARGS`.                           |
| `MAX_MEDIA_BYTES`           | 64 MB                               | Largest media loaded into memory, created or downloaded.                                                                                                   |

Chats, contacts and groups take an ID such as `15551234567@c.us` (a person) or `123456789-987654321@g.us` (a group), or a phone number with its country code.

## MCP support

| Feature                | Supported                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| Tools                  | Yes, 74 with titles, annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) and output schemas   |
| Structured content     | Yes, alongside the same JSON as text, and `resource_link`s to the resources below                           |
| Resources              | Yes, `whatsapp://session` and templates for chats, a chat's messages, contacts, messages and media          |
| Resource subscriptions | Yes, `resources/updated` for the session and for a chat when a message arrives in it                        |
| Prompts                | Yes, `summarize_chat`, `draft_reply` and `catch_up`, with the conversation embedded                         |
| Completions            | Yes, chat IDs and names in prompts and resource templates                                                   |
| Logging                | Yes, session changes as `notifications/message`, honoring `logging/setLevel`                                |
| Elicitation            | Yes, URL mode to open the live QR page                                                                      |
| Images                 | Yes, the QR as `image/png`; downloaded media as embedded blobs                                              |
| Transports             | stdio and Streamable HTTP, with sessions, DNS-rebinding protection on loopback and an optional bearer token |

### Tools

| Area     | Tools                                                                                                                                                                                                                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session  | `link_device` · `client_status` · `get_info` · `logout`                                                                                                                                                                                                                                                                                                    |
| Messages | `send_message` (text, media, location, poll) · `get_message` · `get_quoted_message` · `fetch_messages` · `search_messages` · `react_message` · `edit_message` · `delete_message` · `forward_message` · `star_message` · `unstar_message` · `pin_message` · `unpin_message` · `get_message_info` · `get_message_reactions` · `get_poll_votes` · `vote_poll` |
| Chats    | `get_chats` · `get_chat` · `get_pinned_messages` · `archive_chat` · `unarchive_chat` · `pin_chat` · `unpin_chat` · `mute_chat` · `unmute_chat` · `mark_chat_read` · `mark_chat_unread` · `send_chat_state` · `sync_chat_history` · `clear_chat` · `delete_chat`                                                                                            |
| Contacts | `get_contacts` · `get_contact` · `get_contact_about` · `get_contact_common_groups` · `get_profile_picture` · `check_number` · `get_blocked_contacts` · `block_contact` · `unblock_contact`                                                                                                                                                                 |
| Groups   | `create_group` · `get_group` · `update_group` · `add_participants` · `remove_participants` · `promote_participants` · `demote_participants` · `get_group_invite` · `revoke_group_invite` · `get_invite_info` · `join_group` · `leave_group` · `get_membership_requests` · `answer_membership_requests`                                                     |
| Media    | `create_message_media` (base64, file or URL) · `download_message_media`                                                                                                                                                                                                                                                                                    |
| Profile  | `set_display_name` · `set_status` · `set_profile_picture` · `delete_profile_picture` · `set_presence`                                                                                                                                                                                                                                                      |
| Labels   | `get_labels` · `get_chat_labels` · `get_chats_by_label` · `set_chat_labels` (WhatsApp Business)                                                                                                                                                                                                                                                            |
| Channels | `get_channels` · `search_channels` · `subscribe_channel` · `unsubscribe_channel`                                                                                                                                                                                                                                                                           |

To send a file, load it with `create_message_media` and pass the media ID it returns to `send_message`.

### Resources

| URI                                  | Content                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| `whatsapp://session`                 | State, QR or pairing code while linking, the live page's URL. |
| `whatsapp://chats/{chatId}`          | A chat and its latest message. Listing gives the recent 50.   |
| `whatsapp://chats/{chatId}/messages` | The chat's latest 50 messages, oldest first.                  |
| `whatsapp://contacts/{contactId}`    | A contact.                                                    |
| `whatsapp://messages/{messageId}`    | A message.                                                    |
| `whatsapp://media/{mediaId}`         | Media created or downloaded in this session, as a blob.       |

## Keeping the session alive

The server reopens a session WhatsApp drops, backing off from 5 seconds to 5 minutes, and asks WhatsApp every minute whether it still answers, two silent checks counting as a drop. A logout is never retried: link again. A signal closes the browser before the process ends, and a browser left behind by a process killed outright is ended on the next start, when it runs on the same host and profile.

## Docker

```bash
AUTH_TOKEN=$(openssl rand -hex 16) docker compose up -d
docker compose logs -f   # the QR and the live page's URL
```

The image runs Streamable HTTP on port 3000 with the system's Chromium, as the unprivileged `bun` user, and keeps the session in the `/data` volume. It installs the tested whatsapp-web.js; pick another with the `WWEBJS` build argument, which `docker-compose.yml` reads from the environment:

```bash
docker build --build-arg WWEBJS=github:pedroslopez/whatsapp-web.js -t whatsapp-web-mcp .
```

For stdio, run it interactively:

```bash
docker run -i --rm -v whatsapp:/data whatsapp-web-mcp stdio
```

## Troubleshooting

### The QR never appears

- Run with `HEADLESS=false` to watch the browser, or check that Chromium starts: slim Linux images need its shared libraries.
- "Could not find Chrome" means Puppeteer's install script did not run. Install it with `npx puppeteer browsers install chrome`, or set `PUPPETEER_EXECUTABLE_PATH`.
- `auth timeout` or `Waiting failed` means the installed whatsapp-web.js no longer understands WhatsApp Web, which WhatsApp changes often. Run the latest `main`, as in [Choosing whatsapp-web.js](#choosing-whatsapp-webjs).

### "The browser is already running"

- Another process holds the same `DATA_DIR` and `CLIENT_ID`. Give each process its own.
- A lock left by another host, such as a container recreated with a new hostname, is never cleared. Give the container a fixed `hostname`, as `docker-compose.yml` does.

### The session drops

- `client_status` turns `reconnecting` while the server reopens it. `logged_out` means the device was unlinked on the phone: link again.

## Development

```bash
bun install
bun run check   # typecheck, lint, format and tests
bun run build
npx @modelcontextprotocol/inspector node dist/index.js
```

## Limitations

- **Unofficial.** It automates WhatsApp Web, which WhatsApp may block or change at any time.
- **One session per number**, as WhatsApp Web itself allows.
- **History is what the web client synced.** `fetch_messages` reads up to 1,000 messages; `sync_chat_history` asks the phone for older ones.
- **Media lives in memory** for the session, the latest 100 items.

## Acknowledgements

Built on [whatsapp-web.js](https://wwebjs.dev) by [pedroslopez](https://github.com/pedroslopez).

## License

MIT
