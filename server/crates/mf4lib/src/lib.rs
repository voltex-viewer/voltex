#![allow(dead_code)]

mod blocks;
mod dbc;
mod frame;
mod trc;

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, Error, ErrorKind, SeekFrom};

use binrw::BinRead;

pub use crate::dbc::Dbc;
pub use crate::trc::Trc;
pub use crate::frame::*;
pub use crate::blocks::*;

pub struct Mf4 {
    file: File,
    path: String,
    id: Id,
    header: Header,
}

pub fn open(path: &str) -> Result<Mf4, Error> {
    let mut file = File::open(path).unwrap();
    let id = Id::read(&mut file).unwrap();
    if id.header != "MDF     " && id.header != "UnFinMF " {
        return Err(Error::new(ErrorKind::InvalidData, "Not a valid MF4 file"));
    }
    let header = Header::read(&mut file).unwrap();
    Ok(Mf4 {
        path: path.to_string(),
        id,
        header,
        file,
    })
}

pub enum ChannelData {
    Float32(Vec<f32>),
    Float64(Vec<f64>),
    Int8(Vec<i8>),
    Int16(Vec<i16>),
    Int32(Vec<i32>),
    Int64(Vec<i64>),
    UInt8(Vec<u8>),
    UInt16(Vec<u16>),
    UInt32(Vec<u32>),
    UInt64(Vec<u64>),
}

impl ChannelData {
    pub fn len(&self) -> usize {
        match self {
            ChannelData::Float32(v) => v.len(),
            ChannelData::Float64(v) => v.len(),
            ChannelData::Int8(v) => v.len(),
            ChannelData::Int16(v) => v.len(),
            ChannelData::Int32(v) => v.len(),
            ChannelData::Int64(v) => v.len(),
            ChannelData::UInt8(v) => v.len(),
            ChannelData::UInt16(v) => v.len(),
            ChannelData::UInt32(v) => v.len(),
            ChannelData::UInt64(v) => v.len(),
        }
    }

