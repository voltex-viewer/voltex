use std::{
    collections::{HashMap, HashSet},
    error::Error,
    fmt,
    fs::{self, File},
    io::{self, BufWriter, Write},
    iter::Peekable,
    path::Path,
    str::CharIndices,
};

type MessageId = u32;

#[derive(Debug)]
pub struct Dbc {
    messages: Vec<Message>,
}

impl Message {
    fn iter_signals(&self) -> DepthFirstTreeIter {
        DepthFirstTreeIter {
            stack: self
                .signals
                .iter()
                .map(|x| {
                    (
                        MultiplexerIndicator {
                            is_multiplexer: !x.multiplexed.is_empty(),
                            mux_index: None,
                        },
                        x,
                    )
                })
                .collect(),
        }
    }
}

struct DepthFirstTreeIter<'a> {
    stack: Vec<(MultiplexerIndicator, &'a Signal)>,
}

impl<'a> Iterator for DepthFirstTreeIter<'a> {
    type Item = (MultiplexerIndicator, &'a Signal);

    fn next(&mut self) -> Option<(MultiplexerIndicator, &'a Signal)> {
        if self.stack.is_empty() {
            None
        } else {
            let cur: Option<(MultiplexerIndicator, &'a Signal)> = self.stack.pop();
            for tree in cur.iter() {
                for (mux, values) in tree.1.multiplexed.iter() {
                    for signal in values.iter() {
                        self.stack.push((
                            MultiplexerIndicator {
                                is_multiplexer: !signal.multiplexed.is_empty(),
                                mux_index: Some(*mux),
                            },
                            signal,
                        ))
                    }
                }
            }
            cur
        }
    }
}

#[derive(Debug)]
pub struct ParseError {
    message: String,
    error_line: String,
    line: usize,
    column: usize,
    position: usize,
}

impl Error for ParseError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        None
    }

    fn description(&self) -> &str {
        "description() is deprecated; use Display"
    }

    fn cause(&self) -> Option<&dyn Error> {
        self.source()
    }
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Parse error, {} at line {}, column {}:\n{}\n{}^",
            self.message,
            self.line,
            self.column,
            self.error_line,
            " ".repeat(if self.column > 0 { self.column - 1 } else { 0 })
        )
    }
}

impl ParseError {
    fn new(input: &str, position: usize, message: String) -> Self {
        let mut line = 1;
        let mut column = 0;
        let mut start = 0;
        let mut end = 0;
        for (pos, char) in input.char_indices() {
            if pos < position {
                if char == '\n' {
                    line += 1;
                    column = 1;
                    start = pos + 1;
                } else {
                    column += 1;
                }
            } else if char == '\r' || char == '\n' {
                end = pos;
                break;
            }
        }
        if end == 0 {
            end = input.len();
        }
        ParseError {
            message,
            error_line: input[start..end].to_string(),
            line,
            column,
            position,
        }
    }
}

#[derive(Debug)]
struct Message {
    id: MessageId,
    name: String,
    len: u32,
    transmitter: Option<String>,
    signals: Vec<Signal>,
}

#[derive(Debug)]
pub struct Signal {
    name: String,
    start_bit: u32,
    signal_size: u32,
    byte_order: ByteOrder,
    value_type: ValueType,
    factor: f64,
    offset: f64,
    minimum: f64,
    maximum: f64,
    unit: String,
    receiver: Vec<String>,
    value_descriptions: HashMap<i64, String>,
    multiplexed: HashMap<u64, Vec<Signal>>,
}

#[derive(Debug)]
struct MessageNative<'a> {
    id: MessageId,
    name: &'a str,
    len: u32,
    transmitter: Option<&'a str>,
}

#[derive(Clone, Debug)]
pub enum ByteOrder {
    BigEndian,
    LittleEndian,
}

#[derive(Clone, Debug)]
pub enum ValueType {
    Unsigned,
    Signed,
}

#[derive(Clone, Debug)]
struct MultiplexerIndicator {
    is_multiplexer: bool,
    mux_index: Option<u64>,
}

#[derive(Debug)]
struct SignalNative<'a> {
    name: &'a str,
    multiplexer_indicator: MultiplexerIndicator,
    start_bit: u32,
    signal_size: u32,
    byte_order: ByteOrder,
    value_type: ValueType,
    factor: f64,
    offset: f64,
    minimum: f64,
    maximum: f64,
    unit: &'a str,
    receiver: Vec<&'a str>,
}

type ValueDescriptions<'a> = HashMap<i64, &'a str>;

struct Lexer<'source> {
    input: &'source str,
    iter: Peekable<CharIndices<'source>>,

    // c is the last char taken from iter, and ci is its offset in the input.
    c: char,
    ci: usize,

    // error is true iff the lexer encountered an error.
    error: bool,
}

