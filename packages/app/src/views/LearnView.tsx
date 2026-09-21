import { useState } from 'react';
import type { JSX } from 'react';
import {
  DISEASE_BUNDLES, PATHOGEN_ATTRIBUTION, buildSelfTestBank, gradeSelfTestAnswer,
  installTermTable, installTreeTable, selfTestAuditDetail, shuffled,
  validateTermTable, validateTreeTable,
  bundleById, quizAuditDetail, type SelfTestQuestion,
  buildPlaneDrills, gradePlaneDrill, PLANETRAINER_SERIES,
  type PlaneDrill,
} from '@carys/volume-core';
import {
  gradeTrainerCase, MEASURETRAINER_SERIES, TRAINER_CASES,
  trainerCaseById, type RecistCategory,
} from '@carys/measure';
import { audit, EDUCATION_BADGE } from '@carys/study';
import { setStatus } from '../lib/status';
import { toast } from '../lib/toasts';
import { Chip, DarkSelect, IconBtn } from '../ui/primitives';

// Term/tree install (module scope, once — same pattern as AtlasView):
// the self-test bank needs the K1 tree for parent questions.
let termsReady = false;
async function ensureTerms(): Promise<void> {
  if (termsReady) return;
  const r = await fetch('/digests/bodyparts3d-terms/terms.json');
  if (!r.ok) throw new Error(`terms fetch failed (${r.status})`);
  installTermTable(validateTermTable(await r.json()));
  const tr = await fetch('/digests/bodyparts3d-terms/tree.json');
  if (!tr.ok) throw new Error(`tree fetch failed (${tr.status})`);
  installTreeTable(validateTreeTable(await tr.json()));
  termsReady = true;
}

/** E2 mechanism-of-disease bundles: story + pathway + quiz per bundle,
 *  provenance card per piece. Education pixels only (badged) — the 3D
 *  structures open in the protein view via the bundle's pathogen picker.
 *  Quiz answers log to the audit trail (K4 pattern): zero diagnostic
 *  surface by construction. */
