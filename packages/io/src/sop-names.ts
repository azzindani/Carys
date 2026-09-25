// SOP Class display names, apart from the tag reader so a UI can name a
// SOP Class without bundling a DICOM parser. Dependency-free.

/** Short names for the storage SOP Classes this viewer can plausibly meet
 *  (OHIF's DICOM Tag Browser shows the same first row). */
export const SOP_CLASS_NAMES: Record<string, string> = {
  '1.2.840.10008.5.1.4.1.1.1': 'Computed Radiography',
  '1.2.840.10008.5.1.4.1.1.1.1': 'Digital X-Ray',
  '1.2.840.10008.5.1.4.1.1.2': 'CT Image',
  '1.2.840.10008.5.1.4.1.1.4': 'MR Image',
  '1.2.840.10008.5.1.4.1.1.6.1': 'Ultrasound Image',
  '1.2.840.10008.5.1.4.1.1.7': 'Secondary Capture',
  '1.2.840.10008.5.1.4.1.1.1.2': 'Digital Mammography',
  '1.2.840.10008.5.1.4.1.1.1.2.1': 'Digital Mammography (processing)',
  '1.2.840.10008.5.1.4.1.1.13.1.3': 'Breast Tomosynthesis',
  '1.2.840.10008.5.1.4.1.1.13.1.4': 'Breast Projection (presentation)',
  '1.2.840.10008.5.1.4.1.1.13.1.5': 'Breast Projection (processing)',
  '1.2.840.10008.5.1.4.1.1.12.1': 'X-Ray Angiographic',
  '1.2.840.10008.5.1.4.1.1.20': 'Nuclear Medicine',
  '1.2.840.10008.5.1.4.1.1.77.1.2': 'VL Microscopic',
  '1.2.840.10008.5.1.4.1.1.77.1.3': 'VL Slide Coordinates',
  '1.2.840.10008.5.1.4.1.1.104.1': 'Encapsulated PDF',
  '1.2.840.10008.5.1.4.1.1.104.2': 'Encapsulated CDA',
  '1.2.840.10008.5.1.4.1.1.128': 'PET Image',
  '1.2.840.10008.5.1.4.1.1.481.1': 'RT Image',
  '1.2.840.10008.5.1.4.1.1.481.2': 'RT Dose',
  '1.2.840.10008.5.1.4.1.1.481.3': 'RT Structure Set',
  '1.2.840.10008.5.1.4.1.1.481.5': 'RT Plan',
  '1.2.840.10008.5.1.4.1.1.66.4': 'Segmentation',
  '1.2.840.10008.5.1.4.1.1.88.11': 'Basic Text SR',
  '1.2.840.10008.5.1.4.1.1.88.22': 'Enhanced SR',
  '1.2.840.10008.5.1.4.1.1.88.33': 'Comprehensive SR',
};

export function sopClassName(uid: string | null): string {
  if (!uid) return 'Unknown SOP Class';
  return SOP_CLASS_NAMES[uid] ?? 'Unknown SOP Class';
}

