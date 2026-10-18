import { useContext, useEffect, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { TaskEditorPanelContext } from '../../contexts/task-editor-panel-context';
import { Dialog, DialogBody, getDialogFocusableElements } from '../ui/Dialog';

type TaskItemEditorSurfaceProps = {
    editorAriaLabel: string;
    isEditing: boolean;
    isModalEditor: boolean;
    isSidePanelEditor?: boolean;
    closeLabel?: string;
    breadcrumb?: string;
    modalEditorRef: RefObject<HTMLDivElement | null>;
    onCancel: () => void;
    renderDisplay: () => ReactNode;
    renderEditor: () => ReactNode;
};

export function TaskItemEditorSurface({
    editorAriaLabel,
    isEditing,
    isModalEditor,
    isSidePanelEditor = false,
    closeLabel,
    breadcrumb,
    modalEditorRef,
    onCancel,
    renderDisplay,
    renderEditor,
}: TaskItemEditorSurfaceProps) {
    const panelSlot = useContext(TaskEditorPanelContext);
    useEffect(() => {
        if (!isEditing || !isSidePanelEditor || !panelSlot || typeof window.matchMedia !== 'function') return;
        const narrow = window.matchMedia('(max-width: 1279px)');
        const background = Array.from(panelSlot.parentElement?.children ?? [])
            .filter((node): node is HTMLElement => node instanceof HTMLElement && ['MAIN', 'ASIDE'].includes(node.tagName));
        const original = background.map((node) => node.inert);
        const update = () => background.forEach((node, index) => { node.inert = narrow.matches || original[index]; });
        update();
        narrow.addEventListener('change', update);
        return () => {
            narrow.removeEventListener('change', update);
            background.forEach((node, index) => { node.inert = original[index]; });
        };
    }, [isEditing, isSidePanelEditor, panelSlot]);
    return (
        <>
            {isEditing && !isModalEditor && !isSidePanelEditor ? (
                <div className="flex-1 min-w-0">
                    {renderEditor()}
                </div>
            ) : (
                renderDisplay()
            )}
            {isEditing && isSidePanelEditor && createPortal(
                <section role="region" aria-label={editorAriaLabel} tabIndex={-1} ref={modalEditorRef}
                    onKeyDown={(event) => {
                        if (event.key === 'Tab' && !event.defaultPrevented && window.innerWidth < 1280) {
                            const controls = getDialogFocusableElements(modalEditorRef.current).filter((node) => node.getClientRects().length > 0);
                            const target = event.shiftKey ? controls[controls.length - 1] : controls[0];
                            const edge = event.shiftKey ? controls[0] : controls[controls.length - 1];
                            if (target && (document.activeElement === edge || document.activeElement === modalEditorRef.current)) {
                                event.preventDefault();
                                target.focus();
                            }
                        }
                        if (event.key === 'Escape' && !event.defaultPrevented) {
                            event.preventDefault();
                            event.stopPropagation();
                            onCancel();
                        }
                    }}
                    className={panelSlot ? 'flex h-full min-h-0 flex-col border-l border-border bg-card p-6' : 'fixed inset-y-0 right-0 z-30 flex w-full max-w-[560px] flex-col border-l border-border bg-card p-6'}>
                    <div className="mb-5 flex shrink-0 items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span className="min-w-0 truncate">{breadcrumb}</span>
                        <button type="button" aria-label={closeLabel} onClick={onCancel}
                            className="shrink-0 rounded p-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary">
                            <X className="h-5 w-5" aria-hidden="true" />
                        </button>
                    </div>
                    {renderEditor()}
                </section>, panelSlot ?? document.body,
            )}
            {isEditing && isModalEditor && (
                <Dialog
                    onClose={onCancel}
                    label={editorAriaLabel}
                    overlayClassName="p-4"
                    panelClassName="w-[min(1100px,92vw)] max-w-none max-h-[90vh] rounded-xl border-border bg-card"
                    panelRef={modalEditorRef}
                >
                    {/* The form owns scrolling so its action row stays visible (#957). */}
                    <DialogBody className="overflow-hidden p-6">
                        {renderEditor()}
                    </DialogBody>
                </Dialog>
            )}
        </>
    );
}
