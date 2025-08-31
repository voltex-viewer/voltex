use binrw::BinRead;

#[derive(Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct NullableLink<T>(pub Option<Link<T>>);

impl<T> Clone for NullableLink<T> {
    fn clone(&self) -> Self {
        NullableLink(self.0.clone())
    }
}

impl<T> std::fmt::Debug for NullableLink<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.0 {
            Some(link) => write!(f, "Some({:?})", link),
            None => write!(f, "None"),
        }
    }
}


impl<T> NullableLink<T> {
    /// Returns a reference to the inner Option<Link<T>>
    pub fn as_option(&self) -> &Option<Link<T>> {
        &self.0
    }

    /// Returns a mutable reference to the inner Option<Link<T>>
    pub fn as_option_mut(&mut self) -> &mut Option<Link<T>> {
        &mut self.0
    }
    
    pub(crate) fn as_ref(&self) -> &Option<Link<T>> {
        &self.0
    }
}

impl<T> BinRead for NullableLink<T> {
    type Args<'a> = ();
    fn read_options<R: binrw::io::Read + binrw::io::Seek>(
        reader: &mut R,
        endian: binrw::Endian,
        (): Self::Args<'_>,
    ) -> binrw::BinResult<Self> {
        let val = u64::read_options(reader, endian, ())?;
        if val == 0 {
            Ok(NullableLink(None))
        } else {
            Ok(NullableLink(Some(Link(val, std::marker::PhantomData))))
        }
    }
}

#[derive(BinRead, Debug)]
#[br(little)]
pub struct Id {
    #[br(count = 8)]
    #[br(map = |s: Vec<u8>| String::from_utf8_lossy(&s).to_string())]
    pub header: String,

    #[br(count = 8)]
    #[br(map = |s: Vec<u8>| String::from_utf8_lossy(&s).to_string())]
    pub version_long: String,

    #[br(count = 8)]
    #[br(map = |s: Vec<u8>| String::from_utf8_lossy(&s).to_string())]
    pub program: String,

    #[br(count = 4)]
    _reserved1: Vec<u8>,

    version: u16,

    #[br(count = 2)]
    _reserved2: Vec<u8>,

    #[br(count = 32)]
    fill: Vec<u8>,
}

#[derive(BinRead, Debug)]
#[br(little, magic = b"##HD")]
pub struct Header {
    _reserved: u32,
    length: u64,
    link_count: u64,
    pub first_data_group: NullableLink<DataGroupBlock>,
    file_history: NullableLink<()>,
    channel_hirarchy: NullableLink<()>,
    attachment: NullableLink<()>,
    event: NullableLink<()>,
    pub comment: NullableLink<MetadataBlock>,
    start_time: u64, // nanoseconds since unix epoch
    time_zone: u16,
    dst_offset: u16,
    time_flags: u8,
    time_quality: u8,
    flags: u8,
    reserved: u8,
    start_angle: u64,
    start_distance: u64,
}




#[derive(Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Link<T>(pub u64, std::marker::PhantomData<T>);

impl<T> Clone for Link<T> {
    fn clone(&self) -> Self {
        Link(self.0.clone(), std::marker::PhantomData)
    }
}

impl<T> BinRead for Link<T> {
    type Args<'a> = ();
    fn read_options<R: binrw::io::Read + binrw::io::Seek>(
        reader: &mut R,
        endian: binrw::Endian,
        (): Self::Args<'_>,
    ) -> binrw::BinResult<Self> {
        let val = u64::read_options(reader, endian, ())?;
        Ok(Link(val, std::marker::PhantomData))
    }
}

impl<T> Link<T> {
    pub fn get(&self) -> u64 { self.0 }
}

impl<T> From<u64> for Link<T> {
    fn from(val: u64) -> Self {
        Link(val, std::marker::PhantomData)
    }
}


impl<T> std::fmt::Debug for Link<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Link<{}>(0x{:X})", std::any::type_name::<T>(), self.0)
    }
}

impl<T> std::fmt::Display for Link<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "0x{:X}", self.0)
    }
}

#[derive(BinRead, Debug)]
#[br(little, magic = b"##")]
struct RawBlock {
    #[br(count = 2)]
    #[br(map = |s: Vec<u8>| String::from_utf8_lossy(&s).to_string())]
    id: String,
    _reserved: u32,
    length: u64,
    link_count: u64,
    #[br(count = link_count)]
    links: Vec<Link<()>>,
    #[br(count = length - 24 - link_count * 8)]
    payload: Vec<u8>,
}

#[derive(BinRead, Debug)]
#[br(little)]
pub enum DataGroupData {
    #[br(magic = b"##DL")]
    DataListMagic,
    #[br(magic = b"##DT")]
    DataTableMagic,
}

