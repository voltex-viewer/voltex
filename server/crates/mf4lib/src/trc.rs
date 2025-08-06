use chrono::{Duration, NaiveDate, NaiveDateTime};
use regex::Regex;
use std::{
    fs::File,
    io::{self, BufRead, Seek},
    path::{Path, PathBuf},
};

use crate::frame::Frame;

pub struct Trc {
    path: PathBuf,
    file_version: String,
    start_time: Option<NaiveDateTime>,
    start_position: u64,
    columns: Vec<Column>,
}

#[derive(Clone, Debug)]
enum Column {
    Number,
    Offset,
    TxRxError,
    Type,
    Bus,
    Id,
    Ignore,
    Length,
    Data,
}

impl Trc {
    pub fn open(path: impl AsRef<Path>) -> io::Result<Self> {
        let file = File::open(&path)?;
        let mut reader = io::BufReader::new(file);
        let mut buffer = String::new();
        let variable_regex = Regex::new(r"^;\$([A-Z]+)=(.*?)(?:\r?\n)?$").unwrap();
        let decimal_regex = Regex::new(r"^(\d+)\.(\d+)").unwrap();
        let mut file_version = "1.0".to_string();
        let mut start_time = None;
        let mut start_position;
        let mut columns = Vec::new();
        loop {
            start_position = reader.stream_position().unwrap();
            buffer.clear();
            reader.read_line(&mut buffer)?;
            if buffer.starts_with(';') {
                if let Some(captures) = variable_regex.captures(&buffer) {
                    let key = captures.get(1).unwrap().as_str();
                    let value = captures.get(2).unwrap().as_str();
                    if key == "FILEVERSION" {
                        file_version = value.to_string();
                    } else if key == "STARTTIME" {
                        let value = decimal_regex
                            .captures(value)
                            .unwrap()
                            .get(0)
                            .unwrap()
                            .as_str();
                        let days = value.parse::<f64>().unwrap();
                        let start = NaiveDate::from_ymd_opt(1899, 12, 30)
                            .and_then(|x| x.and_hms_opt(0, 0, 0))
                            .unwrap();
                        start_time = start.checked_add_signed(
                            Duration::days(days.trunc() as i64)
                                + Duration::milliseconds(
                                    (days.fract() * 86_400_000.0).round() as i64
                                ),
                        );
                    } else if key == "COLUMNS" {
                        columns.extend(value.split(',').map(|x| match x {
                            "d" => Column::Ignore,
                            "D" => Column::Data,
                            "I" => Column::Id,
                            "l" => Column::Ignore,
                            "L" => Column::Length,
                            "N" => Column::Number,
                            "O" => Column::Offset,
                            "T" => Column::Type,
                            _ => Column::Ignore,
                        }));
                    }
                }
            } else {
                break;
            }
        }
        if columns.is_empty() {
            match file_version.as_str() {
                "1.0" => {
                    columns.extend([Column::Number, Column::Offset, Column::Id, Column::Length])
                }
                "1.1" => columns.extend([
                    Column::Number,
                    Column::Offset,
                    Column::TxRxError,
                    Column::Id,
                    Column::Length,
                    Column::Data,
                ]),
                "1.2" => columns.extend([
                    Column::Number,
                    Column::Offset,
                    Column::Bus,
                    Column::TxRxError,
                    Column::Id,
                    Column::Length,
                    Column::Data,
                ]),
                "1.3" => columns.extend([
                    Column::Number,
                    Column::Offset,
                    Column::Bus,
                    Column::TxRxError,
                    Column::Id,
                    Column::Ignore,
                    Column::Length,
                    Column::Data,
                ]),
                _ => (),
            };
        }
        Ok(Self {
            path: path.as_ref().to_path_buf(),
            file_version,
            start_time,
            start_position,
            columns,
        })
    }

    pub fn file_version(&self) -> &str {
        &self.file_version
    }

    pub fn start_time(&self) -> Option<&NaiveDateTime> {
        self.start_time.as_ref()
    }

