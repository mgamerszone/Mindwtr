import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore, type Attachment, type Task } from '@mindwtr/core';
import { LanguageProvider } from '../../contexts/language-context';
import { TaskEditorPanelContext } from '../../contexts/task-editor-panel-context';
import { useUiStore } from '../../store/ui-store';
import { CONTEXTS_VIEW_STATE_STORAGE_KEY } from '../../lib/contexts-view-state';
import { importDroppedFileAttachment } from '../../lib/attachment-import';
import { ContextsView } from './ContextsView';
import { SearchView } from './SearchView';
import { AgendaView } from './AgendaView';

const scroll = vi.hoisted(() => ({
    offset: 0,
    listeners: new Set<(offset: number, isScrolling: boolean) => void>(),
}));

// Keep TanStack's real range, keys and mounting behavior; jsdom has no layout.
vi.mock('@tanstack/react-virtual', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@tanstack/react-virtual')>();
    return {
        ...actual,
        useVirtualizer: (options: Parameters<typeof actual.useVirtualizer>[0]) => actual.useVirtualizer({
            ...options,
            observeElementRect: (_instance, callback) => { callback({ width: 1440, height: 600 }); },
            observeElementOffset: (_instance, callback) => {
                scroll.listeners.add(callback);
                callback(scroll.offset, false);
                return () => { scroll.listeners.delete(callback); };
            },
            measureElement: () => 120,
            scrollToFn: () => {},
        }),
    };
});

