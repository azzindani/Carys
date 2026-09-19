# Digest Group 13 — editing + measurement receipts

## Editing (slice.html, thin but real)
- Paint/erase brush on axial pane (Bresenham-connected strokes, radius),
  edit mask doubles as overlay; starts as seg copy when present.
- UndoStack (RLE, depth 16), clear, save-axial-PNG. Backing ops
  (drawPt/drawPenLine/UndoStack/RLE) unit-tested in draw.test.ts.
- Shared browser loaders factored to ui/viewer-lib.js (both pages).

## Measurement sweep (samples-measure.test.ts, headless)
- maskVolume + bbox over 8 seg pairs (liver naming swap mapped):
  brats 26.5cm³, liver 1826.5cm³ (~1.8L — spacing validated),
  hepatic 31.8, skull 88.2, spine-11 461.2, spine-ct 261.4,
  covid 222.0, lesion 18.7. All positive, sub-image, bbox inside dims.
