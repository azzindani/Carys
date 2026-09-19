# Digest Group 17 — dicomParser walker hardening (second new-repo digest)

## dicomParser (cornerstonejs/dicomParser, note capital P)
- Found via the npm registry after `cornerstonejs/dicom-parser` 404s — the
  repo lives at a differently-cased URL. Single-purpose byte walker, no
  framework: `readDicomElementExplicit/Implicit`, sequence readers, UN-length
  resolution, encapsulated-frame finders. Skipped: everything about reading
  (we have a proven walker), PN/date parsing, encapsulated-frame extraction.

## Compared against our walker
- Length-32 VR set: theirs lacks UV/OV (older lib) — our Group-16 table
  already supersedes it. No change absorbed.
- UN + undefined length → `readSequenceItemsImplicit`: implicit files
  rewritten explicit keep UN VR on sequences. Ours did not handle this.

## Ported: `skipImplicitSequence` + loud undefined lengths
- Before: an undefined-length UN element got `valueLength 0xFFFFFFFF` and the
  offset jumped past the file end — every tag after the sequence silently
  vanished, no error. Any other stray undefined length did the same.
- After: UN-undefined walks implicit items to the sequence delimitation
  (nested undefined lengths and runaways throw `truncated` — bounded port,
  stated); any remaining stray undefined length throws `truncated` instead of
  dropping the tail. Encapsulated-pixel and implicit-SQ conventions unchanged.
- Proven: synthetic UN-wrapped sequence with a trailing PN element — both tags
  land with exact spans and the PN reads back; unterminated sequences and a
  stray undefined-length OD throw named errors. All 27 samples still parse,
  so the loud path fires only where the old code went silent.

## Deliberately out
- Encapsulated-frame extraction (our named-error boundary stands),
  PN/date/age string semantics, implicit-VR dictionary changes, the rest of
  the dicomParser file list.
