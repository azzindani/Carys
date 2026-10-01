import { SERIES } from '../lib/catalog';
import type { JSX } from 'react';
import { useState } from 'react';
import type { Route } from '../lib/router';
import { setUi, useUi, useUiPick } from '../lib/store';
import { useIsMobile } from '../lib/isMobile';
import { APPEARANCE, DEFAULT_APPEARANCE, LEVELS, type Level } from '../lib/appearance';
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

/** The palette shortcut as this keyboard spells it: ⌘K on Apple, Ctrl K
 *  everywhere else (the handler accepts either). */
export const PAL_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

/** Appearance popover: five settings, five levels each (lib/appearance.ts).
 *  The rows come from that list, so a new setting is one entry there. */
export function AppearancePanel(): JSX.Element {
  const ui = useUi();
  const changed = APPEARANCE.some((a) => ui[a.key] !== DEFAULT_APPEARANCE[a.key]);
  return (
    <div className="appear" role="group" aria-label="Appearance settings">
      {APPEARANCE.map((a) => (
        <div className="grp" key={a.key} title={a.title}>
          <span className="lbl">{a.label}</span>
          <Seg<Level>
            id={a.id} dataKey={a.dataKey} ariaLabel={a.title}
            value={ui[a.key]} onChange={(v) => setUi({ [a.key]: v })}
            options={LEVELS.map((l, n) => ({ value: l, label: l.toUpperCase(), title: a.names[n] }))}
          />
        </div>
      ))}
      <div className="appear-foot">
        <span className="hint">Saved on this device</span>
        <button className="iconbtn" id="appear-reset" disabled={!changed} onClick={() => setUi({ ...DEFAULT_APPEARANCE })}>
          Reset
        </button>
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
            <IconSearch />Search
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

      <button className="kbd-btn" id="openpal" title={`Command palette (${PAL_KEY})`} onClick={onOpenPalette}>
        <IconSearch />Search <kbd>{PAL_KEY}</kbd>
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
