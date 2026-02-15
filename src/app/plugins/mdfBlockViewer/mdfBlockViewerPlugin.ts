import { PluginContext, SidebarEntry } from '@voltex-viewer/plugin-api';
import { v4, BufferedFileReader } from '@voltex-viewer/mdf-reader';

interface BlockInfo {
    address: bigint;
    type: string;
    length: bigint;
    data: Record<string, unknown>;
    expanded: boolean;
}

function deserializeBlock(block: v4.GenericBlock): Record<string, unknown> {
    switch (block.type) {
        case '##HD': return { ...v4.deserializeHeader(block) };
        case '##DG': return { ...v4.deserializeDataGroupBlock(block) };
        case '##CG': return { ...v4.deserializeChannelGroupBlock(block) };
        case '##CN': return { ...v4.deserializeChannelBlock(block) };
        case '##TX': return { ...v4.deserializeTextBlock(block) };
        case '##MD': return { ...v4.deserializeMetadataBlock(block) };
        case '##FH': return { ...v4.deserializeFileHistoryBlock(block) };
        case '##CC': return { ...v4.deserializeConversionBlock(block) };
        case '##DL': return { ...v4.deserializeDataListBlock(block) };
        case '##HL': return { ...v4.deserializeHeaderListBlock(block) };
        case '##DT':
        case '##DZ':
            return { dataSize: block.buffer.byteLength };
        default:
            return { links: block.links.map(l => v4.getLink(l)), dataSize: block.buffer.byteLength };
    }
}

function extractLinks(block: v4.GenericBlock): bigint[] {
    return block.links.map(l => v4.getLink(l));
}

function isLink(value: unknown): value is v4.Link<unknown> {
    return typeof value === 'bigint';
}

