use std::time::Duration;

use grpc_api::api::trace_reader_server::{TraceReader, TraceReaderServer};
use grpc_api::api::{Channel, ChannelGroup, ChannelRequest, ChannelResponse, Frame, ReadRequest,
    LoadWaveformFileRequest, LoadWaveformFileResponse};
use tokio::sync::mpsc;
use tokio::time::sleep;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{transport::Server, Request};
use tonic::{Response, Status};
use std::path::Path;

// Decoder trait and implementations
trait WaveformDecoder {
    fn decode(&self, path: &str) -> Result<Vec<grpc_api::api::WaveformChannel>, String>;
}


struct JsonWaveformDecoder;

impl WaveformDecoder for JsonWaveformDecoder {
    fn decode(&self, path: &str) -> Result<Vec<grpc_api::api::WaveformChannel>, String> {
        let file = std::fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
        let json: serde_json::Value = match serde_json::from_reader(file) {
            Ok(j) => j,
            Err(e) => return Err(format!("Failed to parse JSON: {}", e)),
        };
        let mut channels = Vec::new();
        if let Some(arr) = json.get("channels").and_then(|v| v.as_array()) {
            for ch in arr {
                let name = ch.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                let mut points = Vec::new();
                if let Some(data_arr) = ch.get("data").and_then(|v| v.as_array()) {
                    for pt in data_arr {
                        let t = pt.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        let v = pt.get("v").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        points.push(grpc_api::api::WaveformPoint { t, v });
                    }
                }
                channels.push(grpc_api::api::WaveformChannel { name, data: points });
            }
        }
        Ok(channels)
    }
}

struct Mf4WaveformDecoder;

impl WaveformDecoder for Mf4WaveformDecoder {
    fn decode(&self, path: &str) -> Result<Vec<grpc_api::api::WaveformChannel>, String> {
        // Use mf4lib crate to parse MF4 files
        let mut mf4 = match mf4lib::open(&path) {
            Ok(m) => m,
            Err(e) => return Err(format!("Failed to parse MF4: {}", e)),
        };
        let mut channels = Vec::new();
        let decoded_data = mf4.decode_all_data().map_err(|e| format!("Failed to decode MF4 data: {}", e))?;
        for group in decoded_data {
            for channel in &group.channels[1..] {
                let mut points = Vec::new();
                for i in 0..channel.data.len() {
                    points.push(grpc_api::api::WaveformPoint { t: group.channels[0].data.as_f64(i), v: channel.data.as_f64(i) });
                }
                channels.push(grpc_api::api::WaveformChannel { name: channel.name.clone(), data: points });
            }
        }
        Ok(channels)
    }
}


#[derive(Clone)]
pub struct CanApi {
}

#[tonic::async_trait]
impl TraceReader for CanApi {
    type ReadStream = ReceiverStream<Result<Frame, Status>>;

    async fn get_channels(
        &self,
        request: Request<ChannelRequest>,
    ) -> Result<Response<ChannelResponse>, Status> {
        println!("Got a request from {:?}", request.remote_addr());

        let reply = ChannelResponse {
            channel_groups: vec![ChannelGroup {
                channels: vec![
                    Channel {
                        name: "Channel 1".to_string(),
                    },
                    Channel {
                        name: "Timestamp".to_string(),
                    },
                ],
            }],
        };
        Ok(Response::new(reply))
    }

    async fn load_waveform_file(
        &self,
        request: Request<LoadWaveformFileRequest>,
    ) -> Result<Response<LoadWaveformFileResponse>, Status> {
        let path = &request.get_ref().path;
        let mut resp = LoadWaveformFileResponse {
            error: String::new(),
            channels: Vec::new(),
        };
        let ext = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        let decoder: Box<dyn WaveformDecoder> = match ext.as_str() {
            "json" => Box::new(JsonWaveformDecoder),
            "mf4" => Box::new(Mf4WaveformDecoder),
            _ => {
                resp.error = format!("Unsupported file extension: .{}", ext);
                return Ok(Response::new(resp));
            }
        };
        match decoder.decode(path) {
            Ok(channels) => {
                resp.channels = channels;
            },
            Err(e) => {
                resp.error = e;
            }
        }
        Ok(Response::new(resp))
    }

    async fn read(
        &self,
        _: tonic::Request<ReadRequest>,
    ) -> Result<Response<Self::ReadStream>, Status> {
        let (tx, rx) = mpsc::channel(4);

        tokio::spawn(async move {
            loop {
                let frame = Frame {
                    id: 0,
                    data: vec![0x00, 0x02],
                };
                tx.send(Ok(frame)).await.unwrap();
                let frame = Frame {
                    id: 0x300,
                    data: vec![0x01, 0x02, 0x03],
                };
                tx.send(Ok(frame)).await.unwrap();
                sleep(Duration::from_millis(100)).await;
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = "[::1]:50051".parse().unwrap();
    let can_api = CanApi { };
    let greeter = TraceReaderServer::new(can_api);

    Server::builder()
        .accept_http1(true)
        .add_service(tonic_web::enable(greeter))
        .serve(addr)
        .await?;

    Ok(())
}
