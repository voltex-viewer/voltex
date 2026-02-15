export interface VirtualListOptions {
    itemHeight: number;
    bufferSize: number;
}

export class VirtualList<T> {
    private items: T[] = [];
    private renderFn: ((item: T, index: number) => HTMLElement) | null = null;
    private readonly scrollContainer: HTMLElement;
    private readonly viewport: HTMLElement;
    private readonly spacer: HTMLElement;
    private readonly listContainer: HTMLElement;

    constructor(
        container: HTMLElement,
        private options: VirtualListOptions
    ) {
        this.scrollContainer = document.createElement('div');
        this.scrollContainer.className = 'virtual-list-scroll-container';

        this.viewport = document.createElement('div');
        this.viewport.className = 'virtual-list-viewport';

        this.spacer = document.createElement('div');
        this.spacer.className = 'virtual-list-spacer';

        this.listContainer = document.createElement('div');
        this.listContainer.className = 'virtual-list-items';

        this.viewport.appendChild(this.spacer);
        this.viewport.appendChild(this.listContainer);
        this.scrollContainer.appendChild(this.viewport);
        container.appendChild(this.scrollContainer);

        this.scrollContainer.addEventListener('scroll', () => this.refresh());
    }

    setItems(items: T[]): void {
        this.items = items;
        this.refresh();
    }

    setRenderFn(fn: (item: T, index: number) => HTMLElement): void {
        this.renderFn = fn;
    }

    refresh(): void {
        if (!this.renderFn) return;

        const { itemHeight, bufferSize } = this.options;
        const scrollTop = this.scrollContainer.scrollTop;
        const containerHeight = this.scrollContainer.clientHeight;

        if (this.items.length === 0) {
            this.spacer.style.height = '0px';
            this.listContainer.innerHTML = '<div class="virtual-list-empty">No signals found</div>';
            return;
        }

        const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - bufferSize);
        const endIndex = Math.min(
            this.items.length,
            Math.ceil((scrollTop + containerHeight) / itemHeight) + bufferSize
        );

        const totalHeight = this.items.length * itemHeight;
        this.spacer.style.height = `${totalHeight}px`;

        this.listContainer.innerHTML = '';

        for (let i = startIndex; i < endIndex; i++) {
            const element = this.renderFn(this.items[i], i);
            element.style.position = 'absolute';
            element.style.top = `${i * itemHeight}px`;
            element.style.left = '0';
            element.style.right = '0';
            this.listContainer.appendChild(element);
        }
    }

    getContainer(): HTMLElement {
        return this.scrollContainer;
    }
}
