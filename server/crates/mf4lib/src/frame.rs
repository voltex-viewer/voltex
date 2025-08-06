#[derive(Debug, PartialEq)]
pub struct Frame {
    pub id: u32,
    pub time_us: u64,
    pub data: Vec<u8>,
}
