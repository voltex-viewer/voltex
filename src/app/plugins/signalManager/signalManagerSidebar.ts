import { TreeEntry, getVisibleEntries, filterBySearch } from './treeModel';
import { createTreeNode, type TreeNodeCallbacks } from './signalTreeRenderer';
import { VirtualList } from './virtualList';
import './signalManager.css';

const itemHeight = 28;
const bufferSize = 5;

export interface SignalManagerCallbacks {
    onToggle: (entry: TreeEntry) => void;
    onLeafClick: (entry: TreeEntry) => void;
    onRemove: (entry: TreeEntry) => void;
    onPlotFiltered: () => void;
}

export class SignalManagerSidebar {
    private container: HTMLElement;
    private virtualList: VirtualList<{ entry: TreeEntry; depth: number }>;
    private entries: TreeEntry[] = [];
    private searchTerm = '';
    private searchInput: HTMLInputElement;

    constructor(private callbacks: SignalManagerCallbacks) {
        this.container = document.createElement('div');
        this.container.className = 'signal-manager-root';

        const innerContainer = document.createElement('div');
        innerContainer.className = 'signal-manager-container';

        const searchContainer = document.createElement('div');
        searchContainer.className = 'search-container';
        searchContainer.innerHTML = `
            <div class="search-icon">
                <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                    <circle cx="6" cy="6" r="3" stroke="#6b7280" stroke-width="1.5" fill="none"/>
                    <line x1="8.5" y1="8.5" x2="12" y2="12" stroke="#6b7280" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            </div>
        `;

        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.placeholder = 'Search signals...';
        this.searchInput.className = 'search-input';
        this.searchInput.addEventListener('input', (e) => {
            this.setSearchTerm((e.target as HTMLInputElement).value);
        });
        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.callbacks.onPlotFiltered();
            }
        });
        searchContainer.appendChild(this.searchInput);

        innerContainer.appendChild(searchContainer);

        const listWrapper = document.createElement('div');
        listWrapper.style.flex = '1';
        listWrapper.style.overflow = 'hidden';
        listWrapper.style.display = 'flex';
        listWrapper.style.flexDirection = 'column';

        this.virtualList = new VirtualList(listWrapper, {
            itemHeight,
            bufferSize,
        });

        const nodeCallbacks: TreeNodeCallbacks = {
            onToggle: (entry) => {
                if (this.searchTerm.trim()) return;
                this.callbacks.onToggle(entry);
                this.refresh();
            },
            onLeafClick: (entry) => this.callbacks.onLeafClick(entry),
            onRemove: (entry) => this.callbacks.onRemove(entry),
        };

        this.virtualList.setRenderFn((item) => {
            return createTreeNode(item.entry, item.depth, this.searchTerm, nodeCallbacks);
        });

        innerContainer.appendChild(listWrapper);
        this.container.appendChild(innerContainer);
    }

    render(): HTMLElement {
        return this.container;
    }

    setEntries(entries: TreeEntry[]): void {
        this.entries = entries;
        this.applyFilter();
        this.refresh();
    }

    getEntries(): TreeEntry[] {
        return this.entries;
    }

    getSearchTerm(): string {
        return this.searchTerm;
    }

    isSearching(): boolean {
        return this.searchTerm.trim().length > 0;
    }

    getFilteredLeafEntries(): TreeEntry[] {
        if (!this.isSearching()) return [];
        return this.entries.filter(e => e.searchVisible && e.isLeaf);
    }

    private setSearchTerm(term: string): void {
        this.searchTerm = term;
        this.applyFilter();
        this.refresh();
    }

    private applyFilter(): void {
        filterBySearch(this.entries, this.searchTerm);
    }

    refresh(): void {
        const visible = getVisibleEntries(this.entries, this.isSearching());
        this.virtualList.setItems(visible);
    }
}
