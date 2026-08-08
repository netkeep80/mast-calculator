#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{fs, path::PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedTextFile {
    name: String,
    path: String,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedTextFile {
    name: String,
    path: String,
}

fn display_name(path: &PathBuf) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn path_text(path: &PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

#[tauri::command]
async fn open_text_file(
    app: AppHandle,
    extensions: Vec<String>,
) -> Result<Option<OpenedTextFile>, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        let refs = extensions.iter().map(String::as_str).collect::<Vec<_>>();
        let mut dialog = app.dialog().file().set_title("Открыть файл Mast Calculator");
        if !refs.is_empty() {
            dialog = dialog.add_filter("Mast Calculator", &refs);
        }
        dialog.blocking_pick_file()
    })
    .await
    .map_err(|error| format!("Не удалось завершить системный диалог открытия: {error}"))?;

    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| format!("Выбранный объект не является локальным файлом: {error}"))?;
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("Не удалось прочитать {}: {error}", path.display()))?;

    Ok(Some(OpenedTextFile {
        name: display_name(&path),
        path: path_text(&path),
        text,
    }))
}

#[tauri::command]
async fn save_text_file(
    app: AppHandle,
    suggested_name: String,
    content: String,
    extensions: Vec<String>,
) -> Result<Option<SavedTextFile>, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        let refs = extensions.iter().map(String::as_str).collect::<Vec<_>>();
        let mut dialog = app
            .dialog()
            .file()
            .set_title("Сохранить файл Mast Calculator")
            .set_file_name(suggested_name);
        if !refs.is_empty() {
            dialog = dialog.add_filter("Mast Calculator", &refs);
        }
        dialog.blocking_save_file()
    })
    .await
    .map_err(|error| format!("Не удалось завершить системный диалог сохранения: {error}"))?;

    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| format!("Выбранный объект не является локальным файлом: {error}"))?;
    fs::write(&path, content)
        .map_err(|error| format!("Не удалось записать {}: {error}", path.display()))?;

    Ok(Some(SavedTextFile {
        name: display_name(&path),
        path: path_text(&path),
    }))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_text_file, save_text_file])
        .run(tauri::generate_context!())
        .expect("failed to run Mast Calculator desktop application");
}
