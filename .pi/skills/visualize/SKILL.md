---
name: visualize
description: "Add a correct, minimal visual to a lesson — a diagram or geometric picture — that renders inline in the Obsidian log. Use when an idea is genuinely clearer as a picture: a dependency graph, system/flow, sequence, state machine, tree, comparison, or a spatial/geometric thing (coordinate geometry, number line, vectors, a plot, a physical layout). Outsources authoring+rendering to a maker subagent that verifies the image by looking at it, then you embed the returned file."
---

# Visualize

A picture earns its place only when it shows something words can't — shape, structure, direction, relationship, geometry. This skill produces ONE such picture, guarantees it is **correct** (the maker renders it and looks at it before returning), stores it under `content/assets/`, and drops it into the lesson so it renders inline in the Obsidian session note.

You are the **creative director**. You decide the exact idea and distill it to its fewest carrying elements. A **maker subagent** does the authoring, rendering, visual verification, and saving, then returns a filename. You embed that filename in your reply.

## When to visualize (and when not to)

This teaching system builds a **dependency graph in the learner's head** — axioms at the root, derived facts hanging off them. A visual is powerful exactly when it makes that structure (or a geometry) visible. Reach for one when:

- The idea is a **structure or relationship**: dependencies, a system with parts and arrows, a flow/pipeline, a sequence of exchanges, a state machine, a tree/hierarchy, a comparison, a containment (what's inside vs outside).
- The idea is **spatial or geometric**: coordinate geometry, a number line, vectors, a function's shape, a physical arrangement.

Do NOT visualize when prose or a single equation already carries it. A decorative diagram that restates a sentence adds cognitive load and a chance to be wrong. Use visuals to externalize relationships, make an invisible mechanism visible, show change over time, translate representations, or eliminate split attention. Keep labels physically adjacent to what they describe. When in doubt, don't—a missing visual is cheaper than a false one.

## Choose the maker

Two makers, discovered from `.pi/agents/`:

- **`mermaid-maker`** — structural/relational visuals: dependency graphs, flowcharts, sequence/state/ER/class diagrams, trees, mindmaps, timelines. This is the default and fits the dependency-graph pedagogy directly.
- **`svg-maker`** — spatial/geometric visuals Mermaid can't lay out: exact coordinates, geometry figures, number lines, vectors, plots, custom shapes.

Rule of thumb: if it's *nodes-and-edges / relationships*, use mermaid-maker. If it's *positions-and-shapes / geometry*, use svg-maker.

## Brief the maker well: one idea, fewest elements

The most common failure is **cramming** — every extra label makes the picture harder to read AND harder to lay out correctly. Before briefing, prune to the fewest elements that carry the idea, and for each ask: *"if I delete this, is the idea still clear?"* If yes, delete it.

Give the maker the concept AND the concrete elements you want — not a vague topic, and not a long checklist.

- BAD: "make a diagram about how TCP works"
- GOOD: "graph TD: a node 'packet' at the top; arrows down to 'ordering' and 'retransmit on loss'; both arrows down into 'reliable stream'. No title. Show that reliability is built FROM packets, not alongside them."

Keep the idea intact but trust the maker to compose; if your brief lists more than ~5–7 elements, cut it first.

## Invoke

Dispatch the maker with the `subagent` tool:

```
subagent(agent="mermaid-maker", task="<your minimal, concrete brief>")
```
```
subagent(agent="svg-maker", task="<your minimal, concrete brief>")
```

The maker owns its own purpose-built tools (`write_*`/`edit_*`/`render_*`) — it authors the source, renders it to a PNG, **looks at the PNG and iterates until it is correct and clean**, publishes it into the vault with a unique filename, and returns:

```
RESULT:
filename: viz-<slug>-<timestamp>.png
path: <cwd>/content/assets/viz-<slug>-<timestamp>.png
```

If it returns `RESULT: NONE`, it couldn't make a correct picture of the brief — simplify or rethink, or decide the visual isn't worth it. Never hand-author or fake a diagram yourself; correctness depends on the maker's render-and-inspect loop.

## Embed it in the lesson

Put the embed directly in your teaching reply, using Obsidian's wikilink embed with the returned **filename** (not the full path) and a display width:

```
![[viz-<slug>-<timestamp>.png|500]]
```

That's all. Obsidian resolves the filename from `content/assets/`. Width `|500` is a good default; use larger only when necessary. Introduce the visual in one sentence and let it carry the relationship—do not narrate every element redundantly. When it has lasting value, also link or embed it from `content/topics/<topic>.md`.

## Why this is reliable

- The maker never returns a picture it hasn't **looked at**, so "renders fine but says something false" is caught before it reaches the learner.
- PNG embed means **what the maker verified is pixel-identical to what the learner sees** — no re-render drift.
- Unique filenames keep Obsidian's by-filename embed resolution unambiguous.

> The makers render through the project's `visual-tools` extension (Mermaid via a bundled `@mermaid-js/mermaid-cli` + installed Chrome; SVG via `rsvg-convert`, fallback ImageMagick). You don't render anything yourself — you only brief the maker and embed the filename it returns.

---

## Rich Mathematical & Tabular Complementarity

- When generating visual aids (Mermaid or SVG), accompany diagrams with clean Markdown reference tables with explicit column alignment (`:---` left, `:---:` center, `---:` right).
- Include standard KaTeX math expressions for relevant governing equations.
