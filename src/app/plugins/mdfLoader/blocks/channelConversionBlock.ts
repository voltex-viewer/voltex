import { Link, readBlock, GenericBlock, MaybeLinked } from './common';
import { SerializeContext } from './serializer';
import { TextBlock, MetadataBlock, resolveTextBlockOffset } from './textBlock';
import { BufferedFileReader } from '../BufferedFileReader';

export enum ConversionType {
    OneToOne = 0,
    Linear = 1,
    Rational = 2,
    Algebraic = 3,
    ValueToValueTableWithInterpolation = 4,
    ValueToValueTableWithoutInterpolation = 5,
    ValueRangeToValueTable = 6,
    ValueToTextOrScale = 7,
    ValueRangeToTextOrScale = 8,
    TextToValue = 9,
    TextToText = 10,
}

export interface OneToOneConversion {
    type: ConversionType.OneToOne,
    values: [],
    refs: [],
}

export interface LinearConversion {
    type: ConversionType.Linear,
    values: [intercept: number, slope: number],
    refs: [],
}

export interface RationalConversion {
    type: ConversionType.Rational,
    values: [numerator_x2: number, numerator_x1: number, numerator_x0: number, denominator_x2: number, denominator_x1: number, denominator_x0: number],
    refs: [],
}

export interface ValueToValueTableWithInterpolation {
    type: ConversionType.ValueToValueTableWithInterpolation,
    values: number[],
    refs: [],
}

export interface ValueToValueTableWithoutInterpolation {
    type: ConversionType.ValueToValueTableWithoutInterpolation,
    values: number[],
    refs: [],
}

export interface ValueRangeToValueTable {
    type: ConversionType.ValueRangeToValueTable,
    values: number[];
    refs: [],
}

export interface ValueToTextOrScale<TMode extends 'linked' | 'instanced' = 'linked'> {
    type: ConversionType.ValueToTextOrScale,
    values: number[];
    refs: MaybeLinked<ChannelConversionBlock<TMode> | TextBlock, TMode>[];
}

export interface ValueRangeToTextOrScale<TMode extends 'linked' | 'instanced' = 'linked'> {
    type: ConversionType.ValueRangeToTextOrScale,
    values: number[];
    refs: MaybeLinked<ChannelConversionBlock<TMode> | TextBlock, TMode>[];
}

export interface TextToValue<TMode extends 'linked' | 'instanced' = 'linked'> {
    type: ConversionType.TextToValue,
    values: number[];
    refs: MaybeLinked<TextBlock, TMode>[];
}

export interface TextToText<TMode extends 'linked' | 'instanced' = 'linked'> {
    type: ConversionType.TextToText,
    values: [];
    refs: MaybeLinked<TextBlock, TMode>[];
}

export interface ChannelConversionBlockBase<TMode extends 'linked' | 'instanced' = 'linked'> {
    txName: MaybeLinked<TextBlock, TMode>;
    mdUnit: MaybeLinked<TextBlock | MetadataBlock, TMode>; // TextBlock or MetadataBlock
    mdComment: MaybeLinked<unknown, TMode>; // TextBlock or MetadataBlock
    inverse: MaybeLinked<ChannelConversionBlock<TMode>, TMode>;
    precision: number;
    flags: number;
    physicalRangeMinimum: number;
    physicalRangeMaximum: number;
};

export type ChannelConversionBlock<TMode extends 'linked' | 'instanced' = 'linked'> = ChannelConversionBlockBase<TMode> & (OneToOneConversion | LinearConversion | RationalConversion | ValueToValueTableWithInterpolation | ValueToValueTableWithoutInterpolation | ValueRangeToValueTable | ValueToTextOrScale<TMode> | ValueRangeToTextOrScale<TMode> | TextToValue<TMode> | TextToText<TMode>);

export function deserializeConversionBlock(block: GenericBlock): ChannelConversionBlock<'linked'> {
    const view = block.buffer;

    const refsCount = view.getUint16(4, true);
    const valueCount = view.getUint16(6, true);
    
    const values = [];
    for (let offset = 24; offset < 24 + valueCount * 8; offset += 8) {
        values.push(view.getFloat64(offset, true));
    }

    return {
        txName: block.links[0] as Link<TextBlock>,
        mdUnit: block.links[1] as Link<TextBlock | MetadataBlock>,
        mdComment: block.links[2] as Link<unknown>,
        inverse: block.links[3] as Link<ChannelConversionBlock>,
        refs: block.links.slice(4, 4 + refsCount) as Link<ChannelConversionBlock | TextBlock>[],
        type: view.getUint8(0),
        precision: view.getUint8(1),
        flags: view.getUint16(2, true),
        physicalRangeMinimum: view.getFloat64(8, true),
        physicalRangeMaximum: view.getFloat64(16, true),
        values
    };
}

export function serializeConversionBlock(view: DataView, context: SerializeContext, block: ChannelConversionBlock<'instanced'>) {
    view.setBigUint64(0, context.get(block.txName), true);
    view.setBigUint64(8, context.get(block.mdUnit), true);
    view.setBigUint64(16, context.get(block.mdComment), true);
    view.setBigUint64(24, context.get(block.inverse), true);

    for (let i = 0; i < block.refs.length; i++) {
        view.setBigUint64(32 + i * 8, context.get(block.refs[i]), true);
    }

    const dataOffset = (4 + block.refs.length) * 8;

    view.setUint8(dataOffset, block.type);
    view.setUint8(dataOffset + 1, block.precision);
    view.setUint16(dataOffset + 2, block.flags, true);
    view.setUint16(dataOffset + 4, block.refs.length, true);
    view.setUint16(dataOffset + 6, block.values.length, true);
    view.setFloat64(dataOffset + 8, block.physicalRangeMinimum, true);
    view.setFloat64(dataOffset + 16, block.physicalRangeMaximum, true);

    for (let i = 0; i < block.values.length; i++) {
        view.setFloat64(dataOffset + 24 + i * 8, block.values[i], true);
    }
}

export function resolveChannelConversionOffset(context: SerializeContext, block: ChannelConversionBlock<'instanced'>) {
    return context.resolve(
        block, 
        {
            type: "##CC",
            length: block === null ? 0n : BigInt(56 + block.refs.length * 8 + block.values.length * 8),
            linkCount: 4n + (block === null ? 0n : BigInt(block.refs.length)),
        },
        serializeConversionBlock,
        block => {
            resolveTextBlockOffset(context, block.txName);
            resolveChannelConversionOffset(context, block.inverse);
            for (const ref of block.refs) {
                if (ref === null) continue;
                if ('data' in ref) {
                    resolveTextBlockOffset(context, ref);
                } else {
                    resolveChannelConversionOffset(context, ref);
                }
            }
        });
}

export async function readConversionBlock(link: Link<ChannelConversionBlock>, reader: BufferedFileReader): Promise<ChannelConversionBlock<'linked'>> {
    return deserializeConversionBlock(await readBlock(link, reader, "##CC"));
}
