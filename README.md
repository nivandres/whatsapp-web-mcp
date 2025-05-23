# WhatsApp Web MCP Server

MCP server for WhatsApp Web. It provides a set of tools to interact with WhatsApp Web programmatically, enabling features like sending messages, managing chats, and handling contacts.

## Features

- **Send Messages**: Send text messages, media, and stickers to specific chats.
- **Manage Contacts**: Retrieve, block, unblock, and get information about contacts.
- **Manage Chats**: Archive, unarchive, pin, unpin, mute, and unmute chats.
- **Fetch Messages**: Load chat messages sorted from earliest to latest.

## Usage

`git clone https://github.com/nivandres/whatsapp-web-mcp.git`

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "bun",
      "args": ["run", "index.ts"]
    }
  }
}
```

## Acknowledgements

This project relies on the amazing library [`whatsapp-web.js`](https://wwebjs.dev/) developed by [pedroslopez](https://github.com/pedroslopez). It provides a powerful and easy-to-use interface for interacting with WhatsApp Web.
