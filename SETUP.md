# 📦 Setting up Lockpad

Lockpad runs on a computer you own — a NAS, a mini PC, an old laptop, a Raspberry Pi.
This guide is written for someone who has never opened a terminal, and says what each
step does rather than only what to type.

Most people are done in about ten minutes.

If something goes wrong, or a word here is unfamiliar, [FAQ.md](FAQ.md) answers the
questions that come up most.

---

## 🧰 What you need first

**A computer that stays on.** Your notes live there instead of in someone's cloud, so it
has to be awake when you want them. A NAS or mini PC is ideal. Your everyday laptop works
too, but your notes are only reachable while it is running.

**Docker.** Most home-server operating systems already have it. If yours does not, the
install script checks for it and tells you what is missing before it changes anything.

**A Tailscale account, if you want your notes away from home.** Free for personal use, and
[FAQ.md](FAQ.md#-what-is-tailscale-and-do-i-need-it) explains what it is and why Lockpad
uses it. Skip it if the app will only ever be used on your home network.

One more thing worth knowing before you start: **Lockpad is a single-person app.** There is
one password for the whole thing and no user accounts. Anyone with that password sees every
unlocked note.

---

## 🧭 Which path to take

| If you want… | Use |
| --- | --- |
| To be running in a few minutes | [The install script](#-1-the-install-script) |
| To compile it yourself rather than pull ready-made images | [From source](#-2-from-source) |

Both end up in the same place. The difference is whether the images are pulled or built
on your own machine.

---

## 🚀 1. The install script

One command. It fetches what it needs, invents its own database password and session
secret so you never have to, asks you two questions, and starts the app.

```bash
curl -fsSL https://raw.githubusercontent.com/Colbysdovi/Lockpad-Public/main/install.sh | bash
```

### ❓ What it asks you

**"Set a login password for the app."** This is the one password that unlocks Lockpad.
Pick something long and put it in your password manager now. There is no reset link and no
recovery email, because there is no company on the other end to send one — see
[FAQ.md](FAQ.md#-i-forgot-my-password). You can leave it blank, and the script will warn you
that anyone who can reach the address can read your notes.

**"Where should Lockpad listen?"**

- **1) This computer only** — reachable at `http://localhost:5173`, from this machine and
  nowhere else. The recommended answer, and the right one if you are going to add
  Tailscale next.
- **2) Everyone on my local network** — reachable at `http://<this-machine-ip>:5173` from
  any device on your home wifi.

If you pick 2 *and* leave the password blank, the script stops to tell you that everyone on
your network can read and edit everything. That combination is fine on a network only you
use; it just should not be a surprise.

### 📱 Question 3: reach it from your phone?

Optional, and the only one you can answer later without re-installing anything —
re-run the installer any time and it asks again.

Say yes and it sets up [Tailscale](FAQ.md#-what-is-tailscale-and-do-i-need-it) for you:
a small private network only your own devices can join, so your phone reaches the
machine at home without anything being exposed to the internet. The one thing the
script cannot invent is an **auth key**, which is what lets this machine join *your*
network and nobody else's — it points you at
[login.tailscale.com](https://login.tailscale.com/admin/settings/keys) to generate one,
and a single-use key is enough.

From there it does the rest: brings up the Tailscale container, waits for it to join,
and prints the `https://…ts.net` address alongside your local one.

Say no — or press Enter — and nothing about the install changes.

> If the key has expired or was already used, the script tells you, leaves your notes
> running and reachable exactly as they were, and clears the bad key so you can re-run
> and try another. An optional extra is never allowed to cost you the app itself.

### ✅ When it finishes

It prints the address to open, and the three commands worth keeping: how to watch the logs,
how to stop it, and how to update. Open the address and you are in.

> **Screenshots for this section have not been taken yet.** The steps are accurate; there
> are no pictures of them.

---

## 🧱 2. From source

For anyone who would rather compile it and read the code on the way past. This path builds
the images locally instead of pulling them, so it does not depend on the published images
at all.

```bash
git clone https://github.com/Colbysdovi/Lockpad-Public.git
cd Lockpad-Public
cp .env.example .env
```

Then open `.env` and set `POSTGRES_PASSWORD` to a long random string, put the same string
into `DATABASE_URL`, set `APP_PASSWORD` to the password you want to log in with, and set
`SESSION_SECRET` to the output of `openssl rand -hex 32`. Every variable is documented in
the file itself. After that:

```bash
docker compose up -d --build
```

[DEPLOY.md](DEPLOY.md) is the full version of this path, and is the source of truth when
it and this guide disagree.

---

## 📱 Reaching your notes from your phone

Two options, and they are not exclusive.

**Tailscale** — a small private network only your own devices can join, so your phone
reaches the machine at home without anything being exposed to the internet. This is the
usual answer, and [FAQ.md](FAQ.md#-what-is-tailscale-and-do-i-need-it) explains it properly.
If you installed with the script, just re-run it and say yes to
[question 3](#-question-3-reach-it-from-your-phone) — it does the whole setup. Doing it by
hand, or from a source build, is [DEPLOY.md §3](DEPLOY.md).

**HTTPS on your own network**, with your own certificate — no Tailscale client needed on
each device, but it only works at home. [DEPLOY.md §9](DEPLOY.md) covers it.

One of these two is worth doing even if you never leave the house, because **locking
individual notes only works over HTTPS.** That is not a preference; browsers only hand out
the cryptography Lockpad needs on a secure connection, so over plain `http://<ip>` the lock
button has nothing to work with. See
[FAQ.md](FAQ.md#-why-cant-i-lock-a-note).

---

## 📸 What it looks like once it is running

![Lockpad's note list in the light theme: a grid of note cards with folder and tag chips, and a composer at the bottom of the screen.](docs/screenshots/note-list-light.png)

![The same note list in the dark theme.](docs/screenshots/note-list-dark.png)

![A single note open, showing the formatting toolbar, folder and tag pickers, and the note's body.](docs/screenshots/note-open.png)

---

## 👉 Next

- Back up your notes: [FAQ.md](FAQ.md#-how-do-i-back-up-my-notes). Nobody else is holding a
  copy, which is the whole point and also the catch.
- Keep it current: [FAQ.md](FAQ.md#-how-do-i-update) and [CHANGELOG.md](CHANGELOG.md).
- Something broken: [FAQ.md](FAQ.md#-if-something-goes-wrong).
