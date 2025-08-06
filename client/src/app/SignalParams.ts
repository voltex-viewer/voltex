export class SignalParams {
    duration = 1000; // seconds
    freq = 1; // Hz
    samples = 1000; // for smoothness
    pxPerSecond = 200; // initial zoom: 200px per second
    minPxPerSecond = 1e-9; // allow infinite zoom out
    maxPxPerSecond = 1e12; // allow infinite zoom in
    constructor() { }
    getTotalSignalPixels() {
        return this.pxPerSecond * this.duration;
    }
}
