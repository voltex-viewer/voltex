import { TextValue } from "@voltex-viewer/plugin-api";
import * as v4 from "./blocks/v4";
import * as v3 from "./blocks/v3";

export interface SerializableConversion {
    fnBody: string;
    context: Record<string, any>;
}

export interface SerializableConversionData {
    conversion: SerializableConversion | null;
    textValues: TextValue[];
}

export function deserializeConversion(data: SerializableConversionData): null | ((value: number) => number | string) {
    if (data.conversion === null) {
        return null;
    }

    const { fnBody, context } = data.conversion;
    const contextKeys = Object.keys(context);
    const contextValues = Object.values(context);
    
    const fn = new Function('value', ...contextKeys, fnBody);
    const boundFn = (value: number) => fn(value, ...contextValues);

    return boundFn as (value: number) => number | string;
}


