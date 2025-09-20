import { type PluginContext, type SignalSource } from '@voltex-viewer/plugin-api'

let context: PluginContext | undefined;
let sidebarContainer: HTMLElement | undefined;
let availableSignalSources: SignalSource[] = [];

export default (pluginContext: PluginContext): void => {
    context = pluginContext;
    
    // Listen for signal source changes
    context.signalSources.changed((event) => {
        availableSignalSources = context.signalSources.available;
        refreshSignalList();
    });
    
    // Initialize available signal sources
    availableSignalSources = context.signalSources.available;
    
    context.addSidebarEntry({
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
}

function renderContent(): HTMLElement {
    const container = document.createElement('div');
    container.innerHTML = `
        <style>
            .search-container {
                position: relative;
                margin-bottom: 16px;
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
        </style>
        <div class="search-container">
            <div class="search-icon">
                <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                    <circle cx="6" cy="6" r="3" stroke="#6b7280" stroke-width="1.5" fill="none"/>
                    <line x1="8.5" y1="8.5" x2="12" y2="12" stroke="#6b7280" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            </div>
            <input type="text" id="signal-search" placeholder="Search signals..." class="search-input">
        </div>
        <div id="signal-tree" style="display: flex; flex-direction: column;">
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

    return container;
}

interface TreeNode {
    name: string;
    fullPath: string[];
    children: Map<string, TreeNode>;
    signalSource?: SignalSource;
    isExpanded: boolean;
}

function buildSignalTree(): TreeNode {
    const root: TreeNode = {
        name: 'root',
        fullPath: [],
        children: new Map(),
        isExpanded: true
    };

    for (const signalSource of availableSignalSources) {
        let currentNode = root;
        
        for (let i = 0; i < signalSource.name.length; i++) {
            const pathPart = signalSource.name[i];
            
            if (!currentNode.children.has(pathPart)) {
                const newNode: TreeNode = {
                    name: pathPart,
                    fullPath: signalSource.name.slice(0, i + 1),
                    children: new Map(),
                    isExpanded: true // Expand by default
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

function renderSignalTree(): void {
    if (!sidebarContainer) return;

    const treeContainer = sidebarContainer.querySelector('#signal-tree');
    if (!treeContainer) return;

    treeContainer.innerHTML = '';
    
    const tree = buildSignalTree();
    renderTreeNode(tree, treeContainer as HTMLElement, 0);
}

function renderTreeNode(node: TreeNode, container: HTMLElement, depth: number): void {
    for (const [_, childNode] of node.children) {
        const nodeElement = document.createElement('div');
        nodeElement.className = 'signal-item';
        nodeElement.setAttribute('data-signal-path', childNode.fullPath.join('|').toLowerCase());
        
        const isLeaf = childNode.children.size === 0;
        const hasChildren = childNode.children.size > 0;
        
        nodeElement.innerHTML = `
            <div class="tree-node ${isLeaf ? 'leaf' : 'expandable'}" style="--indent: ${depth * 12}px">
                ${hasChildren ? `<span class="tree-toggle ${childNode.isExpanded ? 'expanded' : ''}">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
                    </svg>
                </span>` : '<span class="tree-toggle"></span>'}
                <span class="tree-label">${childNode.name}</span>
            </div>
        `;

        if (hasChildren) {
            const treeNodeElement = nodeElement.querySelector('.tree-node') as HTMLElement;
            const toggleElement = nodeElement.querySelector('.tree-toggle') as HTMLElement;
            
            const toggleFunction = () => {
                childNode.isExpanded = !childNode.isExpanded;
                toggleElement.classList.toggle('expanded', childNode.isExpanded);
                
                // Remove existing children from DOM
                const existingChildren = container.querySelectorAll(`[data-parent-path="${childNode.fullPath.join('|')}"]`);
                existingChildren.forEach(child => child.remove());
                
                if (childNode.isExpanded) {
                    const childContainer = document.createElement('div');
                    renderTreeNode(childNode, childContainer, depth + 1);
                    
                    // Mark children with parent path for easy removal
                    const children = childContainer.querySelectorAll('.signal-item');
                    children.forEach(child => {
                        child.setAttribute('data-parent-path', childNode.fullPath.join('|'));
                    });
                    
                    // Insert children after this node
                    let nextSibling = nodeElement.nextSibling;
                    while (childContainer.firstChild) {
                        container.insertBefore(childContainer.firstChild, nextSibling);
                    }
                }
            };
            
            treeNodeElement.addEventListener('click', toggleFunction);
        } else if (isLeaf && childNode.signalSource) {
            // Make the entire leaf node clickable to add the signal
            const treeNodeElement = nodeElement.querySelector('.tree-node') as HTMLElement;
            treeNodeElement.addEventListener('click', () => {
                addSignalToWaveform(childNode.signalSource!);
            });
        }

        container.appendChild(nodeElement);
        
        // Render children if expanded
        if (childNode.isExpanded && hasChildren) {
            const childContainer = document.createElement('div');
            renderTreeNode(childNode, childContainer, depth + 1);
            
            // Mark children with parent path for easy removal
            const children = childContainer.querySelectorAll('.signal-item');
            children.forEach(child => {
                child.setAttribute('data-parent-path', childNode.fullPath.join('|'));
            });
            
            while (childContainer.firstChild) {
                container.appendChild(childContainer.firstChild);
            }
        }
    }
}

function filterSignals(searchTerm: string): void {
    if (!sidebarContainer) return;

    const treeContainer = sidebarContainer.querySelector('#signal-tree');
    if (!treeContainer) return;

    if (!searchTerm.trim()) {
        // No search term - show normal tree structure
        renderSignalTree();
        return;
    }

    // Build the tree but mark nodes for visibility based on search
    const tree = buildSignalTree();
    markTreeNodesForSearch(tree, searchTerm);
    
    // Re-render the tree with search results
    treeContainer.innerHTML = '';
    renderSearchTreeNode(tree, treeContainer as HTMLElement, 0);
}

function markTreeNodesForSearch(node: TreeNode, searchTerm: string): boolean {
    let shouldShow = false;
    
    // Check if this node matches the search term
    const nodeMatches = matchesSearchTerm(node.fullPath.join(' '), searchTerm);
    
    // Check children recursively
    let hasMatchingChildren = false;
    for (const [_, child] of node.children) {
        const childShouldShow = markTreeNodesForSearch(child, searchTerm);
        if (childShouldShow) {
            hasMatchingChildren = true;
        }
    }
    
    // Show this node if it matches or has matching descendants
    shouldShow = nodeMatches || hasMatchingChildren;
    
    // If this node or its children match, expand it
    if (shouldShow && hasMatchingChildren) {
        node.isExpanded = true;
    }
    
    // Add a search property to track visibility
    (node as any).searchVisible = shouldShow;
    (node as any).searchMatches = nodeMatches;
    
    return shouldShow;
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

function renderSearchTreeNode(node: TreeNode, container: HTMLElement, depth: number): void {
    for (const [_, childNode] of node.children) {
        // Skip nodes that don't match search criteria
        if (!(childNode as any).searchVisible) {
            continue;
        }
        
        const nodeElement = document.createElement('div');
        nodeElement.className = 'signal-item';
        nodeElement.setAttribute('data-signal-path', childNode.fullPath.join('|').toLowerCase());
        
        const isLeaf = childNode.children.size === 0;
        const hasChildren = childNode.children.size > 0;
        const nodeMatches = (childNode as any).searchMatches;
        
        // Highlight matching text
        const displayName = nodeMatches ? highlightSearchMatch(childNode.name, getLastSearchTerm()) : childNode.name;
        
        nodeElement.innerHTML = `
            <div class="tree-node ${isLeaf ? 'leaf' : 'expandable'}" style="--indent: ${depth * 12}px">
                ${hasChildren ? `<span class="tree-toggle ${childNode.isExpanded ? 'expanded' : ''}">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
                    </svg>
                </span>` : '<span class="tree-toggle"></span>'}
                <span class="tree-label">${displayName}</span>
            </div>
        `;

        if (hasChildren) {
            const treeNodeElement = nodeElement.querySelector('.tree-node') as HTMLElement;
            const toggleElement = nodeElement.querySelector('.tree-toggle') as HTMLElement;
            
            const toggleFunction = () => {
                childNode.isExpanded = !childNode.isExpanded;
                toggleElement.classList.toggle('expanded', childNode.isExpanded);
                
                // Re-render search results to show/hide children
                const currentSearchTerm = getLastSearchTerm();
                if (currentSearchTerm) {
                    filterSignals(currentSearchTerm);
                } else {
                    renderSignalTree();
                }
            };
            
            treeNodeElement.addEventListener('click', toggleFunction);
        } else if (isLeaf && childNode.signalSource) {
            // Make the entire leaf node clickable to add the signal
            const treeNodeElement = nodeElement.querySelector('.tree-node') as HTMLElement;
            treeNodeElement.addEventListener('click', () => {
                addSignalToWaveform(childNode.signalSource!);
            });
        }

        container.appendChild(nodeElement);
        
        // Render children if expanded and they have matching descendants
        if (childNode.isExpanded && hasChildren) {
            renderSearchTreeNode(childNode, container, depth + 1);
        }
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

function refreshSignalList(): void {
    renderSignalTree();
}
