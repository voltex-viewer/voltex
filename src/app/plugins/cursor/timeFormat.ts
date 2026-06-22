const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string | undefined, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = (timeZone ?? 'local') + '|' + JSON.stringify(opts);
    let fmt = formatterCache.get(key);
    if (!fmt) {
        fmt = new Intl.DateTimeFormat('en-CA', { timeZone, hour12: false, ...opts });
        formatterCache.set(key, fmt);
    }
    return fmt;
}

// 'local'/'' → the runtime's local zone (undefined lets Intl use it).
function resolveZone(timeZone: string): string | undefined {
    return timeZone === 'local' || timeZone === '' ? undefined : timeZone;
}

// Full wall-clock timestamp, ISO-style with milliseconds, e.g. "2020-10-23 16:00:14.500".
export function formatInstant(epochSeconds: number, timeZone: string): string {
    const fmt = getFormatter(resolveZone(timeZone), {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
    });
    return fmt.format(new Date(Math.round(epochSeconds * 1000))).replace(/,\s+/g, ' ');
}
