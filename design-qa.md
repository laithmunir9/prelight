**Design QA**

- Source visual truth paths:
  - `/var/folders/gj/qhyvvp0n39v16bm878rqs7s00000gn/T/TemporaryItems/NSIRD_screencaptureui_0X1CAw/Screenshot 2026-09-17 at 23.16.14.png` (step 2 disabled-action problem)
  - `/var/folders/gj/qhyvvp0n39v16bm878rqs7s00000gn/T/TemporaryItems/NSIRD_screencaptureui_akpdJ1/Screenshot 2026-09-17 at 22.58.46.png` (intro modal)
  - `/var/folders/gj/qhyvvp0n39v16bm878rqs7s00000gn/T/TemporaryItems/NSIRD_screencaptureui_lp2xTc/Screenshot 2026-09-17 at 22.58.59.png` (required setup choice)
  - `/var/folders/gj/qhyvvp0n39v16bm878rqs7s00000gn/T/TemporaryItems/NSIRD_screencaptureui_wJQdkc/Screenshot 2026-09-17 at 22.59.24.png` (contextual coach card)
- Implementation screenshot: Codex in-app Browser tab 3 inline browser capture. The browser API supplied visual evidence inline but did not expose a filesystem path.
- Compared route and state: `http://localhost:39879/studio?tour=1`, tutorial steps 1, 2, and 4; plus the homepage introduction at `/?tutorial=1`.
- Normalized desktop viewport: 1440 × 812 CSS px at DPR 2, matching the 2880 × 1624 source capture's effective CSS size. A responsive check also ran at 781 × 730 CSS px at DPR 2.
- Source pixel dimensions: 2880 × 1624 for the primary welcome reference; 2874 × 1620 and 2866 × 1620 for the related modal/workspace references.
- Implementation pixel dimensions at normalized capture: 2880 × 1624 device pixels.

**Full-view comparison evidence**

- The implementation preserves the source flow's centered, light tutorial surface over a visibly dimmed real workspace, while intentionally retaining Prelight's navy canvas and cream brand palette.
- The setup state matches the source hierarchy: mascot above the surface, step label, direct question, large input, preset chips, and one strong gated action.
- Later steps move to a compact contextual coach card with an external mascot, step progress, guarded close, back/exit controls, and a primary action.

**Focused region comparison evidence**

- Setup form: the input is spacious and neutral, chips have a clear selected state, and no orange focus or perimeter glow is present.
- Contextual card: the speech-tail relationship, mascot placement, close control, copy hierarchy, and wide dark primary action follow the source pattern without copying Odin's text or monochrome brand.
- Workspace: the live speech map remains visible and usable beneath the tutorial; required actions enable progression only after a preset/text choice, node edit, and rehearsal action.

**Required fidelity surfaces**

- Fonts and typography: Prelight's existing Fraunces/DM Sans hierarchy is retained. Display, body, label, and step weights remain distinct and readable.
- Spacing and layout rhythm: centered setup modal and bottom contextual card align with the references; desktop and narrow layouts avoid clipped actions or overflow.
- Colors and visual tokens: navy workspace, cream instructional surfaces, dark navy actions, and restrained gray borders stay within the existing Prelight system. No orange selection outline remains.
- Image quality and asset fidelity: the supplied Prelight mascot asset is used at native aspect ratio with no placeholder, CSS drawing, or substitute icon.
- Copy and content: all tutorial language is specific to the speaking-map product and does not reproduce Odin's wording.

**Findings**

- No actionable P0, P1, or P2 differences remain. The remaining differences from Odin are intentional product adaptations: Prelight branding, speech-specific copy, four gated steps, and the existing visual map workspace.

**Comparison history**

1. Initial implementation capture at 781 × 730 verified the responsive setup modal, edit gate, rehearsal gate, coverage result, and completion step. No clipped controls or orange focus treatment appeared.
2. The desktop capture was normalized to 1440 × 812 CSS px. The modal proportions, hierarchy, workspace dimming, and primary action placement matched the selected references without further P0/P1/P2 fixes.
3. The step 2 action was changed from a disabled control into a responsive gate: clicking it focuses the first editable card and shows a specific instruction; editing the card then advances to step 3. Tutorial backdrop blur was removed so the workspace remains readable and usable alongside the guide.

**Primary interactions tested**

- Selected a suggested speaking moment and confirmed the disabled CTA became enabled.
- Advanced to step 2, edited an idea card, and confirmed progression became enabled.
- Advanced to step 3, used Rehearse, and confirmed coverage states and step 4 appeared without requesting microphone access.
- Opened the homepage introduction and confirmed its Continue handoff targets the tutorial workspace.
- Browser console errors and warnings checked: none.

**Implementation checklist**

- [x] Preserve the current speech-map product.
- [x] Keep Prelight's navy/cream visual system and mascot.
- [x] Make step 1 a workspace overlay with required input.
- [x] Use contextual mascot coaching for later steps.
- [x] Guard exit and gate progress by real actions.
- [x] Remove orange focus/selection outlines.
- [x] Verify desktop and responsive layouts.

**Follow-up polish**

- No blocking polish remains.

final result: passed
