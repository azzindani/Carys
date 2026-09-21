import { useEffect } from 'react';
import type { JSX } from 'react';
import { SERIES } from '../lib/catalog';
import type { Extractor } from '../lib/extractor';
import { useIsMobile } from '../lib/isMobile';
import { fmtDims, session } from '../lib/session';
import { handleOpenFiles } from '../lib/sessionOps';
import type { SliceInit } from '../lib/sessionOps';
import { setUi, useUiPick } from '../lib/store';
import { toast } from '../lib/toasts';
import { useVersion } from '../lib/version';
import { DarkSelect, Seg } from '../ui/primitives';
import { IconPanel } from '../ui/Icons';
import type { MSheet, MView } from '../lib/types';
import { MprTuneDock, MprToolDock, SegDock } from './MprView';
import { MprPanes } from './MprPanes';
import { SurfaceView } from './SurfaceView';

/** File tabs: one tab per open file (series). The topbar series picker and
 *  the worklist open files into tabs; switching tabs reloads that series,
 *  exactly like the picker always did — now visible. */
function FileTabs({ onOpen, id = 'filetabs', hidePlus = false }: {
  onOpen: (s: string) => void; id?: string; hidePlus?: boolean;
}): JSX.Element {
  const tabs = useUiPick('tabs');
  const series = useUiPick('series');
  const isMobile = useIsMobile();
  const open = tabs.length > 0 ? tabs : (series ? [series] : []);
  useEffect(() => {
    if (series && !open.includes(series)) setUi({ tabs: [...open, series] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series]);
  const close = (t: string, e: React.MouseEvent): void => {
    e.stopPropagation();
    if (open.length <= 1) return;
    const rest = open.filter((x) => x !== t);
    setUi({ tabs: rest });
    if (t === series) onOpen(rest[Math.max(0, open.indexOf(t) - 1)] ?? rest[0]!);
  };
  const plus = (): void => {
    // Mobile has no series select in the slim topbar: the Files panel owns it.
    if (isMobile) { setUi({ mSheet: 'files' }); return; }
    document.querySelector<HTMLElement>('.top select.dark')?.focus();
    toast('Pick a series above to open it in a new tab');
  };
  return (
    <div className="filetabs" id={id} role="tablist" aria-label="Open files">
      {open.map((t) => (
        <button
          key={t} role="tab" aria-selected={t === series} data-tab={t}
          data-active={t === series} className={t === series ? 'tab on' : 'tab'}
          title={t === series ? `${t} (active)` : `Switch to ${t}`}
          onClick={() => { if (t !== series) onOpen(t); }}
        >
          <span className="dot" aria-hidden="true" />
          <span className="tname">{t}</span>
          {open.length > 1 && (
            <span
              role="button" aria-label={`Close ${t}`} title={`Close ${t}`}
              data-closetab={t} className="x" onClick={(e) => close(t, e)}
            >
              ×
            </span>
          )}
        </button>
      ))}
      {!hidePlus && (
        <button
          className="tab plus" title="Open a series in a new tab" aria-label="Open a series in a new tab"
          onClick={plus}
        >
          +
        </button>
      )}
    </div>
  );
}

/** Compact series/volume/mask readout for the mobile Files panel (the full
 *  Inspector is desktop-only; this keeps the hero numbers reachable). */
function MobileInfo(): JSX.Element {
  useVersion();
  const series = useUiPick('series');
  const { editMask, img } = session;
  let vox = 0;
  if (editMask) {
    let n = 0;
    for (let i = 0; i < editMask.length; i += 7) if (editMask[i]) n++;
    vox = n * 7;
  }
  const sp = img?.spacing ?? [1, 1, 1];
  const est = img ? Math.round(vox * sp[0] * sp[1] * sp[2] / 1000) : 0;
  return (
    <dl className="minfo" id="m-info">
      <div><dt>series</dt><dd>{series || '—'}</dd></div>
      <div><dt>dims</dt><dd>{img ? fmtDims(img.dims) : '—'}</dd></div>
      <div><dt>mask</dt><dd id="m-vox">≈ {est} cm³ · {vox.toLocaleString()} vox</dd></div>
    </dl>
  );
}

/** The two viewports, shared by every breakpoint — desktop lays them side by
 *  side, mobile shows whichever one `data-mview` names. */
function ViewGrid({ sliceInit, axialCanvasRef, extractor, full, mView }: {
  sliceInit: SliceInit | null;
  axialCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  extractor: Extractor | null;
  full: string; mView: MView;
}): JSX.Element {
  return (
    <div className="viewgrid" data-full={full} data-mview={mView} id="viewgrid">
      <div className="vp vp3d" id="vp-3d">
        <SurfaceView extractor={extractor} bare />
      </div>
      <div className="vp vp2d" id="vp-2d">
        <MprPanes sliceInit={sliceInit} axialCanvasRef={axialCanvasRef} />
      </div>
    </div>
  );
}

/** Professional viewport grid: file tabs on top, 3D viewport left, the
 *  three 2D viewports stacked right — each with its own tools.
 *
 *  On mobile the same tree splits the screen instead: imaging owns the top,
 *  and a permanent control deck owns the bottom half. The deck is a surface,
 *  not an overlay, so tools never cover the image they act on. */
export function ViewerView({ sliceInit, axialCanvasRef, extractor, onOpenSeries }: {
  sliceInit: SliceInit | null;
  axialCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  extractor: Extractor | null;
  onOpenSeries: (s: string) => void;
}): JSX.Element {
  const full = useUiPick('fullVp');
  const mobile = useIsMobile();
  const mView = useUiPick('mView');
  const mSheet = useUiPick('mSheet');
  const series = useUiPick('series');
  const docksOpen = useUiPick('docksOpen');
  const insOpen = useUiPick('insOpen');

  if (!mobile) {
    return (
      <>
        <div className="ftop">
          <FileTabs onOpen={onOpenSeries} />
          <button
            className={`iconbtn docktoggle${docksOpen ? ' on' : ''}`} id="docktoggle"
            title={docksOpen ? 'Hide toolbar (more viewport)' : 'Show toolbar'}
            aria-label="Toggle toolbar" aria-pressed={docksOpen}
            onClick={() => setUi({ docksOpen: !docksOpen })}
          >
            <IconPanel />Toolbar
          </button>
          <button
            className={`iconbtn instoggle${insOpen ? ' on' : ''}`} id="instoggle"
            title={insOpen ? 'Hide details (more viewport)' : 'Show details'}
            aria-label="Toggle details panel" aria-pressed={insOpen}
            onClick={() => setUi({ insOpen: !insOpen })}
          >
            <IconPanel />Details
          </button>
        </div>
        {docksOpen && (
          <div className="dockrow" id="dockrow-2d">
            <MprTuneDock axialCanvasRef={axialCanvasRef} />
            <SegDock />
          </div>
        )}
        {/* Tools sit in a column against the viewport edge, the way a 3D tool
            shelves them — not in a toolbar wrapping across the top. */}
        <div className="workarea">
          <aside className="toolstrip" aria-label="Tools">
            <MprToolDock column />
          </aside>
          <ViewGrid
            sliceInit={sliceInit} axialCanvasRef={axialCanvasRef}
            extractor={extractor} full={full ?? ''} mView={mView}
          />
        </div>
      </>
    );
  }

  // Deck tabs behave like tabs, not toggles: picking one always shows it,
  // and re-tapping the open one collapses the deck to give the image room.
  const pick = (s: Exclude<MSheet, null>): void => setUi({ mSheet: mSheet === s ? null : s });
  const deckTab = (s: Exclude<MSheet, null>, label: string): JSX.Element => (
    <button
      className={`mbtn${mSheet === s ? ' on' : ''}`} aria-pressed={mSheet === s}
      title={`${label} panel`} onClick={() => pick(s)}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="ftop"><FileTabs onOpen={onOpenSeries} /></div>
      <ViewGrid
        sliceInit={sliceInit} axialCanvasRef={axialCanvasRef}
        extractor={extractor} full={full ?? ''} mView={mView}
      />
      <div className="deck" data-open={mSheet && mSheet !== 'nav' ? 'true' : 'false'}>
        <div className="mobilebar" id="mobilebar">
          <Seg<MView>
            id="mviewseg" dataKey="mview" ariaLabel="Viewport"
            value={mView} onChange={(v) => setUi({ mView: v })}
            options={[
              { value: 'v3d', label: '3D' }, { value: 'axial', label: 'Ax' },
              { value: 'coronal', label: 'Cor' }, { value: 'sagittal', label: 'Sag' },
            ]}
          />
          <div className="deck-tabs" role="tablist" aria-label="Controls">
            {deckTab('tools', 'Tools')}
            {deckTab('display', 'Display')}
            {deckTab('files', 'Files')}
          </div>
        </div>
        {mSheet === 'tools' && (
          <div className="deck-body" id="mpanel-tools" role="tabpanel" aria-label="Tools">
            <MprToolDock />
          </div>
        )}
        {mSheet === 'display' && (
          <div className="deck-body" id="mpanel-display" role="tabpanel" aria-label="Display">
            {/* SurfaceView portals its 3D dock here while the 3D viewport is
                the one on screen — same dock as desktop, hosted where mobile
                controls belong. */}
            <div id="deck-3d" />
            <MprTuneDock axialCanvasRef={axialCanvasRef} />
            <SegDock />
          </div>
        )}
        {mSheet === 'files' && (
          <div className="deck-body" id="mpanel-files" role="tabpanel" aria-label="Files">
            <DarkSelect value={series} onChange={onOpenSeries} title="Open series" ariaLabel="Open series">
              {Object.keys(SERIES).map((k) => <option key={k} value={k}>{k}</option>)}
            </DarkSelect>
            <FileTabs onOpen={onOpenSeries} id="filetabs-m" hidePlus />
            <label className="btn-ghost" htmlFor="upload-m" title="Open a volume, mesh, or tract file">Open file</label>
            <input
              type="file" id="upload-m" accept=".nii,.gz,.dcm,.stl,.mz3,.gii,.nrrd,.nhdr,.raw,.tif,.tiff,.tck" multiple hidden
              onChange={(e) => {
                handleOpenFiles([...((e.target as HTMLInputElement).files ?? [])]);
                (e.target as HTMLInputElement).value = '';
              }}
            />
            <MobileInfo />
          </div>
        )}
      </div>
    </>
  );
}
