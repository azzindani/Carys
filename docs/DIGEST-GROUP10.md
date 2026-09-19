# Digest Group 10 — OHIF survey receipt (organization only)

## OHIF Viewers — TS/TSX monorepo, ~3,603 files
- pnpm workspaces: platform/* (7: app, core, ui, ui-next, cli, docs, i18n),
  extensions/* (14), modes/* (9).
- PORTED (organization only, zero viewer logic) → `volume-core/extension.ts`:
  - MODULE_TYPES 12-key vocabulary as plugin contract.
  - ExtensionManifest (id + preRegistration + get*Module + onModeEnter/Exit).
  - moduleKey "${extensionId}.${moduleType}.${name}" namespacing.
  - CommandDefinitions + ModePreset (inheritance-by-spread) + BOOT_ORDER.
  - Cornerstone split note: no extensions/vtk in v3 (folded into
    Cornerstone3D); SOP variants are thin wrappers around one renderer —
    same pattern for our CPU renderer later.
- SKIPPED: all viewport rendering, commands bodies, toolbars, hanging
  protocols, ui/ui-next, tests, lockfiles, webpack rules.
