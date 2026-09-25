import { useState } from 'react';
import type { JSX } from 'react';
import { bump, useVersion } from '../lib/version';
import { PLANE_CARDS, PRESETS, planeCardByPlane, planeCardLine } from '@carys/volume-core';
import { EDUCATION_BADGE } from '@carys/study';
import { paintBus } from '../lib/paintBus';
import { loadPresentStateFile, savePresentState } from '../lib/present';
import { session } from '../lib/session';
import { applyHanging, applySegOp, doClear, doUndo, hangingOptions, saveAxialPng, saveMaskNii, SEG_OPS } from '../lib/sessionOps';
import { setCompare } from '../lib/compare';
import { CINE_MAX_FPS, isCinePlaying, retimeCine, setTimeFrame, toggleCine } from '../lib/cine';
import { SERIES } from '../lib/catalog';
import { setUi, useUi } from '../lib/store';
import { setStatus } from '../lib/status';
import { Chip, DarkSelect, IconBtn, Seg, SliderRow, Switch, UndoGroup } from '../ui/primitives';
import { IconCurve, IconErase, IconGrow, IconMeasure, IconPaint, IconSelect } from '../ui/Icons';
import type { CompareMode, MeasureKind, MprLayout, Plane, ProjMode, Tool, UiState } from '../lib/types';

/** Core 2D tools: tool switch, brush, undo, mask.
 *
 *  `column` renders it as the left tool strip a 3D tool puts against the
 *  viewport edge; flat mode is the Tools-panel section on mobile. It stays
 *  one dock either way — `#undogrp` has to live inside `#dock-mpr`, and
 *  `#modeseg` inside `#mpanel-tools` on mobile, which the e2e legs address. */
export function MprToolDock({ column = false }: { column?: boolean } = {}): JSX.Element {
  const ui = useUi();
  const toolIcon = (Icon: (p: { className?: string }) => JSX.Element, text: string): JSX.Element =>
    (column ? <><Icon /><span className="tl">{text}</span></> : <>{text}</>);

  return (
    <>
      <div className={column ? 'dock column' : 'dock'} id="dock-mpr">
        <div className="grp">
          <Seg<Tool>
            id="modeseg"
            dataKey="mode"
            ariaLabel="Tool"
            value={ui.tool}
            onChange={(m) => setUi({ tool: m })}
            options={[
              { value: 'view', label: toolIcon(IconSelect, 'Select'), title: 'Select / navigate' },
              { value: 'paint', label: toolIcon(IconPaint, 'Paint'), title: 'Paint mask' },
              { value: 'erase', label: toolIcon(IconErase, 'Erase'), title: 'Erase mask' },
              { value: 'grow', label: toolIcon(IconGrow, 'Grow'), title: 'Region grow' },
              { value: 'measure', label: toolIcon(IconMeasure, 'Measure'), title: 'Measure' },
              { value: 'curve', label: toolIcon(IconCurve, 'Curve'), title: 'Click points along a vessel or spine: the straightened view follows them' },
            ]}
          />
        </div>
        <SliderRow label="Brush" min={1} max={12} step={1} value={ui.brush} onInput={(v) => setUi({ brush: v })} />
        {ui.tool === 'grow' && (
          <>
            <SliderRow label="Lo" min={-1000} max={3000} step={10} value={ui.growLo} width={72}
              onInput={(v) => setUi({ growLo: v })} />
            <SliderRow label="Hi" min={-1000} max={5000} step={10} value={ui.growHi} width={72}
              onInput={(v) => setUi({ growHi: v })} />
          </>
        )}
        {ui.tool === 'measure' && (
          <div className="grp">
            <Seg<MeasureKind>
              id="kindseg" dataKey="kind" ariaLabel="Measure kind"
              value={ui.measureKind}
              onChange={(v) => { setUi({ measureKind: v }); session.pendingMeasure = []; session.pendingVoxel = []; session.pendingPlane = null; session.pendingFrame = null; }}
              options={[
                { value: 'length', label: 'Length' }, { value: 'angle', label: 'Angle' }, { value: 'probe', label: 'Probe' },
                { value: 'ellipse', label: 'Ellipse' }, { value: 'roi', label: 'Rect' }, { value: 'cobb', label: 'Cobb' },
              ]}
            />
          </div>
        )}
        <div className="sep" />
        <UndoGroup onUndo={doUndo} onClear={doClear} undoTitle="Undo stroke" clearTitle="Clear mask" />
        <div className="sep" />
        <Switch checked={ui.overlay} label="Mask" onChange={(v) => { setUi({ overlay: v }); paintBus.mpr(); }} />
      </div>
    </>
  );
}

