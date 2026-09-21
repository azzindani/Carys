import { SERIES } from '../lib/catalog';
import type { JSX } from 'react';
import { useState } from 'react';
import type { Route } from '../lib/router';
import { setUi, useUi, useUiPick } from '../lib/store';
import { useIsMobile } from '../lib/isMobile';
import type { Density, TextSize } from '../lib/types';
import { DarkSelect, Popover, Seg } from './primitives';
import { IconGear, IconMenu, IconSearch } from './Icons';
import { ROUTES } from './Rail';
import { StatusBar } from './StatusBar';

export function Logo(): JSX.Element {
  return (
    <div className="logo">
      <span className="mark">
        <svg width="15" height="15" viewBox="0 0 14 14" fill="none" style={{ stroke: 'var(--color-on-accent)' }}>
          <rect x="1" y="1" width="5" height="5" rx="1.2" strokeWidth="1.5" />
          <rect x="8" y="1" width="5" height="5" rx="1.2" strokeWidth="1.5" />
          <rect x="1" y="8" width="5" height="5" rx="1.2" strokeWidth="1.5" />
          <rect x="8" y="8" width="5" height="5" rx="2.5" style={{ fill: 'var(--color-on-accent)' }} stroke="none" />
        </svg>
      </span>
      <span className="word">Carys</span>
      <span className="tag">cpu</span>
    </div>
  );
}

/** Appearance popover: UI text size + layout density (chrome prefs). */
export function AppearancePanel(): JSX.Element {
  const textSize = useUiPick('textSize');
  const density = useUiPick('density');
  return (
    <div className="appear" role="group" aria-label="Appearance settings">
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

/**
 * Context bar. Navigation lives in the rail on desktop, so this row carries
 * what the current study needs: identity, series, search, appearance — and
 * on mobile, the nav sheet and inline status the slim layout depends on.
 */
export function TopBar({ route, go, onOpenPalette, onSelectSeries }: {
  route: Route; go: (r: Route) => void;
  onOpenPalette: () => void; onSelectSeries: (s: string) => void;
}): JSX.Element {
  const ui = useUi();
  const [appearOpen, setAppearOpen] = useState(false);
  const isMobile = useIsMobile();
  const mSheet = useUiPick('mSheet');
  const navOpen = mSheet === 'nav';
  const goNav = (r: Route): void => { setUi({ mSheet: null }); go(r); };

  return (
    <header className="top">
      <Popover
        open={navOpen} onOpenChange={(v) => setUi({ mSheet: v ? 'nav' : null })} align="start"
        trigger={(
          <button className="iconbtn burger" id="navtoggle" title="Views" aria-label="Views">
            <IconMenu />
          </button>
        )}
      >
        <div className="navdrop" id="navdrop" role="menu" aria-label="Views">
          {ROUTES.map(({ id, label, icon: Icon }) => (
            <button
              key={id} role="menuitem" data-on={route === id} onClick={() => goNav(id)}
            >
              <Icon />{label}
            </button>
          ))}
          <button role="menuitem" onClick={() => { setUi({ mSheet: null }); onOpenPalette(); }}>
            <IconSearch />Search ⌘K
          </button>
        </div>
      </Popover>

      <button className="logo-btn" onClick={() => go('viewer')} title="Viewer" aria-label="Go to viewer">
        <Logo />
      </button>

      <span className="top-spacer" />

      <DarkSelect value={ui.series} onChange={onSelectSeries} title="Series" ariaLabel="Series">
        {Object.keys(SERIES).map((k) => <option key={k} value={k}>{k}</option>)}
      </DarkSelect>

      <button className="kbd-btn" id="openpal" title="Command palette" onClick={onOpenPalette}>
        <IconSearch />Search <kbd>⌘K</kbd>
      </button>

      {isMobile && <StatusBar inline />}

      <Popover
        open={appearOpen} onOpenChange={setAppearOpen}
        trigger={(
          <button className="iconbtn gear" id="appearance" title="Appearance: text + layout size" aria-label="Appearance settings">
            <IconGear />
          </button>
        )}
      >
        <AppearancePanel />
      </Popover>
    </header>
  );
}
