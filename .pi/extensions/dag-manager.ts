/** Typed domain multigraph with prerequisite-gated progression. */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { migrateLegacyGraph, relatedNodes, validateDomainGraph, type DomainEdge, type DomainGraph, type DomainNode } from "../core/domain-graph.ts";
import { selectNextAction, type ExamBlueprint } from "../core/action-selector.ts";
import { getActionEligibilityReport } from "../core/action-taxonomy.ts";
import { getSessionMemoryController } from "../core/memory-controller.ts";
import { loadLearnerState, modeReadiness } from "../core/learning-events.ts";
import { loadPolicy, modePolicy, type LearningMode } from "../core/policy.ts";
import { logDecisionEvent, type DecisionEventV1 } from "../core/policy-evaluator.ts";
import { readSessionForContext } from "./learning-session.ts";
import { readDeliveryContext } from "../core/teaching-context.ts";

type NodeState = "ready" | "unlocked" | "active" | "locked";
interface NodeStatus { state: NodeState; lifecycle: string; summaryScore: number; blockedBy: string[]; openGaps: number; }
interface StoredGraph extends DomainGraph { status: Record<string, NodeStatus>; mode: LearningMode; readinessLabel: string; }

function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "general"; }
function graphPath(cwd: string, topic: string): string { return path.join(cwd, "_learning", "graphs", `${slug(topic)}.json`); }
function notePath(cwd: string, topic: string): string { return path.join(cwd, "_learning", "graphs", `${slug(topic)}.md`); }

function formatForDeliverable(deliverable: string): string | undefined {
	if (deliverable === "objective-exam") return "multiple-choice";
	if (deliverable === "quantitative-exam") return "symbolic";
	return undefined;
}

function loadGraph(cwd: string, topic: string): StoredGraph | null {
	const file = graphPath(cwd, topic);
	if (!fs.existsSync(file)) return null;
	try {
		const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
		const graph = migrateLegacyGraph(raw);
		return { ...graph, status: raw.status || {}, mode: raw.mode || "teach", readinessLabel: raw.readinessLabel || "provisional mastery" };
	} catch { return null; }
}
function saveGraph(cwd: string, graph: StoredGraph): void {
	fs.mkdirSync(path.dirname(graphPath(cwd, graph.topic)), { recursive: true });
	graph.lastUpdated = new Date().toISOString();
	fs.writeFileSync(graphPath(cwd, graph.topic), JSON.stringify(graph, null, 2), "utf-8");
}

function prerequisites(graph: DomainGraph, nodeId: string): string[] {
	return graph.edges.filter((edge) => edge.type === "prerequisite" && edge.to === nodeId).map((edge) => edge.from);
}

function computeStatus(cwd: string, graph: DomainGraph, mode: LearningMode): Record<string, NodeStatus> {
	const learner = loadLearnerState(cwd, graph.topic);
	const status: Record<string, NodeStatus> = {};
	const isReady = (id: string) => {
		const state = learner.skills[id];
		return state ? modeReadiness(state, mode).ready : false;
	};
	for (const node of graph.nodes) {
		const state = learner.skills[node.id];
		const blockedBy = prerequisites(graph, node.id).filter((id) => !isReady(id));
		const ready = state ? modeReadiness(state, mode).ready : false;
		const openGaps = state?.gapCases.filter((gap) => gap.status !== "cleared").length || 0;
		status[node.id] = {
			state: ready ? "ready" : blockedBy.length ? "locked" : state ? "active" : "unlocked",
			lifecycle: state?.lifecycleState || "unseen", summaryScore: state?.legacyModelScore || 0,
			blockedBy, openGaps,
		};
	}
	return status;
}

function downstreamCount(graph: DomainGraph, nodeId: string): number {
	const seen = new Set<string>();
	const stack = [nodeId];
	while (stack.length) {
		const current = stack.pop()!;
		for (const edge of graph.edges.filter((candidate) => candidate.type === "prerequisite" && candidate.from === current)) {
			if (!seen.has(edge.to)) { seen.add(edge.to); stack.push(edge.to); }
		}
	}
	return seen.size;
}
function priorityRank(priority?: DomainNode["priority"]): number { return priority === "tier-1" ? 0 : priority === "tier-3" ? 2 : 1; }

