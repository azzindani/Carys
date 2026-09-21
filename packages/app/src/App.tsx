import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { SERIES } from './lib/catalog';
import { createExtractor, type Extractor } from './lib/extractor';
import { paintBus } from './lib/paintBus';
import { undoBus } from './lib/undoBus';
import { resolveVolume } from './lib/pacs';
import { session } from './lib/session';
import { setStatus } from './lib/status';
import { useRoute } from './lib/router';
import { loadSeries, saveMaskNii, setExtractor, type SliceInit } from './lib/sessionOps';
import { getUi, saveAppearance, setUi, useUiPick } from './lib/store';
import { useIsMobile } from './lib/isMobile';
import { bump } from './lib/version';
import type { View } from './lib/types';
import { AtlasView } from './views/AtlasView';
import { CellsView } from './views/CellsView';
import { Inspector } from './views/Inspector';
import { ProteinView } from './views/ProteinView';
import { LearnView } from './views/LearnView';
import { ReportView } from './views/ReportView';
import { TracksView } from './views/TracksView';
import { ViewerView } from './views/ViewerView';
import { WorklistView } from './views/WorklistView';
import { Palette, buildCommands } from './ui/Palette';
import { Rail } from './ui/Rail';
import { StatusBar } from './ui/StatusBar';
import { TipProvider } from './ui/primitives';
import { Toasts } from './ui/Toasts';
import { TopBar } from './ui/TopBar';

export function App(): JSX.Element {
  const [route, go] = useRoute();
  const [palOpen, setPalOpen] = useState(false);
  const [sliceInit, setSliceInit] = useState<SliceInit | null>(null);
  const [learnPathogen, setLearnPathogen] = useState('');
  const [extractor, setExtractorState] = useState<Extractor | null>(null);
  const axialCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const booted = useRef(false);
  // Mobile moves status inline into the slim topbar (the control deck owns
  // the bottom edge), so the footer renders on desktop only.
  const isMobile = useIsMobile();

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const ex = createExtractor();
    setExtractor(ex);
    setExtractorState(ex);
    setUi({ tool: 'view' });
    const first = Object.keys(SERIES)[0];
    void loadSeries(first).then((init) => { if (init) setSliceInit(init); });
  }, []);

  const openSeries = (s: string): void => {
    // File tabs: opening a series pins it as a tab (dedupe, skip empties).
    const t = getUi().tabs;
    const base = t.length > 0 ? t : (getUi().series ? [getUi().series] : []);
    if (!base.includes(s)) setUi({ tabs: [...base, s] });
    const spec = SERIES[s];
    if (spec?.remote && !session.getVol(s)) {
      // PACS pull: resolve first (status visible), then load as uploaded vol.
      go('viewer');
      setStatus(`pulling ${s}…`);
      void resolveVolume(s)
        .then((vol) => loadSeries(s, vol))
        .then((init) => { if (init) setSliceInit(init); })
        .catch((e) => setStatus(`pull failed: ${(e as Error).message}`));
      return;
    }
    void loadSeries(s).then((init) => { if (init) setSliceInit(init); });
  };

  const setView = (v: View): void => {
    setUi({ view: v });
    bump();
    // Views repaint in their ver effect; nudge synchronously for snap.
    requestAnimationFrame(() => {
      paintBus.mpr();
      paintBus.surface();
    });
  };

  const toggleFull3d = (): void => {
    setUi({ fullVp: getUi().fullVp === 'v3d' ? null : 'v3d' });
  };

  const commands = useMemo(() => buildCommands({
    openSeries,
    setView,
    toggleFull3d,
    setTool: (t) => setUi({ tool: t }),
    setMeasureKind: (k) => setUi({ measureKind: k }),
    toggleOverlay: () => { setUi({ overlay: !getUi().overlay }); paintBus.mpr(); },
    undo: () => undoBus.current(),
    exportNii: saveMaskNii,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
      if (tag === 'SELECT' || tag === 'TEXTAREA') return;
      // View-aware undo (mask on MPR, selection on protein, view on cells).
      // Text inputs keep native undo via the guards above.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoBus.current();
        return;
      }
      if (e.key === '2' && route === 'viewer') setUi({ fullVp: getUi().fullVp === 'v3d' ? null : 'v3d' });
      else if (e.key === '[') setUi({ brush: Math.max(1, getUi().brush - 1) });
      else if (e.key === ']') setUi({ brush: Math.min(12, getUi().brush + 1) });
      else if (e.key === 'ArrowUp') { e.preventDefault(); stepAxial(1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); stepAxial(-1); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalOpen(true); }
      else if (e.key === 'Escape') {
        setPalOpen(false);
        if (getUi().fullVp) setUi({ fullVp: null });
        if (session.pendingMeasure.length > 0 || session.pendingPlane !== null) {
          session.pendingMeasure = [];
          session.pendingVoxel = [];
          session.pendingPlane = null;
          session.pendingFrame = null;
          bump();
          paintBus.mpr();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stepAxial = (d: number): void => {
    const s = document.getElementById('s-axial') as HTMLInputElement | null;
    if (!s) return;
    s.value = String(Math.min(Number(s.max), Math.max(Number(s.min), Number(s.value) + d)));
    paintBus.mprPlane('axial');
  };

  const openFromWorklist = (s: string): void => {
    go('viewer');
    openSeries(s);
  };

  const textSize = useUiPick('textSize');
  const density = useUiPick('density');
  // The details panel is a panel, not furniture: collapsing it hands its
  // column back to the image. Open by default — the wire suite reads the
  // readouts inside it without opening anything first.
  const insOpen = useUiPick('insOpen');
  // Appearance owns <html>: text scale + density datasets drive the CSS,
  // and every change persists the chrome pref.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.text = textSize;
    root.dataset.density = density;
    saveAppearance(textSize, density);
  }, [textSize, density]);

  // One shell, one content switch. The viewer is the only route that pairs
  // with the inspector column; everything else runs full-bleed.
  const isViewer = route === 'viewer';
  let content: JSX.Element;
  if (route === 'worklist') content = <WorklistView onOpen={openFromWorklist} />;
  else if (route === 'report') content = <ReportView />;
  else if (route === 'protein') content = <ProteinView initialPathogen={learnPathogen} />;
  else if (route === 'cells') content = <CellsView />;
  else if (route === 'tracks') content = <TracksView />;
  else if (route === 'atlas') content = <AtlasView />;
  else if (route === 'learn') content = <LearnView onOpenPathogen={(id) => { setLearnPathogen(id); go('protein'); }} />;
  else {
    content = (
      <ViewerView
        sliceInit={sliceInit} axialCanvasRef={axialCanvasRef}
        extractor={extractor} onOpenSeries={openSeries}
      />
    );
  }

  return (
    <TipProvider>
      <div className="shell">
        {!isMobile && <Rail route={route} go={go} />}
        <div className="frame">
          <TopBar route={route} go={go} onOpenPalette={() => setPalOpen(true)} onSelectSeries={(s) => { go('viewer'); openSeries(s); }} />
          <div className={isViewer && insOpen ? 'main' : 'main main-full'}>
            <section className="viewport">{content}</section>
            {isViewer && insOpen && <Inspector />}
          </div>
          {!isMobile && <StatusBar />}
        </div>
      </div>
      <Toasts />
      <Palette open={palOpen} onClose={() => setPalOpen(false)} commands={commands} />
    </TipProvider>
  );
}