    pub fn iter(&self) -> NodeIter {
        let mut file = File::open(&self.path).unwrap();
        file.seek(io::SeekFrom::Start(self.start_position)).unwrap();
        let reader = io::BufReader::new(file);

        NodeIter {
            reader,
            buffer: String::new(),
            columns: self.columns.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_1_0() {
        let trc = Trc::open("test/trc/1.0.trc").unwrap();
        assert_eq!(trc.file_version(), "1.0");
        assert_eq!(trc.start_time(), None);
        assert_eq!(
            trc.iter().collect::<Vec<_>>(),
            vec![Frame {
                id: 0x0001,
                time_us: 1841_000,
                data: vec![0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
            },]
        );
    }

    #[test]
    fn test_version_1_1() {
        let trc = Trc::open("test/trc/1.1.trc").unwrap();
        assert_eq!(trc.file_version(), "1.1");
        assert_eq!(
            trc.start_time(),
            Some(
                NaiveDate::from_ymd_opt(2003, 3, 24)
                    .and_then(|x| x.and_hms_milli_opt(12, 52, 32, 484))
                    .unwrap()
            )
            .as_ref()
        );
        assert_eq!(
            trc.iter().collect::<Vec<_>>(),
            vec![
                Frame {
                    id: 0x0300,
                    time_us: 1059_900,
                    data: vec![0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00]
                },
                Frame {
                    id: 0x0300,
                    time_us: 1283_200,
                    data: vec![0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00]
                },
                Frame {
                    id: 0x0400,
                    time_us: 1298_900,
                    data: vec![0x00, 0x00]
                },
                Frame {
                    id: 0x0300,
                    time_us: 1323_000,
                    data: vec![0x00, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00]
                },
            ]
        );
    }

    #[test]
    fn test_version_1_2() {
        let trc = Trc::open("test/trc/1.2.trc").unwrap();
        assert_eq!(trc.file_version(), "1.2");
        assert_eq!(
            trc.start_time(),
            Some(
                NaiveDate::from_ymd_opt(2009, 3, 6)
                    .and_then(|x| x.and_hms_milli_opt(16, 15, 12, 317))
                    .unwrap()
            )
            .as_ref()
        );
        assert_eq!(
            trc.iter().collect::<Vec<_>>(),
            vec![
                Frame {
                    id: 0x0300,
                    time_us: 1059_900,
                    data: vec![0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00]
                },
                Frame {
                    id: 0x0300,
                    time_us: 1283_231,
                    data: vec![0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00]
                },
                Frame {
                    id: 0x0400,
                    time_us: 1298_945,
                    data: vec![0x00, 0x00]
                },
                Frame {
                    id: 0x0300,
                    time_us: 1323_201,
                    data: vec![0x00, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00]
                },
            ]
        );
    }

    #[test]
    fn test_version_1_3() {
        let trc = Trc::open("test/trc/1.3.trc").unwrap();
        assert_eq!(trc.file_version(), "1.3");
        assert_eq!(
            trc.start_time(),
            Some(
                NaiveDate::from_ymd_opt(2009, 7, 29)
                    .and_then(|x| x.and_hms_milli_opt(12, 35, 20, 701))
                    .unwrap()
            )
            .as_ref()
        );
        assert_eq!(
            trc.iter().collect::<Vec<_>>(),
            vec![
                Frame {
                    id: 0x0300,
                    time_us: 1059_900,
                    data: vec![0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00]
                },
                Frame {
                    id: 0x0300,
                    time_us: 1283_231,
                    data: vec![0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00]
                },
                Frame {
                    id: 0x0400,
                    time_us: 1298_945,
                    data: vec![0x00, 0x00]
                },
                Frame {
                    id: 0x0300,
                    time_us: 1323_201,
                    data: vec![0x00, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00]
                },
            ]
        );
    }

    #[test]
    fn test_version_2_0() {
        let trc = Trc::open("test/trc/2.0.trc").unwrap();
        assert_eq!(trc.file_version(), "2.0");
        assert_eq!(
            trc.start_time(),
            Some(
                NaiveDate::from_ymd_opt(2015, 7, 24)
                    .and_then(|x| x.and_hms_milli_opt(9, 46, 56, 615))
                    .unwrap()
            )
            .as_ref()
        );
        assert_eq!(
            trc.iter().collect::<Vec<_>>(),
            vec![
                Frame {
                    id: 0x0300,
                    time_us: 1059_900,
                    data: vec![0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00]
                },
                Frame {
                    id: 0x0300,
                    time_us: 1283_231,
                    data: vec![0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00]
                },
                Frame {
                    id: 0x0400,
                    time_us: 1298_945,
                    data: vec![0x00, 0x00]
                },
                Frame {
                    id: 0x0300,
                    time_us: 1323_201,
                    data: vec![0x00, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00]
                },
                Frame {
                    id: 0x0500,
                    time_us: 1334_416,
                    data: vec![
                        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C
                    ]
                },
                Frame {
                    id: 0x18EFC034,
                    time_us: 1335_156,
                    data: vec![0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]
                },
            ]
        );
    }

    #[test]
    fn test_version_2_1() {
        let trc = Trc::open("test/trc/2.1.trc").unwrap();
        assert_eq!(trc.file_version(), "2.1");
        assert_eq!(
            trc.start_time(),
            Some(
                NaiveDate::from_ymd_opt(2014, 5, 7) // There is a mistake in the file, the date is actually 2014, not 2015
                    .and_then(|x| x.and_hms_milli_opt(11, 9, 27, 048))
                    .unwrap()
            )
            .as_ref()
        );
        assert_eq!(
            trc.iter().collect::<Vec<_>>(),
            vec![
                Frame {
                    id: 0x0300,
                    time_us: 1059_900,
                    data: vec![0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00]
                },
                Frame {
                    id: 0x0300,
                    time_us: 1283_231,
                    data: vec![0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00]
                },
                Frame {
                    id: 0x0400,
                    time_us: 1298_945,
                    data: vec![0x00, 0x00]
                },
                Frame {
                    id: 0x0300,
                    time_us: 1323_201,
                    data: vec![0x00, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00]
                },
                Frame {
                    id: 0x0500,
                    time_us: 1334_416,
                    data: vec![
                        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C
                    ]
                },
                Frame {
                    id: 0x18EFC034,
                    time_us: 1335_156,
                    data: vec![0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]
                },
            ]
        );
    }
}

pub struct NodeIter {
    reader: io::BufReader<File>,
    buffer: String,
    columns: Vec<Column>,
}

impl Iterator for NodeIter {
    type Item = Frame;

    fn next(&mut self) -> Option<Self::Item> {
        'next_line: loop {
            self.buffer.clear();
            let len = self.reader.read_line(&mut self.buffer).ok()?;
            if len == 0 {
                return None;
            }
            if self.buffer.starts_with(';') {
                continue 'next_line;
            } else {
                let mut id: u32 = 0;
                let mut time_us: u64 = 0;
                let mut data: Vec<u8> = Vec::new();
                let mut start = 0usize;
                let mut column = self.columns.iter();
                for (i, c) in self.buffer.chars().enumerate() {
                    if [' ', '\r', '\n'].contains(&c) {
                        if start != i {
                            let str = &self.buffer[start..i];
                            let col = column.next();
                            match col {
                                None | Some(Column::Data) => match u8::from_str_radix(str, 16) {
                                    Ok(byte) => data.push(byte),
                                    Err(_) => continue 'next_line,
                                },
                                Some(col) => match col {
                                    Column::Number => (),
                                    Column::Offset => {
                                        time_us = (str.parse::<f64>().unwrap() * 1000.0) as u64
                                    }
                                    Column::TxRxError => {
                                        if !["Rx", "Tx"].contains(&str) {
                                            continue 'next_line;
                                        }
                                    }
                                    Column::Bus => (),
                                    Column::Id => id = u32::from_str_radix(str, 16).unwrap(),
                                    Column::Type => {
                                        if !["DT", "FD"].contains(&str) {
                                            continue 'next_line;
                                        }
                                    }
                                    Column::Ignore => (),
                                    Column::Length => (),
                                    Column::Data => (), // handled above
                                },
                            }
                        }
                        start = i + 1;
                    }
                }
                return Some(Frame { id, time_us, data });
            }
        }
    }
}
