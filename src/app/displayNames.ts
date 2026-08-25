export const nameSeparator = ' › ';

export function shortestUniqueSuffixes(paths: readonly (readonly string[])[]): string[][] {
    let maxLength = 0;
    for (const path of paths) {
        maxLength = Math.max(maxLength, path.length);
    }

    for (let depth = 1; depth <= maxLength; depth++) {
        const suffixes = paths.map(path => suffix(path, depth));
        if (new Set(suffixes.map(key)).size === suffixes.length) {
            return suffixes;
        }
    }

    return numberIdenticalPaths(paths.map(path => suffix(path, maxLength)));
}

function numberIdenticalPaths(suffixes: string[][]): string[][] {
    const counts = new Map<string, number>();
    for (const parts of suffixes) {
        counts.set(key(parts), (counts.get(key(parts)) ?? 0) + 1);
    }

    const occurrences = new Map<string, number>();
    return suffixes.map(parts => {
        if (counts.get(key(parts)) === 1) {
            return parts;
        }
        const occurrence = occurrences.get(key(parts)) ?? 0;
        occurrences.set(key(parts), occurrence + 1);
        return [...parts.slice(0, -1), `${parts[parts.length - 1]}#${occurrence}`];
    });
}

function suffix(path: readonly string[], depth: number): string[] {
    return path.slice(Math.max(0, path.length - depth));
}

function key(parts: readonly string[]): string {
    return parts.join('\u0000');
}
