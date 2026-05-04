use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use reqwest::header::USER_AGENT;
use uuid::Uuid;

use crate::constants::{
    MAX_MODEL_WALK_DEPTH, TRANSLATION_MODEL_EXTENSIONS, WHISPER_MODEL_EXTENSIONS,
};
use crate::domain::{
    normalize_model_reference, ModelKind, ModelRecord, ModelState, RelaySettings, UserMessage,
};
use crate::recommended_models::{
    model_references_equal, recommended_model, recommended_model_by_reference,
};

pub(crate) fn collect_models(settings: &RelaySettings) -> Vec<ModelRecord> {
    let mut candidates = BTreeMap::<(ModelKind, String), ModelRecord>::new();
    collect_model_candidates(
        &mut candidates,
        ModelKind::Transcription,
        &settings.stt_model_path,
        &settings.stt_selected_model,
        WHISPER_MODEL_EXTENSIONS,
    );
    collect_model_candidates(
        &mut candidates,
        ModelKind::Translation,
        &settings.translation.model_path,
        &settings.translation.selected_model,
        TRANSLATION_MODEL_EXTENSIONS,
    );
    candidates.into_values().collect()
}

pub(crate) fn validate_model_directory(path: &str, label: &str) -> Result<(), UserMessage> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(UserMessage::new("runtime:modelDirectoryEmpty").param("label", label));
    }

    let path = Path::new(trimmed);
    if !path.exists() {
        return Err(UserMessage::new("runtime:modelDirectoryMissing")
            .param("label", label)
            .param("path", path.display()));
    }

    let metadata = fs::metadata(path).map_err(|error| {
        UserMessage::new("runtime:modelDirectoryUnavailable")
            .param("label", label)
            .param("error", error)
    })?;
    if !metadata.is_dir() {
        return Err(UserMessage::new("runtime:modelDirectoryMustBeFolder").param("label", label));
    }

    fs::read_dir(path).map_err(|error| {
        UserMessage::new("runtime:modelDirectoryCannotBeRead")
            .param("label", label)
            .param("path", path.display())
            .param("error", error)
    })?;

    Ok(())
}

pub(crate) fn validate_model_file_extension(
    path: &Path,
    label: &str,
    extensions: &[&str],
) -> Result<(), String> {
    if has_supported_extension(path, extensions) {
        Ok(())
    } else {
        Err(format!(
            "{label} model file must use one of these extensions: {}",
            format_extensions(extensions)
        ))
    }
}

fn collect_model_candidates(
    out: &mut BTreeMap<(ModelKind, String), ModelRecord>,
    kind: ModelKind,
    root_dir: &str,
    selected_model: &str,
    extensions: &[&str],
) {
    let root_dir = root_dir.trim();
    if root_dir.is_empty() {
        return;
    }

    let root = Path::new(root_dir);
    let selected_model = normalize_model_reference(selected_model).unwrap_or_default();
    let Ok(metadata) = fs::metadata(root) else {
        return;
    };

    if metadata.is_file() {
        if has_supported_extension(root, extensions) {
            register_model(
                out,
                kind,
                root.to_path_buf(),
                root.parent().unwrap_or(root),
                &selected_model,
            );
        }
        return;
    }

    // Walk the tree iteratively with two guards:
    //   * `depth` ceiling so an accidental root selection (e.g. `/`) cannot
    //     descend the whole filesystem.
    //   * `visited` set keyed on canonical paths to break symlink cycles —
    //     common on Linux (`/proc`, `/sys`) and macOS (`/var` -> `/private/var`).
    // Using `entry.file_type()` (without following) plus canonicalize on
    // descent means a symlink to an already-visited directory is silently
    // skipped instead of looping.
    let mut pending: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    let mut visited: HashSet<PathBuf> = HashSet::new();
    if let Ok(canonical) = fs::canonicalize(root) {
        visited.insert(canonical);
    }

    while let Some((directory, depth)) = pending.pop() {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            if file_type.is_dir() || file_type.is_symlink() {
                if depth + 1 > MAX_MODEL_WALK_DEPTH {
                    continue;
                }
                let canonical = match fs::canonicalize(&path) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                if !visited.insert(canonical) {
                    continue;
                }
                pending.push((path, depth + 1));
                continue;
            }

            if !has_supported_extension(&path, extensions) {
                continue;
            }

            register_model(out, kind, path, root, &selected_model);
        }
    }

    if let Some(recommended) = recommended_model(kind) {
        let already_listed = out.values().any(|model| {
            model.kind == kind
                && model_references_equal(&model.relative_path, recommended.relative_path)
        });
        if !already_listed {
            register_model(
                out,
                kind,
                root.join(recommended.relative_path),
                root,
                &selected_model,
            );
        }
    }

    if !selected_model.is_empty() {
        let already_listed = out.values().any(|model| {
            model.kind == kind && model_references_equal(&model.relative_path, &selected_model)
        });
        let selected_path = root.join(&selected_model);
        if !already_listed && has_supported_extension(&selected_path, extensions) {
            register_model(out, kind, selected_path, root, &selected_model);
        }
    }
}

