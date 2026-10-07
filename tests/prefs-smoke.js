imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';
const {Gtk, Adw, Gio, GLib} = imports.gi;
Gtk.init(); Adw.init();
const source = Gio.SettingsSchemaSource.new_from_directory(ARGV[0] + '/extension/schemas', Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.dash-to-panel-plus', false)});
const window = new Adw.PreferencesWindow();
const pages = imports.settingsUi.addPages(window, settings);
window.present();
const loop = GLib.MainLoop.new(null, false);
let pageIndex = 0;
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
    try {
        const paintable = new Gtk.WidgetPaintable({widget: window});
        const snapshot = new Gtk.Snapshot();
        paintable.snapshot(snapshot, window.get_width(), window.get_height());
        const node = snapshot.to_node();
        const texture = window.get_renderer().render_texture(node, null);
        texture.save_to_png(ARGV[0] + '/test-output/preferences-' + pageIndex + '.png');
        pageIndex++;
        if (pageIndex < pages.length) { window.set_visible_page(pages[pageIndex]); return GLib.SOURCE_CONTINUE; }
        print('Preferences: all four pages constructed; four screenshots saved');
    } catch (error) { logError(error); }
    window.close(); loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();
