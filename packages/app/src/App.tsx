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
import { StatusBar } from './ui/StatusBar';
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
  // Mobile moves status inline into the slim topbar (the fixed footer would
  // cover the bottom action bar), so the footer renders on desktop only.
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
  // Appearance owns <html>: text scale + density datasets drive the CSS,
  // and every change persists the chrome pref.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.text = textSize;
    root.dataset.density = density;
    saveAppearance(textSize, density);
  }, [textSize, density]);
  const top = (
    <TopBar
      onOpenPalette={() => setPalOpen(true)} onSelectSeries={(s) => { go('viewer'); openSeries(s); }}
      onGoWorklist={() => go('worklist')} onGoViewer={() => go('viewer')} onGoReport={() => go('report')} onGoProtein={() => go('protein')} onGoCells={() => go('cells')} onGoTracks={() => go('tracks')} onGoAtlas={() => go('atlas')} onGoLearn={() => go('learn')}
    />
  );
  if (route === 'worklist') {
    return (
      <>
        {top}
        <div className="main main-full">
          <section className="viewport">
            <WorklistView onOpen={openFromWorklist} />
          </section>
        </div>
        {!isMobile && <StatusBar />}
        <Toasts />
        <Palette open={palOpen} onClose={() => setPalOpen(false)} commands={commands} />
      </>
    );
  }
  if (route === 'report' || route === 'protein' || route === 'cells' || route === 'tracks' || route === 'atlas' || route === 'learn') {
    return (
      <>
        {top}
        <div className="main main-full">
          <section className="viewport">
            {route === 'report' ? <ReportView /> : route === 'protein' ? <ProteinView initialPathogen={learnPathogen} /> : route === 'cells' ? <CellsView /> : route === 'atlas' ? <AtlasView /> : route === 'learn' ? <LearnView onOpenPathogen={(id) => { setLearnPathogen(id); go('protein'); }} /> : <TracksView />}
          </section>
        </div>
        {!isMobile && <StatusBar />}
        <Toasts />
        <Palette open={palOpen} onClose={() => setPalOpen(false)} commands={commands} />
      </>
    );
  }

  return (
    <>
      {top}
      <div className="main">
        <section className="viewport">
          <ViewerView sliceInit={sliceInit} axialCanvasRef={axialCanvasRef} extractor={extractor} onOpenSeries={openSeries} />
        </section>
        <Inspector />
      </div>
      {!isMobile && <StatusBar />}
      <Toasts />
      <Palette open={palOpen} onClose={() => setPalOpen(false)} commands={commands} />
    </>
  );
}
