// Integration tests for images in notes.
//
// The behaviour worth pinning down here is not "an upload works" — it is everything
// that has to stay true AROUND an upload, because each of these has a failure mode
// that loses or exposes a picture rather than merely showing an error:
//
//   · a locked note must have NO readable image bytes left on the server
//   · unlocking must put them back, from the document the browser hands over
//   · duplicating must give the copy its own bytes, so deleting either note leaves
//     the other's picture intact
//   · a full-library export must carry its pictures, and re-importing must restore
//     them as rows rather than as base64 stranded inside a document
//   · nothing but the allowlisted image types may be stored at all
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { startTestDb, type TestDb } from "./helpers/db.js";

let db: TestDb;
let app: FastifyInstance;

before(async () => {
  db = await startTestDb();
  process.env.DATABASE_URL = db.url;
  process.env.LOG_DIR = "./logs";
  process.env.CORS_ORIGINS = "http://localhost:5173";
  const { buildApp } = await import("../src/app.js");
  app = buildApp();
  await app.ready();
});

after(async () => {
  await app?.close();
  const { prisma } = await import("../src/prisma.js");
  await prisma.$disconnect();
  await db?.stop();
});

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload: payload as any });
const get = (url: string) => app.inject({ method: "GET", url });

// The smallest valid PNG there is: a single transparent pixel. Real bytes, so the
// mime check and the size bookkeeping are exercised on something a browser would
// actually accept — but small enough to keep inline.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");
const PNG_DATA_URI = `data:image/png;base64,${PNG_BASE64}`;

/** A document holding one image, referenced however the caller wants. */
const docWithImage = (src: string) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "before" }] },
    { type: "image", attrs: { src, alt: "a pixel", width: 1, height: 1 } },
  ],
});

/** The src of the first image node in a document. */
function imageSrcOf(content: any): string {
  return content.content.find((n: any) => n.type === "image")?.attrs?.src ?? "";
}

// Multipart is assembled by hand: app.inject has no form helper, and building the
// body here keeps the test honest about what the route actually receives.
function multipart(fields: Record<string, string>, file: { name: string; mime: string; bytes: Buffer }) {
  const boundary = "----lockpadtest";
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
        `Content-Type: ${file.mime}\r\n\r\n`
    ),
    file.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  );
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(parts),
  };
}

function uploadTo(noteId: string, mime = "image/png", bytes: Buffer = PNG_BYTES) {
  const { headers, payload } = multipart({ width: "1", height: "1" }, { name: "pixel.png", mime, bytes });
  return app.inject({ method: "POST", url: `/api/notes/${noteId}/images`, headers, payload });
}

// ── Upload and serve ──────────────────────────────────────────────────────────
test("IMG-01 upload stores the bytes and serves them back unchanged", async () => {
  const note = (await post("/api/notes", { title: "With a picture" })).json();

  const uploaded = await uploadTo(note.id);
  assert.equal(uploaded.statusCode, 201);
  const image = uploaded.json();
  assert.equal(image.mime, "image/png");
  assert.equal(image.size, PNG_BYTES.length);
  assert.equal(image.src, `/api/images/${image.id}`, "the src is returned ready for the document");

  const served = await get(image.src);
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers["content-type"], "image/png");
  assert.match(String(served.headers["cache-control"]), /immutable/);
  assert.equal(served.headers["x-content-type-options"], "nosniff");
  assert.ok(served.rawPayload.equals(PNG_BYTES), "the bytes come back byte-for-byte");
});

test("IMG-02 only allowlisted image types are accepted", async () => {
  const note = (await post("/api/notes", { title: "Rejections" })).json();

  // SVG is an executable document, not a bitmap — refused on purpose.
  const svg = await uploadTo(note.id, "image/svg+xml", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"));
  assert.equal(svg.statusCode, 400);
  assert.match(svg.json().error.message, /image\/jpeg/);

  const text = await uploadTo(note.id, "text/plain", Buffer.from("not an image"));
  assert.equal(text.statusCode, 400);

  const empty = await uploadTo(note.id, "image/png", Buffer.alloc(0));
  assert.equal(empty.statusCode, 400);
});

// ── Embedded pictures are absorbed into rows ─────────────────────────────────
test("IMG-03 a data URI in a new note's document becomes a stored image", async () => {
  const created = (await post("/api/notes", { title: "Embedded", content: docWithImage(PNG_DATA_URI) })).json();

  const src = imageSrcOf(created.content);
  assert.match(src, /^\/api\/images\/[a-z0-9]+$/, "the inline picture was replaced by a reference");

  const served = await get(src);
  assert.equal(served.statusCode, 200);
  assert.ok(served.rawPayload.equals(PNG_BYTES));
});

test("IMG-04 an oversized or unsupported embedded image is refused, not silently dropped", async () => {
  const bad = await post("/api/notes", {
    title: "Bad embed",
    content: docWithImage("data:image/svg+xml;base64,PHN2Zy8+"),
  });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error.message, /Unsupported image type/);
});

