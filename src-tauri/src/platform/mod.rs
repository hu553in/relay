#[cfg(target_os = "macos")]
mod macos;

#[cfg(not(target_os = "macos"))]
mod default;

#[cfg(target_os = "macos")]
use macos as platform_impl;

#[cfg(not(target_os = "macos"))]
use default as platform_impl;

pub(crate) use platform_impl::{
    apply_main_window_platform_behavior, apply_overlay_platform_behavior,
    apply_settings_window_platform_behavior, configure_app_policy, sync_dock_visibility,
    system_audio_capability,
};
