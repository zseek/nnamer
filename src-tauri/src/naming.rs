use serde::{Deserialize, Serialize};

const MAX_STEM_CHARACTERS: usize = 180;
const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6",
    "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7",
    "LPT8", "LPT9",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NameValidation {
    pub normalized_name: Option<String>,
    pub error: Option<String>,
}

pub fn normalize_suggested_name(input: &str) -> NameValidation {
    let trimmed_input = input.trim();
    let extensionless_input = strip_txt_extension(trimmed_input);
    let mut normalized_name = String::with_capacity(extensionless_input.len());

    for character in extensionless_input.chars() {
        if character.is_control() {
            continue;
        }

        let safe_character = match character {
            '<' => '＜',
            '>' => '＞',
            ':' => '：',
            '"' => '＂',
            '/' => '／',
            '\\' => '＼',
            '|' => '｜',
            '?' => '？',
            '*' => '＊',
            _ => character,
        };
        normalized_name.push(safe_character);
    }

    let normalized_name = normalized_name
        .trim()
        .trim_end_matches([' ', '.'])
        .chars()
        .take(MAX_STEM_CHARACTERS)
        .collect::<String>();

    if normalized_name.is_empty() {
        return invalid_name("建议名称不能为空");
    }

    let device_name_candidate = normalized_name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_uppercase();
    if WINDOWS_RESERVED_NAMES.contains(&device_name_candidate.as_str()) {
        return invalid_name("建议名称是 Windows 保留设备名");
    }

    NameValidation {
        normalized_name: Some(normalized_name),
        error: None,
    }
}

#[allow(dead_code)]
pub fn canonical_name(input: &str) -> Option<String> {
    normalize_suggested_name(input)
        .normalized_name
        .map(|name| name.to_lowercase())
}

fn strip_txt_extension(input: &str) -> &str {
    if input.len() >= 4 && input[input.len() - 4..].eq_ignore_ascii_case(".txt") {
        &input[..input.len() - 4]
    } else {
        input
    }
}

fn invalid_name(message: &str) -> NameValidation {
    NameValidation {
        normalized_name: None,
        error: Some(message.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{canonical_name, normalize_suggested_name};

    #[test]
    fn removes_txt_extension_and_replaces_windows_characters() {
        let result = normalize_suggested_name("  诡秘:之主?.TXT  ");
        assert_eq!(result.normalized_name.as_deref(), Some("诡秘：之主？"));
        assert_eq!(result.error, None);
    }

    #[test]
    fn rejects_windows_reserved_device_names() {
        let result = normalize_suggested_name("CON.txt");
        assert!(result.normalized_name.is_none());
        assert!(result.error.is_some());
    }

    #[test]
    fn canonical_names_are_case_insensitive() {
        assert_eq!(canonical_name("Novel"), canonical_name("NOVEL.txt"));
    }
}
