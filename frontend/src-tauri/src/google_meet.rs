use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use uuid::Uuid;

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Phase {
    Joined,
    Ended,
    Unknown,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Observation {
    call: Uuid,
    phase: Phase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    response: Option<(Uuid, BrowserAction)>,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum BrowserAction {
    Execute,
    Now,
    Cancel,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct CountdownOffer {
    call: Uuid,
    nonce: Uuid,
    phase: Phase,
}

#[tauri::command]
pub(crate) fn google_meet_probe(enabled: bool) -> Result<Option<Observation>, String> {
    #[cfg(target_os = "macos")]
    return mac::probe(enabled).map_err(|e| e.to_string());
    #[cfg(not(target_os = "macos"))]
    {
        let _ = enabled;
        Ok(None)
    }
}

#[tauri::command]
pub(crate) fn google_meet_countdown(offer: Option<CountdownOffer>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return mac::countdown(offer).map_err(|e| e.to_string());
    #[cfg(not(target_os = "macos"))]
    {
        let _ = offer;
        Ok(())
    }
}

pub(crate) fn confirms(call: Uuid, phase: Phase) -> bool {
    #[cfg(target_os = "macos")]
    return mac::observation()
        .ok()
        .flatten()
        .is_some_and(|o| o.call == call && o.phase == phase);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (call, phase);
        false
    }
}

#[tauri::command]
pub(crate) fn google_meet_attention<R: Runtime>(app: AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if matches!(window.is_focused(), Ok(false)) {
            let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
        }
    }
}

#[cfg(target_os = "macos")]
pub use mac::run_chrome_host;

#[cfg(target_os = "macos")]
mod mac {
    use super::{CountdownOffer, Observation};
    use std::{
        fs::{self, File, OpenOptions},
        io::{self, Read, Write},
        os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
        path::{Path, PathBuf},
        time::Duration,
    };

    const MAX_PACKET: usize = 256;
    const FRESH: Duration = Duration::from_secs(6);

    // Shared rendezvous with Chrome, not an application preference or recording path.
    fn directory() -> io::Result<PathBuf> {
        let path = dirs::cache_dir()
            .ok_or_else(|| io::Error::other("Cannot locate the Chrome bridge cache"))?
            .join("com.meetily.google-meet-v1");
        match fs::DirBuilder::new().mode(0o700).create(&path) {
            Ok(()) => (),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(e),
        }
        let meta = path.symlink_metadata()?;
        if !meta.is_dir() || meta.permissions().mode() & 0o077 != 0 {
            return Err(io::Error::other("Chrome bridge cache is not private"));
        }
        Ok(path)
    }

    fn fresh(path: &Path) -> bool {
        path.symlink_metadata()
            .ok()
            .filter(|meta| meta.is_file() && meta.len() <= MAX_PACKET as u64)
            .and_then(|meta| meta.modified().ok()?.elapsed().ok())
            .is_some_and(|elapsed| elapsed < FRESH)
    }

    pub(super) fn observation() -> io::Result<Option<Observation>> {
        let dir = directory()?;
        let snapshot = dir.join("observation.json");
        if !fresh(&dir.join("enabled")) || !fresh(&snapshot) {
            return Ok(None);
        }
        Ok(serde_json::from_reader(File::open(snapshot)?.take(MAX_PACKET as u64 + 1)).ok())
    }

    fn publish(dir: &Path, name: &str, data: &[u8]) -> io::Result<()> {
        let temp = dir.join(uuid::Uuid::new_v4().to_string());
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)?;
        let result = file
            .write_all(data)
            .and_then(|()| fs::rename(&temp, dir.join(name)));
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    }

    pub(super) fn probe(enabled: bool) -> io::Result<Option<Observation>> {
        let dir = directory()?;
        let lease = dir.join("enabled");
        if enabled {
            if !fresh(&lease) {
                let _ = fs::remove_file(dir.join("observation.json"));
            }
            publish(&dir, "enabled", b"")?;
            observation()
        } else {
            let _ = fs::remove_file(lease);
            let _ = fs::remove_file(dir.join("observation.json"));
            Ok(None)
        }
    }

    pub(super) fn countdown(offer: Option<CountdownOffer>) -> io::Result<()> {
        let dir = directory()?;
        if let Some(offer) = offer {
            publish(&dir, "countdown.json", &serde_json::to_vec(&offer)?)
        } else {
            match fs::remove_file(dir.join("countdown.json")) {
                Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
                result => result,
            }
        }
    }

    fn exchange(mut input: impl Read, mut output: impl Write, dir: &Path) -> io::Result<()> {
        loop {
            let mut size = [0; 4];
            match input.read_exact(&mut size) {
                Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
                result => result?,
            }
            let size = u32::from_ne_bytes(size) as usize;
            if size == 0 || size > MAX_PACKET {
                return Err(io::Error::other("Invalid native message length"));
            }
            let mut packet = [0; MAX_PACKET];
            input.read_exact(&mut packet[..size])?;
            let enabled = fresh(&dir.join("enabled"));
            if enabled {
                if let Ok(o) = serde_json::from_slice::<Observation>(&packet[..size]) {
                    publish(dir, "observation.json", &serde_json::to_vec(&o)?)?;
                }
            }
            let countdown_path = dir.join("countdown.json");
            let reply = if enabled && fresh(&countdown_path) {
                let offer: Option<CountdownOffer> =
                    File::open(countdown_path).ok().and_then(|file| {
                        serde_json::from_reader(file.take(MAX_PACKET as u64 + 1)).ok()
                    });
                serde_json::to_vec(&serde_json::json!({"enabled":true, "offer":offer}))?
            } else if enabled {
                b"{\"enabled\":true}".to_vec()
            } else {
                b"{\"enabled\":false}".to_vec()
            };
            output.write_all(&(reply.len() as u32).to_ne_bytes())?;
            output.write_all(&reply)?;
            output.flush()?;
        }
    }

    // Chrome checks the manifest's allowed extension ID before launching the host.
    pub fn run_chrome_host() -> Option<io::Result<()>> {
        let origin = std::env::args().nth(1)?;
        let id = origin
            .strip_prefix("chrome-extension://")?
            .strip_suffix('/')?;
        if id.len() != 32 || !id.bytes().all(|b| (b'a'..=b'p').contains(&b)) {
            return None;
        }
        Some(directory().and_then(|dir| exchange(io::stdin().lock(), io::stdout().lock(), &dir)))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::google_meet::{BrowserAction, Phase};

        fn packet(body: &[u8]) -> Vec<u8> {
            [(body.len() as u32).to_ne_bytes().as_slice(), body].concat()
        }

        #[test]
        fn chrome_bridge_requires_a_lease_and_accepts_only_phase_and_opaque_id() {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path();
            let observation = Observation {
                call: uuid::Uuid::new_v4(),
                phase: super::super::Phase::Joined,
                response: None,
            };
            let data = serde_json::to_vec(&observation).unwrap();
            let mut reply = Vec::new();
            exchange(&packet(&data)[..], &mut reply, path).unwrap();
            assert_eq!(reply, packet(br#"{"enabled":false}"#));
            assert!(!path.join("observation.json").exists());

            publish(path, "enabled", b"").unwrap();
            reply.clear();
            exchange(&packet(br#"{"call":"00000000-0000-0000-0000-000000000000","phase":"joined","title":"not accepted"}"#)[..], &mut reply, path).unwrap();
            assert!(!path.join("observation.json").exists());
            exchange(&packet(&data)[..], io::sink(), path).unwrap();
            assert_eq!(fs::read(path.join("observation.json")).unwrap(), data);
        }

        #[test]
        fn chrome_bridge_rejects_oversized_messages() {
            let dir = tempfile::tempdir().unwrap();
            assert!(exchange(
                &((MAX_PACKET + 1) as u32).to_ne_bytes()[..],
                io::sink(),
                dir.path()
            )
            .is_err());
        }

        #[test]
        fn chrome_bridge_round_trips_a_scoped_countdown_offer_and_response() {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path();
            let call = uuid::Uuid::new_v4();
            let nonce = uuid::Uuid::new_v4();
            let offer = CountdownOffer {
                call,
                nonce,
                phase: Phase::Ended,
            };
            publish(path, "enabled", b"").unwrap();
            publish(path, "countdown.json", &serde_json::to_vec(&offer).unwrap()).unwrap();
            let observation = Observation {
                call,
                phase: Phase::Ended,
                response: Some((nonce, BrowserAction::Cancel)),
            };
            let data = serde_json::to_vec(&observation).unwrap();
            let mut reply = Vec::new();
            exchange(&packet(&data)[..], &mut reply, path).unwrap();
            let reply: serde_json::Value = serde_json::from_slice(&reply[4..]).unwrap();
            assert_eq!(reply["offer"], serde_json::to_value(offer).unwrap());
            assert_eq!(fs::read(path.join("observation.json")).unwrap(), data);
        }
    }
}