    pub fn as_f64(&self, index: usize) -> f64 {
        match self {
            ChannelData::Float32(v) => v.get(index).map(|&x| x as f64).unwrap_or(f64::NAN),
            ChannelData::Float64(v) => v.get(index).copied().unwrap_or(f64::NAN),
            ChannelData::Int8(v) => v.get(index).map(|&x| x as f64).unwrap_or(f64::NAN),
            ChannelData::Int16(v) => v.get(index).map(|&x| x as f64).unwrap_or(f64::NAN),
            ChannelData::Int32(v) => v.get(index).map(|&x| x as f64).unwrap_or(f64::NAN),
            ChannelData::Int64(v) => v.get(index).map(|&x| x as f64).unwrap_or(f64::NAN),
            ChannelData::UInt8(v) => v.get(index).map(|&x| x as f64).unwrap_or(f64::NAN),
            ChannelData::UInt16(v) => v.get(index).map(|&x| x as f64).unwrap_or(f64::NAN),
            ChannelData::UInt32(v) => v.get(index).map(|&x| x as f64).unwrap_or(f64::NAN),
            ChannelData::UInt64(v) => v.get(index).map(|&x| x as f64).unwrap_or(f64::NAN),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelDecoder {
    Float32Le { offset: usize },
    Float64Le { offset: usize },
    IntLe { offset: usize, bit_count: u32 },
    UintLe { offset: usize, bit_count: u32 },
}

impl ChannelDecoder {
    pub fn create_storage(&self, capacity: usize) -> ChannelData {
        match self {
            ChannelDecoder::Float32Le { .. } => ChannelData::Float32(Vec::with_capacity(capacity)),
            ChannelDecoder::Float64Le { .. } => ChannelData::Float64(Vec::with_capacity(capacity)),
            ChannelDecoder::IntLe { bit_count, .. } => {
                match *bit_count {
                    1..=8 => ChannelData::Int8(Vec::with_capacity(capacity)),
                    9..=16 => ChannelData::Int16(Vec::with_capacity(capacity)),
                    17..=32 => ChannelData::Int32(Vec::with_capacity(capacity)),
                    33..=64 => ChannelData::Int64(Vec::with_capacity(capacity)),
                    _ => ChannelData::Int64(Vec::with_capacity(capacity)),
                }
            }
            ChannelDecoder::UintLe { bit_count, .. } => {
                match *bit_count {
                    1..=8 => ChannelData::UInt8(Vec::with_capacity(capacity)),
                    9..=16 => ChannelData::UInt16(Vec::with_capacity(capacity)),
                    17..=32 => ChannelData::UInt32(Vec::with_capacity(capacity)),
                    33..=64 => ChannelData::UInt64(Vec::with_capacity(capacity)),
                    _ => ChannelData::UInt64(Vec::with_capacity(capacity)),
                }
            }
        }
    }

    pub fn decode_into(&self, data: &[u8], storage: &mut ChannelData) {
        match (self, storage) {
            (ChannelDecoder::Float32Le { offset }, ChannelData::Float32(vec)) => {
                let bytes = &data[*offset..*offset + 4];
                let val = f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
                vec.push(val);
            }
            (ChannelDecoder::Float64Le { offset }, ChannelData::Float64(vec)) => {
                let bytes = &data[*offset..*offset + 8];
                let val = f64::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7]]);
                vec.push(val);
            }
            (ChannelDecoder::IntLe { offset, bit_count }, storage) => {
                let byte_len = (*bit_count as usize + 7) / 8;
                let mut val: i64 = 0;
                for i in 0..byte_len {
                    val |= (data[*offset + i] as i64) << (8 * i);
                }
                let shift = 64 - *bit_count;
                let signed_val = (val << shift) >> shift;
                
                match storage {
                    ChannelData::Int8(vec) => vec.push(signed_val as i8),
                    ChannelData::Int16(vec) => vec.push(signed_val as i16),
                    ChannelData::Int32(vec) => vec.push(signed_val as i32),
                    ChannelData::Int64(vec) => vec.push(signed_val),
                    _ => unreachable!(),
                }
            }
            (ChannelDecoder::UintLe { offset, bit_count }, storage) => {
                let byte_len = (*bit_count as usize + 7) / 8;
                let mut val: u64 = 0;
                for i in 0..byte_len {
                    val |= (data[*offset + i] as u64) << (8 * i);
                }
                
                match storage {
                    ChannelData::UInt8(vec) => vec.push(val as u8),
                    ChannelData::UInt16(vec) => vec.push(val as u16),
                    ChannelData::UInt32(vec) => vec.push(val as u32),
                    ChannelData::UInt64(vec) => vec.push(val),
                    _ => unreachable!(),
                }
            }
            _ => unreachable!(),
        }
    }
}

pub struct ChannelGroupInfo {
    pub name: String,
    pub channels: Vec<ChannelInfo>,
}

pub struct ChannelInfo {
    pub name: String,
    pub unit: String,
}

pub struct DecodedChannelInfo {
    pub name: String,
    pub unit: String,
    pub data: ChannelData,
    decoder: ChannelDecoder,
}

pub struct DecodedChannelGroupInfo {
    pub name: String,
    pub data_bytes: u32,
    pub invalidation_bytes: u32,
    pub channels: Vec<DecodedChannelInfo>,
}

trait BlockWithNext<T> {
    fn get_next(&self) -> &NullableLink<T>;
}

impl BlockWithNext<DataListBlock> for DataListBlock {
    fn get_next(&self) -> &NullableLink<DataListBlock> {
        &self.data_list_next
    }
}

impl BlockWithNext<DataGroupBlock> for DataGroupBlock {
    fn get_next(&self) -> &NullableLink<DataGroupBlock> {
        &self.data_group_next
    }
}

