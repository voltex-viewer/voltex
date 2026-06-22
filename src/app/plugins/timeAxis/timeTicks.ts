import type { WaveformState } from '@voltex-viewer/plugin-api';
import { getGridSpacing } from './timeAxisUtils';

// `Temporal` is a global (installed by installTemporal.ts; native once browsers ship it).

// A single tick: x is the screen position in pixels relative to the viewport's left edge.
export interface AxisTick {
    x: number;
    label: string;
}

// Ticks for one axis render. `major` drives the top text row and the strong gridlines; `minor`
// drives the bottom text row and the normal gridlines. The meaning differs per mode:
//   relative  → major = labelled grid lines, minor = fractional subdivisions
//   real-time → major = coarse context (date), minor = fine time ticks
export interface AxisTicks {
    major: AxisTick[];
    minor: AxisTick[];
}

// ---------------------------------------------------------------------------------------------
// Relative mode (seconds). Mirrors the long-standing behaviour, kept here so the grid and the
// axis share one source of tick positions.

const timeUnits = [
    { name: 'yr', scale: 60 * 60 * 24 * 365 },
    { name: 'd', scale: 60 * 60 * 24 },
    { name: 'h', scale: 60 * 60 },
    { name: 'm', scale: 60 },
    { name: 's', scale: 1 },
    { name: 'ms', scale: 1e-3 },
    { name: 'µs', scale: 1e-6 },
    { name: 'ns', scale: 1e-9 },
    { name: 'ps', scale: 1e-12 },
    { name: 'fs', scale: 1e-15 },
    { name: 'as', scale: 1e-18 },
    { name: 'zs', scale: 1e-21 },
    { name: 'ys', scale: 1e-24 },
];

function getTimeUnitAndScale(seconds: number): { unit: string; scale: number } {
    const abs = Math.abs(seconds);
    for (const unit of timeUnits) {
        const value = abs / unit.scale;
        if (value >= 1 && value < 1000) {
            return { unit: unit.name, scale: unit.scale };
        }
    }
    const lastUnit = timeUnits[timeUnits.length - 1];
    if (abs / lastUnit.scale < 1) {
        return { unit: lastUnit.name, scale: lastUnit.scale };
    }
    return { unit: timeUnits[0].name, scale: timeUnits[0].scale };
}

function formatSplitTimeLabel(seconds: number, scale: number): string {
    let remainder = Math.round(Math.abs(seconds) / scale);
    const parts = [];
    for (const u of timeUnits.slice(0, timeUnits.findIndex(u => u.scale === scale) + 1)) {
        const unitCount = Math.floor(remainder * scale / u.scale);
        if (unitCount > 0 || (u.scale === scale && parts.length === 0)) {
            parts.push(`${unitCount}${u.name}`);
        }
        remainder -= unitCount * Math.round(u.scale / scale);
    }
    return (seconds < 0 ? '-' : '') + parts.join(' ');
}

// "Nice" subdivision steps (seconds): 1/2/5/10/15/30 of each unit. Offsets are always a whole
// number of one of these, so labels read "+10s", "+5m" etc. — never fractional units.
const niceSteps = [
    1e-9, 2e-9, 5e-9, 1e-8, 2e-8, 5e-8, 1e-7, 2e-7, 5e-7, 1e-6, 2e-6, 5e-6,
    1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1, 0.2, 0.5,
    1, 2, 5, 10, 15, 30,
    60, 120, 300, 600, 900, 1800,
    3600, 7200, 10800, 21600, 43200,
    86400, 172800, 432000,
];

// Subdivision step for a major grid spacing: the smallest nice step that is at least ~1/10 of the
// major and divides it evenly (so subdivisions reset cleanly at each major). Falls back to a tenth
// for extreme spacings with no nice divisor.
function pickSubdivisionStep(gridSpacing: number): number {
    const target = gridSpacing / 10;
    for (const step of niceSteps) {
        if (step >= target - 1e-12 && step < gridSpacing && Math.abs(gridSpacing / step - Math.round(gridSpacing / step)) < 1e-6) {
            return step;
        }
    }
    return gridSpacing / 10;
}

