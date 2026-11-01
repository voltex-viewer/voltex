// Reports the newest time as it was `delayMs` ago
export class DisplayDelay {
    private history: { at: number; time: number }[] = [];

    reset(newest: number): void {
        this.history = [{ at: -Infinity, time: newest }];
    }

    update(newest: number, now: number, delayMs: number): number {
        const last = this.history[this.history.length - 1];
        if (!last) {
            this.reset(newest);
        } else if (newest !== last.time) {
            this.history.push({ at: now, time: newest });
        }
        const shownAt = now - delayMs;
        while (this.history.length > 1 && this.history[1].at <= shownAt) {
            this.history.shift();
        }
        // Interpolated, so it advances smoothly however frame times jitter
        const [before, after] = this.history;
        if (!after || before.at === -Infinity) return before.time;
        return before.time + (after.time - before.time) * (shownAt - before.at) / (after.at - before.at);
    }

    get catchingUp(): boolean {
        return this.history.length > 1;
    }
}
