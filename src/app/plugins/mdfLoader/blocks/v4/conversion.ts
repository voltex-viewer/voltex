import { TextValue } from "@voltex-viewer/plugin-api";
import { ChannelConversionBlock, ConversionType } from ".";

export function conversionToFunction(conversion: ChannelConversionBlock<'instanced'> | null): {conversion: null | ((value: number) => number | string), textValues: TextValue[]} {
    const textValues: TextValue[] = [];
    function convert(conversion: ChannelConversionBlock<'instanced'>): null | ((value: number) => number | string) {
        if (conversion === null) {
            return null;
        }
        switch (conversion.type) {
            case ConversionType.OneToOne:
                return (value) => value;
            case ConversionType.Linear:
                const [intercept, slope] = conversion.values;
                return value => {
                    return slope * value + intercept;
                };
            case ConversionType.Rational:
                const [numerator_x2, numerator_x1, numerator_x0, denominator_x2, denominator_x1, denominator_x0] = conversion.values;
                return value => {
                    return (numerator_x2 * value ** 2 + numerator_x1 * value + numerator_x0) / (denominator_x2 * value ** 2 + denominator_x1 * value + denominator_x0);
                };
            case ConversionType.Algebraic:
                const formula = conversion.refs[0];
                return new Function('X', `return ${formula.data.replaceAll('x', 'X').replaceAll('^', '**')};`) as (value: number) => number;
            case ConversionType.ValueToValueTableWithInterpolation:
            case ConversionType.ValueToValueTableWithoutInterpolation:
                const pairs = [];
                for (let i = 0; i < conversion.values.length; i += 2) {
                    pairs.push([conversion.values[i], conversion.values[i + 1]]);
                }
                pairs.sort((a, b) => a[0] - b[0]);
                const keys = pairs.map(pair => pair[0]);
                const values = pairs.map(pair => pair[1]);

                if (conversion.type === ConversionType.ValueToValueTableWithInterpolation) {
                    return value => {
                        if (value <= keys[0]) return values[0];
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
                        return values[left] + t * (values[right] - values[left]);
                    };
                } else {
                    return value => {
                        if (value <= keys[0]) return values[0];
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
                        
                        return leftDist <= rightDist ? values[left] : values[right];
                    };
                }

            case ConversionType.ValueRangeToValueTable: {
                if ((conversion.values.length % 3) !== 1) {
                    throw new Error(`Invalid number of values for ValueRangeToValueTable: ${conversion.values.length}`);
                }
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
                    return value => {
                        for (let i = 0; i < keys_min.length; i++) {
                            if (value >= keys_min[i] && value <= keys_max[i]) {
                                return values[i];
                            }
                        }
                        return defaultValue;
                    };
                } else {
                    return value => {
                        let left = 0;
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
                        return defaultValue;
                    };
                }
            }

            case ConversionType.ValueToTextOrScale: {
                if (conversion.values.length + 1 !== conversion.refs.length) {
                    throw new Error(`Mismatched lengths for ValueToTextOrScale`);
                }
                const conversionMap = new Map<number, string | ((value: number) => number | string)>();
                for (let i = 0; i < conversion.values.length; i++) {
                    const ref = conversion.refs[i];
                    if ('type' in ref) {
                        conversionMap.set(conversion.values[i], convert(ref));
                    } else {
                        conversionMap.set(conversion.values[i], ref.data);
                        textValues.push({text: ref.data, value: conversion.values[i]});
                    }
                }
                const defaultRef = conversion.refs[conversion.refs.length - 1];
                let defaultValue: string | ((value: number) => number | string) | undefined;
                if (defaultRef === null) {
                    defaultValue = undefined;
                } else if ('type' in defaultRef) {
                    defaultValue = convert(defaultRef);
                } else {
                    defaultValue = defaultRef.data;
                    textValues.push({text: defaultRef.data});
                }
                if (typeof(defaultValue) === "function") {
                    return value => {
                        const result = conversionMap.get(value);
                        switch (typeof(result)) {
                            case "function":
                                return result(value);
                            case "undefined":
                                return defaultValue(value);
                            default:
                                return result;
                        }
                    };
                } else {
                    return value => {
                        const result = conversionMap.get(value);
                        switch (typeof(result)) {
                            case "function":
                                return result(value);
                            case "undefined":
                                return defaultValue;
                            default:
                                return result;
                        }
                    };
                }
            }

            case ConversionType.ValueRangeToTextOrScale: {
                const count = conversion.values.length / 2;
                if (count + 1 !== conversion.refs.length || conversion.values.length % 2 !== 0) {
                    throw new Error(`Mismatched lengths for ValueRangeToTextOrScale`);
                }
                const conversionMap: { lower: number; upper: number; result: string | ((value: number) => number | string) }[] = [];
                for (let i = 0; i < count; i++) {
                    const ref = conversion.refs[i];
                    let result;
                    if ('type' in ref) {
                        result = convert(ref);
                    } else {
                        result = ref.data;
                        textValues.push({text: ref.data});
                    }
                    conversionMap.push({
                        lower: conversion.values[i * 2],
                        upper: conversion.values[i * 2 + 1],
                        result
                    });
                }
                // Technically the ranges should already be sorted, but we can be permissive here
                conversionMap.sort((a, b) => a.lower - b.lower);
                const defaultRef = conversion.refs[conversion.refs.length - 1];
                let defaultValue: string | ((value: number) => number | string) | undefined;
                if (defaultRef === null) {
                    defaultValue = undefined;
                } else if ('type' in defaultRef) {
                    defaultValue = convert(defaultRef);
                } else {
                    defaultValue = defaultRef.data;
                    textValues.push({text: defaultRef.data});
                }
                return value => {
                    const result = conversionMap.find(entry => entry.lower <= value && entry.upper >= value)?.result;
                    switch (typeof(result)) {
                        case "function":
                            return result(value);
                        case "undefined":
                            return typeof(defaultValue) === "function" ? defaultValue(value) : defaultValue;
                        default:
                            return result;
                    }
                };
            }

            case ConversionType.TextToValue:
            case ConversionType.TextToText:
            default:
                return _ => 0;
        }
    }
    return {
        conversion: convert(conversion),
        textValues,
    };
}
