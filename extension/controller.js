/* SPDX-License-Identifier: GPL-2.0-or-later
 * Additive integration for Dash to Panel v56 / GNOME 42.
 * All hooks, actors and signals are removed on disable. No upstream files modified.
 */
const {Gio, GLib, St, Clutter, Shell} = imports.gi;
const Main = imports.ui.main;
const AppFavorites = imports.ui.appFavorites;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Model = Me.imports.model;

var BASE_UUID = 'dash-to-panel@jderose9.github.com';

var Controller = class {
    constructor(me, base) {
        this.me = me;
        this.base = base;
        this.settings = ExtensionUtils.getSettings();
        this.hooks = [];
        this.signals = [];
        this.icons = new Map();
        this.manual = new WeakMap();
        this.windowOrders = new Map();
        this.jobs = new Set();
        this.jobCancellation = new Gio.Cancellable();
        this.refreshId = 0;
        this.active = false;
        this.lastWorkspace = global.workspace_manager.get_active_workspace_index();
        this.tracker = Shell.WindowTracker.get_default();
        this.appSystem = Shell.AppSystem.get_default();
        this.favorites = AppFavorites.getAppFavorites();
        this.nativeWindowApp = this.tracker.get_window_app.bind(this.tracker);
        this.aliasApps = new Map();
    }

    connect(object, signal, callback) {
        this.signals.push([object, object.connect(signal, callback)]);
    }

    hook(object, name, factory) {
        const descriptor = Object.getOwnPropertyDescriptor(object, name);
        const original = object[name];
        if (typeof original !== 'function') throw new Error('不兼容的 Dash to Panel 接口：' + name);
        const wrapped = factory(original);
        object[name] = wrapped;
        this.hooks.push(() => {
            if (object[name] !== wrapped) return;
            if (descriptor) Object.defineProperty(object, name, descriptor);
            else delete object[name];
        });
    }

    enable() {
        if (this.base.metadata.version !== 56) throw new Error('当前增强版适配 Dash to Panel v56，请先确认基础插件版本。');
        this.active = true;
        this.appIcons = this.base.imports.appIcons;
        this.taskbar = this.base.imports.taskbar;
        this.readSettings();
        const self = this;

        this.hook(this.tracker, 'get_window_app', original => function (window) {
            return self.active ? self.resolveApp(window) : original.call(this, window);
        });
        this.syncAliasApps();

        this.hook(this.favorites, 'reload', original => function () {
            original.call(this);
            if (self.active && self.settings.get_boolean('workspace-favorites')) {
                this._favorites = {};
                for (const id of self.favoriteIds()) {
                    const app = self.appSystem.lookup_app(id);
                    if (app && this._parentalControlsManager.shouldShowApp(app.app_info)) this._favorites[id] = app;
                }
            }
        });
        this.hook(this.favorites, '_addFavorite', original => function (id, position) {
            if (!self.active || !self.settings.get_boolean('workspace-favorites')) return original.call(this, id, position);
            const app = self.appSystem.lookup_app(id);
            if (!app || this.isFavorite(id) || !this._parentalControlsManager.shouldShowApp(app.app_info)) return false;
            self.saveFavorites(Model.moveId(self.favoriteIds(), id, position));
            return true;
        });
        this.hook(this.favorites, '_removeFavorite', original => function (id) {
            if (!self.active || !self.settings.get_boolean('workspace-favorites')) return original.call(this, id);
            if (!this.isFavorite(id)) return false;
            self.saveFavorites(self.favoriteIds().filter(item => item !== id));
            return true;
        });
        // Avoid upstream undo callbacks modifying a different workspace after a switch.
        for (const [method, internal] of [['addFavoriteAtPos', '_addFavorite'], ['removeFavorite', '_removeFavorite']]) {
            this.hook(this.favorites, method, original => function (...args) {
                if (!self.active || !self.settings.get_boolean('workspace-favorites')) return original.apply(this, args);
                return this[internal](...args);
            });
        }
        this.hook(this.favorites, 'moveFavoriteToPos', original => function (id, position) {
            if (!self.active || !self.settings.get_boolean('workspace-favorites')) return original.call(this, id, position);
            if (this.isFavorite(id)) self.saveFavorites(Model.moveId(self.favoriteIds(), id, position));
        });
        this.hook(this.taskbar.Taskbar.prototype, 'sortAppsCompareFunction', original => function (a, b) {
            const fallback = original.call(this, a, b);
            if (!self.active || !self.settings.get_boolean('workspace-order')) return fallback;
            return Model.compareOrder(a.get_id(), b.get_id(), self.profile().order || [], fallback);
        });
        this.hook(this.taskbar.Taskbar.prototype, 'acceptDrop', original => function (...args) {
            const result = original.apply(this, args);
            if (self.active && result && self.settings.get_boolean('workspace-order')) self.captureOrder(this);
            return result;
        });
        this.hook(this.taskbar.Taskbar.prototype, '_createAppItem', original => function (...args) {
            const item = original.apply(this, args);
            if (self.active) self.decorate(item.child._delegate);
            return item;
        });
        this.hook(this.appIcons.TaskbarAppIcon.prototype, 'popupMenu', original => function (...args) {
            const result = original.apply(this, args);
            if (self.active) self.addMenu(this);
            return result;
        });
        this.hook(this.appIcons.TaskbarAppIcon.prototype, '_checkIfFocusedApp', original => function () {
            if (!self.active || !self.settings.get_boolean('app-aliases')) return original.call(this);
            return self.resolveApp(global.display.focus_window) === this.app;
        });
        this.connect(this.settings, 'changed', (_settings, key) => {
            if (key === 'active-workspace') return;
            this.readSettings();
            this.syncAliasApps();
            this.favorites.reload();
            this.favorites.emit('changed');
            this.queueRefresh();
        });
        this.connect(this.appSystem, 'installed-changed', () => {
            this.syncAliasApps();
            this.queueRefresh();
        });
        this.connect(global.window_manager, 'switch-workspace', () => {
            this.rememberWindowOrder(this.lastWorkspace);
            this.lastWorkspace = global.workspace_manager.get_active_workspace_index();
            this.settings.set_int('active-workspace', this.lastWorkspace);
            this.restoreWindowOrder(this.lastWorkspace);
            this.favorites.reload();
            this.favorites.emit('changed');
            this.queueRefresh();
        });
        if (global.dashToPanel) this.connect(global.dashToPanel, 'panels-created', () => this.queueRefresh());
        this.settings.set_int('active-workspace', this.lastWorkspace);
        this.favorites.reload();
        this.favorites.emit('changed');
        this.queueRefresh();
    }

    readSettings() {
        this.profiles = Model.normalizeProfiles(Model.parseJson(this.settings.get_string('workspace-profiles'), {}));
        for (const [key, field, validator] of [
            ['alias-rules', 'aliases', Model.validateAliases],
            ['window-rules', 'windowRules', Model.validateWindowRules],
            ['script-actions', 'scripts', Model.validateScripts],
        ]) {
            try { this[field] = validator(Model.parseJson(this.settings.get_string(key), [])); }
            catch (error) { this[field] = []; logError(error, 'Dash to Panel Plus: ' + key); }
        }
    }

    profile() { return this.profiles[String(global.workspace_manager.get_active_workspace_index())] || {}; }
    favoriteIds() {
        return Model.favoritesFor(this.profiles, global.workspace_manager.get_active_workspace_index(), global.settings.get_strv('favorite-apps'));
    }
    saveFavorites(ids) {
        const key = String(global.workspace_manager.get_active_workspace_index());
        this.profiles[key] = Object.assign({}, this.profile(), {favorites: Model.uniqueIds(ids)});
        this.settings.set_string('workspace-profiles', JSON.stringify(this.profiles));
        this.favorites.reload();
        this.favorites.emit('changed');
    }
    windows() { return global.get_window_actors().map(actor => actor.meta_window).filter(window => !window.skip_taskbar); }
    resolveApp(window) {
        if (!window) return null;
        const original = this.nativeWindowApp(window);
        if (!this.settings.get_boolean('app-aliases')) return original;
        const id = Model.aliasTarget(this.aliases, [window.get_wm_class(), window.get_wm_class_instance(), original && original.get_id()]);
        return (id && this.appSystem.lookup_app(id)) || original;
    }

    syncAliasApps() {
        // GI methods can be overridden on a single JS wrapper. We never alter native prototypes.
        for (const rule of this.aliases) {
            const app = this.appSystem.lookup_app(rule.desktopId);
            if (!app || this.aliasApps.has(app)) continue;
            this.aliasApps.set(app, true);
            const self = this;
            this.hook(app, 'get_windows', original => function () {
                const windows = original.call(this);
                if (!self.active || !self.settings.get_boolean('app-aliases')) return windows;
                return [...new Set(windows.concat(self.windows().filter(window => self.resolveApp(window) === this)))];
            });
        }
    }

    panels() { return global.dashToPanel ? global.dashToPanel.panels || [] : []; }
    queueRefresh() {
        if (!this.active || this.refreshId) return;
        this.refreshId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.refreshId = 0;
            if (!this.active) return GLib.SOURCE_REMOVE;
            for (const panel of this.panels()) {
                panel.taskbar._queueRedisplay();
                for (const icon of panel.taskbar._getAppIcons()) { this.decorate(icon); this.updateBadge(icon); }
            }
            return GLib.SOURCE_REMOVE;
        });
    }
    rememberWindowOrder(index) {
        if (!this.settings.get_boolean('workspace-order')) return;
        const order = new Map();
        for (const window of this.windows()) if ('_dtpPosition' in window) order.set(window.get_stable_sequence(), window._dtpPosition);
        this.windowOrders.set(index, order);
    }
    restoreWindowOrder(index) {
        if (!this.settings.get_boolean('workspace-order')) return;
        const order = this.windowOrders.get(index) || new Map();
        for (const window of this.windows()) {
            if (order.has(window.get_stable_sequence())) window._dtpPosition = order.get(window.get_stable_sequence());
            else delete window._dtpPosition;
        }
    }
    captureOrder(taskbar) {
        const key = String(global.workspace_manager.get_active_workspace_index());
        const ids = taskbar._getAppIcons().map(icon => icon.app.get_id());
        this.profiles[key] = Object.assign({}, this.profile(), {order: Model.uniqueIds(ids)});
        this.rememberWindowOrder(Number(key));
        this.settings.set_string('workspace-profiles', JSON.stringify(this.profiles));
    }

    decorate(icon) {
        if (this.icons.has(icon) || !icon.window || !icon._dtpIconContainer) return;
        const badge = new St.Label({style_class: 'dtpp-badge', reactive: false,
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.END});
        icon._dtpIconContainer.add_child(badge);
        const entry = {badge, signals: [], menu: null};
        this.icons.set(icon, entry);
        entry.signals.push([icon.window, icon.window.connect('notify::title', () => this.updateBadge(icon))]);
        entry.signals.push([icon, icon.connect('destroy', () => this.releaseIcon(icon))]);
        this.updateBadge(icon);
    }
    updateBadge(icon) {
        const entry = this.icons.get(icon);
        if (!entry) return;
        const data = Model.badgeFor(icon.window.get_title() || '', icon.app.get_id(), this.windowRules, this.manual.get(icon.window));
        const visible = this.settings.get_boolean('project-badges') && !!data;
        entry.badge.visible = visible;
        if (visible) {
            entry.badge.text = Array.from(data.label).slice(0, this.settings.get_int('badge-length')).join('');
            entry.badge.set_style('background-color: ' + data.color + ';');
        }
        if (icon._dashItemContainer) {
            const title = icon.window.get_title() || icon.app.get_name();
            icon._dashItemContainer.setLabelText(visible ? data.label + '\n' + title : title);
        }
    }
    releaseIcon(icon) {
        const entry = this.icons.get(icon);
        if (!entry) return;
        this.icons.delete(icon);
        for (const [object, id] of entry.signals) {
            try { object.disconnect(id); } catch (_) {}
        }
        if (entry.menu) {
            if (icon._dtppMenu === entry.menu) icon._dtppMenu = null;
            entry.menu.destroy();
        }
        entry.badge.destroy();
    }

    addMenu(icon) {
        if (icon._dtppMenu) { icon._dtppMenu.destroy(); icon._dtppMenu = null; }
        if (!this.settings.get_boolean('window-menu') || !icon._menu) return;
        const root = new PopupMenu.PopupSubMenuMenuItem('窗口与工作区');
        icon._dtppMenu = root;
        icon._menu.addMenuItem(root);
        const entry = this.icons.get(icon);
        if (entry) entry.menu = root;
        const windows = icon.window ? [icon.window] : this.appIcons.getInterestingWindows(icon.app, icon.dtpPanel.monitor);
        if (windows.length) {
            const move = new PopupMenu.PopupSubMenuMenuItem('移动到工作区');
            for (let i = 0; i < global.workspace_manager.n_workspaces; i++) {
                const target = global.workspace_manager.get_workspace_by_index(i);
                const names = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'}).get_strv('workspace-names');
                const item = move.menu.addAction('工作区 ' + (i + 1) + (names[i] ? ' · ' + names[i] : ''), () => {
                    const destination = global.workspace_manager.get_workspace_by_index(i);
                    if (!destination) return;
                    for (const window of windows) if (window.get_compositor_private()) {
                        if (window.is_on_all_workspaces()) window.unstick();
                        window.change_workspace(destination);
                    }
                });
                item.setSensitive(windows.some(window => window.get_workspace() !== target || window.is_on_all_workspaces()));
            }
            root.menu.addMenuItem(move);
        }
        if (icon.window) this.addLabelMenu(root.menu, icon);
        if (this.scripts.length) {
            const scripts = new PopupMenu.PopupSubMenuMenuItem('运行脚本');
            for (const script of this.scripts) scripts.menu.addAction(script.name, () => this.runScript(script, icon));
            root.menu.addMenuItem(scripts);
        } else {
            root.menu.addAction('配置脚本操作…', () => ExtensionUtils.openPrefs());
        }
        root.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        root.menu.addAction('重置本工作区的收藏与排序', () => {
            const key = String(global.workspace_manager.get_active_workspace_index());
            delete this.profiles[key];
            this.windowOrders.delete(Number(key));
            this.settings.set_string('workspace-profiles', JSON.stringify(this.profiles));
            this.restoreWindowOrder(Number(key));
        });
        root.menu.addAction('增强功能设置…', () => ExtensionUtils.openPrefs());
    }

    addLabelMenu(menu, icon) {
        const submenu = new PopupMenu.PopupSubMenuMenuItem('窗口标签与颜色');
        const row = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const text = new St.Entry({style_class: 'dtpp-entry', hint_text: '输入窗口标签', can_focus: true});
        const automatic = Model.badgeFor(icon.window.get_title() || '', icon.app.get_id(), this.windowRules, this.manual.get(icon.window));
        text.set_text(automatic ? automatic.label : '');
        row.add_child(text);
        submenu.menu.addMenuItem(row);
        const save = color => {
            const label = Model.cleanText(text.get_text(), 60);
            if (label) this.manual.set(icon.window, {label, color: color || Model.colorFor(label)});
            else this.manual.delete(icon.window);
            this.updateBadge(icon);
            icon._menu.close();
        };
        text.clutter_text.connect('activate', () => save());
        submenu.menu.addAction('保存标签', () => save());
        Model.PALETTE.forEach((color, index) => {
            const item = submenu.menu.addAction(['蓝色', '橙色', '绿色', '紫色', '粉色', '青色', '金色', '棕色'][index], () => save(color));
            item.label.set_style('color: ' + color + ';');
        });
        submenu.menu.addAction('恢复自动识别', () => { this.manual.delete(icon.window); this.updateBadge(icon); });
        menu.addMenuItem(submenu);
    }

    runScript(script, icon) {
        if (this.jobs.size >= 8) { Main.notify('Dash to Panel Plus', '正在运行的脚本较多，请稍后再试。'); return; }
        const window = icon.window;
        const badge = window && Model.badgeFor(window.get_title() || '', icon.app.get_id(), this.windowRules, this.manual.get(window));
        const workspace = (window && window.get_workspace()) || global.workspace_manager.get_active_workspace();
        const context = {title: window ? window.get_title() || '' : '', appId: icon.app.get_id(),
            workspace: String(workspace.index() + 1),
            windowId: window ? String(window.get_id()) : '', label: badge ? badge.label : ''};
        try {
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE});
            for (const [key, value] of Object.entries(context)) launcher.setenv('DTPP_' + key.toUpperCase(), value, true);
            const process = launcher.spawnv(Model.expandArgs(script.argv, context));
            this.jobs.add(process);
            process.wait_check_async(this.jobCancellation, (proc, result) => {
                this.jobs.delete(proc);
                try { proc.wait_check_finish(result); }
                catch (error) { if (this.active && !this.jobCancellation.is_cancelled()) Main.notifyError(script.name, error.message); }
            });
        } catch (error) { Main.notifyError(script.name, error.message); }
    }

    disable() {
        this.active = false;
        if (this.refreshId) GLib.source_remove(this.refreshId);
        this.refreshId = 0;
        this.jobCancellation.cancel();
        for (const [object, id] of this.signals.splice(0)) { try { object.disconnect(id); } catch (_) {} }
        for (const icon of Array.from(this.icons.keys())) this.releaseIcon(icon);
        for (const restore of this.hooks.reverse()) restore();
        this.hooks = [];
        this.favorites.reload();
        this.favorites.emit('changed');
        for (const panel of this.panels()) {
            for (const icon of panel.taskbar._getAppIcons()) {
                if (icon._dtppMenu) { icon._dtppMenu.destroy(); icon._dtppMenu = null; }
            }
            panel.taskbar.resetAppIcons();
        }
        this.windowOrders.clear();
        this.aliasApps.clear();
        this.jobs.clear();
    }
};
