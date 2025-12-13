import { describe, it, expect } from 'vitest';
import { createEnumDownsampler } from './enumDownsampler';
import { createMockSignal, DownsampleCollector } from './testUtils';

describe.each([1, 2, 3, 4, 5, 6])('enumDownsampler (maxPoints=%i)', (maxPoints) => {

    describe('Basic functionality', () => {
        it('should emit transition points for enum signal', () => {
            const signal = createMockSignal([0, 1, 2, 3, 4], [1, 1, 2, 2, 2]);
            const downsampler = createEnumDownsampler(signal, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.toPoints()).toEqual([[0, 1], [2, 2], [4, 2]]);
        });

        it('should handle signal with all same values', () => {
            const signal = createMockSignal([0, 1, 2, 3], [5, 5, 5, 5]);
            const downsampler = createEnumDownsampler(signal, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.toPoints()).toEqual([[0, 5], [3, 5]]);
        });

        it('should handle signal with all different values', () => {
            const signal = createMockSignal([0, 1, 2, 3], [1, 2, 3, 4]);
            const downsampler = createEnumDownsampler(signal, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.toPoints()).toEqual([[0, 1], [1, 2], [2, 3], [3, 4]]);
        });

        it('should handle single point signal', () => {
            const signal = createMockSignal([0], [5]);
            const downsampler = createEnumDownsampler(signal, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.toPoints()).toEqual([[0, 5]]);
        });

        it('should handle empty signal', () => {
            const signal = createMockSignal([], []);
            const downsampler = createEnumDownsampler(signal, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.toPoints()).toEqual([]);
        });
    });

    describe('Growing signal with extension overwrite', () => {
        it('should correctly extend when signal grows with same value', () => {
            const timeData = [0, 1, 2];
            const valueData = [1, 1, 1];
            const signal = createMockSignal(timeData, valueData);
            const downsampler = createEnumDownsampler(signal, maxPoints);
            const collector = new DownsampleCollector();

            // First collection
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [2, 1]]);

            // Grow signal with same value
            timeData.push(3, 4);
            valueData.push(1, 1);

            // Second collection should overwrite extension
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [4, 1]]);
        });

        it('should correctly extend when signal grows with new value', () => {
            const timeData = [0, 1, 2];
            const valueData = [1, 1, 1];
            const signal = createMockSignal(timeData, valueData);
            const downsampler = createEnumDownsampler(signal, maxPoints);
            const collector = new DownsampleCollector();

            // First collection
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [2, 1]]);

            // Grow signal with new value
            timeData.push(3, 4);
            valueData.push(2, 2);

            // Second collection should add transition and new extension
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [3, 2], [4, 2]]);
        });

        it('should handle multiple growth cycles', () => {
            const timeData = [0];
            const valueData = [1];
            const signal = createMockSignal(timeData, valueData);
            const downsampler = createEnumDownsampler(signal, maxPoints);
            const collector = new DownsampleCollector();

            // Initial
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1]]);

            // Grow with same value
            timeData.push(1, 2);
            valueData.push(1, 1);
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [2, 1]]);

            // Grow with new value
            timeData.push(3);
            valueData.push(2);
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [3, 2]]);

            // Grow with same value again
            timeData.push(4, 5);
            valueData.push(2, 2);
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [3, 2], [5, 2]]);
        });

        it('should handle multiple growth cycles', () => {
            const timeData = [0];
            const valueData = [1];
            const signal = createMockSignal(timeData, valueData);
            const downsampler = createEnumDownsampler(signal, maxPoints);
            const collector = new DownsampleCollector();

            // Initial
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1]]);

            // Grow with same value
            timeData.push(1);
            valueData.push(1);
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [1, 1]]);

            // Grow with same value
            timeData.push(2);
            valueData.push(1);
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [2, 1]]);

            // Grow with new value
            timeData.push(3);
            valueData.push(2);
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [3, 2]]);

            // Grow with same value again
            timeData.push(4);
            valueData.push(2);
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [3, 2], [4, 2]]);

            // Grow with same value again
            timeData.push(5);
            valueData.push(2);
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [3, 2], [5, 2]]);
        });

        it('should handle multiple growth cycles with done continuation', () => {
            const timeData = [0];
            const valueData = [1];
            const signal = createMockSignal(timeData, valueData);
            const downsampler = createEnumDownsampler(signal, maxPoints);
            const collector = new DownsampleCollector();

            // Initial
            collector.collect(downsampler);
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1]]);

            // Grow with same value
            timeData.push(1);
            valueData.push(1);
            collector.collect(downsampler);
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [1, 1]]);

            // Grow with same value
            timeData.push(2);
            valueData.push(1);
            collector.collect(downsampler);
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [2, 1]]);

            // Grow with new value
            timeData.push(3);
            valueData.push(2);
            collector.collect(downsampler);
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [3, 2]]);

            // Grow with same value again
            timeData.push(4);
            valueData.push(2);
            collector.collect(downsampler);
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [3, 2], [4, 2]]);

            // Grow with same value again
            timeData.push(5);
            valueData.push(2);
            collector.collect(downsampler);
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [3, 2], [5, 2]]);
        });

        it('should not produce duplicate points when growing', () => {
            const timeData = [0, 1, 2, 3];
            const valueData = [1, 1, 2, 2];
            const signal = createMockSignal(timeData, valueData);
            const downsampler = createEnumDownsampler(signal, maxPoints);
            const collector = new DownsampleCollector();

            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [2, 2], [3, 2]]);

            // Grow with same value - should NOT create duplicate at t=3
            timeData.push(4, 5);
            valueData.push(2, 2);
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 1], [2, 2], [5, 2]]);
        });
    });

    describe('Chunked processing', () => {
        it('should yield multiple chunks for large signals', () => {
            // All same value - only transitions at start, rest are extensions
            const timeData = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
            const valueData = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
            const signal = createMockSignal(timeData, valueData);
            const downsampler = createEnumDownsampler(signal, maxPoints);
            const collector = new DownsampleCollector();

            collector.collect(downsampler);
            // Should have initial transition and final extension
            expect(collector.toPoints()).toEqual([[0, 1], [9, 1]]);
        });

        it('should preserve all transitions', () => {
            // Alternating values - every point is a transition
            const timeData = [0, 1, 2, 3, 4, 5];
            const valueData = [0, 1, 0, 1, 0, 1];
            const signal = createMockSignal(timeData, valueData);
            const downsampler = createEnumDownsampler(signal, maxPoints);
            const collector = new DownsampleCollector();

            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 0], [1, 1], [2, 0], [3, 1], [4, 0], [5, 1]]);
        });
    });
});
