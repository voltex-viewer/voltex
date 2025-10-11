// --- Sidebar Entry Classes ---
export abstract class SidebarEntry {
    icon: HTMLButtonElement;
    panel: HTMLDivElement;
    
    constructor(iconHtml: string, private sidebar: VerticalSidebar) {
        this.icon = document.createElement('button');
        this.icon.className = 'sidebar-icon';
        this.icon.innerHTML = iconHtml;
        this.panel = document.createElement('div');
        this.panel.className = 'sidebar-panel';
        this.renderContent();
    }
    abstract renderContent(): void;
    
    open(): void {
        this.sidebar.openEntry(this);
    }
}

export class VerticalSidebar {
    sidebar: HTMLDivElement;
    entries: SidebarEntry[];
    private panelContainer: HTMLDivElement;
    private iconBar: HTMLDivElement;
    private resizeHandle: HTMLDivElement;
    private sidebarWidth: number = 320;
    private minWidth: number = 200;
    private maxWidth: number = 2000;
    private isResizing: boolean = false;

    constructor(root: HTMLElement, private onStateChange: () => void) {
        this.sidebar = document.createElement('div');
        this.sidebar.className = 'vertical-sidebar';

        // Instantiate default entries
        this.entries = [];

        // Panel container
        this.panelContainer = document.createElement('div');
        this.panelContainer.className = 'sidebar-panel-container';
        this.entries.forEach(entry => this.panelContainer.appendChild(entry.panel));
        this.sidebar.appendChild(this.panelContainer);

        // Resize handle
        this.resizeHandle = document.createElement('div');
        this.resizeHandle.className = 'sidebar-resize-handle';
        this.sidebar.appendChild(this.resizeHandle);

        // Icon bar
        this.iconBar = document.createElement('div');
        this.iconBar.className = 'sidebar-icons';
        this.entries.forEach(entry => this.iconBar.appendChild(entry.icon));
        this.sidebar.appendChild(this.iconBar);

        root.appendChild(this.sidebar);

        this.setupEventHandlers();
        this.setupResizeHandlers();
    }

    addDynamicEntry(entry: import('@voltex-viewer/plugin-api').SidebarEntryArgs): SidebarEntry {
        // Create a new SidebarEntry compatible object
        const self = this;
        const dynamicEntry = new class extends SidebarEntry {
            constructor() {
                super(entry.iconHtml, self);
            }
            renderContent() {
                this.panel.innerHTML = '';
                const content = entry.renderContent();
                if (typeof content === 'string') {
                    this.panel.innerHTML = content;
                } else {
                    this.panel.appendChild(content);
                }
            }
        }();

        // Call renderContent to populate the panel
        dynamicEntry.renderContent();

        this.entries.push(dynamicEntry);
        this.panelContainer.appendChild(dynamicEntry.panel);
        this.iconBar.appendChild(dynamicEntry.icon);

        // Add event handler for the new entry
        this.setupEventHandlerForEntry(dynamicEntry);
        
        return dynamicEntry;
    }

    removeDynamicEntry(entry: SidebarEntry): void {
        const entryIndex = this.entries.findIndex(e => e === entry);
        if (entryIndex !== -1) {
            const entryToRemove = this.entries[entryIndex];
            
            // Remove from DOM
            if (entryToRemove.panel.parentNode) {
                entryToRemove.panel.parentNode.removeChild(entryToRemove.panel);
            }
            if (entryToRemove.icon.parentNode) {
                entryToRemove.icon.parentNode.removeChild(entryToRemove.icon);
            }
            
            // Remove from entries array
            this.entries.splice(entryIndex, 1);
            
            // If this was the active entry, close the sidebar
            if (entryToRemove.icon.classList.contains('active')) {
                this.sidebar.classList.remove('expanded');
            }
        }
    }

    private setupEventHandlers(): void {
        this.entries.forEach(entry => this.setupEventHandlerForEntry(entry));
    }

    openEntry(entry: SidebarEntry): void {
        this.entries.forEach(e => {
            e.icon.classList.remove('active');
            e.panel.classList.remove('active');
        });
        entry.icon.classList.add('active');
        this.sidebar.classList.add('expanded');
        entry.panel.classList.add('active');
        
        // Trigger state change callback after a short delay to allow CSS transitions
        setTimeout(() => this.onStateChange(), 50);
    }

    private setupEventHandlerForEntry(entry: SidebarEntry): void {
        entry.icon.addEventListener('click', () => {
            const isActive = entry.icon.classList.contains('active');
            this.entries.forEach(e => {
                e.icon.classList.remove('active');
                e.panel.classList.remove('active');
            });
            if (!isActive) {
                entry.icon.classList.add('active');
                this.sidebar.classList.add('expanded');
                entry.panel.classList.add('active');
            } else {
                this.sidebar.classList.remove('expanded');
            }
            
            // Trigger state change callback after a short delay to allow CSS transitions
            setTimeout(() => this.onStateChange(), 50);
        });
    }

    getSidebarElement() {
        return this.sidebar;
    }

    private setupResizeHandlers(): void {
        this.resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            this.isResizing = true;
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e: MouseEvent) => {
            if (!this.isResizing) return;
            
            const rect = this.sidebar.getBoundingClientRect();
            const newWidth = rect.right - e.clientX;
            
            if (newWidth >= this.minWidth && newWidth <= this.maxWidth) {
                this.sidebarWidth = newWidth;
                this.updateSidebarWidth();
            }
        });

        document.addEventListener('mouseup', () => {
            if (this.isResizing) {
                this.isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                this.onStateChange();
            }
        });
    }

    private updateSidebarWidth(): void {
        this.sidebar.style.width = `${this.sidebarWidth}px`;
        const panelWidth = this.sidebarWidth - 48;
        this.panelContainer.style.width = `${panelWidth}px`;
    }
}
