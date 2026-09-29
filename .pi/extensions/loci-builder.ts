/**
 * loci-builder — Method of Loci (Memory Palace) construction and retrieval.
 *
 * Research basis: Dresler et al. (2017, Neuron) demonstrated that 6 weeks of
 * Method of Loci training induced large-scale functional connectivity shifts
 * in naive subjects, mirroring elite memory athletes — predicting performance
 * gains up to 4 months later. RSA analyses confirm the method reduces
 * hippocampal pattern similarity across stored items, disambiguating neural
 * representations and shielding data from proactive/retroactive interference.
 *
 * The Method of Loci shifts arbitrary data from the phonological loop (7±2)
 * into high-capacity visuospatial processing circuits by anchoring items to
 * vivid images deposited along a well-known spatial route.
 *
 * Tools:
 *   create_memory_palace  — Define a spatial route with named loci
 *   deposit_at_locus      — Associate an item with a locus via vivid imagery
 *   walk_palace           — Guided retrieval walk with evidence recording
 *   major_system_encode   — Convert numbers to imageable nouns via Major System
 *
 * Persistence:
 *   Palace data is saved to `_learning/palaces/<name>.json`
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────

interface Locus {
	index: number;
	name: string;
	description: string;
	item: string | null;
	vividImage: string | null;
	retrievalHistory: Array<{
		ts: string;
		correct: boolean;
		response: string;
	}>;
}

interface MemoryPalace {
	name: string;
	route: string;
	loci: Locus[];
	topic: string | null;
	createdAt: string;
	lastWalked: string | null;
	walkCount: number;
}

interface PalacesFile {
	version: number;
	palaces: MemoryPalace[];
	lastUpdated: string;
}

// ── Major System mapping ────────────────────────────────────────────────────

const MAJOR_MAP: Record<string, string[]> = {
	"0": ["s", "z"],
	"1": ["t", "d"],
	"2": ["n"],
	"3": ["m"],
	"4": ["r"],
	"5": ["l"],
	"6": ["j", "ch", "sh"],
	"7": ["k", "g"],
	"8": ["f", "v"],
	"9": ["p", "b"],
};

// Common Major System pegs for two-digit numbers (00–99)
const MAJOR_PEGS: Record<string, string> = {
	"00": "SiZe", "01": "SuiT", "02": "SuN", "03": "SuM", "04": "SoaR",
	"05": "SaiL", "06": "SaSH", "07": "SocK", "08": "SaFe", "09": "SoaP",
	"10": "ToES", "11": "ToaD", "12": "TiN", "13": "ToMb", "14": "TiRe",
	"15": "TaiL", "16": "DiSH", "17": "DocK", "18": "DiVe", "19": "TuB",
	"20": "NoSe", "21": "NuT", "22": "NuN", "23": "NaMe", "24": "NeRo",
	"25": "NaiL", "26": "NiCHe", "27": "NecK", "28": "KNiFe", "29": "KNoB",
	"30": "MouSe", "31": "MaT", "32": "MooN", "33": "MoM", "34": "MoweR",
	"35": "MaiL", "36": "MatCH", "37": "MuG", "38": "MuFf", "39": "MaP",
	"40": "RoSe", "41": "RaT", "42": "RaiN", "43": "RaM", "44": "RoaR",
	"45": "RaiL", "46": "RoaCH", "47": "RocK", "48": "RooF", "49": "RoPe",
	"50": "LaCe", "51": "LoT", "52": "LioN", "53": "LiMe", "54": "LyRe",
	"55": "LiLy", "56": "LeaSH", "57": "LocK", "58": "LaVa", "59": "LiP",
	"60": "CHeeSe", "61": "SHeeT", "62": "CHaiN", "63": "CHuM", "64": "CHeRry",
	"65": "JaiL", "66": "JudGe", "67": "CHecK", "68": "CHieF", "69": "SHiP",
	"70": "CaSe", "71": "CaT", "72": "CaN", "73": "CoMb", "74": "CaR",
	"75": "CoaL", "76": "CaGe", "77": "CaKe", "78": "CaVe", "79": "CaP",
	"80": "FuSe", "81": "FiT", "82": "FaN", "83": "FoaM", "84": "FiRe",
	"85": "FiLe", "86": "FiSH", "87": "FiG", "88": "FiFe", "89": "FoB",
	"90": "BuS", "91": "BaT", "92": "BoNe", "93": "BoMb", "94": "BeaR",
	"95": "BaLL", "96": "BeaCH", "97": "BooK", "98": "BeeF", "99": "PiPe",
};

// ── File I/O ────────────────────────────────────────────────────────────────

function palacesDir(cwd: string): string {
	return path.join(cwd, "_learning", "palaces");
}

function palacesFilePath(cwd: string): string {
	return path.join(palacesDir(cwd), "palaces.json");
}

function loadPalaces(cwd: string): PalacesFile {
	const fp = palacesFilePath(cwd);
	if (fs.existsSync(fp)) {
		try {
			return JSON.parse(fs.readFileSync(fp, "utf-8"));
		} catch {
			// corrupted — start fresh
		}
	}
	return { version: 1, palaces: [], lastUpdated: new Date().toISOString() };
}

function savePalaces(cwd: string, data: PalacesFile): void {
	const dir = palacesDir(cwd);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	data.lastUpdated = new Date().toISOString();
	fs.writeFileSync(palacesFilePath(cwd), JSON.stringify(data, null, 2), "utf-8");
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function lociBuilder(pi: ExtensionAPI) {
	// ── create_memory_palace tool ─────────────────────────────────────────

	pi.registerTool({
		name: "create_memory_palace",
		label: "create memory palace",
		description:
			"Define a spatial route (Memory Palace) for the Method of Loci. " +
			"Each palace is a familiar location with named stations (loci) along a consistent " +
			"mental path. Items are later deposited at these loci as vivid images. " +
			"Use this for serialized lists, ordered sequences, and arbitrary facts that " +
			"resist schematic integration — exactly the cases where motivated discovery doesn't apply. " +
			"Research: Dresler et al. (2017) showed Method of Loci training restructures " +
			"functional connectivity to mirror elite memory athletes within 6 weeks.",
		promptSnippet:
			"Offer create_memory_palace for a bounded arbitrary sequence or list that the learner needs to retain and that resists conceptual grouping, especially when they ask for a mnemonic. Do not build a palace for every numbered explanation. If chosen, use deposit_at_locus to place the items.",
		parameters: Type.Object({
			name: Type.String({
				description: "Name for the palace (e.g., 'childhood-home', 'campus-route')",
			}),
			route: Type.String({
				description:
					"Description of the spatial route the learner will mentally walk " +
					"(e.g., 'Front door → kitchen → living room → bedroom → bathroom')",
			}),
			loci: Type.Array(
				Type.Object({
					name: Type.String({ description: "Short name for this station (e.g., 'front door')" }),
					description: Type.String({
						description:
							"Vivid, concrete description of this location " +
							"(e.g., 'The heavy oak door with the brass knocker shaped like a lion's head')",
					}),
				}),
				{
					description: "The stations along the route, in walking order. 5–20 loci is typical.",
					minItems: 3,
					maxItems: 50,
				},
			),
			topic: Type.Optional(
				Type.String({ description: "Optional topic slug this palace is associated with" }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const data = loadPalaces(cwd);

			// Check for duplicate name
			const existing = data.palaces.find(
				(p) => p.name.toLowerCase() === params.name.trim().toLowerCase(),
			);
			if (existing) {
				return {
					content: [
						{
							type: "text" as const,
							text: `A palace named "${params.name}" already exists with ${existing.loci.length} loci. ` +
								`Use a different name or deposit items at its existing loci.`,
						},
					],
				};
			}

			const palace: MemoryPalace = {
				name: params.name.trim(),
				route: params.route.trim(),
				loci: params.loci.map((l, i) => ({
					index: i,
					name: l.name.trim(),
					description: l.description.trim(),
					item: null,
					vividImage: null,
					retrievalHistory: [],
				})),
				topic: params.topic?.trim() || null,
				createdAt: new Date().toISOString(),
				lastWalked: null,
				walkCount: 0,
			};

			data.palaces.push(palace);
			savePalaces(cwd, data);

			const lines = [
				`🏛️ Memory Palace created: "${palace.name}"`,
				`Route: ${palace.route}`,
				`Loci (${palace.loci.length}):`,
				...palace.loci.map((l, i) => `  ${i + 1}. ${l.name} — ${l.description}`),
				``,
				`Use deposit_at_locus to place items at each station.`,
			];

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: { palace: palace.name, lociCount: palace.loci.length },
			};
		},
	});

	// ── deposit_at_locus tool ─────────────────────────────────────────────

	pi.registerTool({
		name: "deposit_at_locus",
		label: "deposit at locus",
		description:
			"Associate an item with a specific locus in a Memory Palace by generating a vivid, " +
			"bizarre, multi-sensory image. The image should be exaggerated, interactive with the " +
			"location, and engage multiple senses (sight, sound, smell, touch, motion). " +
			"Bizarre and emotionally salient images are remembered far better than mundane ones. " +
			"The spatial address disambiguates the item from others, reducing hippocampal " +
			"pattern similarity and shielding against interference.",
		promptSnippet:
			"TOOL-FIRST MANDATE: Use deposit_at_locus to place each item in the spatial route with a vivid, exaggerated, multisensory image description.",
		parameters: Type.Object({
			palaceName: Type.String({ description: "Name of the Memory Palace" }),
			locusIndex: Type.Integer({
				description: "0-based index of the locus to deposit at",
				minimum: 0,
			}),
			item: Type.String({
				description: "The fact, term, or concept to remember at this location",
			}),
			vividImage: Type.String({
				description:
					"A vivid, bizarre, multi-sensory image that encodes the item AND interacts " +
					"with the location. Example: if the item is 'mitochondria = powerhouse of the cell' " +
					"and the locus is 'kitchen stove', the image might be: 'A giant mitochondrion sits " +
					"on the stove like a pot, flames roaring underneath it while it hums with electricity, " +
					"shooting lightning bolts that power every appliance in the kitchen.'",
			}),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const data = loadPalaces(cwd);
			const palace = data.palaces.find(
				(p) => p.name.toLowerCase() === params.palaceName.trim().toLowerCase(),
			);

			if (!palace) {
				return {
					content: [
						{ type: "text" as const, text: `Palace not found: "${params.palaceName}"` },
					],
				};
			}

			if (params.locusIndex < 0 || params.locusIndex >= palace.loci.length) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Locus index ${params.locusIndex} is out of range. ` +
								`Palace "${palace.name}" has ${palace.loci.length} loci (0–${palace.loci.length - 1}).`,
						},
					],
				};
			}

			const locus = palace.loci[params.locusIndex];
			const hadPrevious = locus.item !== null;
			locus.item = params.item.trim();
			locus.vividImage = params.vividImage.trim();

			savePalaces(cwd, data);

			const deposited = palace.loci.filter((l) => l.item !== null).length;
			const lines = [
				`📍 Deposited at locus ${params.locusIndex + 1} (${locus.name}):`,
				`  Item: ${locus.item}`,
				`  Image: ${locus.vividImage}`,
				``,
				hadPrevious ? `(Replaced previous item at this locus.)` : "",
				`Palace "${palace.name}": ${deposited}/${palace.loci.length} loci occupied.`,
			].filter(Boolean);

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: {
					palace: palace.name,
					locusIndex: params.locusIndex,
					locusName: locus.name,
					deposited,
					total: palace.loci.length,
				},
			};
		},
	});

	// ── walk_palace tool ──────────────────────────────────────────────────

	pi.registerTool({
		name: "walk_palace",
		label: "walk palace",
		description:
			"Initiate a guided retrieval walk through a Memory Palace. Presents each locus " +
			"in route order and asks the learner to recall the deposited item BEFORE revealing it. " +
			"This is a cued-recall protocol: the spatial location is the cue, the item is the target. " +
			"Returns structured results (correct/incorrect per locus) suitable for record_learning_evidence. " +
			"The walk exercises the same hippocampal spatial navigation networks that elite " +
			"memory athletes develop through Method of Loci training.",
		promptSnippet:
			"TOOL-FIRST MANDATE: Use walk_palace to run a cued-recall retrieval walk testing memory loci before revealing answers.",
		parameters: Type.Object({
			palaceName: Type.String({ description: "Name of the Memory Palace to walk" }),
			onlyOccupied: Type.Optional(
				Type.Boolean({
					description: "If true (default), skip loci with no deposited item",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as any).cwd || process.cwd();
			const data = loadPalaces(cwd);
			const palace = data.palaces.find(
				(p) => p.name.toLowerCase() === params.palaceName.trim().toLowerCase(),
			);

			if (!palace) {
				return {
					content: [
						{ type: "text" as const, text: `Palace not found: "${params.palaceName}"` },
					],
				};
			}

			const onlyOccupied = params.onlyOccupied !== false;
			const walkLoci = onlyOccupied
				? palace.loci.filter((l) => l.item !== null)
				: palace.loci;

			if (walkLoci.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Palace "${palace.name}" has no deposited items. Use deposit_at_locus first.`,
						},
					],
				};
			}

			palace.walkCount++;
			palace.lastWalked = new Date().toISOString();
			savePalaces(cwd, data);

			// Build a retrieval-walk brief for the tutor
			const lines = [
				`🏛️ RETRIEVAL WALK: "${palace.name}" (Walk #${palace.walkCount})`,
				`Route: ${palace.route}`,
				`Loci to visit: ${walkLoci.length}`,
				``,
				`**Instructions for the tutor:**`,
				`For each locus below, describe the location to the learner and ask them ` +
					`to recall the deposited item BEFORE revealing the answer.`,
				``,
				`Use ask_user_question for each recall attempt, then compare against the stored item.`,
				`After completing the walk, call record_learning_evidence with:`,
				`  evidenceType: "cued-recall", score: <hits>/<total>, hints: 0`,
				``,
				`--- Walk Order ---`,
				``,
			];

			for (const locus of walkLoci) {
				lines.push(`**Locus ${locus.index + 1}: ${locus.name}**`);
				lines.push(`  Location: ${locus.description}`);
				lines.push(`  Vivid image: ${locus.vividImage}`);
				lines.push(`  Correct item: ${locus.item}`);
				lines.push(``);
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: {
					palace: palace.name,
					walkCount: palace.walkCount,
					lociCount: walkLoci.length,
					loci: walkLoci.map((l) => ({
						index: l.index,
						name: l.name,
						item: l.item,
					})),
				},
			};
		},
	});

	// ── major_system_encode tool ──────────────────────────────────────────

	pi.registerTool({
		name: "major_system_encode",
		label: "major system encode",
		description:
			"Convert a numeric string into imageable nouns using the Major System phonetic " +
			"encoding. Each digit maps to a consonant sound: 0=s/z, 1=t/d, 2=n, 3=m, 4=r, " +
			"5=l, 6=j/ch/sh, 7=k/g, 8=f/v, 9=p/b. Vowels are inserted to form words. " +
			"The resulting images can be deposited along Memory Palace loci to memorize " +
			"numeric sequences, dates, constants, or ordered lists. " +
			"This circumvents phonological loop capacity limits (7±2) by shifting abstract " +
			"numeric data into high-capacity visuospatial processing circuits.",
		parameters: Type.Object({
			number: Type.String({
				description:
					"The numeric string to encode (e.g., '3141' for pi). " +
					"Digits only — spaces and punctuation are stripped.",
			}),
			chunkSize: Type.Optional(
				Type.Integer({
					description: "Digits per chunk (default: 2). Use 2 for standard peg words, 3–4 for longer words.",
					minimum: 1,
					maximum: 4,
				}),
			),
		}),
		async execute(_id, params) {
			const digits = params.number.replace(/\D/g, "");
			if (digits.length === 0) {
				return {
					content: [{ type: "text" as const, text: "No digits found in the input." }],
				};
			}

			const chunkSize = params.chunkSize ?? 2;

			// Split into chunks
			const chunks: string[] = [];
			for (let i = 0; i < digits.length; i += chunkSize) {
				chunks.push(digits.slice(i, i + chunkSize));
			}

			const lines = [
				`🔢 Major System Encoding: ${digits}`,
				`Chunk size: ${chunkSize} digits`,
				``,
				`**Digit-to-Consonant Mapping:**`,
				`  0=s/z  1=t/d  2=n  3=m  4=r  5=l  6=j/ch/sh  7=k/g  8=f/v  9=p/b`,
				``,
				`**Encoded Chunks:**`,
			];

			const encodedChunks: Array<{ chunk: string; consonants: string; peg: string | null }> = [];

			for (const chunk of chunks) {
				const consonants = chunk
					.split("")
					.map((d) => MAJOR_MAP[d]?.[0] ?? "?")
					.join("");
				const peg = chunkSize === 2 ? MAJOR_PEGS[chunk] || null : null;

				encodedChunks.push({ chunk, consonants, peg });

				const pegStr = peg ? ` → **${peg}**` : ` → [${consonants.toUpperCase()}] (insert vowels to form a word)`;
				lines.push(`  ${chunk} → consonants: ${consonants}${pegStr}`);
			}

			lines.push(
				``,
				`**Full sequence:**`,
				`  ${encodedChunks.map((c) => c.peg || c.consonants.toUpperCase()).join(" — ")}`,
				``,
				`Deposit these images along a Memory Palace route using deposit_at_locus.`,
				`The spatial ordering preserves the sequence without rote memorization.`,
			);

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: { digits, chunks: encodedChunks },
			};
		},
	});
}
