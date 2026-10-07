/* SPDX-License-Identifier: GPL-2.0-or-later
 * Dash to Panel Plus, 2026. Pure data logic shared by GJS and the tests.
 */
var PALETTE = ['#5c9ded', '#e5974b', '#73b87c', '#b18be5', '#df7fa7', '#63b7bb', '#c5aa57', '#b79076'];

function cleanText(value, max = 200) {
    return String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max);
}

function parseJson(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
}

function uniqueIds(ids) {
    return [...new Set((Array.isArray(ids) ? ids : []).filter(id =>
        typeof id === 'string' && id.endsWith('.desktop') && !/[\x00-\x1f/]/.test(id)))];
}

function normalizeProfiles(value) {
    const result = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const [key, profile] of Object.entries(value)) {
        if (!/^\d+$/.test(key) || Number(key) > 99 || !profile || typeof profile !== 'object') continue;
        result[key] = {order: uniqueIds(profile.order)};
        if (Array.isArray(profile.favorites)) result[key].favorites = uniqueIds(profile.favorites);
    }
    return result;
}

function favoritesFor(profiles, index, fallback) {
    const entry = profiles[String(index)];
    return entry && Array.isArray(entry.favorites) ? entry.favorites.slice() : uniqueIds(fallback);
}

function moveId(ids, id, position) {
    const result = ids.filter(item => item !== id);
    result.splice(position < 0 ? result.length : Math.min(position, result.length), 0, id);
    return result;
}

function compareOrder(a, b, order, fallback) {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
    return fallback;
}

function validateAliases(value) {
    if (!Array.isArray(value)) throw new Error('应用别名必须是列表');
    const seen = new Set();
    return value.map(rule => {
        const alias = cleanText(rule.alias, 160);
        const desktopId = cleanText(rule.desktopId, 200);
        if (!alias || !uniqueIds([desktopId]).length) throw new Error('请填写窗口别名和有效的应用 ID');
        const normalized = alias.toLowerCase();
        if (seen.has(normalized)) throw new Error('窗口别名重复：' + alias);
        seen.add(normalized);
        return {alias, desktopId};
    });
}

function aliasTarget(rules, identities) {
    const values = identities.filter(Boolean).map(value => String(value).toLowerCase());
    const match = rules.find(rule => values.includes(rule.alias.toLowerCase()));
    return match ? match.desktopId : null;
}

function validateWindowRules(value) {
    if (!Array.isArray(value)) throw new Error('窗口规则必须是列表');
    return value.map(rule => {
        const contains = cleanText(rule.contains);
        const label = cleanText(rule.label, 60);
        const color = cleanText(rule.color || '#5c9ded');
        const appId = cleanText(rule.appId);
        if (!contains || !label) throw new Error('请填写标题关键词和标签');
        if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('颜色应为 #RRGGBB 格式');
        if (appId && !uniqueIds([appId]).length) throw new Error('应用 ID 应以 .desktop 结尾');
        return {contains, label, color, appId};
    });
}

function projectLabel(title, appId) {
    if (!/(^|[.\-])(code|codium)([.\-]|$)|visualstudio/i.test(appId)) return '';
    const text = cleanText(title, 1000);
    if (/^(Visual Studio Code(?: - Insiders)?|VSCodium|Code - OSS|Code)$/i.test(text)) return '';
    const parts = text.replace(/\s+[-—–]\s+(?:Visual Studio Code(?: - Insiders)?|VSCodium|Code - OSS|Code)$/i, '').split(/\s+(?:-|—|–)\s+/);
    return cleanText(parts[parts.length - 1], 60).replace(/^[●•]\s*/, '');
}

function colorFor(label) {
    let hash = 0;
    for (const c of label) hash = ((hash * 31) + c.codePointAt(0)) >>> 0;
    return PALETTE[hash % PALETTE.length];
}

function badgeFor(title, appId, rules, manual) {
    if (manual && manual.label) return {label: cleanText(manual.label, 60), color: manual.color || colorFor(manual.label)};
    const match = rules.find(rule => (!rule.appId || rule.appId === appId) && title.toLowerCase().includes(rule.contains.toLowerCase()));
    if (match) return {label: match.label, color: match.color};
    const label = projectLabel(title, appId);
    return label ? {label, color: colorFor(label)} : null;
}

function validateScripts(value) {
    if (!Array.isArray(value)) throw new Error('脚本操作必须是列表');
    return value.map(rule => {
        const name = cleanText(rule.name, 80);
        const argv = rule.argv;
        if (!name || !Array.isArray(argv) || !argv.length || argv.some(arg => typeof arg !== 'string' || arg.includes('\0')))
            throw new Error('请填写名称、程序路径和参数');
        if (!argv[0].startsWith('/') || argv[0].includes('{')) throw new Error('程序必须使用不含变量的绝对路径');
        return {name, argv: argv.slice()};
    });
}

function expandArgs(argv, context) {
    // Each replacement stays inside ONE argv element; titles never become shell syntax.
    return argv.map(arg => arg.replace(/\{(title|appId|workspace|windowId|label)\}/g, (_, key) => String(context[key] || '')));
}
