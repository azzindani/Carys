import type { SeriesSpec } from './types';

export type { SeriesSpec };

// NOTE: liver_33 naming is swapped upstream (img=labels, seg=CT).
export const SERIES: Record<string, SeriesSpec> = {
  'brats-flair-seg': {
    img: ['/samples/brain_tumor_BraTS19_CBICA_AQN_1_flair.nii'],
    seg: ['/samples/brain_tumor_BraTS19_CBICA_AQN_1_seg.nii'],
    modality: 'MR', bodyPart: 'brain flair tumor',
    axialFrac: 0.72, color: [230, 80, 80],
  },
  'liver-ct-seg': {
    img: ['/samples/liver_33_seg.nii'], seg: ['/samples/liver_33_img.nii'], color: [90, 200, 120],
    modality: 'CT', bodyPart: 'liver abdomen',
  },
  'covid-chest-seg': {
    img: ['/samples/volume-covid19-A-0329.nii'],
    seg: ['/samples/volume-covid19-A-0329_seg.nii'], color: [230, 80, 80],
    modality: 'CT', bodyPart: 'chest covid',
  },
  'cardiac-frame01': { img: ['/samples/cardiac_patient021_frame01.nii'], color: [225, 215, 200], modality: 'CT', bodyPart: 'cardiac' },
  'cardiac-4d-cine': {
    img: ['/samples/cardiac_patient021_4d.nii'], color: [225, 215, 200],
    modality: 'CT', bodyPart: 'cardiac cine', time: true,
  },
  'skull-seg': {
    img: ['/samples/skull_case_0001_img.nii'],
    seg: ['/samples/skull_case_0001_seg.nii'], color: [225, 215, 200],
    modality: 'CT', bodyPart: 'skull',
  },
  'skull-ct-bone': {
    img: ['/samples/skull_case_0001_img.nii'], color: [225, 215, 200], threshold3d: 250,
    modality: 'CT', bodyPart: 'skull bone',
  },
  // D1 OpenNeuro ds000001 (CC0, Balloon Analog Risk-taking Task, sub-01):
  // center-cut teaching crops — T1 64³ + BOLD f0 64×64×33. World coords
  // stay honest (crop-shifted affine). Research-only fixtures, never patients.
  'openneuro-t1-crop': {
    img: ['/samples/openneuro_ds000001_t1-crop.nii'], color: [225, 215, 200],
    modality: 'MR', bodyPart: 'brain T1 ds000001', axialFrac: 0.5,
  },
  'openneuro-bold-f0': {
    img: ['/samples/openneuro_ds000001_bold-f0.nii'], color: [225, 170, 120],
    modality: 'MR', bodyPart: 'brain BOLD ds000001',
  },
  'lung-ct-dicom': { dicom: [1, 2, 3, 4, 5].map((i) => `/samples/lung_ct_0${i}.dcm`), color: [225, 215, 200], modality: 'CT', bodyPart: 'lung' },
  'cardiac-dicom': { dicom: [1, 2, 4, 5].map((i) => `/samples/cardiac_0${i}.dcm`), color: [225, 215, 200], modality: 'CT', bodyPart: 'cardiac' },
  'prostate-dicom': { dicom: [1, 2, 3, 4, 5].map((i) => `/samples/prostate_mri_0${i}.dcm`), color: [225, 215, 200], modality: 'MR', bodyPart: 'prostate' },
};

export function addUploadedSeries(
  name: string,
  color: [number, number, number] = [90, 200, 120],
  extra: Partial<SeriesSpec> = {},
): void {
  SERIES[name] = { img: [], color, source: 'upload', ...extra };
}
