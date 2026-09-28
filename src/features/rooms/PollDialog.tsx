import { useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogClose } from '../../components/Dialog';
import { createPollStart } from '../../matrix/polls';
import './socialDialogs.css';

interface AnswerDraft { id: string; text: string }

export function PollDialog({ roomName, onSend, onClose }: {
  roomName: string;
  onSend: (question: string, answers: string[], disclosed: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<AnswerDraft[]>(() => [0, 1].map(() => ({ id: crypto.randomUUID(), text: '' })));
  const [disclosed, setDisclosed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  let valid = false;
  try { createPollStart(question, answers.map((answer) => answer.text), disclosed); valid = true; } catch { /* Keep the preview disabled until valid. */ }
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current || !valid) return;
    pending.current = true; setBusy(true); setError('');
    try { await onSend(question.trim(), answers.map((answer) => answer.text.trim()), disclosed); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The poll could not be created. Review the answers and retry.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Dialog className="room-dialog poll-dialog" aria-labelledby="poll-dialog-title" onClose={onClose} busy={busy}>
    <header><strong id="poll-dialog-title">Create a poll</strong><DialogClose aria-label="Close"><X size={16} /></DialogClose></header>
    <form onSubmit={(event) => void submit(event)}>
      <p>Ask {roomName} one question. Members can change their vote until the poll ends.</p>
      <label>Question<input maxLength={500} value={question} onChange={(event) => setQuestion(event.target.value)} data-initial-focus /></label>
      <div className="poll-dialog__answers"><strong>Answers</strong>{answers.map((answer, index) => <div key={answer.id}>
        <label><span>Answer {index + 1}</span><input maxLength={200} value={answer.text} onChange={(event) => setAnswers((current) => current.map((item) => item.id === answer.id ? { ...item, text: event.target.value } : item))} /></label>
        {answers.length > 2 ? <button type="button" className="aqua-button" aria-label={`Remove answer ${index + 1}`} onClick={() => setAnswers((current) => current.filter((item) => item.id !== answer.id))}>Remove</button> : null}
      </div>)}</div>
      {answers.length < 20 ? <button type="button" className="aqua-button" onClick={() => setAnswers((current) => [...current, { id: crypto.randomUUID(), text: '' }])}>Add answer</button> : null}
      <label className="room-dialog-check"><input type="checkbox" checked={disclosed} onChange={(event) => setDisclosed(event.target.checked)} /> Show results while voting</label>
      <div className="poll-dialog__preview"><strong>Poll preview</strong><span>{question.trim() || 'Your question'}</span><ol>{answers.map((answer) => <li key={answer.id}>{answer.text.trim() || 'Answer'}</li>)}</ol><small>{disclosed ? 'Live results visible' : 'Results hidden until the poll ends'}</small></div>
      {!valid ? <p className="settings-hint">Enter a question and 2–20 distinct, nonempty answers.</p> : null}
      {error ? <p role="alert" className="settings-error">{error}</p> : null}
      <button className="aqua-button aqua-button--primary" type="submit" disabled={!valid || busy}>{busy ? 'Creating…' : 'Create poll'}</button>
    </form>
  </Dialog>;
}
