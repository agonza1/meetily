#[repr(C)]
#[derive(Clone, Copy, Default, serde::Serialize)]
pub(crate) struct Activity {
    family: i32,
    input: u32,
    output: u32,
}

#[tauri::command]
pub(crate) async fn native_call_activity() -> Result<Vec<Activity>, String> {
    #[cfg(target_os = "macos")]
    {
        extern "C" {
            fn meetily_process_activity(rows: *mut Activity, capacity: u32) -> i32;
        }
        let mut rows = vec![Activity::default(); 512];
        // C writes at most capacity repr(C) rows and retains no references.
        let count = unsafe { meetily_process_activity(rows.as_mut_ptr(), rows.len() as u32) };
        match count {
            -1 => Err("This Mac does not expose audio process metadata.".into()),
            n if n < 0 => Err("Could not read audio process activity.".into()),
            n => {
                rows.truncate(n as usize);
                Ok(rows)
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    Err("Native call detection requires macOS.".into())
}
