// The 3D views' clip controls (F13): a plane across one axis, kept on one
// side, and a crop box. Fractions of the volume, so they mean the same in
// both render modes and survive a series switch (lib/clip3d.ts).
import type { JSX } from 'react';
import { Seg, SliderRow, Switch } from '../ui/primitives';
import { CLIP_OFF } from '../lib/clip3d';
import type { Clip3d } from '../lib/types';

type Plane = Clip3d['plane'];

/** Least crop box side, as a fraction: the box never closes up. */
const MIN_SIDE = 0.05;

const AXES = ['x', 'y', 'z'] as const;

export function ClipPanel({ clip, onInput }: { clip: Clip3d; onInput: (c: Clip3d) => void }): JSX.Element {
  const set = (patch: Partial<Clip3d>): void => onInput({ ...clip, ...patch });
  const crop = (i: number, v: number): void => {
    const box = [...clip.box] as Clip3d['box'];
    // a side's low end stays below its high end, and the other way round
    box[i] = i % 2 === 0 ? Math.min(v, box[i + 1]! - MIN_SIDE) : Math.max(v, box[i - 1]! + MIN_SIDE);
    set({ box });
  };
  return (
    <div className="pane clippane" id="pane-clip">
      <div className="pane-head"><span className="name">Clip</span><span className="sub">plane and crop box · both render modes</span></div>
      <div className="clipwrap">
        <div className="grp">
          <span className="lbl">Plane</span>
          <Seg<Plane>
            id="clipplane" dataKey="plane" ariaLabel="Clip plane" value={clip.plane}
            onChange={(v) => set({ plane: v })}
            options={[
              { value: 'none', label: 'None' }, { value: 'axial', label: 'Axial' },
              { value: 'coronal', label: 'Coronal' }, { value: 'sagittal', label: 'Sagittal' },
            ]}
          />
        </div>
        {clip.plane !== 'none' && (
          <>
            <SliderRow id="clip-at" label="Position" min={0} max={1} step={0.01} value={clip.at} onInput={(v) => set({ at: v })} />
            <Switch checked={clip.flip} label="Keep the far side" onChange={(v) => set({ flip: v })} />
          </>
        )}
      </div>
      <div className="clipwrap">
        <span className="lbl">Crop</span>
        {AXES.map((a, k) => (
          <div className="grp" key={a}>
            <SliderRow label={`${a} from`} min={0} max={1} step={0.01} value={clip.box[2 * k]!} onInput={(v) => crop(2 * k, v)} />
            <SliderRow label={`${a} to`} min={0} max={1} step={0.01} value={clip.box[2 * k + 1]!} onInput={(v) => crop(2 * k + 1, v)} />
          </div>
        ))}
        <button className="iconbtn" onClick={() => onInput({ ...CLIP_OFF, on: true })}>Reset</button>
      </div>
    </div>
  );
}
