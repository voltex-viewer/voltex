// Ambient declaration so `Temporal` is usable as a global value and namespace type, mirroring the
// future native API. The runtime global is installed by installTemporal.ts.
import { Temporal as TemporalPolyfill } from '@js-temporal/polyfill';

declare global {
    export import Temporal = TemporalPolyfill;
}
