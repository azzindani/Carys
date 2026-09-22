import { useState } from 'react';
import type { JSX } from 'react';
import type { SeriesSummary, StudySummary } from '@carys/dicomweb';
import { DicomWebError } from '@carys/dicomweb';
import { addUploadedSeries } from '../lib/catalog';
import {
  listEndpoints, pacsClient, removeEndpoint, saveEndpoint, type PacsEndpoint,
} from '../lib/pacs';
import { setStatus } from '../lib/status';
import { Chip, DarkSelect } from '../ui/primitives';

function uid(): string {
  return `pacs-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function PacsPanel({ onPull }: { onPull: (key: string) => void }): JSX.Element {
  const [endpoints, setEndpoints] = useState<PacsEndpoint[]>(listEndpoints);
  const [activeId, setActiveId] = useState<string>(() => listEndpoints()[0]?.id ?? '');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [studies, setStudies] = useState<StudySummary[]>([]);
  const [series, setSeries] = useState<{ study: StudySummary; rows: SeriesSummary[] } | null>(null);

  const active = endpoints.find((e) => e.id === activeId) ?? null;

  const addEndpoint = (): void => {
    const url = baseUrl.trim().replace(/\/+$/, '');
    if (!url) return;
    try {
      pacsClient(url); // validates scheme now, not at first request
    } catch (e) {
      setStatus(`bad endpoint: ${(e as Error).message}`);
      return;
    }
    const ep = { id: uid(), name: name.trim() || url, baseUrl: url };
    const next = saveEndpoint(ep);
    setEndpoints(next);
    setActiveId(ep.id);
    setName('');
    setBaseUrl('');
  };

  const search = async (): Promise<void> => {
    if (!active || busy) return;
    setBusy(true);
    setSeries(null);
    try {
      const rows = await pacsClient(active.baseUrl).searchStudies({ patientName: q || undefined });
      setStudies(rows);
      setStatus(`PACS: ${rows.length} studies`);
    } catch (e) {
      setStatus(`PACS search failed: ${e instanceof DicomWebError ? e.message : String(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openStudy = async (st: StudySummary): Promise<void> => {
    if (!active || busy) return;
    setBusy(true);
    try {
      const rows = await pacsClient(active.baseUrl).searchSeries(st.studyUID);
      setSeries({ study: st, rows });
    } catch (e) {
      setStatus(`PACS series failed: ${e instanceof DicomWebError ? e.message : String(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const pull = (st: StudySummary, se: SeriesSummary): void => {
    if (!active) return;
    const key = `pacs: ${st.patientID ?? st.studyUID.slice(-8)} / ${se.seriesDescription ?? se.seriesNumber ?? se.seriesUID.slice(-8)}`;
    addUploadedSeries(key, [129, 140, 248], {
      source: 'upload',
      remote: { endpoint: active.baseUrl, studyUID: st.studyUID, seriesUID: se.seriesUID },
    });
    onPull(key);
  };

  return (
    <div className="pacs">
      <div className="dock" id="dock-pacs">
        <div className="grp">
          <span className="lbl">Endpoint</span>
          <DarkSelect
            value={activeId} title="PACS endpoint" ariaLabel="PACS endpoint"
            onChange={(v) => { setActiveId(v); setStudies([]); setSeries(null); }}
          >
            {endpoints.length === 0 && <option value="">— none yet —</option>}
            {endpoints.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </DarkSelect>
          {active && (
            <button
              className="wl-anon" title="Remove endpoint"
              onClick={() => {
                const next = removeEndpoint(active.id);
                setEndpoints(next);
                setActiveId(next[0]?.id ?? '');
              }}
            >
              Remove
            </button>
          )}
        </div>
        <div className="sep" />
        <div className="grp">
          <input
            className="wl-search wl-search-sm" placeholder="https://pacs/dicom-web" aria-label="New endpoint URL"
            value={baseUrl} onChange={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
          />
          <input
            className="wl-search wl-search-sm" placeholder="Name (optional)" aria-label="New endpoint name"
            value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <button className="wl-open" onClick={addEndpoint}>Add</button>
        </div>
        <div className="sep" />
        <div className="grp">
          <input
            className="wl-search wl-search-sm" placeholder="PatientName search…" aria-label="QIDO patient name"
            value={q} onChange={(e) => setQ((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
          />
          <button className="wl-open" disabled={busy || !active} onClick={() => { void search(); }}>
            {busy ? '…' : 'Search'}
          </button>
        </div>
      </div>

      {studies.length > 0 && (
        <div className="wl-rows">
          {studies.map((st) => (
            <article className="wl-row" key={st.studyUID}>
              <div className="wl-main">
                <div className="wl-title">
                  <span className="wl-key">{st.patientName ?? 'no name'} · {st.patientID ?? '—'}</span>
                  {st.modalities.map((m) => <Chip key={m}>{m}</Chip>)}
                </div>
                <div className="wl-meta">
                  <span>{st.studyDate ?? 'no date'}</span>
                  <span>{st.studyDescription ?? st.studyUID}</span>
                  <span>{st.seriesCount ?? '?'} series · {st.instanceCount ?? '?'} instances</span>
                </div>
              </div>
              <div className="wl-actions">
                <button className="wl-anon" onClick={() => { void openStudy(st); }}>Series</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {series && (
        <div className="wl-rows">
          <div className="view-title"><h1>Series</h1><p>{series.study.studyUID}</p></div>
          {series.rows.map((se) => (
            <article className="wl-row" key={se.seriesUID}>
              <div className="wl-main">
                <div className="wl-title">
                  <span className="wl-key">#{se.seriesNumber ?? '?'} {se.seriesDescription ?? se.seriesUID}</span>
                  {se.modality && <Chip>{se.modality}</Chip>}
                </div>
                <div className="wl-meta"><span>{se.instanceCount ?? '?'} instances</span></div>
              </div>
              <div className="wl-actions">
                <button className="wl-open" onClick={() => pull(series.study, se)}>Pull</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