vi.mock('../../lib/runtime', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../lib/runtime')>(),
    isTauriRuntime: () => true,
}));
vi.mock('../../lib/attachment-import', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../lib/attachment-import')>(),
    importDroppedFileAttachment: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { Data: 1 },
    remove: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
    ...await importOriginal<typeof import('@tauri-apps/api/core')>(),
    convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock('../../lib/app-log', () => ({ logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));

const initialTaskState = useTaskStore.getState();
const initialUiState = useUiStore.getState();
const now = '2026-10-18T12:00:00.000Z';
const scrollTo = (offset: number) => act(() => {
    scroll.offset = offset;
    [...scroll.listeners].forEach((listener) => listener(offset, false));
});

describe('virtualized side-panel draft retention', () => {
    beforeEach(() => {
        window.localStorage.clear();
        scroll.offset = 0;
        scroll.listeners.clear();
        vi.mocked(importDroppedFileAttachment).mockReset();
        useTaskStore.setState(initialTaskState, true);
        useUiStore.setState(initialUiState, true);
    });

    afterEach(() => {
        cleanup();
        document.querySelectorAll('[data-retention-test-panel]').forEach((panel) => panel.remove());
        vi.restoreAllMocks();
    });

    it.each([
        { view: 'contexts', groupBy: 'none', editOffset: 0, awayOffset: 6000 },
        { view: 'contexts', groupBy: 'context', editOffset: 7250, awayOffset: 13000 },
        { view: 'contexts', groupBy: 'tag', editOffset: 7250, awayOffset: 13000 },
        { view: 'search', groupBy: 'none', editOffset: 0, awayOffset: 6000 },
        { view: 'agenda', groupBy: 'none', editOffset: 0, awayOffset: 6000 },
        { view: 'agenda', groupBy: 'context', editOffset: 0, awayOffset: 6000 },
        { view: 'agenda', groupBy: 'tag', editOffset: 0, awayOffset: 6000 },
    ] as const)('keeps the editor and pending image import while typing and scrolling ($view/$groupBy)', async ({ view, groupBy, editOffset, awayOffset }) => {
        const tasks: Task[] = Array.from({ length: 60 }, (_, index) => ({
            id: `draft-${index}`,
            title: `Draft task ${index}`,
            status: 'next',
            order: index,
            contexts: ['@alpha', '@beta'],
            tags: ['#alpha', '#beta'],
            createdAt: now,
            updatedAt: now,
        }));
        useTaskStore.setState({
            _allTasks: tasks,
            projects: [],
            _allProjects: [],
            areas: [],
            _allAreas: [],
            highlightTaskId: null,
            settings: {
                gtd: { taskEditor: { presentation: 'side-panel' } },
                savedSearches: [{ id: 'draft-search', name: 'Drafts', query: 'Draft task' }],
            },
        });
        useUiStore.setState({ listOptions: { ...initialUiState.listOptions, focusGroupBy: groupBy } });
        window.localStorage.setItem(CONTEXTS_VIEW_STATE_STORAGE_KEY, JSON.stringify({ groupBy }));
        const panel = document.createElement('div');
        panel.setAttribute('data-retention-test-panel', '');
        // App's main scroll pane already exists when a view mounts.
        const main = document.createElement('main');
        main.setAttribute('data-main-content', '');
        document.body.append(main, panel);
        const rendered = render(
            <TaskEditorPanelContext.Provider value={panel}>
                <LanguageProvider>
                    {view === 'contexts' ? <ContextsView /> : view === 'search' ? <SearchView savedSearchId="draft-search" /> : <AgendaView />}
                </LanguageProvider>
            </TaskEditorPanelContext.Provider>,
            { container: main },
        );
        scrollTo(editOffset);
        // For Agenda's repeated groups, edit the second occurrence, not the first.
        const rows = rendered.container.querySelectorAll('[data-task-id="draft-0"]');
        const owner = rows[rows.length - 1];
        const neighbors = [...rendered.container.querySelectorAll('[data-task-id="draft-1"]')];
        expect(owner).toBeInTheDocument();
        expect(neighbors.length).toBeGreaterThan(0);
        fireEvent.click(owner.querySelector('[data-task-edit-trigger]')!);
        const editor = within(panel).getByRole('region');
        const title = within(editor).getByDisplayValue('Draft task 0');
        const description = within(editor).getByRole('textbox', { name: 'Task description' }) as HTMLTextAreaElement;
        fireEvent.change(title, { target: { value: 'Unsaved title' } });
        fireEvent.change(description, { target: { value: 'Before' } });
        act(() => description.focus());

        let finishImport!: (result: { attachment: Attachment }) => void;
        vi.mocked(importDroppedFileAttachment).mockImplementationOnce(() => new Promise((resolve) => { finishImport = resolve; }));
        const image = new File(['image'], 'screenshot.png', { type: 'image/png' });
        fireEvent.paste(description, { clipboardData: { items: [], files: [image], getData: () => '' } });
        expect(importDroppedFileAttachment).toHaveBeenCalledOnce();
        expect(within(editor).getByRole('button', { name: /^Save$/ })).toBeDisabled();

        scrollTo(awayOffset);
        neighbors.forEach((neighbor) => expect(neighbor).not.toBeInTheDocument());
        expect(owner).toBeInTheDocument();
        expect(within(panel).getByRole('region')).toBe(editor);
        expect(within(editor).getByDisplayValue('Unsaved title')).toBe(title);
        expect(within(editor).getByRole('textbox', { name: 'Task description' })).toBe(description);
        expect(description).toHaveFocus();
        fireEvent.change(description, { target: { value: 'Before typing during import' } });
        await act(async () => finishImport({ attachment: {
            id: 'draft-image', kind: 'file', title: 'screenshot.png', uri: '/data/screenshot.png',
            mimeType: 'image/png', createdAt: now, updatedAt: now,
        } }));
        expect(description).toHaveValue('Before typing during import![Image](mindwtr://attachment/draft-image)');
        expect(within(editor).getByText('screenshot.png')).toBeInTheDocument();
        expect(within(editor).getByRole('button', { name: /^Save$/ })).toBeEnabled();
        scrollTo(editOffset);
        expect(within(panel).getByRole('region')).toBe(editor);
        expect(within(editor).getByDisplayValue('Unsaved title')).toBe(title);
        expect(within(editor).getByRole('textbox', { name: 'Task description' })).toBe(description);
        expect(useTaskStore.getState()._tasksById.get('draft-0')?.title).toBe('Draft task 0');
        expect(useTaskStore.getState()._tasksById.get('draft-0')?.attachments).toBeUndefined();
        expect(useUiStore.getState().editingTaskId).toBe('draft-0');
        scrollTo(awayOffset);
        fireEvent.click(within(editor).getByRole('button', { name: 'Close' }));
        fireEvent.click(within(within(document.body).getByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Discard' }));
        expect(owner).not.toBeInTheDocument();
        expect(panel).toBeEmptyDOMElement();
        expect(useUiStore.getState().editingTaskId).toBeNull();
        rendered.unmount();
        panel.remove();
    });
});