impl BlockWithNext<ChannelGroupBlock> for ChannelGroupBlock {
    fn get_next(&self) -> &NullableLink<ChannelGroupBlock> {
        &self.channel_group_next
    }
}

impl BlockWithNext<ChannelBlock> for ChannelBlock {
    fn get_next(&self) -> &NullableLink<ChannelBlock> {
        &self.channel_next
    }
}

struct BlockIterator<T> {
    current_link: NullableLink<T>,
}

impl<T> BlockIterator<T>
where
    T: BlockWithNext<T>,
{
    fn new(first_link: NullableLink<T>) -> Self {
        Self { current_link: first_link }
    }
}

impl<T> BlockIterator<T>
where
    T: BlockWithNext<T> + BinRead + binrw::meta::ReadEndian,
    for<'a> T::Args<'a>: Default,
{
    fn next_with_file(&mut self, file: &mut File) -> Option<Result<T, Error>> {
        if let Some(link) = self.current_link.as_option() {
            match file.seek(SeekFrom::Start(link.get())) {
                Ok(_) => match T::read(file) {
                    Ok(block) => {
                        self.current_link = block.get_next().clone();
                        Some(Ok(block))
                    }
                    Err(e) => Some(Err(Error::new(ErrorKind::InvalidData, e))),
                }
                Err(e) => Some(Err(e)),
            }
        } else {
            None
        }
    }
    fn next_with_file_and_link(&mut self, file: &mut File) -> Option<Result<(T, Link<T>), Error>> {
        if let Some(link) = self.current_link.as_option() {
            match file.seek(SeekFrom::Start(link.get())) {
                Ok(_) => match T::read(file) {
                    Ok(block) => {
                        let link = link.clone();
                        self.current_link = block.get_next().clone();
                        Some(Ok((block, link)))
                    }
                    Err(e) => Some(Err(Error::new(ErrorKind::InvalidData, e))),
                }
                Err(e) => Some(Err(e)),
            }
        } else {
            None
        }
    }
}

impl Link<TextBlock> {
    pub fn get_text(&self, file: &mut File) -> Result<String, Error> {
        file.seek(SeekFrom::Start(self.get()))?;
        match TextBlock::read(file) {
            Ok(text_block) => Ok(text_block.data),
            Err(e) => Err(Error::new(ErrorKind::InvalidData, e)),
        }
    }
}

impl Mf4 {
    pub fn channels(&mut self) -> Result<Vec<ChannelGroupInfo>, Error> {
        let mut all_channel_groups = Vec::new();
        
        let mut data_group_iter = BlockIterator::new(self.header.first_data_group.clone());
        while let Some(data_group) = data_group_iter.next_with_file(&mut self.file).transpose()? {
            let mut channel_group_iter = BlockIterator::new(data_group.channel_group_first.clone());
            while let Some(channel_group) = channel_group_iter.next_with_file(&mut self.file).transpose()? {
                let channel_group_name = channel_group.acquisition_name.as_option()
                        .as_ref()
                        .map(|link| link.get_text(&mut self.file))
                        .transpose()?
                        .unwrap_or_default();

                let mut channels = Vec::new();

                let mut channel_iter = BlockIterator::new(channel_group.channel_first.clone());
                while let Some(channel) = channel_iter.next_with_file(&mut self.file).transpose()? {
                    let channel_name = channel.tx_name.as_option()
                        .as_ref()
                        .map(|link| link.get_text(&mut self.file))
                        .transpose()?
                        .unwrap_or_default();

                    let channel_unit = channel.unit.as_option().as_ref()
                        .map(|link| link.get_text(&mut self.file))
                        .transpose()?
                        .unwrap_or_default();
                    
                    channels.push(ChannelInfo {
                        name: channel_name,
                        unit: channel_unit,
                    });
                }
                
                all_channel_groups.push(ChannelGroupInfo {
                    name: channel_group_name,
                    channels,
                });
            }
        }
        Ok(all_channel_groups)
    }

