import { type PluginContext, type SignalSource, type SidebarEntry, RenderMode, type Row, type RowInsert } from '@voltex-viewer/plugin-api'

let context: PluginContext | undefined;
let sidebarContainer: HTMLElement | undefined;
let availableSignalSources: SignalSource[] = [];

// DOM caching system
interface CachedDOMElement {
    element: HTMLElement;
    node: TreeNode;
    isVisible: boolean;
    eventListeners: (() => void)[];
}

const domCache = new Map<string, CachedDOMElement>();
let isDOMCacheValid = false;
let cachedTree: TreeNode | undefined;
const expansionState = new Map<string, boolean>();

export default (pluginContext: PluginContext): void => {
    context = pluginContext;
    
    // Initialize available signal sources
    availableSignalSources = context.signalSources.available;
    
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
        renderContent: renderContent
    });
    
    // Listen for signal source changes
    context.signalSources.changed((event) => {
        availableSignalSources = context.signalSources.available;
        invalidateDOMCache();
        refreshSignalList();
        
        // Open the sidebar when new signal sources are added
        if (event.added.length > 0 && sidebarEntry) {
            sidebarEntry.open();
        }
    });
}

function renderContent(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'signal-manager-root';
    container.innerHTML = `
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
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
            }
            .signal-item {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
                <div id="signal-tree" class="signal-tree-container">
                </div>
            </div>
        </div>
    `;

    sidebarContainer = container;
    renderSignalTree();

    const searchInput = container.querySelector('#signal-search') as HTMLInputElement;
    searchInput.addEventListener('input', (e) => {
        const searchTerm = (e.target as HTMLInputElement).value;
        lastSearchTerm = searchTerm;
        filterSignals(searchTerm);
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            plotAllFilteredSignals();
        }
    });

    return container;
}

interface TreeNode {
    name: string;
    fullPath: string[];
    children: Map<string, TreeNode>;
    signalSource?: SignalSource;
}

function isNodeExpanded(node: TreeNode): boolean {
    const pathKey = node.fullPath.join('|');
    return expansionState.has(pathKey) ? expansionState.get(pathKey)! : true;
}

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

function getSortedChildren(node: TreeNode): [string, TreeNode][] {
    return Array.from(node.children.entries()).sort((a, b) => naturalCompare(a[0], b[0]));
}

