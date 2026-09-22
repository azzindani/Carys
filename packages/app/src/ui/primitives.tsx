import type { ReactNode, RefObject } from 'react';
import type { JSX } from 'react';
import { Popover as RxPopover, Tooltip as RxTooltip } from 'radix-ui';

/**
 * The design system's component layer.
 *
 * Radix backs the pieces where hand-rolled behaviour was actually broken —
 * popovers (no outside-click, no Escape, no focus restore) and tooltips.
 * Sliders deliberately stay native `<input type="range">`: the wire suite
 * drives them with real key events and reads `.inputValue()`, and a
 * div-based slider would silently break every one of those legs.
 */

export function Chip({ children, className = '', title, onClick }: {
  children: ReactNode; className?: string; title?: string; onClick?: () => void;
}): JSX.Element {
  return (
    <span
      className={`chip ${className}`} title={title} onClick={onClick}
      role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      {children}
    </span>
  );
}

/**
 * Segmented control. Plain buttons on purpose: `data-<key>`, `.on` and
 * `aria-pressed` are the selectors the e2e suite addresses, and a Radix
 * ToggleGroup would swap them for radio roles.
 */
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

/** Round for display without pretending to more precision than the step. */
function fmtVal(v: number, step: number): string {
  if (step >= 1) return String(Math.round(v));
  const dp = Math.min(3, Math.max(0, -Math.floor(Math.log10(step))));
  return v.toFixed(dp);
}

/**
 * Scrub field — the control 3D tools actually use: a compact rectangle with
 * the label inside it, a fill bar for the value and the number right-aligned,
 * dragged horizontally to scrub.
 *
 * It is still a native `<input type="range">`, full-size and visible, layered
 * over the painted fill. That matters: the wire suite focuses these and sends
 * real arrow keys, and reads `.inputValue()`. A div-based slider would break
 * every one of those legs.
 *
 * `vertical` keeps the plain slider used by the viewport side rails.
 */
export function SliderRow({ id, label, min, max, step, value, onInput, onCommit, width, vertical }: {
  id?: string; label: string; min: number; max: number; step: number; value: number;
  onInput: (v: number) => void; onCommit?: () => void; width?: number; vertical?: boolean;
}): JSX.Element {
  const input = (
    <input
      id={id} type="range" className={vertical ? 'styled vert' : 'styled'} aria-label={label}
      min={min} max={max} step={step} value={value}
      style={!vertical || !width ? undefined : { width }}
      onInput={(e) => onInput(Number((e.target as HTMLInputElement).value))}
      onChange={onCommit ? () => onCommit() : undefined}
    />
  );
  if (vertical) {
    return (
      <div className="grp">
        <span className="lbl">{label}</span>
        {input}
      </div>
    );
  }
  const span = max - min;
  const pct = span > 0 ? ((value - min) / span) * 100 : 0;
  return (
    <div
      className="field" title={`${label}: ${fmtVal(value, step)}`}
      style={{ ...(width ? { width } : undefined), ['--pct' as string]: `${pct}%` }}
    >
      <span className="field-fill" aria-hidden="true" />
      <span className="field-lbl">{label}</span>
      <span className="field-val">{fmtVal(value, step)}</span>
      {input}
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

export function DarkSelect({ value, onChange, title, children, ariaLabel, id }: {
  value: string; onChange: (v: string) => void; title?: string;
  children: ReactNode; ariaLabel?: string; id?: string;
}): JSX.Element {
  return (
    <select
      id={id} className="dark" value={value} title={title} aria-label={ariaLabel ?? title}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
    >
      {children}
    </select>
  );
}

export function IconBtn({ id, onClick, title, accent, active, className = '', children }: {
  id?: string; onClick: () => void; title?: string; accent?: boolean;
  active?: boolean; className?: string; children: ReactNode;
}): JSX.Element {
  return (
    <button
      id={id}
      className={`iconbtn${accent ? ' accent' : ''}${active ? ' on' : ''}${className ? ` ${className}` : ''}`}
      title={title} aria-label={title} aria-pressed={active} onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return <kbd>{children}</kbd>;
}

/** Hover/focus label. Used by icon-only chrome, where `title` alone is slow
 *  and invisible to keyboard users. */
export function Tip({ label, side = 'right', children }: {
  label: string; side?: 'top' | 'right' | 'bottom' | 'left'; children: ReactNode;
}): JSX.Element {
  return (
    <RxTooltip.Root>
      <RxTooltip.Trigger asChild>{children}</RxTooltip.Trigger>
      <RxTooltip.Portal>
        <RxTooltip.Content className="tip" side={side} sideOffset={8} collisionPadding={8}>
          {label}
          <RxTooltip.Arrow className="tip-arrow" width={10} height={5} />
        </RxTooltip.Content>
      </RxTooltip.Portal>
    </RxTooltip.Root>
  );
}

export function TipProvider({ children }: { children: ReactNode }): JSX.Element {
  return <RxTooltip.Provider delayDuration={420} skipDelayDuration={300}>{children}</RxTooltip.Provider>;
}

/**
 * Popover with the behaviour the hand-rolled version never had: dismiss on
 * outside click and Escape, focus returned to the trigger, collision-aware
 * placement.
 */
export function Popover({ open, onOpenChange, trigger, children, align = 'end', className = '', anchorRef }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  trigger: ReactNode; children: ReactNode;
  align?: 'start' | 'center' | 'end'; className?: string;
  anchorRef?: RefObject<HTMLElement | null>;
}): JSX.Element {
  return (
    <RxPopover.Root open={open} onOpenChange={onOpenChange}>
      <RxPopover.Trigger asChild>{trigger}</RxPopover.Trigger>
      {anchorRef ? <RxPopover.Anchor virtualRef={anchorRef as RefObject<HTMLElement>} /> : null}
      <RxPopover.Portal>
        <RxPopover.Content className={className} align={align} sideOffset={8} collisionPadding={10}>
          {children}
        </RxPopover.Content>
      </RxPopover.Portal>
    </RxPopover.Root>
  );
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
