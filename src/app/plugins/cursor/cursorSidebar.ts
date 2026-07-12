import type { PluginContext, Signal, Row } from '@voltex-viewer/plugin-api';
import { formatValueForDisplay, signalShift } from '@voltex-viewer/plugin-api';
import type { CursorRenderObject } from './cursorRenderObject';
import type { CursorConfig } from './cursorPlugin';
import { formatInstant } from './timeFormat';

function formatSigned(seconds: number): string {
    return (seconds >= 0 ? '+' : '') + seconds.toFixed(6);
}

export class CursorSidebar {
    private container: HTMLElement | null = null;

    constructor(
        private context: PluginContext,
        private cursors: CursorRenderObject[],
        private onRemoveCursor: (cursor: CursorRenderObject) => void,
        private config: CursorConfig
    ) {}

    render(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'cursor-sidebar-root';
        container.innerHTML = `
            <style>
                .cursor-sidebar-root {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    overflow: hidden;
                }
                .cursor-table-container {
                    flex: 1;
                    overflow: auto;
                    padding: 0;
                }
                .cursor-table {
                    width: 100%;
                    border-collapse: separate;
                    border-spacing: 0;
                    font-size: 12px;
                    background: #1e1e1e;
                    table-layout: fixed;
                }
                .cursor-table th {
                    position: sticky;
                    top: 0;
                    background: #2d2d2d;
                    color: #cccccc;
                    font-weight: 600;
                    text-align: right;
                    padding: 8px;
                    border-bottom: 1px solid #3e3e3e;
                    border-right: 1px solid #3e3e3e;
                    z-index: 10;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .cursor-table th:first-child {
                    position: sticky;
                    left: 0;
                    z-index: 20;
                    background: #2d2d2d;
                    border-right: 1px solid #3e3e3e;
                    text-align: left;
                }
                .cursor-table td {
                    padding: 6px 8px;
                    border-bottom: 1px solid #2d2d2d;
                    border-right: 1px solid #2d2d2d;
                    color: #cccccc;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    text-align: right;
                }
                .cursor-table td:first-child {
                    position: sticky;
                    left: 0;
                    background: #1e1e1e;
                    z-index: 5;
                    border-right: 1px solid #2d2d2d;
                    text-align: left;
                }
                .cursor-table tr:hover td {
                    background: #252526;
                }
                .cursor-table tr:hover td:first-child {
                    background: #252526;
                }
                .cursor-indicator {
                    display: inline-block;
                    width: 10px;
                    height: 10px;
                    border-radius: 2px;
                    margin-right: 6px;
                }
                .cursor-number {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    font-weight: 500;
                    width: 100%;
                }
                .cursor-label {
                    display: flex;
                    align-items: center;
                }
                .cursor-actions {
                    display: flex;
                    align-items: center;
                    gap: 2px;
                }
                .cursor-remove-btn {
                    background: none;
                    border: none;
                    color: #858585;
                    cursor: pointer;
                    padding: 2px 4px;
                    font-size: 14px;
                    line-height: 1;
                    border-radius: 3px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.15s;
                }
                .cursor-remove-btn:hover {
                    background: #ff4444;
                    color: #ffffff;
                }
                .cursor-delta-btn {
                    background: none;
                    border: 1px solid transparent;
                    color: #858585;
                    cursor: pointer;
                    padding: 2px 3px;
                    line-height: 1;
                    border-radius: 3px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.15s;
                }
                .cursor-delta-btn:hover {
                    background: rgba(90, 93, 94, 0.31);
                    color: #cccccc;
                }
                .cursor-delta-btn.active {
                    background: rgba(255, 255, 255, 0.12);
                    color: #ffffff;
                }
                .signal-name {
                    font-family: 'Consolas', 'Monaco', monospace;
                    color: #dcdcaa;
                }
                .signal-value {
                    font-family: 'Consolas', 'Monaco', monospace;
                }
                .timestamp-cell {
                    font-family: 'Consolas', 'Monaco', monospace;
                    color: #9cdcfe;
                }
                .no-cursors {
                    padding: 20px;
                    text-align: center;
                    color: #858585;
                }
            </style>
            <div class="cursor-table-container">
                <div id="cursor-table-content"></div>
            </div>
        `;

        this.container = container;
        this.updateContent();
        return container;
    }

