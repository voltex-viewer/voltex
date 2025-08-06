use std::fs;

use criterion::{criterion_group, criterion_main, Criterion};
use mf4lib::Dbc;
use pprof::criterion::{Output, PProfProfiler};

fn criterion_benchmark(c: &mut Criterion) {
    let bytes = fs::read("test/dbc/cantools/vehicle.dbc").unwrap();
    let contents = String::from_utf8_lossy(&bytes).to_string();
    c.bench_function("dbc::open", |b| b.iter(|| Dbc::parse(&contents).unwrap()));
}

criterion_group! {
    name = benches;
    config = Criterion::default().with_profiler(PProfProfiler::new(100, Output::Flamegraph(None)));
    targets = criterion_benchmark
}
criterion_main!(benches);
