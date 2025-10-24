import { describe, it, expect, beforeEach } from 'vitest';
import type { Signal } from '@voltex-viewer/plugin-api';
import { createGradientDownsampler } from './gradientDownsampler';

// Mock Signal interface for testing
interface MockArrayLike {
    length: number;
    valueAt: (index: number) => number;
}

function createMockSignal(timeData: number[], valueData: number[]): Signal {
    return {
        time: {
            length: timeData.length,
            valueAt: (index: number) => timeData[index],
        } as MockArrayLike,
        values: {
            length: valueData.length,
            valueAt: (index: number) => valueData[index],
        } as MockArrayLike,
    } as Signal;
}

describe('gradientDownsampler', () => {
    const maxPoints = 4096;
    let timeBuffer: Float32Array;
    let valueBuffer: Float32Array;
    let gradientDownsampler: ReturnType<typeof createGradientDownsampler>;

    beforeEach(() => {
        timeBuffer = new Float32Array(maxPoints);
        valueBuffer = new Float32Array(maxPoints);
        gradientDownsampler = createGradientDownsampler(maxPoints, timeBuffer, valueBuffer);
    });

    describe('Basic functionality', () => {
        it('should emit first point', () => {
            const signal = createMockSignal([0, 1, 2], [0, 1, 2]);
            const result = gradientDownsampler(signal, 0, 3, 0.1);

            expect(timeBuffer[0]).toBe(0);
            expect(valueBuffer[0]).toBe(0);
        });

        it('should emit last point', () => {
            const signal = createMockSignal([0, 1, 2], [0, 1, 2]);
            const result = gradientDownsampler(signal, 0, 3, 0.1);

            expect(result.signalIndex).toBe(3);
            expect(timeBuffer[result.bufferOffset - 1]).toBe(2);
            expect(valueBuffer[result.bufferOffset - 1]).toBe(2);
        });

        it('should process all points with threshold 0 (lossless)', () => {
            const signal = createMockSignal([0, 1, 2, 3, 4], [0, 1, 4, 9, 16]);
            const result = gradientDownsampler(signal, 0, 5, 0);

            // Should emit all points where gradient changes (parabola has changing gradient)
            expect(result.signalIndex).toBe(5);
            expect(result.bufferOffset).toBeGreaterThan(2);
            
            // First and last points should always be included
            expect(timeBuffer[0]).toBe(0);
            expect(valueBuffer[0]).toBe(0);
            expect(timeBuffer[result.bufferOffset - 1]).toBe(4);
            expect(valueBuffer[result.bufferOffset - 1]).toBe(16);
        });

        it('should handle single point signal', () => {
            const signal = createMockSignal([0], [5]);
            const result = gradientDownsampler(signal, 0, 1, 0.1);

            expect(result.bufferOffset).toBe(1);
            expect(result.signalIndex).toBe(1);
            expect(timeBuffer[0]).toBe(0);
            expect(valueBuffer[0]).toBe(5);
        });

        it('should handle two point signal', () => {
            const signal = createMockSignal([0, 1], [0, 1]);
            const result = gradientDownsampler(signal, 0, 2, 0.1);

            expect(result.bufferOffset).toBe(2);
            expect(result.signalIndex).toBe(2);
            expect(timeBuffer[0]).toBe(0);
            expect(valueBuffer[0]).toBe(0);
            expect(timeBuffer[1]).toBe(1);
            expect(valueBuffer[1]).toBe(1);
        });
    });

    describe('Gradient-based downsampling', () => {
        it('should keep points with constant gradient (straight line)', () => {
            // Straight line: y = x
            const signal = createMockSignal([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]);
            const result = gradientDownsampler(signal, 0, 5, 0.1);

            // With constant gradient, should only keep first and last
            expect(result.bufferOffset).toBe(2);
            expect(timeBuffer[0]).toBe(0);
            expect(valueBuffer[0]).toBe(0);
            expect(timeBuffer[1]).toBe(4);
            expect(valueBuffer[1]).toBe(4);
        });

        it('should detect gradient changes', () => {
            // Line changes slope: flat -> steep
            const signal = createMockSignal(
                [0, 1, 2, 3, 4],
                [0, 0, 0, 5, 10]
            );
            const result = gradientDownsampler(signal, 0, 5, 0.1);

            // Should keep first point, point where gradient changes (index 3), and last
            expect(result.bufferOffset).toBeGreaterThanOrEqual(3);
            expect(timeBuffer[0]).toBe(0);
            expect(valueBuffer[0]).toBe(0);
        });

        it('should respect gradient threshold', () => {
            // Parabola: y = x²
            const times = [0, 1, 2, 3, 4, 5];
            const values = times.map(t => t * t);
            const signal = createMockSignal(times, values);

            // Aggressive threshold should keep fewer points
            const resultAggressive = gradientDownsampler(signal, 0, 6, 10.0);
            timeBuffer.fill(0);
            valueBuffer.fill(0);
            
            // Normal threshold should keep more points
            const resultNormal = gradientDownsampler(signal, 0, 6, 0.1);

            expect(resultNormal.bufferOffset).toBeGreaterThan(resultAggressive.bufferOffset);
        });

        it('should handle zero time delta gracefully', () => {
            // Two points at same time (edge case)
            const signal = createMockSignal([0, 0, 1], [0, 5, 10]);
            const result = gradientDownsampler(signal, 0, 3, 0.1);

            expect(result.bufferOffset).toBeGreaterThan(0);
            expect(result.signalIndex).toBe(3);
        });
    });

    describe('Chunked processing (maxPoints boundary)', () => {
        it('should handle chunked processing across multiple calls', () => {
            // Create signal with varying gradients that will produce many points
            const signalLength = maxPoints + 1000;
            const times = Array.from({ length: signalLength }, (_, i) => i);
            // Use random-ish values to ensure gradient changes frequently
            const values = Array.from({ length: signalLength }, (_, i) => Math.sin(i * 0.5) * 1000 + Math.cos(i * 0.3) * 500);
            const signal = createMockSignal(times, values);

            // Process with threshold 0 to capture all gradient changes
            let result = gradientDownsampler(signal, 0, signalLength, 0);
            
            // With varying signal, should process many points
            expect(result.signalIndex).toBeGreaterThan(0);
            expect(result.bufferOffset).toBeGreaterThan(0);
            expect(result.bufferOffset).toBeLessThanOrEqual(maxPoints);
            
            // If we didn't finish, we should be able to continue
            if (result.signalIndex < signalLength) {
                const secondResult = gradientDownsampler(signal, result.signalIndex, signalLength, 0);
                expect(secondResult.signalIndex).toBeGreaterThan(result.signalIndex);
            }
        });

        it('should continue from previous signalIndex', () => {
            const times = [0, 1, 2, 3, 4, 5];
            const values = [0, 1, 2, 3, 4, 5];
            const signal = createMockSignal(times, values);

            // Process starting from middle
            const result = gradientDownsampler(signal, 3, 6, 0.1);

            expect(timeBuffer[0]).toBe(3);
            expect(valueBuffer[0]).toBe(3);
            expect(result.signalIndex).toBe(6);
        });

        it('should emit correct first point when resuming', () => {
            const times = [0, 1, 2, 3, 4];
            const values = [0, 2, 4, 6, 8];
            const signal = createMockSignal(times, values);

            // Start from index 2
            const result = gradientDownsampler(signal, 2, 5, 0.1);

            // First point in buffer should be the point at index 2
            expect(timeBuffer[0]).toBe(2);
            expect(valueBuffer[0]).toBe(4);
        });
    });

    describe('Edge cases', () => {
        it('should handle very small threshold (near-lossless)', () => {
            const signal = createMockSignal(
                [0, 1, 2, 3, 4],
                [0, 1.0, 2.0, 3.0, 4.0]
            );
            const result = gradientDownsampler(signal, 0, 5, 0.001);

            // Straight line with constant gradient - should only emit first and last
            expect(result.bufferOffset).toBe(2);
            expect(timeBuffer[0]).toBe(0);
            expect(timeBuffer[1]).toBe(4);
        });

        it('should handle large threshold (aggressive)', () => {
            const signal = createMockSignal(
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
            );
            const result = gradientDownsampler(signal, 0, 11, 10);

            // With large threshold and constant gradient, should only keep first and last
            expect(result.bufferOffset).toBe(2);
            expect(timeBuffer[0]).toBe(0);
            expect(timeBuffer[1]).toBe(10);
        });

        it('should handle negative values', () => {
            const signal = createMockSignal(
                [0, 1, 2, 3, 4],
                [0, -5, -10, -5, 0]
            );
            const result = gradientDownsampler(signal, 0, 5, 0.1);

            expect(result.bufferOffset).toBeGreaterThan(0);
            expect(result.signalIndex).toBe(5);
            expect(timeBuffer[0]).toBe(0);
            expect(valueBuffer[0]).toBe(0);
        });

        it('should handle oscillating signal', () => {
            // Sine-like wave
            const signal = createMockSignal(
                [0, 1, 2, 3, 4, 5, 6],
                [0, 1, 0, -1, 0, 1, 0]
            );
            const result = gradientDownsampler(signal, 0, 7, 0.1);

            // Should detect the direction changes - at least first, some peaks/valleys, and last
            expect(result.bufferOffset).toBeGreaterThanOrEqual(3);
            expect(timeBuffer[0]).toBe(0);
            expect(timeBuffer[result.bufferOffset - 1]).toBe(6);
        });

        it('should handle sawtooth signal correctly', () => {
            // Sawtooth: ramps up then drops sharply
            const signal = createMockSignal(
                [0, 1, 2, 3, 4, 5, 6, 7, 8],
                [0, 1, 2, 3, 0, 1, 2, 3, 0]
            );
            const result = gradientDownsampler(signal, 0, 9, 0.1);

            // Should detect peaks (3, 7) and valleys (0, 4, 8)
            // Expected: [0,0], [3,3], [4,0], [7,3], [8,0]
            expect(result.bufferOffset).toBeGreaterThanOrEqual(5);
            expect(timeBuffer[0]).toBe(0);
            expect(valueBuffer[0]).toBe(0);
            expect(timeBuffer[result.bufferOffset - 1]).toBe(8);
            expect(valueBuffer[result.bufferOffset - 1]).toBe(0);
            
            // Check that we captured the peaks and valleys
            const values = Array.from({ length: result.bufferOffset }, (_, i) => valueBuffer[i]);
            expect(values).toContain(3); // Peak
            expect(values.filter(v => v === 0).length).toBeGreaterThanOrEqual(2); // Valleys
        });
    });

    describe('Buffer boundary conditions', () => {
        it('should not overflow buffer', () => {
            // Create signal with more points than buffer can hold
            const hugeLength = maxPoints * 2;
            const times = Array.from({ length: hugeLength }, (_, i) => i);
            const values = Array.from({ length: hugeLength }, (_, i) => Math.sin(i));
            const signal = createMockSignal(times, values);

            const result = gradientDownsampler(signal, 0, hugeLength, 0);

            expect(result.bufferOffset).toBeLessThanOrEqual(maxPoints);
            expect(result.signalIndex).toBeLessThan(hugeLength);
        });

        it('should stop at maxPoints boundary', () => {
            // Create signal that will definitely fill buffer
            const length = maxPoints * 2;
            const times = Array.from({ length }, (_, i) => i);
            const values = Array.from({ length }, (_, i) => i);
            const signal = createMockSignal(times, values);

            const result = gradientDownsampler(signal, 0, length, 0);

            expect(result.bufferOffset).toBeLessThanOrEqual(maxPoints);
        });
    });

    describe('Correctness verification', () => {
        it('should preserve signal shape characteristics', () => {
            // Step function
            const signal = createMockSignal(
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
                [0, 0, 0, 0, 5, 5, 5, 5, 10, 10]
            );
            const result = gradientDownsampler(signal, 0, 10, 0.1);

            // Should capture the step changes
            const uniqueValues = new Set(
                Array.from({ length: result.bufferOffset }, (_, i) => valueBuffer[i])
            );
            expect(uniqueValues.has(0)).toBe(true);
            expect(uniqueValues.has(5)).toBe(true);
            expect(uniqueValues.has(10)).toBe(true);
        });

        it('should maintain temporal order', () => {
            const signal = createMockSignal(
                [0, 1, 2, 3, 4, 5],
                [0, 5, 2, 8, 1, 9]
            );
            const result = gradientDownsampler(signal, 0, 6, 0.1);

            // Times should be monotonically increasing
            for (let i = 1; i < result.bufferOffset; i++) {
                expect(timeBuffer[i]).toBeGreaterThan(timeBuffer[i - 1]);
            }
        });

        it('should not create points that did not exist in original signal', () => {
            const times = [0, 1, 2, 3, 4];
            const values = [10, 20, 30, 40, 50];
            const signal = createMockSignal(times, values);
            
            const result = gradientDownsampler(signal, 0, 5, 0.1);

            // Every point in the buffer should exist in the original signal
            for (let i = 0; i < result.bufferOffset; i++) {
                const time = timeBuffer[i];
                const value = valueBuffer[i];
                const originalIndex = times.indexOf(time);
                expect(originalIndex).toBeGreaterThanOrEqual(0);
                expect(values[originalIndex]).toBe(value);
            }
        });
    });
});
