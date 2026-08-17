#!/usr/bin/env node
/**
 * Incremental workspace backup to GitHub (Steffi-2203/Hausverwaltersoftware, branch main).
 *
 * Why a script instead of `git push`: the Replit askpass provides no GitHub token
 * and the connector token is not exportable — so we push via the GitHub Git Data API
 * through the authenticated Replit connector proxy.
 * See .agents/memory/github-backup-push.md for background.
 *
 * Usage:  node scripts/backup-to-github.mjs [--dry-run]
 *
 * Behavior:
 *  - File list = tracked + untracked files (`git ls-files --cached --others
 *    --exclude-standard`, honors .gitignore) minus an explicit secret denylist;
 *    content hashed from the working tree, so uncommitted changes are included.
 *  - If the target repo/branch is empty, it is initialized first (blob API
 *    refuses empty repos).
 *  - Only blobs missing from the remote tree are uploaded (content-addressed SHAs),
 *    throttled to stay under the proxy's ~10 req/s limit, with retry on rate limits.
 *  - Deletions are propagated. Trees are built in 150-entry chunks chained via
 *    base_tree (a single huge tree call times out).
 *  - Creates one new commit on top of the remote main head and fast-forwards the ref.
 */

import { ReplitConnectors } from "@replit/connectors-sdk";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

// Target repo can be overridden for testing: GITHUB_BACKUP_REPO="owner/repo"
const [OWNER, REPO] = (process.env.GITHUB_BACKUP_REPO || "Steffi-2203/Hausverwaltersoftware").split("/");
const BRANCH = "main";
const CHUNK = 150; // tree entries per createTree call
const MAX_BLOB_BYTES = 40 * 1024 * 1024; // guard well under GitHub's 100MB API limit
const DRY_RUN = process.argv.includes("--dry-run");

const connectors = new ReplitConnectors();

async function gh(path, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await connectors.proxy("github", path, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers || {}) },
    });
    if (res.status === 429 || res.status === 403) {
      const body = await res.text();
      if (attempt < 6 && /rate limit/i.test(body)) {
        const wait = 2000 * (attempt + 1);
        console.log(`  rate limited, retrying in ${wait}ms ...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new Error(`GitHub ${res.status} on ${path}: ${body.slice(0, 300)}`);
    }
    if (!res.ok) {
      throw new Error(`GitHub ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
    }
    return res.json();
  }
}

function gitBlobSha(buf) {
  return createHash("sha1")
    .update(`blob ${buf.length}\0`)
    .update(buf)
    .digest("hex");
}

// Never push these to the (public!) backup repo, even if git would track them.
import { isSecretPath as SECRET_DENYLIST } from "./backup-denylist.mjs";

// --- 1. Local state: tracked + untracked files (honors .gitignore) ---
const files = [
  ...new Set(
    execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      maxBuffer: 64 * 1024 * 1024,
    })
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
  ),
];

const local = new Map(); // path -> { sha, mode, size }
for (const path of files) {
  if (SECRET_DENYLIST(path)) {
    console.warn(`SKIP (secret denylist): ${path}`);
    continue;
  }
  // Chat-Anhänge (alte Code-Snapshots/ZIPs, Logs, Screenshots) gehören nicht
  // ins öffentliche Backup — sie können PII/Interna enthalten.
  if (path.startsWith("attached_assets/")) continue;
  let st;
  try {
    st = statSync(path);
  } catch {
    continue; // deleted locally but still tracked — will be removed remotely
  }
  if (!st.isFile()) continue; // skip symlinks/submodules
  if (st.size > MAX_BLOB_BYTES) {
    console.warn(`SKIP (too large, ${(st.size / 1e6).toFixed(1)} MB): ${path}`);
    continue;
  }
  const buf = readFileSync(path);
  const mode = st.mode & 0o100 ? "100755" : "100644";
  local.set(path, { sha: gitBlobSha(buf), mode, size: st.size });
}
console.log(`Local: ${local.size} files`);