#[derive(BinRead, Debug)]
#[br(little, magic = b"##DG")]
pub struct DataGroupBlock {
    _reserved: u32,
    length: u64,
    links: u64,
    pub data_group_next: NullableLink<DataGroupBlock>,
    pub channel_group_first: NullableLink<ChannelGroupBlock>,
    pub data: NullableLink<DataGroupData>,
    pub comment: NullableLink<MetadataBlock>,
    pub record_id_size: u8,
    #[br(count = 7)]
    reserved: Vec<u8>,
}

const FLAGS_EQUAL_LENGTH: u8 = 0x01;
const FLAGS_TIME_VALUES: u8 = 0x02;
const FLAGS_ANGLE_VALUES: u8 = 0x04;
const FLAGS_DISTANCE_VALUES: u8 = 0x08;

#[derive(BinRead, Debug)]
#[br(little, magic = b"##DL")]
pub struct DataListBlock {
    _reserved: u32,
    length: u64,
    links: u64,
    pub data_list_next: NullableLink<DataListBlock>,
    #[br(count = links - 1)]
    pub data: Vec<Link<DataTableBlock>>,
    pub flags: u8,
    _reserved2: [u8; 3],
    number_of_blocks: u32,
    #[br(count = number_of_blocks)]
    pub offsets: Vec<Link<()>>,
}

#[derive(BinRead, Debug)]
#[br(little, magic = b"##DT")]
pub struct DataTableBlockHeader {
    _reserved: u32,
    pub length: u64,
    links: u64,
}

#[derive(BinRead, Debug)]
#[br(little, magic = b"##DT")]
pub struct DataTableBlock {
    _reserved: u32,
    length: u64,
    links: u64,
    #[br(count = length - 24)]
    pub data: Vec<u8>
}

#[derive(BinRead, Debug)]
#[br(little, magic = b"##CG")]
pub struct ChannelGroupBlock {
    _reserved: u32,
    length: u64,
    links: u64,
    pub channel_group_next: NullableLink<ChannelGroupBlock>,
    pub channel_first: NullableLink<ChannelBlock>,
    pub acquisition_name: NullableLink<TextBlock>,
    pub acquisition_source: NullableLink<()>,
    pub sample_reduction_first: NullableLink<()>,
    pub comment: NullableLink<()>,
    pub record_id: u64,
    pub cycle_count: u64,
    pub flags: u16,
    pub path_separator: u16,
    #[br(count = 4)]
    _reserved2: Vec<u8>,
    pub data_bytes: u32,
    pub invalidation_bytes: u32,
}

#[derive(Debug)]
pub enum DataType {
    UintLe = 0,
    UintBe = 1,
    IntLe = 2,
    IntBe = 3,
    FloatLe = 4,
    FloatBe = 5,
    StringAscii = 6,
    StringUtf8 = 7,
    StringUtf16Le = 8,
    StringUtf16Be = 9,
    ByteArray = 10,
    MimeSample = 11,
    MimeStream = 12,
    CanOpenDate = 13,
    CanOpenTime = 14,
    ComplexLe = 15,
    ComplexBe = 16,
}

impl BinRead for DataType {
    type Args<'a> = ();
    
    fn read_options<R: binrw::io::Read + binrw::io::Seek>(
        reader: &mut R,
        endian: binrw::Endian,
        (): Self::Args<'_>,
    ) -> binrw::BinResult<Self> {
        let val = u8::read_options(reader, endian, ())?;
        match val {
            0 => Ok(DataType::UintLe),
            1 => Ok(DataType::UintBe),
            2 => Ok(DataType::IntLe),
            3 => Ok(DataType::IntBe),
            4 => Ok(DataType::FloatLe),
            5 => Ok(DataType::FloatBe),
            6 => Ok(DataType::StringAscii),
            7 => Ok(DataType::StringUtf8),
            8 => Ok(DataType::StringUtf16Le),
            9 => Ok(DataType::StringUtf16Be),
            10 => Ok(DataType::ByteArray),
            11 => Ok(DataType::MimeSample),
            12 => Ok(DataType::MimeStream),
            13 => Ok(DataType::CanOpenDate),
            14 => Ok(DataType::CanOpenTime),
            15 => Ok(DataType::ComplexLe),
            16 => Ok(DataType::ComplexBe),
            _ => Err(binrw::Error::BadMagic { 
                pos: reader.stream_position().unwrap_or(0),
                found: Box::new(val)
            }),
        }
    }
}

#[derive(BinRead, Debug)]
#[br(little, magic = b"##CN")]
pub struct ChannelBlock {
    _reserved1: u32,
    length: u64,
    links: u64,
    pub channel_next: NullableLink<ChannelBlock>,
    pub component: NullableLink<()>,
    pub tx_name: NullableLink<TextBlock>,
    pub si_source: NullableLink<()>,
    pub conversion: NullableLink<ChannelConversionBlock>,
    pub data: NullableLink<()>,
    pub unit: NullableLink<TextBlock>,
    pub comment: NullableLink<TextBlock>,
    pub channel_type: u8,
    pub sync_type: u8,
    pub data_type: DataType,
    pub bit_offset: u8,
    pub byte_offset: u32,
    pub bit_count: u32,
    pub flags: u32,
    pub invalidation_bit_position: u32,
    pub precision: u8,
    _reserved2: u8,
    pub attachment_count: u16,
    pub value_range_minimum: f64,
    pub value_range_maximum: f64,
    pub limit_minimum: f64,
    pub limit_maximum: f64,
    pub limit_extended_minimum: f64,
    pub limit_extended_maximum: f64,
}

