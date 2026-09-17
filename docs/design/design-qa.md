# Prelight design QA

## Comparison target

- Welcome reference: `docs/design/references/prelight-welcome-reference.png`
- Interaction references: `docs/design/references/odin-tutorial-start.png`, `odin-tutorial-complete.png`, and `odin-sign-in.png`
- Product target: the existing React Flow speech-map workspace and its plan → rehearse → review → edit → rehearse loop
- Tutorial captures: `docs/design/qa/map-tutorial-step-2.png`, `map-tutorial-step-3.png`, and `map-tutorial-step-4.png`
- Mobile capture: `docs/design/qa/map-tutorial-mobile.png`
- Browser: Codex in-app Chromium

## Viewports

- Source screenshot: 2880 × 1614 at 2×, equivalent to a 1440 × 807 CSS viewport
- Desktop verification: 1440 × 807
- Mobile verification: 390 × 844

## Full-view comparison

- The original navy Prelight homepage remains unchanged, including its logo, mascot, headline, supporting copy, and warm-white primary button.
- “Show me how” enters a four-step walkthrough for the final React Flow product, not the retired delivery-comparison Studio.
- Step 1 uses the Prelight mascot to ask what the user is preparing for.
- Steps 2–4 stay inside the real visual map and explain idea structure, rehearsal, and coverage review.
- Tutorial setup uses a local sample graph and makes no paid model request.
- Finishing returns to the existing tutorial-complete page with login and account creation actions.
- Buttons use the established warm-white/navy treatment without decorative orange or white focus outlines.

## Fidelity surfaces

- Typography: original homepage hierarchy retained; tutorial copy uses the current product typography.
- Spacing: guide stays clear of the main canvas controls and inspector.
- Color: navy, cream, and restrained orange accents match the established Prelight identity.
- Asset: the existing Prelight mascot appears throughout the walkthrough.
- Copy: each step describes the final speech-map workflow.
- Responsive behavior: at 390 px, the workspace, header, controls, and guide remain within the viewport.

## Interaction verification

1. Opened the original welcome page.
2. Selected “Show me how,” advanced through the introduction, and opened the workspace.
3. Entered “3-minute startup pitch for Prelight” and generated the local tutorial map.
4. Advanced through Steps 2, 3, and 4 inside the React Flow workspace.
5. Finished the tutorial and confirmed the existing completion page.
6. Repeated responsive checks at 390 × 844.
7. Confirmed no browser console errors.

## Comparison history

- P0: The first implementation mistakenly routed the tutorial into the retired Studio. Fixed by keeping `/studio?tour=1` on the React Flow product.
- P2: The first mobile pass overflowed to 550 px. Fixed; the workspace and top bar now stay at 390 px.

## Findings

- P0: none
- P1: none
- P2: none

## Open issues

- None.

## Completion checklist

- [x] Original homepage preserved
- [x] Final product pivot preserved
- [x] Mascot-led walkthrough added to the final product
- [x] Retired Studio excluded from the walkthrough
- [x] Desktop and mobile verified
- [x] Browser console checked

final result: passed
