import type { SignalSource } from '@voltex-viewer/plugin-api';

export class TreeEntry {
    expanded: boolean = true;
    searchVisible: boolean = false;
    searchMatches: boolean = false;
    /** Match ranges within `name`, in [start, end) character offsets */
    highlightRanges: [number, number][] = [];
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
        // Push individually: spreading into push() overflows the argument
        // limit when a node has a very large number of children
        const children = Array.from(node.children.entries())
            .sort((a, b) => naturalCompare(b[0], a[0]));
        for (const [, child] of children) {
            toVisit.push([child, entry]);
        }
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

export interface SearchOptions {
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
}

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildSearchRegex(searchTerm: string, options: SearchOptions, extraFlags = ''): RegExp | null {
    if (!searchTerm.trim()) return null;

    const flags = (options.caseSensitive ? '' : 'i') + extraFlags;
    const wrap = (pattern: string) => options.wholeWord ? `\\b(?:${pattern})\\b` : pattern;
    try {
        return new RegExp(wrap(options.useRegex ? searchTerm : escapeRegex(searchTerm)), flags);
    } catch {
        // Invalid user-supplied regex: fall back to matching it literally
        return new RegExp(wrap(escapeRegex(searchTerm)), flags);
    }
}

export function filterBySearch(entries: TreeEntry[], searchTerm: string, options: SearchOptions): void {
    for (const entry of entries) {
        entry.searchVisible = false;
        entry.searchMatches = false;
        entry.highlightRanges = [];
    }

    const regex = buildSearchRegex(searchTerm, options, 'g');
    if (!regex) return;

    // First pass: mark nodes whose full path matches, and record each match's
    // overlap with the node's own name and its ancestors' names. Ancestor full
    // path strings are prefixes of the node's, so match offsets carry over.
    for (const node of entries) {
        for (const match of node.fullPathString.matchAll(regex)) {
            node.searchMatches = true;
            const start = match.index;
            const end = start + match[0].length;
            for (let cur: TreeEntry | null = node; cur !== null; cur = cur.parent) {
                const nameStart = cur.fullPathString.length - cur.name.length;
                const clippedStart = Math.max(start, nameStart) - nameStart;
                const clippedEnd = Math.min(end, cur.fullPathString.length) - nameStart;
                if (clippedEnd > clippedStart) {
                    cur.highlightRanges.push([clippedStart, clippedEnd]);
                }
            }
        }
    }

    // Merge the overlapping/duplicate ranges collected from different nodes
    for (const entry of entries) {
        if (entry.highlightRanges.length < 2) continue;
        entry.highlightRanges.sort((a, b) => a[0] - b[0]);
        const merged = [entry.highlightRanges[0]];
        for (const [start, end] of entry.highlightRanges.slice(1)) {
            const last = merged[merged.length - 1];
            if (start <= last[1]) {
                last[1] = Math.max(last[1], end);
            } else {
                merged.push([start, end]);
            }
        }
        entry.highlightRanges = merged;
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

    const ancestorStack: boolean[] = [];
    for (const entry of entries) {
        ancestorStack.length = entry.depth;
        const isVisible = ancestorStack.every(expanded => expanded)
            && (!isSearching || entry.searchVisible);
        if (isVisible) {
            visible.push({ entry, depth: entry.depth });
        }
        ancestorStack.push(entry.expanded);
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
