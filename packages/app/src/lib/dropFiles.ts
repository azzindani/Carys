// Files out of a drag-and-drop, folders included.
//
// A CT or MR study arrives as a folder — from a CD, a PACS export, a zip
// someone unpacked — and the file picker's "multiple" still makes the reader
// select hundreds of files by hand. Dropping the folder is the natural
// gesture. `DataTransfer.files` lists a dropped folder as a single empty
// entry, so the entries API walks it instead. Hidden files (".DS_Store",
// "._IM0001") are skipped: they are OS debris, never images.

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.name.startsWith('.')) return;
  if (entry.isFile) {
    out.push(await new Promise<File>((ok, err) => (entry as FileSystemFileEntry).file(ok, err)));
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns at most ~100 entries per call: read until empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((ok, err) => reader.readEntries(ok, err));
      if (batch.length === 0) break;
      for (const e of batch) await walk(e, out);
    }
  }
}

/** Every file in a drop, recursing into dropped folders, in drop order. */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items]
    .map((it) => it.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length === 0) return [...dt.files];
  const out: File[] = [];
  for (const e of entries) await walk(e, out);
  return out;
}
