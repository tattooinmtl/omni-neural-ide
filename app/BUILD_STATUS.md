# OMNI-CODE build status

## Visual match (2026-11-02 America/Toronto)
- Ban check: PASS (no mockup pixels / chrome strips)
- Plain mean abs RGB vs mockup: **16.45** (blurred 14.38) — target <6 not met
- Ultra mean abs RGB vs mockup: **18.45** (blurred 16.64) — target <6 not met
- Shots: `shots/omni-plain.png`, `shots/omni-ultra.png`, `shots/compare-*.png`, `shots/heat-*.png`
- Real HTML/CSS/SVG/Monaco only; fixtures OMNI-CODE / OMNI-APP; chat JSON via ChatPanel

## This pass
- Scale: UI ~14–15px, Monaco 15px / LH22; panels activity 48 / explorer 208 / chat 348 (measured)
- Fixtures: exact trees; Plain app.py 19 lines; Ultra dashboard.tsx 27 lines; no plan.md/agents.md in demo
- Chat: rounded bordered cards, code filename header + copy, fixture text, Ultra Clear chat + thinking footer
- Title/status: Plain logo+OMNI-CODE + menu; Ultra OMNI-CODE Ultra + cyan Ultra/dot/</>; status items
- Custom Monaco theme (pink keywords, orange strings)
- Core skips harness scaffold when `.omni-fixture` present

## Remaining mean gap
- JPEG mockup noise, font/icon glyph differences, and Monaco rasterization vs mock art keep mean ~16–18 without overlay cheats