/* The display controls, one dock per job. On desktop each is a pop-out in
   the viewer's bar (ViewerView); on mobile the Display panel stacks them.
   They were one strip, `#dock-tune`, that took a row of the viewport. */

/** Window, colormap and arrangement: preset, LUT, layout emphasis, sync,
 *  invert, hanging protocol. */
export function DisplayDock(): JSX.Element {
  const ui = useUi();
  // the W/L readout follows the session, not only the UI prefs
  useVersion();
  return (
    <div className="dock" id="dock-display">
      <div className="grp">
        <span className="lbl">Preset</span>
        <DarkSelect
          value={ui.preset} title="Preset"
          onChange={(v) => {
            setUi({ preset: v });
            session.wl = v === 'auto' ? session.autoWl
              : v === 'custom' ? (session.wl ?? session.autoWl) : PRESETS[v];
            paintBus.mpr();
          }}
        >
          <option value="auto">auto (p2–p98)</option>
          {Object.keys(PRESETS).map((k) => <option key={k} value={k}>{k}</option>)}
          <option value="custom">custom (drag: Shift)</option>
        </DarkSelect>
      </div>
      <div className="grp">
        <Chip><span id="ro-wl">W {Math.round(session.wl?.width ?? 0)} · C {Math.round(session.wl?.center ?? 0)}</span></Chip>
      </div>
      <div className="grp">
        <span className="lbl">LUT</span>
        <DarkSelect
          value={ui.lut} title="Colormap"
          onChange={(v) => { setUi({ lut: v }); paintBus.mpr(); }}
        >
          {['Grayscale', 'Fire', 'Spectrum', 'Hot-and-Cold', 'Gold'].map((k) => <option key={k} value={k}>{k}</option>)}
        </DarkSelect>
      </div>
      <div className="sep" />
      <div className="grp">
        <span className="lbl">Layout</span>
        <Seg<MprLayout>
          id="layoutseg" dataKey="layout" ariaLabel="2D stack emphasis"
          value={ui.layout} onChange={(v) => { setUi({ layout: v }); paintBus.mpr(); }}
          options={[
            { value: 'tri', label: '3-up' }, { value: 'axial', label: 'Ax' },
            { value: 'coronal', label: 'Cor' }, { value: 'sagittal', label: 'Sag' },
          ]}
        />
      </div>
      <Switch checked={ui.sync} label="Sync" onChange={(v) => setUi({ sync: v })} />
      <Switch checked={ui.invert} label="Invert" onChange={(v) => { setUi({ invert: v }); paintBus.mpr(); }} />
      <div className="sep" />
      <div className="grp">
        <span className="lbl">Hang</span>
        <DarkSelect
          value={ui.hang} title="Hanging protocol"
          onChange={(v) => applyHanging(v)}
        >
          {hangingOptions().map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </DarkSelect>
      </div>
    </div>
  );
}

/** Slab projection, obliquity and the plane teaching card. */
export function ReformatDock(): JSX.Element {
  const ui = useUi();
  return (
    <div className="dock" id="dock-reformat">
      <div className="grp">
        <span className="lbl">Slab</span>
        <Seg<ProjMode>
          id="projseg" dataKey="proj" ariaLabel="Projection"
          value={ui.proj} onChange={(v) => {
            // Leaving a rotating projection also straightens the view:
            // obl angles without a projection mode paint the oblique
            // slice, and the leg-9 reset proved slice-first alone leaves
            // the obl tag stuck (angles ride separately from proj).
            // bump() second: MprPanes subscribes layout/fullVp/proj/obl
            // but not `series`, so a bare setUi may not re-render it —
            // the repaint closure then stays stale and the tag freezes
            // after a cells round-trip (same root cause as the no-op
            // cleanup it replaced).
            if (v === 'slice') setUi({ proj: v, oblA: 0, oblB: 0 });
            else setUi({ proj: v });
            bump();
            paintBus.mpr();
          }}
          options={[
            { value: 'slice', label: 'Slice' }, { value: 'mip', label: 'MIP' },
            { value: 'minip', label: 'Min' }, { value: 'mean', label: 'Mean' },
          ]}
        />
      </div>
      {ui.proj !== 'slice' && (
        <SliderRow label="Thick" min={2} max={64} step={1} value={ui.slab} width={72}
          onInput={(v) => setUi({ slab: v })} onCommit={() => paintBus.mpr()} />
      )}
      <div className="sep" />
      <div className="grp">
        <span className="lbl">Tilt</span>
        <Seg<Plane>
          id="oblplaneseg" dataKey="oblplane" ariaLabel="Tilt plane"
          value={ui.oblPlane}
          onChange={(v) => { setUi({ oblPlane: v, oblA: 0, oblB: 0 }); paintBus.mpr(); }}
          options={[
            { value: 'axial', label: 'Ax' }, { value: 'coronal', label: 'Cor' },
            { value: 'sagittal', label: 'Sag' },
          ]}
        />
      </div>
      <SliderRow label="Obl A" min={-0.5} max={0.5} step={0.01} value={ui.oblA} width={64}
        onInput={(v) => setUi({ oblA: v })} onCommit={() => paintBus.mprPlane(ui.oblPlane)} />
      <SliderRow label="Obl B" min={-0.5} max={0.5} step={0.01} value={ui.oblB} width={64}
        onInput={(v) => setUi({ oblB: v })} onCommit={() => paintBus.mprPlane(ui.oblPlane)} />
      {(ui.oblA !== 0 || ui.oblB !== 0) && (
        <div className="grp">
          <IconBtn title="Reset obliquity" onClick={() => { setUi({ oblA: 0, oblB: 0 }); paintBus.mprPlane(ui.oblPlane); }}>Ortho</IconBtn>
        </div>
      )}
      <div className="sep" />
      <PlaneAtlasCard />
    </div>
  );
}

/** Second-series overlay: series, mode, blend. */
export function CompareDock(): JSX.Element {
  const ui = useUi();
  return (
    <div className="dock" id="dock-compare">
      <div className="grp">
        <span className="lbl">Compare</span>
        <DarkSelect
          value={ui.compareMode === 'off' ? '' : ui.compareSeries} title="Compare overlay series"
          ariaLabel="Compare overlay series"
          onChange={(v) => setCompare(v, v ? (ui.compareMode === 'off' ? 'checker' : ui.compareMode) : 'off')}
        >
          <option value="">off</option>
          {Object.keys(SERIES).filter((k) => k !== ui.series).map((k) => <option key={k} value={k}>{k}</option>)}
        </DarkSelect>
        {ui.compareMode !== 'off' && (
          <Seg<CompareMode>
            id="cmpseg" dataKey="cmp" ariaLabel="Compare mode"
            value={ui.compareMode}
            onChange={(v) => setCompare(ui.compareSeries, v)}
            options={[
              { value: 'checker', label: 'Check' }, { value: 'alpha', label: 'Blend' },
              { value: 'subtract', label: 'Δ' },
            ]}
          />
        )}
      </div>
      {ui.compareMode === 'alpha' && (
        <SliderRow label="Blend" min={0} max={1} step={0.05} value={ui.compareAlpha} width={64}
          onInput={(v) => setUi({ compareAlpha: v })} onCommit={() => paintBus.mpr()} />
      )}
    </div>
  );
}

/** Cine transport, only for a series with frames (a 4D NIfTI, a US cine).
 *  The session decides that, so this re-renders on its version. */
export function TimeDock(): JSX.Element | null {
  const ui = useUi();
  useVersion();
  if (session.timeNt <= 1) return null;
  return (
    <div className="dock" id="dock-time">
      <div className="grp">
        <span className="lbl">Time</span>
        <IconBtn id="cine-play" title={isCinePlaying() ? 'Pause cine' : 'Play cine'}
          onClick={() => toggleCine()}>{isCinePlaying() ? '⏸' : '▶'}</IconBtn>
        <SliderRow id="cine-fps" label="FPS" min={1} max={CINE_MAX_FPS} step={1} value={ui.cineFps} width={56}
          onInput={(v) => { setUi({ cineFps: v }); retimeCine(); }} />
        <SliderRow label="Frame" min={0} max={session.timeNt - 1} step={1} value={session.timeT} width={64}
          onInput={(v) => setTimeFrame(v)} />
        <Chip><span id="ro-time">t={session.timeT}/{session.timeNt - 1}{session.timeDiff ? ` · Δ${session.timeDiff.meanAbs.toFixed(1)}` : ''}</span></Chip>
      </div>
    </div>
  );
}

/** True once the open series has frames: the viewer shows its Time button. */
export function useHasFrames(): boolean {
  useVersion();
  return session.timeNt > 1;
}

/** Exports and presentation state. */
export function ExportDock({ axialCanvasRef }: {
  axialCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}): JSX.Element {
  return (
    <div className="dock" id="dock-export">
      <div className="grp">
        <IconBtn accent title="Export axial PNG" onClick={() => { if (axialCanvasRef.current) saveAxialPng(axialCanvasRef.current); }}>PNG</IconBtn>
        <IconBtn accent title="Export mask as .nii" onClick={saveMaskNii}>.NII</IconBtn>
        <IconBtn accent title="Export mask as DICOM-SEG" onClick={() => { void import('../lib/segImport').then((m) => m.saveSegDcm()); }}>SEG</IconBtn>
      </div>
      <div className="sep" />
      <div className="grp" id="dock-present">
        <IconBtn title="Save presentation state JSON (WL + slices + zoom/pan + annotations)" onClick={savePresentState}>Present</IconBtn>
        <label className="iconbtn" htmlFor="present-upload" title="Load a presentation state JSON">Open</label>
        <input
          type="file" id="present-upload" accept=".json,application/json" hidden
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) void loadPresentStateFile(f);
            (e.target as HTMLInputElement).value = '';
          }}
        />
      </div>
    </div>
  );
}

