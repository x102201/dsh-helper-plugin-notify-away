# dsh-helper-plugin-notify-away

[English](README.md) | 中文

![license: MIT](https://img.shields.io/badge/license-MIT-blue)
![dsh: 0.1.5-rc.2](https://img.shields.io/badge/dsh-0.1.5--rc.2-4b32c3)
![tests: 45 passing](https://img.shields.io/badge/tests-45%20passing-brightgreen)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）用的 **系统通知**插件：仿照 Cursor 的 Agent toast——你正在看刚结束的那场会话时保持安静，切到别的窗口才弹出系统通知。

**为什么需要它**：一轮 `dsh` 跑得久，人很容易切去干别的。人还在看的时候，侧栏自己的绿色 done 点已经够用。这个插件覆盖另一种情况——你不在看。在 dsh-helper 里通过 `chrome.webview.postMessage` 让宿主弹系统 toast；在系统浏览器里回退到 `Notification` API。

**用起来是什么样**：开一个任务，切到别的应用或标签。根会话变成 idle 时，会弹出以该会话为标题的 toast。点它会聚焦 Web UI 并打开那场会话。如果你本来就在看那场、窗口也在前台，则什么都不弹。

```text
正在看这场会话，窗口有焦点     安静
别的窗口 / 隐藏标签 / 别的会话  系统通知
```

**一行安装：**

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-helper-plugin-notify-away
dsh plugin --profile web add github:x102201/dsh-helper-plugin-notify-away
```

---

## 它做了什么

| 组成 | 行为 |
|---|---|
| 完成边沿 | 列出的会话 `running` 翻成 idle 时触发。第一次观察只记录该位，刷新时已经 idle 的会话不会弹。 |
| 离开门闩 | 只在你正在看**那场**会话时保持安静：页面可见、窗口有焦点、且 `list.current` 对得上。隐藏标签、窗口失焦、或后台会话结束 → 弹 toast。 |
| 根会话 | 子 Agent 行（`origin: 'subagent'` 或带 `parentId`）被忽略，避免并行子任务刷屏。 |
| 权限 | 在 dsh-helper 里不需要。在系统浏览器里：第一次点击或按键时申请（Safari 只接受手势里的申请）。 |
| 去重 | 每条 toast 带 `notify-away:<sessionId>` 标签，重复的会替换上一条而不是堆叠。 |
| 点击 | 聚焦窗口，并调用 `ctx.sessions.open(sessionId)`。helper 点回来走 `dsh-helper-notify-click` 事件。 |

插件**不写任何自有会话事件类型**。它只读侧栏用的那份会话列表快照。

## 安装

两种安装方式都支持。插件是纯 ESM，外加一个 ModuleLoader 客户端工厂（无需构建、零运行时依赖），所以安装时既不需要编译，也不会被 pnpm 拦下来要求 allowlist 构建脚本。

> **前置条件**：`dsh plugin` 会把参数转发给 `pnpm`，所以 pnpm 必须在 `PATH` 上（`corepack enable pnpm` 即可提供）。缺了它会直接报 `pnpm not found on PATH` 并以 127 退出。

### 方式一：本地目录（`link:`）

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-helper-plugin-notify-away
```

- 路径请用绝对路径，或相对于你执行命令时所在的目录（CLI 会把相对的 `link:`/`file:` 规格锚定到**调用目录**，而不是 profile 目录）。
- `link:` 是符号链接，所以**改 `index.js`/`client.js`/`lib/*.js` 后重启 `dsh web` 即生效**，不用重装。

### 方式二：Git 仓库（`github:`）

```sh
dsh plugin --profile web add github:<owner>/<repo>
```

- 仓库根目录就应该是这个包（即放 `package.json` 和 `cordis.patch.yml` 的那一层）。
- 需要可复现时钉住版本：`github:<owner>/<repo>#<tag-or-commit>`。
- 因为没有 `prepare`/`postinstall` 脚本，pnpm 永远不会要求你 allowlist 构建。

### 背后发生了什么

`dsh plugin ... add` 会在 `$DSH_HOME/profiles/web` 里调用 `pnpm`，然后按**已安装状态**对齐 profile 清单：本包声明了 `dsh.bundle.patch`，于是它的包名会被自动追加进 `dsh.profile.bundles`。下次启动时，该 bundle 的补丁层插入一行 host 行：

```yaml
- insert:
    - id: notify-away
      name: ./index.js      # 相对本补丁文件定位，因此任何安装布局都成立
```

`package.json` 里的 `dsh.client` 声明才会让 Web UI 扫描本包，并把 `./client` 当成 ModuleLoader 包来提供。host 行的存在，是为了让这次扫描有一个活动的 Loader 条目，并在启动时校验配置。

重启 profile 即挂载：

```sh
dsh web            # 等价于：dsh --profile web
```

在系统浏览器里，第一次询问通知权限时请允许（你的第一次点击或按键）。在 macOS 上，还要在 **系统设置 → 通知** 里允许该浏览器。dsh-helper 的内嵌面板不需要这项权限。

### 不安装也能挂 host 行

[`examples/standalone.patch.yml`](examples/standalone.patch.yml) 里的 `../index.js` 是相对补丁文件定位的，所以一个裸 checkout 可以挂上 host 行：

```sh
dsh --profile web --patch <checkout>/examples/standalone.patch.yml
```

浏览器半边仍然需要这个包能以 `dsh-helper-plugin-notify-away` 解析（一次 `link:` 安装），因为 `dsh.client` 是从包清单里发现的。

### 验证安装

```sh
# 组合后的配置树里应该能看到 notify-away 行：
dsh --profile web --dump-config | grep -A2 notify-away
```

然后在 Web 界面开一个任务，切到别的窗口，等到 idle：应该出现以会话名为标题的系统通知。盯着那场会话、窗口也在前台：不应出现。

### 卸载

```sh
dsh plugin --profile web remove dsh-helper-plugin-notify-away
```

## 配置

所有键都可选，什么都不写就用默认值。配置在加载期校验：未知键、类型错误都会让启动直接失败，而不是默默忽略。

```yaml
- id: notify-away
  config:
    onlyWhenAway: true
    includeSubagents: false
    body: Task finished.
```

| 键 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `onlyWhenAway` | boolean | `true` | 正在看刚结束的那场会话时不弹。 |
| `includeSubagents` | boolean | `false` | 子 Agent idle 时是否也弹。 |
| `title` | string | *（会话显示名）* | 可选的固定 toast 标题。 |
| `body` | string | `Task finished.` | toast 正文。 |

覆盖配置写在 profile 自己的 `cordis.patch.yml`，或参考 [`examples/profile-patch.yml`](examples/profile-patch.yml)。补丁会**整体替换**目标行的 `config`，省略的键回落到默认值。

host 行会校验这些键，打错会在启动时失败。**浏览器半边目前用的是同一套默认值**（没有 RPC，读不到 host 行配置）。除非你只是想把文档里的默认值钉在配置里，否则把 mapping 留空即可。

## 工作原理

```text
sessions.list 快照  ──►  running → idle 边沿
                              │
                   shouldNotify(away || current !== sessionId)
                              │
          chrome.webview.postMessage  ──►  helper 系统 toast
                     或 Notification  ──►  浏览器系统横幅
                              │
                   点击  ──►  window.focus + sessions.open
```

- **离开是页面事实。** `document.visibilityState === 'hidden'` 或 `!document.hasFocus()`。host 侧没有焦点信号。
- **dsh-helper 不需要 Notification 权限。** 客户端在 WebView2 已有的页 ↔ 宿主通道上发送 `{ kind: "notify-away", title, body, sessionId, tag }`。helper 用自己的 AUMID 弹 toast；点击后聚焦该实例，并派发 `dsh-helper-notify-click`。
- **客户端包是工厂，不是 ESM 图。** Web UI 通过 `window.__ModuleLoader__.load` 加载 `client.js`。相对的 `./lib/` import 解析不了，所以 `client.js` 内联了 `lib/policy.js` 里那套已单测的策略。
- **没有安装期构建。** 因此 `link:` 与 `github:` 行为一致：host 只 import `node:` 和相对路径，也没有需要 pnpm allowlist 的 `prepare`/`postinstall`。

## 边界

- 只覆盖完成。等待审批 / `ask_user_question` 的 toast 不在这一版。
- 在系统浏览器里权限由浏览器持有：提示被拒绝后，该源上插件会保持安静。dsh-helper 面板走 `postMessage`，不受这项权限限制。
- 取消一轮也会变成 idle，所以取消的任务仍会弹出「已完成」toast。
- host 行的 `config` 会校验，但还不会推到浏览器半边。

## 兼容性

按 **dsh `0.1.5-rc.2`** 编写。用到的接缝：

| 接缝 | 用途 |
|---|---|
| host 行 `name: ./index.js` + `dsh.bundle.patch` | `link:` / `github:` 安装 |
| `package.json` 的 `dsh.client`（`platform: web`，`inject: [@deepseek-ai/dsh-client-runtime]`） | Web UI 扫描并提供 `./client` |
| 客户端 `inject: ['sessions']` | `ctx.sessions.list` 快照 + `ctx.sessions.open` |
| `chrome.webview.postMessage` | dsh-helper 面板 → 系统 toast（不需要 Notification 权限） |
| 浏览器 `Notification` API | 不在 helper 里时的回退系统横幅 |

## 测试

```sh
npm test              # node --test
npm run test:direct   # 单进程运行（适配会拦子进程的沙箱环境）
```

## 目录结构

```text
index.js                     Cordis host 插件：配置校验 + ready 日志
client.js                    ModuleLoader 工厂：离开门闩 + postMessage / Notification
cordis.patch.yml             bundle 补丁：插入 host 行
lib/config.js                配置 schema 与默认值
lib/policy.js                纯 shouldNotify / running→idle 折叠（已单测）
examples/                    profile 覆盖层与可携带的 host 行覆盖层
scripts/run-tests.mjs        单进程测试运行器
test/                        配置、策略、包形态、host 接线、client 工厂
test-support/harness.mjs     伪 Cordis ctx 与会话列表
README.md / README.zh.md     中英双语说明
```

## 许可证

MIT。