function buildSignalTree(): TreeNode {
    const root: TreeNode = {
        name: 'root',
        fullPath: [],
        children: new Map()
    };

    for (const signalSource of availableSignalSources) {
        let currentNode = root;
        
        for (let i = 0; i < signalSource.name.length; i++) {
            const pathPart = signalSource.name[i];
            
            if (!currentNode.children.has(pathPart)) {
                const fullPath = signalSource.name.slice(0, i + 1);
                const newNode: TreeNode = {
                    name: pathPart,
                    fullPath: fullPath,
                    children: new Map()
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

    return root;
}

function getSignalTree(): TreeNode {
    if (!cachedTree) {
        cachedTree = buildSignalTree();
    }
    return cachedTree;
}

// DOM Cache Management Functions
function invalidateDOMCache(): void {
    // Clean up event listeners
    for (const cached of domCache.values()) {
        cached.eventListeners.forEach(cleanup => cleanup());
    }
    domCache.clear();
    isDOMCacheValid = false;
    cachedTree = undefined; // Invalidate tree cache when signals change
}

function createDOMElement(node: TreeNode, depth: number): CachedDOMElement {
    const nodeElement = document.createElement('div');
    nodeElement.className = 'signal-item';
    nodeElement.setAttribute('data-signal-path', node.fullPath.join('|').toLowerCase());
    
    const isLeaf = node.children.size === 0;
    const hasChildren = node.children.size > 0;
    const isTopLevel = depth === 0;
    
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
        
        if (isNodeExpanded(node)) {
            toggleSpan.classList.add('expanded');
        }
    }
    
    // Create label element
    const labelSpan = document.createElement('span');
    labelSpan.className = 'tree-label';
    labelSpan.textContent = node.name;
    
    treeNodeDiv.appendChild(toggleSpan);
    treeNodeDiv.appendChild(labelSpan);
    
    // Add remove button for top-level nodes with children
    if (isTopLevel && hasChildren) {
        const removeBtn = document.createElement('span');
        removeBtn.className = 'tree-remove-btn';
        removeBtn.title = 'Remove all signals from this source';
        
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
    
    // Set up event listeners and track cleanup functions
    const eventListeners: (() => void)[] = [];
    
    if (hasChildren) {
        const toggleFunction = (e: MouseEvent) => {
            // Don't toggle if clicking the remove button
            if ((e.target as HTMLElement).closest('.tree-remove-btn')) {
                return;
            }
            
            const pathKey = node.fullPath.join('|');
            const currentExpanded = isNodeExpanded(node);
            const newExpanded = !currentExpanded;
            expansionState.set(pathKey, newExpanded);
            toggleSpan.classList.toggle('expanded', newExpanded);
            updateTreeVisibility();
        };
        
        treeNodeDiv.addEventListener('click', toggleFunction);
        eventListeners.push(() => treeNodeDiv.removeEventListener('click', toggleFunction));
        
        // Add remove button click handler for top-level nodes
        if (isTopLevel) {
            const removeBtn = treeNodeDiv.querySelector('.tree-remove-btn');
            if (removeBtn) {
                const removeBtnFunction = (e: MouseEvent) => {
                    e.stopPropagation();
                    removeSignalSourceAndChildren(node);
                };
                
                removeBtn.addEventListener('click', removeBtnFunction);
                eventListeners.push(() => removeBtn.removeEventListener('click', removeBtnFunction));
            }
        }
    } else if (isLeaf && node.signalSource) {
        const clickFunction = () => {
            addSignalToWaveform(node.signalSource!);
        };
        
        treeNodeDiv.addEventListener('click', clickFunction);
        eventListeners.push(() => treeNodeDiv.removeEventListener('click', clickFunction));
    }
    
    return {
        element: nodeElement,
        node: node,
        isVisible: true,
        eventListeners: eventListeners
    };
}

function buildDOMCache(): void {
    if (isDOMCacheValid) return;
    
    invalidateDOMCache();
    
    const tree = getSignalTree();
    buildDOMCacheRecursive(tree, 0);
    
    isDOMCacheValid = true;
}

function buildDOMCacheRecursive(node: TreeNode, depth: number): void {
    for (const [_, childNode] of getSortedChildren(node)) {
        const cacheKey = childNode.fullPath.join('|');
        const cachedElement = createDOMElement(childNode, depth);
        domCache.set(cacheKey, cachedElement);
        
        // Recursively cache children
        if (childNode.children.size > 0) {
            buildDOMCacheRecursive(childNode, depth + 1);
        }
    }
}

function renderSignalTree(): void {
    if (!sidebarContainer) return;

    const treeContainer = sidebarContainer.querySelector('#signal-tree');
    if (!treeContainer) return;

    // Build DOM cache if needed
    buildDOMCache();
    
    // Clear container and add all cached elements
    treeContainer.innerHTML = '';
    
    const tree = getSignalTree();
    syncCacheWithTree(tree);
    addTreeNodesToContainer(tree, treeContainer as HTMLElement, 0, true);
}

function syncCacheWithTree(node: TreeNode): void {
    for (const [_, childNode] of getSortedChildren(node)) {
        const cacheKey = childNode.fullPath.join('|');
        const cachedElement = domCache.get(cacheKey);
        
        if (cachedElement) {
            const toggleElement = cachedElement.element.querySelector('.tree-toggle');
            if (toggleElement) {
                toggleElement.classList.toggle('expanded', isNodeExpanded(childNode));
            }
        }
        
        if (childNode.children.size > 0) {
            syncCacheWithTree(childNode);
        }
    }
}

function addTreeNodesToContainer(node: TreeNode, container: HTMLElement, depth: number, showAll: boolean): void {
    for (const [_, childNode] of getSortedChildren(node)) {
        const cacheKey = childNode.fullPath.join('|');
        const cachedElement = domCache.get(cacheKey);
        
        if (!cachedElement) continue;
        
        // Only add if we should show all nodes or if it's marked as visible
        if (showAll || cachedElement.isVisible) {
            container.appendChild(cachedElement.element);
            
            // If expanded, add children
            if (isNodeExpanded(childNode) && childNode.children.size > 0) {
                addTreeNodesToContainer(childNode, container, depth + 1, showAll);
            }
        }
    }
}

function updateTreeVisibility(): void {
    if (!sidebarContainer) return;

    const treeContainer = sidebarContainer.querySelector('#signal-tree');
    if (!treeContainer) return;

    // Check if there's an active search
    if (lastSearchTerm.trim()) {
        // Re-apply search filter to maintain search state
        const tree = getSignalTree();
        const hasMatches = markTreeNodesForSearch(tree, lastSearchTerm);
        
        if (!hasMatches) {
            treeContainer.innerHTML = '<div style="color: #6b7280; padding: 16px; text-align: center;">No signals found</div>';
            return;
        }
        
        updateCachedElementsForSearch(tree, lastSearchTerm);
        treeContainer.innerHTML = '';
        addFilteredTreeNodes(tree, treeContainer as HTMLElement, 0);
    } else {
        // No search active - show normal tree
        treeContainer.innerHTML = '';
        const tree = getSignalTree();
        addTreeNodesToContainer(tree, treeContainer as HTMLElement, 0, true);
    }
}

function filterSignals(searchTerm: string): void {
    if (!sidebarContainer) return;

    const treeContainer = sidebarContainer.querySelector('#signal-tree');
    if (!treeContainer) return;

    // Build DOM cache if needed
    buildDOMCache();

    if (!searchTerm.trim()) {
        // No search term - clear all highlighting from cached elements and show normal tree structure
        clearAllHighlighting();
        renderSignalTree();
        return;
    }

    // Build the tree but mark nodes for visibility based on search
    const tree = getSignalTree();
    const hasMatches = markTreeNodesForSearch(tree, searchTerm);
    
    if (!hasMatches) {
        treeContainer.innerHTML = '<div style="color: #6b7280; padding: 16px; text-align: center;">No signals found</div>';
        return;
    }
    
    // Update cached elements with search highlighting and visibility
    updateCachedElementsForSearch(tree, searchTerm);
    
    // Re-render using cached elements
    treeContainer.innerHTML = '';
    addFilteredTreeNodes(tree, treeContainer as HTMLElement, 0);
}

function clearAllHighlighting(): void {
    // Clear highlighting from all cached elements
    for (const cachedElement of domCache.values()) {
        const labelElement = cachedElement.element.querySelector('.tree-label');
        if (labelElement) {
            labelElement.textContent = cachedElement.node.name;
        }
    }
}

function updateCachedElementsForSearch(node: TreeNode, searchTerm: string): void {
    for (const [_, childNode] of getSortedChildren(node)) {
        const cacheKey = childNode.fullPath.join('|');
        const cachedElement = domCache.get(cacheKey);
        
        if (cachedElement) {
            const searchVisible = (childNode as any).searchVisible;
            const searchMatches = (childNode as any).searchMatches;
            
            cachedElement.isVisible = searchVisible;
            
            // Update label with highlighting if it matches
            const labelElement = cachedElement.element.querySelector('.tree-label');
            if (labelElement) {
                if (searchMatches) {
                    labelElement.innerHTML = highlightSearchMatch(childNode.name, searchTerm);
                } else {
                    labelElement.textContent = childNode.name;
                }
            }
            
            // Update toggle state for expanded nodes
            const toggleElement = cachedElement.element.querySelector('.tree-toggle');
            if (toggleElement && childNode.children.size > 0) {
                toggleElement.classList.toggle('expanded', isNodeExpanded(childNode));
            }
        }
        
        // Recursively update children
        if (childNode.children.size > 0) {
            updateCachedElementsForSearch(childNode, searchTerm);
        }
    }
}

function addFilteredTreeNodes(node: TreeNode, container: HTMLElement, depth: number): void {
    for (const [_, childNode] of getSortedChildren(node)) {
        // Skip nodes that don't match search criteria
        if (!(childNode as any).searchVisible) {
            continue;
        }
        
        const cacheKey = childNode.fullPath.join('|');
        const cachedElement = domCache.get(cacheKey);
        
        if (cachedElement && cachedElement.isVisible) {
            container.appendChild(cachedElement.element);
            
            // If expanded and has matching children, add them
            if (isNodeExpanded(childNode) && childNode.children.size > 0) {
                addFilteredTreeNodes(childNode, container, depth + 1);
            }
        }
    }
}

function markTreeNodesForSearch(node: TreeNode, searchTerm: string): boolean {
    let hasAnyMatches = false;
    let shouldShow = false;
    
    // Check if this node matches the search term
    const nodeMatches = matchesSearchTerm(node.fullPath.join(' '), searchTerm);
    if (nodeMatches) hasAnyMatches = true;
    
    // Check children recursively
    let hasMatchingChildren = false;
    for (const [_, child] of getSortedChildren(node)) {
        const childHasMatches = markTreeNodesForSearch(child, searchTerm);
        if (childHasMatches) {
            hasAnyMatches = true;
            hasMatchingChildren = true;
        }
    }
    
    // Show this node if it matches or has matching descendants
    shouldShow = nodeMatches || hasMatchingChildren;
    
    // If this node or its children match, expand it
    if (shouldShow && hasMatchingChildren) {
        const pathKey = node.fullPath.join('|');
        expansionState.set(pathKey, true);
    }
    
    // Add a search property to track visibility
    (node as any).searchVisible = shouldShow;
    (node as any).searchMatches = nodeMatches;
    
    return hasAnyMatches;
}

function matchesSearchTerm(text: string, searchTerm: string): boolean {
    try {
        // Try to use the search term as a regex
        const regex = new RegExp(searchTerm, 'i');
        return regex.test(text);
    } catch (e) {
        // If regex is invalid, fall back to simple string matching
        return text.toLowerCase().includes(searchTerm.toLowerCase());
    }
}

let lastSearchTerm = '';

function getLastSearchTerm(): string {
    return lastSearchTerm;
}

function highlightSearchMatch(text: string, searchTerm: string): string {
    if (!searchTerm.trim()) return text;
    
    try {
        const regex = new RegExp(`(${searchTerm})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    } catch (e) {
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

function collectFilteredSignals(node: TreeNode): SignalSource[] {
    const signals: SignalSource[] = [];
    
    if ((node as any).searchVisible) {
        if (node.signalSource) {
            signals.push(node.signalSource);
        }
        
        for (const [_, childNode] of getSortedChildren(node)) {
            signals.push(...collectFilteredSignals(childNode));
        }
    }
    
    return signals;
}

function plotAllFilteredSignals(): void {
    if (!context) return;
    
    const tree = getSignalTree();
    const filteredSignals = lastSearchTerm.trim() ? collectFilteredSignals(tree) : [];
    
    if (filteredSignals.length === 0) return;
    
    const lineSignals: SignalSource[] = [];
    const otherSignals: SignalSource[] = [];
    
    for (const signalSource of filteredSignals) {
        if ([RenderMode.Lines, RenderMode.Discrete].includes(signalSource.renderHint)) {
            lineSignals.push(signalSource);
        } else {
            otherSignals.push(signalSource);
        }
    }

    for (const otherSignal of otherSignals) {
        context.createRows({ channels: [otherSignal.signal()] });
    }
    
    if (lineSignals.length > 0) {
        context.createRows({ channels: lineSignals.map(s => s.signal()) });
    }
    
    context.requestRender();
}

function addSignalToWaveform(signalSource: SignalSource): void {
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
    context.createRows({ channels: [getExistingSignal() ?? signalSource.signal()] });
    context.requestRender();
}


function removeSignalSourceAndChildren(node: TreeNode): void {
    if (!context) return;

    function collectAllSignalSources(node: TreeNode): SignalSource[] {
        const sources: SignalSource[] = [];
        
        if (node.signalSource) {
            sources.push(node.signalSource);
        }
        
        for (const [_, childNode] of node.children.entries()) {
            sources.push(...collectAllSignalSources(childNode));
        }
        
        return sources;
    }
    
    const signalSourcesToRemove = collectAllSignalSources(node);
    
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
    context.signalSources.remove(...signalSourcesToRemove);
    
    context.requestRender();
}

function refreshSignalList(): void {
    renderSignalTree();
}
