import * as fs from "node:fs";
import * as path from "node:path";

const workspace = process.cwd();
const sourceRoot = path.join(workspace, ".pi", "skills");
const agentsRoot = path.join(workspace, ".agents", "skills");
const syncLockRoot = path.join(workspace, ".learn-runtime", ".sync-skills.lock");

function lstatOrNull(target) {
	try {
		return fs.lstatSync(target);
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
}

function assertInsideWorkspace(target) {
	const relative = path.relative(workspace, target);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(`Refusing to sync outside the workspace: ${target}`);
	}
}

function sleep(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireSyncLock() {
	assertInsideWorkspace(syncLockRoot);
	fs.mkdirSync(path.dirname(syncLockRoot), { recursive: true });

	const staleAfterMs = 30_000;
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			fs.mkdirSync(syncLockRoot);
			fs.writeFileSync(path.join(syncLockRoot, "owner.txt"), `${process.pid}\n`, "utf8");
			return;
		} catch (error) {
			if (error?.code !== "EEXIST") throw error;
			const stat = lstatOrNull(syncLockRoot);
			if (stat && Date.now() - stat.mtimeMs > staleAfterMs) {
				fs.rmSync(syncLockRoot, { recursive: true, force: true });
				continue;
			}
			sleep(100);
		}
	}
	throw new Error(`Timed out waiting for skill sync lock: ${syncLockRoot}`);
}

function releaseSyncLock() {
	assertInsideWorkspace(syncLockRoot);
	fs.rmSync(syncLockRoot, { recursive: true, force: true });
}

function relativeFiles(root, current = root) {
	const files = [];
	for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
		const fullPath = path.join(current, entry.name);
		if (entry.isDirectory()) {
			files.push(...relativeFiles(root, fullPath));
		} else if (entry.isFile()) {
			files.push(path.relative(root, fullPath));
		} else {
			throw new Error(`Refusing to replace mirror containing a non-file entry: ${fullPath}`);
		}
	}
	return files.sort();
}

function isExactMirror(source, destination) {
	const sourceFiles = relativeFiles(source);
	const destinationFiles = relativeFiles(destination);
	if (sourceFiles.length !== destinationFiles.length) return false;
	return sourceFiles.every((relativePath, index) =>
		relativePath === destinationFiles[index] &&
		fs.readFileSync(path.join(source, relativePath)).equals(fs.readFileSync(path.join(destination, relativePath))),
	);
}

function createAgentsLink() {
	assertInsideWorkspace(agentsRoot);
	fs.mkdirSync(path.dirname(agentsRoot), { recursive: true });
	const current = lstatOrNull(agentsRoot);

	if (current?.isSymbolicLink()) {
		try {
			if (fs.realpathSync(agentsRoot) === fs.realpathSync(sourceRoot)) {
				console.log(`Verified .agents\\skills link to .pi\\skills`);
				return;
			}
		} catch {
			// A moved workspace leaves an absolute Windows junction broken.
		}
		fs.unlinkSync(agentsRoot);
	} else if (current) {
		if (!current.isDirectory() || !isExactMirror(sourceRoot, agentsRoot)) {
			throw new Error(`Refusing to replace non-canonical agent skills: ${agentsRoot}`);
		}
		// The resolved target is the exact, verified generated mirror inside this workspace.
		fs.rmSync(agentsRoot, { recursive: true, force: true });
	}

	fs.symlinkSync(sourceRoot, agentsRoot, process.platform === "win32" ? "junction" : "dir");
	console.log(`Linked .agents\\skills to canonical .pi\\skills`);
}

/** Remove stale .gemini directory if it exists in the workspace. */
function cleanupLegacyGeminiDir() {
	const geminiDir = path.join(workspace, ".gemini");
	assertInsideWorkspace(geminiDir);
	if (fs.existsSync(geminiDir)) {
		fs.rmSync(geminiDir, { recursive: true, force: true });
		console.log(`Removed stale .gemini directory (canonical skills live in .pi/skills)`);
	}
}

if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
	throw new Error(`Canonical skill directory is missing: ${sourceRoot}`);
}

const skillNames = fs.readdirSync(sourceRoot, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();

acquireSyncLock();
try {
	createAgentsLink();
	cleanupLegacyGeminiDir();
} finally {
	releaseSyncLock();
}
console.log(`Verified ${skillNames.length} skills in .pi\\skills`);
