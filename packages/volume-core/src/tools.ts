// Port of Cornerstone3D tool API (CPU cut, no VTK).
// Cornerstone: RenderingEngine + viewports + ToolGroup + annotation tools,
// multi-threaded decode, VIEWPORT_PRESETS. We steal: tool names, tool-group
// binding, worker execution contract. Every op stays pure
// (Volume, seed, params) -> mask so it runs in a Worker and is undoable.

export type ToolName =
  | 'zoom'
  | 'pan'
  | 'stack'
  | 'magnify'
  | 'ruler'      // length (Papaya: Ruler)
  | 'angle'      // angle (Papaya: Angle)
  | 'ellipse'    // ellipse ROI
  | 'rectangle'
  | 'brush'      // CACTAS brush
  | 'threshold'
  | 'regionGrow';

export interface ToolBinding {
  tool: ToolName;
  mouseButton?: 1 | 2 | 4;
  keyboardModifier?: 'shift' | 'ctrl' | 'alt';
}

/** Cornerstone ToolModes: active/passive/enabled/disabled semantics. */
export type ToolMode = 'active' | 'passive' | 'enabled' | 'disabled';

export interface ToolGroup {
  id: string;
  bindings: ToolBinding[];
  active: ToolName;
  modes: Record<string, ToolMode>;
  viewports: string[];
}

/** Tool registry (Cornerstone addTool): name -> registered. */
const registry = new Set<ToolName>();

export function addTool(name: ToolName): void {
  registry.add(name);
}

export function hasTool(name: ToolName): boolean {
  return registry.has(name);
}

export function setToolMode(group: ToolGroup, name: ToolName, mode: ToolMode): void {
  group.modes[name] = mode;
  if (mode === 'active') group.active = name;
}

/** Worker execution contract: tools never touch DOM, only TypedArrays. */
export interface ToolJob {
  tool: ToolName;
  volumeDims: [number, number, number];
  params: Record<string, number | string | boolean>;
}

export function defaultToolGroup(id: string): ToolGroup {
  return {
    id,
    active: 'stack',
    modes: { stack: 'active', zoom: 'passive', pan: 'passive', ruler: 'passive', brush: 'passive' },
    viewports: [],
    bindings: [
      { tool: 'stack' },
      { tool: 'zoom' },
      { tool: 'pan', keyboardModifier: 'shift' },
      { tool: 'ruler' },
      { tool: 'brush' },
    ],
  };
}