    pub fn decode_all_data(&mut self) -> Result<Vec<DecodedChannelGroupInfo>, Error> {
        let mut all_channel_groups = Vec::new();
        
        let mut data_group_iter = BlockIterator::new(self.header.first_data_group.clone());
        while let Some(data_group) = data_group_iter.next_with_file(&mut self.file).transpose()? {
            if ![0, 1, 2, 4, 8].contains(&data_group.record_id_size) {
                return Err(Error::new(
                    ErrorKind::InvalidData,
                    format!("Invalid data group record ID size: {}", data_group.record_id_size),
                ));
            }

            let mut channel_groups = HashMap::<u64, DecodedChannelGroupInfo>::new();

            let mut channel_group_iter = BlockIterator::new(data_group.channel_group_first.clone());
            while let Some(channel_group) = channel_group_iter.next_with_file(&mut self.file).transpose()? {
                if channel_groups.contains_key(&channel_group.record_id) {
                    return Err(Error::new(
                        ErrorKind::InvalidData,
                        format!("Duplicate channel group record ID found: {}", channel_group.record_id),
                    ));
                } else if channel_group.record_id >= 1 << data_group.record_id_size {
                    return Err(Error::new(
                        ErrorKind::InvalidData,
                        format!("Channel group record ID {} exceeds data group record ID size {}", channel_group.record_id, data_group.record_id_size),
                    ));
                }

                let channel_group_name = channel_group.acquisition_name.as_option()
                        .as_ref()
                        .map(|link| link.get_text(&mut self.file))
                        .transpose()?
                        .unwrap_or_default();

                let mut channels = Vec::new();

                let mut channel_iter = BlockIterator::new(channel_group.channel_first.clone());
                while let Some(channel) = channel_iter.next_with_file(&mut self.file).transpose()? {
                    let channel_name = channel.tx_name.as_option()
                        .as_ref()
                        .map(|link| link.get_text(&mut self.file))
                        .transpose()?
                        .unwrap_or_default();

                    let channel_unit = channel.unit.as_option().as_ref()
                        .map(|link| link.get_text(&mut self.file))
                        .transpose()?
                        .unwrap_or_default();
                    
                    let decoder = match channel.data_type {
                        DataType::FloatLe => {
                            if channel.bit_offset != 0 {
                                return Err(Error::new(
                                    ErrorKind::InvalidData,
                                    format!("Float channel with non-zero bit offset: {}", channel.bit_offset),
                                ));
                            }
                            if channel.bit_count == 32 {
                                ChannelDecoder::Float32Le { offset: channel.byte_offset as usize }
                            } else if channel.bit_count == 64 {
                                ChannelDecoder::Float64Le { offset: channel.byte_offset as usize }
                            } else {
                                return Err(Error::new(
                                    ErrorKind::InvalidData,
                                    format!("Unsupported float bit count: {}", channel.bit_count),
                                ));
                            }
                        },
                        DataType::IntLe => ChannelDecoder::IntLe { offset: channel.byte_offset as usize, bit_count: channel.bit_count },
                        DataType::UintLe => ChannelDecoder::UintLe { offset: channel.byte_offset as usize, bit_count: channel.bit_count },
                        _ => continue, // Skip unsupported types
                    };
                    
                    if channel.channel_type == 1 {
                        panic!("Variable length channels are not supported yet");
                    }
                    
                    channels.push(DecodedChannelInfo {
                        name: channel_name,
                        unit: channel_unit,
                        data: decoder.create_storage(0),
                        decoder,
                    });
                }
                
                channel_groups.insert(channel_group.record_id, DecodedChannelGroupInfo {
                    name: channel_group_name,
                    data_bytes: channel_group.data_bytes,
                    invalidation_bytes: channel_group.invalidation_bytes,
                    channels,
                });
            }

            struct DataTableDecoderContext {
                buffer: Vec<u8>,
                preserve_bytes: usize,
            }
            let mut context = DataTableDecoderContext {
                buffer: vec![0_u8; 8192],
                preserve_bytes: 0,
            };

            fn decode_table(context: &mut DataTableDecoderContext, file: &mut File, channel_groups: &mut HashMap::<u64, DecodedChannelGroupInfo>, record_id_size: usize, data_table_link: &Link<DataTableBlock>) -> Result<(), Error> {
                file.seek(SeekFrom::Start(data_table_link.get()))?;
                let data_block = DataTableBlockHeader::read(file).unwrap();
                let mut remaining_bytes = data_block.length as usize - 24;

                while remaining_bytes > 0 {
                    let chunk_length = (context.buffer.len() - context.preserve_bytes).min(remaining_bytes);
                    let file_read_count = file.read(&mut context.buffer[context.preserve_bytes..context.preserve_bytes + chunk_length])?;
                    if file_read_count == 0 {
                        break;
                    }
                    remaining_bytes -= file_read_count;
                    let mut cursor = &context.buffer[0..file_read_count + context.preserve_bytes];
                    while cursor.len() >= record_id_size {
                        let record_id = match record_id_size {
                            0 => { 0 }
                            1 => { cursor[0] as u64 }
                            2 => { cursor[0..2].try_into().map(u16::from_le_bytes).unwrap() as u64 }
                            4 => { cursor[0..4].try_into().map(u32::from_le_bytes).unwrap() as u64 }
                            8 => { cursor[0..8].try_into().map(u64::from_le_bytes).unwrap() }
                            _ => unreachable!(),
                        };
                        cursor = &cursor[record_id_size..];
                        let group = channel_groups.get_mut(&record_id).ok_or_else(|| {
                            Error::new(
                                ErrorKind::InvalidData,
                                format!("Unknown record ID: {}", record_id),
                            )
                        })?;
                        if cursor.len() < group.data_bytes as usize + group.invalidation_bytes as usize {
                            break;
                        }

                        let record_data = &cursor[..group.data_bytes as usize];
                        for channel in &mut group.channels {
                            channel.decoder.decode_into(record_data, &mut channel.data);
                        }
                        cursor = &cursor[group.data_bytes as usize + group.invalidation_bytes as usize..];
                    }
                    context.preserve_bytes = cursor.len();
                    if context.preserve_bytes > 0 {
                        let cursor_start = cursor.as_ptr() as usize - context.buffer.as_ptr() as usize;
                        context.buffer.copy_within(cursor_start..cursor_start + context.preserve_bytes, 0);
                    }
                }
                Ok(())
            }

            if let Some(data_link) = data_group.data.as_option() {
                self.file.seek(SeekFrom::Start(data_link.get()))?;
                let block = DataGroupData::read(&mut self.file).unwrap();
                match block {
                    DataGroupData::DataListMagic => {
                        let link = NullableLink(Option::Some(Link::<DataListBlock>::from(data_link.get())));
                        let mut data_list_iter = BlockIterator::new(link);
                        while let Some(data_list_block) = data_list_iter.next_with_file(&mut self.file).transpose()? {
                            for data_table_link in &data_list_block.data {
                                decode_table(&mut context, &mut self.file, &mut channel_groups, data_group.record_id_size as usize, data_table_link)?;
                            }
                        }
                    },
                    DataGroupData::DataTableMagic => {
                        let link = Link::<DataTableBlock>::from(data_link.get());
                        decode_table(&mut context, &mut self.file, &mut channel_groups, data_group.record_id_size as usize, &link)?;
                    }
                };
            }

            
            all_channel_groups.extend(channel_groups.into_values());
        }
        
        Ok(all_channel_groups)
    }
}


fn main() {
    let mut file = File::open("ASAP2_Demo_V171.mf4").unwrap();
    println!("{:#?}", Id::read(&mut file).unwrap());
}