// Shared "major anchor + relative offset subdivisions" generator, used by both relative and
// real-time (sub-minute) modes. `phaseFor` aligns the majors (0 from zero for relative; the
// wall-clock remainder for real-time); `majorLabel` formats the anchor.
function splitTicks(
    state: WaveformState,
    width: number,
    phaseFor: (gridSpacing: number) => number,
    majorLabel: (internalTime: number, gridSpacing: number) => string,
): AxisTicks {
    const { pxPerSecond, offset: startPx } = state;
    const gridSpacing = getGridSpacing(pxPerSecond);
    const major: AxisTick[] = [];
    const minor: AxisTick[] = [];
    if (gridSpacing * pxPerSecond < 1) return { major, minor };

    const minorStep = pickSubdivisionStep(gridSpacing);
    const { unit, scale } = getTimeUnitAndScale(minorStep);
    const count = Math.max(1, Math.round(gridSpacing / minorStep));
    const phase = phaseFor(gridSpacing);
    const leftInternal = startPx / pxPerSecond;
    // Start one grid left of the viewport so the off-screen major can drive the sticky label.
    const firstInternal = Math.floor((leftInternal + phase) / gridSpacing) * gridSpacing - phase;

    for (let b = firstInternal, end = leftInternal + width / pxPerSecond + gridSpacing; b < end; b += gridSpacing) {
        major.push({ x: b * pxPerSecond - startPx, label: majorLabel(b, gridSpacing) });
        for (let i = 1; i < count; i++) {
            const k = minorStep * i;
            const raw = k / scale;
            const num = Math.abs(raw - Math.round(raw)) < 1e-6 ? `${Math.round(raw)}` : raw.toFixed(1);
            minor.push({ x: (b + k) * pxPerSecond - startPx, label: `+${num}${unit}` });
        }
    }
    return { major, minor };
}

function getRelativeTicks(state: WaveformState, width: number): AxisTicks {
    return splitTicks(state, width, () => 0,
        (b, gridSpacing) => formatSplitTimeLabel(b, getTimeUnitAndScale(gridSpacing).scale));
}

// ---------------------------------------------------------------------------------------------
// Real-time mode (wall-clock). Ticks are generated as exact Temporal instants and labelled from
// integer epoch milliseconds, so labels never jitter as the view pans.

type CalendarUnit = 'day' | 'month' | 'year';

// Bottom-row label kinds for the calendar regime (tick unit >= 1 minute). Each renders only the
// tick unit (never a field already on the top row) so the rows read as one timestamp.
//   hourMinute → '16:10'  (top row is the date)
//   monthDay   → '10-23'  (top row is the year)
//   month      → '10'     (top row is the year)
//   year       → '2020'   (no top row)
type MinorKind = 'hourMinute' | 'monthDay' | 'month' | 'year';

// Top-row context: the coarse prefix, refreshed each `unit` boundary (and stuck at the left edge).
// The calendar regime never goes finer than the date, so the top never shows a time-of-day here;
// hh:mm only appears on top in the sub-minute regime (see getSubMinuteTicks).
type ContextKind = 'day' | 'year' | null;

interface Tier {
    seconds: number;                          // representative length, for pixel-spacing selection
    duration: Temporal.DurationLike;          // step between minor ticks
    // Floor strategy for the first minor tick: a time unit + increment, or a calendar unit.
    smallestUnit?: 'minute' | 'hour';
    roundingIncrement?: number;
    calendar?: CalendarUnit;
    minor: MinorKind;
    context: ContextKind;
}

const min = 60, hour = 3600, day = 86400;

