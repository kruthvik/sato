import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { createSatoPaths } from "../packages/runtime/src/paths.ts";

// Read-only checks; never print credential values, chats or learner records.
if (process.argv.includes("--inspect-home")) {
  const paths = createSatoPaths({ home: process.env.SATO_HOME });
  const filename = resolve(paths.data, "learning.sqlite");
  if (await Bun.file(filename).exists()) {
    const db = new Database(filename, { readonly: true });
    try {
      const counts = Object.fromEntries(["object_revision", "event", "model_call_log", "blob_manifest", "source_span", "job"].map(table => [table, db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }]));
      console.log(JSON.stringify({ home: paths.home, counts }));
    } finally { db.close(); }
  } else console.log("No local learning database exists.");
} else {
  const result = Bun.spawn(["git", "diff", "--cached", "--name-only", "--diff-filter=ACM", "-z"], { stdout: "pipe", stderr: "pipe" });
  const filenames = (await new Response(result.stdout).text()).split("\0").filter(Boolean);
  if (await result.exited) throw new Error("Cannot inspect staged files");
  if (!filenames.length) throw new Error("No files staged for publication");
  const findings: string[] = [];
  const forbidden = /(^|\/)(?:\.learn|\.pi|\.feynman|\.codex|\.obsidian|sessions|data|backups|exports|node_modules)(\/|$)|(^|\/)(?:auth|brain|settings|models-store|keybindings)\.(?:json|md)$|\.(?:sqlite(?:3|-wal|-shm)?|db(?:-wal|-shm)?|jsonl)$|(^|\/)\.env(?:\.|$)|outputs\/(?:\.plans|\.drafts|start\.md)|docs\/plans\//i;
  const privateContent = /(?:C:[\\/]Users[\\/][^\s`"']+)|(?:gh[pousr]_[A-Za-z0-9]{20,})|(?:github_pat_[A-Za-z0-9_]{20,})|(?:sk-[A-Za-z0-9_-]{24,})|(?:-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/;
  for (const filename of filenames) {
    if (forbidden.test(filename)) findings.push(`${filename}: private/runtime path`);
    // Check the staged bytes, not an unstaged local replacement.
    const child = Bun.spawn(["git", "show", `:${filename}`], { stdout: "pipe", stderr: "pipe" });
    const content = await new Response(child.stdout).text();
    if (await child.exited) throw new Error(`Cannot inspect staged file: ${filename}`);
    if (privateContent.test(content)) findings.push(`${filename}: private path or credential-like content`);
  }
  if (findings.length) throw new Error(`Publication blocked:\n${findings.join("\n")}`);
  console.log(`Publication check passed: ${filenames.length} staged files; no detected private/runtime paths or credential patterns.`);
}
