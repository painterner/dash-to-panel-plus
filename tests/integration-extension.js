/* Runs only in the isolated, headless GNOME session created by integration.py. */
const {GLib, Gio, Shell, Meta} = imports.gi;
const Main = imports.ui.main;
const Favorites = imports.ui.appFavorites;
const BASE = 'dash-to-panel@jderose9.github.com';
const PLUS = 'dash-to-panel-plus@ka.local';
const results = [];
let client = null;
let secondClient = null;
function init() {}
function wait(ms) { return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; })); }
function assert(condition, label) { if (!condition) throw new Error(label); results.push(label); }
function jsonEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function prefs() {
    const dir = Main.extensionManager.lookup(PLUS).dir.get_child('schemas').get_path();
    const source = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
    return new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.dash-to-panel-plus', false)});
}
function enable() {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => { run(); return GLib.SOURCE_REMOVE; });
}
function disable() {}
async function run() {
    let success = false, error = null;
    try {
        const settings = prefs();
        const base = Main.extensionManager.lookup(BASE);
        const plus = Main.extensionManager.lookup(PLUS);
        assert(base.state === 1 && plus.state === 1, 'Both extensions enabled');
        const fav = Favorites.getAppFavorites();
        const baseline = global.settings.get_strv('favorite-apps');
        settings.set_string('workspace-profiles', JSON.stringify({'0': {favorites:['code.desktop','terminator.desktop']}, '1': {favorites:[]}}));
        await wait(200);
        assert(jsonEqual(fav.getFavorites().map(app => app.get_id()), ['code.desktop','terminator.desktop']), 'Workspace 1 custom favorites');
        fav.moveFavoriteToPos('terminator.desktop', 0);
        assert(fav.getFavorites()[0].get_id() === 'terminator.desktop', 'Favorite reordering persisted');
        global.workspace_manager.get_workspace_by_index(1).activate(global.get_current_time());
        await wait(500);
        assert(fav.getFavorites().length === 0, 'Workspace 2 explicitly empty favorites');
        fav.addFavorite('google-chrome.desktop');
        assert(jsonEqual(fav.getFavorites().map(app => app.get_id()), ['google-chrome.desktop']), 'Favorite additions scoped to active workspace');
        assert(jsonEqual(global.settings.get_strv('favorite-apps'), baseline), 'System favorites untouched');
        settings.set_boolean('workspace-favorites', false);
        assert(jsonEqual(fav.getFavorites().map(app => app.get_id()), baseline), 'Workspace toggle restores original favorites');
        settings.set_boolean('workspace-favorites', true);
        settings.set_string('alias-rules', '[{"alias":"dtpp-alias-test","desktopId":"code.desktop"}]');
        const root = GLib.getenv('DTPP_TEST_ROOT');
        client = Gio.Subprocess.new(['/usr/bin/gjs', root + '/tests/window-client.js'], Gio.SubprocessFlags.NONE);
        let window;
        for (let i = 0; i < 25 && !window; i++) {
            await wait(200);
            window = global.get_window_actors().map(actor => actor.meta_window).find(w => w.get_wm_class() === 'dtpp-alias-test');
        }
        assert(!!window, 'Wayland test window created with alias identity');
        window.change_workspace(global.workspace_manager.get_workspace_by_index(1));
        await wait(500);
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        assert(app.get_id() === 'code.desktop', 'Alias resolved to canonical application');
        assert(app.get_windows().includes(window), 'Canonical application includes alias window');
        const taskbar = global.dashToPanel.panels[0].taskbar;
        const icon = taskbar._getAppIcons().find(item => item.window === window);
        assert(icon && icon.app.get_id() === 'code.desktop', 'Taskbar renders canonical alias icon');
        let badge = icon._dtpIconContainer.get_children().find(actor => actor.has_style_class_name && actor.has_style_class_name('dtpp-badge'));
        assert(badge && badge.text === 'Alph' && badge.visible, 'VS Code project badge rendered');
        settings.set_string('window-rules', '[{"contains":"Alpha","label":"后端","color":"#abcdef","appId":"code.desktop"}]');
        await wait(250);
        assert(badge.text === '后端', 'Window rule updates existing badge');
        settings.set_boolean('project-badges', false);
        await wait(250);
        assert(!badge.visible, 'Badge toggle removes visual marker');
        settings.set_boolean('project-badges', true);
        settings.set_string('script-actions', JSON.stringify([{name:'Record context', argv:['/usr/bin/python3',root+'/tests/record-argv.py','{title}','{appId}','{workspace}']} ]));
        icon.popupMenu();
        const menu = icon._dtppMenu.menu;
        const scriptMenu = menu._getMenuItems().find(item => item.label && item.label.text === '运行脚本');
        assert(!!scriptMenu, 'Configured script shown in window menu');
        scriptMenu.menu._getMenuItems()[0].activate(null);
        await wait(800);
        const [loaded, data] = GLib.file_get_contents(GLib.getenv('DTPP_TEST_OUTPUT') + '/argv.json');
        const argv = JSON.parse(imports.byteArray.toString(data));
        assert(loaded && jsonEqual(argv, [window.get_title(),'code.desktop','2']), 'Script receives context as separate literal arguments');
        const move = menu._getMenuItems().find(item => item.label && item.label.text === '移动到工作区');
        move.menu._getMenuItems()[2].activate(null);
        await wait(400);
        assert(window.get_workspace().index() === 2, 'Window menu moves only selected window');
        assert(!taskbar._getAppIcons().some(item => item.window === window), 'Moved window hidden from former workspace taskbar');
        window.change_workspace(global.workspace_manager.get_workspace_by_index(1));
        await wait(300);
        settings.set_string('alias-rules', '[{"alias":"dtpp-alias-test","desktopId":"code.desktop"},{"alias":"dtpp-alias-other","desktopId":"terminator.desktop"}]');
        settings.set_string('workspace-profiles', '{"0":{"favorites":["code.desktop"]},"1":{"favorites":[],"order":["terminator.desktop","code.desktop"]}}');
        secondClient = Gio.Subprocess.new(['/usr/bin/gjs', root + '/tests/window-client.js', 'dtpp-alias-other'], Gio.SubprocessFlags.NONE);
        let secondWindow;
        for (let i = 0; i < 25 && !secondWindow; i++) {
            await wait(200);
            secondWindow = global.get_window_actors().map(actor => actor.meta_window).find(w => w.get_wm_class() === 'dtpp-alias-other');
        }
        assert(!!secondWindow, 'Second test application created for ordering');
        secondWindow.change_workspace(global.workspace_manager.get_workspace_by_index(1));
        await wait(400);
        const orderedIds = () => taskbar._getAppIcons().filter(item => item.window === window || item.window === secondWindow).map(item => item.app.get_id());
        assert(jsonEqual(orderedIds(), ['terminator.desktop','code.desktop']), 'Saved running application order applied to real icons');
        settings.set_string('workspace-profiles', '{"0":{"favorites":["code.desktop"]},"1":{"favorites":[],"order":["code.desktop","terminator.desktop"]}}');
        await wait(400);
        assert(jsonEqual(orderedIds(), ['code.desktop','terminator.desktop']), 'Changing saved running order updates real icons');
        // Direct lifecycle calls avoid the manager rebasing this test extension itself.
        plus.stateObj.disable();
        await wait(300);
        assert(jsonEqual(fav.getFavorites().map(app => app.get_id()), baseline), 'Disabling enhancement restores baseline favorites');
        assert(Shell.WindowTracker.get_default().get_window_app(window).get_id() !== 'code.desktop', 'Disabling enhancement removes alias override');
        assert(global.dashToPanel.panels[0].taskbar._getAppIcons().every(item => !item._dtppMenu), 'Disabling enhancement removes added menus');
        plus.stateObj.enable();
        await wait(500);
        assert(Shell.WindowTracker.get_default().get_window_app(window).get_id() === 'code.desktop', 'Re-enabling enhancement restores alias behavior');
        assert(jsonEqual(orderedIds(), ['code.desktop','terminator.desktop']), 'Running application order survives enhancement reload');
        success = true;
    } catch (e) { error = e.message + '\n' + e.stack; logError(e, 'DTPP integration'); }
    if (client) client.force_exit();
    if (secondClient) secondClient.force_exit();
    GLib.file_set_contents(GLib.getenv('DTPP_TEST_OUTPUT') + '/result.json', JSON.stringify({success, results, error}, null, 2));
}
