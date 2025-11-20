import { TextValue } from "@voltex-viewer/plugin-api";

export interface SerializableConversion {
    fnBody: string;
    context: Record<string, any>;
}

export interface SerializableConversionData {
    conversion: SerializableConversion | null;
    textValues: TextValue[];
}

export function deserializeConversion(data: SerializableConversionData): undefined | ((value: number) => number | string) {
    if (data.conversion === null) {
        return undefined;
    }

    const { fnBody, context } = data.conversion;
    const contextKeys = Object.keys(context);
    const contextValues = Object.values(context);
    
    const fn = new Function('value', ...contextKeys, fnBody);
    const boundFn = (value: number) => fn(value, ...contextValues);

    return boundFn as (value: number) => number | string;
}


