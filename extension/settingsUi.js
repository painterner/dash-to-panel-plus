/* SPDX-License-Identifier: GPL-2.0-or-later */
const {Gtk, Adw, Gio, GLib} = imports.gi;
// Injectable import path also permits testing the preferences outside GNOME Shell.
const Model = (() => {
    try { return imports.misc.extensionUtils.getCurrentExtension().imports.model; }
    catch (_) { return imports.model; }
})();

function switchRow(group, settings, key, title, subtitle = '') {
    const row = new Adw.ActionRow({title, subtitle});
    const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER});
    settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(toggle);
    row.activatable_widget = toggle;
    group.add(row);
    return toggle;
}
function button(label, callback, icon = null) {
    const widget = icon ? new Gtk.Button({icon_name: icon, tooltip_text: label, valign: Gtk.Align.CENTER}) : new Gtk.Button({label, valign: Gtk.Align.CENTER});
    widget.connect('clicked', callback);
    return widget;
}
function appChoices(includeAll = false) {
    const apps = Gio.AppInfo.get_all().filter(app => app.should_show() && app.get_id()).sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()));
    return {ids: (includeAll ? [''] : []).concat(apps.map(app => app.get_id())),
        labels: (includeAll ? ['所有应用'] : []).concat(apps.map(app => app.get_display_name() + ' · ' + app.get_id()))};
}
function dropdown(includeAll = false) {
    const choices = appChoices(includeAll);
    const widget = Gtk.DropDown.new_from_strings(choices.labels);
    widget.hexpand = true;
    widget.enable_search = true;
    return {widget, get: () => choices.ids[widget.selected] || '', set: value => {
        let index = choices.ids.indexOf(value);
        if (index < 0 && value) {
            choices.ids.push(value); choices.labels.push(value);
            widget.model.append(value); index = choices.ids.length - 1;
        }
        widget.selected = Math.max(0, index);
    }};
}
function page(window, title, icon) {
    const result = new Adw.PreferencesPage({title, icon_name: icon});
    window.add(result);
    return result;
}
function group(page, title, description = '') {
    const result = new Adw.PreferencesGroup({title, description});
    page.add(result);
    return result;
}
function entryField(spec) {
    if (spec.kind === 'app') return dropdown(!!spec.optional);
    if (spec.kind === 'args') {
        const text = new Gtk.TextView({wrap_mode: Gtk.WrapMode.WORD_CHAR, monospace: true, top_margin: 6, bottom_margin: 6, left_margin: 6, right_margin: 6});
        const scroll = new Gtk.ScrolledWindow({child: text, min_content_height: 90, hexpand: true});
        return {widget: scroll, get: () => {
            const buffer = text.buffer;
            const value = buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), false);
            return value === '' ? [] : value.split('\n');
        }, set: value => text.buffer.set_text((value || []).join('\n'), -1)};
    }
    const widget = new Gtk.Entry({hexpand: true, placeholder_text: spec.placeholder || ''});
    return {widget, get: () => widget.text, set: value => { widget.text = value || ''; }};
}

