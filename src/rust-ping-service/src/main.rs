use anyhow::Result;
use chrono::Utc;
use redis::{AsyncCommands, Client};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use surge_ping::{Client as PingClient, Config, PingIdentifier, PingSequence};
use tokio::sync::Mutex;
use tokio::time::{self, interval};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Target {
    id: String,
    address: String,
    prefix: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PingResult {
    ts: i64,
    ms: f64,
}

type PingStats = [f64; 5];

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AggregatedData {
    id: String,
    address: String,
    stats: HashMap<String, PingStats>,
    history: Vec<PingStats>,
}

struct AppState {
    targets: Mutex<Vec<Target>>,
    redis_client: Client,
}

#[tokio::main]
async fn main() -> Result<()> {
    let redis_url = "redis://127.0.0.1/";
    let redis_client = Client::open(redis_url)?;
    let state = Arc::new(AppState {
        targets: Mutex::new(Vec::new()),
        redis_client,
    });

    // Task to sync targets from Redis
    let state_clone = Arc::clone(&state);
    tokio::spawn(async move {
        let mut interval = interval(Duration::from_secs(10));
        loop {
            interval.tick().await;
            if let Err(e) = sync_targets(&state_clone).await {
                eprintln!("Error syncing targets: {}", e);
            }
        }
    });

    // Task to perform pings
    let state_clone = Arc::clone(&state);
    tokio::spawn(async move {
        let mut interval = interval(Duration::from_secs(5));
        let ping_client = Arc::new(PingClient::new(&Config::default()).unwrap());
        let mut sequence = 0u16;
        loop {
            interval.tick().await;
            let targets = state_clone.targets.lock().await.clone();
            for target in targets {
                let state_inner = Arc::clone(&state_clone);
                let ping_client_inner = Arc::clone(&ping_client);
                sequence = sequence.wrapping_add(1);
                let seq = sequence;
                tokio::spawn(async move {
                    if let Err(e) = ping_target(&state_inner, &ping_client_inner, target, seq).await {
                        eprintln!("Error pinging target: {}", e);
                    }
                });
            }
        }
    });

    // Task to aggregate data
    let state_clone = Arc::clone(&state);
    tokio::spawn(async move {
        // Wait 5s initially
        time::sleep(Duration::from_secs(5)).await;
        let mut interval = interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            if let Err(e) = aggregate_all(&state_clone).await {
                eprintln!("Error aggregating data: {}", e);
            }
        }
    });

    // Keep main alive
    loop {
        time::sleep(Duration::from_secs(3600)).await;
    }
}

async fn sync_targets(state: &AppState) -> Result<()> {
    let mut conn = state.redis_client.get_async_connection().await?;
    let keys: Vec<String> = conn.keys("monitor:targets:*").await?;
    let mut new_targets = Vec::new();

    for key in keys {
        let targets_json: Vec<String> = conn.lrange(key, 0, -1).await?;
        for json in targets_json {
            if let Ok(target) = serde_json::from_str::<Target>(&json) {
                new_targets.push(target);
            }
        }
    }

    let mut targets = state.targets.lock().await;
    *targets = new_targets;
    Ok(())
}

async fn ping_target(state: &AppState, client: &Arc<PingClient>, target: Target, seq: u16) -> Result<()> {
    let payload = [0u8; 32];
    
    let addr = if let Ok(ip) = target.address.parse() {
        ip
    } else {
        match tokio::net::lookup_host(format!("{}:0", target.address)).await?.next() {
            Some(a) => a.ip(),
            None => return Err(anyhow::anyhow!("Could not resolve {}", target.address)),
        }
    };

    let mut pinger = client.pinger(addr, PingIdentifier(0)).await;
    pinger.timeout(Duration::from_secs(5));
    
    let ts = Utc::now().timestamp_millis();
    let ms = match pinger.ping(PingSequence(seq), &payload).await {
        Ok((_, duration)) => {
            let rtt = duration.as_secs_f64() * 1000.0;
            println!("[{}] Ping {} ({}): {:.2}ms", Utc::now().format("%Y-%m-%d %H:%M:%S"), target.id, target.address, rtt);
            rtt
        }
        Err(e) => {
            println!("[{}] Ping {} ({}) failed: {}", Utc::now().format("%Y-%m-%d %H:%M:%S"), target.id, target.address, e);
            5000.0
        }
    };
    
    let ms = if ms > 5000.0 { 5000.0 } else { ms };

    let mut conn = state.redis_client.get_async_connection().await?;
    let stream_key = format!("{}:stream:{}", target.prefix, target.id);
    let _: () = conn.xadd(&stream_key, "*", &[("ts", ts.to_string()), ("ms", ms.to_string())]).await?;
    
    // Retention: MAXLEN 17280 (86400 / 5)
    let _: () = redis::cmd("XTRIM").arg(&stream_key).arg("MAXLEN").arg("17280").query_async(&mut conn).await?;

    Ok(())
}