// Calendar tiers cover 1 minute and coarser. Anything finer uses the relative-style sub-minute
// path. The top row therefore never goes deeper than the date in this table.
const tiers: Tier[] = [
    { seconds: 1 * min, duration: { minutes: 1 }, smallestUnit: 'minute', roundingIncrement: 1, minor: 'hourMinute', context: 'day' },
    { seconds: 2 * min, duration: { minutes: 2 }, smallestUnit: 'minute', roundingIncrement: 2, minor: 'hourMinute', context: 'day' },
    { seconds: 5 * min, duration: { minutes: 5 }, smallestUnit: 'minute', roundingIncrement: 5, minor: 'hourMinute', context: 'day' },
    { seconds: 10 * min, duration: { minutes: 10 }, smallestUnit: 'minute', roundingIncrement: 10, minor: 'hourMinute', context: 'day' },
    { seconds: 15 * min, duration: { minutes: 15 }, smallestUnit: 'minute', roundingIncrement: 15, minor: 'hourMinute', context: 'day' },
    { seconds: 30 * min, duration: { minutes: 30 }, smallestUnit: 'minute', roundingIncrement: 30, minor: 'hourMinute', context: 'day' },
    { seconds: 1 * hour, duration: { hours: 1 }, smallestUnit: 'hour', roundingIncrement: 1, minor: 'hourMinute', context: 'day' },
    { seconds: 2 * hour, duration: { hours: 2 }, smallestUnit: 'hour', roundingIncrement: 2, minor: 'hourMinute', context: 'day' },
    { seconds: 3 * hour, duration: { hours: 3 }, smallestUnit: 'hour', roundingIncrement: 3, minor: 'hourMinute', context: 'day' },
    { seconds: 6 * hour, duration: { hours: 6 }, smallestUnit: 'hour', roundingIncrement: 6, minor: 'hourMinute', context: 'day' },
    { seconds: 12 * hour, duration: { hours: 12 }, smallestUnit: 'hour', roundingIncrement: 12, minor: 'hourMinute', context: 'day' },
    { seconds: 1 * day, duration: { days: 1 }, calendar: 'day', minor: 'monthDay', context: 'year' },
    { seconds: 30 * day, duration: { months: 1 }, calendar: 'month', minor: 'month', context: 'year' },
    { seconds: 365 * day, duration: { years: 1 }, calendar: 'year', minor: 'year', context: null },
];

// Target spacing between bottom-row (minor) ticks. Roughly matches the old axis, which labelled a
// subdivision every ~250px; the coarse "context" row sits above at the next natural unit.
const targetMinorPx = 250;

function pickTier(pxPerSecond: number): Tier {
    return tiers.reduce((best, tier) =>
        Math.abs(tier.seconds * pxPerSecond - targetMinorPx) < Math.abs(best.seconds * pxPerSecond - targetMinorPx) ? tier : best,
        tiers[0]);
}

function resolveZone(timeZone: string): string {
    return timeZone === 'local' || timeZone === '' ? Temporal.Now.timeZoneId() : timeZone;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function getFormatter(zone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = zone + '|' + JSON.stringify(opts);
    let fmt = formatterCache.get(key);
    if (!fmt) {
        fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hour12: false, ...opts });
        formatterCache.set(key, fmt);
    }
    return fmt;
}

// en-CA joins date and time with ", "; normalise to a plain space for ISO-style output.
function formatLabel(fmt: Intl.DateTimeFormat, epochMs: number): string {
    return fmt.format(new Date(epochMs)).replace(/,\s+/g, ' ');
}

const dateHourMinuteOpts: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
};

function floorToTierBoundary(zdt: Temporal.ZonedDateTime, tier: Tier): Temporal.ZonedDateTime {
    if (tier.calendar === 'day') return zdt.startOfDay();
    if (tier.calendar === 'month') return zdt.with({ day: 1 }).startOfDay();
    if (tier.calendar === 'year') return zdt.with({ month: 1, day: 1 }).startOfDay();
    return zdt.round({ smallestUnit: tier.smallestUnit!, roundingIncrement: tier.roundingIncrement!, roundingMode: 'floor' });
}

// Bottom-row label: only the tick unit, so it reads as a continuation of the top row.
function minorLabel(zone: string, kind: MinorKind, tick: Temporal.ZonedDateTime): string {
    switch (kind) {
        case 'hourMinute': return formatLabel(getFormatter(zone, { hour: '2-digit', minute: '2-digit' }), tick.epochMilliseconds);
        case 'monthDay': return formatLabel(getFormatter(zone, { month: '2-digit', day: '2-digit' }), tick.epochMilliseconds);
        case 'month': return formatLabel(getFormatter(zone, { month: '2-digit' }), tick.epochMilliseconds);
        case 'year': return formatLabel(getFormatter(zone, { year: 'numeric' }), tick.epochMilliseconds);
    }
}

// Top-row context: the coarse prefix above the tick unit, refreshed at each `unit` boundary.
const contextStep: Record<NonNullable<ContextKind>, Temporal.DurationLike> = {
    day: { days: 1 }, year: { years: 1 },
};
const contextOpts: Record<NonNullable<ContextKind>, Intl.DateTimeFormatOptions> = {
    day: { year: 'numeric', month: '2-digit', day: '2-digit' },
    year: { year: 'numeric' },
};

