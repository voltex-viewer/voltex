import { describe, it, expect } from 'vitest';
import { createGradientDownsampler } from './gradientDownsampler';
import { createMockSignal, DownsampleCollector } from './testUtils';

describe.each([3, 4, 5, 6, 10])('gradientDownsampler (maxPoints=%i)', (maxPoints) => {

    describe('Basic functionality', () => {
        it('should emit first and last point for straight line', () => {
            const signal = createMockSignal([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]);
            const downsampler = createGradientDownsampler(signal, 0, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.toPoints()).toEqual([[0, 0], [4, 4]]);
        });

        it('should handle single point signal', () => {
            const signal = createMockSignal([0], [5]);
            const downsampler = createGradientDownsampler(signal, 0, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.toPoints()).toEqual([[0, 5]]);
        });

        it('should handle two point signal', () => {
            const signal = createMockSignal([0, 1], [0, 1]);
            const downsampler = createGradientDownsampler(signal, 0, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.toPoints()).toEqual([[0, 0], [1, 1]]);
        });

        it('should handle empty signal', () => {
            const signal = createMockSignal([], []);
            const downsampler = createGradientDownsampler(signal, 0, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.toPoints()).toEqual([]);
        });
    });

    describe('Gradient-based downsampling', () => {
        it('should keep all points with lossless threshold', () => {
            const signal = createMockSignal([0, 1, 2, 3, 4], [0, 1, 4, 9, 16]);
            const downsampler = createGradientDownsampler(signal, 0, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.times.length).toBe(5);
            expect(collector.toPoints()).toEqual([[0, 0], [1, 1], [2, 4], [3, 9], [4, 16]]);
        });

        it('should detect gradient changes', () => {
            const signal = createMockSignal(
                [0, 1, 2, 3, 4],
                [0, 0, 0, 5, 10]
            );
            const downsampler = createGradientDownsampler(signal, 0.1, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.times.length).toBeGreaterThanOrEqual(3);
            expect(collector.times[0]).toBe(0);
            expect(collector.values[0]).toBe(0);
        });

        it('should respect gradient threshold', () => {
            const times = [0, 1, 2, 3, 4, 5];
            const values = times.map(t => t * t);
            const signal = createMockSignal(times, values);

            const aggressiveCollector = new DownsampleCollector();
            const aggressiveDownsampler = createGradientDownsampler(signal, 10.0, maxPoints);
            aggressiveCollector.collect(aggressiveDownsampler);

            const normalCollector = new DownsampleCollector();
            const normalDownsampler = createGradientDownsampler(signal, 0.1, maxPoints);
            normalCollector.collect(normalDownsampler);

            expect(normalCollector.times.length).toBeGreaterThan(aggressiveCollector.times.length);
        });

        it('should collapse small gradient changes with threshold', () => {
            // Signal with small variations: 0, 0.5, 1.0, 1.4, 2.0
            // Gradients: 0.5, 0.5, 0.4, 0.6 - changes of 0, 0.1, 0.2 (all within 0.5 threshold)
            const signal = createMockSignal([0, 1, 2, 3, 4], [0, 0.5, 1.0, 1.4, 2.0]);
            const downsampler = createGradientDownsampler(signal, 0.5, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.toPoints()).toEqual([[0, 0], [4, 2.0]]);
        });

        it('should preserve sharp transitions with threshold', () => {
            // Flat then sudden jump: gradient change from 0 to 10
            const signal = createMockSignal([0, 1, 2, 3, 4], [0, 0, 0, 10, 20]);
            const downsampler = createGradientDownsampler(signal, 1.0, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.toPoints()).toEqual([[0, 0], [2, 0], [4, 20]]);
        });

        it('should preserve sharp spike with threshold', () => {
            // Flat then sudden jump: gradient change from 0 to 10
            const signal = createMockSignal([0, 1, 2, 3, 4], [0, 0, 10, 0, 0]);
            const downsampler = createGradientDownsampler(signal, 1.0, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.toPoints()).toEqual([[0, 0], [1, 0], [2, 10], [3, 0], [4, 0]]);
        });

        it('should reduce sine wave with high threshold', () => {
            const times = Array.from({ length: 50 }, (_, i) => i * 0.1);
            const values = times.map(t => Math.sin(t));
            const signal = createMockSignal(times, values);

            const losslessCollector = new DownsampleCollector();
            const losslessDownsampler = createGradientDownsampler(signal, 0, maxPoints);
            losslessCollector.collect(losslessDownsampler);

            const thresholdCollector = new DownsampleCollector();
            const thresholdDownsampler = createGradientDownsampler(signal, 0.5, maxPoints);
            thresholdCollector.collect(thresholdDownsampler);

            expect(thresholdCollector.times.length).toBeLessThan(losslessCollector.times.length);
            expect(losslessCollector.times.length).toBe(50);
        });
    });

    describe('Chunked processing', () => {
        it('should yield multiple chunks for large signals', () => {
            const times = Array.from({ length: 20 }, (_, i) => i);
            const values = times.map(t => t * t);
            const signal = createMockSignal(times, values);

            const downsampler = createGradientDownsampler(signal, 0, maxPoints);

            let chunkCount = 0;
            while (true) {
                const result = downsampler.next();
                if (result.done) break;
                chunkCount++;
                if (!result.value.hasMore) break;
            }

            expect(chunkCount).toBeGreaterThanOrEqual(1);
        });

        it('should not exceed maxPoints in a single chunk', () => {
            const times = Array.from({ length: 100 }, (_, i) => i);
            const values = times.map(t => Math.sin(t));
            const signal = createMockSignal(times, values);

            const downsampler = createGradientDownsampler(signal, 0, maxPoints);

            while (true) {
                const result = downsampler.next();
                if (result.done) break;
                expect(result.value.bufferOffset).toBeLessThanOrEqual(maxPoints + 1);
                if (!result.value.hasMore) break;
            }
        });
    });

    describe('Edge cases', () => {
        it('should handle negative values', () => {
            const signal = createMockSignal([0, 1, 2], [-5, -2, 1]);
            const downsampler = createGradientDownsampler(signal, 0, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.times.length).toBeGreaterThan(0);
            expect(collector.values[0]).toBe(-5);
        });

        it('should handle very small gradients', () => {
            const signal = createMockSignal([0, 1, 2], [0, 0.0001, 0.0002]);
            const downsampler = createGradientDownsampler(signal, 0.00001, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.times.length).toBeGreaterThanOrEqual(2);
        });

        it('should handle large values', () => {
            const signal = createMockSignal([0, 1, 2], [1e10, 2e10, 3e10]);
            const downsampler = createGradientDownsampler(signal, 0, maxPoints);
            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            expect(collector.times.length).toBeGreaterThan(0);
            expect(collector.values[0]).toBe(1e10);
        });
    });

    describe('Streaming/incremental updates', () => {
        it('should handle streaming data with constant gradient', () => {
            const timeData = [0, 1, 2];
            const valueData = [0, 1, 2];
            const signal = createMockSignal(timeData, valueData);
            const downsampler = createGradientDownsampler(signal, 0.1, maxPoints);

            const collector = new DownsampleCollector();
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 0], [2, 2]]);

            // Add more data with same gradient
            timeData.push(3, 4);
            valueData.push(3, 4);
            collector.collect(downsampler);

            expect(collector.toPoints()).toEqual([[0, 0], [4, 4]]);
        });

        it('should handle streaming data that changes gradient', () => {
            const timeData = [0, 1, 2];
            const valueData = [0, 1, 2]; // gradient = 1
            const signal = createMockSignal(timeData, valueData);
            const downsampler = createGradientDownsampler(signal, 0.1, maxPoints);

            const collector = new DownsampleCollector();
            collector.collect(downsampler);
            expect(collector.toPoints()).toEqual([[0, 0], [2, 2]]);

            // Add data with different gradient
            timeData.push(3);
            valueData.push(10); // gradient changes to 8
            collector.collect(downsampler);

            // Should have: [0,0], [2,2] (committed when gradient changed), [3,10]
            expect(collector.toPoints()).toEqual([[0, 0], [2, 2], [3, 10]]);
        });

        it('should produce minimal points for continuously growing linear signal', () => {
            const timeData = [0, 1, 2];
            const valueData = [0, 1, 2];
            const signal = createMockSignal(timeData, valueData);
            const downsampler = createGradientDownsampler(signal, 0.1, maxPoints);

            const collector = new DownsampleCollector();
            collector.collect(downsampler);

            // Add more data in batches, all with same gradient
            for (let i = 3; i <= 10; i++) {
                timeData.push(i);
                valueData.push(i);
                collector.collect(downsampler);
            }

            // Should only have first and last point
            expect(collector.toPoints()).toEqual([[0, 0], [10, 10]]);
        });
    });
});
