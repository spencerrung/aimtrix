import { createContext } from 'react';
import type { PollDefinition, PollResults } from '../../matrix/polls';

export interface PollActions {
  load: (roomId: string, pollId: string) => Promise<{ definition: PollDefinition; results: PollResults; canEnd: boolean }>;
  vote: (roomId: string, pollId: string, answerIds: string[]) => Promise<void>;
  end: (roomId: string, pollId: string) => Promise<void>;
}

export const PollActionsContext = createContext<PollActions | undefined>(undefined);
