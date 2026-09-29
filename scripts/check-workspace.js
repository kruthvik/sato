import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const isTest = process.argv.includes("--test");
const isLint = process.argv.includes("--lint");

let errors = 0;
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    errors++;
  } else {
    console.log(`PASS: ${message}`);
  }
}

// 1. Check the PowerShell launcher and CMD compatibility shim
const learnCmd = fs.readFileSync("learn.cmd", "utf8");
const learnPs1 = fs.readFileSync("learn.ps1", "utf8");
assert(learnCmd.includes('learn.ps1" %*'), "learn.cmd delegates all arguments to learn.ps1");
assert(learnCmd.includes("exit /b %errorlevel%"), "learn.cmd propagates the PowerShell launcher's exit code");
assert(learnPs1.includes('Assert-WorkspaceChild (Join-Path $workspace ".learn-runtime")'), "learn.ps1 keeps the Pi profile inside the workspace");
assert(learnPs1.includes('$agentDir.Equals($defaultAgentDir'), "learn.ps1 rejects profile aliasing with global Pi");
assert(!learnPs1.includes('Copy-Item -LiteralPath $source'), "learn.ps1 never imports credentials from outside the workspace");
assert(learnPs1.includes('Isolated settings reference the global Pi profile'), "learn.ps1 doctor detects global-profile path leakage");
assert(learnPs1.includes('Profile isolation verified'), "learn.ps1 doctor reports effective profile isolation");
assert(learnPs1.includes('"--exclude-tools", "bash,powershell"') && learnPs1.includes("function Invoke-LearnPi"), "learner-facing Pi sessions do not expose raw shell tools");
assert(learnPs1.includes('Package = "npm:pi-subagents"'), "learn.ps1 provisions the subagent runtime");
assert(learnPs1.includes('Package = "npm:@juicesharp/rpiv-ask-user-question"'), "learn.ps1 provisions learner question UI");
assert(learnPs1.includes('Package = "npm:pi-web-search-and-fetch"'), "learn.ps1 provisions background researcher web tools");
assert(learnPs1.includes('Package = "npm:pi-antigravity"'), "learn.ps1 provisions the Antigravity Gemini provider");
assert(learnPs1.includes("Assert-WorkspaceChild"), "learn.ps1 guards destructive paths inside the workspace");
assert(learnPs1.includes('"/doctor"'), "learn.ps1 exposes a runtime doctor command");
const settingsCmd = fs.readFileSync("settings.cmd", "utf8");
assert(settingsCmd.includes("Settings ^& Integration Hub"), "settings.cmd escapes its user-facing ampersand");
assert(settingsCmd.includes("exit /b %SETTINGS_EXIT_CODE%"), "settings.cmd propagates the settings server exit code");

// 2. Check JSON validity in _learning
const jsonDirs = ["_learning/graphs", "_learning/mastery", "_learning/reviews"];
for (const dir of jsonDirs) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".json")) {
      try {
        JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        assert(true, `Valid JSON: ${path.join(dir, f)}`);
      } catch (e) {
        assert(false, `Invalid JSON in ${path.join(dir, f)}: ${e.message}`);
      }
    }
  }
}

if (fs.existsSync("_learning/current-session.json")) {
  try {
    const s = JSON.parse(fs.readFileSync("_learning/current-session.json", "utf8"));
    assert(s.topic && s.mode, "_learning/current-session.json has topic and mode");
  } catch (e) {
    assert(false, `Invalid current-session.json: ${e.message}`);
  }
}

