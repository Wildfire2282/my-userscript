---
name: improve-codebase-architecture
description: Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick.
disable-model-invocation: true
---

# Improve Codebase Architecture

## 项目适配（优先于本文件）

- 本文件与仓库 `AGENTS.md` 冲突时，以 `AGENTS.md` 为准。
- 维护者不读代码、diff、日志，也不运行命令：报告用中文，先讲用户能看到的效果能否保持；技术分支自己定，只有产品取舍才问，一次最多三个并给默认。
- 领域词表与已定决策在 `docs/architecture.md`（含“关键决策”表）与 `docs/kit.md`；不要新建 `GLOSSARY.md`、`docs/adr/` 或一次性分析文档。新决策补进 `docs/architecture.md` 并留提交信息。
- 验证基线是 `bun run verify`（静态检查、单测、构建、元数据、真实浏览器场景）；没有实际执行的检查写“未验证”。

Surface architectural friction and propose **deepening opportunities**: refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

This command is _informed_ by the project's domain model and built on a shared design vocabulary:

- Read `references/codebase-design/SKILL.md` for the architecture vocabulary (**module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**) and its principles (the deletion test, "the interface is the test surface", "one adapter = hypothetical seam, two = real"). Use these terms exactly in every suggestion, and don't drift into "component," "service," "API," or "boundary."
- Domain names and settled decisions live in `docs/architecture.md`; treat its “关键决策” table as this project's ADRs and don't re-litigate them without real friction.

## Process

### 1. Explore

**Scope before you scan: YAGNI.** Deepening a module pays off by making future changes to it easier, so put extra weight on the parts of the codebase that have recently changed. Decide *where* to look before you look:

- If the user named a direction (a module, a subsystem, a pain point), take it, and skip the inference below.
- Otherwise, walk back a good stretch of the commit history (`git log --oneline`) to find the codebase's hot spots, the files and areas that keep coming up, and let those paths pull your attention first. If the changes are scattered with no clear hot spot, widen the net.

Read `docs/architecture.md` and the target script's `README.md` before scanning; they carry the settled decisions in the area you're touching.

Then spawn a sub-agent to walk the codebase. Don't follow rigid heuristics; explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow**, with an interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it? A "yes, concentrates" is the signal you want.

### 2. Present candidates as an HTML report

Write a self-contained HTML file to the OS temp directory so nothing lands in the repo. Resolve the temp dir from `$TMPDIR`, falling back to `/tmp` (or `%TEMP%` on Windows), and write to `<tmpdir>/architecture-review-<timestamp>.html` so each run gets a fresh file. Open it for the user (`xdg-open <path>` on Linux, `open <path>` on macOS, `start <path>` on Windows) and tell them the absolute path.

The report uses **Tailwind via CDN** for layout and styling, and **Mermaid via CDN** for diagrams where a graph/flow/sequence reliably communicates the structure. Mix Mermaid with hand-crafted CSS/SVG visuals: use Mermaid when relationships are graph-shaped (call graphs, dependencies, sequences), and hand-built divs/SVG when you want something more editorial (mass diagrams, cross-sections, collapse animations). Each candidate gets a **before/after visualisation**. Be visual.

For each candidate, render a card with:

- **Files**: which files/modules are involved
- **Problem**: why the current architecture is causing friction
- **Solution**: plain English description of what would change
- **Benefits**: explained in terms of locality and leverage, and how tests would improve
- **Before / After diagram**: side-by-side, custom-drawn, illustrating the shallowness and the deepening
- **Recommendation strength**: one of `Strong`, `Worth exploring`, `Speculative`, rendered as a badge

End the report with a **Top recommendation** section: which candidate you'd tackle first and why.

**Use the repo's terms for the domain, and the `references/codebase-design` vocabulary for the architecture.** Write the report in Chinese for a maintainer who judges effects, not code: each card leads with what the user will notice.

**Decision conflicts**: if a candidate contradicts a settled decision in `docs/architecture.md`, only surface it when the friction is real enough to warrant revisiting it. Mark it clearly in the card (e.g. a warning callout: _"contradicts 关键决策：自绘 UI 的例外, but worth reopening because…"_). Don't list every theoretical refactor a decision forbids.

See [HTML-REPORT.md](HTML-REPORT.md) for the full HTML scaffold, diagram patterns, and styling guidance.

Do NOT propose interfaces yet. After the file is written, ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, walk the decision tree yourself: constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive. Follow `AGENTS.md` 5.3: technical branches are yours to decide; ask the maintainer only when two options change what they will see, at most three questions with a default.

Side effects happen inline as decisions crystallize; keep the project's docs current as you go:

- **Naming a deepened module after a concept the docs don't have?** Add the term where that concept is documented (`docs/architecture.md`, `docs/kit.md` or the script's `README.md`), whichever already owns it.
- **Sharpening a fuzzy term during the conversation?** Update that same place right there.
- **A candidate is rejected for a load-bearing reason?** Add one row to `docs/architecture.md` 的“关键决策”：决策、当前做法、理由。Only record reasons a future review would need; skip ephemeral ones.
- **Want to explore alternative interfaces for the deepened module?** Read `references/codebase-design/DESIGN-IT-TWICE.md` and use its design-it-twice parallel sub-agent pattern.
