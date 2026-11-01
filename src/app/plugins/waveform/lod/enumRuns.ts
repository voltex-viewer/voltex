import type { LodGeometry } from './lodView';

function grow(array: Float64Array, length: number): Float64Array<ArrayBuffer> {
    const grown = new Float64Array(length);
    grown.set(array);
    return grown;
}

// Consecutive points with the same value merged into runs, for drawing enum signals from LOD geometry
export class EnumRuns {
    private starts = new Float64Array(256);
    private values = new Float64Array(256);
    private hiddenChanges = new Float64Array(256);
    // Exact values for 64-bit sources, otherwise empty
    private exactValues: (bigint | undefined)[] = [];
    private lastTime = 0;
    count = 0;

    build(geometry: LodGeometry): void {
        const { time, value, changes, exact, length } = geometry;
        this.count = 0;
        this.exactValues = [];
        for (let i = 0; i < length; i++) {
            const differs = i === 0 || value[i] !== value[i - 1];
            // Changes the points don't show belong to the run the gap starts in. NaN where unknown.
            if (i > 0) this.hiddenChanges[this.count - 1] += Math.max(0, changes[i] - (differs ? 1 : 0));
            if (differs) this.push(time[i], value[i], exact?.[i]);
        }
        this.lastTime = length > 0 ? time[length - 1] : 0;
    }

    private push(start: number, value: number, exact: bigint | undefined): void {
        if (this.count === this.starts.length) {
            this.starts = grow(this.starts, this.count * 2);
            this.values = grow(this.values, this.count * 2);
            this.hiddenChanges = grow(this.hiddenChanges, this.count * 2);
        }
        this.starts[this.count] = start;
        this.values[this.count] = value;
        this.hiddenChanges[this.count] = 0;
        if (exact !== undefined) this.exactValues[this.count] = exact;
        this.count++;
    }

    start(i: number): number {
        return this.starts[i];
    }

    end(i: number): number {
        return i + 1 < this.count ? this.starts[i + 1] : this.lastTime;
    }

    value(i: number): number {
        return this.values[i];
    }

    /** The run's exact value, for 64-bit sources. */
    exact(i: number): bigint | undefined {
        return this.exactValues[i];
    }

    /** Changes inside the run that its points don't show. NaN if unknown. */
    hidden(i: number): number {
        return this.hiddenChanges[i];
    }

    /** The first and last runs overlapping [startTime, endTime], or an empty range if there are none. */
    visibleRange(startTime: number, endTime: number): [number, number] {
        let lo = 0;
        let hi = this.count;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.end(mid) < startTime) lo = mid + 1;
            else hi = mid;
        }
        const first = lo;
        hi = this.count;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.starts[mid] <= endTime) lo = mid + 1;
            else hi = mid;
        }
        return [first, lo - 1];
    }
}
