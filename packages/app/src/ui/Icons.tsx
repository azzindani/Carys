import type { JSX } from 'react';

/**
 * Navigation + chrome iconography. One stroke weight (1.6), one 20-unit
 * grid, `currentColor` throughout — so an icon inherits whatever state the
 * control it sits in is expressing.
 */

type P = { className?: string };
const box = {
  viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

export function IconStudies(p: P): JSX.Element {
  return (
    <svg {...box} {...p}>
      <rect x="2.5" y="4" width="15" height="12.5" rx="2.2" />
      <path d="M2.5 8h15M7 4v12.5" />
    </svg>
  );
}

export function IconViewer(p: P): JSX.Element {
  return (
    <svg {...box} {...p}>
      <rect x="2.5" y="2.5" width="15" height="15" rx="2.4" />
      <path d="M10 2.5v15M2.5 10h15" />
    </svg>
  );
}

export function IconReport(p: P): JSX.Element {
  return (
    <svg {...box} {...p}>
      <path d="M5 2.5h6.5L15.5 6.5v11a1 1 0 01-1 1h-9.5a1 1 0 01-1-1v-14a1 1 0 011-1z" />
      <path d="M11 2.6V7h4.4M7 11h6M7 14h4" />
    </svg>
  );
}

export function IconProtein(p: P): JSX.Element {
  return (
    <svg {...box} {...p}>
      <path d="M5.5 3c0 4 9 4 9 8s-9 4-9 8" />
      <circle cx="5.5" cy="3.4" r="1.4" /><circle cx="14.5" cy="11" r="1.4" /><circle cx="5.5" cy="18.6" r="1.4" />
    </svg>
  );
}

export function IconCells(p: P): JSX.Element {
  return (
    <svg {...box} {...p}>
      <circle cx="10" cy="10" r="7.2" />
      <circle cx="8.2" cy="8.6" r="2" /><circle cx="12.8" cy="12.2" r="1.4" />
    </svg>
  );
}

export function IconTracks(p: P): JSX.Element {
  return (
    <svg {...box} {...p}>
      <path d="M2.5 6h15M2.5 10h15M2.5 14h15" />
      <rect x="5" y="4.4" width="4" height="3.2" rx="1" fill="currentColor" stroke="none" />
      <rect x="11" y="12.4" width="5" height="3.2" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconAtlas(p: P): JSX.Element {
  return (
    <svg {...box} {...p}>
      <path d="M10 3.2c-2.6 0-4.4 1.8-4.4 4 0 1.5.6 2.3 1.2 3.2.5.8.7 1.6.7 2.6h5c0-1 .2-1.8.7-2.6.6-.9 1.2-1.7 1.2-3.2 0-2.2-1.8-4-4.4-4z" />
      <path d="M7.8 16.2h4.4M8.4 18h3.2" />
    </svg>
  );
}

export function IconLearn(p: P): JSX.Element {
  return (
    <svg {...box} {...p}>
      <path d="M10 3.2L17.5 7 10 10.8 2.5 7 10 3.2z" />
      <path d="M5.5 8.8v4.4c0 1.3 2 2.4 4.5 2.4s4.5-1.1 4.5-2.4V8.8" />
    </svg>
  );
}

export function IconGear(p: P): JSX.Element {
  return (
    <svg {...box} {...p}>
      <circle cx="10" cy="10" r="2.7" />
      <path d="M10 1.9v2.3M10 15.8v2.3M1.9 10h2.3M15.8 10h2.3M4.3 4.3l1.6 1.6M14.1 14.1l1.6 1.6M15.7 4.3l-1.6 1.6M5.9 14.1l-1.6 1.6" />
    </svg>
  );
}

export function IconMenu(p: P): JSX.Element {
  return <svg {...box} {...p}><path d="M3 5.5h14M3 10h14M3 14.5h14" /></svg>;
}

export function IconSearch(p: P): JSX.Element {
  return <svg {...box} {...p}><circle cx="8.8" cy="8.8" r="5.3" /><path d="M12.8 12.8l4 4" /></svg>;
}

export function IconPanel(p: P): JSX.Element {
  return (
    <svg {...box} {...p}>
      <rect x="2.5" y="3.5" width="15" height="13" rx="2.2" />
      <path d="M12.5 3.5v13" />
    </svg>
  );
}

/** Orientation axis gizmo — the corner widget every 3D viewport carries.
 *  Purely decorative chrome: it reflects orbit/tilt, it does not render. */
export function AxisGizmo({ orbit, tilt }: { orbit: number; tilt: number }): JSX.Element {
  // Project unit axes with the same orbit/tilt convention the CPU rasteriser
  // uses, so the widget agrees with what the canvas shows.
  const a = (orbit * Math.PI) / 180;
  const b = (tilt * Math.PI) / 180;
  const C = 29;
  const L = 17;
  const proj = (x: number, y: number, z: number): [number, number] => {
    const rx = x * Math.cos(a) + z * Math.sin(a);
    const rz = -x * Math.sin(a) + z * Math.cos(a);
    const ry = y * Math.cos(b) - rz * Math.sin(b);
    return [C + rx * L, C - ry * L];
  };
  const axes: { p: [number, number]; c: string; l: string }[] = [
    { p: proj(1, 0, 0), c: 'var(--color-danger)', l: 'X' },
    { p: proj(0, 1, 0), c: 'var(--color-ok)', l: 'Y' },
    { p: proj(0, 0, 1), c: 'var(--color-violet)', l: 'Z' },
  ];
  return (
    <svg className="gizmo" viewBox="0 0 58 58" aria-hidden="true">
      <circle cx={C} cy={C} r="26" fill="rgb(0 0 0 / 0.28)" stroke="rgb(255 255 255 / 0.09)" />
      {axes.map((ax) => (
        <g key={ax.l}>
          <line x1={C} y1={C} x2={ax.p[0]} y2={ax.p[1]} stroke={ax.c} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx={ax.p[0]} cy={ax.p[1]} r="5.2" fill={ax.c} />
          <text x={ax.p[0]} y={ax.p[1] + 2.6} textAnchor="middle" fill="var(--color-on-accent)">{ax.l}</text>
        </g>
      ))}
    </svg>
  );
}
