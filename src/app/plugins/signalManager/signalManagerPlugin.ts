import { type PluginContext, type SignalSource, RenderMode, type Row, type RowInsert, Signal } from '@voltex-viewer/plugin-api'

class TreeEntry {
    expanded: boolean = true;
    searchVisible: boolean = false;
    searchMatches: boolean = false;
    fullPathString: string;
    parent: TreeEntry | null = null; // Reference to parent node

    constructor (public readonly fullPath: string[], public readonly signalSource?: SignalSource)
    {
        this.fullPathString = fullPath.join(' ');
    }

    get name() {
        return this.fullPath[this.fullPath.length - 1];
    }

    get isLeaf() {
        return typeof this.signalSource !== "undefined";
    }

    get depth() {
        return this.fullPath.length;
    }
}

export default (context: PluginContext): void => {
    const signals: TreeEntry[] = [];

    const sidebarContainer = document.createElement('div');
    sidebarContainer.className = 'signal-manager-root';
    sidebarContainer.innerHTML = `
        <style>
            .signal-manager-root {
                display: flex;
                flex-direction: column;
                height: 100%;
                overflow: hidden;
            }
            .signal-manager-container {
                display: flex;
                flex-direction: column;
                height: 100%;
                overflow: hidden;
            }
            .search-container {
                position: relative;
                flex-shrink: 0;
                padding: 0;
                margin-bottom: 8px;
            }
            .search-icon {
                position: absolute;
                left: 10px;
                top: 50%;
                transform: translateY(-35%);
                color: #6b7280;
                font-size: 14px;
                pointer-events: none;
                filter: grayscale(100%);
            }
            .search-input {
                width: 100%;
                padding: 10px 10px 10px 36px;
                background: #2c313a;
                border: 1px solid #444;
                color: #e5e7eb;
                border-radius: 6px;
                font-size: 13px;
                box-sizing: border-box;
            }
            .search-input:focus {
                outline: none;
                border-color: #6366f1;
            }
            .search-input::placeholder {
                color: #6b7280;
            }
            .signal-tree-scroll-container {
                flex: 1;
                overflow-y: auto;
                overflow-x: hidden;
                position: relative;
            }
            .signal-tree-viewport {
                position: relative;
            }
            .signal-tree-spacer {
                width: 1px;
            }
            .signal-item {
                position: absolute;
                left: 0;
                right: 0;
            }
            .signal-item.hidden {
                display: none;
            }
            .tree-node {
                display: flex;
                align-items: center;
                padding: 4px 8px;
                cursor: pointer;
                transition: background-color 0.1s;
                color: #e5e7eb;
                font-size: 13px;
                width: 100%;
                box-sizing: border-box;
                padding-left: calc(8px + var(--indent, 0px));
            }
            .tree-node:hover {
                background: #2a2d3a;
            }
            .tree-node.expandable {
                cursor: pointer;
            }
            .tree-node.leaf {
                cursor: pointer;
            }
            .tree-node.leaf:hover {
                background: #2a2d3a;
            }
            .tree-toggle {
                width: 16px;
                height: 16px;
                margin-right: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }
            .tree-toggle.expanded {
                transform: rotate(90deg);
            }
            .tree-label {
                flex: 1;
                user-select: none;
                white-space: nowrap;
                overflow: visible;
                line-height: 1;
            }
            .tree-label mark {
                background: #fbbf24;
                color: #1f2937;
                padding: 0;
                border-radius: 2px;
                display: inline;
                line-height: inherit;
            }
            .signal-tree-container {
                display: flex;
                flex-direction: column;
            }
            .tree-remove-btn {
                width: 18px;
                height: 18px;
                margin-left: 6px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                color: #9ca3af;
                transition: all 0.1s;
                cursor: pointer;
                border-radius: 3px;
            }
            .tree-remove-btn:hover {
                color: #ef4444;
                background: rgba(239, 68, 68, 0.1);
            }
        </style>
        <div class="signal-manager-container">
            <div class="search-container">
                <div class="search-icon">
                    <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                        <circle cx="6" cy="6" r="3" stroke="#6b7280" stroke-width="1.5" fill="none"/>
                        <line x1="8.5" y1="8.5" x2="12" y2="12" stroke="#6b7280" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                </div>
                <input type="text" id="signal-search" placeholder="Search signals..." class="search-input">
            </div>
            <div class="signal-tree-scroll-container">
                <div class="signal-tree-viewport">
                    <div class="signal-tree-spacer"></div>
                    <div id="signal-tree" class="signal-tree-container">
                    </div>
                </div>
            </div>
        </div>
    `;

    const treeContainer = sidebarContainer.querySelector('#signal-tree') as HTMLElement;
    if (!treeContainer) {
        throw new Error("Failed to find the tree container");
    }

    // Virtual scrolling setup
    const itemHeight = 28;
    const bufferSize = 5;
    const scrollContainer = sidebarContainer.querySelector('.signal-tree-scroll-container') as HTMLElement;
    const treeViewport = sidebarContainer.querySelector('.signal-tree-viewport') as HTMLElement;
    const treeSpacer = sidebarContainer.querySelector('.signal-tree-spacer') as HTMLElement;

    if (!scrollContainer || !treeViewport || !treeSpacer) {
        throw new Error("Failed to find required elements for virtual scrolling");
    }

    scrollContainer.addEventListener('scroll', () => {
        updateVirtualScroll();
    });

    const searchInput = sidebarContainer.querySelector('#signal-search') as HTMLInputElement;
    searchInput.addEventListener('input', (e) => {
        const searchTerm = (e.target as HTMLInputElement).value;
        lastSearchTerm = searchTerm;
        filterSignals(searchTerm);
    });

    searchInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            await plotAllFilteredSignals();
        }
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
        renderContent: () => sidebarContainer,
    });
    
    // Listen for signal source changes
    context.signalSources.changed((event) => {
        // Rebuild the signal tree. The entire tree is rebuilt every time there are signal changes as it is O(n), where
        // n is the number of available sources. It would be possible with extra space to make this O(m) where m is the
        // number added + removed.
        type TreeNode = {
            fullPath: string[];
            children: Map<string, TreeNode>;
            signalSource?: SignalSource;
        };
        const root: TreeNode = {
            fullPath: [],
            children: new Map()
        };
        for (const signalSource of context.signalSources.available) {
            let currentNode = root;
            
            for (let i = 0; i < signalSource.name.length; i++) {
                const pathPart = signalSource.name[i];
                
                if (!currentNode.children.has(pathPart)) {
                    const fullPath = signalSource.name.slice(0, i + 1);
                    const newNode: TreeNode = {
                        fullPath: fullPath,
                        children: new Map(),
                    };
                    
                    // If this is the last part, attach the signal source
                    if (i === signalSource.name.length - 1) {
                        newNode.signalSource = signalSource;
                    }
                    
                    currentNode.children.set(pathPart, newNode);
                }
                
                currentNode = currentNode.children.get(pathPart)!;
            }
        }
        
        signals.length = 0;
        const toVisit: [TreeNode, number, TreeEntry | null][] = Array.from(root.children.entries()).sort((a, b) => naturalCompare(b[0], a[0])).map(v => [v[1], 0, null] as [TreeNode, number, TreeEntry | null]);
        while (toVisit.length > 0) {
            const [node, depth, parent] = toVisit.pop()!;
            const entry = new TreeEntry(node.fullPath, node.signalSource);
            entry.parent = parent;
            signals.push(entry);
            toVisit.push(...Array.from(node.children.entries()).sort((a, b) => naturalCompare(b[0], a[0])).map(v => [v[1], depth + 1, entry] as [TreeNode, number, TreeEntry | null]));
        }

        renderSignalTree();
        
        // Open the sidebar when new signal sources are added
        if (event.added.length > 0 && sidebarEntry) {
            sidebarEntry.open();
            // Recalculate virtual scroll after sidebar opens and DOM settles
            updateVirtualScroll();
        }
    });

    function naturalCompare(a: string, b: string): number {
        const regex = /(\d+)|(\D+)/g;
        const aParts: (string | number)[] = [];
        const bParts: (string | number)[] = [];
        
        let match;
        while ((match = regex.exec(a)) !== null) {
            aParts.push(isNaN(Number(match[0])) ? match[0] : Number(match[0]));
        }
        
        regex.lastIndex = 0;
        while ((match = regex.exec(b)) !== null) {
            bParts.push(isNaN(Number(match[0])) ? match[0] : Number(match[0]));
        }
        
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
            const aPart = aParts[i];
            const bPart = bParts[i];
            
            if (aPart === undefined) return -1;
            if (bPart === undefined) return 1;
            
            if (typeof aPart === 'number' && typeof bPart === 'number') {
                if (aPart !== bPart) return aPart - bPart;
            } else {
                const aStr = String(aPart);
                const bStr = String(bPart);
                if (aStr !== bStr) return aStr.localeCompare(bStr);
            }
        }
        
        return 0;
    }

    function createDomElement(node: TreeEntry, depth: number): HTMLElement {
        const nodeElement = document.createElement('div');
        nodeElement.className = 'signal-item';
        nodeElement.setAttribute('data-signal-path', node.fullPath.join('|').toLowerCase());
        
        const isLeaf = node.isLeaf;
        const hasChildren = !isLeaf
        const isTopLevel = node.fullPath.length == 1;
        
        // Create elements programmatically instead of using innerHTML
        const treeNodeDiv = document.createElement('div');
        treeNodeDiv.className = `tree-node ${isLeaf ? 'leaf' : 'expandable'}`;
        treeNodeDiv.style.setProperty('--indent', `${depth * 12}px`);
        
        // Create toggle element
        const toggleSpan = document.createElement('span');
        toggleSpan.className = 'tree-toggle';
        
        if (hasChildren) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '16');
            svg.setAttribute('height', '16');
            svg.setAttribute('viewBox', '0 0 16 16');
            svg.setAttribute('fill', 'currentColor');
            
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z');
            
            svg.appendChild(path);
            toggleSpan.appendChild(svg);
            
            if (node.expanded) {
                toggleSpan.classList.add('expanded');
            }
        }
        
        // Create label element
        const labelSpan = document.createElement('span');
        labelSpan.className = 'tree-label';
        
        // Apply search highlighting if needed
        if (lastSearchTerm.trim() && node.searchMatches) {
            labelSpan.innerHTML = highlightSearchMatch(node.name, lastSearchTerm);
        } else {
            labelSpan.textContent = node.name;
        }
        
        treeNodeDiv.appendChild(toggleSpan);
        treeNodeDiv.appendChild(labelSpan);

        // Add remove button for top-level nodes with children
        if (isTopLevel && hasChildren) {
            const removeBtn = document.createElement('span');
            removeBtn.className = 'tree-remove-btn';
            removeBtn.title = 'Remove all signals from this source';

            removeBtn.addEventListener('click', (e: MouseEvent) => {
                e.stopPropagation();
                removeSignalSourceAndChildren(node);
            });
            
            const removeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            removeSvg.setAttribute('width', '16');
            removeSvg.setAttribute('height', '16');
            removeSvg.setAttribute('viewBox', '0 0 16 16');
            removeSvg.setAttribute('fill', 'currentColor');
            
            const removePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            removePath.setAttribute('d', 'M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z');
            
            removeSvg.appendChild(removePath);
            removeBtn.appendChild(removeSvg);
            treeNodeDiv.appendChild(removeBtn);
        }
        
        nodeElement.appendChild(treeNodeDiv);
        
        if (hasChildren) {
            treeNodeDiv.addEventListener('click', (e: MouseEvent) => {
                if ((e.target as HTMLElement).closest('.tree-remove-btn')) {
                    return;
                }
                
                if (lastSearchTerm.trim()) {
                    return;
                }
                
                node.expanded = !node.expanded;
                toggleSpan.classList.toggle('expanded', node.expanded);
                
                updateVirtualScroll();
            });
        } else if (isLeaf && node.signalSource) {
            treeNodeDiv.addEventListener('click', () => {
                return addSignalToWaveform(node.signalSource!);
            });
        }
        
        return nodeElement;
    }

    function renderSignalTree(): void {
        updateVirtualScroll();
    }

    function getVisibleNodes(): { node: TreeEntry, index: number, depth: number }[] {
        const visible: { node: TreeEntry, index: number, depth: number }[] = [];
        
        if (lastSearchTerm.trim()) {
            // In search mode, show all searchVisible nodes
            for (let i = 0; i < signals.length; i++) {
                if (signals[i].searchVisible) {
                    visible.push({ node: signals[i], index: i, depth: signals[i].depth });
                }
            }
        } else {
            // Normal mode - respect expand/collapse state
            const ancestorStack: boolean[] = [];
            
            for (let i = 0; i < signals.length; i++) {
                const node = signals[i];
                
                // Adjust stack size to current depth
                ancestorStack.length = node.depth;
                
                // Check if all ancestors are expanded
                const isVisible = ancestorStack.every(expanded => expanded);
                
                if (isVisible) {
                    visible.push({ node, index: i, depth: node.depth });
                }
                
                // Push this node's expansion state for its children
                ancestorStack.push(node.expanded);
            }
        }
        
        return visible;
    }

    function updateVirtualScroll(): void {
        const scrollTop = scrollContainer.scrollTop;
        const containerHeight = scrollContainer.clientHeight;
        
        const visibleNodes = getVisibleNodes();
        
        // Handle empty state
        if (visibleNodes.length === 0) {
            treeSpacer.style.height = '0px';
            treeContainer.innerHTML = '<div style="color: #6b7280; padding: 16px; text-align: center;">No signals found</div>';
            return;
        }
        
        const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - bufferSize);
        const endIndex = Math.min(
            visibleNodes.length,
            Math.ceil((scrollTop + containerHeight) / itemHeight) + bufferSize
        );
        
        const totalHeight = visibleNodes.length * itemHeight;
        treeSpacer.style.height = `${totalHeight}px`;
        
        treeContainer.innerHTML = '';
        
        for (let visibleIndex = startIndex; visibleIndex < endIndex; visibleIndex++) {
            const { node, depth } = visibleNodes[visibleIndex];
            
            const element = createDomElement(node, depth);
            element.style.top = `${visibleIndex * itemHeight}px`;
            treeContainer.appendChild(element);
        }
    }

    function filterSignals(searchTerm: string): void {
        if (!searchTerm.trim()) {
            // No search term - normal tree view
            renderSignalTree();
        } else {
            // Build the tree but mark nodes for visibility based on search
            markTreeNodesForSearch(searchTerm);
            
            // Re-render using virtual scrolling
            updateVirtualScroll();
        }
    }

    function markTreeNodesForSearch(searchTerm: string): boolean {
        // Create regex once, not for every node
        let regex: RegExp | null = null;
        let useLowerCase = false;
        try {
            regex = new RegExp(searchTerm, 'i');
        } catch (_e) {
            // Invalid regex, will fall back to string matching
            useLowerCase = true;
        }
        const lowerSearchTerm = useLowerCase ? searchTerm.toLowerCase() : '';
        
        // First pass: mark only nodes that directly match
        let anyMatch = false;
        for (let i = 0; i < signals.length; i++) {
            const node = signals[i];
            // Use cached fullPathString instead of joining every time
            const nodeMatches = regex 
                ? regex.test(node.fullPathString)
                : node.fullPathString.toLowerCase().includes(lowerSearchTerm);
            
            node.searchVisible = false;
            node.searchMatches = nodeMatches;
            
            if (nodeMatches) {
                anyMatch = true;
            }
        }
        
        // Second pass: mark descendants of matching nodes
        for (let i = 0; i < signals.length; i++) {
            const node = signals[i];
            if (node.searchMatches) {
                node.searchVisible = true;
                
                // Mark all descendants as visible
                const nodeDepth = node.depth;
                for (let j = i + 1; j < signals.length && signals[j].depth > nodeDepth; j++) {
                    signals[j].searchVisible = true;
                }
            }
        }
        
        // Third pass: mark all ancestors of visible nodes - O(n) using parent references
        for (let i = 0; i < signals.length; i++) {
            const node = signals[i];
            if (node.searchVisible) {
                // Walk up the parent chain and mark all ancestors
                let current = node.parent;
                while (current !== null) {
                    if (current.searchVisible) {
                        // Already marked, so all ancestors above are already marked too
                        break;
                    }
                    current.searchVisible = true;
                    current = current.parent;
                }
            }
        }
        
        return anyMatch;
    }

    let lastSearchTerm = '';

    function highlightSearchMatch(text: string, searchTerm: string): string {
        if (!searchTerm.trim()) return text;
        
        try {
            const regex = new RegExp(`(${searchTerm})`, 'gi');
            return text.replace(regex, '<mark>$1</mark>');
        } catch (_e) {
            // If regex is invalid, highlight simple string matches
            const lowerText = text.toLowerCase();
            const lowerSearchTerm = searchTerm.toLowerCase();
            const index = lowerText.indexOf(lowerSearchTerm);
            
            if (index !== -1) {
                const before = text.substring(0, index);
                const match = text.substring(index, index + searchTerm.length);
                const after = text.substring(index + searchTerm.length);
                return `${before}<mark>${match}</mark>${after}`;
            }
            
            return text;
        }
    }


    async function plotAllFilteredSignals() {
        const filteredSignals = lastSearchTerm.trim() ? signals.filter(s => s.searchVisible && typeof s.signalSource !== "undefined").map(s => s.signalSource!) : [];
        
        if (filteredSignals.length === 0) return;

        // First, load all the signals
        const loadedSignals = await Promise.all(filteredSignals.map(x => x.signal()));
        
        // Segregate signals into line signals and all other signals. This is because all the line signals will be plotted
        // on the same axis, and all other types will be plotted on their own axis.
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

    async function addSignalToWaveform(signalSource: SignalSource) {
        function getExistingSignal() {
            for (const row of context.getRows()) {
                for (const signal of row.signals) {
                    if (signal.source === signalSource) {
                        // Signal already present in a row
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
        const removeStart = signals.indexOf(node);
        if (removeStart === -1) {
            return;
        }
        const startDepth = node.depth;
        let removeEnd = removeStart + 1;
        if (signals[removeEnd].depth > startDepth) {
            for (; removeEnd < signals.length; removeEnd++) {
                if (signals[removeEnd].depth <= startDepth) {
                    break;
                }
            }
        }
        
        const signalSourcesToRemove = signals.slice(removeStart, removeEnd).filter(s => typeof s.signalSource !== "undefined").map(s => s.signalSource!);
        
        if (signalSourcesToRemove.length === 0) return;
        
        // Create a Set of signal sources to remove for faster lookup
        const signalSourceSet = new Set(signalSourcesToRemove);
        
        // Process all rows and remove signals
        const allRows = context.getRows();
        const rowsToRemove: Row[] = [];
        const rowsToAdd: RowInsert[] = [];
        
        for (let i = 0; i < allRows.length; i++) {
            const row = allRows[i];
            
            // Filter out signals that are being removed
            const remainingSignals = row.signals.filter(signal => !signalSourceSet.has(signal.source));
            
            // If signals were removed from this row
            if (remainingSignals.length !== row.signals.length) {
                rowsToRemove.push(row);
                
                // Only recreate the row if there are remaining signals
                if (remainingSignals.length > 0) {
                    // Calculate the actual index after accounting for previous removals
                    const numRemovedBefore = rowsToRemove.length - 1;
                    const adjustedIndex = i - numRemovedBefore;
                    
                    rowsToAdd.push({
                        index: adjustedIndex,
                        row: {
                            channels: remainingSignals,
                            height: row.height
                        }
                    });
                }
            }
        }
        
        // Remove the rows and add back the ones with remaining signals
        if (rowsToRemove.length > 0) {
            context.spliceRows(rowsToRemove, rowsToAdd);
        }
        
        // Remove the signal sources
        context.signalSources.remove(signalSourcesToRemove);
    }
}