function floorToContext(zdt: Temporal.ZonedDateTime, context: NonNullable<ContextKind>): Temporal.ZonedDateTime {
    switch (context) {
        case 'day': return zdt.startOfDay();
        case 'year': return zdt.with({ month: 1, day: 1 }).startOfDay();
    }
}

// Calendar regime (tick unit >= 1 minute): two-tier date context + time/date ticks.
function getCalendarTicks(state: WaveformState, width: number, zone: string): AxisTicks {
    const { pxPerSecond, offset: startPx, referenceWallTime: ref } = state;
    const tier = pickTier(pxPerSecond);

    const xForEpochMs = (epochMs: number): number => (epochMs / 1000 - ref) * pxPerSecond - startPx;
    const leftWall = ref + startPx / pxPerSecond;
    const leftZdt = Temporal.Instant.fromEpochNanoseconds(BigInt(Math.round(leftWall * 1e9))).toZonedDateTimeISO(zone);

    const minor: AxisTick[] = [];
    let tick = floorToTierBoundary(leftZdt, tier);
    for (let guard = 0; guard < 10000; guard++) {
        const x = xForEpochMs(tick.epochMilliseconds);
        if (x > width) break;
        if (x >= 0) minor.push({ x, label: minorLabel(zone, tier.minor, tick) });
        tick = tick.add(tier.duration);
    }

    const major: AxisTick[] = [];
    if (tier.context) {
        const ctxFmt = getFormatter(zone, contextOpts[tier.context]);
        const step = contextStep[tier.context];
        // Start one context boundary left of the viewport so major[0] drives the sticky label.
        let ctx = floorToContext(leftZdt, tier.context);
        for (let guard = 0; guard < 10000; guard++) {
            const x = xForEpochMs(ctx.epochMilliseconds);
            if (x > width) break;
            major.push({ x, label: formatLabel(ctxFmt, ctx.epochMilliseconds) });
            ctx = ctx.add(step);
        }
    }
    return { major, minor };
}

// Sub-minute regime (tick unit < 1 minute): the same relative-time display as relative mode
// (shared splitTicks), but anchored to the wall clock. The major shows 'yyyy-mm-dd hh:mm' plus the
// relative split of the sub-minute remainder (e.g. ' 30s', ' 30s 500ms'); the bottom row is the
// shared '+10s', '+1s' … offsets. This keeps the top no deeper than hh:mm and shows ms/µs cheaply.
function getRealtimeSplitTicks(state: WaveformState, width: number, zone: string): AxisTicks {
    const ref = state.referenceWallTime;
    const dateFmt = getFormatter(zone, dateHourMinuteOpts);
    const refModMinute = ref - Math.floor(ref / 60) * 60; // ref mod 60, for the remainder split

    return splitTicks(
        state,
        width,
        // Align majors to wall-clock multiples of the grid spacing (which divide a minute).
        gridSpacing => ref - Math.floor(ref / gridSpacing) * gridSpacing,
        (b, gridSpacing) => {
            const dateHHMM = formatLabel(dateFmt, Math.round((ref + b) * 1000));
            const splitScale = getTimeUnitAndScale(gridSpacing).scale;
            let remainder = (refModMinute + b) % 60; // seconds within the minute, [0, 60)
            if (remainder < 0) remainder += 60;
            return remainder > splitScale / 2 ? `${dateHHMM} ${formatSplitTimeLabel(remainder, splitScale)}` : dateHHMM;
        },
    );
}

function getRealtimeTicks(state: WaveformState, width: number): AxisTicks {
    const zone = resolveZone(state.timeZone);
    // getGridSpacing chooses the ~2500px "major" spacing of the relative display. When that is
    // sub-minute, use the relative-style split; otherwise use the calendar two-tier layout.
    const gridSpacing = getGridSpacing(state.pxPerSecond);
    return gridSpacing <= 60
        ? getRealtimeSplitTicks(state, width, zone)
        : getCalendarTicks(state, width, zone);
}

// ---------------------------------------------------------------------------------------------

export function getAxisTicks(state: WaveformState, width: number): AxisTicks {
    return state.timeMode === 'realtime' ? getRealtimeTicks(state, width) : getRelativeTicks(state, width);
}
