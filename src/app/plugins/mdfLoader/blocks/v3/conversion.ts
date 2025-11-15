import { TextValue } from "@voltex-viewer/plugin-api";
import { ChannelConversionBlock, ConversionType } from ".";

export function conversionToFunction(conversion: ChannelConversionBlock<'instanced'> | null): {conversion: null | ((value: number) => number | string), textValues: TextValue[]} {
    const textValues: TextValue[] = [];
    function convert(conversion: ChannelConversionBlock<'instanced'>): null | ((value: number) => number | string) {
        if (conversion === null) {
            return null;
        }
        switch (conversion.type) {
            case ConversionType.Linear:
                const [intercept, slope] = conversion.p;
                return value => {
                    return slope * value + intercept;
                };

            case ConversionType.TabularWithInterpolation: {
                const pairs = [...conversion.table];
                pairs.sort((a, b) => a[0] - b[0]);
                const keys = pairs.map(pair => pair[0]);
                const values = pairs.map(pair => pair[1]);

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
            }

            case ConversionType.TextTable:
            case ConversionType.Tabular: {
                if (conversion.type === ConversionType.TextTable) {
                    textValues.push(...conversion.table.map(x => ({value: x[0], text: x[1]})));
                }
                const pairs = [...conversion.table];
                pairs.sort((a, b) => a[0] - b[0]);
                const keys = pairs.map(pair => pair[0]);
                const values = pairs.map(pair => pair[1]);
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

            case ConversionType.Polynomial: {
                const [p1, p2, p3, p4, p5, p6] = conversion.p;
                return value => (p2 - p4 * (value - p5 - p6)) / (p3 * (value - p5 - p6) - p1);
            }

            case ConversionType.Exponential: {
                const [p1, p2, p3, p4, p5, p6, p7] = conversion.p;
                if (p4 === 0) {
                    return value => Math.log(((value - p7) * p6 - p3) / p1) / p2;
                } else if (p1 === 0) {
                    return value => Math.log((p3 / (value - p7) - p6) / p4) / p5;
                } else {
                    return _ => 0;
                }
            }

            case ConversionType.Logarithmic: {
                const [p1, p2, p3, p4, p5, p6, p7] = conversion.p;
                if (p4 === 0) {
                    return value => Math.exp(((value - p7) * p6 - p3) / p1) / p2;
                } else if (p1 === 0) {
                    return value => Math.exp((p3 / (value - p7) - p6) / p4) / p5;
                } else {
                    return _ => 0;
                }
            }

            case ConversionType.Rational:
                const [numerator_x2, numerator_x1, numerator_x0, denominator_x2, denominator_x1, denominator_x0] = conversion.p;
                return value => {
                    return (numerator_x2 * value ** 2 + numerator_x1 * value + numerator_x0) / (denominator_x2 * value ** 2 + denominator_x1 * value + denominator_x0);
                };

            case ConversionType.Formula:
                return new Function('X', `return ${conversion.formula.replaceAll('x', 'X').replaceAll('X1', 'X').replaceAll('^', '**')};`) as (value: number) => number;

            case ConversionType.TextRangeTable: {
                const groups: [number, number, string][] = conversion.table.map(x => [x[0], x[1], x[2].data]);
                const defaultValue = conversion.default?.data;
                groups.sort((a, b) => a[0] - b[0]);
                const keys_min = groups.map(group => group[0]);
                const keys_max = groups.map(group => group[1]);
                const values = groups.map(group => group[2]);
                if (typeof defaultValue === "string") {
                    textValues.push({text: defaultValue});
                }
                textValues.push(...values.map(v => ({text: v})));
                if (keys_min.length <= 8) {
                    return value => {
                        for (let i = 0; i < keys_min.length; i++) {
                            if (value >= keys_min[i] && value <= keys_max[i]) {
                                return values[i];
                            }
                        }
                        return typeof(defaultValue) === "undefined" ? value : defaultValue;
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
                        return typeof(defaultValue) === "undefined" ? value : defaultValue;
                    };
                }
            }

            case ConversionType.OneToOne:
                return (value) => value;

            case ConversionType.Date:
            case ConversionType.Time:
            default:
                return _ => 0;
        }
    }
    return {
        conversion: convert(conversion),
        textValues,
    };
}
