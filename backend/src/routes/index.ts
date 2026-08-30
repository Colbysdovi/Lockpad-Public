import type { FastifyInstance } from "fastify";
import { authRoutes } from "./auth.js";
import { notesRoutes } from "./notes.js";
import { foldersRoutes } from "./folders.js";
import { tagsRoutes } from "./tags.js";
import { linksRoutes } from "./links.js";
import { searchRoutes } from "./search.js";
import { lifecycleRoutes } from "./lifecycle.js";
import { lockRoutes } from "./lock.js";
import { importRoutes } from "./import.js";
import { exportRoutes } from "./export.js";
import { pinsRoutes } from "./pins.js";
import { imagesRoutes } from "./images.js";
import { onboardingRoutes } from "./onboarding.js";
import { settingsRoutes } from "./settings.js";

// Every route group in the API, mounted under /api.
//
// Split by subject rather than by verb, so all the handlers for one concept sit
// together and a change to (say) how pinning works has exactly one file to visit:
//
//   auth       login / logout / status
//   notes      create, read, update, list, duplicate, bulk actions
//   folders    the tree, plus create / rename / delete / cleanup
//   tags       the tag list, applying and removing them, plus cleanup
//   links      note-to-note links and their backlinks
//   search     full-text search across notes
//   lifecycle  archive, unarchive, trash, restore, permanent delete
//   lock       storing and retrieving a note's ciphertext (never a key)
//   import     parsing uploaded files, preview and commit
//   export     the whole library as one JSON backup
//   pins       per-page pinned notes
//   images     the picture bytes embedded in note bodies
//   onboarding whether this instance has been through the first-run welcome
//   settings   account-wide interface preferences (the language)
//
// Registration order does not matter here — Fastify resolves routes by path, not by
// declaration order.
export function registerRoutes(app: FastifyInstance) {
  app.register(authRoutes, { prefix: "/api" });
  app.register(notesRoutes, { prefix: "/api" });
  app.register(foldersRoutes, { prefix: "/api" });
  app.register(tagsRoutes, { prefix: "/api" });
  app.register(linksRoutes, { prefix: "/api" });
  app.register(searchRoutes, { prefix: "/api" });
  app.register(lifecycleRoutes, { prefix: "/api" });
  app.register(lockRoutes, { prefix: "/api" });
  app.register(importRoutes, { prefix: "/api" });
  app.register(exportRoutes, { prefix: "/api" });
  app.register(pinsRoutes, { prefix: "/api" });
  app.register(imagesRoutes, { prefix: "/api" });
  app.register(onboardingRoutes, { prefix: "/api" });
  app.register(settingsRoutes, { prefix: "/api" });
}
