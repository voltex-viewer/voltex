import type { MdfSource } from '@voltex-viewer/mdf-reader';

export interface NamingEntry {
    name: string;
    channelSource: MdfSource | null;
    groupSource: MdfSource | null;
    groupName: string | null;
    dgIndex: number;
    cgIndex: number;
}

function nonEmpty(value: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function sourceQualifier(source: MdfSource | null): string | null {
    if (source === null) return null;
    return nonEmpty(source.path) ?? nonEmpty(source.name);
}

const qualifierLevels: ((entry: NamingEntry, indexInGroup: number) => string | null)[] = [
    entry => sourceQualifier(entry.channelSource),
    entry => sourceQualifier(entry.groupSource),
    entry => nonEmpty(entry.groupName),
    entry => `${entry.dgIndex}/${entry.cgIndex}`,
    (entry, indexInGroup) => `${entry.dgIndex}/${entry.cgIndex}#${indexInGroup}`,
];

function groupByName(names: string[]): Map<string, number[]> {
    const groups = new Map<string, number[]>();
    for (let i = 0; i < names.length; i++) {
        const existing = groups.get(names[i]);
        if (existing) {
            existing.push(i);
        } else {
            groups.set(names[i], [i]);
        }
    }
    return groups;
}

export function findDuplicateNameIndices(names: string[]): number[] {
    const duplicates: number[] = [];
    for (const indices of groupByName(names).values()) {
        if (indices.length > 1) {
            duplicates.push(...indices);
        }
    }
    return duplicates.sort((a, b) => a - b);
}

export function disambiguateNames(entries: NamingEntry[]): string[][] {
    const paths = entries.map(entry => [entry.name]);

    for (const indices of groupByName(entries.map(e => e.name)).values()) {
        if (indices.length < 2) continue;

        for (const level of qualifierLevels) {
            const qualifiers = indices.map((entryIndex, i) => level(entries[entryIndex], i));
            if (qualifiers.some(q => q === null)) continue;
            if (new Set(qualifiers).size !== qualifiers.length) continue;

            for (let i = 0; i < indices.length; i++) {
                paths[indices[i]] = [qualifiers[i]!, entries[indices[i]].name];
            }
            break;
        }
    }

    return paths;
}
