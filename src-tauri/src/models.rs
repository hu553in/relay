use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::domain::{normalize_model_reference, ModelKind, ModelRecord, ModelState, RelaySettings};

pub(crate) const WHISPER_MODEL_EXTENSIONS: &[&str] = &["bin"];
pub(crate) const TRANSLATION_MODEL_EXTENSIONS: &[&str] = &["gguf"];

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

pub(crate) fn validate_model_directory(path: &str, label: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} model directory is empty"));
    }

    let path = Path::new(trimmed);
    if !path.exists() {
        return Err(format!(
            "{label} model directory is missing at {}",
            path.display()
        ));
    }

    let metadata = fs::metadata(path)
        .map_err(|error| format!("{label} model directory is unavailable: {error}"))?;
    if !metadata.is_dir() {
        return Err(format!("{label} model directory must point to a folder"));
    }

    fs::read_dir(path).map_err(|error| {
        format!(
            "{label} model directory cannot be read at {}: {error}",
            path.display()
        )
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

    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            if file_type.is_dir() {
                pending.push(path);
                continue;
            }

            if !has_supported_extension(&path, extensions) {
                continue;
            }

            register_model(out, kind, path, root, &selected_model);
        }
    }

    if !selected_model.is_empty() {
        let selected_path = root.join(&selected_model);
        if has_supported_extension(&selected_path, extensions) {
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
    let active = !selected_model.is_empty() && relative_path == selected_model;
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
    };

    out.entry((kind, path_string))
        .and_modify(|current| {
            if matches!(record.state, ModelState::Active | ModelState::Missing) {
                *current = record.clone();
            }
        })
        .or_insert(record);
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
        collect_models, validate_model_file_extension, TRANSLATION_MODEL_EXTENSIONS,
        WHISPER_MODEL_EXTENSIONS,
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
        assert!(models.is_empty());

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
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].kind, ModelKind::Translation);
        assert_eq!(models[0].relative_path, "nested/missing.gguf");
        assert_eq!(models[0].state, ModelState::Missing);

        fs::remove_dir_all(root).ok();
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
