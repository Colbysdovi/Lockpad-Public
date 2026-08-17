import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { createFolderSchema, updateFolderSchema } from "../schemas.js";

interface FolderNode {
  id: string;
  name: string;
  color: string | null;
  parentFolderId: string | null;
  children: FolderNode[];
}

// Build an in-memory tree from the flat folder list (adjacency list → nested).
function buildTree(folders: { id: string; name: string; color: string | null; parentFolderId: string | null }[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  for (const f of folders) byId.set(f.id, { ...f, children: [] });
  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    if (node.parentFolderId && byId.has(node.parentFolderId)) {
      byId.get(node.parentFolderId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// Would reparenting `folderId` under `newParentId` create a cycle? True if
// newParent is the folder itself or one of its descendants.
async function wouldCycle(folderId: string, newParentId: string): Promise<boolean> {
  if (folderId === newParentId) return true;
  let current: string | null = newParentId;
  while (current) {
    if (current === folderId) return true;
    const parent: { parentFolderId: string | null } | null = await prisma.folder.findUnique({
      where: { id: current },
      select: { parentFolderId: true },
    });
    current = parent?.parentFolderId ?? null;
  }
  return false;
}


// ── Unused-folder cleanup ────────────────────────────────────────────────────
//
// A folder counts as unused only when its ENTIRE subtree — itself plus every
// descendant, at any depth — holds no notes. One note buried three levels down
// keeps that folder AND every ancestor above it, because deleting an ancestor
// takes the note's folder with it.
//
// "Holds no notes" counts EVERY note, including archived and trashed ones. A note
// in the trash can be restored, and it would be restored into a folder that no
// longer exists — so a folder that is only empty because its notes were binned is
// not empty at all, just quiet. Same principle as the tag rule.
interface FolderRow {
  id: string;
  name: string;
  color: string | null;
  parentFolderId: string | null;
  _count: { notes: number };
}

interface UnusedFolders {
  /** Topmost folder of each fully-empty subtree — the only ones worth offering,
   *  since deleting one already removes every empty folder beneath it. */
  roots: { id: string; name: string; color: string | null; descendantCount: number }[];
  /** id → every folder id in its subtree, deepest-first (safe delete order). */
  subtrees: Map<string, string[]>;
}

async function findUnusedFolders(): Promise<UnusedFolders> {
  const folders: FolderRow[] = await prisma.folder.findMany({
    select: {
      id: true,
      name: true,
      color: true,
      parentFolderId: true,
      _count: { select: { notes: true } },
    },
    orderBy: { name: "asc" },
  });

  const byId = new Map(folders.map((f) => [f.id, f]));
  const childrenOf = new Map<string, FolderRow[]>();
  for (const f of folders) {
    if (f.parentFolderId && byId.has(f.parentFolderId)) {
      const list = childrenOf.get(f.parentFolderId) ?? [];
      list.push(f);
      childrenOf.set(f.parentFolderId, list);
    }
  }

  // Post-order walk, iterative: the tree is user-made and shallow, but recursion
  // on data a user controls is how you get a stack overflow from a deep import.
  const subtreeNotes = new Map<string, number>();
  const subtreeIds = new Map<string, string[]>();
  const order: FolderRow[] = [];
  const stack = folders.filter((f) => !f.parentFolderId || !byId.has(f.parentFolderId));
  while (stack.length) {
    const node = stack.pop()!;
    order.push(node);
    stack.push(...(childrenOf.get(node.id) ?? []));
  }
  // `order` is parents-before-children, so walking it backwards visits every child
  // before its parent — which is what makes the running totals correct.
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i];
    const kids = childrenOf.get(node.id) ?? [];
    subtreeNotes.set(node.id, node._count.notes + kids.reduce((n, k) => n + (subtreeNotes.get(k.id) ?? 0), 0));
    // Deepest-first: children's ids come before this folder's own, so deleting in
    // this order never leaves a row pointing at a parent that is already gone.
    subtreeIds.set(node.id, [...kids.flatMap((k) => subtreeIds.get(k.id) ?? []), node.id]);
  }

  const empty = (id: string) => (subtreeNotes.get(id) ?? 0) === 0;
  const roots = folders
    .filter((f) => empty(f.id))
    // Only the TOP of each empty subtree: if this folder's parent is also empty,
    // the parent's own entry already covers it.
    .filter((f) => !(f.parentFolderId && byId.has(f.parentFolderId) && empty(f.parentFolderId)))
    .map((f) => ({
      id: f.id,
      name: f.name,
      color: f.color,
      descendantCount: (subtreeIds.get(f.id)?.length ?? 1) - 1,
    }));

  return { roots, subtrees: subtreeIds };
}

export async function foldersRoutes(app: FastifyInstance) {
  // Full tree.
  app.get("/folders", async () => {
    const folders = await prisma.folder.findMany({
      select: { id: true, name: true, color: true, parentFolderId: true },
      orderBy: { name: "asc" },
    });
    return { folders: buildTree(folders) };
  });

  app.post("/folders", async (request, reply) => {
    const body = createFolderSchema.parse(request.body);
    if (body.parentFolderId) {
      const parent = await prisma.folder.findUnique({ where: { id: body.parentFolderId } });
      if (!parent) throw badRequest("parentFolderId does not exist");
    }
    const folder = await prisma.folder.create({
      data: { name: body.name, color: body.color ?? null, parentFolderId: body.parentFolderId ?? null },
    });
    return reply.status(201).send(folder);
  });

  app.patch("/folders/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = updateFolderSchema.parse(request.body);
    const existing = await prisma.folder.findUnique({ where: { id } });
    if (!existing) throw notFound("Folder not found");

    if (body.parentFolderId !== undefined && body.parentFolderId !== null) {
      const parent = await prisma.folder.findUnique({ where: { id: body.parentFolderId } });
      if (!parent) throw badRequest("parentFolderId does not exist");
      if (await wouldCycle(id, body.parentFolderId)) {
        throw badRequest("Reparenting would create a cycle");
      }
    }

    return prisma.folder.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.parentFolderId !== undefined ? { parentFolderId: body.parentFolderId } : {}),
      },
    });
  });

  // Folders eligible for cleanup, topmost-empty-subtree only (see findUnusedFolders).
  app.get("/folders/unused", async () => {
    const { roots } = await findUnusedFolders();
    return { folders: roots };
  });

  // Delete one empty subtree. Eligibility is recomputed HERE rather than trusted
  // from whatever the client last saw: the cleanup list is a snapshot, and a note
  // filed into one of these folders in the meantime must veto the delete instead of
  // being quietly unfiled by it.
  app.delete("/folders/:id/subtree", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { roots, subtrees } = await findUnusedFolders();
    if (!subtrees.has(id)) throw notFound("Folder not found");
    if (!roots.some((r) => r.id === id)) {
      throw conflict("That folder is no longer empty — it or a folder inside it now has notes.");
    }
    const ids = subtrees.get(id)!;
    await prisma.$transaction(ids.map((folderId) => prisma.folder.delete({ where: { id: folderId } })));
    return reply.send({ deleted: ids.length });
  });

  // Delete every empty subtree in one pass. Takes no ids on purpose — the set is
  // computed at execution time, so "delete all" can only ever remove folders that
  // are empty at the moment the button is pressed, not the ones that were empty
  // when the dialog opened.
  app.post("/folders/cleanup", async (_request, reply) => {
    const { roots, subtrees } = await findUnusedFolders();
    const ids = roots.flatMap((r) => subtrees.get(r.id) ?? []);
    if (ids.length) {
      await prisma.$transaction(ids.map((folderId) => prisma.folder.delete({ where: { id: folderId } })));
    }
    return reply.send({ deleted: ids.length, subtrees: roots.length });
  });

  // Delete a folder. Notes' folderId is set null (FK ON DELETE SET NULL); child
  // folders are re-parented to this folder's parent so the tree stays connected.
  app.delete("/folders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.folder.findUnique({ where: { id } });
    if (!existing) throw notFound("Folder not found");
    await prisma.$transaction([
      prisma.folder.updateMany({
        where: { parentFolderId: id },
        data: { parentFolderId: existing.parentFolderId },
      }),
      prisma.folder.delete({ where: { id } }),
    ]);
    return reply.status(204).send();
  });
}
