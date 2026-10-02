# Changelog

## Unreleased (draft, proposed v0.2.0)

Not released. Nothing here is tagged or published until the owner says so.

### Added
- Phone layout on every route: the image on top, the controls in a bottom
  deck. The deck starts hidden behind a handle and has three levels (hidden,
  half, full), moved by swiping the handle, pressing it or the arrow keys.
- A slice scrubber in the viewer deck, and bottom sheets for menus, the
  appearance panel and the command palette.
- README screenshots from licence-safe data (`docs/screenshots/`).

### Changed
- A softer look: tinted surfaces, faint outlines, a muted green accent and
  rounder corners, matching the chosen mock-up.
- The app is served at the bare domain; the `/packages/app/dist/` path is no
  longer needed.

### Fixed
- Every route except the viewer could not scroll on a phone.
- Small controls and clipped toolbars found by the new unreachable-control
  audit (`audit:ui`).
- Scrollable panes and the sequence strip are reachable from the keyboard.
