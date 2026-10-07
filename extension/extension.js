/* SPDX-License-Identifier: GPL-2.0-or-later */
const {GLib} = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const {Controller, BASE_UUID} = Me.imports.controller;

let controller = null;
let changedId = 0;
let idleId = 0;

function init() {}

function reconcile() {
    const base = Main.extensionManager.lookup(BASE_UUID);
    if (base && base.state === 1) {
        if (!controller) {
            try {
                controller = new Controller(Me, base);
                controller.enable();
            } catch (error) {
                if (controller) controller.disable();
                controller = null;
                logError(error, 'Dash to Panel Plus');
                Main.notifyError('Dash to Panel Plus', error.message);
            }
        }
    } else if (controller) {
        controller.disable();
        controller = null;
    }
}

function enable() {
    changedId = Main.extensionManager.connect('extension-state-changed', (_manager, extension) => {
        if (extension.uuid === BASE_UUID) reconcile();
    });
    idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        idleId = 0;
        reconcile();
        if (!controller) Main.notify('Dash to Panel Plus', '请先启用 Dash to Panel v56。');
        return GLib.SOURCE_REMOVE;
    });
}

function disable() {
    if (idleId) GLib.source_remove(idleId);
    idleId = 0;
    if (changedId) Main.extensionManager.disconnect(changedId);
    changedId = 0;
    if (controller) controller.disable();
    controller = null;
}
