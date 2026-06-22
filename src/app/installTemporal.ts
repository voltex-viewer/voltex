// Polyfill Temporal API globally if needed
import { Temporal } from '@js-temporal/polyfill';

if (!('Temporal' in globalThis)) {
    (globalThis as { Temporal?: unknown }).Temporal = Temporal;
}