function note(graph: StoredGraph): string {
	const lines = ["---", "tags: [learning/domain-graph]", `topic: ${graph.topic}`, `mode: ${graph.mode}`, `policy-gate: ${JSON.stringify(graph.readinessLabel)}`, `last-updated: ${new Date().toISOString()}`, "---", "", `# ${graph.topic} — Domain Graph`, "", "> Progression is based on explicit evidence gates and unresolved gaps, never a scalar score.", "", "```mermaid", "graph TD"];
	for (const node of graph.nodes) lines.push(`    ${node.id}["${node.label.replace(/"/g, "'")} · ${graph.status[node.id]?.state || "locked"}"]`);
	for (const edge of graph.edges.filter((candidate) => candidate.type === "prerequisite")) lines.push(`    ${edge.from} --> ${edge.to}`);
	lines.push("```", "", "## Typed relations", "", "| From | Relation | To |", "|---|---|---|");
	for (const edge of graph.edges) lines.push(`| ${edge.from} | ${edge.type} | ${edge.to} |`);
	lines.push("", "## Evidence status", "", "| Object | Type | Lifecycle | Gate | Open gaps |", "|---|---|---|---|---:|");
	for (const node of graph.nodes) { const s = graph.status[node.id]; lines.push(`| ${node.label} | ${node.type} | ${s.lifecycle} | ${s.state} | ${s.openGaps} |`); }
	return lines.join("\n");
}

const NODE_TYPES = ["concept", "fact", "procedure", "misconception", "example", "non-example", "analogy", "representation", "transfer-target", "assessment-objective", "axiom", "derived", "goal"] as const;
const RELATIONS = ["prerequisite", "component", "confusable-with", "analogous-to", "represented-by", "transfers-to", "boundary-of", "misconception-about", "assessed-by"] as const;
function literals(values: readonly string[]) { return Type.Union(values.map((value) => Type.Literal(value)) as any); }
const NodeSchema = Type.Object({
	id: Type.String(), label: Type.String(), type: literals(NODE_TYPES),
	priority: Type.Optional(literals(["tier-1", "tier-2", "tier-3"])), assessmentWeight: Type.Optional(Type.Number({ minimum: 0 })),
	importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })), expectedDifficulty: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
	decisionCues: Type.Optional(Type.Array(Type.String())), knownErrors: Type.Optional(Type.Array(Type.String())), representations: Type.Optional(Type.Array(Type.String())),
	nearTransferContexts: Type.Optional(Type.Array(Type.String())), farTransferContexts: Type.Optional(Type.Array(Type.String())), contentVersion: Type.Optional(Type.String()), sourceIds: Type.Optional(Type.Array(Type.String())),
});
const EdgeSchema = Type.Object({ from: Type.String(), to: Type.String(), type: Type.Optional(literals(RELATIONS)), weight: Type.Optional(Type.Number({ minimum: 0 })), evidenceCount: Type.Optional(Type.Integer({ minimum: 0 })) });
const ModeSchema = Type.Union([Type.Literal("teach"), Type.Literal("fast-learn"), Type.Literal("cram"), Type.Literal("project"), Type.Literal("exam-drill")]);

