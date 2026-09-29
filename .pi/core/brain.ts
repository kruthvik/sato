/** Learner-authored preferences. This is self-report, never assessment evidence or policy. */
import * as fs from "node:fs";
import * as path from "node:path";

export function loadBrain(cwd: string): string | null {
	try {
		const file = path.join(cwd, "brain.md");
		if (fs.statSync(file).size > 16_384) return null;
		const source = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file));
		if (source.includes("\0")) return null;
		const withoutComments = source.replace(/<!--[\s\S]*?-->/g, "");
		if (withoutComments.includes("<!--") || withoutComments.includes("-->")) return null;
		const body = withoutComments.replace(/\r?\n---\r?\n\s*(?:\*\*For a new session:\*\*|This file is read automatically at the start of each learning session\.)[\s\S]*$/, "");
		const text = body.split(/\r?\n/)
			.filter((line) => !/^\s*#{1,6}\s/.test(line))
			.filter((line) => !/^Start here\. Write in your own words/.test(line.trim()))
			.join("\n").trim();
		return text || null;
	} catch {
		return null;
	}
}
