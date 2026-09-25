import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { parseDicomFrames, type DicomDir, type DicomDirSeries } from '@carys/io';
import {
  anonymizeRecord, audit, buildRecord, DEFAULT_PROFILE, filterWorklist,
  fmtBytes, markRead, markReading, modalityFacets, readState, renderThumbnail, scrubNiftiDescrip,
  signRead, unlockRead,
  type StudyRecord, type WorklistQuery,
} from '@carys/study';
import {
  bundleById, cohortAuditDetail, cohortById, cohortDifficultyRange, cohortProgress, pathogenById,
  TEACHING_COHORTS,
  type CohortCase, type TeachingCohort,
} from '@carys/volume-core';
import {
  compressionAudit, deidReportCard, doseRegistry, phantomTrend,
} from '@carys/study';
import { EDUCATION_BADGE } from '@carys/study';
import { useVersion, bump } from '../lib/version';
import { SERIES } from '../lib/catalog';
import { openDicomDirSeries, parseDicomDirFile } from '../lib/dicomdir';
import { autoWindow } from '../lib/loaders';
import { resolveVolume } from '../lib/pacs';
import { missingHint, probeSamples } from '../lib/sampleAvailability';
import { setStatus } from '../lib/status';
import { toast } from '../lib/toasts';
import { Chip, DarkSelect, Seg } from '../ui/primitives';
import { PacsPanel } from './PacsPanel';

const PAGE = 'worklist';

