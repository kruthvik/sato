import { renderRich, serverGradeItem, taskTypeForItem, validateActivity } from "../.pi/extensions/activity-studio.ts";
import { readFileSync } from "node:fs";

const output = renderRich(`## Formula

| Rule | Value |
|---|---|
| Area | $A=\\pi r^2$ |

<script>alert(1)</script>`);

if (!output.includes("<table>")) throw new Error("Markdown table did not render");
if (!output.includes("katex")) throw new Error("LaTeX did not render through KaTeX");
if (output.includes("<script>")) throw new Error("Unsafe HTML was not sanitized");

// 1. Currency test: ensure $40,000 and $15,000 are not mangled as math
const currencyOutput = renderRich("At June 1, WestCo had total assets of $40,000 and total liabilities of $15,000.");
if (currencyOutput.includes("katex")) throw new Error("Currency was falsely converted to KaTeX math");
if (!currencyOutput.includes("$40,000") || !currencyOutput.includes("$15,000")) throw new Error("Currency amounts were corrupted");

// 2. Code with dollar test: ensure `$var` in code is not converted to math
const codeOutput = renderRich("Look at `$var1` and `$var2` in code.");
if (codeOutput.includes("katex")) throw new Error("Code backticks were falsely converted to KaTeX math");
if (!codeOutput.includes("<code>$var1</code>") || !codeOutput.includes("<code>$var2</code>")) throw new Error("Code tokens corrupted");

// 3. Display math with aligned environment: ensure no LASMATHTOKEN leak
const alignedOutput = renderRich("$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$");
if (alignedOutput.includes("LASMATHTOKEN")) throw new Error("LASMATHTOKEN leaked into KaTeX rendering");
if (!alignedOutput.includes("katex-display")) throw new Error("Display math did not render");

// 4. Inline math test
const inlineOutput = renderRich("Solve for $x$: $x + 2 = 5$");
if (!inlineOutput.includes("katex")) throw new Error("Inline math did not render");

// 5. Cloze prompt preservation
const clozeOutput = renderRich("The formula is $E = mc^2$, where $m$ is [[1]] and $c$ is [[2]].");
if (!clozeOutput.includes("[[1]]") || !clozeOutput.includes("[[2]]")) throw new Error("Cloze blank markers were corrupted");
if (!clozeOutput.includes("katex")) throw new Error("Cloze math did not render");

const template = readFileSync(".pi/skills/activity-studio/assets/activity-runner.html", "utf8");
const browserScript = template.match(/<script>([\s\S]*?)<\/script>/)?.[1]
	?.replace("__LAS_ACTIVITY__", JSON.stringify({
		items: [
			{ id: "s1", type: "speaking", prompt: "Say hello", expectedPhrase: "hola", points: 1 },
			{ id: "sh1", type: "sheet", prompt: "Record journal entry", columns: ["Date", "Account", "Debit ($)", "Credit ($)"], points: 2 },
			{ id: "e1", type: "expression", prompt: "Write the expression", answer: "x^2", points: 2 },
			{ id: "i1", type: "integral", prompt: "Integrate 2x", integrand: "2x", variable: "x", answer: "x^2+C", points: 2 },
		]
	}))
	.replace("__LAS_API__", JSON.stringify("http://127.0.0.1"));
if (!browserScript) throw new Error("Activity runner script was not found");
new Function(browserScript); // Test harness parses, but the actual browser runner never executes learner-supplied JS.
if (template.includes("new Function(") || template.includes("apiKey=00000000000000000000000000000000")) throw new Error("Browser activity executes injected code or embeds an external key");
if (serverGradeItem({ type: "text", points: 1, acceptedAnswers: ["yes"] }, "").correct !== false) throw new Error("Empty short answer passed automatically");
if (serverGradeItem({ type: "text", points: 1, containsAll: ["cause", "effect"] }, "cause only").correct !== false) throw new Error("Incomplete text passed automatically");
if (serverGradeItem({ type: "numeric", points: 1, answer: 0 }, "").correct !== false) throw new Error("Empty numeric response became zero");
if (serverGradeItem({ type: "integral", points: 2, answer: "x^2+C" }, "x*x + C").correct !== null) throw new Error("Unrecognized equivalent integral was scored as wrong instead of pending review");
if (taskTypeForItem({ type: "choice" }, "simulation") !== "recognition") throw new Error("Simulation MCQ was promoted to application evidence");
const invalid = validateActivity({ title: "Check", topic: "math", objective: "Test", items: [{ id: "a", type: "choice", skill: "s", prompt: "Which?", options: ["A", "B"], answer: "A", explanation: "Because", points: 1, taskType: "far-transfer" }] });
if (!invalid.errors.some(error => error.includes("promote selection"))) throw new Error("Invalid MCQ evidence type was accepted");
for (const type of ["interactive", "custom", "desmos"]) {
  const rejected = validateActivity({ title: "Check", topic: "math", objective: "Test", items: [{ id: "a", type, skill: "s", prompt: "Perform", explanation: "Because", points: 1 }] });
  if (!rejected.errors.some(error => error.includes("unsupported"))) throw new Error(`Executable or externally dependent ${type} item was accepted`);
}
console.log("PASS: Activity grading protects independent evidence and flags symbolic review");
console.log("PASS: Activity rich-content pipeline renders Markdown and LaTeX safely");
console.log("PASS: Activity browser runtime parses successfully");
