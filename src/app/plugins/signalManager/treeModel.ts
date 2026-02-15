import type { SignalSource } from '@voltex-viewer/plugin-api';

export class TreeEntry {
    expanded: boolean = true;
    searchVisible: boolean = false;
    searchMatches: boolean = false;
    readonly fullPathString: string;
    parent: TreeEntry | null = null;

    constructor(
        public readonly fullPath: string[],
        public readonly signalSource?: SignalSource
    ) {
        this.fullPathString = fullPath.join(' ');
    }

    get name(): string {
        return this.fullPath[this.fullPath.length - 1];
    }

    get isLeaf(): boolean {
        return typeof this.signalSource !== 'undefined';
    }

    get depth(): number {
        return this.fullPath.length;
    }

    get isTopLevel(): boolean {
        return this.fullPath.length === 1;
    }
}

type TreeNode = {
    fullPath: string[];
    children: Map<string, TreeNode>;
    signalSource?: SignalSource;
};

export function buildTreeFromSources(sources: SignalSource[]): TreeEntry[] {
    const root: TreeNode = { fullPath: [], children: new Map() };

    for (const signalSource of sources) {
        let currentNode = root;
        for (let i = 0; i < signalSource.name.length; i++) {
            const pathPart = signalSource.name[i];
            if (!currentNode.children.has(pathPart)) {
                const fullPath = signalSource.name.slice(0, i + 1);
                const newNode: TreeNode = { fullPath, children: new Map() };
                if (i === signalSource.name.length - 1) {
                    newNode.signalSource = signalSource;
                }
                currentNode.children.set(pathPart, newNode);
            }
            currentNode = currentNode.children.get(pathPart)!;
        }
    }

    const entries: TreeEntry[] = [];
    const toVisit: [TreeNode, TreeEntry | null][] = Array.from(root.children.entries())
        .sort((a, b) => naturalCompare(b[0], a[0]))
        .map(v => [v[1], null] as [TreeNode, TreeEntry | null]);

    while (toVisit.length > 0) {
        const [node, parent] = toVisit.pop()!;
        const entry = new TreeEntry(node.fullPath, node.signalSource);
        entry.parent = parent;
        entries.push(entry);
        toVisit.push(
            ...Array.from(node.children.entries())
                .sort((a, b) => naturalCompare(b[0], a[0]))
                .map(v => [v[1], entry] as [TreeNode, TreeEntry | null])
        );
    }

    return entries;
}

export function naturalCompare(a: string, b: string): number {
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

export function filterBySearch(entries: TreeEntry[], searchTerm: string): void {
    if (!searchTerm.trim()) {
        for (const entry of entries) {
            entry.searchVisible = false;
            entry.searchMatches = false;
        }
        return;
    }

    let regex: RegExp | null = null;
    let lowerSearchTerm = '';
    try {
        regex = new RegExp(searchTerm, 'i');
    } catch {
        lowerSearchTerm = searchTerm.toLowerCase();
    }

    // First pass: mark nodes that directly match
    for (const node of entries) {
        const nodeMatches = regex
            ? regex.test(node.fullPathString)
            : node.fullPathString.toLowerCase().includes(lowerSearchTerm);
        node.searchVisible = false;
        node.searchMatches = nodeMatches;
    }

    // Second pass: mark descendants of matching nodes
    for (let i = 0; i < entries.length; i++) {
        const node = entries[i];
        if (node.searchMatches) {
            node.searchVisible = true;
            const nodeDepth = node.depth;
            for (let j = i + 1; j < entries.length && entries[j].depth > nodeDepth; j++) {
                entries[j].searchVisible = true;
            }
        }
    }

    // Third pass: mark ancestors of visible nodes
    for (const node of entries) {
        if (node.searchVisible) {
            let current = node.parent;
            while (current !== null) {
                if (current.searchVisible) break;
                current.searchVisible = true;
                current = current.parent;
            }
        }
    }
}

export function getVisibleEntries(
    entries: TreeEntry[],
    isSearching: boolean
): { entry: TreeEntry; depth: number }[] {
    const visible: { entry: TreeEntry; depth: number }[] = [];

    if (isSearching) {
        for (const entry of entries) {
            if (entry.searchVisible) {
                visible.push({ entry, depth: entry.depth });
            }
        }
    } else {
        const ancestorStack: boolean[] = [];
        for (const entry of entries) {
            ancestorStack.length = entry.depth;
            const isVisible = ancestorStack.every(expanded => expanded);
            if (isVisible) {
                visible.push({ entry, depth: entry.depth });
            }
            ancestorStack.push(entry.expanded);
        }
    }

    return visible;
}

export function getDescendantRange(entries: TreeEntry[], node: TreeEntry): [number, number] {
    const startIndex = entries.indexOf(node);
    if (startIndex === -1) return [-1, -1];

    const startDepth = node.depth;
    let endIndex = startIndex + 1;
    while (endIndex < entries.length && entries[endIndex].depth > startDepth) {
        endIndex++;
    }
    return [startIndex, endIndex];
}
