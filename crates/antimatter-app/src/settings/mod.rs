mod model;
mod view;

pub(crate) use view::{AccountRow, SettingsState, settings_view};

use antimatter_services::settings::Settings;
use rune::{App, AppSpec, WindowHandle, WindowSpec};
use std::path::PathBuf;

pub(crate) const KEY: &str = "settings";
pub(crate) const SIZE: (f32, f32) = (780.0, 540.0);

/// Registers the independent, singleton Settings window on `app`. Opening it again shows the
/// same window and state; closing it hides it, and it never keeps the app alive alone.
pub(crate) fn window<S: 'static>(
    app: &mut App<S>,
    prefs: Settings,
    path: Option<PathBuf>,
    load_error: Option<String>,
    workspace: rune::AppHandle<crate::state::State>,
) -> (WindowHandle, rune::AppHandle<SettingsState>) {
    let spec = AppSpec {
        on_key: Some(close_on_command_w),
        ..AppSpec::new("Settings", SIZE, SettingsState::default, settings_view)
    };
    let mut state = SettingsState::new(prefs, path, load_error);
    state.workspace = Some(workspace);
    let spec = WindowSpec::from_app(
        KEY,
        App::new(spec)
            .windowless()
            .titlebar(rune::Titlebar::new(crate::workspace::TITLEBAR)),
    )
    .state(state);
    let (settings, handle) = app.window(spec);
    (handle, settings)
}

/// `Command-W` closes this window only; the workspace keeps its tabs.
fn close_on_command_w(_: &mut SettingsState, key: &rune::KeyEvent, tx: &mut rune::Tx) -> bool {
    if key.is_command('w') && !key.mods.shift {
        tx.close_window();
        return true;
    }
    false
}
