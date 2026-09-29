/** Render Markdown beneath content/ into mirrored PDFs without changing the source. */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { marked } from "marked";
import puppeteer, { type Browser, type PDFOptions } from "puppeteer";
import sanitizeHtml from "sanitize-html";

const require = createRequire(import.meta.url);
const KATEX_CSS = require.resolve("katex/dist/katex.min.css");
const KATEX_JS = require.resolve("katex/dist/katex.min.js");
const KATEX_AUTO = require.resolve("katex/dist/contrib/auto-render.min.js");
const DEBOUNCE_MS = 750;

type Format = "letter" | "a4";
export type RenderOptions = { format?: Format; landscape?: boolean };

let browserPromise: Promise<Browser> | undefined;
let browserIdleTimer: ReturnType<typeof setTimeout> | undefined;
let watcher: fs.FSWatcher | undefined;
let queue: Promise<unknown> = Promise.resolve();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const comparable = (value: string) => {
	const normalized = path.resolve(value).replaceAll("\\", "/").replace(/\/+$/, "");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};
const inside = (parent: string, child: string) => {
	const p = comparable(parent), c = comparable(child);
	return c === p || c.startsWith(`${p}/`);
};
const escapeHtml = (value: string) => value
	.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
	.replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function contentInput(cwd: string, requested: string): string {
	const root = path.resolve(cwd, "content");
	const input = path.resolve(cwd, requested.trim());
	if (!inside(root, input)) throw new Error("Input must be under content/.");
	if (path.extname(input).toLowerCase() !== ".md") throw new Error("Input must be a .md file.");
	if (!fs.existsSync(input) || !fs.statSync(input).isFile()) throw new Error(`File not found: ${input}`);
	return input;
}

function defaultOutput(cwd: string, input: string): string {
	const root = path.resolve(cwd, "content");
	const relative = path.relative(root, input);
	if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Input must be under content/.");
	return path.resolve(cwd, "content", "exports", "pdf", relative.replace(/\.md$/i, ".pdf"));
}

function contentOutput(cwd: string, input: string, requested?: string): string {
	const output = requested?.trim() ? path.resolve(cwd, requested.trim()) : defaultOutput(cwd, input);
	if (!inside(path.resolve(cwd, "content"), output)) throw new Error("Output must be under content/.");
	if (path.extname(output).toLowerCase() !== ".pdf") throw new Error("Output must be a .pdf file.");
	return output;
}

function clean(html: string): string {
	return sanitizeHtml(html, {
		allowedTags: [...sanitizeHtml.defaults.allowedTags, "article", "section", "figure", "figcaption", "details", "summary", "img", "table", "thead", "tbody", "tfoot", "tr", "th", "td"],
		allowedAttributes: {
			...sanitizeHtml.defaults.allowedAttributes,
			"*": ["class", "id", "title"],
			a: ["href", "name", "target", "rel", "title"],
			img: ["src", "alt", "width", "height", "title"],
			th: ["colspan", "rowspan", "scope"], td: ["colspan", "rowspan"],
		},
		allowedSchemes: ["http", "https", "data", "file"],
		allowProtocolRelative: false,
		transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true) },
	});
}