export function LearnView({ onOpenPathogen }: { onOpenPathogen: (id: string) => void }): JSX.Element {
  const [sel, setSel] = useState('ace2-entry');
  // picked option per question id (module-ephemeral like cine flags:
  // answers are attempts, not persisted chrome state).
  const [picks, setPicks] = useState<Record<string, number>>({});
  // revealed rationale per question id (answer first, teaching second).
  const [shown, setShown] = useState<Record<string, boolean>>({});

  const b = bundleById(sel);

  const answer = (qid: string, opt: number): void => {
    const q = b?.quiz.find((x) => x.id === qid);
    if (!q || !b) {
      setStatus(`unknown quiz question: ${qid}`);
      return;
    }
    const correct = opt === q.answer;
    setPicks((p) => ({ ...p, [qid]: opt }));
    setShown((s) => ({ ...s, [qid]: true }));
    audit('quiz.answer', b.pathogenId, quizAuditDetail(b.id, qid, correct, opt));
    toast(correct ? `Correct — ${q.rationale}` : `Not quite — ${q.rationale}`);
    setStatus(`quiz ${b.id}/${qid}: ${correct ? 'correct' : 'wrong'} · attempt logged · ${EDUCATION_BADGE}`);
  };

  const score = b ? b.quiz.filter((q) => picks[q.id] === q.answer).length : 0;
  const answered = b ? b.quiz.filter((q) => picks[q.id] !== undefined).length : 0;

  // K4 self-test: seeded question deck over the atlas + bundle banks.
  // Bank builds once the K1 tables are in; the seed reshuffles in place
  // (reseed = new order, cleared picks). Attempts log as quiz.answer
  // on the selftest series — the same greppable line as the bundle quiz.
  const [deck, setDeck] = useState<SelfTestQuestion[] | null>(null);
  const [seed, setSeed] = useState(17);
  const [cur, setCur] = useState(0);
  const [selfPicks, setSelfPicks] = useState<Record<string, number>>({});
  const [selfErr, setSelfErr] = useState('');

  const startSelfTest = async (s: number): Promise<void> => {
    try {
      await ensureTerms();
      setDeck(shuffled(buildSelfTestBank(), s));
      setSeed(s);
      setCur(0);
      setSelfPicks({});
      setSelfErr('');
      setStatus(`self-test ready · 95 questions · seed ${s} · ${EDUCATION_BADGE}`);
    } catch (e) {
      setSelfErr((e as Error).message);
      setStatus(`self-test failed: ${(e as Error).message}`, 'error');
    }
  };

  const answerSelf = (q: SelfTestQuestion, opt: number): void => {
    const correct = gradeSelfTestAnswer(q, opt);
    setSelfPicks((p) => ({ ...p, [q.id]: opt }));
    audit('quiz.answer', 'selftest', selfTestAuditDetail(q.id, correct, opt));
    toast(correct ? `Correct — ${q.rationale}` : `Not quite — ${q.rationale}`);
    setStatus(`self-test ${q.id}: ${correct ? 'correct' : 'wrong'} · attempt logged · ${EDUCATION_BADGE}`);
  };

  const selfScore = deck ? deck.filter((q) => selfPicks[q.id] === q.answer).length : 0;
  const selfAnswered = deck ? deck.filter((q) => selfPicks[q.id] !== undefined).length : 0;
  const q = deck ? deck[Math.min(cur, deck.length - 1)]! : null;

  return (
    <>
      <div className="view-title" id="title-learn">
        <h1>Learn</h1>
        <p>Mechanism-of-disease bundles · {EDUCATION_BADGE}</p>
      </div>
      <div className="dock" id="dock-learn">
        <div className="grp">
          <span className="lbl">Bundle</span>
          <DarkSelect value={sel} title="Teaching bundle (structure + story + quiz)" ariaLabel="Disease bundle"
            onChange={(v) => {
              if (!bundleById(v)) {
                setStatus(`unknown bundle: ${v}`);
                return;
              }
              setSel(v);
              setPicks({});
              setShown({});
            }}>
            {DISEASE_BUNDLES.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </DarkSelect>
        </div>
        {b && (
          <div className="grp">
            <IconBtn
              title={`Open the ${b.pathogenId} structure in the protein view`}
              onClick={() => onOpenPathogen(b.pathogenId)}>
              Open structure
            </IconBtn>
            <Chip><span id="ro-learn-score">{answered > 0 ? `${score}/${b.quiz.length} correct` : `${b.quiz.length} questions`}</span></Chip>
          </div>
        )}
      </div>
      {b ? (
        <div id="view-learn" className="panes" data-testid="learn">
          <div className="pane" id="pane-learn-story">
            <div className="pane-head"><span className="name">Story</span></div>
            <p className="hint">{b.story}</p>
            <dl className="kv" id="learn-pathway">
              {b.pathway.map((step, i) => (
                <div className="mrow" key={i}>
                  <dt>{i + 1}</dt><dd>{step}</dd>
                </div>
              ))}
            </dl>
            <div className="hint" id="learn-src">{b.provenance.join(' · ')}</div>
            <div className="hint">{PATHOGEN_ATTRIBUTION}</div>
          </div>
          <div className="pane" id="pane-learn-quiz">
            <div className="pane-head"><span className="name">Quiz</span></div>
            <dl className="kv" id="learn-quiz">
              {b.quiz.map((q) => {
                const picked = picks[q.id];
                return (
                  <div className="mrow" key={q.id}>
                    <dt>{q.prompt}</dt>
                    <dd>
                      {q.options.map((opt, i) => (
                        <button
                          key={i} data-quiz={q.id} data-opt={i}
                          className={`cellrow${picked === i && i === q.answer ? ' on' : ''}`}
                          title={shown[q.id] ? q.rationale : `Answer: ${opt}`}
                          aria-pressed={picked === i}
                          onClick={() => answer(q.id, i)}>
                          {opt}
                        </button>
                      ))}
                      {shown[q.id] && picked !== undefined && (
                        <div className="hint" data-why={q.id}>
                          {picked === q.answer ? 'Correct. ' : 'Not quite. '}{q.rationale}
                        </div>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </div>
      ) : (
        <div className="hint">Unknown bundle.</div>
      )}
      <div className="dock" id="dock-selftest">
        <div className="grp">
          <span className="lbl">Self-test</span>
          <IconBtn title="Start the 95-question self-test deck (seeded order)" onClick={() => void startSelfTest(seed)}>Start</IconBtn>
          <IconBtn title="Reshuffle with the next seed (clears picks)" onClick={() => void startSelfTest(seed + 1)}>Reseed</IconBtn>
        </div>
        {deck && q && (
          <div className="grp">
            <Chip><span id="ro-selftest">{`Q${cur + 1}/${deck.length} · ${selfScore}/${deck.length} correct`}</span></Chip>
          </div>
        )}
      </div>
      {selfErr && <div className="hint" id="selftest-err">self-test error: {selfErr}</div>}
      {deck && q && (
        <div id="view-selftest" className="panes" data-testid="selftest">
          <div className="pane" id="pane-selftest">
            <div className="pane-head"><span className="name">Self-test · {q.kind}</span></div>
            <dl className="kv" id="selftest-quiz">
              <div className="mrow">
                <dt>{q.prompt}</dt>
                <dd>
                  {q.options.map((opt, i) => (
                    <button
                      key={i} data-selftest={q.id} data-opt={i}
                      className={`cellrow${selfPicks[q.id] === i && i === q.answer ? ' on' : ''}`}
                      title={selfPicks[q.id] !== undefined ? q.rationale : `Answer: ${opt}`}
                      aria-pressed={selfPicks[q.id] === i}
                      onClick={() => answerSelf(q, i)}>
                      {opt}
                    </button>
                  ))}
                  {selfPicks[q.id] !== undefined && (
                    <div className="hint" data-selfwhy={q.id}>
                      {selfPicks[q.id] === q.answer ? 'Correct. ' : 'Not quite. '}{q.rationale}
                    </div>
                  )}
                </dd>
              </div>
            </dl>
            <div className="hint" id="selftest-prov">{q.provenance}</div>
            <div className="grp">
              <IconBtn title="Previous question" onClick={() => setCur((c) => Math.max(0, c - 1))}>Prev</IconBtn>
              <IconBtn title="Next question" onClick={() => setCur((c) => Math.min(deck.length - 1, c + 1))}>Next</IconBtn>
              {selfAnswered > 0 && (
                <Chip><span id="ro-selftest-score">{`${selfAnswered} answered · ${selfScore} correct`}</span></Chip>
              )}
            </div>
          </div>
        </div>
      )}
      <PlaneTrainerCard />
      <MeasureTrainerCard />
    </>
  );
}

/** E1 plane-anatomy trainer card: 12 drills over the A4 cards, attempts
 *  logged as quiz.answer on the planetrainer series (K4 pattern). */
function PlaneTrainerCard(): JSX.Element {
  const [drills] = useState<PlaneDrill[]>(() => buildPlaneDrills());
  const [cur, setCur] = useState(0);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const d = drills[cur]!;
  const answered = drills.filter((x) => picks[x.id] !== undefined).length;
  const correct = drills.filter((x) => picks[x.id] === x.answer).length;

  const answer = (opt: number): void => {
    const ok = gradePlaneDrill(d, opt);
    setPicks((p) => ({ ...p, [d.id]: opt }));
    audit('quiz.answer', PLANETRAINER_SERIES, quizAuditDetail(PLANETRAINER_SERIES, d.id, ok, opt));
    toast(ok ? `Correct — ${d.rationale}` : `Not quite — ${d.rationale}`);
    setStatus(`plane drill ${d.id}: ${ok ? 'correct' : 'wrong'} · attempt logged · ${EDUCATION_BADGE}`);
  };

  return (
    <>
      <div className="dock" id="dock-planetrainer">
        <div className="grp">
          <span className="lbl">Plane drill</span>
          <Chip><span id="ro-planedrill">{`Q${cur + 1}/${drills.length} · ${correct}/${drills.length} correct`}</span></Chip>
        </div>
      </div>
      <div id="view-planetrainer" className="panes" data-testid="planetrainer">
        <div className="pane" id="pane-planetrainer">
          <div className="pane-head"><span className="name">Plane trainer · {d.plane}</span></div>
          <dl className="kv" id="planetrainer-quiz">
            <div className="mrow">
              <dt>{d.prompt}</dt>
              <dd>
                {d.options.map((opt, i) => (
                  <button
                    key={i} data-pdrill={d.id} data-opt={i}
                    className={`cellrow${picks[d.id] === i && i === d.answer ? ' on' : ''}`}
                    title={picks[d.id] !== undefined ? d.rationale : `Answer: ${opt}`}
                    aria-pressed={picks[d.id] === i}
                    onClick={() => answer(i)}>
                    {opt}
                  </button>
                ))}
                {picks[d.id] !== undefined && (
                  <div className="hint" data-pdwhy={d.id}>
                    {picks[d.id] === d.answer ? 'Correct. ' : 'Not quite. '}{d.rationale}
                  </div>
                )}
              </dd>
            </div>
          </dl>
          <div className="hint" id="planetrainer-prov">A4 plane cards (education only — not for diagnosis)</div>
          <div className="grp">
            <IconBtn title="Previous drill" onClick={() => setCur((c) => Math.max(0, c - 1))}>Prev</IconBtn>
            <IconBtn title="Next drill" onClick={() => setCur((c) => Math.min(drills.length - 1, c + 1))}>Next</IconBtn>
            {answered > 0 && (
              <Chip><span id="ro-planedrill-score">{`${answered} answered · ${correct} correct`}</span></Chip>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** E4 measurement trainer card: known-answer RECIST/length cases with
 *  tolerance bands. The student types their measured sum + picks the
 *  category; the grader compares against the published values. Attempts
 *  log as quiz.answer on the measuretrainer series. */
function MeasureTrainerCard(): JSX.Element {
  const [sel, setSel] = useState(TRAINER_CASES[0]!.id);
  const [typed, setTyped] = useState('');
  const [cat, setCat] = useState<RecistCategory | ''>('');
  const [verdict, setVerdict] = useState<string | null>(null);
  const c = trainerCaseById(sel);

  const check = (): void => {
    if (!c) {
      setStatus(`unknown trainer case: ${sel}`);
      return;
    }
    const measured = Number(typed);
    if (!Number.isFinite(measured)) {
      setStatus(`trainer needs a measured number, got "${typed}"`);
      return;
    }
    if (c.kind === 'recist-sum' && !cat) {
      setStatus('trainer needs a category pick for RECIST cases');
      return;
    }
    let v;
    try {
      v = gradeTrainerCase(c, measured, c.kind === 'recist-sum' ? (cat as RecistCategory) : null);
    } catch (e) {
      setStatus(`trainer grading failed: ${(e as Error).message}`, 'error');
      return;
    }
    const line = `${MEASURETRAINER_SERIES}/${c.id} measured=${measured} ${v.agree ? 'agree' : 'outside'} (published ${v.publishedSum}, diff ${v.diff >= 0 ? '+' : ''}${Math.round(v.diff * 1000) / 1000})`;
    audit('quiz.answer', MEASURETRAINER_SERIES, `quiz ${line} picked=${measured}`);
    setVerdict(v.agree
      ? `Agree — published ${v.publishedSum}mm ±${c.toleranceMm}${c.expectedCategory ? `, ${c.expectedCategory}` : ''}. ${c.provenance}`
      : `Outside band — published ${v.publishedSum}mm ±${c.toleranceMm}${c.expectedCategory ? `, expected ${c.expectedCategory}` : ''} (diff ${Math.round(v.diff * 1000) / 1000}mm). ${c.provenance}`);
    toast(v.agree ? `Agree — ${c.provenance}` : `Outside band — ${c.provenance}`);
    setStatus(`trainer ${c.id}: ${v.agree ? 'agree' : 'outside'} · attempt logged · ${EDUCATION_BADGE}`);
  };

  return (
    <>
      <div className="dock" id="dock-measuretrainer">
        <div className="grp">
          <span className="lbl">Measure drill</span>
          <DarkSelect value={sel} title="Known-answer measurement case" ariaLabel="Trainer case"
            onChange={(v) => {
              if (!trainerCaseById(v)) {
                setStatus(`unknown trainer case: ${v}`);
                return;
              }
              setSel(v);
              setTyped('');
              setCat('');
              setVerdict(null);
            }}>
            {TRAINER_CASES.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </DarkSelect>
        </div>
      </div>
      {c && (
        <div id="view-measuretrainer" className="panes" data-testid="measuretrainer">
          <div className="pane" id="pane-measuretrainer">
            <div className="pane-head"><span className="name">Measure trainer</span></div>
            <p className="hint">{c.task}</p>
            <div className="grp">
              <input id="trainer-measured" className="urlinput" value={typed} placeholder="measured sum in mm"
                title="Your measured sum in mm (compared against the published value ± tolerance)"
                aria-label="Measured sum in mm"
                onChange={(e) => setTyped((e.target as HTMLInputElement).value)} />
              {c.kind === 'recist-sum' && (
                <DarkSelect value={cat} title="RECIST category pick" ariaLabel="Trainer category"
                  onChange={(v) => setCat(v as RecistCategory | '')}>
                  <option value="">—</option>
                  {['CR', 'PR', 'SD', 'PD'].map((k) => <option key={k} value={k}>{k}</option>)}
                </DarkSelect>
              )}
              <IconBtn title="Grade against the published value + tolerance band" onClick={check}>Check</IconBtn>
            </div>
            {verdict && <div className="hint" id="trainer-verdict">{verdict}</div>}
            <div className="hint" id="trainer-prov">{c.provenance} · tolerance ±{c.toleranceMm}mm (education only — not for diagnosis)</div>
          </div>
        </div>
      )}
    </>
  );
}