#[derive(Debug)]
pub enum ConversionType {
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

impl BinRead for ConversionType {
    type Args<'a> = ();
    
    fn read_options<R: binrw::io::Read + binrw::io::Seek>(
        reader: &mut R,
        endian: binrw::Endian,
        (): Self::Args<'_>,
    ) -> binrw::BinResult<Self> {
        let val = u8::read_options(reader, endian, ())?;
        match val {
            0 => Ok(ConversionType::OneToOne),
            1 => Ok(ConversionType::Linear),
            2 => Ok(ConversionType::Rational),
            3 => Ok(ConversionType::Algebraic),
            4 => Ok(ConversionType::ValueToValueTableWithInterpolation),
            5 => Ok(ConversionType::ValueToValueTableWithoutInterpolation),
            6 => Ok(ConversionType::ValueRangeToValueTable),
            7 => Ok(ConversionType::ValueToTextOrScale),
            8 => Ok(ConversionType::ValueRangeToTextOrScale),
            9 => Ok(ConversionType::TextToValue),
            10 => Ok(ConversionType::TextToText),
            _ => Err(binrw::Error::BadMagic {
                pos: reader.stream_position().unwrap_or(0),
                found: Box::new(val)
            }),
        }
    }
}

#[derive(BinRead, Debug)]
#[br(little, magic = b"##CC")]
pub struct ChannelConversionBlock {
    _reserved1: u32,
    length: u64,
    links: u64,
    pub tx_name: NullableLink<TextBlock>,
    pub md_unit: NullableLink<()>, // TextBlock or MetadataBlock
    pub md_comment: NullableLink<()>, // TextBlock or MetadataBlock
    pub inverse: NullableLink<ChannelConversionBlock>,
    #[br(count = links - 4)]
    pub refs: Vec<Link<ChannelConversionOrTextBlock>>,
    pub conversion_type: ConversionType,
    pub precision: u8,
    pub flags: u16,
    pub reference_count: u16,
    pub value_count: u16,
    pub physical_range_minimum: f64,
    pub physical_range_maximum: f64,
    #[br(count = value_count)]
    pub values: Vec<f64>,
}

#[derive(BinRead, Debug)]
#[br(little)]
pub enum ChannelConversionOrTextBlock {
    ChannelConversionBlock(ChannelConversionBlock),
    TextBlock(TextBlock),
}


#[derive(BinRead, Debug)]
#[br(little, magic = b"##MD")]
pub struct MetadataBlock {
    _reserved: u32,
    length: u64,
    links: u64,
    #[br(count = length-24)]
    #[br(map = |s: Vec<u8>| String::from_utf8_lossy(&s).to_string())]
    pub data: String,
}

#[derive(BinRead, Debug)]
#[br(little, magic = b"##FH")]
pub struct FileHistoryBlock {
    _reserved: u32,
    length: u64,
    links: u64,
    file_history_next: NullableLink<()>,
    metadata: NullableLink<()>,
    time: u64,
    time_zone: u16,
    dst_offset: u16,
    time_flags: u8,
    _reserved2: [u8; 3],
}

#[derive(BinRead, Debug)]
#[br(little, magic = b"##TX")]
pub struct TextBlock {
    _reserved: u32,
    length: u64,
    links: u64,
    #[br(count = length-24)]
    #[br(map = |s: Vec<u8>| String::from_utf8_lossy(&s).to_string())]
    pub data: String,
}

#[derive(BinRead, Debug)]
#[br(little, magic = b"##SI")]
pub struct SourceInformationBlock {
    _reserved: u32,
    length: u64,
    links: u64,
    source_name: NullableLink<()>,
    source_path: NullableLink<()>,
    comment: NullableLink<()>,
    source_type: u8,
    bus_type: u8,
    flags: u8,
    reserved: [u8; 5],
}

#[derive(BinRead, Debug)]
#[br(little, magic = b"##CC")]
pub struct ConversionBlock {
    _reserved: u32,
    length: u64,
    links: u64,
    name: NullableLink<()>,
    physical_unit: NullableLink<()>,
    comment: NullableLink<()>,
    inverse: NullableLink<()>,
    conversion_type: u8,
    precision: u8,
    flags: u16,
    reference_count: u16,
    value_count: u16,
    physical_range_minimum: f64,
    physical_range_maximum: f64,
    #[br(count = value_count)]
    parameter_value: Vec<f64>,
}