function ruleEditor(parent, settings, key, specs, validate, describe, defaults, transform = null) {
    const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list']});
    parent.add(list);
    const form = new Gtk.Grid({row_spacing: 8, column_spacing: 12, margin_top: 14, margin_bottom: 10});
    const fields = {};
    specs.forEach((spec, index) => {
        const label = new Gtk.Label({label: spec.label, xalign: 0, valign: Gtk.Align.START});
        form.attach(label, 0, index, 1, 1);
        fields[spec.name] = entryField(spec);
        form.attach(fields[spec.name].widget, 1, index, 1, 1);
    });
    const error = new Gtk.Label({xalign: 0, wrap: true, css_classes: ['error']});
    const actions = new Gtk.Box({spacing: 8, halign: Gtk.Align.END});
    let editIndex = -1;
    const getRows = () => Model.parseJson(settings.get_string(key), []);
    const reset = () => {
        editIndex = -1;
        for (const spec of specs) fields[spec.name].set(defaults[spec.name]);
        save.label = '添加'; error.label = '';
    };
    const save = button('添加', () => {
        try {
            let entry = Object.fromEntries(specs.map(spec => [spec.name, fields[spec.name].get()]));
            if (transform) entry = transform(entry);
            const rows = getRows();
            if (editIndex < 0) rows.push(entry); else rows[editIndex] = entry;
            const checked = validate(rows);
            settings.set_string(key, JSON.stringify(checked));
            reset();
        } catch (e) { error.label = e.message; }
    });
    save.add_css_class('suggested-action');
    actions.append(button('取消编辑', reset));
    actions.append(save);
    form.attach(error, 0, specs.length, 2, 1);
    form.attach(actions, 0, specs.length + 1, 2, 1);
    parent.add(form);
    const render = () => {
        while (list.get_first_child()) list.remove(list.get_first_child());
        getRows().forEach((entry, index) => {
            const [title, subtitle] = describe(entry);
            const row = new Adw.ActionRow({title: GLib.markup_escape_text(title, -1), subtitle: GLib.markup_escape_text(subtitle, -1)});
            row.add_suffix(button('编辑', () => {
                editIndex = index;
                const values = key === 'script-actions' ? {name: entry.name, program: entry.argv[0], args: entry.argv.slice(1)} : entry;
                for (const spec of specs) fields[spec.name].set(values[spec.name]);
                save.label = '保存修改'; error.label = '';
            }, 'document-edit-symbolic'));
            row.add_suffix(button('删除', () => {
                const rows = getRows(); rows.splice(index, 1);
                settings.set_string(key, JSON.stringify(rows)); reset();
            }, 'user-trash-symbolic'));
            list.append(row);
        });
    };
    reset(); render();
    return settings.connect('changed::' + key, render);
}

