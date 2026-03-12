use std::sync::mpsc;
use std::time::Duration;

use jni::objects::{JObject, JString};
use tauri::{command, WebviewWindow};

const ANDROID_BRIDGE_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct PrinterInfo {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub status: String,
    pub is_default: bool,
    pub description: Option<String>,
}

fn jni_error_message(
    env: &mut jni::JNIEnv<'_>,
    context: &str,
    fallback_error: impl ToString,
) -> String {
    if env.exception_check().unwrap_or(false) {
        let throwable = env.exception_occurred().ok();
        let _ = env.exception_clear();
        if let Some(throwable) = throwable {
            let message: Option<String> = env
                .call_method(&throwable, "getMessage", "()Ljava/lang/String;", &[])
                .ok()
                .and_then(|value| value.l().ok())
                .and_then(|obj| {
                    if obj.is_null() {
                        None
                    } else {
                        let jstr = JString::from(obj);
                        env.get_string(&jstr).ok().map(Into::into)
                    }
                });
            let class_name: Option<String> = env
                .call_method(&throwable, "getClass", "()Ljava/lang/Class;", &[])
                .ok()
                .and_then(|value| value.l().ok())
                .and_then(|clazz| {
                    env.call_method(clazz, "getSimpleName", "()Ljava/lang/String;", &[])
                        .ok()
                })
                .and_then(|value| value.l().ok())
                .and_then(|obj| {
                    if obj.is_null() {
                        None
                    } else {
                        let jstr = JString::from(obj);
                        env.get_string(&jstr).ok().map(Into::into)
                    }
                });

            if let Some(message) = message {
                if let Some(class_name) = class_name {
                    return format!("{context}: {class_name}: {message}");
                }
                return format!("{context}: {message}");
            }
        }
    }

    format!("{context}: {}", fallback_error.to_string())
}

fn read_java_string(
    env: &mut jni::JNIEnv<'_>,
    obj: JObject<'_>,
    context: &str,
) -> Result<String, String> {
    if obj.is_null() {
        return Err(format!("{context}: Android returned an empty value"));
    }
    let jstr = JString::from(obj);
    env.get_string(&jstr)
        .map(Into::into)
        .map_err(|error| format!("{context}: {error}"))
}

fn run_with_android_context<T, F>(window: WebviewWindow, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut jni::JNIEnv<'_>, &JObject<'_>, &JObject<'_>) -> Result<T, String>
        + Send
        + 'static,
{
    let (tx, rx) = mpsc::channel();

    window
        .with_webview(move |webview| {
            webview.jni_handle().exec(move |env, activity, webview| {
                let result = operation(env, activity, webview);
                let _ = tx.send(result);
            });
        })
        .map_err(|error| format!("Failed to access Android webview context: {error}"))?;

    rx.recv_timeout(ANDROID_BRIDGE_TIMEOUT)
        .map_err(|_| "Timed out waiting for Android Bluetooth operation".to_string())?
}

#[command]
pub fn get_printers(window: WebviewWindow) -> Result<Vec<PrinterInfo>, String> {
    run_with_android_context(window, |env, activity, _| {
        let result = env
            .call_method(
                activity,
                "getBluetoothPrintersJson",
                "()Ljava/lang/String;",
                &[],
            )
            .map_err(|error| jni_error_message(env, "Failed to query Bluetooth printers", error))?;

        let json = read_java_string(
            env,
            result
                .l()
                .map_err(|error| format!("Invalid discovery response: {error}"))?,
            "Failed to read Bluetooth discovery response",
        )?;

        serde_json::from_str::<Vec<PrinterInfo>>(&json)
            .map_err(|error| format!("Failed to parse Bluetooth printer list: {error}"))
    })
}

#[command]
pub fn print_receipt(
    window: WebviewWindow,
    html: String,
    printer_id: String,
    copies: i32,
    paper_size: Option<String>,
    printer_paper_width: Option<String>,
) -> Result<String, String> {
    run_with_android_context(window, move |env, activity, _| {
        let printer_id_j = env
            .new_string(printer_id)
            .map_err(|error| format!("Failed to prepare printer identifier: {error}"))?;
        let resolved_paper_width = printer_paper_width
            .or(paper_size)
            .unwrap_or_else(|| "80mm".to_string());
        let line_width =
            super::receipt_formatter::resolve_line_width(Some(resolved_paper_width.as_str()));
        let escpos_data = super::receipt_formatter::html_to_escpos(&html, line_width, 0);
        let escpos_payload_j = env
            .byte_array_from_slice(&escpos_data)
            .map_err(|error| format!("Failed to prepare ESC/POS payload: {error}"))?;
        let paper_width_j = env
            .new_string(resolved_paper_width)
            .map_err(|error| format!("Failed to prepare paper width: {error}"))?;

        let result = env
            .call_method(
                activity,
                "printBluetoothReceiptEscPos",
                "(Ljava/lang/String;[BILjava/lang/String;)Ljava/lang/String;",
                &[
                    (&printer_id_j).into(),
                    (&escpos_payload_j).into(),
                    copies.max(1).into(),
                    (&paper_width_j).into(),
                ],
            )
            .map_err(|error| jni_error_message(env, "Failed to print via Bluetooth", error))?;

        read_java_string(
            env,
            result
                .l()
                .map_err(|error| format!("Invalid print response: {error}"))?,
            "Failed to read Bluetooth print response",
        )
    })
}
