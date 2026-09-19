// Ported from RCSB ViewerProps/DefaultViewerProps + PDBe InitParams shape.
// Minimal-embed options bag for the (later, modern) UI. No React/Mol*.

export interface ViewerProps {
  moleculeId?: string;
  modelUrl?: string;
  format?: 'mmcif' | 'pdb' | 'nifti';
  layoutShowSequence?: boolean;
  bgColor?: string;
  assemblyId?: string;
}

export const DEFAULT_VIEWER_PROPS: Required<ViewerProps> = {
  moleculeId: '',
  modelUrl: '',
  format: 'mmcif',
  layoutShowSequence: true,
  bgColor: '#faf5ec',
  assemblyId: '1',
};

export function resolveViewerProps(p: Partial<ViewerProps>): Required<ViewerProps> {
  return { ...DEFAULT_VIEWER_PROPS, ...p };
}
