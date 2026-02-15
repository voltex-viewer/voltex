import type { TreeEntry } from './treeModel';

const chevronPath = 'M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z';
const closePath = 'M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z';

export interface TreeNodeCallbacks {
    onToggle: (entry: TreeEntry) => void;
    onLeafClick: (entry: TreeEntry) => void;
    onRemove: (entry: TreeEntry) => void;
}

function createSvgIcon(path: string, size = 16): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'currentColor');
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', path);
    svg.appendChild(pathEl);
    return svg;
}

export function highlightText(text: string, searchTerm: string): string {
    if (!searchTerm.trim()) return text;

    try {
        const regex = new RegExp(`(${searchTerm})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    } catch {
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

export function createTreeNode(
    entry: TreeEntry,
    depth: number,
    searchTerm: string,
    callbacks: TreeNodeCallbacks
): HTMLElement {
    const container = document.createElement('div');
    container.className = 'signal-item';
    container.setAttribute('data-signal-path', entry.fullPath.join('|').toLowerCase());

    const isLeaf = entry.isLeaf;
    const hasChildren = !isLeaf;
    const isTopLevel = entry.isTopLevel;

    const treeNodeDiv = document.createElement('div');
    treeNodeDiv.className = `tree-node ${isLeaf ? 'leaf' : 'expandable'}`;
    treeNodeDiv.style.setProperty('--indent', `${depth * 12}px`);

    const toggleSpan = document.createElement('span');
    toggleSpan.className = 'tree-toggle';

    if (hasChildren) {
        toggleSpan.appendChild(createSvgIcon(chevronPath));
        if (entry.expanded) {
            toggleSpan.classList.add('expanded');
        }
    }

    const labelSpan = document.createElement('span');
    labelSpan.className = 'tree-label';

    if (searchTerm.trim() && entry.searchMatches) {
        labelSpan.innerHTML = highlightText(entry.name, searchTerm);
    } else {
        labelSpan.textContent = entry.name;
    }

    treeNodeDiv.appendChild(toggleSpan);
    treeNodeDiv.appendChild(labelSpan);

    if (isTopLevel && hasChildren) {
        const removeBtn = document.createElement('span');
        removeBtn.className = 'tree-remove-btn';
        removeBtn.title = 'Remove all signals from this source';
        removeBtn.appendChild(createSvgIcon(closePath));
        removeBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            callbacks.onRemove(entry);
        });
        treeNodeDiv.appendChild(removeBtn);
    }

    container.appendChild(treeNodeDiv);

    if (hasChildren) {
        treeNodeDiv.addEventListener('click', (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest('.tree-remove-btn')) return;
            callbacks.onToggle(entry);
        });
    } else if (isLeaf) {
        treeNodeDiv.addEventListener('click', () => callbacks.onLeafClick(entry));
    }

    return container;
}