function pageHtml(body: string, input: string): string {
	const title = escapeHtml(path.basename(input, ".md"));
	const base = `${pathToFileURL(path.dirname(input)).href.replace(/\/$/, "")}/`;
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="${escapeHtml(base)}"><title>${title}</title>
<style>
*{box-sizing:border-box}html,body{background:#fff}body{margin:0 auto;color:#171717;font:11pt/1.55 "Segoe UI",Arial,sans-serif;overflow-wrap:anywhere}
h1,h2,h3,h4,h5,h6{color:#111827;line-height:1.2;break-after:avoid-page}h1{margin:0 0 1.25rem;padding-bottom:.4rem;border-bottom:2px solid #111827;font-size:24pt}h2{margin:1.8rem 0 .7rem;padding-bottom:.25rem;border-bottom:1px solid #d1d5db;font-size:17pt}h3{margin:1.35rem 0 .55rem;font-size:13.5pt}
p,blockquote,ul,ol,table,pre,figure{margin:.75rem 0}a{color:#075985;text-decoration:underline}img{display:block;max-width:100%;max-height:8in;margin:1rem auto;object-fit:contain}blockquote{margin-left:0;padding:.15rem 1rem;color:#374151;border-left:4px solid #9ca3af}
code{padding:.1rem .28rem;border-radius:3px;background:#f3f4f6;font:9.5pt/1.45 Consolas,monospace}pre{padding:.85rem;border:1px solid #d1d5db;border-radius:5px;background:#f8fafc;white-space:pre-wrap;break-inside:avoid-page}pre code{padding:0;background:transparent}
table{width:100%;border-collapse:collapse;font-size:9.5pt}thead{display:table-header-group}tr,img,figure{break-inside:avoid-page}th,td{padding:.42rem .5rem;border:1px solid #cbd5e1;vertical-align:top}th{background:#f1f5f9;text-align:left}hr{border:0;border-top:1px solid #9ca3af}.katex-display{break-inside:avoid-page}.page-break{break-before:page}
@media print{a{color:inherit}}
</style></head><body><main id="content">${body}</main></body></html>`;
}

async function browser(): Promise<Browser> {
	if (browserIdleTimer) { clearTimeout(browserIdleTimer); browserIdleTimer = undefined; }
	if (!browserPromise) {
		browserPromise = puppeteer.launch({ headless: true, args: ["--allow-file-access-from-files"] })
			.then(instance => { instance.on("disconnected", () => { browserPromise = undefined; }); return instance; })
			.catch(error => { browserPromise = undefined; throw error; });
	}
	return browserPromise;
}

function closeBrowserWhenIdle(): void {
	if (browserIdleTimer) clearTimeout(browserIdleTimer);
	browserIdleTimer = setTimeout(() => {
		browserIdleTimer = undefined;
		const pending = browserPromise;
		browserPromise = undefined;
		if (pending) void pending.then(instance => instance.connected ? instance.close() : undefined).catch(() => undefined);
	}, 5_000);
	browserIdleTimer.unref?.();
}

export async function renderMarkdownPdf(inputMd: string, outputPdf: string, options: RenderOptions = {}): Promise<string> {
	const input = path.resolve(inputMd), output = path.resolve(outputPdf);
	if (path.extname(input).toLowerCase() !== ".md") throw new Error("Input must be a .md file.");
	if (path.extname(output).toLowerCase() !== ".pdf") throw new Error("Output must be a .pdf file.");
	if (!fs.existsSync(input) || !fs.statSync(input).isFile()) throw new Error(`File not found: ${input}`);

	const parsed = await marked.parse(fs.readFileSync(input, "utf8"), { gfm: true, breaks: false });
	const instance = await browser();
	const page = await instance.newPage();
	try {
		await page.setRequestInterception(true);
		page.on("request", request => {
			let protocol = "";
			try { protocol = new URL(request.url()).protocol; } catch { /* let Chromium decide */ }
			void ((protocol === "http:" || protocol === "https:") ? request.abort() : request.continue());
		});
		await page.setContent(pageHtml(clean(parsed), input), { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.addStyleTag({ path: KATEX_CSS });
		await page.addScriptTag({ path: KATEX_JS });
		await page.addScriptTag({ path: KATEX_AUTO });
		await page.evaluate(() => {
			const render = (globalThis as any).renderMathInElement;
			const root = document.getElementById("content");
			if (root && render) render(root, { delimiters: [
				{ left: "$$", right: "$$", display: true }, { left: "\\[", right: "\\]", display: true },
				{ left: "\\(", right: "\\)", display: false }, { left: "$", right: "$", display: false },
			], throwOnError: false, ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"] });
		});
		await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map(img => img.complete ? Promise.resolve() : new Promise<void>(done => { img.onload = img.onerror = () => done(); }))); });
		await page.emulateMediaType("print");
		const pdf: PDFOptions = { format: options.format === "a4" ? "A4" : "Letter", landscape: options.landscape ?? false, printBackground: true, margin: { top: ".72in", right: ".72in", bottom: ".72in", left: ".72in" } };
		const bytes = await page.pdf(pdf);
		fs.mkdirSync(path.dirname(output), { recursive: true });
		fs.writeFileSync(output, bytes);
		return output;
	} finally { await page.close().catch(() => undefined); closeBrowserWhenIdle(); }
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
	const next = queue.then(work, work); queue = next.catch(() => undefined); return next;
}

function schedule(cwd: string, input: string, report?: (text: string) => void): void {
	const root = path.resolve(cwd, "content"), excluded = path.join(root, "exports", "pdf");
	input = path.resolve(input);
	if (path.extname(input).toLowerCase() !== ".md" || !inside(root, input) || inside(excluded, input)) return;
	const old = timers.get(input); if (old) clearTimeout(old);
	const timer = setTimeout(() => {
		timers.delete(input); if (!fs.existsSync(input)) return;
		void enqueue(() => renderMarkdownPdf(input, defaultOutput(cwd, input))).catch(error => report?.(`Automatic PDF failed for ${path.relative(cwd, input)}: ${message(error)}`));
	}, DEBOUNCE_MS);
	timer.unref?.(); timers.set(input, timer);
}

function startWatcher(cwd: string, report?: (text: string) => void): void {
	watcher?.close(); const root = path.resolve(cwd, "content"); fs.mkdirSync(root, { recursive: true });
	watcher = fs.watch(root, { recursive: true }, (_event, filename) => { if (filename) schedule(cwd, path.join(root, filename.toString()), report); });
	watcher.on("error", error => report?.(`Markdown PDF watcher stopped: ${message(error)}`));
}

export default function markdownToPdf(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "render_markdown_pdf", label: "render Markdown PDF",
		description: "Render a Markdown file under content/ to PDF while preserving the original. By default the PDF mirrors the source path under content/exports/pdf/.",
		promptSnippet: "Markdown saved under content/ is converted automatically. Call this tool only for an immediate render or custom paper/output options.",
		parameters: Type.Object({ input: Type.String(), output: Type.Optional(Type.String()), format: Type.Optional(Type.Union([Type.Literal("letter"), Type.Literal("a4")])), landscape: Type.Optional(Type.Boolean()) }),
		async execute(_id, params, _signal, _update, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			try {
				const input = contentInput(cwd, params.input), output = contentOutput(cwd, input, params.output);
				await enqueue(() => renderMarkdownPdf(input, output, { format: params.format, landscape: params.landscape }));
				return { content: [{ type: "text" as const, text: `PDF created: ${path.relative(cwd, output)}\nMarkdown preserved: ${path.relative(cwd, input)}` }], details: { input, output } };
			} catch (error) { return { content: [{ type: "text" as const, text: `PDF conversion failed: ${message(error)}` }], isError: true }; }
		},
	});
	pi.registerCommand("pdf", { description: "Render content Markdown (Usage: /pdf content/topics/note.md)", handler: async (args: string, ctx: any) => {
		const cwd = ctx.cwd || process.cwd(), requested = args.trim().replace(/^(["'])(.*)\1$/, "$2");
		if (!requested) return void ctx.ui?.notify?.("Usage: /pdf content/path/note.md", "warning");
		try { const input = contentInput(cwd, requested), output = defaultOutput(cwd, input); await enqueue(() => renderMarkdownPdf(input, output)); ctx.ui?.notify?.(`PDF created: ${path.relative(cwd, output)}`, "success"); }
		catch (error) { ctx.ui?.notify?.(`PDF conversion failed: ${message(error)}`, "error"); }
	} });
	pi.on("session_start", async (_event, ctx) => { const cwd = (ctx as any).cwd || process.cwd(); startWatcher(cwd, text => { console.error(`[markdown-to-pdf] ${text}`); (ctx as any).ui?.notify?.(text, "error"); }); });
	pi.on("session_shutdown", async () => { watcher?.close(); watcher = undefined; for (const timer of timers.values()) clearTimeout(timer); timers.clear(); if (browserIdleTimer) clearTimeout(browserIdleTimer); browserIdleTimer = undefined; await queue.catch(() => undefined); const pending = browserPromise; browserPromise = undefined; if (pending) { try { const instance = await pending; if (instance.connected) await instance.close(); } catch {} } });
}
