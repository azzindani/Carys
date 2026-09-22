import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { bandPlan, IDR_CATALOG, IDR_DIGEST_ID, IDR_DIGEST_PIN, idrById, joinZarrUrl, OmeZarrStore, parsePlateAttrs, parseWellAttrs, pickPyramidLevel, plateWellLabel, type FetchFn, type PlateMeta, type PlateWellRef } from '@carys/io';
import { EDUCATION_BADGE } from '@carys/study';
import { session } from '../lib/session';
import { cellAt, compositeChannelsViv, DEFAULT_COLORS, downsampleTile, getChannelStats, History, labelCells, type CellTable } from '@carys/volume-core';
import { setStatus } from '../lib/status';
import { bump } from '../lib/version';
import { toast } from '../lib/toasts';
import { undoBus } from '../lib/undoBus';
import { Chip, DarkSelect, IconBtn, Seg, SliderRow, Switch, UndoGroup } from '../ui/primitives';

// Synthetic demo store: 2 channels x 64x64, chunked 32x32, served from memory
// through the REAL OmeZarrStore path (open/getTile/decode). Channel 0 reads
// as nuclei-like blobs, channel 1 as a membrane-like ring. Labeled synthetic
// everywhere; real stores open via URL below.
const DEMO = 64, DCHUNK = 32;

function demoPixel(c: number, x: number, y: number): number {
  const blob = (cx: number, cy: number, s: number): number => {
    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    return 255 * Math.exp(-d2 / (2 * s * s));
  };
  if (c === 0) return Math.min(255, blob(20, 22, 7) + blob(44, 40, 9) + 8);
  const r = Math.hypot(x - 32, y - 32);
  return Math.min(255, 220 * Math.exp(-((r - 20) ** 2) / 18) + 8);
}

