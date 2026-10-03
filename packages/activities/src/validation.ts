import type { TaskDefinition } from "../../core/src/contracts.ts";

/** Deliberately bounded calculator: no eval, arbitrary code, or LLM self-agreement. */
export function verifyLinearEquation(task: TaskDefinition): boolean {
  if (task.scoring !== "numeric" || task.stakes !== "low") return false;
  const match = task.prompt.match(/^Solve\s+(-?\d+(?:\.\d+)?)x\s*([+-])\s*(\d+(?:\.\d+)?)\s*=\s*(-?\d+(?:\.\d+)?)\.\s*Respond with only the numerical value of x\.$/i);
  if (!match) return false;
  const a = Number(match[1]), b = Number(match[3]) * (match[2] === "+" ? 1 : -1), c = Number(match[4]);
  if (!Number.isFinite(a) || a === 0 || !Number.isFinite(b) || !Number.isFinite(c) || !task.answer?.trim()) return false;
  const answer = Number(task.answer);
  // Strict key checking is independent of an author-selected response tolerance.
  return Number.isFinite(answer) && Math.abs(a * answer + b - c) <= 1e-9;
}