fn register_model(
    out: &mut BTreeMap<(ModelKind, String), ModelRecord>,
    kind: ModelKind,
    path: PathBuf,
    root: &Path,
    selected_model: &str,
) {
    let path_string = path.to_string_lossy().to_string();
    if path_string.is_empty() {
        return;
    }

    let metadata = fs::metadata(&path).ok();
    let exists = metadata.is_some();
    let relative_path = path
        .strip_prefix(root)
        .ok()
        .and_then(path_to_model_reference)
        .unwrap_or_else(|| {
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("Unknown model")
                .to_string()
        });
    let active =
        !selected_model.is_empty() && model_references_equal(&relative_path, selected_model);
    let state = if active {
        if exists {
            ModelState::Active
        } else {
            ModelState::Missing
        }
    } else if exists {
        ModelState::Available
    } else {
        ModelState::Missing
    };
    let recommended = recommended_model_by_reference(kind, &relative_path);

    let record = ModelRecord {
        kind,
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Unknown model")
            .to_string(),
        relative_path,
        path: path_string.clone(),
        size_bytes: metadata.map(|value| value.len()),
        state,
        recommended: recommended.is_some(),
        download_url: recommended.map(|value| value.url.to_string()),
    };

    let key = model_record_key(kind, &path_string, &record);
    out.entry(key)
        .and_modify(|current| replace_with_preferred_model(current, &record))
        .or_insert(record);
}

pub(crate) async fn download_recommended_model_file(
    root: &Path,
    kind: ModelKind,
) -> Result<PathBuf> {
    fs::create_dir_all(root)
        .with_context(|| format!("create model directory {}", root.display()))?;

    let target = recommended_model_target(root, kind)?;
    if let Ok(metadata) = fs::metadata(&target) {
        if metadata.is_file() {
            return Ok(target);
        }
        return Err(anyhow!(
            "recommended model path {} exists but is not a file",
            target.display()
        ));
    }

    let parent = target
        .parent()
        .ok_or_else(|| anyhow!("recommended model target has no parent directory"))?;
    fs::create_dir_all(parent)
        .with_context(|| format!("create model directory {}", parent.display()))?;

    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| anyhow!("recommended model target has invalid file name"))?;
    let temp_path = parent.join(format!("{file_name}.download.{}", Uuid::new_v4()));

    let model =
        recommended_model(kind).ok_or_else(|| anyhow!("no recommended model for {kind:?}"))?;
    let result = download_to_path(model.url, &temp_path)
        .await
        .and_then(|()| {
            fs::rename(&temp_path, &target)
                .with_context(|| format!("move downloaded model to {}", target.display()))
        });

    match result {
        Ok(()) => Ok(target),
        Err(_error) if target.is_file() => {
            let _ = fs::remove_file(&temp_path);
            Ok(target)
        }
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            Err(error)
        }
    }
}

fn recommended_model_target(root: &Path, kind: ModelKind) -> Result<PathBuf> {
    let model =
        recommended_model(kind).ok_or_else(|| anyhow!("no recommended model for {kind:?}"))?;
    Ok(root.join(model.relative_path))
}

fn model_record_key(
    kind: ModelKind,
    path_string: &str,
    record: &ModelRecord,
) -> (ModelKind, String) {
    if record.recommended {
        return (
            kind,
            format!("recommended:{}", record.relative_path.to_lowercase()),
        );
    }

    (kind, path_string.to_string())
}