export function WorklistView({ onOpen }: { onOpen: (key: string) => void }): JSX.Element {
  const [records, setRecords] = useState<StudyRecord[]>(() =>
    Object.entries(SERIES).map(([key, spec]) => {
      const r = buildRecord(key, { img: spec.img, seg: spec.seg, dicom: spec.dicom });
      if (spec.source) r.source = spec.source;
      if (spec.remote) r.files = [`pacs:${spec.remote.seriesUID.slice(-12)}`];
      return r;
    }),
  );
  // DICOMDIR import: directory file + the referenced files selected
  // together; the series picker opens one directory series per click.
  const [dir, setDir] = useState<DicomDir | null>(null);
  const [dirName, setDirName] = useState('');
  const [dirPick, setDirPick] = useState('');
  const dirFiles = useRef<File[]>([]);
  const [text, setText] = useState('');
  const [modalities, setModalities] = useState<Set<string>>(new Set());
  const [source, setSource] = useState<WorklistQuery['source']>('all');
  const [sort, setSort] = useState<WorklistQuery['sort']>('name');
  const [tab, setTab] = useState<'local' | 'pacs'>('local');
  // Which entries this server can open: null until every probe answers.
  const [avail, setAvail] = useState<Map<string, boolean> | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    probeSamples(SERIES, ctrl.signal).then(setAvail, (e: Error) => {
      if (e.name !== 'AbortError') setStatus(`sample probe failed: ${e.message}`, 'error');
    });
    return () => ctrl.abort();
  }, [records.length]);
  const openable = avail ? [...avail.values()].filter(Boolean).length : null;

  // Fetch cheap identity: first DICOM slice meta per DICOM row (parallel).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const updates = await Promise.all(
        Object.entries(SERIES).map(async ([key, spec]) => {
          if (!spec.dicom?.length) return null;
          try {
            const res = await fetch(spec.dicom[0]!);
            // identity probe: first frame's meta (multi-frame files welcome)
            const all = parseDicomFrames(await res.arrayBuffer());
            if (all.length === 0) return null;
            return { key, meta: all[0]!.meta };
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setRecords((rows) =>
        rows.map((r) => {
          const u = updates.find((x) => x?.key === r.key);
          if (!u) return r;
          const m = u.meta;
          return {
            ...r,
            patientName: m.patientName, patientID: m.patientID, studyUID: m.studyUID,
            modality: m.modality ?? r.modality, seriesDescription: m.seriesDescription,
            studyDate: m.studyDate,
          };
        }),
      );
    })();
    return () => { cancelled = true; };
  }, []);

  const query: WorklistQuery = useMemo(() => ({
    text, modalities, source, hasSeg: null, sort, dir: 'asc',
  }), [text, modalities, source, sort]);
  const rows = useMemo(() => filterWorklist(records, query), [records, query]);
  const facets = useMemo(() => modalityFacets(records), [records]);

  const toggleModality = (m: string): void => {
    setModalities((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };

  /** DICOMDIR + referenced files selected together: parse the directory,
   *  keep every file for series resolution, default the picker at the
   *  first series with images. */
  const openDirFiles = async (files: File[]): Promise<void> => {
    const dirFile = files.find((f) => /^dicomdir$/i.test(f.name) || /^dicomdir\./i.test(f.name))
      ?? files.find((f) => f.name.toLowerCase().includes('dicomdir'));
    if (!dirFile) {
      setStatus('no DICOMDIR among the selected files — include the directory file with its images');
      return;
    }
    dirFiles.current = files.filter((f) => f !== dirFile);
    const parsed = await parseDicomDirFile(dirFile);
    if (!parsed) {
      setDir(null);
      return;
    }
    setDir(parsed);
    setDirName(dirFile.name);
    const first = firstSeriesWithImages(parsed);
    setDirPick(first ? seriesKey(parsed, first) : '');
  };

  const openDirPick = (): void => {
    if (!dir) return;
    const series = findSeries(dir, dirPick);
    if (!series) {
      setStatus('pick a DICOMDIR series first');
      return;
    }
    void openDicomDirSeries(dirName || 'DICOMDIR', series, dirFiles.current).then(() => {
      // The opened series registers in the catalog: refresh the worklist
      // rows so the new upload appears without a reload.
      setRecords(Object.entries(SERIES).map(([key, spec]) => {
        const r = buildRecord(key, { img: spec.img, seg: spec.seg, dicom: spec.dicom });
        if (spec.source) r.source = spec.source;
        if (spec.remote) r.files = [`pacs:${spec.remote.seriesUID.slice(-12)}`];
        return r;
      }));
    });
  };

  return (
    <section className="worklist" data-page={PAGE}>
      <div className="view-title">
        <h1>Studies</h1>
        <p>
          {rows.length} of {records.length} series — search, filter, open, anonymize
          {openable !== null && (
            <> · <span id="wl-avail" title="Series whose files this server has; the rest say what fills them">{openable} of {avail!.size} can open here</span></>
          )}
        </p>
        <span className="wl-tabs">
          <Seg ariaLabel="Study source" value={tab} onChange={setTab} options={[
            { value: 'local', label: 'Local' }, { value: 'pacs', label: 'PACS' },
          ]} />
        </span>
      </div>
      {tab === 'pacs' ? <PacsPanel onPull={onOpen} /> : (
      <>
      <div className="dock" id="dock-worklist">
        <div className="grp">
          <input
            className="wl-search" placeholder="Search key, patient, UID, modality…" aria-label="Search studies"
            value={text} onChange={(e) => setText((e.target as HTMLInputElement).value)}
          />
        </div>
        <div className="sep" />
        <div className="grp">
          <label className="iconbtn" htmlFor="dicomdir-upload" title="Open a DICOMDIR + its referenced files (multi-select)">DICOMDIR</label>
          <input
            type="file" id="dicomdir-upload" multiple hidden
            onChange={(e) => {
              const files = [...((e.target as HTMLInputElement).files ?? [])];
              (e.target as HTMLInputElement).value = '';
              if (files.length > 0) void openDirFiles(files);
            }}
          />
        </div>
        {dir && (
          <div className="grp" id="dock-dir">
            <span className="lbl">Dir series</span>
            <DarkSelect value={dirPick} title="DICOMDIR series to open" ariaLabel="DICOMDIR series"
              onChange={(v) => setDirPick(v)}>
              {dir.studies.flatMap((st) => st.series.map((se) => (
                <option key={seriesKey(dir, se)} value={seriesKey(dir, se)}>
                  {se.modality ?? '?'} {se.seriesNumber ?? ''} · {se.images.length} img
                </option>
              )))}
            </DarkSelect>
            <button className="iconbtn" id="dir-open" title="Open the picked DICOMDIR series"
              onClick={openDirPick}>Open</button>
            <Chip title="Parsed DICOMDIR studies + image refs"><span id="ro-dir">{dir.studies.length} studie(s) · {dir.imageCount} refs</span></Chip>
          </div>
        )}
        <div className="sep" />
        <div className="grp">
          {facets.map((f) => (
            <button
              key={f.modality}
              className={`fchip${modalities.has(f.modality) ? ' on' : ''}`}
              aria-pressed={modalities.has(f.modality)}
              onClick={() => toggleModality(f.modality)}
            >
              {f.modality} <span>{f.count}</span>
            </button>
          ))}
        </div>
        <div className="sep" />
        <div className="grp">
          <Seg ariaLabel="Source" value={source} onChange={setSource} options={[
            { value: 'all', label: 'All' }, { value: 'nifti', label: 'NIfTI' },
            { value: 'dicom', label: 'DICOM' }, { value: 'upload', label: 'Uploads' },
          ]} />
        </div>
        <div className="grp">
          <span className="lbl">Sort</span>
          <DarkSelect value={sort} onChange={(v) => setSort(v as WorklistQuery['sort'])} title="Sort" ariaLabel="Sort studies">
            <option value="name">Name</option>
            <option value="modality">Modality</option>
            <option value="voxels">Size</option>
          </DarkSelect>
        </div>
      </div>
      <CohortSection onOpen={onOpen} />
      <QcSection />
      <div className="wl-rows">
        {rows.map((r) => (
          <WorklistRow key={r.key} record={r} available={avail?.get(r.key)} onOpen={() => onOpen(r.key)} onStats={(patch) =>
            setRecords((all) => all.map((x) => (x.key === r.key ? { ...x, ...patch } : x)))} />
        ))}
        {rows.length === 0 && <div className="wl-empty">No series match. Clear the search or filters.</div>}
      </div>
      </>)}
    </section>
  );
}

/** Q1–Q4 lab QC: phantom trending, dose registry, compression audit,
 *  de-identification report card — aggregates over the worklist rows the
 *  view already holds (identity meta from the first-slice probe) plus one
 *  phantom point per series (R1 water mean, educational stand-in until a
 *  real phantom scan is pinned). Numbers in, table rows out; every verdict
 *  teaches, never diagnoses. */
function QcSection(): JSX.Element {
  const [tab, setTab] = useState<'phantom' | 'dose' | 'compression' | 'deid'>('phantom');
  // R1 phantom point per series: uniform-water mean stand-in (0 HU) with a
  // deterministic ±2 HU walk by series index — trending math is real,
  // the points are labeled stand-ins until a pinned phantom scan lands.
  const points = Object.keys(SERIES).map((key, i) => ({
    series: key,
    date: `2026-09-${String(1 + (i % 17)).padStart(2, '0')}`,
    meanHU: (i % 5) - 2,
    expectedHU: 0,
    toleranceHU: 5,
  }));
  const trend = phantomTrend(points);
  return (
    <div className="dock" id="dock-qc">
      <div className="grp">
        <span className="lbl">QC</span>
        <Seg<'phantom' | 'dose' | 'compression' | 'deid'> ariaLabel="QC panel"
          value={tab} onChange={setTab} options={[
            { value: 'phantom', label: 'Phantom' }, { value: 'dose', label: 'Dose' },
            { value: 'compression', label: 'Compress' }, { value: 'deid', label: 'De-ID' },
          ]} />
      </div>
      {tab === 'phantom' && (
        <div className="grp">
          <Chip><span id="ro-qc-phantom">{trend.filter((r) => r.pass).length}/{trend.length} pass · stand-in points (R1 phantom until pinned scan)</span></Chip>
        </div>
      )}
      {tab === 'dose' && (
        <div className="grp">
          <Chip><span id="ro-qc-dose">{doseRegistry(Object.keys(SERIES).map((key) => ({ series: key, ctdivol: undefined, dlp: undefined, kvp: undefined }))).notRecorded.ctdivol === 1 ? 'no dose headers in catalog (all unrecorded)' : 'dose headers present'} · {EDUCATION_BADGE}</span></Chip>
        </div>
      )}
      {tab === 'compression' && (
        <div className="grp">
          <Chip><span id="ro-qc-compress">{(() => {
            const a = compressionAudit(Object.keys(SERIES).map((key) => ({ series: key, transferSyntaxUID: null })));
            return `${Math.round(a.unvalidatedRate * 100)}% unvalidated (no TS surfaced — treat as unvalidated)`;
          })()} · {EDUCATION_BADGE}</span></Chip>
        </div>
      )}
      {tab === 'deid' && (
        <div className="grp">
          <Chip><span id="ro-qc-deid">{(() => {
            const c = deidReportCard(Object.keys(SERIES).map((key) => ({
              series: key, burnedFraction: 0, actions: { replace: 0, remove: 0, keep: 0 },
            })));
            return `${c.readyCount}/${c.rows.length} ready (pixel screen clean, no tags classified yet)`;
          })()} · {EDUCATION_BADGE}</span></Chip>
        </div>
      )}
    </div>
  );
}

/** K3 teaching cohorts: picker + progress + case rows reusing the
 *  read-status flow. Series cases open in the viewer (markReading, like
 *  WorklistRow.Open); pathogen/bundle cases navigate via onOpenCohort.
 *  Case completion = read/signed on the case key; audit logs cohort.open
 *  via the generic audit() with a cohort detail line. */
function CohortSection({ onOpen }: {
  onOpen: (key: string) => void;
  onOpenCohort?: (target: CohortCase['target']) => void;
}): JSX.Element {
  useVersion();
  const [sel, setSel] = useState(TEACHING_COHORTS[0]!.id);
  const cohort: TeachingCohort = cohortById(sel) ?? TEACHING_COHORTS[0]!;
  const prog = cohortProgress(cohort, (k) => readState(k).status);
  const openCase = (c: CohortCase): void => {
    const key = c.target.kind === 'series' ? c.target.key : c.target.id;
    audit('read.read', key, cohortAuditDetail(cohort.id, c.id, 'open'));
    if (c.target.kind === 'series') {
      markReading(key);
      onOpen(key);
    } else {
      setStatus(`${c.title}: opens in the ${c.target.kind} view (series-style read flow stays viewer-only) · ${EDUCATION_BADGE}`);
    }
    bump();
  };
  return (
    <div className="dock" id="dock-cohort">
      <div className="grp">
        <span className="lbl">Cohort</span>
        <DarkSelect value={cohort.id} title="Teaching cohort (curated cases + read progress)" ariaLabel="Teaching cohort"
          onChange={(v) => { if (cohortById(v)) setSel(v); else setStatus(`unknown cohort: ${v}`); }}>
          {TEACHING_COHORTS.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
        </DarkSelect>
        <Chip title="Cases read or signed"><span id="ro-cohort">{prog.done}/{prog.total} done</span></Chip>
      </div>
      <div className="hint">{cohort.blurb} · difficulty {cohortDifficultyRange(cohort)[0]}–{cohortDifficultyRange(cohort)[1]} · {EDUCATION_BADGE}</div>
      <dl className="kv" id="cohort-cases">
        {cohort.cases.map((c) => {
          const key = c.target.kind === 'series' ? c.target.key : c.target.id;
          const st = readState(key);
          const label = c.target.kind === 'series' ? c.target.key
            : c.target.kind === 'pathogen' ? pathogenById(c.target.id)?.pdbId ?? c.target.id
            : bundleById(c.target.id)?.title ?? c.target.id;
          return (
            <div className="mrow" key={c.id}>
              <dt>{c.title}</dt>
              <dd>
                <button
                  className="cellrow" data-cohort-case={c.id}
                  title={`${c.task} (opens ${label})`}
                  onClick={() => openCase(c)}>
                  Open · {label}
                </button>
                {' '}
                <span id={`ro-case-${c.id}`}>D{c.difficulty} · {st.status}{st.locked ? ' · locked' : ''}</span>
                {' '}
                {st.status === 'reading' && (
                  <button className="wl-read-btn" title="Finish the read"
                    onClick={() => {
                      if (markRead(key)) {
                        audit('read.read', key, cohortAuditDetail(cohort.id, c.id, 'read'));
                        setStatus(`read finished: ${c.title}`);
                      } else setStatus(`read flow rejected for ${c.title} (${st.status})`, 'error');
                      bump();
                    }}>Read</button>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="hint" id="cohort-src">{cohort.provenance.join(' · ')}</div>
    </div>
  );
}

/** First directory series carrying images (default picker choice). */
function firstSeriesWithImages(dir: DicomDir): DicomDirSeries | null {  for (const st of dir.studies) {
    for (const se of st.series) {
      if (se.images.length > 0) return se;
    }
  }
  return null;
}

/** Stable picker key for a series (UID preferred, falls back to position). */
function seriesKey(dir: DicomDir, target: DicomDirSeries): string {
  if (target.seriesUID) return target.seriesUID;
  let i = 0;
  for (const st of dir.studies) {
    for (const se of st.series) {
      if (se === target) return `series-${i}`;
      i++;
    }
  }
  return 'series-0';
}

function findSeries(dir: DicomDir, key: string): DicomDirSeries | null {
  let i = 0;
  for (const st of dir.studies) {
    for (const se of st.series) {
      if (se.seriesUID === key || `series-${i}` === key) return se;
      i++;
    }
  }
  return null;
}

/** Read → sign flow per row: status chip + action buttons. The lock is
 *  local-only (no MPPS backend); unlocks are audited like everything else. */
function ReadButtons({ rowKey }: { rowKey: string }): JSX.Element {
  useVersion();
  const st = readState(rowKey);
  const act = (fn: () => unknown, okMsg: string, auditAction: 'read.read' | 'read.sign' | 'read.unlock', detail: string): void => {
    const r = fn();
    if (r) {
      audit(auditAction, rowKey, detail);
      setStatus(okMsg);
    } else {
      setStatus(`read flow rejected for ${rowKey} (${st.status}${st.locked ? ', locked' : ''})`, 'error');
    }
    bump();
  };
  return (
    <span className="wl-read">
      <Chip><span id={`ro-read-${rowKey}`}>{st.status}{st.locked ? ' · locked' : ''}</span></Chip>
      {st.status === 'reading' && (
        <button className="wl-read-btn" title="Finish the read"
          onClick={() => act(() => markRead(rowKey), `read finished: ${rowKey}`, 'read.read', 'read finished')}>Read</button>
      )}
      {st.status === 'read' && !st.locked && (
        <button className="wl-sign" title="Sign the read (locks the row)"
          onClick={() => act(() => signRead(rowKey), `signed: ${rowKey}`, 'read.sign', 'signed read')}>Sign</button>
      )}
      {st.locked && (
        <button className="wl-unlock" title="Unlock a signed row (audited)"
          onClick={() => act(() => unlockRead(rowKey), `unlocked: ${rowKey}`, 'read.unlock', 'unlocked signed row')}>Unlock</button>
      )}
    </span>
  );
}

function WorklistRow({ record: r, available, onOpen, onStats }: {
  record: StudyRecord; available: boolean | undefined; onOpen: () => void; onStats: (patch: Partial<StudyRecord>) => void;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rowRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [thumbState, setThumbState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  // Only rows in the viewport fetch volumes — no 9-way bandwidth stampede.
  useEffect(() => {
    const node = rowRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } },
      { rootMargin: '200px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  // Lazy geometry + bytes + thumbnail. StrictMode-safe: each effect run owns
  // an AbortController, so the remount simply restarts the fetch.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !visible || thumbState === 'done') return;
    const ctrl = new AbortController();
    const signal = ctrl.signal;
    let cancelled = false;
    setThumbState('loading');
    void (async () => {
      try {
        const spec = SERIES[r.key];
        if (!spec) { setThumbState('error'); return; }
        const firstFile = spec.img?.[0] ?? spec.dicom?.[0];
        if (firstFile) {
          try {
            const head = await fetch(firstFile, { method: 'HEAD', signal });
            const len = Number(head.headers.get('content-length'));
            // a 404 page has a length too: it is not the series' size
            if (!cancelled && head.ok && Number.isFinite(len) && len > 0) onStats({ bytes: len });
          } catch { /* size stays unknown */ }
        }
        const vol = await resolveVolume(r.key, signal);
        if (cancelled || signal.aborted) return;
        const [nx, ny, nz] = vol.dims;
        onStats({ dims: vol.dims, spacing: vol.spacing ?? null, voxels: nx * ny * nz });
        const t = renderThumbnail(vol, autoWindow(vol.data), 112);
        cv.width = t.w; cv.height = t.h;
        cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.w, t.h), 0, 0);
        setThumbState('done');
      } catch (e) {
        if (cancelled || signal.aborted || (e as Error)?.name === 'AbortError') return;
        setThumbState('error');
      }
    })();
    return () => { cancelled = true; ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.key, visible]);

  const anonymizeDownload = async (): Promise<void> => {
    const spec = SERIES[r.key];
    if (!spec?.img?.length) {
      // DICOM rows: scrub displayed identity only (pixel export ships in domain 11).
      onStats({ ...anonymizeRecord(r, DEFAULT_PROFILE) });
      toast('Identity scrubbed in worklist');
      return;
    }
    try {
      setStatus(`anonymizing ${r.key}…`);
      const buf = await (await fetch(spec.img[0]!)).arrayBuffer();
      const clean = scrubNiftiDescrip(buf);
      const a = document.createElement('a');
      a.download = `${r.key}-anon.nii`;
      a.href = URL.createObjectURL(new Blob([clean], { type: 'application/octet-stream' }));
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      onStats({ ...anonymizeRecord(r, DEFAULT_PROFILE), bytes: clean.byteLength });
      setStatus(`anonymized ${r.key}`);
      toast('Anonymized .nii saved', 'ok');
    } catch (e) {
      setStatus(`anonymize failed: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <article className="wl-row" ref={rowRef}>
      <canvas ref={canvasRef} className="wl-thumb" width={112} height={112} role="img" aria-label={`${r.key} thumbnail`} />
      <div className="wl-main">
        <div className="wl-title">
          <span className="wl-key">{r.key}</span>
          <Chip>{r.modality}</Chip>
          <Chip>{r.source}</Chip>
          {r.hasSeg && <Chip>seg</Chip>}
          {r.anonymized && <Chip>anonymized</Chip>}
          {available === false && SERIES[r.key] && (() => {
            const hint = missingHint(SERIES[r.key]!);
            return <Chip className="wl-missing" title={hint.title}>{hint.label}</Chip>;
          })()}
        </div>
        <div className="wl-meta">
          <span>{r.patientName ?? 'no identity'} · {r.patientID ?? '—'}</span>
          <span>{r.dims ? `${r.dims[0]}×${r.dims[1]}×${r.dims[2]}` : 'dims on open'} · {r.voxels ? `${r.voxels.toLocaleString()} vox` : ''}</span>
          <span>{r.seriesDescription ?? r.files.length + ' files'} · {fmtBytes(r.bytes)}</span>
        </div>
      </div>
      <div className="wl-actions">
        <button className="wl-open" onClick={() => { markReading(r.key); bump(); onOpen(); }}>Open</button>
        <button className="wl-anon" title="Anonymize (NIfTI downloads a scrubbed copy)" onClick={() => { void anonymizeDownload(); }}>
          Anonymize
        </button>
        <ReadButtons rowKey={r.key} />
      </div>
    </article>
  );
}
