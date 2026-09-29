/**
 * content-viewer — Standalone local viewer for Markdown, LaTeX, and Mermaid.
 *
 * Serves notes from content/ and sources/ rendered with KaTeX (inline $ and block $$),
 * marked (tables, callouts, lists), and syntax highlighting in a sleek dark theme.
 * Completely offline with 0 external CDN dependencies.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import { renderRich } from "../.pi/extensions/activity-studio.ts";

const workspace = process.cwd();
const targetArg = process.argv[2];

function resolveFilePath(relPath: string): string | null {
	const candidate = path.isAbsolute(relPath) ? relPath : path.join(workspace, relPath);
	if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
		return candidate;
	}
	return null;
}

function listNotes(dir: string, base: string = ""): Array<{ rel: string; title: string }> {
	const results: Array<{ rel: string; title: string }> = [];
	if (!fs.existsSync(dir)) return results;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		const rel = path.join(base, entry.name);
		if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
			results.push(...listNotes(full, rel));
		} else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".tex"))) {
			results.push({ rel: rel.replace(/\\/g, "/"), title: entry.name.replace(/\.(md|tex)$/, "") });
		}
	}
	return results;
}

const katexDist = path.join(workspace, "node_modules", "katex", "dist");

function renderPage(contentHtml: string, title: string, currentFile: string, allNotes: Array<{ rel: string; title: string }>): string {
	const navLinks = allNotes
		.map(n => `<a class="nav-item ${n.rel === currentFile ? 'active' : ''}" href="/view?file=${encodeURIComponent(n.rel)}">${n.title}</a>`)
		.join("\n");

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title} — Learning Viewer</title>
  <link rel="stylesheet" href="/katex/katex.min.css">
  <style>
    :root {
      --bg: #080808;
      --surface: #111111;
      --surface-elevated: #181818;
      --border: #262626;
      --text: #ededed;
      --text-muted: #888888;
      --accent: #3b82f6;
      --font-sans: 'Space Grotesk', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      display: flex;
      height: 100vh;
      overflow: hidden;
    }
    #sidebar {
      width: 280px;
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .sidebar-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      font-weight: 700;
      font-size: 0.95rem;
      letter-spacing: -0.01em;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .sidebar-header span { color: var(--accent); }
    .nav-list {
      overflow-y: auto;
      padding: 12px 10px;
      flex: 1;
    }
    .nav-item {
      display: block;
      padding: 8px 12px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.88rem;
      border-radius: 6px;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: all 0.15s ease;
    }
    .nav-item:hover {
      background: var(--surface-elevated);
      color: var(--text);
    }
    .nav-item.active {
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      font-weight: 600;
    }
    #main {
      flex: 1;
      overflow-y: auto;
      padding: 40px 60px;
      display: flex;
      justify-content: center;
    }
    .article-wrap {
      max-width: 820px;
      width: 100%;
    }
    .file-path {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 20px;
    }
    .markdown-body {
      line-height: 1.7;
      font-size: 1.05rem;
    }
    .markdown-body h1 { font-size: 2rem; margin: 0 0 20px 0; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
    .markdown-body h2 { font-size: 1.5rem; margin: 32px 0 16px 0; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    .markdown-body h3 { font-size: 1.25rem; margin: 24px 0 12px 0; }
    .markdown-body p { margin-bottom: 16px; }
    .markdown-body ul, .markdown-body ol { margin: 0 0 16px 24px; }
    .markdown-body li { margin-bottom: 6px; }
    .markdown-body pre {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 0.9rem;
      margin-bottom: 20px;
    }
    .markdown-body code {
      font-family: var(--font-mono);
      font-size: 0.88em;
      background: var(--surface-elevated);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .markdown-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 0.95rem;
    }
    .markdown-body th, .markdown-body td {
      border: 1px solid var(--border);
      padding: 10px 14px;
      text-align: left;
    }
    .markdown-body th { background: var(--surface); font-weight: 600; }
    .markdown-body blockquote {
      border-left: 3px solid var(--accent);
      padding: 8px 16px;
      color: var(--text-muted);
      background: rgba(59, 130, 246, 0.05);
      border-radius: 0 6px 6px 0;
      margin-bottom: 16px;
    }
    /* KaTeX math adjustments */
    .katex { font-size: 1.05em; }
    .katex-display {
      margin: 20px 0;
      padding: 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow-x: auto;
      text-align: center;
    }
  </style>
</head>
<body>
  <div id="sidebar">
    <div class="sidebar-header">
      <div>Learning <span>Viewer</span></div>
      <small style="color: var(--text-muted); font-size: 0.75rem;">KaTeX + MD</small>
    </div>
    <div class="nav-list">
      ${navLinks}
    </div>
  </div>
  <div id="main">
    <div class="article-wrap">
      <div class="file-path">${currentFile || "Select a document"}</div>
      <div class="markdown-body">
        ${contentHtml}
      </div>
    </div>
  </div>
</body>
</html>`;
}

function startViewerServer(initialFile?: string) {
	const contentNotes = listNotes(path.join(workspace, "content"), "content");
	const sourceNotes = listNotes(path.join(workspace, "sources"), "sources");
	const allNotes = [...contentNotes, ...sourceNotes];

	let selectedRel = initialFile ? path.relative(workspace, path.resolve(initialFile)).replace(/\\/g, "/") : "";
	if (!selectedRel && allNotes.length > 0) {
		selectedRel = allNotes[0].rel;
	}

	const server = http.createServer((req, res) => {
		const parsedUrl = new URL(req.url || "/", "http://127.0.0.1");

		if (parsedUrl.pathname.startsWith("/katex/")) {
			const sub = parsedUrl.pathname.slice("/katex/".length);
			const full = path.join(katexDist, sub);
			if (fs.existsSync(full) && fs.statSync(full).isFile()) {
				const ext = path.extname(full);
				const mime = ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : ext === ".woff2" ? "font/woff2" : ext === ".woff" ? "font/woff" : ext === ".ttf" ? "font/ttf" : "application/octet-stream";
				res.writeHead(200, { "Content-Type": mime });
				fs.createReadStream(full).pipe(res);
				return;
			}
			res.writeHead(404);
			res.end();
			return;
		}

		let activeFile = selectedRel;
		const queryFile = parsedUrl.searchParams.get("file");
		if (queryFile) {
			activeFile = queryFile;
		}

		const fullPath = path.join(workspace, activeFile);
		let rendered = "<p style='color: var(--text-muted)'>No file selected or file not found.</p>";
		let title = "Document";

		if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
			title = path.basename(fullPath);
			const raw = fs.readFileSync(fullPath, "utf-8");
			rendered = renderRich(raw);
		}

		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(renderPage(rendered, title, activeFile, allNotes));
	});

	server.listen(0, "127.0.0.1", () => {
		const port = (server.address() as any).port;
		const url = `http://127.0.0.1:${port}/view`;
		console.log(`[Viewer] Markdown & LaTeX viewer active at: ${url}`);
		
		// Launch browser on Windows
		try {
			childProcess.exec(`start "" "${url}"`);
		} catch {
			// ignore launch failures
		}
	});
}

startViewerServer(targetArg);