/** A4 cross-section teaching atlas: "what plane am I looking at" card.
 *  Reads the live tune state (tilt plane + obliquity) + the axial slider
 *  fraction out of the DOM (same ids the wire leg drives); the engine card
 *  answers with thirds landmarks + the tilt caution. Education text only
 *  (badged) — never a claim about the open volume's own anatomy. */
function PlaneAtlasCard(): JSX.Element {
  const ui = useUi();
  const [plane, setPlane] = useState<'axial' | 'coronal' | 'sagittal'>('axial');
  const line = (() => {
    const card = planeCardByPlane(plane);
    if (!card) {
      setStatus(`unknown plane card: ${plane}`);
      return null;
    }
    const s = document.getElementById(`s-${plane}`) as HTMLInputElement | null;
    const frac = s && Number(s.max) > 0 ? Number(s.value) / Number(s.max) : 0.5;
    const tilted = ui.oblPlane === plane && (ui.oblA !== 0 || ui.oblB !== 0);
    try {
      return planeCardLine(card, frac, tilted);
    } catch (e) {
      setStatus(`plane card failed: ${(e as Error).message}`, 'error');
      return null;
    }
  })();
  return (
    <>
      <div className="grp" id="dock-plane">
        <span className="lbl">Plane</span>
        <Seg<'axial' | 'coronal' | 'sagittal'>
          id="planeseg" dataKey="planecard" ariaLabel="Teaching plane"
          value={plane} onChange={(v) => setPlane(v)}
          options={PLANE_CARDS.map((c) => ({ value: c.plane, label: c.plane.slice(0, 2) === 'ax' ? 'Ax' : c.plane.slice(0, 2) === 'co' ? 'Cor' : 'Sag' }))}
        />
      </div>
      {line && (
        <div className="grp">
          <Chip><span id="ro-plane">{line}</span></Chip>
        </div>
      )}
      <div className="hint">{EDUCATION_BADGE}</div>
    </>
  );
}

/** Segmentation ops (watershed split etc.). Own pill on desktop (`#dock-seg`),
 *  Display-panel section on mobile. */
export function SegDock(): JSX.Element {
  const ui = useUi();
  return (
    <>
      <div className="dock" id="dock-seg">
        <div className="grp">
          <span className="lbl">Segment</span>
          {/* F14: each label's outline in its colour over a light fill,
              or the opaque fill the panes always drew */}
          <Seg<UiState['maskLook']>
            id="masklook" dataKey="look" ariaLabel="Mask look" value={ui.maskLook}
            onChange={(v) => { setUi({ maskLook: v }); paintBus.mpr(); }}
            options={[{ value: 'outline', label: 'Outline' }, { value: 'fill', label: 'Fill' }]}
          />
        </div>
        {SEG_OPS.map((op) => (
          <div className="grp" key={op.name}>
            {/* bump() inside applySegOp repaints via the ver effect; no
                manual paintBus here — it would clobber the op summary. */}
            <IconBtn title={op.title} onClick={() => { void applySegOp(op.name); }}>
              {op.label}
            </IconBtn>
          </div>
        ))}
      </div>
    </>
  );
}
