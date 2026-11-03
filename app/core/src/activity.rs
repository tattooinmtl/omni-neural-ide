use axum::{extract::State, Json};
use serde::Serialize;
use std::sync::Arc;
use sysinfo::System;

use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityOut {
    pub cpu_pct: f32,
    pub idle_sec: u64,
    pub on_battery: bool,
    pub mem_pct: f32,
}

pub async fn activity(State(_st): State<Arc<AppState>>) -> Json<ActivityOut> {
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    // brief yield so cpu usage can populate on some platforms
    std::thread::sleep(std::time::Duration::from_millis(40));
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    let cpu = sys.global_cpu_usage();
    let total = sys.total_memory().max(1) as f32;
    let used = sys.used_memory() as f32;
    Json(ActivityOut {
        cpu_pct: cpu,
        idle_sec: idle_seconds(),
        on_battery: on_battery(),
        mem_pct: (used / total) * 100.0,
    })
}

#[cfg(windows)]
fn idle_seconds() -> u64 {
    #[repr(C)]
    struct LastInputInfo { cb_size: u32, dw_time: u32 }
    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
        fn GetTickCount() -> u32;
    }
    unsafe {
        let mut ii = LastInputInfo { cb_size: 8, dw_time: 0 };
        if GetLastInputInfo(&mut ii) == 0 { return 0; }
        let now = GetTickCount();
        now.wrapping_sub(ii.dw_time) as u64 / 1000
    }
}

#[cfg(not(windows))]
fn idle_seconds() -> u64 { 0 }

#[cfg(windows)]
fn on_battery() -> bool {
    #[repr(C)]
    struct SystemPowerStatus {
        ac_line_status: u8,
        battery_flag: u8,
        battery_life_percent: u8,
        system_status_flag: u8,
        battery_life_time: u32,
        battery_full_life_time: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetSystemPowerStatus(sps: *mut SystemPowerStatus) -> i32;
    }
    unsafe {
        let mut s = std::mem::zeroed();
        if GetSystemPowerStatus(&mut s) == 0 { return false; }
        s.ac_line_status == 0 // 0 = offline / battery
    }
}

#[cfg(not(windows))]
fn on_battery() -> bool { false }
