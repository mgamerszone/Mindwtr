import { createContext } from 'react';

// A portal keeps project drag-and-drop and keyboard navigation in their existing owner.
export const ProjectSidebarContext = createContext<HTMLElement | null>(null);
