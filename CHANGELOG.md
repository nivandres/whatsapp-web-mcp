# whatsapp-web-mcp

## 2.0.0

### Added

- Linking from the agent: `link_device` returns the QR as an image to show, or with `phoneNumber` a pairing code, and opens a live QR page in clients that take URL elicitations. The page, the `login` command and the server's log offer the same QR, and the session opens on start without blocking any tool.
- Streamable HTTP with `whatsapp-web-mcp http`, beside stdio, with sessions, DNS-rebinding protection on loopback and an optional `AUTH_TOKEN`.
- Structured output and annotations on every tool, resource templates with listing and completion, subscriptions to the session and to chats, prompts (`summarize_chat`, `draft_reply`, `catch_up`) and log notifications of the session's state.
- Messages: locations, polls and votes, replies, reactions, edits, deletes, forwards, stars, pins, receipts and reactions read back. Chats: read and unread marks, typing, history sync, clearing and deleting. Contacts: number checks. Groups: details, settings, participants, invites and membership requests. Labels and channels.
- Configuration from the environment: `DATA_DIR`, `CLIENT_ID`, `PHONE_NUMBER`, `HOST`, `PORT`, `HEADLESS`, `PUPPETEER_EXECUTABLE_PATH`, `CHROMIUM_ARGS` and `MAX_MEDIA_BYTES`.
- A session that drops is reopened with backoff, one that stops answering is noticed within two minutes, a signal closes the browser before the process ends, even when it comes again as Ctrl+C under `npx` sends it, and a browser a killed process left holding the profile is ended on the next start.

### Changed

- whatsapp-web.js is a peer dependency, `^1.34.8`, so you pick the copy that runs: a release, pedroslopez's `main` or a commit. The README installs `38eb45b`, the commit it is tested against, which reads WhatsApp Web since it dropped the module 1.34.8 waits for. `get_info` and the first log line name the version, and a copy that no longer reads WhatsApp Web is reported with the command for the latest `main`.
- Runs on the MCP SDK 1.32, built for Node 20 and later; the binary is `whatsapp-web-mcp`.
- `send_message` takes `text`, `mediaId`, `location` or `poll` and its options at the top level, and returns the message structured.
- Lists page with `limit` and `offset` and filter with `query`; `get_profile_picture` replaces `get_contact_profile_pic_url`.
- The Docker image runs Streamable HTTP with the system's Chromium as an unprivileged user, keeping the session in `/data`, and takes the whatsapp-web.js to install as the `WWEBJS` build argument.

### Fixed

- Chats and contacts not yet cached were never found, and messages had to have been seen by the server: they are now looked up in WhatsApp every time.
- `get_blocked_contacts` returned an invalid result, `delete_profile_picture` reported success before it happened, and media resources were addressed by file name.