async fn aggregate_all(state: &AppState) -> Result<()> {
    let targets = state.targets.lock().await.clone();
    let mut conn = state.redis_client.get_async_connection().await?;
    let now = Utc::now().timestamp_millis();

    let timeframes = [
        ("1m", 60 * 1000),
        ("5m", 5 * 60 * 1000),
        ("15m", 15 * 60 * 1000),
        ("1h", 3600 * 1000),
        ("3h", 3 * 3600 * 1000),
        ("12h", 12 * 3600 * 1000),
        ("24h", 24 * 3600 * 1000),
    ];

    for target in targets {
        let stream_key = format!("{}:stream:{}", target.prefix, target.id);
        let start_range = now - (24 * 3600 * 1000);
        
        let raw_data: redis::streams::StreamRangeReply = conn.xrange(&stream_key, start_range, "+").await?;
        
        let mut points = Vec::new();
        for entry in raw_data.ids {
            let mut ts = 0i64;
            let mut ms = 5000.0f64;
            for (key, value) in entry.map.iter() {
                if let redis::Value::Data(data) = value {
                    let s = std::str::from_utf8(data)?;
                    if key == "ts" { ts = s.parse().unwrap_or(0); }
                    if key == "ms" { ms = s.parse().unwrap_or(5000.0); }
                }
            }
            points.push(PingResult { ts, ms });
        }

        let mut stats_map = HashMap::new();
        for (label, duration) in &timeframes {
            let cutoff = now - duration;
            let relevant: Vec<&PingResult> = points.iter().filter(|p| p.ts >= cutoff).collect();
            stats_map.insert(label.to_string(), calculate_metrics(&relevant));
        }

        let mut history = Vec::new();
        for i in 0..30 {
            let bucket_end = now - (i * 60 * 1000);
            let bucket_start = now - ((i + 1) * 60 * 1000);
            let bucket_points: Vec<&PingResult> = points.iter().filter(|p| p.ts >= bucket_start && p.ts < bucket_end).collect();
            history.push(calculate_metrics(&bucket_points));
        }
        history.reverse();

        let aggregated = AggregatedData {
            id: target.id.clone(),
            address: target.address.clone(),
            stats: stats_map,
            history,
        };

        let json = serde_json::to_string(&aggregated)?;
        let cache_key = format!("{}:cache:{}", target.prefix, target.id);
        let _: () = conn.set(cache_key, json).await?;
    }

    Ok(())
}

fn calculate_metrics(points: &[&PingResult]) -> PingStats {
    if points.is_empty() {
        return [0.0, 0.0, 0.0, 0.0, 0.0];
    }

    let mut success_count = 0;
    let mut total_ms = 0.0;
    let mut min = 5000.0;
    let mut max = 0.0;
    let mut jitter_sum = 0.0;
    let mut prev_ms: Option<f64> = None;
    let mut jitter_count = 0;

    for p in points {
        if p.ms >= 5000.0 {
            continue;
        }

        success_count += 1;
        total_ms += p.ms;
        if p.ms < min { min = p.ms; }
        if p.ms > max { max = p.ms; }

        if let Some(prev) = prev_ms {
            jitter_sum += (p.ms - prev).abs();
            jitter_count += 1;
        }
        prev_ms = Some(p.ms);
    }

    let packet_loss = ((points.len() - success_count) as f64 / points.len() as f64) * 100.0;
    let avg = if success_count > 0 { total_ms / success_count as f64 } else { 0.0 };
    let jitter = if jitter_count > 0 { jitter_sum / jitter_count as f64 } else { 0.0 };

    if success_count == 0 { min = 0.0; }

    [
        (packet_loss * 100.0).round() / 100.0,
        (min * 100.0).round() / 100.0,
        (max * 100.0).round() / 100.0,
        (avg * 100.0).round() / 100.0,
        (jitter * 100.0).round() / 100.0,
    ]
}