    updateContent(): void {
        if (!this.container) return;

        const contentDiv = this.container.querySelector('#cursor-table-content');
        if (!contentDiv) return;

        if (this.cursors.length === 0) {
            const keybinding = String(this.config.keybindings['add']);
            contentDiv.innerHTML = `<div class="no-cursors">No cursors placed. Press "${keybinding}" to add a cursor.</div>`;
            return;
        }

        const rows = this.context.getRows();
        const signals = this.collectSignals(rows);

        if (signals.length === 0) {
            contentDiv.innerHTML = '<div class="no-cursors">No signals available.</div>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'cursor-table';

        // Calculate column widths
        const signalColumnWidth = this.calculateSignalColumnWidth(signals);
        const cursorColumnWidth = this.calculateCursorColumnWidth();
        
        // Create colgroup for fixed column widths
        const colgroup = document.createElement('colgroup');
        const signalCol = document.createElement('col');
        signalCol.style.width = `${signalColumnWidth}px`;
        colgroup.appendChild(signalCol);
        
        for (let i = 0; i < this.cursors.length; i++) {
            const cursorCol = document.createElement('col');
            cursorCol.style.width = `${cursorColumnWidth}px`;
            colgroup.appendChild(cursorCol);
        }
        table.appendChild(colgroup);

        // Create header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        const signalHeader = document.createElement('th');
        signalHeader.textContent = 'Signal';
        headerRow.appendChild(signalHeader);

        this.cursors.forEach((cursor, cursorIndex) => {
            const cursorHeader = document.createElement('th');
            const deltaButton = cursorIndex === 0 ? '' : `
                        <button class="cursor-delta-btn${cursor.deltaMode ? ' active' : ''}" data-cursor-id="${cursor.getCursorNumber()}" title="Show delta from previous cursor">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
                                <path d="M8 2.5 L14 13.5 H2 Z"/>
                            </svg>
                        </button>`;
            cursorHeader.innerHTML = `
                <div class="cursor-number">
                    <div class="cursor-label">
                        <span class="cursor-indicator" style="background-color: ${cursor.getColor()}"></span>
                        Cursor ${cursor.getCursorNumber()}
                    </div>
                    <div class="cursor-actions">${deltaButton}
                        <button class="cursor-remove-btn" data-cursor-id="${cursor.getCursorNumber()}" title="Remove cursor">×</button>
                    </div>
                </div>
            `;
            headerRow.appendChild(cursorHeader);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Create body
        const tbody = document.createElement('tbody');

        // Add timestamp row
        const { state } = this.context;
        const realtime = state.timeMode === 'realtime';
        const timestampRow = document.createElement('tr');
        const timestampLabel = document.createElement('td');
        timestampLabel.textContent = realtime ? 'Time' : 'Time (s)';
        timestampLabel.className = 'signal-name';
        timestampRow.appendChild(timestampLabel);

        this.cursors.forEach((cursor, cursorIndex) => {
            const timestampCell = document.createElement('td');
            timestampCell.className = 'timestamp-cell';
            const position = cursor.getPosition();
            if (cursor.deltaMode && cursorIndex > 0) {
                const previousPosition = this.cursors[cursorIndex - 1].getPosition();
                timestampCell.textContent = position === null || previousPosition === null
                    ? '-'
                    : formatSigned(position - previousPosition);
            } else {
                timestampCell.textContent = position === null
                    ? '-'
                    : realtime
                        ? formatInstant(state.referenceWallTime + position, state.timeZone)
                        : position.toFixed(6);
            }
            timestampRow.appendChild(timestampCell);
        });
        tbody.appendChild(timestampRow);

        // Add signal rows
        for (const signalInfo of signals) {
            const signalRow = document.createElement('tr');
            
            const nameCell = document.createElement('td');
            nameCell.className = 'signal-name';
            nameCell.textContent = signalInfo.name[signalInfo.name.length - 1] + (signalInfo.signal.values.unit ? ` (${signalInfo.signal.values.unit})` : '');
            signalRow.appendChild(nameCell);

            const display = this.context.signalMetadata.get(signalInfo.signal).display;
            const values = this.cursors.map(cursor => this.getSignalValueAtCursor(signalInfo.signal, cursor));
            values.forEach((value, cursorIndex) => {
                const valueCell = document.createElement('td');
                valueCell.className = 'signal-value';
                if (value === null) {
                    valueCell.textContent = '-';
                } else {
                    const previousValue = this.cursors[cursorIndex].deltaMode && cursorIndex > 0 ? values[cursorIndex - 1] : null;
                    if (typeof value === 'number' && typeof previousValue === 'number') {
                        const delta = value - previousValue;
                        valueCell.textContent = (delta >= 0 ? '+' : '') + formatValueForDisplay(delta, display);
                    } else if (typeof value === 'bigint' && typeof previousValue === 'bigint') {
                        const delta = value - previousValue;
                        valueCell.textContent = (delta >= 0n ? '+' : '') + formatValueForDisplay(delta, display);
                    } else {
                        valueCell.textContent = formatValueForDisplay(value, display);
                    }
                }
                signalRow.appendChild(valueCell);
            });

            tbody.appendChild(signalRow);
        }

        table.appendChild(tbody);
        contentDiv.innerHTML = '';
        contentDiv.appendChild(table);

        // Add event listeners for remove buttons
        const removeButtons = table.querySelectorAll('.cursor-remove-btn');
        removeButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const cursorId = parseInt((e.currentTarget as HTMLElement).getAttribute('data-cursor-id') || '0');
                const cursor = this.cursors.find(c => c.getCursorNumber() === cursorId);
                if (cursor) {
                    this.onRemoveCursor(cursor);
                }
            });
        });

