import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { Revision } from "../../core/src/contracts.ts";
import { hash, type LearningStore } from "../../storage/src/store.ts";

export interface SourceBody { title: string; original_hash: string; mime: string; rights: "unknown" | "owned" | "licensed"; purpose: string; local_private_only: true; extraction: string }
export class SourceService {
  constructor(readonly store: LearningStore, readonly blobRoot: string) {}
  async importFile(filename: string, purpose = "reference", rights: SourceBody["rights"] = "unknown"): Promise<Revision<SourceBody> & { status: string; duplicate: boolean }> {
    const path = resolve(filename);
    const info = await stat(path);
    if (!info.isFile() || info.size > 10 * 1024 * 1024 || info.size === 0) throw new Error("Source must be a nonempty file up to 10 MB");
    const extension = extname(path).toLowerCase();
    if (![".txt", ".md", ".csv", ".tsv", ".json"].includes(extension)) throw new Error("Supported sources: UTF-8 .txt, .md, .csv, .tsv, .json. PDF/OCR, images and audio need a verified adapter; no partial import was saved.");
    if (!["unknown", "owned", "licensed"].includes(rights)) throw new Error("Rights must be unknown, owned or licensed");
    const original = await readFile(path);
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(original); } catch { throw new Error("Source must be valid UTF-8 text"); }
    if (text.includes("\0")) throw new Error("Binary content is not a text source");
    const contentHash = hash(original);
    const duplicate = this.store.revisions("source").find(r => r.body.original_hash === contentHash && this.store.sourceStatus(r.revision_id) !== "removed");
    if (duplicate) return { ...duplicate as unknown as Revision<SourceBody>, status: this.store.sourceStatus(duplicate.revision_id), duplicate: true };
    await mkdir(this.blobRoot, { recursive: true });
    await writeFile(join(this.blobRoot, contentHash), original, { flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
    const revisionId = randomUUID();
    const body: SourceBody = { title: basename(path), original_hash: contentHash, mime: "text/plain; charset=utf-8", rights, purpose, local_private_only: true, extraction: "utf8-lines-v1" };
    this.store.db.transaction(() => {
      this.store.db.query("INSERT OR IGNORE INTO blob_manifest(hash,mime,size,role,created_at) VALUES(?,?,?,?,?)").run(contentHash, body.mime, original.length, "source_original", this.store.now());
      const receipt = this.store.append("source_status", { source_revision_id: revisionId, status: "received" }, `source:${revisionId}:received`, "learner", "sources");
      this.store.insertRevision(revisionId, randomUUID(), "source", null, body as unknown as Record<string, unknown>, receipt.seq, `source:${revisionId}`, body);
      this.store.append("source_status", { source_revision_id: revisionId, status: "extracting" }, `source:${revisionId}:extracting`, "host", "sources");
      const lines = text.split(/\r?\n/);
      let chunk = "", firstLine = 1, ordinal = 0;
      const save = (lastLine: number) => {
        if (!chunk.trim()) return;
        this.store.db.query("INSERT INTO source_span(span_id,source_revision_id,ordinal,locator,text,method,confidence) VALUES(?,?,?,?,?,?,?)").run(`${revisionId}:${ordinal++}`, revisionId, ordinal - 1, `lines ${firstLine}–${lastLine}`, chunk, "utf8-lines-v1", 1);
      };
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (chunk.length + line.length > 3500 && chunk) { save(i); chunk = ""; firstLine = i + 1; }
        // Very long lines are bounded too; no source span bypasses the context budget.
        for (let offset = 0; offset < line.length || offset === 0; offset += 3500) {
          const part = line.slice(offset, offset + 3500);
          if (part.length + chunk.length > 3500 && chunk) { save(i + 1); chunk = ""; firstLine = i + 1; }
          chunk += part + "\n";
        }
      }
      save(lines.length);
      this.store.append("source_status", { source_revision_id: revisionId, status: "needs_review", reason: "Review extracted text before using it to author or score tasks" }, `source:${revisionId}:review`, "host", "sources");
      this.store.rebuild();
    })();
    return { ...this.store.revision<SourceBody>(revisionId), status: "needs_review", duplicate: false };
  }
  list(): Array<Record<string, unknown>> {
    return this.store.revisions("source").map(r => ({ source_id: r.revision_id, ...r.body, status: this.store.sourceStatus(r.revision_id), spans: (this.store.db.query("SELECT count(*) AS count FROM source_span WHERE source_revision_id=?").get(r.revision_id) as { count: number }).count }));
  }
  preview(sourceId: string): Array<{ span_id: string; locator: string; text: string }> {
    this.store.revision(sourceId, "source");
    return this.store.db.query<{ span_id: string; locator: string; text: string }, [string]>("SELECT span_id,locator,text FROM source_span WHERE source_revision_id=? ORDER BY ordinal LIMIT 12").all(sourceId);
  }
  accept(sourceId: string): void {
    this.store.revision(sourceId, "source");
    if (this.store.sourceStatus(sourceId) === "removed") throw new Error("Removed source cannot be accepted");
    if (!this.preview(sourceId).length) throw new Error("No extracted text to accept");
    this.store.append("source_accepted", { source_revision_id: sourceId, status: "indexed", reason: "Learner accepted the extraction; factual accuracy and answer keys remain task-specific" }, `accept:${sourceId}`, "learner", "sources");
  }
  remove(sourceId: string): void {
    this.store.revision(sourceId, "source");
    this.store.append("source_removed", { source_revision_id: sourceId, status: "removed", reason: "Stop future use; historical attempts and original retained for provenance. Use a separate privacy purge to erase payloads." }, `remove:${sourceId}`, "learner", "sources");
  }
  search(query: string, allowedSources: string[]): Array<Record<string, unknown>> {
    if (!query.trim()) return [];
    const words = query.toLocaleLowerCase().split(/\s+/).slice(0, 10);
    return this.store.db.query<{ span_id: string; source_revision_id: string; locator: string; text: string }, []>("SELECT span_id,source_revision_id,locator,text FROM source_span ORDER BY source_revision_id,ordinal").all()
      .filter(s => allowedSources.includes(s.source_revision_id) && this.store.sourceStatus(s.source_revision_id) === "indexed")
      .map(s => ({ ...s, rank: words.reduce((n, word) => n + (s.text.toLocaleLowerCase().includes(word) ? 1 : 0), 0) }))
      .filter(s => s.rank > 0).sort((a, b) => b.rank - a.rank || a.span_id.localeCompare(b.span_id)).slice(0, 6)
      .map(s => ({ ...s, text: s.text.slice(0, 2400), trust: "untrusted quoted source data" }));
  }
}
