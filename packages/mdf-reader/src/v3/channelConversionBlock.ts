import { Link, NonNullLink, readBlock, MaybeLinked, GenericBlock } from './common';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../bufferedFileReader';
import { MdfView } from './mdfView';
import { TextBlock } from './textBlock';

export enum ConversionType {
    Linear = 0,
    TabularWithInterpolation = 1,
    Tabular = 2,
    Polynomial = 6,
    Exponential = 7,
    Logarithmic = 8,
    Rational = 9,
    Formula = 10,
    TextTable = 11,
    TextRangeTable = 12,
    Date = 132,
    Time = 133,
    OneToOne = 65535,
}

export interface LinearConversion {
    size: number;
    type: ConversionType.Linear,
    p: [number, number],
}

export interface TabularWithInterpolationConversion {
    size: number;
    type: ConversionType.TabularWithInterpolation,
    table: [number, number][];
}

export interface TabularConversion {
    size: number;
    type: ConversionType.Tabular,
    table: [number, number][];
}

export interface PolynomialConversion {
    size: number;
    type: ConversionType.Polynomial,
    p: [number, number, number, number, number, number],
}

export interface ExponentialConversion {
    size: number;
    type: ConversionType.Exponential,
    p: [number, number, number, number, number, number, number],
}

export interface LogarithmicConversion {
    size: number;
    type: ConversionType.Logarithmic,
    p: [number, number, number, number, number, number, number],
}

export interface RationalConversion {
    size: number;
    type: ConversionType.Rational,
    p: [number, number, number, number, number, number],
}

export interface FormulaConversion {
    size: number;
    type: ConversionType.Formula,
    formula: string,
}

export interface TextTableConversion {
    size: number;
    type: ConversionType.TextTable,
    table: [number, string][],
}

export interface TextRangeTableConversion<TMode extends 'linked' | 'instanced' = 'linked'> {
    size: number;
    type: ConversionType.TextRangeTable,
    default: MaybeLinked<TextBlock | null, TMode>,
    table: [number, number, MaybeLinked<TextBlock, TMode>][],
}

export interface DateConversion {
    type: ConversionType.Date,
}

export interface TimeConversion {
    type: ConversionType.Time,
}

export interface OneToOneConversion {
    type: ConversionType.OneToOne,
}

export interface ChannelConversionBlockBase {
    physicalRangeValid: boolean;
    minimumPhysical: number;
    maximumPhysical: number;
    unit: string;
}

export type ChannelConversionBlock<TMode extends 'linked' | 'instanced' = 'linked'> = ChannelConversionBlockBase & (LinearConversion | TabularWithInterpolationConversion | TabularConversion | PolynomialConversion | ExponentialConversion | LogarithmicConversion | RationalConversion | FormulaConversion | TextTableConversion | TextRangeTableConversion<TMode> | DateConversion | TimeConversion | OneToOneConversion);

export function deserializeChannelConversionBlock(block: GenericBlock): ChannelConversionBlock<'linked'> {
    const view = block.buffer;

    const base: ChannelConversionBlockBase = {
        physicalRangeValid: view.readBool(),
        minimumPhysical: view.readReal(),
        maximumPhysical: view.readReal(),
        unit: view.readString(20),
    };
    const type = view.readUint16();
    switch (type) {
        case ConversionType.Linear: {
            const size = view.readUint16();
            if (size !== 2) {
                throw new Error("Unexpected number of parameters for linear conversion, expected 2, found " + size);
            }
            return {
                ...base,
                size,
                type,
                p: [view.readReal(), view.readReal()],
            };
        }
        case ConversionType.TabularWithInterpolation: 
        case ConversionType.Tabular: {
            const size = view.readUint16();
            const table: [number, number][] = [];
            for (let i = 0; i < size; i++) {
                table.push([view.readReal(), view.readReal()]);
            }
            return {
                ...base,
                size,
                type,
                table,
            };
        }
        case ConversionType.Polynomial: 
        case ConversionType.Rational: {
            const size = view.readUint16();
            if (size !== 6) {
                throw new Error("Unexpected number of parameters for polynomial or rational conversion, expected 6, found " + size);
            }
            return {
                ...base,
                size,
                type,
                p: [view.readReal(), view.readReal(), view.readReal(), view.readReal(), view.readReal(), view.readReal()]
            };
        }
        case ConversionType.Exponential:
        case ConversionType.Logarithmic: {
            const size = view.readUint16();
            if (size !== 7) {
                throw new Error("Unexpected number of parameters for exponential or logarithmic conversion, expected 7, found " + size);
            }
            return {
                ...base,
                size,
                type,
                p: [view.readReal(), view.readReal(), view.readReal(), view.readReal(), view.readReal(), view.readReal(), view.readReal()]
            };
        }
        case ConversionType.Formula: {
            const size = view.readUint16();
            return {
                ...base,
                size,
                type,
                formula: view.readString(size),
            };
        };
        case ConversionType.TextTable: {
            const size = view.readUint16();
            const table: [number, string][] = [];
            for (let i = 0; i < size; i++) {
                table.push([view.readReal(), view.readString(32)]);
            }
            return {
                ...base,
                size,
                type,
                table,
            };
        };
        case ConversionType.TextRangeTable: {
            const size = view.readUint16();
            view.readReal();
            view.readReal();
            const defaultLink = view.readLink();
            const table: [number, number, Link<TextBlock>][] = [];
            for (let i = 0; i < size && view.byteLength > 0; i++) {
                table.push([view.readReal(), view.readReal(), view.readLink()]);
            }
            return {
                ...base,
                size,
                type,
                default: defaultLink,
                table,
            };
        };
        default:
            return {
                ...base,
                type,
            };
    }

}

export function serializeChannelConversionBlock(_view: MdfView, _context: SerializeContext, _block: ChannelConversionBlock<'instanced'>) {
    throw new Error("Not implemented");
}

export function resolveChannelConversionOffset(_context: SerializeContext, _block: ChannelConversionBlock<'instanced'>) {
    throw new Error("Not implemented");
}

export async function readChannelConversionBlock(link: NonNullLink<ChannelConversionBlock>, reader: BufferedFileReader): Promise<ChannelConversionBlock<'linked'>>;
export async function readChannelConversionBlock(link: Link<ChannelConversionBlock>, reader: BufferedFileReader): Promise<ChannelConversionBlock<'linked'> | null>;
export async function readChannelConversionBlock(link: Link<ChannelConversionBlock>, reader: BufferedFileReader): Promise<ChannelConversionBlock<'linked'> | null> {
    const block = await readBlock(link, reader, "CC");
    return block === null ? null : deserializeChannelConversionBlock(block);
}