impl<'source> Lexer<'source> {
    pub fn new(input: &'source str) -> Self {
        let mut lex = Self {
            input,
            iter: input.char_indices().peekable(),
            c: '\x00',
            ci: 0,
            error: false,
        };
        lex.scan_char();
        lex
    }

    fn scan_char(&mut self) {
        if let Some((index, chr)) = self.iter.next() {
            self.ci = index;
            self.c = chr;
        } else {
            self.ci = self.input.len();
            self.c = '\x00';
        }
    }

    fn scan_while<F>(&mut self, pred: F) -> &'source str
    where
        F: Fn(char) -> bool,
    {
        let startpos = self.ci;
        while pred(self.c) {
            self.scan_char();
        }
        &self.input[startpos..self.ci]
    }

    fn next_line(&mut self) -> &'source str {
        self.scan_while(|c| !['\n', '\0'].contains(&c))
    }

    fn next_signed(&mut self) -> Option<i64> {
        let startpos = self.ci;
        if ['+', '-'].contains(&self.c) {
            self.scan_char();
        }
        self.scan_while(|c| c.is_ascii_digit());
        self.input[startpos..self.ci].parse().ok()
    }

    fn next_unsigned(&mut self) -> Option<u64> {
        self.scan_while(|c| c.is_ascii_digit()).parse().ok()
    }

    fn next_double(&mut self) -> Option<f64> {
        let startpos = self.ci;
        if ['+', '-'].contains(&self.c) {
            self.scan_char();
        }
        while self.c.is_ascii_digit() {
            self.scan_char();
        }
        if self.c == '.' {
            self.scan_char();
            while self.c.is_ascii_digit() {
                self.scan_char();
            }
        }
        if ['e', 'E'].contains(&self.c) {
            self.scan_char();
            if ['+', '-'].contains(&self.c) {
                self.scan_char();
            }
            while self.c.is_ascii_digit() {
                self.scan_char();
            }
        }
        self.input[startpos..self.ci].parse().ok()
    }

    fn next_keyword(&mut self) -> Option<&'source str> {
        let identifier = self.scan_while(|c| c.is_ascii_uppercase() || c == '_');
        if identifier.is_empty() {
            None
        } else {
            Some(identifier)
        }
    }

    fn next_dbc_identifier(&mut self) -> Option<&'source str> {
        if !self.c.is_ascii_alphabetic() && self.c != '_' {
            None
        } else {
            let identifier = self.scan_while(|c| c.is_ascii_alphanumeric() || c == '_');
            if identifier.is_empty() {
                None
            } else {
                Some(identifier)
            }
        }
    }

    fn next_string(&mut self) -> Result<Option<&'source str>, ParseError> {
        if self.c != '"' {
            Ok(None)
        } else {
            self.scan_char();
            let start = self.ci;
            while self.c != '"' && self.c != '\x00' {
                self.scan_char();
                if self.c == '\\' {
                    self.scan_char();
                    self.scan_char(); // consume the escaped character, we do not expand these here
                }
            }
            if self.c != '"' {
                Err(self.parse_error("expected \"".to_string()))
            } else {
                let end = self.ci;
                self.scan_char();
                Ok(Some(&self.input[start..end]))
            }
        }
    }

    fn next_char(&mut self, value: char) -> bool {
        if self.c != value {
            false
        } else {
            self.scan_char();
            true
        }
    }

    fn next_chars(&mut self, value: impl IntoIterator<Item = char> + Copy) -> bool {
        for char in value {
            if self.next_char(char) {
                return true;
            }
        }
        false
    }

    fn next_spaces(&mut self) -> &'source str {
        self.scan_while(|c| [' ', '\t'].contains(&c))
    }

    fn expect_newline(&mut self) -> Result<(), ParseError> {
        self.next_spaces();
        if self.next_chars(['\n', '\0']) || (self.next_char('\r') && self.next_chars(['\n', '\0']))
        {
            Ok(())
        } else if self.next_char('/') && self.expect_char('/').is_ok() {
            // Deviation from spec, allow comments at the end of the line
            self.next_line();
            self.expect_chars(['\n', '\0'])?;
            Ok(())
        } else {
            Err(self.parse_error("expected newline".to_string()))
        }
    }

    fn expect_char(&mut self, value: char) -> Result<(), ParseError> {
        if self.next_char(value) {
            Ok(())
        } else {
            Err(self.parse_error(format!("expected {}", value)))
        }
    }

    fn expect_chars(
        &mut self,
        value: impl IntoIterator<Item = char> + Copy,
    ) -> Result<char, ParseError> {
        for char in value {
            if self.next_char(char) {
                return Ok(char);
            }
        }
        Err(self.parse_error(format!(
            "expected [{}]",
            value.into_iter().collect::<String>()
        )))
    }

    fn expect_spaces(&mut self) -> Result<(), ParseError> {
        if self.next_spaces().is_empty() {
            Err(self.parse_error("expected ' '".to_string()))
        } else {
            Ok(())
        }
    }

    fn expect_keyword(&mut self) -> Result<&'source str, ParseError> {
        self.next_keyword()
            .ok_or_else(|| self.parse_error("expected keyword".to_string()))
    }

    fn expect_string(&mut self) -> Result<&'source str, ParseError> {
        self.next_string()?
            .ok_or_else(|| self.parse_error("expected quoted string".to_string()))
    }

    fn expect_signed(&mut self) -> Result<i64, ParseError> {
        self.next_double()
            .map(|v| v.round() as i64)
            .ok_or_else(|| self.parse_error("expected signed".to_string()))
    }

    fn expect_unsigned(&mut self) -> Result<u64, ParseError> {
        self.next_double()
            .map(|v| v.round() as u64)
            .ok_or_else(|| self.parse_error("expected unsigned".to_string()))
    }

    fn expect_double(&mut self) -> Result<f64, ParseError> {
        self.next_double()
            .ok_or_else(|| self.parse_error("expected double".to_string()))
    }

    fn expect_dbc_identifier(&mut self) -> Result<&'source str, ParseError> {
        self.next_dbc_identifier()
            .ok_or_else(|| self.parse_error("expected dbc indentifier".to_string()))
    }

    fn expect_attribute_value(&mut self) -> Result<AttributeValue, ParseError> {
        Ok(match self.next_double() {
            Some(v) => AttributeValue::Float(v),
            None => AttributeValue::String(self.expect_string().map_err(|_| {
                self.parse_error("expected unsigned | signed | double | quoted string".to_string())
            })?),
        })
    }

    fn is_eof(&self) -> bool {
        self.c == '\x00'
    }

    fn parse_error(&self, arg: String) -> ParseError {
        ParseError::new(self.input, self.ci, arg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_example() {
        let dbc = Dbc::open("test/dbc/spec.dbc").unwrap();
        dbc.save("test/dbc/spec_out.dbc").unwrap();
    }

    #[test]
    fn test_cantools() {
        let paths = fs::read_dir("test/dbc/cantools").unwrap();

        for path in paths {
            let path = path.unwrap().path();
            if path.extension().and_then(|x| x.to_str()) == Some("dbc") {
                println!("Processing {}", path.display(),);
                let result = Dbc::open(&path);
                if let Err(err) = result {
                    println!(
                        "Failed decoding at {}:{}:{}",
                        path.display(),
                        err.line,
                        err.column
                    );
                    println!("{}", err);
                    panic!("Failed decoding, see stdout for details");
                }
            }
        }
    }
}
enum AttributeValueType<'a> {
    Integer(i64, i64),
    Hex(i64, i64),
    Float(f64, f64),
    String,
    Enum(Vec<&'a str>),
}

enum AttributeValue<'a> {
    Float(f64),
    String(&'a str),
}

impl Dbc {
    const EMPTY_ECU: &str = "Vector__XXX";

    pub fn open(path: impl AsRef<Path>) -> Result<Self, ParseError> {
        let bytes = fs::read(path).map_err(|e| ParseError {
            line: 0,
            position: 0,
            column: 0,
            error_line: "".to_string(),
            message: e.to_string(),
        })?;
        let contents = String::from_utf8_lossy(&bytes);
        Self::parse(&contents)
    }

    pub fn parse(contents: &str) -> Result<Self, ParseError> {
        let mut parser = Lexer::new(contents);

        let mut _version = "";
        let mut new_symbols = Vec::new();
        let mut messages_dbc = Vec::<MessageNative>::new();
        let mut multiplexed_signals_extended =
            HashMap::<MessageId, HashMap<&str, HashMap<u64, Vec<&str>>>>::new();
        let mut multiplexed_signals_inline =
            HashMap::<MessageId, HashMap<&str, HashMap<u64, Vec<&str>>>>::new();
        let mut signals_db = HashMap::<MessageId, HashMap<&str, SignalNative>>::new();
        let mut signal_value_descriptions =
            HashMap::<MessageId, HashMap<&str, ValueDescriptions>>::new();
        while !parser.is_eof() {
            match parser.next_keyword() {
                Some("VERSION") => {
                    parser.expect_spaces()?;
                    _version = parser.expect_string()?;
                    parser.expect_newline()?;
                }
                Some("BS_") => {
                    // Bit timing - obsolete should not be used anymore
                    parser.next_spaces();
                    parser.expect_char(':')?;
                    parser.next_spaces();
                    parser.expect_newline()?;
                }
                Some("BU_") => {
                    // Node definitions
                    parser.next_spaces();
                    parser.expect_char(':')?;
                    parser.next_spaces();
                    while parser.next_dbc_identifier().is_some() {
                        parser.next_spaces();
                    }
                    parser.expect_newline()?;
                }
                Some("VAL_TABLE_") => {
                    parser.expect_spaces()?;
                    let _value_table_name = parser.expect_dbc_identifier();
                    parser.next_spaces();
                    let mut _value_descriptions = ValueDescriptions::new();
                    while !parser.next_char(';') {
                        let key = parser.expect_signed()?; // deviation from the spec - accept signed numbers
                        parser.expect_spaces()?;
                        let value = parser.expect_string()?;
                        parser.next_spaces();
                        _value_descriptions.insert(key, value);
                    }
                    parser.expect_newline()?;
                }
                Some("NS_") => {
                    parser.next_spaces();
                    parser.expect_char(':')?;
                    parser.next_spaces();
                    parser.expect_newline()?;
                    while !parser.next_spaces().is_empty() {
                        while let Some(keyword) = parser.next_keyword() {
                            new_symbols.push(keyword);
                        }
                        parser.expect_newline()?;
                    }
                }
                Some("CM_") => {
                    parser.expect_spaces()?;
                    match parser.next_keyword() {
                        None => {
                            let _comment = parser.expect_string()?;
                        }
                        Some("BU_") => {
                            parser.expect_spaces()?;
                            let _node_name = parser.expect_dbc_identifier()?;
                            parser.expect_spaces()?;
                            let _comment = parser.expect_string()?;
                        }
                        Some("BO_") => {
                            parser.expect_spaces()?;
                            let _message_id = parser.expect_unsigned()? as MessageId;
                            parser.expect_spaces()?;
                            let _comment = parser.expect_string()?;
                        }
                        Some("SG_") => {
                            parser.expect_spaces()?;
                            let _message_id = parser.expect_unsigned()? as MessageId;
                            parser.expect_spaces()?;
                            let _name = parser.expect_dbc_identifier()?;
                            parser.expect_spaces()?;
                            let _comment = parser.expect_string()?;
                        }
                        Some("EV_") => {
                            parser.expect_spaces()?;
                            let _node_name = parser.expect_dbc_identifier()?;
                            parser.expect_spaces()?;
                            let _comment = parser.expect_string()?;
                        }
                        Some(other) => {
                            Err(parser.parse_error(format!("unknown comment type '{}'", other)))?;
                        }
                    }
                    parser.next_spaces();
                    parser.expect_char(';')?;
                    parser.expect_newline()?;
                }
                Some("BO_") => {
                    parser.expect_spaces()?;
                    let message_id = parser.expect_unsigned()? as MessageId;
                    parser.expect_spaces()?;
                    let name = parser.expect_dbc_identifier()?;
                    parser.next_spaces();
                    parser.expect_char(':')?;
                    parser.next_spaces();
                    let len = parser.expect_unsigned()? as u32;
                    parser.expect_spaces()?;
                    let transmitter = match parser.expect_dbc_identifier()? {
                        Dbc::EMPTY_ECU => None,
                        x => Some(x),
                    };
                    parser.next_spaces();
                    parser.expect_newline()?;
                    messages_dbc.push(MessageNative {
                        id: message_id,
                        name,
                        len,
                        transmitter,
                    });
                    let inline_mux = multiplexed_signals_inline.entry(message_id).or_default();
                    let message_signals = signals_db.entry(message_id).or_default();
                    while !parser.next_spaces().is_empty() {
                        match parser.next_keyword() {
                            Some("SG_") => (), // This is the expected keyword
                            Some(_) => Err(parser.parse_error("expected SG_".to_string()))?,
                            None => break, // There is no keyword, it's probably just indented nothing
                        }
                        parser.expect_spaces()?;
                        let name = parser.expect_dbc_identifier()?;
                        parser.expect_spaces()?;
                        let multiplexer_indicator = if parser.next_char('m') {
                            let indiciator = MultiplexerIndicator {
                                mux_index: Some(parser.expect_unsigned()?),
                                is_multiplexer: parser.next_char('M'),
                            };
                            parser.next_spaces();
                            indiciator
                        } else if parser.next_char('M') {
                            let indiciator = MultiplexerIndicator {
                                mux_index: None,
                                is_multiplexer: true,
                            };
                            parser.next_spaces();
                            indiciator
                        } else {
                            MultiplexerIndicator {
                                mux_index: None,
                                is_multiplexer: false,
                            }
                        };
                        parser.expect_char(':')?;
                        parser.next_spaces();
                        let start_bit = parser.expect_unsigned()? as u32;
                        parser.next_spaces();
                        parser.expect_char('|')?;
                        parser.next_spaces();
                        let signal_size = parser.expect_unsigned()? as u32;
                        parser.next_spaces();
                        parser.expect_char('@')?;
                        parser.next_spaces();
                        let byte_order = match parser.expect_chars(['0', '1'])? {
                            '0' => ByteOrder::BigEndian,
                            '1' => ByteOrder::LittleEndian,
                            _ => unreachable!(),
                        };
                        parser.next_spaces();
                        let value_type = match parser.expect_chars(['+', '-'])? {
                            '+' => ValueType::Unsigned,
                            '-' => ValueType::Signed,
                            _ => unreachable!(),
                        };
                        parser.next_spaces();
                        parser.expect_char('(')?;
                        parser.next_spaces();
                        let factor = parser.expect_double()?;
                        parser.next_spaces();
                        parser.expect_char(',')?;
                        parser.next_spaces();
                        let offset = parser.expect_double()?;
                        parser.next_spaces();
                        parser.expect_char(')')?;
                        parser.next_spaces();
                        parser.expect_char('[')?;
                        parser.next_spaces();
                        let minimum = parser.expect_double()?;
                        parser.next_spaces();
                        parser.expect_char('|')?;
                        parser.next_spaces();
                        let maximum = parser.expect_double()?;
                        parser.next_spaces();
                        parser.expect_char(']')?;
                        parser.next_spaces();
                        let unit = parser.expect_string()?;
                        parser.expect_spaces()?;
                        let mut receiver = Vec::new();
                        match parser.expect_dbc_identifier()? {
                            Dbc::EMPTY_ECU => (),
                            x => receiver.push(x),
                        };
                        while parser.next_char(',') {
                            parser.next_spaces();
                            match parser.expect_dbc_identifier()? {
                                Dbc::EMPTY_ECU => (),
                                x => receiver.push(x),
                            };
                        }
                        let signal = SignalNative {
                            name,
                            multiplexer_indicator,
                            start_bit,
                            signal_size,
                            byte_order,
                            value_type,
                            factor,
                            offset,
                            minimum,
                            maximum,
                            unit,
                            receiver,
                        };
                        message_signals.insert(signal.name, signal);
                        parser.expect_newline()?;
                    }

                    let mut mux_signals_iter = message_signals
                        .values()
                        .filter(|x| x.multiplexer_indicator.is_multiplexer);
                    if let Some(mux_signal) = mux_signals_iter.next() {
                        if mux_signals_iter.next().is_none() {
                            for signal in message_signals.values() {
                                if let Some(index) = signal.multiplexer_indicator.mux_index {
                                    inline_mux
                                        .entry(mux_signal.name)
                                        .or_default()
                                        .entry(index)
                                        .or_default()
                                        .push(signal.name);
                                }
                            }
                        }
                    }
                }
                Some("BO_TX_BU_") => {
                    parser.expect_spaces()?;
                    let _message_id = parser.expect_unsigned()? as MessageId;
                    parser.next_spaces();
                    parser.expect_char(':')?;
                    parser.next_spaces();
                    let mut _transmitters = Vec::new();
                    _transmitters.push(parser.expect_dbc_identifier()?);
                    while parser.next_char(',') {
                        parser.next_spaces();
                        _transmitters.push(parser.expect_dbc_identifier()?);
                    }
                    parser.expect_char(';')?;
                    parser.expect_newline()?;
                }
                Some("VAL_") => {
                    parser.expect_spaces()?;
                    // TODO: Support env VAL_
                    let message_id = parser.expect_unsigned()? as MessageId;
                    parser.expect_spaces()?;
                    let signal_name = parser.expect_dbc_identifier()?;
                    parser.next_spaces();
                    let mut value_descriptions = ValueDescriptions::new();
                    while !parser.next_char(';') {
                        let key = parser.expect_signed()?; // deviation from the spec - accept signed numbers
                        parser.expect_spaces()?;
                        let value = parser.expect_string()?;
                        parser.next_spaces();
                        value_descriptions.insert(key, value);
                    }
                    signal_value_descriptions
                        .entry(message_id)
                        .or_default()
                        .insert(signal_name, value_descriptions);
                    parser.expect_newline()?;
                }
                Some("BA_DEF_") => {
                    // Attribute definition
                    parser.expect_spaces()?;
                    let (_object_type, _attribute_name) = match parser.next_string()? {
                        None => (
                            Some((parser.expect_dbc_identifier()?, parser.expect_spaces()?).0),
                            parser.expect_string()?,
                        ),
                        Some(value) => (None, value),
                    };
                    parser.expect_spaces()?;
                    let _attribute_value =
                        match (parser.expect_dbc_identifier()?, parser.next_spaces()).0 {
                            "INT" => AttributeValueType::Integer(
                                (parser.expect_signed()?, parser.expect_spaces()?).0,
                                parser.expect_signed()?,
                            ),
                            "HEX" => AttributeValueType::Hex(
                                (parser.expect_signed()?, parser.expect_spaces()?).0,
                                parser.expect_signed()?,
                            ),
                            "FLOAT" => AttributeValueType::Float(
                                (parser.expect_double()?, parser.expect_spaces()?).0,
                                parser.expect_double()?,
                            ),
                            "STRING" => AttributeValueType::String,
                            "ENUM" => {
                                let mut values = Vec::new();
                                values.push(parser.expect_string()?);
                                while parser.next_char(',') {
                                    parser.next_spaces();
                                    values.push(parser.expect_string()?);
                                }
                                AttributeValueType::Enum(values)
                            }
                            _ => Err(parser
                                .parse_error("Expected INT|HEX|FLOAT|STRING|ENUM".to_string()))?,
                        };
                    parser.next_spaces();
                    parser.expect_char(';')?;
                    parser.expect_newline()?;
                }
                Some("BA_DEF_DEF_") => {
                    // Attribute default
                    parser.expect_spaces()?;
                    let _attribute_name = parser.expect_string()?;
                    parser.expect_spaces()?;
                    let _value = parser.expect_attribute_value()?;
                    parser.next_spaces();
                    parser.expect_char(';')?;
                    parser.expect_newline()?;
                }
                Some("BA_") => {
                    // Attribute value
                    parser.expect_spaces()?;
                    let _attribute_name = parser.expect_string()?;
                    parser.expect_spaces()?;
                    match parser.next_dbc_identifier() {
                        Some("BU_") => {
                            parser.expect_spaces()?;
                            let _node_name = parser.expect_dbc_identifier()?;
                            parser.expect_spaces()?;
                        }
                        Some("BO_") => {
                            parser.expect_spaces()?;
                            let _message_id = parser.expect_unsigned()?;
                            parser.expect_spaces()?;
                        }
                        Some("SG_") => {
                            parser.expect_spaces()?;
                            let _message_id = parser.expect_unsigned()?;
                            parser.expect_spaces()?;
                            let _signal_name = parser.expect_dbc_identifier()?;
                            parser.expect_spaces()?;
                        }
                        Some("EV_") => {
                            parser.expect_spaces()?;
                            let _env_var = parser.expect_dbc_identifier()?;
                            parser.expect_spaces()?;
                        }
                        Some(&_) => {
                            Err(parser
                                .parse_error("Expected BU_|HEX|FLOAT|STRING|ENUM".to_string()))?
                        }
                        None => (),
                    }
                    let _value = parser.expect_attribute_value()?;
                    parser.next_spaces();
                    parser.expect_char(';')?;
                    parser.expect_newline()?;
                }
                Some("SG_MUL_VAL_") => {
                    parser.expect_spaces()?;
                    let message_id = parser.expect_unsigned()? as MessageId;
                    parser.expect_spaces()?;
                    let multiplexed_signal_name = parser.expect_dbc_identifier()?;
                    parser.expect_spaces()?;
                    let multiplexor_switch_name = parser.expect_dbc_identifier()?;
                    let mux_signals_for_switch = multiplexed_signals_extended
                        .entry(message_id)
                        .or_default()
                        .entry(multiplexor_switch_name)
                        .or_default();
                    if !parser.next_char(';') {
                        loop {
                            parser.expect_spaces()?;
                            let start = parser.expect_unsigned()?;
                            parser.expect_char('-')?;
                            let end = parser.expect_unsigned()?;
                            for i in start..=end {
                                mux_signals_for_switch
                                    .entry(i)
                                    .or_default()
                                    .push(multiplexed_signal_name);
                            }
                            match parser.expect_chars([';', ','])? {
                                ';' => break,
                                ',' => (),
                                _ => unreachable!(),
                            }
                        }
                    }
                    parser.expect_newline()?;
                }
                Some(_other) => {
                    //println!("WARN: Unknown tag {}", other);
                    parser.next_line();
                }
                None => {
                    if parser.next_spaces().is_empty() {
                        parser.expect_newline()?;
                    } else {
                        // For now, consume unknown indented symbols
                        parser.next_line();
                    }
                }
            }
        }
        // Use the extended multiplexed signals if they are specified, otherwise use the inline multiplex signals
        let multiplexed_signals = if !multiplexed_signals_extended.is_empty() {
            multiplexed_signals_extended
        } else {
            multiplexed_signals_inline
        };

        fn build_multiplexed_signals(
            raw: &SignalNative,
            multiplexed_signals: Option<&HashMap<&str, HashMap<u64, Vec<&str>>>>,
            signals_db: &HashMap<&str, SignalNative>,
            values_db: Option<&HashMap<&str, ValueDescriptions>>,
        ) -> Signal {
            let mut signal = Signal::from((raw, values_db.and_then(|x| x.get(raw.name))));
            if let Some(multiplexed_signals_impl) = multiplexed_signals {
                signal.multiplexed = multiplexed_signals_impl
                    .get(raw.name)
                    .map(|muxes| {
                        muxes
                            .iter()
                            .map(|mux| {
                                let mut children = mux
                                    .1
                                    .iter()
                                    .map(|multiplexed_signal_name| {
                                        signals_db
                                            .get(multiplexed_signal_name)
                                            .map(|signal| {
                                                build_multiplexed_signals(
                                                    signal,
                                                    multiplexed_signals,
                                                    signals_db,
                                                    values_db,
                                                )
                                            })
                                            .unwrap()
                                    })
                                    .collect::<Vec<Signal>>();
                                children.sort_unstable_by(|a, b| {
                                    a.start_bit.partial_cmp(&b.start_bit).unwrap()
                                });
                                (*mux.0, children)
                            })
                            .collect()
                    })
                    .unwrap_or_default();
            }
            signal
        }

        Ok(Self {
            messages: messages_dbc
                .iter()
                .map(|message| {
                    let message_signals_db = signals_db.get(&message.id).unwrap();
                    let message_values_db = signal_value_descriptions.get(&message.id);
                    let multiplexed_signals = multiplexed_signals.get(&message.id);
                    Message {
                        id: message.id,
                        name: message.name.to_string(),
                        len: message.len,
                        transmitter: message.transmitter.map(|s| s.to_string()),
                        signals: message_signals_db
                            .values()
                            .filter(|x| x.multiplexer_indicator.mux_index.is_none())
                            .map(|x| {
                                build_multiplexed_signals(
                                    x,
                                    multiplexed_signals,
                                    message_signals_db,
                                    message_values_db,
                                )
                            })
                            .collect::<Vec<_>>(),
                    }
                })
                .collect(),
        })
    }

    fn save(&self, path: impl AsRef<Path>) -> io::Result<()> {
        let file = File::create(&path)?;
        let mut writer = BufWriter::new(file);
        write!(writer, "VERSION \"\"\n\n")?;
        writeln!(writer, "NS_ :")?;
        for symbol in [
            "NS_DESC_",
            "CM_",
            "BA_DEF_",
            "BA_",
            "VAL_",
            "CAT_DEF_",
            "CAT_",
            "FILTER",
            "BA_DEF_DEF_",
            "EV_DATA_",
            "ENVVAR_DATA_",
            "SGTYPE_",
            "SGTYPE_VAL_",
            "BA_DEF_SGTYPE_",
            "BA_SGTYPE_",
            "SIG_TYPE_REF_",
            "VAL_TABLE_",
            "SIG_GROUP_",
            "SIG_VALTYPE_",
            "SIGTYPE_VALTYPE_",
            "BO_TX_BU_",
            "BA_DEF_REL_",
            "BA_REL_",
            "BA_DEF_DEF_REL_",
            "BU_SG_REL_",
            "BU_EV_REL_",
            "BU_BO_REL_",
            "SG_MUL_VAL_",
        ] {
            writeln!(writer, "    {}", symbol)?;
        }
        writeln!(writer)?;
        writeln!(writer, "BS_:")?;
        writeln!(writer)?;

        write!(writer, "BU_:")?;
        // TODO: Nest
        let mut nodes = HashSet::<String>::new();
        for message in self.messages.iter() {
            nodes.extend(message.transmitter.iter().cloned());
            fn add_multiplexed_receivers(signal: &Signal, nodes: &mut HashSet<String>) {
                nodes.extend(signal.receiver.iter().cloned());
                for multiplexed_signals in signal.multiplexed.values() {
                    for multiplexed_signal in multiplexed_signals {
                        add_multiplexed_receivers(multiplexed_signal, nodes);
                    }
                }
            }
            for signal in message.signals.iter() {
                add_multiplexed_receivers(signal, &mut nodes);
            }
        }
        for node in nodes {
            write!(writer, " {}", node)?;
        }
        writeln!(writer)?;

        writeln!(writer)?;

        fn write_recurse(
            signal: &Signal,
            writer: &mut BufWriter<File>,
            mux: Option<u64>,
        ) -> io::Result<()> {
            write!(writer, " SG_ {} ", signal.name)?;
            if let Some(mux) = mux {
                write!(writer, "m{}", mux)?;
                if !signal.multiplexed.is_empty() {
                    write!(writer, "M")?;
                }
                write!(writer, " ")?;
            } else if !signal.multiplexed.is_empty() {
                write!(writer, "M ")?;
            }
            write!(
                writer,
                ": {}|{}@{}{} ({},{}) [{}|{}] \"{}\"",
                signal.start_bit,
                signal.signal_size,
                match signal.byte_order {
                    ByteOrder::BigEndian => 0,
                    ByteOrder::LittleEndian => 1,
                },
                match signal.value_type {
                    ValueType::Unsigned => "+",
                    ValueType::Signed => "-",
                },
                signal.factor,
                signal.offset,
                signal.minimum,
                signal.maximum,
                signal.unit
            )?;
            let mut receiver_iter = signal.receiver.iter();
            match receiver_iter.next() {
                Some(receiver) => {
                    write!(writer, " {}", receiver)?;
                    for receiver in receiver_iter {
                        write!(writer, ", {}", receiver)?;
                    }
                }
                None => write!(writer, " {}", Dbc::EMPTY_ECU)?,
            }
            writeln!(writer)?;
            let mut keys = signal.multiplexed.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            for key in keys {
                for child in signal.multiplexed.get(key).unwrap() {
                    write_recurse(child, writer, Some(*key))?;
                }
            }
            Ok(())
        }

        for message in &self.messages {
            writeln!(
                writer,
                "BO_ {} {}: {} {}",
                message.id,
                message.name,
                message.len,
                match message.transmitter {
                    Some(ref transmitter) => transmitter,
                    None => Dbc::EMPTY_ECU,
                }
            )?;
            for (mux, signal) in message.iter_signals() {
                write!(writer, " SG_ {} ", signal.name)?;
                if let Some(mux_index) = mux.mux_index {
                    write!(writer, "m{}", mux_index)?;
                    if mux.is_multiplexer {
                        write!(writer, "M")?;
                    }
                    write!(writer, " ")?;
                } else if mux.is_multiplexer {
                    write!(writer, "M ")?;
                }
                write!(
                    writer,
                    ": {}|{}@{}{} ({},{}) [{}|{}] \"{}\"",
                    signal.start_bit,
                    signal.signal_size,
                    match signal.byte_order {
                        ByteOrder::BigEndian => 0,
                        ByteOrder::LittleEndian => 1,
                    },
                    match signal.value_type {
                        ValueType::Unsigned => "+",
                        ValueType::Signed => "-",
                    },
                    signal.factor,
                    signal.offset,
                    signal.minimum,
                    signal.maximum,
                    signal.unit
                )?;
                let mut receiver_iter = signal.receiver.iter();
                match receiver_iter.next() {
                    Some(receiver) => {
                        write!(writer, " {}", receiver)?;
                        for receiver in receiver_iter {
                            write!(writer, ", {}", receiver)?;
                        }
                    }
                    None => write!(writer, " {}", Dbc::EMPTY_ECU)?,
                }
                writeln!(writer)?;
            }
            writeln!(writer)?;
        }
        for message in &self.messages {
            for (_, signal) in message.iter_signals() {
                let mut value_descriptions = signal.value_descriptions.iter();
                if let Some(first) = value_descriptions.next() {
                    write!(
                        writer,
                        "VAL_ {} {} {} \"{}\"",
                        message.id, signal.name, first.0, first.1
                    )?;
                    for value_description in value_descriptions {
                        write!(
                            writer,
                            " {} \"{}\"",
                            value_description.0, value_description.1
                        )?;
                    }
                    writeln!(writer, " ;")?;
                }
            }
        }
        Ok(())
    }
}

impl<'a> From<(&'a SignalNative<'a>, Option<&ValueDescriptions<'a>>)> for Signal {
    fn from(signal: (&SignalNative<'a>, Option<&ValueDescriptions<'a>>)) -> Self {
        Self {
            name: signal.0.name.to_string(),
            start_bit: signal.0.start_bit,
            signal_size: signal.0.signal_size,
            byte_order: signal.0.byte_order.clone(),
            value_type: signal.0.value_type.clone(),
            factor: signal.0.factor,
            offset: signal.0.offset,
            minimum: signal.0.minimum,
            maximum: signal.0.maximum,
            unit: signal.0.unit.to_string(),
            receiver: signal.0.receiver.iter().map(|x| x.to_string()).collect(),
            value_descriptions: signal
                .1
                .map(|x| {
                    x.iter()
                        .map(|(k, v)| (*k, v.to_string()))
                        .collect::<HashMap<i64, String>>()
                })
                .unwrap_or_default(),
            multiplexed: HashMap::new(),
        }
    }
}