export default function domainGraphManager(pi: ExtensionAPI) {
	pi.registerTool({
		name: "save_dag", label: "save domain graph",
		description: "Save a typed domain multigraph. Prerequisite edges must remain acyclic; confusion, analogy, representation, misconception, component, assessment, and transfer relations may be cyclic.",
		promptSnippet: "Map prerequisites plus confusions, representations, misconceptions, analogies, components, boundaries, and transfer targets. A prerequisite-only graph is insufficient for adaptive task selection.",
		parameters: Type.Object({ topic: Type.String(), nodes: Type.Array(NodeSchema), edges: Type.Array(EdgeSchema), mode: Type.Optional(ModeSchema) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const mode = (params.mode || "teach") as LearningMode;
			const normalizedNodes = (params.nodes as any[]).map((node) => ({
				...node,
				type: node.type === "axiom" ? "fact" : node.type === "derived" ? "concept" : node.type === "goal" ? "assessment-objective" : node.type,
				contentVersion: node.contentVersion || "v1",
			}));
			const graph: StoredGraph = {
				version: 2, topic: params.topic.trim(), nodes: normalizedNodes as DomainNode[],
				edges: (params.edges as any[]).map((edge) => ({ ...edge, type: edge.type || "prerequisite" })) as DomainEdge[],
				status: {}, mode, readinessLabel: modePolicy(loadPolicy(cwd), mode).readinessLabel, lastUpdated: new Date().toISOString(),
			};
			const errors = validateDomainGraph(graph);
			if (errors.length) return { content: [{ type: "text" as const, text: `Domain graph rejected:\n- ${errors.join("\n- ")}` }], details: { errors }, isError: true };
			graph.status = computeStatus(cwd, graph, mode);
			saveGraph(cwd, graph);
			fs.writeFileSync(notePath(cwd, graph.topic), note(graph), "utf-8");
			const counts = Object.fromEntries(RELATIONS.map((relation) => [relation, graph.edges.filter((edge) => edge.type === relation).length]));
			return { content: [{ type: "text" as const, text: `Saved typed domain graph for ${graph.topic}: ${graph.nodes.length} objects, ${graph.edges.length} relations. Relation counts: ${Object.entries(counts).filter(([, count]) => count).map(([type, count]) => `${type}=${count}`).join(", ") || "none"}.` }], details: graph };
		},
	});

	pi.registerTool({
		name: "query_dag", label: "query domain graph", description: "Query live evidence-gated object status and typed learning relations.",
		parameters: Type.Object({ topic: Type.String(), mode: Type.Optional(ModeSchema) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const graph = loadGraph(cwd, params.topic);
			if (!graph) return { content: [{ type: "text" as const, text: `No domain graph found for ${params.topic}.` }] };
			const mode = (params.mode || graph.mode || "teach") as LearningMode;
			graph.mode = mode; graph.readinessLabel = modePolicy(loadPolicy(cwd), mode).readinessLabel; graph.status = computeStatus(cwd, graph, mode);
			saveGraph(cwd, graph); fs.writeFileSync(notePath(cwd, graph.topic), note(graph), "utf-8");
			const lines = [`Domain graph: ${graph.topic}`, `Mode gate: ${graph.readinessLabel}`, ""];
			for (const node of graph.nodes) { const s = graph.status[node.id]; lines.push(`${s.state === "ready" ? "✓" : s.state === "locked" ? "🔒" : "→"} ${node.label} [${node.type}] — ${s.lifecycle}${s.blockedBy.length ? `; blocked by ${s.blockedBy.join(", ")}` : ""}${s.openGaps ? `; ${s.openGaps} open gap(s)` : ""}`); }
			return { content: [{ type: "text" as const, text: lines.join("\n") }], details: graph };
		},
	});

	pi.registerTool({
		name: "unlock_next", label: "select next learning object",
		description: "Return evidence-gated objects ordered by importance, prerequisite leverage, weakness, and relation-driven instructional need.",
		promptSnippet: "In a structured learning session, call before introducing a new mapped target. Use the selection reason to choose acquisition, retrieval, contrast, representation conversion, misconception repair, or transfer, not generic repetition. A focused one-off answer needs no graph or action selection.",
		parameters: Type.Object({ topic: Type.String(), mode: Type.Optional(ModeSchema) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const graph = loadGraph(cwd, params.topic);
			if (!graph) return { content: [{ type: "text" as const, text: `No domain graph found for ${params.topic}.` }] };
			const mode = (params.mode || graph.mode || "teach") as LearningMode;
			graph.status = computeStatus(cwd, graph, mode);
			const learner = loadLearnerState(cwd, graph.topic);

			// Read only the plan embedded in this Pi chat. current-session.json is a
			// dashboard mirror and may belong to another chat.
			const activeSession = readSessionForContext(ctx);
			const sessionMatches = activeSession?.topic.toLowerCase() === graph.topic.toLowerCase();
			const targetDeadline = sessionMatches ? activeSession.deadline : null;
			const deliverable = sessionMatches ? activeSession.deliverable : "general";
			const sessionMinutesRemaining = sessionMatches
				? activeSession.phases
					.filter((phase) => phase.status !== "complete" && phase.status !== "skipped")
					.reduce((sum, phase) => sum + phase.minutes, 0)
				: undefined;

			// Run research-backed central action selector optimization.
			const sessionId = (ctx as { sessionManager?: { getSessionId?: () => string } }).sessionManager?.getSessionId?.() || "session-unlock";
			const memoryController = getSessionMemoryController(sessionId);
			const learnableNodes = graph.nodes.filter((node) =>
				!["misconception", "example", "non-example", "analogy", "representation"].includes(node.type),
			);
			const blueprint: ExamBlueprint = {
				topic: graph.topic,
				targetDeadline,
				sessionMinutesRemaining,
				protectedBufferMinutes: 10,
				requiredFormat: formatForDeliverable(deliverable),
				masteryThreshold: 0.8,
				kcs: learnableNodes.map((node) => ({
					id: node.id,
					weight: node.assessmentWeight ?? node.importance ?? (1 / Math.max(1, learnableNodes.length)),
					targetReadiness: 0.8,
				})),
			};
			const selection = selectNextAction(learner, blueprint, graph, new Date(), undefined, memoryController);
			const { preferences: learnerPreferences, garage: garageContext } = readDeliveryContext(cwd, graph.topic);

			const available = graph.nodes.filter((node) => ["unlocked", "active"].includes(graph.status[node.id].state)).sort((a, b) => {
				const tier = priorityRank(a.priority) - priorityRank(b.priority); if (tier) return tier;
				const valueA = (a.assessmentWeight || a.importance || 0.5) * (1 + downstreamCount(graph, a.id)) * (1 - (learner.skills[a.id]?.legacyModelScore || 0));
				const valueB = (b.assessmentWeight || b.importance || 0.5) * (1 + downstreamCount(graph, b.id)) * (1 - (learner.skills[b.id]?.legacyModelScore || 0));
				return valueB - valueA;
			});
			if (!available.length && !selection.allScored.length) return { content: [{ type: "text" as const, text: graph.nodes.every((node) => graph.status[node.id].state === "ready") ? `All objects satisfy the ${mode} evidence gate. Schedule delayed verification rather than more same-session practice.` : "No object is currently available; repair the blocked prerequisite evidence or unresolved critical gap." }] };
			const selected = available.map((node) => {
				const state = learner.skills[node.id];
				const confusions = relatedNodes(graph, node.id, "confusable-with");
				const representations = relatedNodes(graph, node.id, "represented-by");
				const transfers = relatedNodes(graph, node.id, "transfers-to");
				let reason = state ? "retrieve" : "acquire";
				if (state?.discrimination.mean < 0.55 && confusions.length) reason = `discriminate from ${confusions.map((item) => item.label).join(", ")}`;
				else if (state?.representationFlexibility.mean < 0.55 && representations.length) reason = `translate representation via ${representations.map((item) => item.label).join(", ")}`;
				else if (state?.application.mean >= 0.6 && state.transfer.mean < 0.55 && transfers.length) reason = `transfer to ${transfers.map((item) => item.label).join(", ")}`;
				else if (state?.gapCases.some((gap) => gap.status !== "cleared")) reason = "repair and later verify an open gap";
				return { id: node.id, label: node.label, reason, downstream: downstreamCount(graph, node.id) };
			});

			const topAction = selection.action;
			const lines = [
				`Optimal Next Action for ${graph.topic}:`,
				`→ [ACTION: ${topAction.actionType}] ${topAction.itemTitle} (Estimated duration: ${topAction.estimatedDurationMin}m)`,
				`  Rate of Exam Gain: ${selection.rateOfGain.toFixed(3)} net gain/min | Selection Propensity: ${(selection.propensity * 100).toFixed(1)}%`,
				`  Reason Codes: ${selection.reasonCodes.join(", ") || "STANDARD_PROGRESSION"}`,
				"",
				"Candidate Action Ranking (Top 3):",
				...selection.allScored.slice(0, 3).map((cand, idx) => `  ${idx + 1}. [${cand.candidate.actionType}] ${cand.candidate.itemTitle} — ${cand.rateOfGain.toFixed(3)} gain/min`),
				"",
				"Available Domain Objects:",
				...selected.map((item) => `→ ${item.label}: ${item.reason}`),
			];
			if (learnerPreferences) lines.push("", "Learner self-report for delivery (observed performance and assessment conditions take precedence):", learnerPreferences);
			if (garageContext) lines.push("", "Internal garage observations for explanation design (verify against current performance):", garageContext);

			const targetSkill = topAction.kcId ? learner.skills[topAction.kcId] : undefined;
			const eligibilityAudit = getActionEligibilityReport({
				state: targetSkill,
				remainingMinutes: selection.remainingMinutes,
				hasUnresolvedMisconception: targetSkill ? targetSkill.activeMisconceptionIds.length > 0 : false,
				hasConfusableNeighbors: topAction.kcId ? relatedNodes(graph, topAction.kcId, "confusable-with").length > 0 : false,
			});

			// Atomically log decision event for counterfactual off-policy evaluation
			const decisionLog: DecisionEventV1 = {
				version: 1,
				decisionId: crypto.randomUUID(),
				sessionId: (ctx as { sessionManager?: { getSessionId?: () => string } }).sessionManager?.getSessionId?.() || "session-unlock",
				timestamp: new Date().toISOString(),
				topicId: graph.topic,
				remainingMinutes: selection.remainingMinutes,
				candidates: selection.allScored.map((c) => ({
					id: c.candidate.id,
					actionType: c.candidate.actionType,
					kcId: c.candidate.kcId,
					rateOfGain: c.rateOfGain,
					propensity: c.propensity,
				})),
				selectedActionId: topAction.id,
				selectedActionType: topAction.actionType,
				selectedKcId: topAction.kcId,
				propensity: selection.propensity,
				reasonCodes: selection.reasonCodes,
			};
			logDecisionEvent(cwd, decisionLog);

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: { mode, selected, optimalAction: selection, eligibilityAudit, loggedDecisionId: decisionLog.decisionId, learnerPreferences, garageContext },
			};
		},
	});
}