        // Add event listeners for delta toggle buttons
        const deltaButtons = table.querySelectorAll('.cursor-delta-btn');
        deltaButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const cursorId = parseInt((e.currentTarget as HTMLElement).getAttribute('data-cursor-id') || '0');
                const cursor = this.cursors.find(c => c.getCursorNumber() === cursorId);
                if (cursor) {
                    cursor.deltaMode = !cursor.deltaMode;
                    this.updateContent();
                }
            });
        });
    }

    private collectSignals(rows: Row[]): Array<{ name: string[], signal: Signal }> {
        const signals: Array<{ name: string[], signal: Signal }> = [];
        
        for (const row of rows) {
            for (const signal of row.signals) {
                signals.push({
                    name: signal.source.name,
                    signal: signal
                });
            }
        }

        return signals;
    }

    private getSignalValueAtCursor(signal: Signal, cursor: CursorRenderObject): number | bigint | string | null {
        const cursorTime = cursor.getPosition();
        if (cursorTime === null) return null;

        if (signal.time.length === 0) return null;

        // Convert the cursor's internal time to this signal's relative time before searching, so
        // sample-and-hold lands on the right sample when the signal is shifted in real-time mode.
        const shift = signalShift(signal, this.context.state);

        // Find the index at or before the cursor time
        const index = this.binarySearchFloor(signal.time, cursorTime - shift);
        
        // If cursor is before the first sample, return null
        if (index < 0) {
            return null;
        }

        // Return the value at this index (sample-and-hold)
        return signal.values.convertedValueAt 
            ? signal.values.convertedValueAt(index)
            : signal.values.valueAt(index);
    }

    private binarySearchFloor(sequence: { length: number; valueAt(index: number): number }, target: number): number {
        let left = 0;
        let right = sequence.length - 1;
        let result = -1;
        
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const midValue = sequence.valueAt(mid);
            
            if (midValue <= target) {
                result = mid;
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        
        return result;
    }

    private calculateSignalColumnWidth(signals: Array<{ name: string[], signal: Signal }>): number {
        // Calculate the maximum width needed for signal names
        let maxWidth = 100; // Minimum width
        
        for (const signalInfo of signals) {
            const name = signalInfo.name[signalInfo.name.length - 1] || '';
            // Rough estimate: 7 pixels per character
            const width = name.length * 7 + 16; // Add padding
            maxWidth = Math.max(maxWidth, width);
        }
        
        // Also consider the header
        const headerWidth = 'Signal'.length * 7 + 16;
        maxWidth = Math.max(maxWidth, headerWidth);
        
        return Math.min(maxWidth, 300); // Cap at 300px
    }

    private calculateCursorColumnWidth(): number {
        // Fixed width for cursor value columns to prevent jitter
        // Wide enough for timestamps and most numeric values
        return 120;
    }
}
