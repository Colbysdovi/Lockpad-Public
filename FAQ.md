# Questions, and what to do when something breaks

Two halves. The first explains the one concept most people get stuck on. The second is
the list of things that actually go wrong.

- [What is Tailscale, and do I need it?](#what-is-tailscale-and-do-i-need-it)
- [If something goes wrong](#if-something-goes-wrong)
  - [The page will not load](#the-page-will-not-load)
  - [I forgot my password](#i-forgot-my-password)
  - [Why can't I lock a note?](#why-cant-i-lock-a-note)
  - [How do I back up my notes?](#how-do-i-back-up-my-notes)
  - [How do I update?](#how-do-i-update)
- [Everything else](#everything-else)

---

## What is Tailscale, and do I need it?

**Short answer:** you need it if you want your notes when you are away from home. If
Lockpad will only ever be used on your own wifi, skip it.

Here is the problem it solves. Lockpad is running on a machine in your house. Your phone,
when you are out, is not in your house. The traditional way to bridge that gap is *port
forwarding*: telling your home router to let traffic from the internet through to that
machine. The trouble is that the opening you make is open to everyone, not only to you —
it is the part of self-hosting that goes wrong most often, and it is why so much
self-hosted software ends up in someone's breach report.

Tailscale skips the opening entirely. It builds a small private network — Tailscale calls
it a *tailnet* — that only devices you have signed in can join. Your phone then talks to
the machine at home directly, as though both were sitting on your home wifi, wherever you
actually are. Nothing about Lockpad is published to the internet. There is no address
anyone else could visit, because there is no public address at all.

It is free for personal use, and setup is: make an account, install Tailscale on the
machine running Lockpad, install it on your phone and laptop, sign all of them into the
same account.

### The two words that matter: serve, not funnel

Tailscale has two ways to put a web app on an address.

- **`serve`** publishes it *to your tailnet only* — your devices, nobody else's.
- **`funnel`** publishes it *to the whole internet*.

Lockpad uses `serve`, and only `serve`. That is not a default that could drift; it is
what makes the privacy claim true rather than aspirational. If you ever see `funnel` in a
Lockpad instruction, something is wrong.

### The connection does not depend on Tailscale staying up

Worth knowing, because "I've added a dependency on someone else's service" is a fair
worry. Tailscale is a *coordination* service: it introduces your devices to each other
and then steps out of the way. Once two of your machines have been introduced, they talk
directly, and on your home network that means peer-to-peer over your own LAN. You can
check it yourself:

```bash
tailscale status     # the lockpad line should say "direct", not "relay"
```

So a Tailscale outage does not cut off a connection that already works. What it stops is
adding *new* devices, rotating keys and renewing certificates. [DEPLOY.md §8](DEPLOY.md)
covers the failure modes one at a time, including the one that genuinely will lock you out
if you ignore it: **node key expiry**. Disable key expiry on the Lockpad machine in the
Tailscale admin console, or in a few months you will find yourself shut out for no visible
reason.

### Tightening it further, optional

Lockpad ships an example Tailscale ACL that restricts access to devices you have tagged,
rather than every device on your tailnet. If you share a tailnet with family, this is
worth doing. See the Tailscale section of [DEPLOY.md](DEPLOY.md).

---

## If something goes wrong

### The page will not load

In order, because each rules out the next:

1. **Is the machine on and awake?** A NAS that has gone to sleep is the most common
   answer, and the least interesting.
2. **Is Docker running Lockpad?** On the machine, in the directory you installed into:
   ```bash
   docker compose ps
   ```
   All three of `postgres`, `backend` and `frontend` should say `running`. If one does
   not:
   ```bash
   docker compose logs -f
   ```
3. **If you are using the `.ts.net` address, is Tailscale switched on on the device you
   are browsing from?** This catches more cases than it should. Both devices need to show
   as connected.
4. **Is the app itself healthy?** From the machine running it:
   ```bash
   docker compose exec backend wget -qO- http://localhost:4000/api/health
   ```
   A JSON response means the app is fine and the problem is between you and it — network,
   Tailscale, or the address you typed. [DEPLOY.md §6](DEPLOY.md) has the fuller set of
   checks, including the one worth learning: **check from a different device, not from the
   machine itself.** A machine can reach itself perfectly while being unreachable from
   everywhere else, and that failure looks exactly like everything working.

### I forgot my password

The honest answer is not a good one, and finding it out later is worse.

**There is no reset link and no recovery email**, because there is no company holding a
copy of anything. That is the same property that means nobody can read your notes without
your permission; it cuts both ways.

**For the app's login password:** you can set a new one. On the machine running Lockpad,
edit `APP_PASSWORD` in the `.env` file, then restart:

```bash
docker compose up -d
```

You are back in, and no notes are lost — the login password protects the app, it does not
encrypt anything.

**For a note you locked with its own passphrase: it is gone.** Not "gone unless you ask
support" — genuinely unrecoverable. The note's contents are encrypted with a key derived
from that passphrase and nothing else, and the server never had it. This is the feature
working correctly, which is cold comfort. Put note passphrases in your password manager.

### Why can't I lock a note?

Almost certainly because you are reading the app over plain `http://`.

Browsers only hand out the cryptography Lockpad needs — the Web Crypto API — over a
*secure context*, meaning HTTPS or `localhost`. Over `http://<some-ip>` that API simply is
not there, so there is nothing for the lock button to encrypt with. Lockpad cannot work
around this, and would not want to: the alternative would be encrypting somewhere less
safe.

Two ways to get a secure context, either of which fixes it:

- **Tailscale**, which serves the app over HTTPS on your tailnet — see above.
- **HTTPS on your own network** with your own certificate, in
  [DEPLOY.md §9](DEPLOY.md).

This is also why the install offers those two paths rather than plain HTTP over the LAN.

### How do I back up my notes?

Nobody else is holding a copy. That is the point, and it is also the catch: this one is
genuinely yours to do.

Two ways, and they are for different things.

**From inside the app — Settings → Data → Export all notes.** One file containing every
note (active, archived and in the trash), your folders, your tags, the links between notes,
and every picture embedded inside the file itself rather than linked back to the server.
That last detail is what makes it a real backup: it still opens on a different machine,
after the disaster it exists for. Notes you have locked are *not* in it, and the file lists
which ones it skipped, because their contents cannot be read without their passphrases.

**From the machine — the included script**, which dumps the whole database:

```bash
./scripts/backup.sh          # writes backups/lockpad-<timestamp>.sql.gz
```

Restore with `./scripts/restore.sh backups/lockpad-<timestamp>.sql.gz`.

Run it nightly rather than remembering to. On Linux or a NAS task scheduler:

```
30 2 * * *  /path/to/Lockpad/scripts/backup.sh >> /var/log/lockpad/backup.log 2>&1
```

Then copy those files somewhere that is not the same machine. A backup that lives only on
the disk that dies with it is not a backup.

### How do I update?

**Export your notes first** (Settings → Data). Every time. It takes ten seconds and it is
the difference between a bad update being an annoyance and being a loss.

**If you installed with the script or from source**, in the install directory:

```bash
docker compose pull && docker compose up -d
```

**If you installed through CasaOS, Umbrel or Runtipi**, use the platform's own update
button.

Database migrations run themselves when the app starts. There is no separate migration
command to remember, and if you find an instruction telling you to run one, it is out of
date.

**Settings → About** shows which version you are running and links to what changed.
[CHANGELOG.md](CHANGELOG.md) is the same information in this repository.

---

## Everything else

**Can I use it on my phone?** Yes, in the phone's browser, over Tailscale or on your home
network. There is no native app. Lockpad ships a web manifest, so you can add it to your
home screen and it opens without browser chrome, which is close enough that most people
stop noticing.

**Can other people in my house have their own notes?** No. Lockpad is single-user by
design: one password for the whole app, and anyone with it sees every unlocked note.
Locking individual notes with their own passphrases is the only per-note privacy there is.
If you need separate accounts, Lockpad is the wrong app, and that is better to know now.

**Do I lose my notes if I restart, or rebuild the containers?** No. They live in a Docker
volume that survives both. `docker compose down` is safe; the only thing that deletes data
is deliberately removing the volume.

**How do I move Lockpad to another machine?** Back up on the old one, install on the new
one, restore. Both scripts are in `scripts/`. Nothing is tied to the hardware.

**Does it run on a Raspberry Pi, or an ARM NAS?** The published images are built for both
`arm64` and `amd64`, so there is no architecture reason it should not. Being straight with
you: **nobody has actually run it on ARM hardware and confirmed it.** It is expected to
work, not known to. If you try it, saying so in an issue would be genuinely useful.

**Does it phone home, ever?** No. No analytics, no telemetry, no error reporting, no
externally-hosted fonts or scripts, no update check. "Check for updates" in Settings is a
link your own browser follows — the server is not involved and makes no request of its own.

**Is my data encrypted?** Notes you explicitly lock are, in your browser, before they are
sent anywhere: AES-GCM-256 with a key derived from your passphrase by PBKDF2-SHA-256 at
600,000 iterations. The server stores the ciphertext and never sees the passphrase.
Everything else is stored as ordinary rows in a Postgres database on your own machine —
protected by the fact that it is your machine, not by encryption. If you want a note
cryptographically private, lock it.

**Where do I report a security problem?** [SECURITY.md](SECURITY.md), not a public issue.
