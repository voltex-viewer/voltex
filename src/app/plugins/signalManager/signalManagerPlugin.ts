import { type PluginContext, type SignalSource, RenderMode, type Row, type RowInsert, type Signal } from '@voltex-viewer/plugin-api';
import { TreeEntry, buildTreeFromSources, getDescendantRange } from './treeModel';
import { SignalManagerSidebar } from './signalManagerSidebar';

export default (context: PluginContext): void => {
    const sidebar = new SignalManagerSidebar({
        onToggle: (entry) => {
            entry.expanded = !entry.expanded;
        },
        onLeafClick: (entry) => {
            if (entry.signalSource) {
                addSignalToWaveform(entry.signalSource);
            }
        },
        onRemove: (entry) => {
            removeSignalSourceAndChildren(entry);
        },
        onPlotFiltered: () => {
            plotAllFilteredSignals();
        },
    });

    const sidebarEntry = context.addSidebarEntry({
        title: 'Signal Manager',
        iconHtml: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="Signal Manager">
            <path d="M3 3v18h18"/>
            <path d="M7 12l3-3 3 3 5-5"/>
            <circle cx="7" cy="12" r="1"/>
            <circle cx="10" cy="9" r="1"/>
            <circle cx="13" cy="12" r="1"/>
            <circle cx="18" cy="7" r="1"/>
        </svg>`,
        renderContent: () => sidebar.render(),
    });

    context.signalSources.changed((event) => {
        const entries = buildTreeFromSources(context.signalSources.available);
        sidebar.setEntries(entries);

        if (event.added.length > 0 && sidebarEntry) {
            sidebarEntry.open();
            sidebar.refresh();
        }
    });

    async function plotAllFilteredSignals(): Promise<void> {
        const filteredEntries = sidebar.getFilteredLeafEntries();
        if (filteredEntries.length === 0) return;

        const loadedSignals = await Promise.all(
            filteredEntries.map(e => e.signalSource!.signal())
        );

        const lineSignals: Signal[] = [];
        const otherSignals: Signal[] = [];
        for (const signal of loadedSignals) {
            if ([RenderMode.Lines, RenderMode.Discrete].includes(signal.renderHint)) {
                lineSignals.push(signal);
            } else {
                otherSignals.push(signal);
            }
        }

        context.createRows(...otherSignals.map(signal => ({ channels: [signal] })));
        if (lineSignals.length > 0) {
            context.createRows({ channels: lineSignals });
        }
    }

    async function addSignalToWaveform(signalSource: SignalSource): Promise<void> {
        function getExistingSignal(): Signal | null {
            for (const row of context.getRows()) {
                for (const signal of row.signals) {
                    if (signal.source === signalSource) {
                        return signal;
                    }
                }
            }
            return null;
        }
        context.createRows({ channels: [getExistingSignal() ?? await signalSource.signal()] });
        context.requestRender();
    }

    function removeSignalSourceAndChildren(node: TreeEntry): void {
        const entries = sidebar.getEntries();
        const [startIndex, endIndex] = getDescendantRange(entries, node);
        if (startIndex === -1) return;

        const signalSourcesToRemove = entries
            .slice(startIndex, endIndex)
            .filter(e => e.signalSource)
            .map(e => e.signalSource!);

        if (signalSourcesToRemove.length === 0) return;

        const signalSourceSet = new Set(signalSourcesToRemove);
        const allRows = context.getRows();
        const rowsToRemove: Row[] = [];
        const rowsToAdd: RowInsert[] = [];

        for (let i = 0; i < allRows.length; i++) {
            const row = allRows[i];
            const remainingSignals = row.signals.filter(signal => !signalSourceSet.has(signal.source));

            if (remainingSignals.length !== row.signals.length) {
                rowsToRemove.push(row);
                if (remainingSignals.length > 0) {
                    const numRemovedBefore = rowsToRemove.length - 1;
                    const adjustedIndex = i - numRemovedBefore;
                    rowsToAdd.push({
                        index: adjustedIndex,
                        row: { channels: remainingSignals, height: row.height },
                    });
                }
            }
        }

        if (rowsToRemove.length > 0) {
            context.spliceRows(rowsToRemove, rowsToAdd);
        }

        context.signalSources.remove(signalSourcesToRemove);
    }
};
