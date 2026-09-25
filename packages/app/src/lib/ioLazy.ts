// io readers the boot path calls only for some files (an upload sniffed for
// SEG/RTSTRUCT, a series' tag summary, a detached NRRD header): imported on
// first use, so the DICOM and NRRD parsers stay out of the entry chunk.
export { fileMetaToSummary, nrrdDetachedName, readDataset } from '@carys/io';
