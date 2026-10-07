# Dash to Panel Plus

为当前 GNOME 42 / Dash to Panel v56 增加四类功能的配套扩展。原插件源码与系统收藏不被覆盖。

## 功能

- **窗口项目标记**：VS Code、Insiders、VSCodium 标题自动提取项目名；彩色角标和完整悬停名称。按应用与标题关键词设置持久规则，也可在窗口右键菜单中临时指定标签和颜色。
- **工作区收藏与排序**：每个工作区编号拥有独立收藏；初始继承系统收藏，允许显式清空。增删、拖动和设置界面排序只影响该工作区。配置也会反映到 GNOME 概览里的收藏，保证两个入口一致；系统 `favorite-apps` 原始列表不被覆盖。应用顺序跨登录保存，同一应用的具体窗口顺序保存到本次会话结束。
- **窗口菜单与脚本**：图标右键 →「窗口与工作区」，移动选中窗口、修改窗口标记、重置当前工作区配置、运行自定义脚本、打开设置。
- **应用别名**：完整匹配窗口 WM_CLASS / 实例名 / 应用 ID，不区分大小写，映射到已安装的桌面应用。默认提供 `x-terminal-emulator → terminator.desktop`。不修改系统启动命令。

四类功能可分别关闭。所有新增配置保存在独立的 `org.gnome.shell.extensions.dash-to-panel-plus` schema 下。

## 安装与回退

```bash
git clone https://github.com/painterner/dash-to-panel-plus.git
cd dash-to-panel-plus
/usr/bin/python3 scripts/install.py
```

安装包在 `dist/`，安装前备份在 `~/.local/state/dash-to-panel-plus/`。
GNOME 42 首次安装新扩展通常需要**注销再登录**才能发现；安装器会输出实际状态，不会自动注销桌面。
之后可在扩展管理器中看到「Dash to Panel Plus」，或打开设置：

```bash
gnome-extensions prefs dash-to-panel-plus@ka.local
```

关闭增强版、回到原来的 Dash to Panel：

```bash
/usr/bin/python3 scripts/disable.py
```

基础 Dash to Panel 必须启用。基础插件停用时增强功能会解除接入；重新启用后自动接回。
当前适配固定为 GNOME 42 / Dash to Panel v56，升级这两者前需要重新验证内部接口。

## 使用说明

设置界面有「窗口标记」「工作区」「右键与脚本」「应用识别」四页。

工作区配置绑定**编号**，动态工作区删除后其配置仍保留在原编号；适合固定使用 1、2、3 等编号的习惯。
未单独配置的工作区跟随系统收藏。点击「复制系统收藏」会创建一个独立副本；恢复默认则重新继承系统收藏。
任务栏需要保持“不合并窗口”，才能给每个窗口显示独立角标；现有 Dock 布局、窗口分组和隔离开关仍由基础插件管理。
手动修改的单窗口标签会随该窗口关闭而消失；要长期记住项目标记，请使用标题规则。

脚本列表初始为空，程序必须使用绝对路径；每行一个参数。支持 `{title}`、`{appId}`、`{workspace}`、`{windowId}`、`{label}`。
替换后的内容始终保持为一个参数，不进行 Shell 拼接。脚本也可读取 `DTPP_TITLE`、`DTPP_APPID`、`DTPP_WORKSPACE`、`DTPP_WINDOWID`、`DTPP_LABEL` 环境变量。脚本异步运行，输出不进入桌面主循环，失败会显示通知。运行脚本只由用户点击触发。

## 开发与验证

```bash
node tests/model.test.cjs
glib-compile-schemas --strict extension/schemas
mkdir -p test-output
GSETTINGS_BACKEND=memory GDK_BACKEND=x11 xvfb-run -a gjs -I extension tests/prefs-smoke.js "$PWD"
/usr/bin/python3 tests/integration.py
/usr/bin//usr/bin/python3 scripts/build.py
```

集成测试在独立 D-Bus、Wayland 运行目录和 dconf 配置中启动无头 GNOME，验证实际图标、角标、工作区收藏、别名、菜单移动、脚本参数以及停用和重新启用。日志与结果在 `test-output/`。

`model.js` 管数据校验和纯逻辑，`controller.js` 管运行期接入与清理，`settingsUi.js` 管原生 GTK / Libadwaita 设置。扩展不导出远程执行接口；所有安装与关闭脚本只操作它自己的扩展 ID。

## 许可证与来源

GPL-2.0-or-later。Dash to Panel 原项目：https://github.com/home-sweet-gnome/dash-to-panel
本项目为独立配套扩展，不是原项目的官方发行版。基于本机安装的 v56 接口进行适配。
