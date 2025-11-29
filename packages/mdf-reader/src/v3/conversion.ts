import { TextValue, SerializableConversion, SerializableConversionData } from '../conversion';
import { ChannelConversionBlock, ConversionType } from "./channelConversionBlock";

export function serializeConversion(conversion: ChannelConversionBlock<'instanced'> | null): SerializableConversionData {
    const textValues: TextValue[] = [];
    
    function serialize(conversion: ChannelConversionBlock<'instanced'> | null): SerializableConversion | null {
        if (conversion === null) {
            return null;
        }
        
        switch (conversion.type) {
            case ConversionType.Linear: {
                const [intercept, slope] = conversion.p;
                return {
                    fnBody: 'return slope * value + intercept;',
                    context: { intercept, slope }
                };
            }
            
            case ConversionType.TabularWithInterpolation: {
                const pairs = [...conversion.table];
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
            
            case ConversionType.TextTable:
            case ConversionType.Tabular: {
                if (conversion.type === ConversionType.TextTable) {
                    textValues.push(...conversion.table.map(x => ({value: x[0], text: x[1]})));
                }
                const pairs = [...conversion.table];
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
            
            case ConversionType.Polynomial: {
                const [p1, p2, p3, p4, p5, p6] = conversion.p;
                return {
                    fnBody: 'return (p2 - p4 * (value - p5 - p6)) / (p3 * (value - p5 - p6) - p1);',
                    context: { p1, p2, p3, p4, p5, p6 }
                };
            }
            
            case ConversionType.Exponential: {
                const [p1, p2, p3, p4, p5, p6, p7] = conversion.p;
                if (p4 === 0) {
                    return {
                        fnBody: 'return Math.log(((value - p7) * p6 - p3) / p1) / p2;',
                        context: { p1, p2, p3, p6, p7 }
                    };
                } else if (p1 === 0) {
                    return {
                        fnBody: 'return Math.log((p3 / (value - p7) - p6) / p4) / p5;',
                        context: { p3, p4, p5, p6, p7 }
                    };
                } else {
                    return {
                        fnBody: 'return 0;',
                        context: {}
                    };
                }
            }
            
            case ConversionType.Logarithmic: {
                const [p1, p2, p3, p4, p5, p6, p7] = conversion.p;
                if (p4 === 0) {
                    return {
                        fnBody: 'return Math.exp(((value - p7) * p6 - p3) / p1) / p2;',
                        context: { p1, p2, p3, p6, p7 }
                    };
                } else if (p1 === 0) {
                    return {
                        fnBody: 'return Math.exp((p3 / (value - p7) - p6) / p4) / p5;',
                        context: { p3, p4, p5, p6, p7 }
                    };
                } else {
                    return {
                        fnBody: 'return 0;',
                        context: {}
                    };
                }
            }
            
            case ConversionType.Rational: {
                return {
                    fnBody: 'return (c[0] * value * value + c[1] * value + c[2]) / (c[3] * value * value + c[4] * value + c[5]);',
                    context: {
                        c: conversion.p
                    }
                };
            }
            
            case ConversionType.Formula:
                return {
                    fnBody: `return ${conversion.formula.replaceAll(/\b(?:X|x)1?\b/g, 'value').replaceAll('^', '**')};`,
                    context: {}
                };
            
            case ConversionType.TextRangeTable: {
                const groups: [number, number, string][] = conversion.table.map(x => [x[0], x[1], x[2].data]);
                const defaultValue = conversion.default?.data;
                groups.sort((a, b) => a[0] - b[0]);
                const keysMin = groups.map(group => group[0]);
                const keysMax = groups.map(group => group[1]);
                const values = groups.map(group => group[2]);
                if (typeof defaultValue === "string") {
                    textValues.push({text: defaultValue});
                }
                textValues.push(...values.map(v => ({text: v})));
                
                if (keysMin.length <= 8) {
                    return {
                        fnBody: `for (let i = 0; i < keysMin.length; i++) {
                        if (value >= keysMin[i] && value <= keysMax[i]) {
                            return values[i];
                        }
                    }
                    return defaultValue !== undefined ? defaultValue : value;`,
                        context: { keysMin, keysMax, values, defaultValue }
                    };
                } else {
                    return {
                        fnBody: `let left = 0;
                    let right = keysMin.length - 1;
                    while (left <= right) {
                        const mid = (left + right) >>> 1;
                        if (value >= keysMin[mid] && value <= keysMax[mid]) {
                            return values[mid];
                        } else if (value < keysMin[mid]) {
                            right = mid - 1;
                        } else {
                            left = mid + 1;
                        }
                    }
                    return defaultValue !== undefined ? defaultValue : value;`,
                        context: { keysMin, keysMax, values, defaultValue }
                    };
                }
            }
            
            case ConversionType.OneToOne:
                return {
                    fnBody: 'return value;',
                    context: {}
                };

            case ConversionType.Date:
            case ConversionType.Time:
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
