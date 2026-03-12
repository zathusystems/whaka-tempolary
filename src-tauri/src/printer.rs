mod receipt_formatter;

#[cfg(not(target_os = "android"))]
#[path = "printer/desktop.rs"]
mod desktop;

#[cfg(target_os = "android")]
#[path = "printer/android.rs"]
mod android;

#[cfg(not(target_os = "android"))]
pub use desktop::*;

#[cfg(target_os = "android")]
pub use android::*;