// 3. Check agent definitions
const agentsDir = ".pi/agents";
for (const file of fs.readdirSync(agentsDir)) {
  if (!file.endsWith(".md")) continue;
  const content = fs.readFileSync(path.join(agentsDir, file), "utf8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert(Boolean(match), `Agent ${file} has frontmatter`);
  if (match) {
    assert(!match[1].includes("anthropic/claude-sonnet-5"), `Agent ${file} does not hardcode unauthenticated anthropic model`);
  }
}

// 4. Check visual-tools imports and cross-platform paths
const commonSrc = fs.readFileSync(".pi/extensions/visual-tools/tools/_common.ts", "utf8");
assert(commonSrc.includes("delimiter"), "visual-tools/_common.ts uses path delimiter");
assert(commonSrc.includes("chrome.exe"), "visual-tools/_common.ts includes Windows Chrome paths");

// 5. Check web-memorize extension
const webMemorizeSrc = fs.readFileSync(".pi/extensions/web-memorize.ts", "utf8");
assert(webMemorizeSrc.includes("open_memorize_web"), "web-memorize.ts declares open_memorize_web");
assert(webMemorizeSrc.includes('registerCommand("memorize"'), "web-memorize.ts registers /memorize command with string name");
assert(webMemorizeSrc.includes('registerCommand("flashcards"'), "web-memorize.ts registers /flashcards command with string name");
assert(webMemorizeSrc.includes("Bönstrup"), "web-memorize.ts implements micro-rest consolidation");
assert(webMemorizeSrc.includes("win32"), "web-memorize.ts handles Windows browser launching");
assert(webMemorizeSrc.includes('"content", "exports"'), "web memorizer preserves learner-visible decks under content/exports");

// 6. Learning plans must be scoped to the Pi chat, not loaded from the
// workspace-wide dashboard mirror. This is what makes /new start clean and
// /resume restore only the selected conversation's plan.
const learningSessionSrc = fs.readFileSync(".pi/extensions/learning-session.ts", "utf8");
assert(learningSessionSrc.includes("ctx.sessionManager.getSessionId()"), "learning sessions are keyed to the Pi chat id");
assert(learningSessionSrc.includes("ctx.sessionManager.getBranch()"), "learning sessions restore state from the active chat branch");
assert(learningSessionSrc.includes("pi.appendEntry(SESSION_ENTRY_TYPE, session)"), "learning session snapshots persist in the Pi chat");
assert(learningSessionSrc.includes("session.chatSessionId === chatSessionId"), "forked or unrelated chats cannot inherit session state");
const loadSessionBody = learningSessionSrc.slice(
  learningSessionSrc.indexOf("function loadSession"),
  learningSessionSrc.indexOf("function saveSession"),
);
assert(!loadSessionBody.includes("readFileSync"), "current-session.json is not used to resume a chat");

// 7. Activity Studio language and browser runtime
const activityStudioSrc = fs.readFileSync(".pi/extensions/activity-studio.ts", "utf8");
const activitySkillSrc = fs.readFileSync(".pi/skills/activity-studio/SKILL.md", "utf8");
const activitySpecSrc = fs.readFileSync(".pi/skills/activity-studio/references/activity-spec.md", "utf8");
const activityRunnerSrc = fs.readFileSync(".pi/skills/activity-studio/assets/activity-runner.html", "utf8");
assert(activityStudioSrc.includes('name: "open_learning_activity"'), "activity-studio registers its launch tool");
assert(activityStudioSrc.includes('name: "get_activity_results"'), "activity-studio registers its result tool");
assert(activityStudioSrc.includes('"integral"'), "activity-studio supports integral items");
assert(activitySkillSrc.includes("Learning contract"), "activity-studio skill keeps activities aligned with learning goals");
assert(activitySpecSrc.includes("Learning Activity Spec (LAS) 1.1"), "activity-studio documents the LAS language");
assert(activityRunnerSrc.includes("symbolicMatch") && !activityRunnerSrc.includes("new Function("), "activity runner avoids executing generated symbolic expressions; noncanonical forms need review");
assert(activityRunnerSrc.includes("/api/activity-result"), "activity runner syncs browser evidence back to Pi");
assert(activityStudioSrc.includes('import { marked } from "marked"'), "activity-studio compiles Markdown");
assert(activityStudioSrc.includes('import katex from "katex"'), "activity-studio compiles LaTeX");
assert(activityStudioSrc.includes('sanitizeHtml'), "activity-studio sanitizes rich content");
assert(activityStudioSrc.includes('"content"'), "activity-studio supports ungraded content blocks");
assert(activityStudioSrc.includes('"content", "activities"'), "activity-studio writes learner-visible activity notes under content/");
assert(activitySkillSrc.includes("commit → retrieve/generate → feedback → contrast → changed case → later reassessment"), "activity-studio applies the integrated learning architecture");
assert((activitySkillSrc.match(/^---$/gm) || []).length === 2, "activity-studio skill has one clean frontmatter block");
assert(activityRunnerSrc.includes('data-preset="editorial"') && activityRunnerSrc.includes('data-preset="midnight"'), "activity runner ships distinct visual presets");
assert(activityRunnerSrc.includes("items-grid") && activityRunnerSrc.includes('data-layout="split"'), "activity runner supports responsive composed layouts");
const memorizeSrc = fs.readFileSync(".pi/extensions/web-memorize.ts", "utf8");
for (const sharedToken of ["#080808", "#111111", "Space Grotesk", "JetBrains Mono"]) {
  assert(activityRunnerSrc.includes(sharedToken) && memorizeSrc.includes(sharedToken), `activity runner shares the ${sharedToken} browser design token`);
}
const settingsSrc = fs.readFileSync("scripts/settings-server.ts", "utf8");
assert(settingsSrc.includes("--canvas: #080808") && settingsSrc.includes("Space Grotesk") && memorizeSrc.includes('data-theme="dark"'), "settings, activity and memorizer share a dark default visual system");
assert((activityRunnerSrc.match(/:root\s*\{/g) || []).length === 1 && !activityRunnerSrc.includes("Minimal AI Study Platform"), "activity runner has one canonical theme layer, not a hidden light override");
assert(![settingsSrc, memorizeSrc, activityRunnerSrc].some((source) => source.includes("fonts.googleapis.com") || /<link[^>]+cdn\.jsdelivr\.net/.test(source)), "browser surfaces do not require external fonts or CSS CDN");

// 8. Fast/cram explanation and real subagent usage
const fastLearnSrc = fs.readFileSync(".pi/skills/fast-learn/SKILL.md", "utf8");
const cramSrc = fs.readFileSync(".pi/skills/cram/SKILL.md", "utf8");
const studentAgentSrc = fs.readFileSync(".pi/agents/student.md", "utf8");
assert(fastLearnSrc.includes("mandatory once per sprint"), "fast-learn requires a Feynman inversion");
assert(cramSrc.includes("Compressed Feynman Inversion (`student` subagent—mandatory)"), "cram requires a compressed Feynman inversion");
assert(fastLearnSrc.includes('subagent({ agent: "student"') && cramSrc.includes('subagent({ agent: "student"'), "fast/cram invoke the student subagent explicitly");
assert(fastLearnSrc.includes('action: "resume"') && cramSrc.includes("resume the same child"), "fast/cram preserve one student child across the teach-back");
assert(fastLearnSrc.includes('agent: "researcher"') && cramSrc.includes('agent: "researcher"'), "fast/cram explicitly invoke the researcher when facts need verification");
assert(studentAgentSrc.includes("One turn, one question"), "student subagent supports parent-mediated learner dialogue");
const learningRuntimeCheckSrc = fs.readFileSync(".pi/extensions/learning-runtime-check.ts", "utf8");
const explainSrc = fs.readFileSync(".pi/extensions/explain.ts", "utf8");
assert(learningRuntimeCheckSrc.includes('registerCommand("learning-doctor"'), "learning runtime exposes a provider health check");
assert(learningRuntimeCheckSrc.includes('name: "subagent"'), "learning runtime checks the subagent provider");
assert(learningRuntimeCheckSrc.includes('name: "ask_for_explanation"'), "learning runtime checks the open explanation provider");
assert(explainSrc.includes('name: "ask_for_explanation"'), "open explanation tool is registered");
assert(fastLearnSrc.includes("ask_for_explanation") && cramSrc.includes("ask_for_explanation"), "fast/cram use genuine open learner responses");
assert(fastLearnSrc.includes("content/topics/") && cramSrc.includes("content/sessions/cram-sheet-"), "learner-facing fast/cram exports are stored under content/");

// 9. Learner-visible content and Obsidian persistence
assert(!fs.existsSync(".pi/extensions/md-log.ts"), "md logger extension is removed");
assert(!fs.existsSync(".pi/core/md-viewer.ts"), "lesson viewer helper is removed");
const markdownPdfSrc = fs.readFileSync(".pi/extensions/markdown-to-pdf.ts", "utf8");
assert(markdownPdfSrc.includes('name: "render_markdown_pdf"'), "Markdown PDF extension registers its render tool");
assert(markdownPdfSrc.includes('registerCommand("pdf"'), "Markdown PDF extension registers /pdf");
assert(markdownPdfSrc.includes('fs.watch(root, { recursive: true }'), "Markdown PDF extension watches learner-visible Markdown recursively");
assert(markdownPdfSrc.includes('"content", "exports", "pdf"'), "Markdown PDF extension mirrors output under content/exports/pdf");
assert(markdownPdfSrc.includes('sanitizeHtml'), "Markdown PDF extension sanitizes rendered Markdown");
const noteMakerSrc = fs.readFileSync(".pi/agents/note-maker.md", "utf8");
const ankiMakerSrc = fs.readFileSync(".pi/agents/anki-maker.md", "utf8");
assert(noteMakerSrc.includes("content/topics/<topic>.md"), "evergreen notes are stored in content/topics");
assert(ankiMakerSrc.includes("content/exports/anki_export.tsv"), "Anki exports are stored in content/exports");
assert(fs.existsSync("content/README.md"), "content/ documents the learner-visible storage contract");
assert(
  fs.realpathSync(".agents/skills").toLowerCase() === fs.realpathSync(".pi/skills").toLowerCase(),
  ".agents skills resolve to the canonical .pi tree without Pi skill collisions",
);
for (const skill of ["teach", "fast-learn", "cram", "project", "scaffold", "activity-studio", "visualize", "exam-drill"]) {
  const canonical = fs.readFileSync(`.pi/skills/${skill}/SKILL.md`, "utf8");
  assert(canonical.startsWith(`---\nname: ${skill}\ndescription:`) || canonical.startsWith(`---\r\nname: ${skill}\r\ndescription:`), `${skill} has valid discovery frontmatter`);
  const mirror = `.agents/skills/${skill}/SKILL.md`;
  assert(fs.existsSync(mirror), `.agents ${skill} skill exists`);
  if (fs.existsSync(mirror)) {
	assert(fs.readFileSync(mirror, "utf8") === canonical, `.agents ${skill} skill matches .pi`);
  }
}

if (isTest) {
  // Test loading visual tools source files and parsing them
  const mermaidSrc = fs.readFileSync(".pi/extensions/visual-tools/tools/mermaid_tools.ts", "utf8");
  const svgSrc = fs.readFileSync(".pi/extensions/visual-tools/tools/svg_tools.ts", "utf8");
  assert(mermaidSrc.includes("write_mermaid"), "mermaid_tools.ts declares write_mermaid");
  assert(mermaidSrc.includes("edit_mermaid"), "mermaid_tools.ts declares edit_mermaid");
  assert(mermaidSrc.includes("render_mermaid"), "mermaid_tools.ts declares render_mermaid");
  assert(svgSrc.includes("write_svg"), "svg_tools.ts declares write_svg");
  assert(svgSrc.includes("edit_svg"), "svg_tools.ts declares edit_svg");
  assert(svgSrc.includes("render_svg"), "svg_tools.ts declares render_svg");
}

if (errors > 0) {
  process.exit(1);
}
console.log(`\nAll checks passed cleanly.`);
