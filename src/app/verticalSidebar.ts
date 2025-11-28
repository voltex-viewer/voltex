import { SidebarEntryArgs } from "@voltex-viewer/plugin-api";

export class SidebarEntryImpl {
    readonly icon: HTMLButtonElement;
    readonly panel: HTMLDivElement;
    
    constructor(iconHtml: string, content: string | HTMLElement, private sidebar: VerticalSidebar) {
        this.icon = document.createElement('button');
        this.icon.className = 'sidebar-icon';
        this.icon.innerHTML = iconHtml;
        this.panel = document.createElement('div');
        this.panel.className = 'sidebar-panel';

        if (typeof content === 'string') {
            this.panel.innerHTML = content;
        } else {
            this.panel.appendChild(content);
        }
    }
    
    open(): void {
        this.sidebar.open(this);
    }
}

export class VerticalSidebar {
    private readonly sidebar: HTMLDivElement;
    private readonly entries: SidebarEntryImpl[] = [];
    private readonly panelContainer: HTMLDivElement;
    private readonly iconBar: HTMLDivElement;
    private readonly resizeHandle: HTMLDivElement;
    private readonly minWidth: number = 200;
    private readonly maxWidth: number = 2000;
    private isResizing: boolean = false;

    constructor(root: HTMLElement, private resizeCanvas: () => void) {
        this.sidebar = document.createElement('div');
        this.sidebar.className = 'vertical-sidebar';

        // Panel container
        this.panelContainer = document.createElement('div');
        this.panelContainer.className = 'sidebar-panel-container';
        this.sidebar.appendChild(this.panelContainer);

        // Resize handle
        this.resizeHandle = document.createElement('div');
        this.resizeHandle.className = 'sidebar-resize-handle';
        this.sidebar.appendChild(this.resizeHandle);

        // Icon bar
        this.iconBar = document.createElement('div');
        this.iconBar.className = 'sidebar-icons';
        this.sidebar.appendChild(this.iconBar);

        root.appendChild(this.sidebar);

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
                this.sidebar.style.setProperty('--sidebar-width', `${newWidth}px`);
                this.panelContainer.style.setProperty('--panel-width', `${newWidth - 48}px`);
            }
        });

        document.addEventListener('mouseup', () => {
            if (this.isResizing) {
                this.isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                this.resizeCanvas();
            }
        });
    }

    add(args: SidebarEntryArgs): SidebarEntryImpl {
        const entry = new SidebarEntryImpl(args.iconHtml, args.renderContent(), this);

        this.entries.push(entry);
        this.panelContainer.appendChild(entry.panel);
        this.iconBar.appendChild(entry.icon);

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
            
            this.resizeCanvas();
        });
        
        return entry;
    }

    remove(entry: SidebarEntryImpl): void {
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

    open(entry: SidebarEntryImpl): void {
        this.entries.forEach(e => {
            e.icon.classList.remove('active');
            e.panel.classList.remove('active');
        });
        entry.icon.classList.add('active');
        this.sidebar.classList.add('expanded');
        entry.panel.classList.add('active');
        
        this.resizeCanvas();
    }
}
