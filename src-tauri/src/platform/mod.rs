#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(not(target_os = "macos"))]
pub mod macos {
    pub fn system_audio_supported() -> bool {
        false
    }
}
