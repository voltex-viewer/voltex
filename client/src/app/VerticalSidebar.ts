// --- Sidebar Entry Classes ---
export abstract class SidebarEntry {
    icon: HTMLButtonElement;
    panel: HTMLDivElement;
    constructor(iconHtml: string) {
        this.icon = document.createElement('button');
        this.icon.className = 'sidebar-icon';
        this.icon.innerHTML = iconHtml;
        this.panel = document.createElement('div');
        this.panel.className = 'sidebar-panel';
        this.renderContent();
    }
    abstract renderContent(): void;
}

export class VerticalSidebar {
    sidebar: HTMLDivElement;
    entries: SidebarEntry[];
    private panelContainer: HTMLDivElement;
    private iconBar: HTMLDivElement;

    constructor(root: HTMLElement) {
        this.sidebar = document.createElement('div');
        this.sidebar.className = 'vertical-sidebar';

        // Instantiate default entries
        this.entries = [];

        // Panel container
        this.panelContainer = document.createElement('div');
        this.panelContainer.className = 'sidebar-panel-container';
        this.entries.forEach(entry => this.panelContainer.appendChild(entry.panel));
        this.sidebar.appendChild(this.panelContainer);

        // Icon bar
        this.iconBar = document.createElement('div');
        this.iconBar.className = 'sidebar-icons';
        this.entries.forEach(entry => this.iconBar.appendChild(entry.icon));
        this.sidebar.appendChild(this.iconBar);

        root.appendChild(this.sidebar);

        this.setupEventHandlers();
    }

    addDynamicEntry(entry: import('./Plugin').SidebarEntry): SidebarEntry {
        // Create a new SidebarEntry compatible object
        const dynamicEntry = new class extends SidebarEntry {
            constructor() {
                super(entry.iconHtml);
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
        });
    }

    getSidebarElement() {
        return this.sidebar;
    }
}