function addPages(window, settings) {
    window.set_default_size(820, 730);
    window.set_title('Dash to Panel 增强功能');
    const signalIds = [];
    const windowsPage = page(window, '窗口标记', 'preferences-desktop-display-symbolic');
    const appearance = group(windowsPage, '项目标签与颜色', '从 VS Code 窗口标题识别项目，显示简短彩色角标；悬停查看完整名称。单个窗口也可通过右键菜单标记。');
    switchRow(appearance, settings, 'project-badges', '显示窗口角标');
    const lengthRow = new Adw.ActionRow({title: '角标显示字数'});
    const length = Gtk.SpinButton.new_with_range(2, 12, 1);
    length.valign = Gtk.Align.CENTER;
    settings.bind('badge-length', length, 'value', Gio.SettingsBindFlags.DEFAULT);
    lengthRow.add_suffix(length); appearance.add(lengthRow);
    const rules = group(windowsPage, '自动标记规则', '标题包含指定文字时使用这里的标签与颜色。规则按列表顺序匹配；适用于 Chrome、终端等应用。');
    signalIds.push(ruleEditor(rules, settings, 'window-rules', [
        {name: 'appId', label: '应用', kind: 'app', optional: true},
        {name: 'contains', label: '标题包含', placeholder: '例如：my-project'},
        {name: 'label', label: '显示标签', placeholder: '例如：网站开发'},
        {name: 'color', label: '颜色', placeholder: '#5c9ded'},
    ], Model.validateWindowRules, rule => [rule.label, rule.contains + ' · ' + (rule.appId || '所有应用') + ' · ' + rule.color], {color: '#5c9ded'}));

    const workspaces = page(window, '工作区', 'view-grid-symbolic');
    const scope = group(workspaces, '独立收藏与顺序', '按工作区编号保存。未单独设置的工作区沿用系统收藏；不会覆盖原来的系统收藏列表。动态工作区删除后，配置仍保留在原编号。');
    switchRow(scope, settings, 'workspace-favorites', '每个工作区使用独立收藏');
    switchRow(scope, settings, 'workspace-order', '记住每个工作区的排列', '拖动任务栏图标调整顺序；应用顺序跨登录保留，具体窗口顺序保留到本次会话结束。');
    const favorites = group(workspaces, '编辑工作区收藏');
    const workspaceRow = new Adw.ActionRow({title: '工作区编号'});
    const workspace = Gtk.SpinButton.new_with_range(1, 36, 1);
    workspace.value = settings.get_int('active-workspace') + 1;
    workspace.valign = Gtk.Align.CENTER;
    workspaceRow.add_suffix(workspace); favorites.add(workspaceRow);
    const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list']});
    favorites.add(list);
    const baseline = new Gio.Settings({schema_id: 'org.gnome.shell'});
    const profiles = () => Model.normalizeProfiles(Model.parseJson(settings.get_string('workspace-profiles'), {}));
    const currentIds = () => Model.favoritesFor(profiles(), workspace.get_value_as_int() - 1, baseline.get_strv('favorite-apps'));
    const writeIds = ids => {
        const data = profiles(), key = String(workspace.get_value_as_int() - 1);
        data[key] = Object.assign({}, data[key], {favorites: Model.uniqueIds(ids)});
        settings.set_string('workspace-profiles', JSON.stringify(data));
    };
    const renderFavorites = () => {
        while (list.get_first_child()) list.remove(list.get_first_child());
        const ids = currentIds();
        ids.forEach((id, index) => {
            const app = Gio.DesktopAppInfo.new(id);
            const row = new Adw.ActionRow({title: GLib.markup_escape_text(app ? app.get_display_name() : id, -1), subtitle: id});
            if (app) row.add_prefix(new Gtk.Image({gicon: app.get_icon(), pixel_size: 24}));
            const up = button('上移', () => writeIds(Model.moveId(currentIds(), id, index - 1)), 'go-up-symbolic');
            up.sensitive = index > 0; row.add_suffix(up);
            const down = button('下移', () => writeIds(Model.moveId(currentIds(), id, index + 1)), 'go-down-symbolic');
            down.sensitive = index < ids.length - 1; row.add_suffix(down);
            row.add_suffix(button('从本工作区移除', () => writeIds(currentIds().filter(value => value !== id)), 'user-trash-symbolic'));
            list.append(row);
        });
    };
    workspace.connect('value-changed', renderFavorites);
    signalIds.push(settings.connect('changed::workspace-profiles', renderFavorites));
    const chooser = dropdown();
    const addRow = new Gtk.Box({spacing: 8, margin_top: 12});
    addRow.append(chooser.widget);
    addRow.append(button('加入收藏', () => writeIds(currentIds().concat(chooser.get()))));
    favorites.add(addRow);
    const resetRow = new Gtk.Box({spacing: 8, margin_top: 8});
    resetRow.append(button('复制系统收藏', () => writeIds(baseline.get_strv('favorite-apps'))));
    resetRow.append(button('恢复此工作区默认配置', () => {
        const data = profiles(); delete data[String(workspace.get_value_as_int() - 1)];
        settings.set_string('workspace-profiles', JSON.stringify(data));
    }));
    favorites.add(resetRow); renderFavorites();

    const menuPage = page(window, '右键与脚本', 'system-run-symbolic');
    const menuGroup = group(menuPage, '窗口菜单');
    switchRow(menuGroup, settings, 'window-menu', '显示增强菜单', '移动窗口到指定工作区、修改窗口标签、运行脚本和打开设置。');
    const scripts = group(menuPage, '脚本操作', '仅点击菜单时运行。程序填绝对路径；每行一个参数，不经过 Shell 拼接。可用变量：{title}、{appId}、{workspace}、{windowId}、{label}。');
    signalIds.push(ruleEditor(scripts, settings, 'script-actions', [
        {name: 'name', label: '菜单名称', placeholder: '例如：打开项目工具'},
        {name: 'program', label: '程序或脚本', placeholder: '/absolute/path/to/my-tool'},
        {name: 'args', label: '参数（每行一个）', kind: 'args'},
    ], Model.validateScripts, rule => [rule.name, rule.argv.join(' ')], {args: []}, rule => ({name: rule.name, argv: [rule.program].concat(rule.args)})));

    const aliasPage = page(window, '应用识别', 'application-x-executable-symbolic');
    const aliasGroup = group(aliasPage, '应用别名', '把窗口报告的别名关联到正确的应用图标。别名按完整名称匹配，不区分大小写；只改变窗口归属，不改变启动命令。');
    switchRow(aliasGroup, settings, 'app-aliases', '启用应用别名匹配');
    signalIds.push(ruleEditor(aliasGroup, settings, 'alias-rules', [
        {name: 'alias', label: '窗口别名', placeholder: '例如：x-terminal-emulator'},
        {name: 'desktopId', label: '对应应用', kind: 'app'},
    ], Model.validateAliases, rule => [rule.alias, rule.desktopId], {desktopId: 'terminator.desktop'}));
    window.connect('close-request', () => {
        for (const id of signalIds.splice(0)) settings.disconnect(id);
        return false;
    });
    return [windowsPage, workspaces, menuPage, aliasPage];
}
