const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const m = vm.createContext({});
vm.runInContext(fs.readFileSync(__dirname + '/../extension/model.js', 'utf8'), m);
const plain = value => JSON.parse(JSON.stringify(value));

test('workspace profiles inherit until edited; explicit empty favorites stay empty', () => {
    const profiles = m.normalizeProfiles({'0': {favorites: ['code.desktop', 'code.desktop']}, '1': {favorites: []}, '-1': {favorites: ['bad.desktop']}});
    assert.deepEqual(plain(m.favoritesFor(profiles, 0, ['fallback.desktop'])), ['code.desktop']);
    assert.deepEqual(plain(m.favoritesFor(profiles, 1, ['fallback.desktop'])), []);
    assert.deepEqual(plain(m.favoritesFor(profiles, 2, ['fallback.desktop'])), ['fallback.desktop']);
    const copy = m.favoritesFor(profiles, 0, []); copy.push('new.desktop');
    assert.equal(profiles['0'].favorites.length, 1);
});
test('favorite reorder does not duplicate or lose apps', () => {
    assert.deepEqual(plain(m.moveId(['a', 'b', 'c'], 'a', 1)), ['b', 'a', 'c']);
    assert.deepEqual(plain(m.moveId(['a', 'b', 'c'], 'c', 0)), ['c', 'a', 'b']);
    assert.deepEqual(plain(m.moveId(['a', 'b'], 'c', -1)), ['a', 'b', 'c']);
});
test('project titles handle VS Code variants, remote projects and empty windows', () => {
    assert.equal(m.projectLabel('index.ts — website — Visual Studio Code', 'code.desktop'), 'website');
    assert.equal(m.projectLabel('main.go - api [SSH: dev] - Visual Studio Code - Insiders', 'code-insiders.desktop'), 'api [SSH: dev]');
    assert.equal(m.projectLabel('README - docs - VSCodium', 'codium.desktop'), 'docs');
    assert.equal(m.projectLabel('Visual Studio Code', 'code.desktop'), '');
    assert.equal(m.projectLabel('foo - Google Chrome', 'google-chrome.desktop'), '');
});
test('manual badges take precedence over title rules and automatic detection', () => {
    const rules = m.validateWindowRules([{contains:'website',label:'生产环境',color:'#abcdef',appId:'code.desktop'}]);
    assert.equal(m.badgeFor('website - Visual Studio Code', 'code.desktop', rules, null).label, '生产环境');
    assert.equal(m.badgeFor('website - Visual Studio Code', 'code.desktop', rules, {label:'测试'}).label, '测试');
    assert.equal(m.badgeFor('website', 'other.desktop', rules, null), null);
    assert.equal(m.colorFor('website'), m.colorFor('website'));
    assert.throws(() => m.validateWindowRules([{contains:'x',label:'x',color:'red; display:none'}]));
});
test('application aliases require exact identities and valid destinations', () => {
    const rules = m.validateAliases([{alias:'x-terminal-emulator',desktopId:'terminator.desktop'}]);
    assert.equal(m.aliasTarget(rules, ['X-terminal-emulator', null]), 'terminator.desktop');
    assert.equal(m.aliasTarget(rules, ['x-terminal-emulator-other']), null);
    assert.throws(() => m.validateAliases([{alias:'x',desktopId:'a.desktop'},{alias:'X',desktopId:'b.desktop'}]));
    assert.throws(() => m.validateAliases([{alias:'x',desktopId:'../app.desktop'}]));
});
test('script context cannot turn a window title into shell syntax or extra arguments', () => {
    const payload = '"; touch /tmp/should-not-exist; $(whoami)\n--flag';
    const script = m.validateScripts([{name:'工具', argv:['/usr/bin/printf','%s','{title}','{workspace}']}])[0];
    assert.deepEqual(plain(m.expandArgs(script.argv,{title:payload,workspace:'2'})), ['/usr/bin/printf','%s',payload,'2']);
    assert.throws(() => m.validateScripts([{name:'x',argv:['relative-script']}]));
    assert.throws(() => m.validateScripts([{name:'x',argv:['/bin/echo','\0']} ]));
});
test('saved application order ranks new apps after known apps', () => {
    assert.ok(m.compareOrder('b','a',['a','b'],0)>0);
    assert.ok(m.compareOrder('new','a',['a'],0)>0);
    assert.equal(m.compareOrder('new','other',['a'],-5),-5);
});
