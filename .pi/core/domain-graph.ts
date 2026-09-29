import type { SkillLearnerState } from "./learning-events.ts";

export type KnowledgeObjectType = "concept" | "fact" | "procedure" | "misconception" | "example" | "non-example" | "analogy" | "representation" | "transfer-target" | "assessment-objective";
export type RelationType = "prerequisite" | "component" | "confusable-with" | "analogous-to" | "represented-by" | "transfers-to" | "boundary-of" | "misconception-about" | "assessed-by";

export interface DomainNode {
	id: string;
	label: string;
	type: KnowledgeObjectType;
	priority?: "tier-1" | "tier-2" | "tier-3";
	assessmentWeight?: number;
	importance?: number;
	expectedDifficulty?: number;
	decisionCues?: string[];
	knownErrors?: string[];
	representations?: string[];
	nearTransferContexts?: string[];
	farTransferContexts?: string[];
	contentVersion?: string;
	sourceIds?: string[];
}

export interface DomainEdge {
	from: string;
	to: string;
	type: RelationType;
	weight?: number;
	evidenceCount?: number;
}

export interface DomainGraph {
	version: 2;
	topic: string;
	nodes: DomainNode[];
	edges: DomainEdge[];
	lastUpdated: string;
}

const TYPES = new Set<KnowledgeObjectType>(["concept", "fact", "procedure", "misconception", "example", "non-example", "analogy", "representation", "transfer-target", "assessment-objective"]);
const RELATIONS = new Set<RelationType>(["prerequisite", "component", "confusable-with", "analogous-to", "represented-by", "transfers-to", "boundary-of", "misconception-about", "assessed-by"]);

export function migrateLegacyGraph(value: any): DomainGraph {
	if (value?.version === 2) return value as DomainGraph;
	const nodeType = (type: string): KnowledgeObjectType => type === "goal" ? "assessment-objective" : type === "axiom" ? "fact" : "concept";
	return {
		version: 2,
		topic: String(value?.topic || "general"),
		nodes: (value?.nodes || []).map((node: any) => ({ ...node, type: nodeType(node.type), contentVersion: node.contentVersion || "legacy-v1" })),
		edges: (value?.edges || []).map((edge: any) => ({ ...edge, type: edge.type || "prerequisite" })),
		lastUpdated: value?.lastUpdated || new Date().toISOString(),
	};
}

export function validateDomainGraph(graph: DomainGraph): string[] {
	const errors: string[] = [];
	if (graph.version !== 2) errors.push("graph version must be 2");
	const ids = graph.nodes.map((node) => node.id);
	const idSet = new Set(ids);
	if (idSet.size !== ids.length) errors.push("node IDs must be unique");
	for (const node of graph.nodes) {
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(node.id)) errors.push(`node ${node.id || "<empty>"} must use kebab-case`);
		if (!node.label.trim()) errors.push(`node ${node.id} requires a label`);
		if (!TYPES.has(node.type)) errors.push(`node ${node.id} has unsupported type ${node.type}`);
	}
	const keys = new Set<string>();
	for (const edge of graph.edges) {
		if (!idSet.has(edge.from) || !idSet.has(edge.to)) errors.push(`edge ${edge.from} -> ${edge.to} references an unknown node`);
		if (edge.from === edge.to) errors.push(`edge ${edge.from} cannot reference itself`);
		if (!RELATIONS.has(edge.type)) errors.push(`edge ${edge.from} -> ${edge.to} has unsupported relation ${edge.type}`);
		const key = `${edge.from}|${edge.type}|${edge.to}`;
		if (keys.has(key)) errors.push(`duplicate edge ${key}`);
		keys.add(key);
	}

	const outgoing = new Map<string, string[]>();
	for (const id of ids) outgoing.set(id, []);
	for (const edge of graph.edges.filter((candidate) => candidate.type === "prerequisite")) outgoing.get(edge.from)?.push(edge.to);
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string): boolean => {
		if (visiting.has(id)) return true;
		if (visited.has(id)) return false;
		visiting.add(id);
		for (const next of outgoing.get(id) || []) if (visit(next)) return true;
		visiting.delete(id);
		visited.add(id);
		return false;
	};
	if (ids.some(visit)) errors.push("prerequisite relations must be acyclic");
	return errors;
}

export function relatedNodes(graph: DomainGraph, nodeId: string, type: RelationType): DomainNode[] {
	const ids = new Set(graph.edges.filter((edge) => edge.type === type && (edge.from === nodeId || (["confusable-with", "analogous-to"].includes(type) && edge.to === nodeId))).map((edge) => edge.from === nodeId ? edge.to : edge.from));
	return graph.nodes.filter((node) => ids.has(node.id));
}

export function getPrerequisites(graph: DomainGraph, nodeId: string): string[] {
	return graph.edges.flatMap((edge) => (edge.type === "prerequisite" && edge.to === nodeId ? [edge.from] : []));
}

export function getDescendants(graph: DomainGraph, nodeId: string): string[] {
	const seen = new Set<string>();
	const queue = [nodeId];
	while (queue.length) {
		const current = queue.shift()!;
		for (const edge of graph.edges) {
			if (edge.type === "prerequisite" && edge.from === current && !seen.has(edge.to)) {
				seen.add(edge.to);
				queue.push(edge.to);
			}
		}
	}
	return Array.from(seen);
}

export function getDownstreamBlueprintWeight(
	graph: DomainGraph,
	nodeId: string,
	blueprintWeights: Record<string, number>,
): number {
	const descendants = getDescendants(graph, nodeId);
	return descendants.reduce((sum, descId) => sum + (blueprintWeights[descId] || 0), 0);
}

export function getConfusableNeighbors(graph: DomainGraph, nodeId: string): DomainNode[] {
	return relatedNodes(graph, nodeId, "confusable-with");
}

export function getTransferTargets(graph: DomainGraph, nodeId: string): DomainNode[] {
	return relatedNodes(graph, nodeId, "transfers-to");
}

export function getRepresentations(graph: DomainGraph, nodeId: string): DomainNode[] {
	return relatedNodes(graph, nodeId, "represented-by");
}

export function getMisconceptions(graph: DomainGraph, nodeId: string): DomainNode[] {
	return relatedNodes(graph, nodeId, "misconception-about");
}

export function getComponents(graph: DomainGraph, nodeId: string): DomainNode[] {
	return relatedNodes(graph, nodeId, "component");
}

export function getAnalogies(graph: DomainGraph, nodeId: string): DomainNode[] {
	return relatedNodes(graph, nodeId, "analogous-to");
}

/**
 * Evaluates whether all prerequisite dependencies for a node are satisfied.
 * Reference: research/learning.md:236–252; Saarinen et al. (2020) LAK.
 */
export function isPrerequisiteSatisfied(
	graph: DomainGraph,
	nodeId: string,
	learnerSkills: Record<string, SkillLearnerState>,
	readinessThreshold = 0.5,
): { satisfied: boolean; unreadyPrereqs: string[] } {
	const prereqs = getPrerequisites(graph, nodeId);
	const unreadyPrereqs: string[] = [];
	for (const prereqId of prereqs) {
		const skill = learnerSkills[prereqId];
		const ready = skill && skill.memoryAccessibility.mean >= readinessThreshold;
		if (!ready) {
			unreadyPrereqs.push(prereqId);
		}
	}
	return {
		satisfied: unreadyPrereqs.length === 0,
		unreadyPrereqs,
	};
}
