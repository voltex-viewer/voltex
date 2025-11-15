export function bigPush<T>(list: T[], values: T[]) {
    // The spread operator can stack overflow if used with more than around 20k elementes, who would have known?
    // It is however, faster than doing a loop and push...
    for (let i = 0; i < values.length; i += 20_000) {
        list.push(...values.slice(i, Math.min(i + 20_000, values.length)));
    }
}
