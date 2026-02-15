import { type PluginContext, type SignalSource, RenderMode, type Row, type RowInsert, type Signal } from '@voltex-viewer/plugin-api';
import { TreeEntry, buildTreeFromSources, getDescendantRange } from './treeModel';
import { SignalManagerSidebar } from './signalManagerSidebar';
import { PlaceholderSignalSource } from './placeholderSignal';

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
        onFileDrop: (entry, files) => {
            replaceFileWithSignals(entry, files);
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

    async function replaceFileWithSignals(targetEntry: TreeEntry, files: File[]): Promise<void> {
        const entries = sidebar.getEntries();
        const [startIndex, endIndex] = getDescendantRange(entries, targetEntry);
        if (startIndex === -1) return;

        const oldSignalSources = entries
            .slice(startIndex, endIndex)
            .filter(e => e.signalSource)
            .map(e => e.signalSource!);

        if (oldSignalSources.length === 0) return;

        const oldFileName = targetEntry.name;
        const oldSignalSourceSet = new Set(oldSignalSources);

        const allRows = context.getRows();
        const plottedSignalInfo: { rowIndex: number; signalIndex: number; nameSuffix: string; row: Row }[] = [];
        for (let i = 0; i < allRows.length; i++) {
            const row = allRows[i];
            for (let j = 0; j < row.signals.length; j++) {
                const signal = row.signals[j];
                if (oldSignalSourceSet.has(signal.source)) {
                    const nameSuffix = signal.source.name.slice(1).join('|');
                    plottedSignalInfo.push({ rowIndex: i, signalIndex: j, nameSuffix, row });
                }
            }
        }

        context.signalSources.remove(oldSignalSources);

        const newSources = await context.loadFiles(...files);

        const newSourcesByNameSuffix = new Map<string, SignalSource>();
        for (const source of newSources) {
            const nameSuffix = source.name.slice(1).join('|');
            newSourcesByNameSuffix.set(nameSuffix, source);
        }

        const newFileName = newSources.length > 0 ? newSources[0].name[0] : oldFileName;

        const signalPromises: Promise<Signal>[] = [];
        const signalInfoForPromises: typeof plottedSignalInfo = [];
        for (const info of plottedSignalInfo) {
            const newSource = newSourcesByNameSuffix.get(info.nameSuffix);
            if (newSource) {
                signalPromises.push(newSource.signal());
            } else {
                const placeholderName = [newFileName, ...info.nameSuffix.split('|')];
                const placeholder = new PlaceholderSignalSource(placeholderName);
                signalPromises.push(placeholder.signal());
            }
            signalInfoForPromises.push(info);
        }

        const newSignals = await Promise.all(signalPromises);

        const rowsToRemove: Row[] = [];
        const rowsToAdd: RowInsert[] = [];
        const processedRows = new Set<Row>();

        for (let i = 0; i < signalInfoForPromises.length; i++) {
            const info = signalInfoForPromises[i];

            if (processedRows.has(info.row)) continue;
            processedRows.add(info.row);

            const newChannels = info.row.signals.map((signal, idx) => {
                if (!oldSignalSourceSet.has(signal.source)) return signal;
                const matchingIdx = signalInfoForPromises.findIndex(
                    si => si.row === info.row && si.signalIndex === idx
                );
                return matchingIdx !== -1 ? newSignals[matchingIdx] : signal;
            });

            rowsToRemove.push(info.row);
            const numRemovedBefore = rowsToRemove.length - 1;
            const adjustedIndex = info.rowIndex - numRemovedBefore;
            rowsToAdd.push({
                index: adjustedIndex,
                row: { channels: newChannels, height: info.row.height },
            });
        }

        if (rowsToRemove.length > 0) {
            context.spliceRows(rowsToRemove, rowsToAdd);
        }

        context.requestRender();
    }
};
