# Coding standards (enforced, not suggested)

The rules every change to Carys follows. Source comments cite them by number
(`§22`, `§29`), so the numbering is stable. Rules below are load-bearing:
most are checked by tests, not by review.
A rule with a checker names it. Follow the letter; when two rules collide,
prefer the one with a test behind it.

## Size & structure

1. **Files stay under 700 LOC** — checked by `verify.test.ts`
   (`700-line cap holds for every source file`). Split by responsibility
   (`MprView` → docks + panes), never by arbitrary cut. `.tsx` is exempt
   from the checker but not from the spirit.
2. **One component/module, one job** — logic lives with its panes
   (`MprPanes`), chrome with its docks, composition in `ViewerView`.
3. **No dead code paths** — remove the obsolete path instead of leaving it
   dormant. Deleting the Slices/3D switcher forced `View = 'mpr'`, and the
   compiler proved the cleanup complete.
4. **No duplicated implementations** — shared logic gets one home
   (`handleOpenFiles` router, one implementation, two call sites).

## No hardcoding

5. **Tokens live in exactly one place** — color, type, rhythm and rounding
   in `packages/app/src/styles/tokens.css` only (Tailwind `@theme` plus the
   `:root` ramps). Type flows through `--ts`, rhythm through `--sp`, corners
   through the `--radius-*` rungs. No literal color/font/size/radius in any
   other stylesheet or component. Nested rounding is arithmetic, not taste:
   a surface inset by `p` inside a parent of radius `R` uses
   `calc(var(--radius-*) - var(--sp-*))` so the arcs stay concentric. `index.css` is an import manifest, nothing
   else.
6. **No magic numbers in logic** — named budgets (`render-cpu/perf`),
   named epochs (`paintToken`), cache keys that encode every input
   (series + src + threshold + method + mask version).
7. **No rotting fixtures** — e2e authors its own hostile bytes (the wire
   TCK builder); math is pinned by frozen golden hashes, never by
   eyeballed screenshots.

## State & data flow

8. **Single source of truth** — one `UiState` store (`lib/store.ts`);
   components subscribe, canvases paint imperatively from the same state.
9. **Ephemeral vs persisted is explicit** — appearance persists to
   `localStorage`; viewport/tab/session state does not. Never mix.
10. **Stale async results die by design** — tokens and epochs
    (`paintToken`, `vrToken`, `mine !== current → return`). Never rely on
    the old work finishing first.
11. **Cache keys encode everything they depend on** — a key missing one
    input is a bug, not an optimization.

## Errors

12. **Fail loud with a named error** — every decoder maps hostile input to
    a named error (`truncated`, `bad-json`); `corrupt.test.ts` in `io` +
    `render-cpu` proves it for every format.
13. **Never silently swallow** — `catch {}` only where justified, with a
    comment (private-mode `localStorage`) and a fallback value.
14. **Tell the user, not the console** — every import/export ends in a
    visible status or toast, never console-only.

## Testing

15. **One `it` per behavior** — loop-generated `it`s are inflation; tables
    inside one `it` are fine.
16. **Golden hashes for math, scripts for wiring** — render math pinned by
    hashes; user flows proven by `test/e2e/*`, never by hand.
17. **Assert persistent signals, not transients** — toasts, canvas pixels,
    readout chips. Never a status line that repaints.
18. **Tests use the paths users use** — real key events, real file inputs,
    real taps. Synthetic `input`/`change` dispatches miss React handlers;
    fresh pages beat reloads for file inputs.
19. **New UI lands with a wire leg** — tabs, fullscreen, the pop-outs all
    shipped with assertions (`test/e2e/wire.mjs`), not screenshots.

## UI discipline

20. **No new ids without a consumer** — `markers.mjs` enforces shell/e2e id
    sync; every `id=` is referenced somewhere.
21. **Breakpoints have a single source** — one 980px value shared by CSS
    and the `useIsMobile` twin. Never two numbers drifting.
22. **Interactive targets ≥24px, verified by audit** — `audit:mobile`
    measures; eyeballs don't count.
22a. **Text clears WCAG AA (4.5:1) on every surface it can land on** —
    checked by `audit:a11y` (`test/e2e/a11y.mjs`, axe-core over 8 routes x 2
    breakpoints, in `npm run ci`), not judged by eye. The ink ramp in
    `tokens.css` records its own ratios. An opacity that fades chrome fades
    the words on it: the gate reads the composite, not the token.
22b. **An ARIA role is a promise about behaviour** — same checker. `tablist`
    owns only tabs and always has one selected; buttons that toggle a panel
    open and shut are disclosures (`aria-expanded` + `aria-controls`), not
    tabs. Borrowing a role for its looks makes the app lie to a screen
    reader.
23. **Every overlay has an exit** — Esc, ✕, or re-tap. No trapped popups.
    Fullscreen always keeps its ⛶ visible.

## Docs & process

24. **Docs land with the feature** — the production doc a change affects
    (`docs/ARCHITECTURE.md`, `DEPLOYMENT.md`, `SECURITY.md`, `DATA.md`,
    `TESTING.md`, `THIRD-PARTY.md`) changes in the same commit, not after.
    Ported code names its upstream in its header and in
    `docs/THIRD-PARTY.md` (checked by `verify.test.ts`).
25. **Deferred work gets an owner + unblock step** — recorded where it is
    decided (the commit or issue that defers it), with a name on it, never
    a vague TODO.
26. **No TODO/FIXME in source** — deferred work lives in the tracker, not in
    the code. Checked by
    `no-warning-comments` in `eslint.config.js`, at the start of a comment
    (so a sentence that mentions the word, or a mask diagram drawn in Xs,
    is not a violation).
27. **Verify before claiming** — `build` + `typecheck` + full gates before
    "done," every time. Screenshots are reviewed with eyes; green checks
    alone don't mean it looks good.
28. **A gate runs on every push, or it is not a gate** — `npm run ci`
    (`.github/workflows/ci.yml`) is the floor: build, typecheck, lint,
    unit, markers, app build, plus the Docker image. A rule nobody runs is
    a preference.
29. **A skipped check never reports as a pass** — a suite whose fixture is
    absent skips through `@carys/testkit` and is counted in `# skipped`.
    Returning early with a `console.log` scores as a PASS and is banned:
    that is how three `precomputed` checks sat green without executing.
    `npm run verify` sets `CARYS_REQUIRE_SAMPLES=1` so a missing fixture
    fails instead of skipping.
30. **Lint covers what the other gates structurally cannot** — golden hashes
    pin math, wire pins flows, `verify.test.ts` pins architecture; none of
    them sees a floating promise or a literal that silently became
    `Infinity`. Type-aware rules only, `--max-warnings 0`, and a rule that
    fires only false positives gets deleted with its reason written down —
    never left on as noise.
