import { createContext } from 'react';
import type { MessageSummary } from '../../matrix/viewModels';

export const MediaGalleryContext = createContext<MessageSummary[]>([]);