// ── Locking ──────────────────────────────────────────────────────────────────
test("IMG-05 locking leaves no readable image bytes; unlocking restores them", async () => {
  const note = (await post("/api/notes", { title: "Secret" })).json();
  const image = (await uploadTo(note.id)).json();
  await app.inject({
    method: "PATCH",
    url: `/api/notes/${note.id}`,
    payload: { content: docWithImage(image.src) },
  });

  // The browser folds the picture into the document and encrypts the result; the
  // server only ever sees the ciphertext, so the test stands in for that step.
  const locked = await post(`/api/notes/${note.id}/lock`, {
    ciphertext: Buffer.from("pretend ciphertext").toString("base64"),
    cryptoMeta: { kdf: "pbkdf2", salt: "s", iv: "i", params: { iterations: 600000 } },
  });
  assert.equal(locked.statusCode, 200);
  assert.equal(locked.json().isLocked, true);

  // THE POINT OF THE WHOLE FEATURE: the picture is no longer on disk in the clear.
  const gone = await get(image.src);
  assert.equal(gone.statusCode, 404, "a locked note's images are not served");

  const { prisma } = await import("../src/prisma.js");
  assert.equal(await prisma.noteImage.count({ where: { noteId: note.id } }), 0, "and no rows are left");

  // Unlocking hands back the decrypted document, pictures still inside it.
  const unlocked = await post(`/api/notes/${note.id}/unlock`, { content: docWithImage(PNG_DATA_URI) });
  assert.equal(unlocked.statusCode, 200);
  const restoredSrc = imageSrcOf(unlocked.json().content);
  assert.match(restoredSrc, /^\/api\/images\/[a-z0-9]+$/, "the picture is a stored image again");
  const served = await get(restoredSrc);
  assert.equal(served.statusCode, 200);
  assert.ok(served.rawPayload.equals(PNG_BYTES));
});

test("IMG-06 a locked note refuses new images", async () => {
  const note = (await post("/api/notes", { title: "Sealed" })).json();
  await post(`/api/notes/${note.id}/lock`, {
    ciphertext: Buffer.from("x").toString("base64"),
    cryptoMeta: { kdf: "pbkdf2", salt: "s", iv: "i", params: {} },
  });
  const refused = await uploadTo(note.id);
  assert.equal(refused.statusCode, 400);
  assert.match(refused.json().error.message, /Unlock/);
});

// ── Duplicate ────────────────────────────────────────────────────────────────
test("IMG-07 a duplicate gets its own copy of the bytes", async () => {
  const note = (await post("/api/notes", { title: "Original" })).json();
  const image = (await uploadTo(note.id)).json();
  await app.inject({ method: "PATCH", url: `/api/notes/${note.id}`, payload: { content: docWithImage(image.src) } });

  const copy = (await post(`/api/notes/${note.id}/duplicate`)).json();
  const copySrc = imageSrcOf(copy.content);
  assert.notEqual(copySrc, image.src, "the copy points at its own image, not the original's");

  // Deleting the original for good must not blind the copy — that is the whole
  // reason the rows are copied instead of shared.
  await app.inject({ method: "DELETE", url: `/api/notes/${note.id}` });
  await app.inject({ method: "DELETE", url: `/api/notes/${note.id}/permanent` });

  assert.equal((await get(image.src)).statusCode, 404, "the original's image went with it");
  const survived = await get(copySrc);
  assert.equal(survived.statusCode, 200, "the copy's image is untouched");
  assert.ok(survived.rawPayload.equals(PNG_BYTES));
});

// ── Backup round trip ────────────────────────────────────────────────────────
test("IMG-08 the library export carries its pictures, and importing restores them", async () => {
  const note = (await post("/api/notes", { title: "Illustrated" })).json();
  const image = (await uploadTo(note.id)).json();
  await app.inject({ method: "PATCH", url: `/api/notes/${note.id}`, payload: { content: docWithImage(image.src) } });

  const backup = (await get("/api/export")).json();
  assert.ok(backup.counts.images >= 1);
  assert.equal(backup.counts.imageBytes >= PNG_BYTES.length, true);
  const exported = backup.notes.find((n: any) => n.id === note.id);
  assert.match(imageSrcOf(exported.content), /^data:image\/png;base64,/, "the picture travels inside the file");

  // Feeding that document straight back in must produce a real image row again —
  // otherwise a restored backup would hold megabytes of base64 in its text.
  const restored = (await post("/api/notes", { title: "Restored", content: exported.content })).json();
  const restoredSrc = imageSrcOf(restored.content);
  assert.match(restoredSrc, /^\/api\/images\/[a-z0-9]+$/);
  assert.ok((await get(restoredSrc)).rawPayload.equals(PNG_BYTES));
});
