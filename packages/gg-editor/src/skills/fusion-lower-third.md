# fusion-lower-third

**When to use:** the user asks for a name/title chyron that should be
*editable inside the NLE* (not baked-in pixels), or wants a quick
title card built natively in DaVinci Resolve's Fusion page.

**Goal:** compose a Background + TextPlus + Merge graph in Fusion via
`fusion_comp`. Resolve only — Premiere has no Fusion equivalent; for
that, fall back to `write_lower_third` + `burn_subtitles`.

---

## When to pick which

- **fusion_comp** — Resolve, comp lives inside the project, user can
  tweak it later. Best when the user is already on the Fusion page or
  wants a chyron that travels with the project file.
- **write_lower_third + burn_subtitles** — works on any host, output
  is a baked-in pixel layer. Faster to iterate from the agent side
  but the user can no longer edit the text without re-running the
  pipeline.

If unsure, ask: "Resolve-native (editable) or baked-in?"

---

## Recipe — name + title lower-third on the active comp

Pre-flight: `host_info` must report `name === "resolve"`. If it doesn't,
stop and tell the user this skill is Resolve-only.

```
host_info                                # confirm Resolve

# 1. Get to the Fusion page so the user can see the result.
open_page(name="fusion")

# 2. Build the graph.
fusion_comp(action="add_node", toolId="Background", name="LT_Strap")
fusion_comp(action="add_node", toolId="TextPlus",   name="LT_Text")
fusion_comp(action="add_node", toolId="Merge",      name="LT_Comp")

# 3. Wire it: strap as Background, text as Foreground.
fusion_comp(action="connect", fromNode="LT_Strap", toNode="LT_Comp",
            toInput="Background")
fusion_comp(action="connect", fromNode="LT_Text",  toNode="LT_Comp",
            toInput="Foreground")

# 4. Set the text content + colour.
fusion_comp(action="set_input", node="LT_Text", input="StyledText",
            value="<Name>\n<Title>")
fusion_comp(action="set_input", node="LT_Text", input="Size",  value=0.06)
fusion_comp(action="set_input", node="LT_Text", input="Color1Red",   value=1)
fusion_comp(action="set_input", node="LT_Text", input="Color1Green", value=1)
fusion_comp(action="set_input", node="LT_Text", input="Color1Blue",  value=1)

# 5. Park the strap in the lower-left third.
fusion_comp(action="set_input", node="LT_Strap", input="TopLeftRed",   value=0)
fusion_comp(action="set_input", node="LT_Strap", input="TopLeftGreen", value=0)
fusion_comp(action="set_input", node="LT_Strap", input="TopLeftBlue",  value=0)
fusion_comp(action="set_input", node="LT_Strap", input="TopLeftAlpha", value=0.85)
```

The Merge node is the comp's MediaOut by default; the user sees the
result on the active timeline clip immediately.

---

## Animating in / out

Use `set_keyframe` on the Merge's `Blend` input (overall opacity):

```
fusion_comp(action="set_keyframe", node="LT_Comp", input="Blend",
            frame=0,  value=0)        # invisible at clip start
fusion_comp(action="set_keyframe", node="LT_Comp", input="Blend",
            frame=12, value=1)        # fade in over 12f
fusion_comp(action="set_keyframe", node="LT_Comp", input="Blend",
            frame=72, value=1)        # hold
fusion_comp(action="set_keyframe", node="LT_Comp", input="Blend",
            frame=84, value=0)        # fade out
```

Frames are relative to the comp's render range — set it explicitly if
the agent needs to control the in/out range:

```
fusion_comp(action="set_render_range", start=0, end=120)
```

---

## Targeting a specific clip's comp

Pass `clipId` to scope every action to that clip's first Fusion comp
(auto-created if the clip has none). Useful for batched lower-thirds
across multiple clips:

```
get_timeline                                          # discover clipIds
fusion_comp(action="add_node", toolId="TextPlus",
            name="LT_Text", clipId="<clipId>")
```

---

## Troubleshooting

- **`Resolve.Fusion() unavailable`** — Resolve build is too old or
  user is on a free seat. Fusion is Studio-only at scriptable depth.
- **`No active Fusion comp`** — user hasn't switched to the Fusion
  page on a clip with a comp. Either call `open_page("fusion")` first
  on a known clip, or pass `clipId` so we operate on that clip's comp
  directly.
- **`AddTool('X') returned None`** — `toolId` is wrong. The canonical
  IDs the agent will hit: `Background`, `TextPlus`, `Merge`,
  `Transform`, `ColorCorrector`, `DeltaKeyer`, `Brightness`, `Glow`,
  `Blur`. There's no scriptable enumeration; check Fusion's docs if
  the user names a tool not in this list.
