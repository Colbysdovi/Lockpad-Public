# Lockpad

Self-hosted, privacy-first note-taking.

- **Organize** with tags, folders, and note-to-note links.
- **Write** in rich text with auto-save.
- **Find** anything with Postgres full-text search.
- **Lock** sensitive notes with per-note end-to-end encryption — encrypted in
  your browser, stored only as ciphertext on the server.

Lockpad runs entirely on your own hardware and makes **zero outbound network
requests**: no analytics, no telemetry, no external CDNs or fonts. Postgres is
never exposed outside the internal network.

Set a login password during install. For secure access from your phone while
away from home, front it with [Tailscale](https://tailscale.com) — see the
[project README](https://github.com/Colbysdovi/Lockpad-Public).
