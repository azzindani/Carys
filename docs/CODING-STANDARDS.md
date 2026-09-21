# Coding standards (enforced, not suggested)

Rules below are load-bearing: most are checked by tests, not by review.
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
   other stylesheet or component. `index.css` is an import manifest, nothing
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
19. **New UI lands with a wire leg** — tabs, fullscreen, toolbar toggle all
    shipped with assertions (`test/e2e/wire.mjs`), not screenshots.

## UI discipline

20. **No new ids without a consumer** — `markers.mjs` enforces shell/e2e id
    sync; every `id=` is referenced somewhere.
21. **Breakpoints have a single source** — one 980px value shared by CSS
    and the `useIsMobile` twin. Never two numbers drifting.
22. **Interactive targets ≥24px, verified by audit** — `audit:mobile`
    measures; eyeballs don't count.
23. **Every overlay has an exit** — Esc, ✕, or re-tap. No trapped popups.
    Fullscreen always keeps its ⛶ visible.

## Docs & process

24. **Docs land with the feature** — PHASES + DIGEST entries in the same
    change, not after.
25. **Deferred work gets an owner + unblock step** — "blocked" is a
    terminal state with a name on it (see the PHASES closeout ledger),
    never a vague TODO.
26. **No TODO/FIXME in source** — the ledger owns the future.
27. **Verify before claiming** — `build` + `typecheck` + full gates before
    "done," every time. Screenshots are reviewed with eyes; green checks
    alone don't mean it looks good.
