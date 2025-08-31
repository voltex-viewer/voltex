use std::env;
use std::process;

use mf4lib;

fn main() {
    let args: Vec<String> = env::args().collect();
    
    if args.len() != 2 {
        eprintln!("Usage: {} <mf4_file>", args[0]);
        process::exit(1);
    }
    
    let file_path = &args[1];
    
    let mut mf4 = match mf4lib::open(file_path) {
        Ok(mf4) => mf4,
        Err(e) => {
            eprintln!("Error opening file '{}': {}", file_path, e);
            process::exit(1);
        }
    };
    
    let channel_groups = match mf4.channels() {
        Ok(channels) => channels,
        Err(e) => {
            eprintln!("Error reading channels: {}", e);
            process::exit(1);
        }
    };
    
    println!("Channel information for: {}", file_path);
    println!("Found {} channel group(s):", channel_groups.len());
    println!();
    
    for (group_idx, group) in channel_groups.iter().enumerate() {
        println!("Channel Group {}: {}", group_idx + 1, 
                 if group.name.is_empty() { "<unnamed>" } else { &group.name });
        println!("  Channels ({}):", group.channels.len());
        
        for channel in &group.channels {
            println!("    - Name: {}", 
                     if channel.name.is_empty() { "<unnamed>" } else { &channel.name });
            println!("      Unit: {}", channel.unit);
            println!("      Conversion: {}", channel.conversion);
        }
        println!();
    }
    
    println!("Total channels across all groups: {}", 
             channel_groups.iter().map(|g| g.channels.len()).sum::<usize>());
}