fn replace_with_preferred_model(current: &mut ModelRecord, next: &ModelRecord) {
    if model_state_rank(next.state) > model_state_rank(current.state) {
        *current = next.clone();
    }
}

fn model_state_rank(state: ModelState) -> u8 {
    match state {
        ModelState::Missing => 1,
        ModelState::Available => 2,
        ModelState::Active => 3,
    }
}

async fn download_to_path(url: &str, path: &Path) -> Result<()> {
    let client = reqwest::Client::new();
    let mut response = client
        .get(url)
        .header(USER_AGENT, "Relay")
        .send()
        .await
        .with_context(|| format!("request recommended model {url}"))?
        .error_for_status()
        .with_context(|| format!("download recommended model {url}"))?;

    let mut file =
        fs::File::create(path).with_context(|| format!("create temp file {}", path.display()))?;
    while let Some(chunk) = response
        .chunk()
        .await
        .with_context(|| format!("stream recommended model {url}"))?
    {
        file.write_all(&chunk)
            .with_context(|| format!("write temp file {}", path.display()))?;
    }
    file.sync_all()
        .with_context(|| format!("sync temp file {}", path.display()))?;
    Ok(())
}

fn has_supported_extension(path: &Path, extensions: &[&str]) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    extensions
        .iter()
        .any(|candidate| extension.eq_ignore_ascii_case(candidate))
}

fn path_to_model_reference(path: &Path) -> Option<String> {
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => components.push(value.to_str()?),
            _ => return None,
        }
    }

    if components.is_empty() {
        None
    } else {
        Some(components.join("/"))
    }
}

