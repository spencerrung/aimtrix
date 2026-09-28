export const POLL_START = 'org.matrix.msc3381.poll.start';
export const POLL_RESPONSE = 'org.matrix.msc3381.poll.response';
export const POLL_END = 'org.matrix.msc3381.poll.end';
export const POLL_TEXT = 'org.matrix.msc1767.text';
export const POLL_DISCLOSED = 'org.matrix.msc3381.poll.disclosed';

export interface PollDefinition {
  question: string;
  answers: Array<{ id: string; text: string }>;
  disclosed: boolean;
  maxSelections: number;
}

export interface PollRelation {
  id: string;
  type: string;
  senderId: string;
  timestamp: number;
  content: Record<string, unknown>;
  redacted?: boolean;
  canEnd?: boolean;
}

export interface PollResults {
  counts: Record<string, number>;
  totalVotes: number;
  ownAnswers: string[];
  closed: boolean;
  endEventId?: string;
  incomplete: boolean;
}

function textBlock(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const block = value as Record<string, unknown>;
  const legacy = block['m.text'];
  const candidate = block[POLL_TEXT] ?? (typeof legacy === 'string' ? legacy : Array.isArray(legacy) ? (legacy[0] as Record<string, unknown> | undefined)?.body : undefined);
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

export function parsePollStart(type: string, content: Record<string, unknown>): PollDefinition | undefined {
  if (type !== POLL_START && type !== 'm.poll.start') return undefined;
  const raw = content[POLL_START] ?? content['m.poll.start'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const poll = raw as Record<string, unknown>;
  const question = textBlock(poll.question);
  if (!question || question.length > 500 || !Array.isArray(poll.answers) || poll.answers.length < 2 || poll.answers.length > 20) return undefined;
  const answers = poll.answers.map((answer): { id: string; text: string } | undefined => {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return undefined;
    const value = answer as Record<string, unknown>;
    const id = value.id ?? value['m.id'];
    const text = textBlock(value);
    return typeof id === 'string' && id.length > 0 && id.length <= 128 && text && text.length <= 200 ? { id, text } : undefined;
  });
  if (answers.some((answer) => !answer)) return undefined;
  const validAnswers = answers as Array<{ id: string; text: string }>;
  if (new Set(validAnswers.map((answer) => answer.id)).size !== validAnswers.length) return undefined;
  const requested = poll.max_selections;
  const maxSelections = Number.isInteger(requested) && (requested as number) >= 1 && (requested as number) <= validAnswers.length ? requested as number : 1;
  return { question, answers: validAnswers, maxSelections, disclosed: poll.kind === POLL_DISCLOSED || poll.kind === 'm.poll.disclosed' };
}

export function createPollStart(question: string, options: string[], disclosed: boolean): { type: string; content: Record<string, unknown> } {
  const normalizedQuestion = question.trim();
  const answers = options.map((option) => option.trim());
  if (!normalizedQuestion || normalizedQuestion.length > 500 || answers.length < 2 || answers.length > 20 ||
    answers.some((answer) => !answer || answer.length > 200) || new Set(answers.map((answer) => answer.toLocaleLowerCase())).size !== answers.length) {
    throw new Error('Enter a question and 2–20 distinct answers within the length limits.');
  }
  return {
    type: POLL_START,
    content: {
      [POLL_TEXT]: `${normalizedQuestion}\n${answers.map((answer, index) => `${index + 1}. ${answer}`).join('\n')}`,
      [POLL_START]: {
        question: { [POLL_TEXT]: normalizedQuestion },
        kind: disclosed ? POLL_DISCLOSED : 'org.matrix.msc3381.poll.undisclosed',
        max_selections: 1,
        answers: answers.map((answer) => ({ id: crypto.randomUUID(), [POLL_TEXT]: answer })),
      },
    },
  };
}

function relationTargets(content: Record<string, unknown>, pollId: string): boolean {
  const relation = content['m.relates_to'];
  return Boolean(relation && typeof relation === 'object' && !Array.isArray(relation) &&
    (relation as Record<string, unknown>).rel_type === 'm.reference' && (relation as Record<string, unknown>).event_id === pollId);
}

function validPollEnd(event: PollRelation): boolean {
  if (event.type !== POLL_END && event.type !== 'm.poll.end') return false;
  const payload = event.content[POLL_END] ?? event.content['m.poll.end'];
  return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && textBlock(event.content));
}

export function aggregatePoll(definition: PollDefinition, pollId: string, ownUserId: string, relations: PollRelation[], incomplete = false): PollResults {
  const linked = relations.filter((event) => !event.redacted && relationTargets(event.content, pollId));
  const order = (left: PollRelation, right: PollRelation) => left.timestamp - right.timestamp || left.id.localeCompare(right.id);
  const end = linked.filter((event) => event.canEnd && validPollEnd(event)).sort(order)[0];
  const validIds = new Set(definition.answers.map((answer) => answer.id));
  const latest = new Map<string, PollRelation>();
  for (const event of linked) {
    if (event.type !== POLL_RESPONSE && event.type !== 'm.poll.response' || end && event.timestamp > end.timestamp) continue;
    const previous = latest.get(event.senderId);
    if (!previous || order(previous, event) < 0) latest.set(event.senderId, event);
  }
  const counts = Object.fromEntries(definition.answers.map((answer) => [answer.id, 0]));
  let totalVotes = 0;
  let ownAnswers: string[] = [];
  for (const [senderId, event] of latest) {
    const response = event.content[POLL_RESPONSE] ?? event.content['m.poll.response'];
    const raw = response && typeof response === 'object' && !Array.isArray(response) ? (response as Record<string, unknown>).answers : undefined;
    const answers = Array.isArray(raw) && raw.every((id) => typeof id === 'string' && validIds.has(id))
      ? [...new Set(raw as string[])].slice(0, definition.maxSelections) : [];
    if (senderId === ownUserId) ownAnswers = answers;
    if (!answers.length) continue;
    totalVotes += 1;
    for (const answer of answers) counts[answer] += 1;
  }
  return { counts, totalVotes, ownAnswers, closed: Boolean(end), endEventId: end?.id, incomplete };
}