// --- 2. Remote state (initialize empty repo/branch if needed) ---
// Note: the git refs read endpoints can lag several minutes for freshly
// initialized repos; the commits API is reliable, so head is resolved there.
async function getHead() {
  const fetchHead = () => gh(`/repos/${OWNER}/${REPO}/commits/${BRANCH}`);
  try {
    return await fetchHead();
  } catch (err) {
    if (!/GitHub (404|409)/.test(String(err))) throw err;
    console.log(`Branch ${BRANCH} not found — initializing repository ...`);
    try {
      await gh(`/repos/${OWNER}/${REPO}/contents/.backup-init`, {
        method: "PUT",
        body: JSON.stringify({
          message: "Initialize backup branch",
          content: Buffer.from("Initialized by scripts/backup-to-github.mjs\n").toString("base64"),
          branch: BRANCH,
        }),
      });
    } catch (e) {
      // 422 "sha wasn't supplied" => file already exists, branch already initialized
      if (!/GitHub 422/.test(String(e))) throw e;
    }
    for (let i = 0; ; i++) {
      try {
        return await fetchHead();
      } catch (e) {
        if (i >= 10 || !/GitHub (404|409)/.test(String(e))) throw e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
}
// One full push attempt against the current remote head. Returns "done",
// "uptodate", or "conflict" (another concurrent backup advanced the ref —
// caller re-runs the whole diff against the new head).
async function runOnce() {
const head = await getHead();
const headSha = head.sha;
const headTreeSha = head.commit.tree.sha;
const remote = new Map(); // path -> { sha, mode }
let baseTreeStart = headTreeSha;
try {
  const remoteTree = await gh(`/repos/${OWNER}/${REPO}/git/trees/${headTreeSha}?recursive=1`);
  if (remoteTree.truncated) {
    throw new Error("Remote tree listing truncated — repo too large for this approach.");
  }
  for (const e of remoteTree.tree) {
    if (e.type === "blob") remote.set(e.path, { sha: e.sha, mode: e.mode });
  }
} catch (e) {
  // Git-data read endpoints lag several minutes on freshly created repos.
  // Fall back to a full push: treat remote as empty and build the tree
  // from scratch (write endpoints work immediately).
  if (!/GitHub 404/.test(String(e))) throw e;
  console.log("Remote tree not readable yet (fresh repo) — performing full push.");
  baseTreeStart = null;
}
console.log(`Remote (${headSha.slice(0, 7)}): ${remote.size} files`);

// --- 3. Diff ---
const changes = []; // tree entries for createTree
let toUpload = [];
for (const [path, l] of local) {
  const r = remote.get(path);
  if (!r || r.sha !== l.sha || r.mode !== l.mode) {
    changes.push({ path, mode: l.mode, type: "blob", sha: l.sha });
    if (!r || r.sha !== l.sha) toUpload.push(path);
  }
}
let deletions = 0;
for (const path of remote.keys()) {
  if (!local.has(path)) {
    changes.push({ path, mode: "100644", type: "blob", sha: null });
    deletions++;
  }
}
if (changes.length === 0) {
  console.log("Backup is already up to date — nothing to push.");
  return "uptodate";
}
console.log(
  `Diff: ${toUpload.length} blobs to upload, ${changes.length - deletions - toUpload.length} mode-only changes, ${deletions} deletions`
);
if (DRY_RUN) {
  for (const c of changes) console.log(`  ${c.sha ? "M/A" : "D  "} ${c.path}`);
  return "done";
}

// --- 4. Upload missing blobs (batches of 8 per ~1s window, ~8 req/s) ---
let done = 0;
for (let i = 0; i < toUpload.length; i += 8) {
  const batchStart = Date.now();
  await Promise.all(
    toUpload.slice(i, i + 8).map(async (path) => {
      const buf = readFileSync(path);
      const created = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: buf.toString("base64"), encoding: "base64" }),
      });
      const expected = local.get(path).sha;
      if (created.sha !== expected) {
        throw new Error(`Blob SHA mismatch for ${path}: ${created.sha} != ${expected}`);
      }
      done++;
    })
  );
  if (done % 80 < 8) console.log(`  uploaded ${done}/${toUpload.length} blobs`);
  const elapsed = Date.now() - batchStart;
  if (i + 8 < toUpload.length && elapsed < 1000) {
    await new Promise((r) => setTimeout(r, 1000 - elapsed));
  }
}
console.log(`Uploaded ${done} blobs.`);

// --- 5. Build tree in chunks chained via base_tree ---
let baseTree = baseTreeStart;
for (let i = 0; i < changes.length; i += CHUNK) {
  const tree = await gh(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      ...(baseTree ? { base_tree: baseTree } : {}),
      tree: changes.slice(i, i + CHUNK),
    }),
  });
  baseTree = tree.sha;
  console.log(`  tree chunk ${Math.min(i + CHUNK, changes.length)}/${changes.length}`);
}

// --- 6. Commit + fast-forward ref ---
const now = new Date().toISOString().slice(0, 16).replace("T", " ");
const commit = await gh(`/repos/${OWNER}/${REPO}/git/commits`, {
  method: "POST",
  body: JSON.stringify({
    message: `Workspace backup ${now} (${toUpload.length} changed, ${deletions} deleted)`,
    tree: baseTree,
    parents: [headSha],
  }),
});
try {
  await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
} catch (e) {
  // Non-fast-forward: a concurrent backup advanced the ref while we ran.
  if (/GitHub 422/.test(String(e)) && /fast forward/i.test(String(e))) {
    console.log("Ref advanced by a concurrent run — recomputing diff against new head ...");
    return "conflict";
  }
  // Fresh repos: ref read/update endpoints can lag — create the ref instead.
  if (!/GitHub 404/.test(String(e))) throw e;
  await gh(`/repos/${OWNER}/${REPO}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: commit.sha }),
  });
}
console.log(`Done: https://github.com/${OWNER}/${REPO}/commit/${commit.sha}`);
return "done";
}

// Bounded retry on concurrent-run conflicts. Re-uploading is cheap: blobs are
// content-addressed and the new diff only contains what the winner didn't push.
for (let attempt = 1; ; attempt++) {
  const result = await runOnce();
  if (result !== "conflict") break;
  if (attempt >= 3) throw new Error("Giving up after 3 ref-update conflicts.");
  await new Promise((r) => setTimeout(r, 1500 * attempt));
}