export default (context: PluginContext): void => {
    let sidebarEntry: SidebarEntry | null = null;
    let blocks: BlockInfo[] = [];
    let blockByAddress: Map<bigint, BlockInfo> = new Map();
    let container: HTMLDivElement | null = null;
    let listContainer: HTMLDivElement | null = null;
    let spacer: HTMLDivElement | null = null;

    const itemHeight = 32;
    const bufferCount = 5;

    function formatAddress(addr: bigint): string {
        return `0x${addr.toString(16).toUpperCase().padStart(8, '0')}`;
    }

    function renderFieldValue(value: unknown, row: HTMLElement): void {
        if (isLink(value)) {
            const addr = v4.getLink(value as v4.Link<unknown>);
            if (addr === 0n) {
                const span = document.createElement('span');
                span.className = 'mdf-block-field-null';
                span.textContent = '<null>';
                row.appendChild(span);
            } else if (blockByAddress.has(addr)) {
                const anchor = document.createElement('a');
                anchor.href = '#';
                anchor.textContent = formatAddress(addr);
                anchor.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    scrollToBlock(addr);
                });
                row.appendChild(anchor);
            } else {
                const span = document.createElement('span');
                span.textContent = formatAddress(addr);
                row.appendChild(span);
            }
        } else if (Array.isArray(value)) {
            const span = document.createElement('span');
            span.className = 'mdf-block-field-value';
            if (value.length > 0 && isLink(value[0])) {
                const links = value.map(v => v4.getLink(v as v4.Link<unknown>));
                span.textContent = `[${links.map(l => l === 0n ? '<null>' : formatAddress(l)).join(', ')}]`;
            } else {
                span.textContent = formatValue(value);
            }
            row.appendChild(span);
        } else {
            const span = document.createElement('span');
            span.className = 'mdf-block-field-value';
            span.textContent = formatValue(value);
            row.appendChild(span);
        }
    }

    function renderExpandedContent(block: BlockInfo): HTMLElement {
        const div = document.createElement('div');
        div.className = 'mdf-block-expanded';

        for (const [name, value] of Object.entries(block.data)) {
            const row = document.createElement('div');
            row.className = 'mdf-block-field';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'mdf-block-field-name';
            nameSpan.textContent = `${name}: `;
            row.appendChild(nameSpan);

            renderFieldValue(value, row);
            div.appendChild(row);
        }

        return div;
    }

    function formatValue(value: unknown): string {
        if (typeof value === 'bigint') {
            if (value > 0xFFFFFFn) {
                return `${value} (${formatAddress(value)})`;
            }
            return value.toString();
        }
        if (typeof value === 'string') {
            return `"${value}"`;
        }
        if (typeof value === 'number') {
            if (Number.isInteger(value)) {
                return value.toString();
            }
            return value.toFixed(6);
        }
        if (Array.isArray(value)) {
            return `[${value.length} items]`;
        }
        if (value === null || value === undefined) {
            return '<null>';
        }
        return String(value);
    }

    function countLines(text: string): number {
        return text.split('\n').length;
    }

    function getFieldHeight(value: unknown): number {
        if (typeof value === 'string' && value.includes('\n')) {
            return 22 * countLines(value);
        }
        return 22;
    }

    function getBlockHeight(block: BlockInfo): number {
        if (!block.expanded) {
            return itemHeight;
        }
        let contentHeight = 0;
        for (const value of Object.values(block.data)) {
            contentHeight += getFieldHeight(value);
        }
        return itemHeight + contentHeight + 16;
    }

    function scrollToBlock(address: bigint): void {
        const index = blocks.findIndex(b => b.address === address);
        if (index === -1 || !listContainer) return;

        let scrollTop = 0;
        for (let i = 0; i < index; i++) {
            scrollTop += getBlockHeight(blocks[i]);
        }
        listContainer.scrollTop = scrollTop;

        blocks[index].expanded = true;
        updateVirtualScroll();

        requestAnimationFrame(() => {
            const element = container?.querySelector(`[data-address="${address}"]`);
            if (element) {
                element.classList.add('mdf-block-highlight');
                setTimeout(() => element.classList.remove('mdf-block-highlight'), 1500);
            }
        });
    }

    function createBlockElement(block: BlockInfo, index: number, topOffset: number): HTMLElement {
        const blockDiv = document.createElement('div');
        blockDiv.className = 'mdf-block' + (block.expanded ? ' expanded' : '');
        blockDiv.setAttribute('data-address', block.address.toString());
        blockDiv.setAttribute('data-index', index.toString());

        const headerDiv = document.createElement('div');
        headerDiv.className = 'mdf-block-header';

        const chevron = document.createElement('span');
        chevron.className = 'mdf-block-chevron';
        chevron.innerHTML = '▶';
        headerDiv.appendChild(chevron);

        const addressSpan = document.createElement('span');
        addressSpan.className = 'mdf-block-address';
        addressSpan.textContent = formatAddress(block.address);
        headerDiv.appendChild(addressSpan);

        const typeSpan = document.createElement('span');
        typeSpan.className = 'mdf-block-type';
        typeSpan.textContent = block.type;
        headerDiv.appendChild(typeSpan);

        if (block.type === '##TX' || block.type === '##MD') {
            const previewSpan = document.createElement('span');
            previewSpan.className = 'mdf-block-preview';
            const text = (block.data.data as string) || '';
            const singleLine = text.replace(/\n/g, ' ');
            previewSpan.textContent = singleLine;
            headerDiv.appendChild(previewSpan);
        } else if (block.type === '##DT' || block.type === '##DZ') {
            const sizeSpan = document.createElement('span');
            sizeSpan.className = 'mdf-block-size';
            sizeSpan.textContent = `(${block.length} bytes)`;
            headerDiv.appendChild(sizeSpan);
        }

        headerDiv.addEventListener('click', () => {
            block.expanded = !block.expanded;
            updateVirtualScroll();
        });

        blockDiv.appendChild(headerDiv);

        if (block.expanded) {
            blockDiv.appendChild(renderExpandedContent(block));
        }

        blockDiv.style.position = 'absolute';
        blockDiv.style.top = `${topOffset}px`;
        blockDiv.style.left = '0';
        blockDiv.style.right = '0';

        return blockDiv;
    }

    function updateVirtualScroll(): void {
        if (!listContainer || !spacer || !container) return;

        const scrollTop = listContainer.scrollTop;
        const viewportHeight = listContainer.clientHeight;

        let totalHeight = 0;
        const blockPositions: { index: number; top: number; height: number }[] = [];
        
        for (let i = 0; i < blocks.length; i++) {
            const height = getBlockHeight(blocks[i]);
            blockPositions.push({ index: i, top: totalHeight, height });
            totalHeight += height;
        }

        spacer.style.height = `${totalHeight}px`;

        const visibleStart = scrollTop - itemHeight * bufferCount;
        const visibleEnd = scrollTop + viewportHeight + itemHeight * bufferCount;

        const blockList = container.querySelector('.mdf-block-list');
        if (!blockList) return;

        blockList.innerHTML = '';

        for (const pos of blockPositions) {
            const blockBottom = pos.top + pos.height;
            if (blockBottom >= visibleStart && pos.top <= visibleEnd) {
                const block = blocks[pos.index];
                const element = createBlockElement(block, pos.index, pos.top);
                blockList.appendChild(element);
            }
        }
    }

    function createContainer(): HTMLElement {
        container = document.createElement('div');
        container.className = 'mdf-block-viewer';
        container.innerHTML = `
            <style>
                .mdf-block-viewer {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    overflow: hidden;
                    font-family: monospace;
                    font-size: 12px;
                }
                .mdf-block-scroll-container {
                    flex: 1;
                    overflow-y: auto;
                    position: relative;
                }
                .mdf-block-spacer {
                    width: 1px;
                    pointer-events: none;
                }
                .mdf-block-list {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                }
                .mdf-block {
                    background: #2a2d3a;
                    border-bottom: 1px solid #444;
                    transition: background-color 0.3s;
                    min-height: ${itemHeight}px;
                    box-sizing: border-box;
                }
                .mdf-block.expanded {
                    min-height: auto;
                }
                .mdf-block-highlight {
                    background: #3a4d5a !important;
                }
                .mdf-block-header {
                    display: flex;
                    align-items: center;
                    padding: 6px 8px;
                    cursor: pointer;
                    gap: 8px;
                    height: ${itemHeight}px;
                    box-sizing: border-box;
                    user-select: none;
                }
                .mdf-block-header:hover {
                    background: #333644;
                }
                .mdf-block-chevron {
                    color: #9ca3af;
                    font-size: 10px;
                    transition: transform 0.15s;
                    width: 12px;
                }
                .mdf-block.expanded .mdf-block-chevron {
                    transform: rotate(90deg);
                }
                .mdf-block-address {
                    color: #fbbf24;
                    font-weight: bold;
                }
                .mdf-block-type {
                    color: #60a5fa;
                    font-weight: bold;
                }
                .mdf-block-size {
                    color: #9ca3af;
                }
                .mdf-block-preview {
                    color: #9ca3af;
                    flex: 1;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .mdf-block-expanded {
                    padding: 8px 8px 8px 28px;
                    border-top: 1px solid #444;
                    background: #1e2028;
                }
                .mdf-block-field {
                    padding: 2px 0;
                    color: #e5e7eb;
                    white-space: pre-wrap;
                    word-break: break-word;
                }
                .mdf-block-field-name {
                    color: #a78bfa;
                }
                .mdf-block-field-value {
                    color: #e5e7eb;
                }
                .mdf-block-field-null {
                    color: #6b7280;
                    font-style: italic;
                }
                .mdf-block-field a {
                    color: #34d399;
                    text-decoration: none;
                }
                .mdf-block-field a:hover {
                    text-decoration: underline;
                }
                .mdf-block-empty {
                    color: #9ca3af;
                    text-align: center;
                    padding: 20px;
                }
            </style>
            <div class="mdf-block-scroll-container">
                <div class="mdf-block-spacer"></div>
                <div class="mdf-block-list">
                    <div class="mdf-block-empty">No MDF file loaded</div>
                </div>
            </div>
        `;

        listContainer = container.querySelector('.mdf-block-scroll-container') as HTMLDivElement;
        spacer = container.querySelector('.mdf-block-spacer') as HTMLDivElement;

        listContainer.addEventListener('scroll', () => {
            updateVirtualScroll();
        });

        return container;
    }

    async function scanBlocks(file: File): Promise<BlockInfo[]> {
        const reader = new BufferedFileReader(file);
        const result: BlockInfo[] = [];
        const visited = new Set<bigint>();
        const toVisit: bigint[] = [64n];

        while (toVisit.length > 0) {
            const address = toVisit.pop()!;
            if (visited.has(address)) continue;
            const link = v4.newLink(address);
            if (!v4.isNonNullLink(link)) continue;
            if (Number(address) >= file.size) continue;
            visited.add(address);

            try {
                const block = await v4.readBlock(link, reader);
                const data = deserializeBlock(block);
                const linkAddresses = extractLinks(block);
                
                const blockInfo: BlockInfo = {
                    address,
                    type: block.type,
                    length: block.length,
                    data,
                    expanded: false,
                };
                result.push(blockInfo);

                for (const linkAddr of linkAddresses) {
                    if (linkAddr !== 0n && !visited.has(linkAddr)) {
                        toVisit.push(linkAddr);
                    }
                }
            } catch {
                // Skip blocks that fail to parse
            }
        }

        result.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
        return result;
    }

    async function loadFile(file: File): Promise<void> {
        blocks = await scanBlocks(file);
        blockByAddress = new Map(blocks.map(b => [b.address, b]));

        if (!sidebarEntry) {
            sidebarEntry = context.addSidebarEntry({
                title: 'MDF Blocks',
                iconHtml: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="7" height="7"/>
                    <rect x="14" y="3" width="7" height="7"/>
                    <rect x="14" y="14" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/>
                </svg>`,
                renderContent: () => createContainer(),
            });
        }

        updateVirtualScroll();
        sidebarEntry.open();
    }

    context.registerFileOpenHandler({
        extensions: ['.mf4', '.mdf'],
        description: 'MDF/MF4 Measurement Files',
        mimeType: '*/*',
        handler: async (file: File) => {
            await loadFile(file);
            return [];
        }
    });
}
