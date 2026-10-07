/* SPDX-License-Identifier: GPL-2.0-or-later */
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
function init() {}
function fillPreferencesWindow(window) {
    Me.imports.settingsUi.addPages(window, ExtensionUtils.getSettings());
}