fn format_extensions(extensions: &[&str]) -> String {
    extensions
        .iter()
        .map(|extension| format!(".{extension}"))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use uuid::Uuid;

    use super::{
        collect_models, recommended_model_target, validate_model_file_extension,
        TRANSLATION_MODEL_EXTENSIONS, WHISPER_MODEL_EXTENSIONS,
    };
    use crate::domain::{ModelKind, ModelState, RelaySettings};

    #[test]
    fn skips_unsupported_selected_files_in_model_list() {
        let root = std::env::temp_dir().join(format!("relay-models-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp model dir");
        fs::write(root.join("notes.txt"), b"not a model").expect("write temp file");

        let settings = RelaySettings {
            stt_model_path: root.to_string_lossy().to_string(),
            stt_selected_model: "notes.txt".to_string(),
            ..RelaySettings::default()
        };

        let models = collect_models(&settings);
        assert!(!models
            .iter()
            .any(|model| model.relative_path == "notes.txt"));
        assert!(models
            .iter()
            .any(|model| model.recommended && model.state == ModelState::Missing));

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn includes_recommended_model_as_missing_when_not_downloaded() {
        let root = std::env::temp_dir().join(format!("relay-models-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp model dir");

        let settings = RelaySettings {
            stt_model_path: root.to_string_lossy().to_string(),
            ..RelaySettings::default()
        };

        let models = collect_models(&settings);
        let recommended = models
            .iter()
            .find(|model| model.kind == ModelKind::Transcription && model.recommended)
            .expect("recommended transcription model is listed");
        assert_eq!(recommended.relative_path, "ggml-small.bin");
        assert_eq!(recommended.state, ModelState::Missing);
        assert!(recommended.download_url.is_some());

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn marks_recommended_model_available_when_exact_file_exists() {
        let root = std::env::temp_dir().join(format!("relay-models-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp model dir");
        fs::write(root.join("qwen2.5-3b-instruct-q5_k_m.gguf"), b"stub")
            .expect("write recommended model");

        let mut settings = RelaySettings::default();
        settings.translation.model_path = root.to_string_lossy().to_string();

        let models = collect_models(&settings);
        let recommended_models = models
            .iter()
            .filter(|model| model.kind == ModelKind::Translation && model.recommended)
            .collect::<Vec<_>>();
        assert_eq!(recommended_models.len(), 1);
        let recommended = recommended_models[0];
        assert_eq!(recommended.relative_path, "qwen2.5-3b-instruct-q5_k_m.gguf");
        assert_eq!(recommended.state, ModelState::Available);
        assert_eq!(recommended.size_bytes, Some(4));

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn selected_recommended_model_matches_case_insensitively_without_duplicate_rows() {
        let root = std::env::temp_dir().join(format!("relay-models-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp model dir");
        fs::write(root.join("qwen2.5-3b-instruct-q5_k_m.gguf"), b"stub")
            .expect("write recommended model");

        let mut settings = RelaySettings::default();
        settings.translation.model_path = root.to_string_lossy().to_string();
        settings.translation.selected_model = "Qwen2.5-3B-Instruct-Q5_K_M.gguf".to_string();

        let models = collect_models(&settings);
        let recommended_models = models
            .iter()
            .filter(|model| model.kind == ModelKind::Translation && model.recommended)
            .collect::<Vec<_>>();
        assert_eq!(recommended_models.len(), 1);
        let recommended = recommended_models[0];
        assert_eq!(recommended.relative_path, "qwen2.5-3b-instruct-q5_k_m.gguf");
        assert_eq!(recommended.state, ModelState::Active);

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn keeps_missing_selected_model_when_recommended_file_case_differs() {
        let root = std::env::temp_dir().join(format!("relay-models-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp model dir");
        fs::write(root.join("qwen2.5-3b-instruct-q5_k_m.gguf"), b"stub")
            .expect("write recommended model");

        let mut settings = RelaySettings::default();
        settings.translation.model_path = root.to_string_lossy().to_string();
        settings.translation.selected_model = "missing-selected.gguf".to_string();

        let models = collect_models(&settings);
        assert!(models.iter().any(|model| {
            model.kind == ModelKind::Translation
                && model.relative_path == "missing-selected.gguf"
                && model.state == ModelState::Missing
        }));

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn includes_missing_selected_model_when_extension_is_supported() {
        let root = std::env::temp_dir().join(format!("relay-models-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp model dir");

        let mut settings = RelaySettings::default();
        settings.translation.model_path = root.to_string_lossy().to_string();
        settings.translation.selected_model = "nested/missing.gguf".to_string();

        let models = collect_models(&settings);
        let selected = models
            .iter()
            .find(|model| model.relative_path == "nested/missing.gguf")
            .expect("missing selected model is listed");
        assert_eq!(selected.kind, ModelKind::Translation);
        assert_eq!(selected.state, ModelState::Missing);

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn recommended_download_target_uses_relative_path_not_url_file_name() {
        let root = std::env::temp_dir().join("relay-models");
        let target =
            recommended_model_target(&root, ModelKind::Translation).expect("recommended target");

        assert_eq!(target, root.join("Qwen2.5-3B-Instruct-Q5_K_M.gguf"));
    }

    /// Symlink loop must not hang or stack-overflow `collect_models`. Without
    /// the canonical-visited guard, a symlink pointing back to the root would
    /// recurse until depth ceiling, but combined with multiple sibling loops
    /// the work fans out exponentially. With the guard it stops on first
    /// re-visit. Unix-only because creating symlinks portably across CI
    /// (especially Windows without admin) is fiddly and the guard is OS-
    /// agnostic — the canonicalization codepath is the same on every OS.
    #[cfg(unix)]
    #[test]
    fn symlink_cycle_does_not_loop_forever() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!("relay-models-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("nested")).expect("create nested dir");
        fs::write(root.join("nested/qwen.gguf"), b"stub").expect("seed model");
        // Self-loop: nested/loop -> root.
        symlink(&root, root.join("nested/loop")).expect("create symlink loop");

        let mut settings = RelaySettings::default();
        settings.translation.model_path = root.to_string_lossy().to_string();

        let models = collect_models(&settings);
        // Exactly one record for qwen.gguf, regardless of how many times the
        // loop would have re-discovered it.
        let translation_count = models
            .iter()
            .filter(|m| m.kind == ModelKind::Translation && m.relative_path == "nested/qwen.gguf")
            .count();
        assert_eq!(translation_count, 1);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn validates_model_extensions_case_insensitively() {
        assert!(validate_model_file_extension(
            Path::new("ggml-small.BIN"),
            "Whisper",
            WHISPER_MODEL_EXTENSIONS
        )
        .is_ok());
        assert!(validate_model_file_extension(
            Path::new("qwen.Q5_K_M.GGUF"),
            "Translation",
            TRANSLATION_MODEL_EXTENSIONS
        )
        .is_ok());
        assert!(validate_model_file_extension(
            Path::new("model.txt"),
            "Translation",
            TRANSLATION_MODEL_EXTENSIONS
        )
        .is_err());
    }
}
