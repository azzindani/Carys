import { SERIES } from '../lib/catalog';
import type { JSX } from 'react';
import { useState } from 'react';
import { setUi, useUi, useUiPick } from '../lib/store';
import { useIsMobile } from '../lib/isMobile';
import type { Density, TextSize } from '../lib/types';
import { DarkSelect, Seg } from './primitives';
import { StatusBar } from './StatusBar';

export function Logo(): JSX.Element {
  return (
    <div className="logo">
      <span className="mark">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ stroke: 'var(--on-accent)' }}>
          <rect x="1" y="1" width="5" height="5" rx="1.2" strokeWidth="1.5" />
          <rect x="8" y="1" width="5" height="5" rx="1.2" strokeWidth="1.5" />
          <rect x="1" y="8" width="5" height="5" rx="1.2" strokeWidth="1.5" />
          <rect x="8" y="8" width="5" height="5" rx="2.5" style={{ fill: 'var(--on-accent)' }} stroke="none" />
        </svg>
      </span>
      <span className="word">Carys</span>
      <span className="tag">cpu</span>
    </div>
  );
}

const GEAR_ICON = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="10" cy="10" r="2.6" />
    <path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M15.8 4.2l-1.7 1.7M5.9 14.1l-1.7 1.7" />
  </svg>
);

/** Appearance popover: UI text size + layout density (chrome prefs). */
export function AppearancePanel(): JSX.Element | null {
  const textSize = useUiPick('textSize');
  const density = useUiPick('density');
  return (
    <div className="appear" role="dialog" aria-label="Appearance settings">
      <div className="grp">
        <span className="lbl">Text</span>
        <Seg<TextSize>
          id="appear-text" dataKey="tsize" ariaLabel="Text size"
          value={textSize} onChange={(v) => setUi({ textSize: v })}
          options={[
            { value: 'xs', label: 'XS', title: 'Extra-small text' },
            { value: 's', label: 'S', title: 'Small text' },
            { value: 'm', label: 'M', title: 'Medium text' },
            { value: 'l', label: 'L', title: 'Large text' },
            { value: 'xl', label: 'XL', title: 'Extra-large text' },
          ]}
        />
      </div>
      <div className="grp">
        <span className="lbl">Layout</span>
        <Seg<Density>
          id="appear-density" dataKey="density" ariaLabel="Layout density"
          value={density} onChange={(v) => setUi({ density: v })}
          options={[
            { value: 'xs', label: 'XS', title: 'Extra-tight spacing' },
            { value: 's', label: 'S', title: 'Tight spacing' },
            { value: 'm', label: 'M', title: 'Balanced spacing' },
            { value: 'l', label: 'L', title: 'Roomy spacing' },
            { value: 'xl', label: 'XL', title: 'Extra-roomy spacing' },
          ]}
        />
      </div>
    </div>
  );
}

export function TopBar({ onOpenPalette, onSelectSeries, onGoWorklist, onGoViewer, onGoReport, onGoProtein, onGoCells, onGoTracks, onGoAtlas, onGoLearn }: {
  onOpenPalette: () => void; onSelectSeries: (s: string) => void;
  onGoWorklist: () => void; onGoViewer: () => void; onGoReport: () => void; onGoProtein: () => void; onGoCells: () => void; onGoTracks: () => void; onGoAtlas: () => void; onGoLearn: () => void;
}): JSX.Element {
  const ui = useUi();
  const [appearOpen, setAppearOpen] = useState(false);
  const isMobile = useIsMobile();
  const mSheet = useUiPick('mSheet');
  const goNav = (fn: () => void): void => { setUi({ mSheet: null }); fn(); };
  return (
    <header className="top">
      <button
        className="iconbtn burger" id="navtoggle" title="Views" aria-label="Views"
        aria-expanded={mSheet === 'nav'} onClick={() => setUi({ mSheet: mSheet === 'nav' ? null : 'nav' })}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 5.5h14M3 10h14M3 14.5h14" />
        </svg>
      </button>
      <button className="logo-btn" onClick={onGoViewer} title="Viewer" aria-label="Go to viewer">
        <Logo />
      </button>
      <button className="navlink" onClick={onGoWorklist} title="Study worklist">Studies</button>
      <button className="navlink" onClick={onGoReport} title="Validation + report for the open series">Report</button>
      <button className="navlink" onClick={onGoProtein} title="Protein structure + sequence view">Protein</button>
      <button className="navlink" onClick={onGoCells} title="OME-Zarr channels + stats">Cells</button>
      <button className="navlink" onClick={onGoTracks} title="Genome tracks + locus filter">Tracks</button>
      <button className="navlink" onClick={onGoAtlas} title="Anatomy atlas (BodyParts3D long bones, education overlay)">Atlas</button>
      <button className="navlink" onClick={onGoLearn} title="Mechanism-of-disease bundles (teaching)">Learn</button>
      <DarkSelect value={ui.series} onChange={onSelectSeries} title="Series" ariaLabel="Series">
        {Object.keys(SERIES).map((k) => <option key={k} value={k}>{k}</option>)}
      </DarkSelect>
      <button className="kbd-btn" id="openpal" title="Command palette" onClick={onOpenPalette}>
        Search <kbd>⌘K</kbd>
      </button>
      {isMobile && <StatusBar inline />}
      <button
        className="iconbtn gear" id="appearance" title="Appearance: text + layout size"
        aria-label="Appearance settings" aria-expanded={appearOpen}
        onClick={() => setAppearOpen((o) => !o)}
      >
        {GEAR_ICON}
      </button>
      {appearOpen && <AppearancePanel />}
      {mSheet === 'nav' && (
        <div className="navdrop" id="navdrop" role="menu" aria-label="Views">
          <button role="menuitem" onClick={() => goNav(onGoWorklist)}>Studies</button>
          <button role="menuitem" onClick={() => goNav(onGoViewer)}>Viewer</button>
          <button role="menuitem" onClick={() => goNav(onGoReport)}>Report</button>
          <button role="menuitem" onClick={() => goNav(onGoProtein)}>Protein</button>
          <button role="menuitem" onClick={() => goNav(onGoCells)}>Cells</button>
          <button role="menuitem" onClick={() => goNav(onGoTracks)}>Tracks</button>
          <button role="menuitem" onClick={() => goNav(onGoAtlas)}>Atlas</button>
          <button role="menuitem" onClick={() => goNav(onGoLearn)}>Learn</button>
          <button role="menuitem" onClick={() => goNav(onOpenPalette)}>Search ⌘K</button>
        </div>
      )}
    </header>
  );
}
