export const LINK_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link WhatsApp</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f8; --fg: #111b21; --muted: #667781; --card: #fff; --accent: #25d366; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0b141a; --fg: #e9edef; --muted: #8696a0; --card: #111b21; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
  main { width: min(420px, calc(100vw - 32px)); padding: 32px; border-radius: 16px; background: var(--card); text-align: center; box-shadow: 0 1px 3px #0002; }
  h1 { margin: 0 0 8px; font-size: 1.4rem; }
  p { margin: 8px 0; color: var(--muted); }
  #qr svg { width: 100%; height: auto; margin: 16px 0; background: #fff; border-radius: 8px; }
  #code { margin: 24px 0; font: 600 2rem/1 ui-monospace, monospace; letter-spacing: .2em; }
  .ok { color: var(--accent); font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>Link WhatsApp</h1>
  <p id="steps">Starting the session…</p>
  <div id="qr"></div>
  <div id="code"></div>
  <p id="hint"></p>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const show = ({ state, qr, code, account }) => {
    $("qr").innerHTML = qr ?? "";
    $("code").textContent = code ?? "";
    $("hint").textContent = qr ? "The code refreshes on its own." : "";
    if (state === "connected") {
      $("steps").innerHTML = '<span class="ok">Linked' + (account ? " as " + account.name : "") + ".</span> You can close this page.";
    } else if (code) {
      $("steps").textContent = "On the phone: WhatsApp → Linked devices → Link a device → Link with phone number instead, then enter this code.";
    } else if (qr) {
      $("steps").textContent = "On the phone: WhatsApp → Linked devices → Link a device, then scan this code.";
    } else {
      $("steps").textContent = state === "logged_out" ? "Logged out. Ask the agent to link WhatsApp again." : "Starting the session…";
    }
  };
  const poll = () =>
    fetch("state.json" + location.search)
      .then((response) => response.json())
      .then(show)
      .catch(() => undefined)
      .finally(() => setTimeout(poll, 2000));
  poll();
</script>
</body>
</html>
`;
