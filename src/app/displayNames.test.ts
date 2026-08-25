import { describe, it, expect } from 'vitest';
import { shortestUniqueSuffixes } from './displayNames';

describe('shortestUniqueSuffixes', () => {
    it('shows only the leaf when nothing collides', () => {
        expect(shortestUniqueSuffixes([
            ['a.mf4', 'Rpm'],
            ['a.mf4', 'Speed'],
        ])).toEqual([['Rpm'], ['Speed']]);
    });

    it('adds the next part to a colliding pair', () => {
        expect(shortestUniqueSuffixes([
            ['a.mf4', 'CAN1', 'Speed'],
            ['a.mf4', 'CAN2', 'Speed'],
        ])).toEqual([['CAN1', 'Speed'], ['CAN2', 'Speed']]);
    });

    it('reaches the file name when that is the only difference', () => {
        expect(shortestUniqueSuffixes([
            ['a.mf4', 'Speed'],
            ['b.mf4', 'Speed'],
        ])).toEqual([['a.mf4', 'Speed'], ['b.mf4', 'Speed']]);
    });

    it('keeps going until the paths differ', () => {
        expect(shortestUniqueSuffixes([
            ['a.mf4', 'CAN1', 'Speed'],
            ['b.mf4', 'CAN1', 'Speed'],
        ])).toEqual([
            ['a.mf4', 'CAN1', 'Speed'],
            ['b.mf4', 'CAN1', 'Speed'],
        ]);
    });

    it('expands names that do not collide to the same depth', () => {
        expect(shortestUniqueSuffixes([
            ['a.mf4', 'CAN1', 'Speed'],
            ['a.mf4', 'CAN2', 'Speed'],
            ['a.mf4', 'CAN1', 'Rpm'],
        ])).toEqual([['CAN1', 'Speed'], ['CAN2', 'Speed'], ['CAN1', 'Rpm']]);
    });

    it('shows the file name on every signal once one collision needs it', () => {
        expect(shortestUniqueSuffixes([
            ['a.mf4', 'Voltage'],
            ['b.mf4', 'Voltage'],
            ['a.mf4', 'Current'],
        ])).toEqual([
            ['a.mf4', 'Voltage'],
            ['b.mf4', 'Voltage'],
            ['a.mf4', 'Current'],
        ]);
    });

    it('takes the depth from the deepest collision', () => {
        expect(shortestUniqueSuffixes([
            ['a.mf4', 'CAN1', 'Speed'],
            ['a.mf4', 'CAN2', 'Speed'],
            ['a.mf4', 'ECU', 'Temp'],
            ['b.mf4', 'ECU', 'Temp'],
        ])).toEqual([
            ['a.mf4', 'CAN1', 'Speed'],
            ['a.mf4', 'CAN2', 'Speed'],
            ['a.mf4', 'ECU', 'Temp'],
            ['b.mf4', 'ECU', 'Temp'],
        ]);
    });

    it('expands every member of a collision together', () => {
        expect(shortestUniqueSuffixes([
            ['a.mf4', 'CAN1', 'Speed'],
            ['a.mf4', 'CAN2', 'Speed'],
            ['a.mf4', 'CAN3', 'Speed'],
        ])).toEqual([['CAN1', 'Speed'], ['CAN2', 'Speed'], ['CAN3', 'Speed']]);
    });

    it('clamps to a path that runs out first', () => {
        expect(shortestUniqueSuffixes([
            ['Speed'],
            ['a.mf4', 'CAN1', 'Speed'],
        ])).toEqual([['Speed'], ['CAN1', 'Speed']]);
    });

    it('numbers identical paths', () => {
        expect(shortestUniqueSuffixes([
            ['a.mf4', 'Speed'],
            ['a.mf4', 'Speed'],
        ])).toEqual([['a.mf4', 'Speed#0'], ['a.mf4', 'Speed#1']]);
    });

    it('handles an empty input', () => {
        expect(shortestUniqueSuffixes([])).toEqual([]);
    });

    it('always produces unique names', () => {
        const paths = [
            ['dup.mf4', 'Rpm'],
            ['dup.mf4', 'CAN1.EngineData', 'Speed'],
            ['dup.mf4', 'CAN2.WheelData', 'Speed'],
            ['dup.mf4', 'ECU/Front', 'Pressure'],
            ['dup.mf4', 'ECU/Rear', 'Pressure'],
            ['dup.mf4', 'Chassis', 'Temperature'],
            ['dup.mf4', 'Cabin', 'Temperature'],
            ['other.mf4', 'Rpm'],
            ['other.mf4', 'Chassis', 'Temperature'],
        ];
        const names = shortestUniqueSuffixes(paths).map(parts => parts.join(' / '));
        expect(new Set(names).size).toBe(paths.length);
        expect(names[0]).toBe('dup.mf4 / Rpm');
        expect(names[1]).toBe('dup.mf4 / CAN1.EngineData / Speed');
        expect(names[5]).toBe('dup.mf4 / Chassis / Temperature');
    });
});
