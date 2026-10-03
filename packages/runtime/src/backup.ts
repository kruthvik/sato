import { Database } from "bun:sqlite";
import { access, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hash, type LearningStore } from "../../storage/src/store.ts";
import type { SatoPaths } from "./paths.ts";

interface Backup { format: "sato-backup-v1"; created_at: string; database: string; database_hash: string; blobs: Array<{ hash: string; data: string }>; brain: string }
/** serialize() snapshots committed WAL content; never copy the live .sqlite file alone. */
export async function backup(store: LearningStore, paths: SatoPaths, destination: string): Promise<void> {
  const snapshot = store.db.transaction(() => ({ data: store.db.serialize(), blobs: store.db.query<{ hash: string }, []>("SELECT hash FROM blob_manifest ORDER BY hash").all() }))();
  // SQLite documents that serialized WAL images must use rollback-mode header
  // bytes for deserialize(). This changes the snapshot only, never the live DB.
  snapshot.data[18] = 1;
  snapshot.data[19] = 1;
  const blobs = [];
  for (const blob of snapshot.blobs) {
    const bytes = await readFile(join(paths.data, "blobs", blob.hash));
    if (hash(bytes) !== blob.hash) throw new Error(`Original blob failed verification: ${blob.hash}`);
    blobs.push({ hash: blob.hash, data: bytes.toString("base64") });
  }
  const result: Backup = { format: "sato-backup-v1", created_at: new Date().toISOString(), database: Buffer.from(snapshot.data).toString("base64"), database_hash: hash(snapshot.data), blobs, brain: await readFile(paths.brain, "utf8").catch(() => "") };
  await writeFile(resolve(destination), JSON.stringify(result), { flag: "wx", mode: 0o600 });
}
export async function restore(paths: SatoPaths, filename: string): Promise<void> {
  // Restore is deliberately non-overwriting. A caller chooses a fresh SATO_HOME.
  const existing = await access(join(paths.data, "learning.sqlite")).then(() => true, () => false);
  if (existing) throw new Error("Restore requires a fresh SATO_HOME without a learning database; existing data was not changed");
  if ((await stat(filename)).size > 200 * 1024 * 1024) throw new Error("Backup exceeds the 200 MB restore limit");
  const input = JSON.parse(await readFile(filename, "utf8")) as Backup;
  if (input.format !== "sato-backup-v1" || typeof input.database !== "string" || typeof input.brain !== "string" || !Array.isArray(input.blobs)) throw new Error("Invalid Sato backup");
  const bytes = Buffer.from(input.database, "base64");
  if (hash(bytes) !== input.database_hash) throw new Error("Backup database hash mismatch");
  if (bytes.length < 100 || bytes.subarray(0, 16).toString() !== "SQLite format 3\0") throw new Error("Invalid SQLite image");
  const check = Database.deserialize(bytes);
  try {
    if ((check.query("PRAGMA user_version").get() as { user_version: number }).user_version !== 1) throw new Error("Unsupported backup schema");
    const tables = check.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t => t.name);
    if (tables.join(",") !== "blob_manifest,event,job,model_call_log,object_revision,projection,source_span") throw new Error("Backup table set is invalid");
    if ((check.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check !== "ok" || check.query("PRAGMA foreign_key_check").all().length) throw new Error("Backup database integrity failed");
    const required = check.query<{ hash: string }, []>("SELECT hash FROM blob_manifest").all();
    for (const blob of input.blobs) {
      if (!/^[a-f0-9]{64}$/.test(blob.hash) || typeof blob.data !== "string" || hash(Buffer.from(blob.data, "base64")) !== blob.hash) throw new Error("Backup blob integrity failed");
    }
    if (new Set(input.blobs.map(b => b.hash)).size !== input.blobs.length || required.some(b => !input.blobs.some(x => x.hash === b.hash))) throw new Error("Backup has missing or duplicate original blobs");
  } finally { check.close(); }
  // Verify everything before writing. Publish the database last so interrupted restore can be retried.
  await mkdir(join(paths.data, "blobs"), { recursive: true });
  for (const blob of input.blobs) {
    const path = join(paths.data, "blobs", blob.hash);
    const previous = await readFile(path).catch(() => undefined);
    if (previous && hash(previous) !== blob.hash) throw new Error("Conflicting blob in destination; choose another fresh home");
    if (!previous) await writeFile(path, Buffer.from(blob.data, "base64"), { flag: "wx", mode: 0o600 });
  }
  await writeFile(paths.brain, input.brain, { flag: "wx", mode: 0o600 }).catch(error => { if (error.code !== "EEXIST") throw error; });
  await writeFile(join(paths.data, "learning.sqlite"), bytes, { flag: "wx", mode: 0o600 });
}