function demoFetch(): FetchFn {
  const files = new Map<string, Uint8Array | object>();
  files.set('demo://cells/.zattrs', {
    multiscales: [{
      axes: [{ name: 'c' }, { name: 'z' }, { name: 'y' }, { name: 'x' }],
      datasets: [{ path: '0' }, { path: '1' }],
    }],
  });
  files.set('demo://cells/0/.zarray', {
    zarr_format: 2, shape: [2, 1, DEMO, DEMO], chunks: [1, 1, DCHUNK, DCHUNK],
    dtype: '|u1', compressor: null, fill_value: 0, order: 'C', filters: null,
  });
  files.set('demo://cells/1/.zarray', {
    zarr_format: 2, shape: [2, 1, DEMO / 2, DEMO / 2], chunks: [1, 1, DCHUNK, DCHUNK],
    dtype: '|u1', compressor: null, fill_value: 0, order: 'C', filters: null,
  });
  // full-res pixels, retained to downsample level 1
  const full: Uint8Array[][] = [];
  for (let c = 0; c < 2; c++) {
    full.push([]);
    for (let cy = 0; cy < 2; cy++) {
      for (let cx = 0; cx < 2; cx++) {
        const bytes = new Uint8Array(DCHUNK * DCHUNK);
        for (let y = 0; y < DCHUNK; y++) {
          for (let x = 0; x < DCHUNK; x++) {
            bytes[y * DCHUNK + x] = Math.round(demoPixel(c, cx * DCHUNK + x, cy * DCHUNK + y));
          }
        }
        files.set(`demo://cells/0/${c}.0.${cy}.${cx}`, bytes);
        full[c]!.push(bytes);
      }
    }
  }
  // level 1: floor-mean 2x2 downsample of level 0
  for (let c = 0; c < 2; c++) {
    const small = new Uint8Array((DEMO / 2) * (DEMO / 2));
    const at = (x: number, y: number): number => {
      const cx = Math.floor(x / DCHUNK), cy = Math.floor(y / DCHUNK);
      return full[c]![cy * 2 + cx]![(y % DCHUNK) * DCHUNK + (x % DCHUNK)]!;
    };
    for (let y = 0; y < DEMO / 2; y++) {
      for (let x = 0; x < DEMO / 2; x++) {
        small[y * (DEMO / 2) + x] = Math.floor((at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4);
      }
    }
    files.set(`demo://cells/1/${c}.0.0.0`, small);
  }
  return (async (url: string) => {
    const f = files.get(url);
    if (!f) return new Response('nope', { status: 404 });
    if (f instanceof Uint8Array) return new Response(f as unknown as BodyInit);
    return Response.json(f);
  }) as FetchFn;
}

interface ChanRow {
  min: number; max: number; mean: number; lo: number; hi: number;
}

/** Brushing a huge store labels a scaled tile, never the full frame: the
 *  cell table stays interactive while the composite paints full-res. */
const BRUSH_TILE_MAX = 256;

export function CellsView(): JSX.Element {
  const [store, setStore] = useState<OmeZarrStore | null>(null);
  const [idrId, setIdrId] = useState('');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [vis, setVis] = useState<boolean[]>([true, true]);
  const [level, setLevel] = useState(0);
  // -1 = auto: the viewport width picks the coarsest covering level; the
  // chip shows the resolved level so the pick is never silent.
  const [autoLevel, setAutoLevel] = useState(true);
  const [rows, setRows] = useState<ChanRow[]>([]);
  const [bands, setBands] = useState(0);
  // Cell table (brushing): label + threshold + selected id; the table rows
  // live here, the labelmap + source channel tile in the ref (painted, not
  // rendered — canvas highlight reads them imperatively).
  const [brushOn, setBrushOn] = useState(false);
  const [brushCh, setBrushCh] = useState(0);
  const [brushThr, setBrushThr] = useState(40);
  const [selId, setSelId] = useState(0);
  const brushRef = useRef<{ table: CellTable; factor: number; level: number; channel: number } | null>(null);
  const [plate, setPlate] = useState<{ meta: PlateMeta; base: string; well: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Progressive-paint epoch: a new paint invalidates in-flight band fetches
  // (store/well/level toggle mid-paint); stale bands return before putImageData.
  const epochRef = useRef(0);
  // View-state undo shares the History contract: one entry snapshots the
  // full {vis, level} pair so undo restores both together. Snapshots are
  // fresh arrays, never mutated after push.
  const viewHist = useRef(new History<{ vis: boolean[]; level: number }>(32));

  const selIdRef = useRef(0);
  const cvSizeRef = useRef({ w: 0, h: 0 });
  // Latest table rows for the click→row path (state lags the canvas click).
  const cellsRef = useRef<CellTable | null>(null);

  /** Accent outline of the selected cell over the finished frame (tile →
   *  canvas pixels through the brush downsample factor). No-op without a
   *  table or selection: the composite stays byte-identical. */
  const drawSelection = (ctx: CanvasRenderingContext2D): void => {
    const br = brushRef.current;
    const id = selIdRef.current;
    if (!br || id <= 0) return;
    if (cvSizeRef.current.w === 0) return;
    const cell = br.table.cells.find((c) => c.id === id);
    if (!cell) return;
    ctx.strokeStyle = '#2dd4bf';
    ctx.lineWidth = Math.max(1.5, cvSizeRef.current.w / 220);
    ctx.strokeRect(
      cell.x0 * br.factor - 0.5, cell.y0 * br.factor - 0.5,
      (cell.x1 - cell.x0 + 1) * br.factor + 1, (cell.y1 - cell.y0 + 1) * br.factor + 1,
    );
  };

  const paint = async (s: OmeZarrStore, visibility: boolean[], name: string, lvl: number, opts: { auto?: boolean; quiet?: boolean } = {}): Promise<void> => {
    const cv = canvasRef.current;
    if (!cv) return;
    const my = ++epochRef.current;
    // Auto resolution: coarsest pyramid level covering the stage width, so a
    // large NGFF paints from tiles instead of the full-res level. Manual
    // picks bypass (the level select sets auto off).
    let want = lvl;
    if (opts.auto) {
      const widths = s.levels.map((l) => l.meta.shape[l.meta.axes.indexOf('x')]!);
      const target = Math.max(1, Math.round(cv.clientWidth || cv.parentElement?.clientWidth || widths[0]!));
      want = pickPyramidLevel(widths, target);
      setLevel(want);
    }
    const lm = s.levels[want]?.meta ?? s.meta;
    const iy = lm.axes.indexOf('y'), ix = lm.axes.indexOf('x');
    const h = lm.shape[iy]!, w = lm.shape[ix]!;
    const shown = visibility.map((v, c) => (v ? c : -1)).filter((c) => c >= 0);
    const rgba = new Uint8ClampedArray(w * h * 4);
    cv.width = w; cv.height = h;
    cvSizeRef.current = { w, h };
    // quiet = selection outline repaints (selectCell / canvas-clear): the
    // frame redraws but the status line stays owned by the selection readout
    // the 8c leg waits on — paint's band/chunks notes would bury it.
    const note = (msg: string): void => {
      if (opts.quiet || epochRef.current !== my) return;
      const cy = s.meta.axes.indexOf('c');
      setStatus(`${name} · ${shown.length}/${s.meta.shape[cy] ?? 0} channels · ${w}×${h} · L${want}${opts.auto ? ' auto' : ''} · ${msg} · ${s.cache.size} chunks cached`);
    };
    if (shown.length > 0) {
      // Contrast limits need the full frame first (one fetch per channel);
      // bands below re-read the row ranges out of the retained tiles.
      const tiles = await Promise.all(
        shown.map((c) => s.getTile({ s: want, c, z: 0, x: 0, y: 0, w, h })),
      );
      if (epochRef.current !== my) return;
      const stats = tiles.map((t) => getChannelStats(t));
      setRows(stats.map((st) => ({
        min: st.min, max: st.max, mean: Math.round(st.mean * 10) / 10,
        lo: Math.round(st.contrastLimits[0]), hi: Math.round(st.contrastLimits[1]),
      })));
      const colors = shown.map((c) => DEFAULT_COLORS[c % DEFAULT_COLORS.length]!);
      const limits = stats.map((st) => st.contrastLimits);
      const ctx = cv.getContext('2d')!;
      const plan = bandPlan(h);
      setBands(plan.length);
      let b = 0;
      for (const band of plan) {
        if (epochRef.current !== my) return;
        const part = new Uint8ClampedArray(band.h * w * 4);
        const slices = tiles.map((t) => t.subarray(band.y * w, (band.y + band.h) * w));
        compositeChannelsViv(slices, limits, colors, part);
        rgba.set(part, band.y * w * 4);
        ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
        b++;
        note(`band ${b}/${plan.length}`);
      }
      drawSelection(ctx);
    } else {
      setRows([]);
      setBands(0);
      cv.getContext('2d')!.putImageData(new ImageData(rgba, w, h), 0, 0);
    }
    // Keep the progressive-band readout on the persistent status: the final
    // chunks-cached note otherwise overwrites the only "band N/N" evidence
    // the 8b wire leg waits on (plan is scoped to the shown branch, so
    // recompute the count here instead of reaching across the branch).
    note(`band ${bandPlan(h).length}/${bandPlan(h).length} · ${s.cache.size} chunks cached`);
  };

  const openDemo = async (): Promise<void> => {
    try {
      const s = await OmeZarrStore.open('demo://cells', demoFetch());
      setLabel('synthetic demo (2ch blobs+ring)');
      setPlate(null);
      setVis([true, true]);
      setAutoLevel(false);
      setLevel(0);
      setStore(s);
      viewHist.current.clear(); // new document drops view history (mirrors mask undo)
      await paint(s, [true, true], 'synthetic demo (2ch blobs+ring)', 0);
    } catch (err) {
      setStatus(`demo open failed: ${(err as Error).message}`, 'error');
    }
  };

  // In-flight IDR/URL opens vs route swaps: openUrl's awaits resolve after
  // the user has left #/cells (leg 9 leaves for #/ while EBI fetches hang),
  // and the late showStore/paint would repaint a dead canvas + clobber the
  // home status. The epoch guards it: every open captures the count, and
  // completions from a superseded open return before touching state.
  const openEpoch = useRef(0);
  const openIdr = async (id: string): Promise<void> => {
    const entry = idrById(id);
    if (!entry) {
      setStatus(`unknown IDR entry: ${id}`);
      return;
    }
    session.digestPins = { [IDR_DIGEST_ID]: IDR_DIGEST_PIN };
    setIdrId(id);
    setUrl(entry.storeUrl);
    bump();
    await openUrl(entry.storeUrl);
    // The open path reports codec rejection itself; the caption only adds
    // the teaching context the catalog owns (codec + annotation). No epoch
    // guard here: openUrl owns the openEpoch (openIdr shares it — a second
    // openIdr/openUrl call supersedes the first inside openUrl itself), and
    // this caption must land even when openUrl's fetch failed fast: the 8d
    // leg waits on the blosc teaching line, not on pixels.
    if (!entry.decodable) {
      setStatus(`${entry.study}: ${entry.codec} chunks need the P0 blosc/zstd toolchain (${entry.annotation}) · ${EDUCATION_BADGE}`);
    }
  };

  const openUrl = async (base0?: string): Promise<void> => {
    const base = (base0 ?? url).trim().replace(/\/$/, '');
    if (!base) return;
    const my = ++openEpoch.current;
    const live = (): boolean => my === openEpoch.current;
    try {
      // Plate roots carry no multiscales: probe .zattrs first and divert.
      try {
        const res = await fetch(`${base}/.zattrs`);
        if (!live()) return;
        if (res.ok) {
          const meta = parsePlateAttrs(await res.json());
          if (meta) {
            if (meta.wells.length === 0) { setStatus('plate has no wells'); return; }
            await openWell(base, meta, meta.wells[0]!);
            return;
          }
        }
      } catch { /* not a plate (or unreachable): fall through to store open */ }
      const s = await OmeZarrStore.open(base, (u, init) => fetch(u, init));
      if (!live()) return;
      setPlate(null);
      await showStore(s, base);
    } catch (err) {
      if (!live()) return;
      setStatus(`zarr open failed: ${(err as Error).message}`, 'error');
    }
  };

  const showStore = async (s: OmeZarrStore, name: string): Promise<void> => {
    const nC = s.meta.shape[s.meta.axes.indexOf('c')] ?? 1;
    const v = Array.from({ length: nC }, (_, i) => i < 3);
    setLabel(name);
    setVis(v);
    // Remote + sample stores paint pyramid-aware: the viewport width picks
    // the coarsest covering level (auto stays on until the user picks).
    setAutoLevel(true);
    setLevel(0);
    setStore(s);
    viewHist.current.clear();
    await paint(s, v, name, 0, { auto: true });
  };

  const openWell = async (base: string, meta: PlateMeta, well: PlateWellRef): Promise<void> => {
    // Drop stale channel stats up front: setPlate (the well name) commits
    // before paint's async setRows, so without this the new well name sits
    // above the previous well's numbers for a beat.
    setRows([]);
    const res = await fetch(joinZarrUrl(base, well.path, '.zattrs'));
    if (!res.ok) throw new Error(`well ${well.path} -> ${res.status}`);
    const wmeta = parseWellAttrs(await res.json());
    if (!wmeta) throw new Error(`well ${well.path} has no images`);
    const s = await OmeZarrStore.open(joinZarrUrl(base, well.path, wmeta.images[0]!), (u, init) => fetch(u, init));
    setPlate({ meta, base, well: well.path });
    await showStore(s, `${base} well ${plateWellLabel(meta, well)}`);
  };

  const pickWell = (path: string): void => {
    if (!plate) return;
    const well = plate.meta.wells.find((w) => w.path === path);
    if (!well) return;
    void openWell(plate.base, plate.meta, well).catch((err) => setStatus(`well open failed: ${(err as Error).message}`, 'error'));
  };

  const doUndoCells = (): void => {
    if (!viewHist.current.canUndo) {
      toast('Nothing to undo', 'error');
      return;
    }
    const prev = viewHist.current.undo()!;
    setVis(prev.vis);
    setAutoLevel(false);
    setLevel(prev.level);
    if (store) void paint(store, prev.vis, label || 'store', prev.level);
  };
  const clearChannels = (): void => {
    if (!store || vis.every((v) => !v)) return;
    viewHist.current.push({ vis: [...vis], level });
    const v = vis.map(() => false);
    setVis(v);
    void paint(store, v, label || 'store', level, { auto: autoLevel });
  };

  // Mount-once: openDemo is redefined every render, so listing it as a
  // dependency would re-open the demo store on every repaint. The empty array
  // is the intent, not an oversight.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void openDemo(); }, []);
  // Re-register every render: the closure carries the latest store/label.
  useEffect(() => {
    undoBus.current = doUndoCells;
    return () => { undoBus.current = () => {}; };
  });

  const toggle = (c: number): void => {
    if (!store) return;
    viewHist.current.push({ vis: [...vis], level });
    const v = vis.map((x, i) => (i === c ? !x : x));
    setVis(v);
    void paint(store, v, label || 'store', level, { auto: autoLevel });
  };

  const pickLevel = (lv: number): void => {
    if (!store) return;
    viewHist.current.push({ vis: [...vis], level });
    // An explicit pick leaves auto mode (recorded by undo, like the pick).
    // A level switch drops the cell table: ids belong to one labelmap.
    setAutoLevel(false);
    setLevel(lv);
    if (brushOn) {
      brushRef.current = null;
      cellsRef.current = null;
      selIdRef.current = 0;
      setSelId(0);
      setCellsTick((t) => t + 1);
    }
    void paint(store, vis, label || 'store', lv);
  };

  const pickAuto = (on: boolean): void => {
    if (!store || on === autoLevel) return;
    viewHist.current.push({ vis: [...vis], level });
    setAutoLevel(on);
    void paint(store, vis, label || 'store', level, { auto: on });
  };

  /** Drop the table (level/store/well switch, brush off): stale ids must
   *  never outlive their labelmap. Repaints without the outline. */
  const clearBrush = (s: OmeZarrStore | null, visibility: boolean[], name: string, lvl: number, auto: boolean): void => {
    brushRef.current = null;
    cellsRef.current = null;
    selIdRef.current = 0;
    setSelId(0);
    setCellsTick((t) => t + 1);
    if (s) void paint(s, visibility, name, lvl, { auto });
  };

  const setBrushEnabled = (on: boolean): void => {
    setBrushOn(on);
    if (!on) {
      if (store) clearBrush(store, vis, label || 'store', level, autoLevel);
      return;
    }
    void relabel();
  };

  /** Label the brush channel at the painted level (scaled to
   *  BRUSH_TILE_MAX): threshold + min-area dust filter. The table lands in
   *  the ref for both paths (rows read it during render); selId clears. */
  const relabelNow = async (s: OmeZarrStore, ch: number, t: number): Promise<void> => {
    const nC = s.meta.shape[s.meta.axes.indexOf('c')] ?? 1;
    const cc = Math.max(0, Math.min(ch, nC - 1));
    const lv = s.levels[level]?.meta ?? s.meta;
    const h = lv.shape[lv.axes.indexOf('y')]!, w = lv.shape[lv.axes.indexOf('x')]!;
    try {
      const raw = await s.getTile({ s: level, c: cc, z: 0, x: 0, y: 0, w, h });
      const vals = Array.from(raw, (v) => v as number);
      const factor = Math.max(1, Math.ceil(Math.max(w, h) / BRUSH_TILE_MAX));
      const small = factor > 1 ? downsampleTile(vals, w, h, factor) : { data: Float64Array.from(vals), w, h };
      const table = labelCells(small.data, small.w, small.h, t, 4);
      brushRef.current = { table, factor, level, channel: cc };
      cellsRef.current = table;
      selIdRef.current = 0;
      setSelId(0);
      setCellsTick((t) => t + 1);
      // Outline state changed (cleared): repaint the frame without refetch
      // churn — paint() is epoch-guarded, tiles come from the chunk cache.
      void paint(s, vis, label || 'store', level, { auto: autoLevel });
      setStatus(`${label || 'store'} · ${table.count} cells (C${cc} L${level} thr ${t}) · click a row or the canvas`);
    } catch (err) {
      setStatus(`cell table failed: ${(err as Error).message}`, 'error');
    }
  };

  const relabel = (): Promise<void> => {
    const s = store;
    if (!s) return Promise.resolve();
    return relabelNow(s, brushCh, brushThr);
  };

  const pickBrushCh = (c: number): void => {
    setBrushCh(c);
    if (brushOn) relabelSoon();
  };

  const pickBrushThr = (t: number): void => {
    setBrushThr(t);
    if (brushOn) relabelSoon();
  };

  // Debounced relabel for the channel/threshold controls (labels a 256px
  // tile; still async, so drags collapse into one run). Timer id lives on
  // the function; the run reads the CURRENT store/level, never stale args.
  const relabelSoon = (): void => {
    const fn = relabelSoon as unknown as { timer?: ReturnType<typeof setTimeout> };
    clearTimeout(fn.timer);
    fn.timer = setTimeout(() => {
      const s = store;
      if (!s || !brushOn) return;
      void relabelNow(s, brushCh, brushThr);
    }, 150);
  };

  /** Row → viewport: select the cell, repaint the outline. */
  const selectCell = (id: number): void => {
    selIdRef.current = id;
    setSelId(id);
    // Status first: the outline repaint below ends in paint()'s own status
    // note (band/chunks), which would otherwise bury the cell readout the
    // 8c wire leg waits on. Paint's note stays the last word only when it
    // carries no selection to report — here the selection owns the line.
    const cv = canvasRef.current;
    if (cv && store) {
      // Outline only: quiet repaint redraws the frame + accent rect without
      // touching the status line — the cell readout below owns it (8c leg).
      void paint(store, vis, label || 'store', level, { auto: autoLevel, quiet: true });
    }
    const cell = cellsRef.current?.cells.find((c) => c.id === id);
    if (cell) {
      const br = brushRef.current;
      const sx = br ? br.factor : 1;
      setStatus(`${label || 'store'} · cell #${id} · area ${(cell.area * sx * sx).toLocaleString()} px² · centroid (${(cell.cx * sx).toFixed(1)}, ${(cell.cy * sx).toFixed(1)}) · mean ${cell.mean.toFixed(1)}`);
    }
  };

  /** Viewport → table: canvas click resolves through the labelmap. */
  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const br = brushRef.current;
    const cv = canvasRef.current;
    if (!br || !cv || !brushOn) return;
    const r = cv.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / (r.width || 1)) * cv.width;
    const fy = ((e.clientY - r.top) / (r.height || 1)) * cv.height;
    const id = cellAt(br.table, fx / br.factor, fy / br.factor);
    if (id > 0) {
      selectCell(id);
    } else {
      selIdRef.current = 0;
      setSelId(0);
      // Outline-off only: quiet repaint clears the accent rect without
      // touching the status line (8c asserts the cleared selection, not a
      // paint note).
      if (store) void paint(store, vis, label || 'store', level, { auto: autoLevel, quiet: true });
    }
  };

  // Table rows for render: the ref owns the data (async label), the tick
  // re-renders when a new table lands. selId re-renders the highlight.
  const [cellsTick, setCellsTick] = useState(0);
  const cells = cellsRef.current?.cells ?? [];

  const nC = store ? store.meta.shape[store.meta.axes.indexOf('c')] ?? 1 : 0;
  return (
    <>
      <div className="view-title" id="title-cells">
        <h1>Cells</h1>
        <p>{label || 'open a zarr store — OME chunk path, CPU composite'}</p>
      </div>
      <div className="dock" id="dock-cells">
        <div className="grp">
          <IconBtn accent title="Open the built-in synthetic demo store" onClick={() => { void openDemo(); }}>Demo store</IconBtn>
          <IconBtn title="Open the vendored sample store over HTTP (real fetch path)" onClick={() => { setUrl('/samples/cells_demo.zarr'); void openUrl('/samples/cells_demo.zarr'); }}>Sample .zarr</IconBtn>
        </div>
        <div className="grp">
          <span className="lbl">IDR</span>
          <DarkSelect value="" title="Pinned IDR screens (catalog pins the store version; blosc chunks stay loud until the P0 toolchain lands)" ariaLabel="IDR screen"
            onChange={(v) => { if (v) void openIdr(v); }}>
            <option value="">—</option>
            {IDR_CATALOG.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </DarkSelect>
        </div>
        {idrId && (
          <div className="grp">
            <Chip><span id="ro-idr">{idrId} · {IDR_DIGEST_PIN} · {EDUCATION_BADGE}</span></Chip>
          </div>
        )}
        <div className="grp">
          <input
            id="zurl" className="urlinput" placeholder="https://…/store.zarr" aria-label="Zarr store URL"
            value={url} onChange={(e) => setUrl((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if ((e as React.KeyboardEvent).key === 'Enter') void openUrl(); }}
          />
          <IconBtn title="Open a remote OME-Zarr store (v2, raw/gzip/zlib chunks)" onClick={() => { void openUrl(); }}>Open URL</IconBtn>
        </div>
        {plate && (
          <div className="grp">
            <span className="lbl">Well</span>
            <Seg id="wellseg" dataKey="well" ariaLabel="Plate wells"
              value={plate.well} onChange={(v) => pickWell(v)}
              options={plate.meta.wells.map((w) => ({ value: w.path, label: plateWellLabel(plate.meta, w) }))} />
            <Chip><span id="ro-plate">{plate.meta.wells.length} wells · {plateWellLabel(plate.meta, plate.meta.wells.find((w) => w.path === plate.well)!)}</span></Chip>
          </div>
        )}
        <div className="sep" />
        {store && store.levels.length > 1 && (
          <div className="grp">
            <span className="lbl">Level</span>
            <Switch checked={autoLevel} label="Auto" onChange={(v) => pickAuto(v)} />
            <DarkSelect value={String(level)} title="Pyramid level" ariaLabel="Pyramid level"
              onChange={(v) => pickLevel(Number(v))}>
              {store.levels.map((lv, i) => {
                const d = lv.meta.axes;
                return <option key={i} value={i}>L{i} {lv.meta.shape[d.indexOf('x')]}×{lv.meta.shape[d.indexOf('y')]}</option>;
              })}
            </DarkSelect>
            <Chip title="Auto-picked level + progressive band count"><span id="ro-level">{autoLevel ? `auto L${level}` : `L${level}`} · {bands > 0 ? `${bands} bands` : '—'}</span></Chip>
            <Switch checked={level === store.levels.length - 1 && !autoLevel} label="Low-BW"
              onChange={(on) => {
                if (!store) return;
                // No-op guard: a manual pick of the smallest level already
                // satisfies the switch (checked derives from level, not from
                // a toggle), so "checking" a checked box must not repaint or
                // relabel — the off-toggle below stays a real, testable path.
                if (on === (level === store.levels.length - 1 && !autoLevel)) return;
                if (on) pickLevel(store.levels.length - 1);
                else pickAuto(true);
                setStatus(on ? `low-bandwidth: smallest level pinned · ${EDUCATION_BADGE}` : 'low-bandwidth off: auto level resumes');
              }} />
          </div>
        )}
        {Array.from({ length: nC }, (_, c) => (
          <div className="grp" key={c}>
            <label className="chk" title={`Channel ${c}`}>
              <input type="checkbox" data-ch={c} checked={vis[c] ?? false} onChange={() => toggle(c)} /> C{c}
            </label>
          </div>
        ))}
        <div className="sep" />
        <UndoGroup onUndo={doUndoCells} onClear={clearChannels} undoTitle="Undo view change" clearTitle="Hide all channels" />
        <div className="sep" />
        <div className="grp">
          <Switch checked={brushOn} label="Cells" onChange={(v) => setBrushEnabled(v)} />
          {brushOn && (
            <Chip title="Labeled cells at the painted level"><span id="ro-cells-n">{cells.length} cells</span></Chip>
          )}
        </div>
        {brushOn && store && (
          <>
            <div className="grp">
              <span className="lbl">Brush ch</span>
              <DarkSelect value={String(Math.min(brushCh, nC - 1))} title="Brush channel" ariaLabel="Brush channel"
                onChange={(v) => pickBrushCh(Number(v))}>
                {Array.from({ length: nC }, (_, c) => <option key={c} value={c}>C{c}</option>)}
              </DarkSelect>
            </div>
            <SliderRow label="Thr" min={1} max={255} step={1} value={brushThr} width={72}
              onInput={(v) => pickBrushThr(v)} />
          </>
        )}
      </div>
      <div id="view-cells" className="panes" data-testid="cells">
        <div className="pane" id="pane-cells">
          <div className="pane-head">
            <span className="name">Composite</span>
            <Chip><span id="ro-cells">{store ? `${nC}ch` : '—'}</span></Chip>
          </div>
          <div className="stage">
            <canvas id="c-cells" ref={canvasRef} role="img" aria-label="Channel composite. Click a cell to select it when brushing."
              onClick={onCanvasClick} style={brushOn ? { cursor: 'crosshair' } : undefined} />
          </div>
        </div>
        <div className="pane" id="pane-channels">
          <div className="pane-head"><span className="name">Channels</span>
            <Chip><span id="ro-stats">{rows.length} shown</span></Chip>
          </div>
          <dl className="kv" id="chaninfo">
            {rows.length === 0 ? <div className="hint">All channels hidden — or no store open.</div> : rows.map((r, i) => (
              <div className="mrow" key={i}>
                <dt>C{i} [{r.lo}–{r.hi}]</dt>
                <dd>min {r.min} · max {r.max} · mean {r.mean}</dd>
              </div>
            ))}
          </dl>
          {brushOn && (
            <dl className="kv" id="cellinfo" data-tick={cellsTick}>
              {cells.length === 0 ? (
                <div className="hint">No cells at this threshold — lower Thr.</div>
              ) : cells.slice(0, 200).map((c) => (
                <div className="mrow" key={c.id}>
                  <dt>#{c.id} · {c.area.toLocaleString()} px</dt>
                  <dd>
                    <button
                      className={`cellrow${selId === c.id ? ' on' : ''}`} data-cell={c.id}
                      title={`Select cell #${c.id} (mean ${c.mean.toFixed(1)}; perim ${c.perimeter}, extent ${c.extent.toFixed(2)}, form ${c.formFactor.toFixed(2)}, aspect ${c.aspect.toFixed(1)})`}
                      aria-pressed={selId === c.id}
                      onClick={() => selectCell(c.id)}
                    >
                      ({c.cx.toFixed(1)}, {c.cy.toFixed(1)}) · μ {c.mean.toFixed(1)} · P{c.perimeter} F{c.formFactor.toFixed(2)}
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {cells.length > 200 && (
            <div className="hint">…{cells.length - 200} more (first 200 shown)</div>
          )}
          {store && (
            <div className="hint" id="storeinfo">
              {store.meta.axes.join('/')} · shape [{store.meta.shape.join('×')}] · chunks [{store.meta.chunks.join('×')}] · {store.meta.dtype} · {store.compressor}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
