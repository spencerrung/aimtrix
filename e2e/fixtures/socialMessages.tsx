/* eslint-disable react-refresh/only-export-components */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocationDialog } from '../../src/features/rooms/LocationDialog';
import { PollDialog } from '../../src/features/rooms/PollDialog';
import { PollCard } from '../../src/features/workspace/PollCard';
import { PollActionsContext } from '../../src/features/workspace/pollContext';
import type { MessageSummary } from '../../src/matrix/viewModels';
import '../../src/styles.css';

const poll = { id: '$poll', roomId: '!room:test', kind: 'poll', body: 'Lunch?',
  poll: { question: 'Lunch?', answers: [{ id: 'soup', text: 'Soup' }, { id: 'salad', text: 'Salad' }], disclosed: true, maxSelections: 2 },
} as MessageSummary;

function Fixture() {
  const [dialog, setDialog] = useState<'poll' | 'location'>();
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  return <main style={{ minHeight: '100dvh', padding: 24, background: 'var(--surface)', color: 'var(--text)' }}>
    <h1>Social messages</h1>
    <button className="aqua-button" onClick={() => setDialog('poll')}>Create a poll</button>{' '}
    <button className="aqua-button" onClick={() => setDialog('location')}>Share a location</button>
    {status ? <p role="status">{status}</p> : null}
    <div style={{ maxWidth: 480, marginTop: 20 }}><PollActionsContext.Provider value={{
      load: async () => ({ definition: poll.poll!, canEnd: false, results: { counts: { soup: 0, salad: 0 }, totalVotes: 0, ownAnswers: selected, closed: false, incomplete: false } }),
      vote: async (_roomId, _pollId, answers) => { setSelected(answers); setStatus(`Voted: ${answers.join(', ')}`); },
      end: async () => {},
    }}><PollCard message={poll} /></PollActionsContext.Provider></div>
    {dialog === 'poll' ? <PollDialog roomName="Welcome" onClose={() => setDialog(undefined)}
      onSend={async (question) => { setStatus(`Created: ${question}`); }} /> : null}
    {dialog === 'location' ? <LocationDialog roomName="Welcome" onClose={() => setDialog(undefined)}
      onSend={async (lat, lon) => { setStatus(`Shared: ${lat},${lon}`); }} /> : null}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
