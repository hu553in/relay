use crate::domain::ModelKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RecommendedModel {
    pub(crate) kind: ModelKind,
    pub(crate) relative_path: &'static str,
    pub(crate) url: &'static str,
}

pub(crate) const RECOMMENDED_MODELS: &[RecommendedModel] = &[
    RecommendedModel {
        kind: ModelKind::Transcription,
        relative_path: "ggml-small.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    },
    RecommendedModel {
        kind: ModelKind::Translation,
        relative_path: "Qwen2.5-3B-Instruct-Q5_K_M.gguf",
        url: "https://huggingface.co/apto-as/Qwen2.5-3B-Instruct-Q5_K_M-GGUF/resolve/main/qwen2.5-3b-instruct-q5_k_m.gguf",
    },
];

pub(crate) fn recommended_model(kind: ModelKind) -> Option<&'static RecommendedModel> {
    RECOMMENDED_MODELS.iter().find(|model| model.kind == kind)
}

pub(crate) fn recommended_model_by_reference(
    kind: ModelKind,
    relative_path: &str,
) -> Option<&'static RecommendedModel> {
    RECOMMENDED_MODELS.iter().find(|model| {
        model.kind == kind && model_references_equal(model.relative_path, relative_path)
    })
}

pub(crate) fn model_references_equal(left: &str, right: &str) -> bool {
    normalized_model_reference(left) == normalized_model_reference(right)
}

fn normalized_model_reference(value: &str) -> String {
    value.to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::recommended_model_by_reference;
    use crate::domain::ModelKind;

    #[test]
    fn recommended_lookup_is_case_insensitive() {
        assert!(recommended_model_by_reference(
            ModelKind::Translation,
            "qwen2.5-3b-instruct-q5_k_m.gguf"
        )
        .is_some());
    }
}
