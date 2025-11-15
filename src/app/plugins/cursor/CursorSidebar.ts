import type { PluginContext, Signal, Row } from '@voltex-viewer/plugin-api';
import type { CursorRenderObject } from './CursorRenderObject';
import type { CursorConfig } from './CursorPlugin';

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
            const keybinding = String(this.config.keybindings['cursor.add']);
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

        for (const cursor of this.cursors) {
            const cursorHeader = document.createElement('th');
            cursorHeader.innerHTML = `
                <div class="cursor-number">
                    <div class="cursor-label">
                        <span class="cursor-indicator" style="background-color: ${cursor.getColor()}"></span>
                        Cursor ${cursor.getCursorNumber()}
                    </div>
                    <button class="cursor-remove-btn" data-cursor-id="${cursor.getCursorNumber()}" title="Remove cursor">×</button>
                </div>
            `;
            headerRow.appendChild(cursorHeader);
        }

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Create body
        const tbody = document.createElement('tbody');

        // Add timestamp row
        const timestampRow = document.createElement('tr');
        const timestampLabel = document.createElement('td');
        timestampLabel.textContent = 'Time (s)';
        timestampLabel.className = 'signal-name';
        timestampRow.appendChild(timestampLabel);

        for (const cursor of this.cursors) {
            const timestampCell = document.createElement('td');
            timestampCell.className = 'timestamp-cell';
            const position = cursor.getPosition();
            timestampCell.textContent = position !== null ? position.toFixed(6) : '-';
            timestampRow.appendChild(timestampCell);
        }
        tbody.appendChild(timestampRow);

        // Add signal rows
        for (const signalInfo of signals) {
            const signalRow = document.createElement('tr');
            
            const nameCell = document.createElement('td');
            nameCell.className = 'signal-name';
            nameCell.textContent = signalInfo.name[signalInfo.name.length - 1] || '';
            signalRow.appendChild(nameCell);

            for (const cursor of this.cursors) {
                const valueCell = document.createElement('td');
                valueCell.className = 'signal-value';
                const value = this.getSignalValueAtCursor(signalInfo.signal, cursor);
                valueCell.textContent = value !== null ? this.formatValue(value) : '-';
                signalRow.appendChild(valueCell);
            }

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

    private getSignalValueAtCursor(signal: Signal, cursor: CursorRenderObject): number | string | null {
        const cursorTime = cursor.getPosition();
        if (cursorTime === null) return null;

        if (signal.time.length === 0) return null;

        // Find the index at or before the cursor time
        let index = this.binarySearchFloor(signal.time, cursorTime);
        
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

    private formatValue(value: number | string): string {
        if (typeof value === 'string') {
            return value;
        }
        
        // Format numbers with appropriate precision
        if (Number.isInteger(value)) {
            return value.toString();
        }
        
        // Use scientific notation for very large or very small numbers
        if (Math.abs(value) >= 1e6 || (Math.abs(value) < 1e-3 && value !== 0)) {
            return value.toExponential(3);
        }
        
        return value.toFixed(6);
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
