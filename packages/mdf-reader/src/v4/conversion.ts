import { TextValue, SerializableConversionData } from '../conversion';
import { ChannelConversionBlock, ConversionType } from "./channelConversionBlock";

export function serializeConversion(conversion: ChannelConversionBlock<'instanced'> | null): SerializableConversionData {
    const textValues: TextValue[] = [];
    const context: Record<string, unknown> = {};
    let varCounter = 0;
    
    function addToContext(value: unknown): string {
        const varName = `v${varCounter++}`;
        context[varName] = value;
        return varName;
    }
    
    function serialize(conversion: ChannelConversionBlock<'instanced'> | null): string | null {
        if (conversion === null) {
            return null;
        }
        
        switch (conversion.type) {
            case ConversionType.OneToOne:
                return 'value';
            
            case ConversionType.Linear: {
                const intercept = addToContext(conversion.values[0]);
                const slope = addToContext(conversion.values[1]);
                return `${slope} * value + ${intercept}`;
            }
            
            case ConversionType.Rational: {
                const c = addToContext(conversion.values);
                return `(${c}[0] * value * value + ${c}[1] * value + ${c}[2]) / (${c}[3] * value * value + ${c}[4] * value + ${c}[5])`;
            }
            
            case ConversionType.Algebraic: {
                const formula = conversion.refs[0];
                return formula.data.replaceAll(/\b(?:X|x)1?\b/g, 'value').replaceAll('^', '**');
            }
            
            case ConversionType.ValueToValueTableWithInterpolation: {
                const pairs = [];
                for (let i = 0; i < conversion.values.length; i += 2) {
                    pairs.push([conversion.values[i], conversion.values[i + 1]]);
                }
                pairs.sort((a, b) => a[0] - b[0]);
                const keys = addToContext(pairs.map(pair => pair[0]));
                const values = addToContext(pairs.map(pair => pair[1]));
                return `(function() {
                    if (value <= ${keys}[0]) return ${values}[0];
                    if (value >= ${keys}[${keys}.length - 1]) return ${values}[${values}.length - 1];
                    let left = 0;
                    let right = ${keys}.length - 1;
                    while (left < right - 1) {
                        const mid = (left + right) >>> 1;
                        if (${keys}[mid] <= value) {
                            left = mid;
                        } else {
                            right = mid;
                        }
                    }
                    const t = (value - ${keys}[left]) / (${keys}[right] - ${keys}[left]);
                    return ${values}[left] + t * (${values}[right] - ${values}[left]);
                })()`;
            }
            
            case ConversionType.ValueToValueTableWithoutInterpolation: {
                const pairs = [];
                for (let i = 0; i < conversion.values.length; i += 2) {
                    pairs.push([conversion.values[i], conversion.values[i + 1]]);
                }
                pairs.sort((a, b) => a[0] - b[0]);
                const keys = addToContext(pairs.map(pair => pair[0]));
                const values = addToContext(pairs.map(pair => pair[1]));
                return `(function() {
                    if (value <= ${keys}[0]) return ${values}[0];
                    if (value >= ${keys}[${keys}.length - 1]) return ${values}[${values}.length - 1];
                    let left = 0;
                    let right = ${keys}.length - 1;
                    while (left < right - 1) {
                        const mid = (left + right) >>> 1;
                        if (${keys}[mid] <= value) {
                            left = mid;
                        } else {
                            right = mid;
                        }
                    }
                    const leftDist = value - ${keys}[left];
                    const rightDist = ${keys}[right] - value;
                    return leftDist <= rightDist ? ${values}[left] : ${values}[right];
                })()`;
            }
            
            case ConversionType.ValueRangeToValueTable: {
                const groups = [];
                for (let i = 0; i < conversion.values.length - 2; i += 3) {
                    groups.push([conversion.values[i], conversion.values[i + 1], conversion.values[i + 2]]);
                }
                const defaultVal = conversion.values[conversion.values.length - 1];
                groups.sort((a, b) => a[0] - b[0]);
                const keysMin = addToContext(groups.map(group => group[0]));
                const keysMax = addToContext(groups.map(group => group[1]));
                const values = addToContext(groups.map(group => group[2]));
                const defaultValue = addToContext(defaultVal);
                
                if (groups.length <= 8) {
                    return `(function() {
                        for (let i = 0; i < ${keysMin}.length; i++) {
                            if (value >= ${keysMin}[i] && value <= ${keysMax}[i]) {
                                return ${values}[i];
                            }
                        }
                        return ${defaultValue};
                    })()`;
                } else {
                    return `(function() {
                        let left = 0;
                        let right = ${keysMin}.length - 1;
                        while (left <= right) {
                            const mid = (left + right) >>> 1;
                            if (value >= ${keysMin}[mid] && value <= ${keysMax}[mid]) {
                                return ${values}[mid];
                            } else if (value < ${keysMin}[mid]) {
                                right = mid - 1;
                            } else {
                                left = mid + 1;
                            }
                        }
                        return ${defaultValue};
                    })()`;
                }
            }
            
            case ConversionType.ValueToTextOrScale: {
                const cases: string[] = [];
                for (let i = 0; i < conversion.values.length; i++) {
                    const ref = conversion.refs[i];
                    if ('type' in ref) {
                        const serialized = serialize(ref);
                        if (serialized) {
                            cases.push(`if (value === ${conversion.values[i]}) return ${serialized};`);
                        }
                    } else {
                        const text = addToContext(ref.data);
                        cases.push(`if (value === ${conversion.values[i]}) return ${text};`);
                        textValues.push({text: ref.data, value: conversion.values[i]});
                    }
                }
                const defaultRef = conversion.refs[conversion.refs.length - 1];
                let defaultCase: string;
                if (defaultRef === null) {
                    defaultCase = 'return value;';
                } else if ('type' in defaultRef) {
                    const serialized = serialize(defaultRef);
                    defaultCase = serialized ? `return ${serialized};` : 'return value;';
                } else {
                    const text = addToContext(defaultRef.data);
                    defaultCase = `return ${text};`;
                    textValues.push({text: defaultRef.data});
                }
                
                return `(function() { ${cases.join('\n')} ${defaultCase} })()`;
            }
            
            case ConversionType.ValueRangeToTextOrScale: {
                const rangeChecks: string[] = [];
                const count = conversion.values.length / 2;
                const rangeData: Array<{lower: number, upper: number, result: string}> = [];
                for (let i = 0; i < count; i++) {
                    const ref = conversion.refs[i];
                    let result: string;
                    if ('type' in ref) {
                        const serialized = serialize(ref);
                        result = serialized || '0';
                    } else {
                        const text = addToContext(ref.data);
                        result = text;
                        textValues.push({text: ref.data});
                    }
                    rangeData.push({
                        lower: conversion.values[i * 2],
                        upper: conversion.values[i * 2 + 1],
                        result
                    });
                }
                rangeData.sort((a, b) => a.lower - b.lower);
                for (const range of rangeData) {
                    rangeChecks.push(`if (value >= ${range.lower} && value <= ${range.upper}) return ${range.result};`);
                }
                const defaultRef = conversion.refs[conversion.refs.length - 1];
                let defaultCase: string;
                if (defaultRef === null) {
                    defaultCase = 'return value;';
                } else if ('type' in defaultRef) {
                    const serialized = serialize(defaultRef);
                    defaultCase = serialized ? `return ${serialized};` : 'return value;';
                } else {
                    const text = addToContext(defaultRef.data);
                    defaultCase = `return ${text};`;
                    textValues.push({text: defaultRef.data});
                }

                return `(function() { ${rangeChecks.join('\n')} ${defaultCase} })()`;
            }
            
            case ConversionType.TextToValue:
            case ConversionType.TextToText:
            default:
                return '0';
        }
    }
    
    const fnBody = serialize(conversion);
    
    return {
        conversion: fnBody ? { fnBody: `return ${fnBody};`, context } : null,
        textValues,
    };
}
