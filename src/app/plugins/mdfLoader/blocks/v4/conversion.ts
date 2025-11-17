import { TextValue } from "@voltex-viewer/plugin-api";
import { ChannelConversionBlock, ConversionType } from ".";
import { SerializableConversion, SerializableConversionData } from "../../serializableConversion";

export function serializeConversion(conversion: ChannelConversionBlock<'instanced'> | null): SerializableConversionData {
    const textValues: TextValue[] = [];
    
    function serialize(conversion: ChannelConversionBlock<'instanced'> | null): SerializableConversion | null {
        if (conversion === null) {
            return null;
        }
        
        switch (conversion.type) {
            case ConversionType.OneToOne:
                return {
                    fnBody: 'return value;',
                    context: {}
                };
            
            case ConversionType.Linear:
                return {
                    fnBody: 'return slope * value + intercept;',
                    context: {
                        intercept: conversion.values[0],
                        slope: conversion.values[1]
                    }
                };
            
            case ConversionType.Rational:
                return {
                    fnBody: 'return (c[0] * value * value + c[1] * value + c[2]) / (c[3] * value * value + c[4] * value + c[5]);',
                    context: {
                        c: conversion.values
                    }
                };
            
            case ConversionType.Algebraic: {
                const formula = conversion.refs[0];
                return {
                    fnBody: `return ${formula.data.replaceAll(/\b(?:X|x)1?\b/g, 'value').replaceAll('^', '**')};`,
                    context: {}
                };
            }
            
            case ConversionType.ValueToValueTableWithInterpolation: {
                const pairs = [];
                for (let i = 0; i < conversion.values.length; i += 2) {
                    pairs.push([conversion.values[i], conversion.values[i + 1]]);
                }
                pairs.sort((a, b) => a[0] - b[0]);
                return {
                    fnBody: `if (value <= keys[0]) return values[0];
                    if (value >= keys[keys.length - 1]) return values[values.length - 1];
                    let left = 0;
                    let right = keys.length - 1;
                    while (left < right - 1) {
                        const mid = (left + right) >>> 1;
                        if (keys[mid] <= value) {
                            left = mid;
                        } else {
                            right = mid;
                        }
                    }
                    const t = (value - keys[left]) / (keys[right] - keys[left]);
                    return values[left] + t * (values[right] - values[left]);`,
                    context: {
                        keys: pairs.map(pair => pair[0]),
                        values: pairs.map(pair => pair[1])
                    }
                };
            }
            
            case ConversionType.ValueToValueTableWithoutInterpolation: {
                const pairs = [];
                for (let i = 0; i < conversion.values.length; i += 2) {
                    pairs.push([conversion.values[i], conversion.values[i + 1]]);
                }
                pairs.sort((a, b) => a[0] - b[0]);
                return {
                    fnBody: `if (value <= keys[0]) return values[0];
                    if (value >= keys[keys.length - 1]) return values[values.length - 1];
                    let left = 0;
                    let right = keys.length - 1;
                    while (left < right - 1) {
                        const mid = (left + right) >>> 1;
                        if (keys[mid] <= value) {
                            left = mid;
                        } else {
                            right = mid;
                        }
                    }
                    const leftDist = value - keys[left];
                    const rightDist = keys[right] - value;
                    return leftDist <= rightDist ? values[left] : values[right];`,
                    context: {
                        keys: pairs.map(pair => pair[0]),
                        values: pairs.map(pair => pair[1])
                    }
                };
            }
            
            case ConversionType.ValueRangeToValueTable: {
                const groups = [];
                for (let i = 0; i < conversion.values.length - 2; i += 3) {
                    groups.push([conversion.values[i], conversion.values[i + 1], conversion.values[i + 2]]);
                }
                const defaultValue = conversion.values[conversion.values.length - 1];
                groups.sort((a, b) => a[0] - b[0]);
                const keys_min = groups.map(group => group[0]);
                const keys_max = groups.map(group => group[1]);
                const values = groups.map(group => group[2]);
                
                if (keys_min.length <= 8) {
                    return {
                        fnBody: `for (let i = 0; i < keys_min.length; i++) {
                            if (value >= keys_min[i] && value <= keys_max[i]) {
                                return values[i];
                            }
                        }
                        return defaultValue;`,
                        context: { keys_min, keys_max, values, defaultValue }
                    };
                } else {
                    return {
                        fnBody: `let left = 0;
                        let right = keys_min.length - 1;
                        while (left <= right) {
                            const mid = (left + right) >>> 1;
                            if (value >= keys_min[mid] && value <= keys_max[mid]) {
                                return values[mid];
                            } else if (value < keys_min[mid]) {
                                right = mid - 1;
                            } else {
                                left = mid + 1;
                            }
                        }
                        return defaultValue;`,
                        context: { keys_min, keys_max, values, defaultValue }
                    };
                }
            }
            
            case ConversionType.ValueToTextOrScale: {
                const mapEntries: Array<[number, string | SerializableConversion]> = [];
                for (let i = 0; i < conversion.values.length; i++) {
                    const ref = conversion.refs[i];
                    if ('type' in ref) {
                        const serialized = serialize(ref);
                        if (serialized) mapEntries.push([conversion.values[i], serialized]);
                    } else {
                        mapEntries.push([conversion.values[i], ref.data]);
                        textValues.push({text: ref.data, value: conversion.values[i]});
                    }
                }
                const defaultRef = conversion.refs[conversion.refs.length - 1];
                let defaultValue: string | SerializableConversion | undefined;
                if (defaultRef === null) {
                    defaultValue = undefined;
                } else if ('type' in defaultRef) {
                    defaultValue = serialize(defaultRef) || undefined;
                } else {
                    defaultValue = defaultRef.data;
                    textValues.push({text: defaultRef.data});
                }
                
                return {
                    fnBody: `const result = conversionMap.get(value);
                    if (result !== undefined) {
                        if (typeof result === 'string') return result;
                        if (typeof result === 'number') return result;
                        return result.fn(value, ...result.args);
                    }
                    if (defaultValue !== undefined) {
                        if (typeof defaultValue === 'string') return defaultValue;
                        if (typeof defaultValue === 'number') return defaultValue;
                        return defaultValue.fn(value, ...defaultValue.args);
                    }
                    return value;`,
                    context: {
                        conversionMap: new Map(mapEntries.map(([k, v]): [number, any] => {
                            if (typeof v === 'string') {
                                return [k, v];
                            } else {
                                const contextKeys = Object.keys(v.context);
                                const contextValues = Object.values(v.context);
                                const fn = new Function('value', ...contextKeys, v.fnBody);
                                return [k, { fn, args: contextValues }];
                            }
                        })),
                        defaultValue: typeof defaultValue === 'string' || defaultValue === undefined
                            ? defaultValue
                            : (() => {
                                const contextKeys = Object.keys(defaultValue.context);
                                const contextValues = Object.values(defaultValue.context);
                                const fn = new Function('value', ...contextKeys, defaultValue.fnBody);
                                return { fn, args: contextValues };
                            })()
                    }
                };
            }
            
            case ConversionType.ValueRangeToTextOrScale: {
                const ranges = [];
                const count = conversion.values.length / 2;
                for (let i = 0; i < count; i++) {
                    const ref = conversion.refs[i];
                    let result: string | { fn: Function, args: any[] };
                    if ('type' in ref) {
                        const serialized = serialize(ref);
                        if (serialized) {
                            const contextKeys = Object.keys(serialized.context);
                            const contextValues = Object.values(serialized.context);
                            const fn = new Function('value', ...contextKeys, serialized.fnBody);
                            result = { fn, args: contextValues };
                        } else {
                            result = { fn: () => 0, args: [] };
                        }
                    } else {
                        result = ref.data;
                        textValues.push({text: ref.data});
                    }
                    ranges.push({
                        lower: conversion.values[i * 2],
                        upper: conversion.values[i * 2 + 1],
                        result
                    });
                }
                ranges.sort((a, b) => a.lower - b.lower);
                const defaultRef = conversion.refs[conversion.refs.length - 1];
                let defaultValue: string | { fn: Function, args: any[] } | undefined;
                if (defaultRef === null) {
                    defaultValue = undefined;
                } else if ('type' in defaultRef) {
                    const serialized = serialize(defaultRef);
                    if (serialized) {
                        const contextKeys = Object.keys(serialized.context);
                        const contextValues = Object.values(serialized.context);
                        const fn = new Function('value', ...contextKeys, serialized.fnBody);
                        defaultValue = { fn, args: contextValues };
                    }
                } else {
                    defaultValue = defaultRef.data;
                    textValues.push({text: defaultRef.data});
                }
                
                return {
                    fnBody: `for (const range of ranges) {
                        if (value >= range.lower && value <= range.upper) {
                            const result = range.result;
                            if (typeof result === 'string') return result;
                            if (typeof result === 'number') return result;
                            return result.fn(value, ...result.args);
                        }
                    }
                    if (defaultValue !== undefined) {
                        if (typeof defaultValue === 'string') return defaultValue;
                        if (typeof defaultValue === 'number') return defaultValue;
                        return defaultValue.fn(value, ...defaultValue.args);
                    }
                    return value;`,
                    context: { ranges, defaultValue }
                };
            }
            
            case ConversionType.TextToValue:
            case ConversionType.TextToText:
            default:
                return {
                    fnBody: 'return 0;',
                    context: {}
                };
        }
    }
    
    return {
        conversion: serialize(conversion),
        textValues,
    };
}
