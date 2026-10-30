export const nameSeparator = ' › ';

export function shortestUniqueSuffixes(paths: readonly (readonly string[])[]): string[][] {
    // The same signal plotted more than once has an identical path, but it doesn't need distinguishing from itself, so
    // only consider distinct items.
    const distinct = new Map<string, readonly string[]>();
    let maxLength = 0;
    for (const path of paths) {
        distinct.set(key(path), path);
        maxLength = Math.max(maxLength, path.length);
    }

    for (let depth = 1; depth <= maxLength; depth++) {
        const suffixes = Array.from(distinct.values(), path => key(suffix(path, depth)));
        if (new Set(suffixes).size === suffixes.length) {
            return paths.map(path => suffix(path, depth));
        }
    }

    return paths.map(path => suffix(path, maxLength));
}

function suffix(path: readonly string[], depth: number): string[] {
    return path.slice(Math.max(0, path.length - depth));
}

function key(parts: readonly string[]): string {
    return parts.join('\u0000');
}
