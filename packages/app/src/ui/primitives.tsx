import type { ReactNode } from 'react';
import type { JSX } from 'react';

// Headless-styled primitives. Unstyled behavior + token styling; composition
// over configuration. This file is the entire design system.

export function Chip({ children, className = '', title, onClick }: {
  children: ReactNode; className?: string; title?: string; onClick?: () => void;
}): JSX.Element {
  return (
    <span className={`chip ${className}`} title={title} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      {children}
    </span>
  );
}

export function Seg<T extends string>({ id, dataKey, options, value, onChange, ariaLabel }: {
  id?: string;
  /** semantic per-option attribute, e.g. dataKey="mode" renders data-mode="…" */
  dataKey?: string;
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}): JSX.Element {
  return (
    <div className="seg" id={id} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          {...(dataKey ? { [`data-${dataKey}`]: o.value } : {})}
          className={o.value === value ? 'on' : ''}
          aria-pressed={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SliderRow({ id, label, min, max, step, value, onInput, onCommit, width, vertical }: {
  id?: string; label: string; min: number; max: number; step: number; value: number;
  onInput: (v: number) => void; onCommit?: () => void; width?: number; vertical?: boolean;
}): JSX.Element {
  return (
    <div className="grp">
      <span className="lbl">{label}</span>
      <input
        id={id} type="range" className={vertical ? 'styled vert' : 'styled'} aria-label={label}
        min={min} max={max} step={step} value={value}
        style={width ? { width } : undefined}
        onInput={(e) => onInput(Number((e.target as HTMLInputElement).value))}
        onChange={onCommit ? () => onCommit() : undefined}
      />
    </div>
  );
}

export function Switch({ checked, onChange, label }: {
  checked: boolean; onChange: (v: boolean) => void; label: string;
}): JSX.Element {
  return (
    <div className="grp">
      <label className="switch" title={label}>
        <input
          type="checkbox" aria-label={label} checked={checked}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        />
        <span className="tr" />
      </label>
      <span className="lbl">{label}</span>
    </div>
  );
}

export function DarkSelect({ value, onChange, title, children, ariaLabel }: {
  value: string; onChange: (v: string) => void; title?: string;
  children: ReactNode; ariaLabel?: string;
}): JSX.Element {
  return (
    <select
      className="dark" value={value} title={title} aria-label={ariaLabel ?? title}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
    >
      {children}
    </select>
  );
}

export function IconBtn({ id, onClick, title, accent, children }: {
  id?: string; onClick: () => void; title?: string; accent?: boolean; children: ReactNode;
}): JSX.Element {
  return (
    <button id={id} className={`iconbtn${accent ? ' accent' : ''}`} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return <kbd>{children}</kbd>;
}

/**
 * The shared undo row: identical chrome on every dock (MPR, protein,
 * cells). Same look, same contract — onUndo restores, onClear resets.
 */
export function UndoGroup({ onUndo, onClear, undoTitle = 'Undo', clearTitle = 'Clear' }: {
  onUndo: () => void; onClear: () => void; undoTitle?: string; clearTitle?: string;
}): JSX.Element {
  return (
    <div className="grp" id="undogrp">
      <IconBtn onClick={onUndo} title={undoTitle}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M6 3L3 6l3 3M3 6h6a4 4 0 010 8h-2" /></svg>Undo
      </IconBtn>
      <IconBtn onClick={onClear} title={clearTitle}>Clear</IconBtn>
    </div>
  );
}
