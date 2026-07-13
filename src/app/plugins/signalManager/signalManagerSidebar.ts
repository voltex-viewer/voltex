import { TreeEntry, type SearchOptions, getVisibleEntries, filterBySearch } from './treeModel';
import { createTreeNode, type TreeNodeCallbacks } from './signalTreeRenderer';
import { VirtualList } from './virtualList';
import './signalManager.css';

const itemHeight = 28;
const bufferSize = 5;

const searchOptionIcons: Record<keyof SearchOptions, { title: string; svg: string }> = {
    caseSensitive: {
        title: 'Match Case',
        svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><text x="0.5" y="12" font-size="11" font-weight="600">A</text><text x="8.5" y="12" font-size="10">a</text></svg>`,
    },
    wholeWord: {
        title: 'Match Whole Word',
        svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><text x="2" y="10.5" font-size="10">ab</text><path d="M1 12.5h14v1H1z"/></svg>`,
    },
    useRegex: {
        title: 'Use Regular Expression',
        svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><text x="2" y="13" font-size="13" font-weight="600">.*</text></svg>`,
    },
};

export interface SignalManagerCallbacks {
    onToggle: (entry: TreeEntry) => void;
    onLeafClick: (entry: TreeEntry) => void;
    onRemove: (entry: TreeEntry) => void;
    onPlotFiltered: () => void;
    onFileDrop: (targetEntry: TreeEntry, files: File[]) => void;
    onSearchOptionsChanged: (options: SearchOptions) => void;
}

export class SignalManagerSidebar {
    private container: HTMLElement;
    private virtualList: VirtualList<{ entry: TreeEntry; depth: number }>;
    private entries: TreeEntry[] = [];
    private searchTerm = '';
    private searchInput: HTMLTextAreaElement;
    private searchOptions: SearchOptions;
    private optionButtons: { key: keyof SearchOptions; button: HTMLButtonElement }[] = [];

    constructor(private callbacks: SignalManagerCallbacks, initialSearchOptions: SearchOptions) {
        this.searchOptions = { ...initialSearchOptions };
        this.container = document.createElement('div');
        this.container.className = 'signal-manager-root';

        const innerContainer = document.createElement('div');
        innerContainer.className = 'signal-manager-container';

        const searchContainer = document.createElement('div');
        searchContainer.className = 'search-container';

        this.searchInput = document.createElement('textarea');
        this.searchInput.rows = 1;
        this.searchInput.placeholder = 'Search signals...';
        this.searchInput.className = 'search-input';
        this.searchInput.addEventListener('input', () => {
            // Grow/shrink with the wrapped content (+2 for the 1px borders)
            this.searchInput.style.height = 'auto';
            this.searchInput.style.height = `${this.searchInput.scrollHeight + 2}px`;
            this.setSearchTerm(this.searchInput.value);
        });
        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.callbacks.onPlotFiltered();
            }
        });
        searchContainer.appendChild(this.searchInput);

        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'search-options';
        for (const key of Object.keys(searchOptionIcons) as (keyof SearchOptions)[]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'search-option-btn';
            button.title = searchOptionIcons[key].title;
            button.innerHTML = searchOptionIcons[key].svg;
            button.classList.toggle('active', this.searchOptions[key]);
            // Keep focus in the search input when toggling an option
            button.addEventListener('mousedown', (e) => e.preventDefault());
            button.addEventListener('click', () => {
                this.searchOptions[key] = !this.searchOptions[key];
                button.classList.toggle('active', this.searchOptions[key]);
                this.applyFilter();
                this.refresh();
                this.callbacks.onSearchOptionsChanged({ ...this.searchOptions });
            });
            optionsContainer.appendChild(button);
            this.optionButtons.push({ key, button });
        }
        searchContainer.appendChild(optionsContainer);

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
                this.callbacks.onToggle(entry);
                this.refresh();
            },
            onLeafClick: (entry) => this.callbacks.onLeafClick(entry),
            onRemove: (entry) => this.callbacks.onRemove(entry),
            onFileDrop: (entry, files) => this.callbacks.onFileDrop(entry, files),
        };

        this.virtualList.setRenderFn((item) => {
            return createTreeNode(item.entry, item.depth, this.searchTerm, this.searchOptions, nodeCallbacks);
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

    setSearchOptions(options: SearchOptions): void {
        this.searchOptions = { ...options };
        for (const { key, button } of this.optionButtons) {
            button.classList.toggle('active', this.searchOptions[key]);
        }
        this.applyFilter();
        this.refresh();
    }

    private applyFilter(): void {
        filterBySearch(this.entries, this.searchTerm, this.searchOptions);
    }

    refresh(): void {
        const visible = getVisibleEntries(this.entries, this.isSearching());
        this.virtualList.setItems(visible);
    }
}
