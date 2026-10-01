import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { SERIES } from '../lib/catalog';
import type { Route } from '../lib/router';
import type { MeasureKind, View } from '../lib/types';
import { ROUTES } from './Rail';

export interface PaletteCommand {
  label: string;
  hint: string;
  run: () => void;
}

export function buildCommands(api: {
  openSeries: (s: string) => void;
  setView: (v: View) => void;
  toggleFull3d: () => void;
  setTool: (t: 'view' | 'paint' | 'erase' | 'grow' | 'measure' | 'curve') => void;
  go: (r: Route) => void;
  setMeasureKind: (k: MeasureKind) => void;
  toggleOverlay: () => void;
  undo: () => void;
  exportNii: () => void;
}): PaletteCommand[] {
  return [
    // every route, so the palette is a way to get around, not only a
    // command line for the viewer (the phone's menu opens it as "Search")
    ...ROUTES.map((r) => ({ label: `Go to ${r.label}`, hint: 'route', run: () => api.go(r.id) })),
    ...Object.keys(SERIES).map((s) => ({ label: `Open ${s}`, hint: 'series', run: () => api.openSeries(s) })),
    { label: 'Refresh viewports', hint: 'mpr', run: () => api.setView('mpr') },
    { label: 'Viewport: fullscreen 3D', hint: '2', run: api.toggleFull3d },
    { label: 'Toggle mask overlay', hint: 'mpr', run: api.toggleOverlay },
    { label: 'Tool: select', hint: 'mpr', run: () => api.setTool('view') },
    { label: 'Tool: paint', hint: 'mpr', run: () => api.setTool('paint') },
    { label: 'Tool: erase', hint: 'mpr', run: () => api.setTool('erase') },
    { label: 'Tool: grow', hint: 'mpr', run: () => api.setTool('grow') },
    { label: 'Tool: measure', hint: 'mpr', run: () => api.setTool('measure') },
    { label: 'Tool: curve', hint: 'mpr', run: () => api.setTool('curve') },
    { label: 'Measure: length', hint: 'mpr', run: () => { api.setTool('measure'); api.setMeasureKind('length'); } },
    { label: 'Measure: angle', hint: 'mpr', run: () => { api.setTool('measure'); api.setMeasureKind('angle'); } },
    { label: 'Measure: probe', hint: 'mpr', run: () => { api.setTool('measure'); api.setMeasureKind('probe'); } },
    { label: 'Measure: ellipse', hint: 'mpr', run: () => { api.setTool('measure'); api.setMeasureKind('ellipse'); } },
    { label: 'Measure: rect', hint: 'mpr', run: () => { api.setTool('measure'); api.setMeasureKind('roi'); } },
    { label: 'Measure: cobb', hint: 'mpr', run: () => { api.setTool('measure'); api.setMeasureKind('cobb'); } },
    { label: 'Undo stroke', hint: 'mpr', run: api.undo },
    { label: 'Export mask .nii', hint: 'mpr', run: api.exportNii },
  ];
}

export function Palette({ open, onClose, commands }: {
  open: boolean; onClose: () => void; commands: PaletteCommand[];
}): JSX.Element | null {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const items = useMemo(
    () => commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())),
    [commands, q],
  );

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open ]);

  if (!open) return null;
  const run = (i: number): void => {
    const c = items[i];
    if (!c) return;
    onClose();
    c.run();
  };
  return (
    <div className="pal-wrap open" id="palwrap" onClick={(e) => { if ((e.target as HTMLElement).id === 'palwrap') onClose(); }}>
      <div className="pal" role="dialog" aria-label="Command palette">
        <input
          id="palinput" ref={inputRef} placeholder="Type a command or series…" autoComplete="off"
          role="combobox" aria-label="Command or series" aria-expanded="true" aria-controls="pallist"
          aria-activedescendant={items[sel] ? `palopt-${sel}` : undefined}
          value={q} onChange={(e) => { setQ((e.target as HTMLInputElement).value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === 'Enter') run(sel);
            // The app's own Escape handler ignores keys typed into inputs,
            // and focus lives in this one, so the "esc close" promised in
            // the footer never happened.
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
        />
        <ul id="pallist" role="listbox" aria-label="Commands and series" tabIndex={-1}>
          {items.map((c, i) => (
            <li
              key={c.label} id={`palopt-${i}`} role="option" aria-selected={i === sel}
              className={i === sel ? 'sel' : ''} onClick={() => run(i)}
              ref={i === sel ? (li) => li?.scrollIntoView({ block: 'nearest' }) : undefined}
            >
              {c.label}<span>{c.hint}</span>
            </li>
          ))}
        </ul>
        <div className="pal-foot">
          <span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> run</span><span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
