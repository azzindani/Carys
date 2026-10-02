# Changelog

## v0.2.0 (2026-10-02)

### Added
- Phone layout on every route: the image on top, the controls in a bottom
  deck. The deck starts hidden behind a handle and has three levels (hidden,
  half, full), moved by swiping the handle, pressing it or the arrow keys.
- A slice scrubber in the viewer deck, and bottom sheets for menus, the
  appearance panel and the command palette.
- README screenshots of real, publishable data (`docs/screenshots/`): the
  OpenNeuro ds000001 T1 MRI, PDB 6M0J and 1SVA, and the BodyParts3D body.
- A release workflow (`.github/workflows/release.yml`): a version tag runs
  the gates and publishes the release with these notes and the web build.

### Changed
- A softer look: tinted surfaces, faint outlines, a muted green accent and
  rounder corners, matching the chosen mock-up.
- The app is served at the site root; the `/packages/app/dist/` path is no
  longer needed.
- The production domain is no longer in the repository: `deploy/up.sh` reads
  it from `deploy/.env` (`CARYS_DOMAIN`).

### Fixed
- Every route except the viewer could not scroll on a phone.
- Small controls and clipped toolbars found by the new unreachable-control
  audit (`audit:ui`).
- Scrollable panes and the sequence strip are reachable from the keyboard.
- The workspace packages pin each other at the released version, so
  `npm ci` resolves them locally.
