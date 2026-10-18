import { render } from '@testing-library/react';
import { useTaskStore } from '@mindwtr/core';
import { afterEach, expect, it, vi } from 'vitest';
import { SandboxSettingsView } from './SandboxSettingsView';

vi.mock('../../contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

const initialState = useTaskStore.getState();
afterEach(() => useTaskStore.setState(initialState, true));

it('shows the stored side-panel presentation in sandbox settings', () => {
    useTaskStore.setState({ settings: { gtd: { taskEditor: { presentation: 'side-panel' } } } });
    const view = render(<SandboxSettingsView />);
    expect(view.getByRole('combobox', { name: 'settings.taskEditorPresentation' })).toHaveValue('side-panel');
});
