/**
 * document-viewer — In-chat command and tool to view Markdown and LaTeX documents.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as childProcess from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

export default function documentViewer(pi: ExtensionAPI) {
	pi.registerCommand("preview", {
		description: "Open local Markdown & LaTeX document viewer in your browser (Usage: /preview [file])",
		handler: async (args: string, ctx: any) => {
			const cwd = ctx.cwd || process.cwd();
			const scriptPath = path.join(cwd, "scripts", "content-viewer.ts");
			const targetFile = args.trim();

			childProcess.spawn("bun", [scriptPath, targetFile].filter(Boolean), {
				cwd,
				detached: true,
				stdio: "ignore",
			}).unref();

			ctx.ui?.notify?.("Opening Markdown & LaTeX document viewer in browser...", "info");
		},
	});

	pi.registerTool({
		name: "open_document_viewer",
		label: "open document viewer",
		description: "Launch the local browser viewer to render Markdown, LaTeX equations, and Mermaid diagrams for notes in content/ or sources/.",
		promptSnippet: "Call open_document_viewer when the learner wants to view or preview their generated notes, cram sheet, or equations in the browser.",
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Relative or absolute path to the .md or .tex document to preview" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const scriptPath = path.join(cwd, "scripts", "content-viewer.ts");
			const targetFile = params.path ? params.path.trim() : "";

			if (targetFile) {
				const full = path.isAbsolute(targetFile) ? targetFile : path.join(cwd, targetFile);
				if (!fs.existsSync(full)) {
					return { content: [{ type: "text" as const, text: `File not found: ${targetFile}. Viewer launched with available content notes.` }] };
				}
			}

			childProcess.spawn("bun", [scriptPath, targetFile].filter(Boolean), {
				cwd,
				detached: true,
				stdio: "ignore",
			}).unref();

			return {
				content: [{
					type: "text" as const,
					text: `Launched Markdown & LaTeX document viewer in the browser for ${targetFile || "content notes"}. All math equations ($...$ and $$...$$) and diagrams are rendered with local KaTeX.`,
				}],
			};
		},
	});
}
