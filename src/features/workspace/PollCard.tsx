import { useContext, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { PollResults } from '../../matrix/polls';
import type { MessageSummary } from '../../matrix/viewModels';
import { PollActionsContext } from './pollContext';
import './pollCard.css';

export function PollCard({ message }: { message: MessageSummary }) {
  const actions = useContext(PollActionsContext);
  const [results, setResults] = useState<PollResults>();
  const [canEnd, setCanEnd] = useState(false);
  const [draftAnswers, setDraftAnswers] = useState<string[]>();
  const [loading, setLoading] = useState(Boolean(actions));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const generation = useRef(0);
  const poll = message.poll;
  useEffect(() => {
    if (!actions || !poll) return;
    let active = true;
    const current = ++generation.current;
    void actions.load(message.roomId, message.id).then((loaded) => {
      if (active && generation.current === current) { setResults(loaded.results); setCanEnd(loaded.canEnd); setLoading(false); }
    }).catch(() => { if (active && generation.current === current) { setError('Poll results could not be loaded. Retry to vote or see current results.'); setLoading(false); } });
    return () => { active = false; };
  }, [actions, message.id, message.roomId, poll]);
  if (!poll) return null;
  const refresh = async () => {
    if (!actions) return;
    const current = ++generation.current;
    setLoading(true); setError('');
    try { const loaded = await actions.load(message.roomId, message.id); if (generation.current === current) { setResults(loaded.results); setCanEnd(loaded.canEnd); setDraftAnswers(undefined); } return true; }
    catch { if (generation.current === current) setError('Poll results could not be refreshed.'); return false; }
    finally { if (generation.current === current) setLoading(false); }
  };
  const vote = async (answerIds: string[]) => {
    if (!actions || busy || loading || !results || results.closed || results.incomplete) return;
    setBusy(true); setError(''); setStatus('Sending vote…');
    try { await actions.vote(message.roomId, message.id, answerIds); if (await refresh()) setStatus('Vote saved.'); else setStatus('Vote sent; refresh results to confirm.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Vote could not be sent.'); setStatus(''); }
    finally { setBusy(false); }
  };
  const end = async () => {
    if (!actions) return;
    setBusy(true); setError('');
    try { await actions.end(message.roomId, message.id); if (await refresh()) setStatus('Poll ended.'); else setStatus('End request sent; refresh results to confirm.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Poll could not be ended.'); throw cause; }
    finally { setBusy(false); }
  };
  const showResults = poll.disclosed || results?.closed;
  const selected = draftAnswers ?? results?.ownAnswers ?? [];
  return <section className="message-poll" aria-label={`Poll: ${poll.question}`}>
    <strong>{poll.question}</strong>
    <small>{results?.closed ? 'Poll ended' : poll.disclosed ? 'Results visible while voting' : 'Results shown when the poll ends'}</small>
    <div className="message-poll__answers">{poll.answers.map((answer) => <button type="button" key={answer.id}
      disabled={!actions || busy || loading || !results || results.closed || results.incomplete}
      aria-pressed={selected.includes(answer.id)}
      onClick={() => {
        if (poll.maxSelections === 1) { void vote([answer.id]); return; }
        setDraftAnswers((current) => {
          const chosen = current ?? results?.ownAnswers ?? [];
          return chosen.includes(answer.id) ? chosen.filter((id) => id !== answer.id)
            : chosen.length < poll.maxSelections ? [...chosen, answer.id] : chosen;
        });
      }}>
      <span>{answer.text}</span>{showResults && results ? <b>{results.counts[answer.id] ?? 0}</b> : null}
    </button>)}</div>
    {showResults && results ? <small>{results.totalVotes} {results.totalVotes === 1 ? 'vote' : 'votes'}{results.incomplete ? ' · Partial results' : ''}</small> : null}
    {loading ? <p role="status">Loading poll results…</p> : null}
    {status ? <p role="status">{status}</p> : null}
    {error ? <p role="alert" className="settings-error">{error}</p> : null}
    {actions ? <div className="message-poll__actions"><button type="button" className="aqua-button" disabled={busy || loading} onClick={() => void refresh()}>Refresh results</button>
      {poll.maxSelections > 1 && !results?.closed ? <button type="button" className="aqua-button" disabled={busy || loading || !draftAnswers?.length || results?.incomplete} onClick={() => void vote(draftAnswers ?? [])}>Save vote</button> : null}
      {canEnd && !results?.closed ? <button type="button" className="aqua-button" disabled={busy || loading || !results || results.incomplete} onClick={() => setConfirmEnd(true)}>End poll</button> : null}</div> : null}
    {confirmEnd ? <ConfirmDialog title="End this poll?" description="Voting will close for everyone. Results will be visible to members after closure." actionLabel="End poll" onConfirm={end} onClose={() => setConfirmEnd(false)} /> : null}
  </section>;
}
