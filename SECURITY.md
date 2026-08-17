# Security Policy

Lockpad handles personal notes, including end-to-end encrypted ones, so security reports are taken seriously and reviewed promptly.

## A note on my background

I'm a designer with basic knowledge in development — that's actually a main reason I'm building Lockpad with heavy use of AI coding assistance (Claude) in the first place. I'm actively working to understand the codebase better and become less ignorant of it over time, but please don't assume I have the same level of security or development knowledge you do when you write in. A plain-language explanation of the impact and how to reproduce it will get you a faster, more useful response than technical shorthand alone. I'll ask questions if I need to — thanks in advance for your patience.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities. Instead, email **applockpad@gmail.com** (or, if that's unreachable, open a [private security advisory](../../security/advisories/new) on this repository) with:

- A description of the issue and its potential impact.
- Steps to reproduce, including your deployment method (curl script / CasaOS / Umbrel / Runtipi / manual Docker Compose) if relevant.
- Any proof-of-concept code or screenshots, if applicable.

You should receive an acknowledgment within **5 business days**. From there, expect updates at least every 7 days while the issue is triaged and fixed. Please give a reasonable amount of time to address the issue before any public disclosure.

## Supported versions

Lockpad is a single, actively-developed self-hosted release — there's no separate LTS branch. Security fixes land on `main` and the latest tagged release. Running the current release (and pulling updates when they're announced) is the only supported configuration.

## Scope

In scope: the application itself (`backend/`, `frontend/`), the install script, and the app-store manifests in `packaging/`.

Out of scope: vulnerabilities that require an attacker to already have Tailscale access to your tailnet, or physical/root access to the host machine — Lockpad's threat model assumes the tailnet boundary and host are trusted, consistent with the [Privacy guarantees](README.md#privacy-guarantees) in the README.

## A note on this app's design

Lockpad makes zero outbound network requests by default and stores no data outside your own infrastructure. There is no vendor-side database of user data to breach — the security surface is your deployment, the app itself, and its dependencies. Bug reports about the encryption implementation, session handling, or dependency vulnerabilities (`npm audit` findings, etc.) are all welcome.
