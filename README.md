# cdp-lite

Minimal Chrome DevTools Protocol CLI for coding agents (and humans). One file, one dependency
(`puppeteer-core`), six commands: `start`, `nav`, `eval`, `screenshot`, `pick`, `cookies`.

Built because agents don't need a full MCP browser-tool surface to debug a web app — they need
a tiny, composable CLI they can call from a shell. Inspired by Mario Zechner's
[What if you don't need MCP at all?](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)
This tool is extracted from a production monorepo, where it is the default way coding agents
inspect running frontends.

## Install

```bash
npm install
# optional: npm link  → gives you a global `cdp-lite` command
```

## Usage

```bash
# Start Chrome with remote debugging on 127.0.0.1:9222 (fresh profile)
cdp-lite start [--profile] [--headless] [--port 9222]

# Navigate the active tab (or open a new one)
cdp-lite nav https://example.com [--new]

# Evaluate JS in the active page (async-aware; objects print as JSON)
cdp-lite eval 'document.title'
cdp-lite eval '[...document.querySelectorAll("a")].map(a => a.href)' --json

# Screenshot the viewport (or full page); prints the file path
cdp-lite screenshot [--full] [--path ./shot.png]

# Interactive DOM picker: hover-highlight, Cmd/Ctrl+Click to multi-select,
# Enter to finish, ESC to cancel. Returns tag/id/class/text/outerHTML/ancestry as JSON.
cdp-lite pick "Select the broken button"

# Dump cookies for the active tab (or a URL)
cdp-lite cookies [--url https://example.com]
```

All commands accept `--port` and `--match-url <substring>` (target a specific tab instead of
the most recent one).

## Why agents like it

- **No MCP server, no config** — plain CLI calls, output on stdout, composes with `jq`/shell.
- **Tiny context cost** — the agent reads this README instead of loading dozens of tool schemas.
- **`pick` closes the loop with humans** — "click the element you mean" beats describing
  selectors in chat.
- **Attaches to your real browser** — point it at an already-running Chrome via
  `CDP_LITE_BROWSER_URL` and the agent sees the logged-in session you see.

## Environment

| Variable | Purpose |
| --- | --- |
| `CHROME_PATH` | Override Chrome executable detection |
| `CDP_LITE_PORT` / `CDP_LITE_HOST` | Default endpoint (`127.0.0.1:9222`) |
| `CDP_LITE_BROWSER_URL` | Full DevTools URL of an already-running Chrome |
| `CDP_LITE_USER_DATA_DIR` | User data dir for `start` |
| `CDP_LITE_PROFILE_SOURCE` | Profile dir copied by `start --profile` |

`start --profile` copies your default Chrome profile into `~/.cache/cdp-lite/profile` so the
debug instance has your cookies/logins without locking your main profile.

## Note

This repository is a read-only mirror, synced from an internal monorepo. Issues and PRs are
welcome — accepted PRs are ported internally and appear here with the next sync commit.

## License

[MIT](./LICENSE)
