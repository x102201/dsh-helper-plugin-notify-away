# dsh-helper-plugin-notify-away

[English](README.md) | 中文

![license: MIT](https://img.shields.io/badge/license-MIT-blue)
![dsh: 0.1.5-rc.2](https://img.shields.io/badge/dsh-0.1.5--rc.2-4b32c3)
![tests: 83 passing](https://img.shields.io/badge/tests-83%20passing-brightgreen)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）用的 **系统通知**插件：仿照 Cursor 的 Agent toast——你正在看刚结束或卡住的那场会话时保持安静，切到别的窗口才弹出系统通知。

**为什么需要它**：一轮 `dsh` 跑得久，人很容易切去干别的。人还在看的时候，侧栏自己的绿色 done 点已经够用。这个插件覆盖另一种情况——你不在看。在 dsh-helper 里通过 `chrome.webview.postMessage` 让宿主弹系统 toast；在系统浏览器里回退到 `Notification` API。

**用起来是什么样**：开一个任务，切到别的应用、标签或 helper 实例。根会话变成 idle，或停下来等你时，会弹出以该会话为标题的 toast。点它会聚焦 Web UI 并打开那场会话。如果你本来就在这个实例里看那场，则什么都不弹。

```text
正在看这场会话，就在这个实例     安静
别的实例 / 别的窗口 / 别的标签  系统通知
                               （结束了，或卡住等你）
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
| 等待边沿 | `uiSession.pendingInteractions` 里那场会话新出现一条请求时触发。等待期间 `running` 仍为 true，所以只看完成边沿会漏掉。已知种类：审批、提问、计划待审。以后新加的种类同样会弹（`otherWait`）。每种都可以在配置里关掉。 |
| 离开门闩 | 只在你正在看**这个实例里的那场**会话时保持安静：面板在屏幕上、helper 在前台、且 `list.current` 对得上。隐藏标签、另一个实例、窗口失焦、或后台会话结束 / 卡住 → 弹 toast。 |
| 根会话 | 子 Agent 行（`origin: 'subagent'` 或带 `parentId`）被忽略，避免并行子任务刷屏。 |
| 权限 | 在 dsh-helper 里不需要。在系统浏览器里：第一次点击或按键时申请（Safari 只接受手势里的申请）。 |
| 去重 | 每条 toast 带 `notify-away:<sessionId>` 标签，重复的会替换上一条而不是堆叠。 |
| 点击 | 聚焦窗口，并调用 `ctx.sessions.open(sessionId)`。helper 点回来走 `dsh-helper-notify-click` 事件。 |

插件**不写任何自有会话事件类型**。它只读侧栏用的那份会话列表快照和 pending-interaction 表。它不回答审批或提问瀑布。

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

然后在 Web 界面开一个任务，切到别的窗口，等到 idle 或卡住等人：应该出现以会话名为标题的系统通知。盯着那场会话、窗口也在前台：不应出现。

### 卸载

```sh
dsh plugin --profile web remove dsh-helper-plugin-notify-away
```

## 配置

所有键都可选，什么都不写就用默认值（每种通知**全开**）。**改这些开关请走 设置 → 插件 → 插件配置**，本插件会出现一张 **离开时通知** 卡片，每种通知一个勾选框。

host 行也会在加载时校验同一组键（未知键、类型错误会让启动失败）。补丁可以钉住部署默认值；设置页把用户覆盖写进 `$DSH_HOME/settings.yaml`，保存后立刻生效。

```yaml
- id: notify-away
  config:
    onlyWhenAway: true
    includeSubagents: false
    body: Task finished.
    completion: true
    approval: true
    question: true
    planReview: true
    otherWait: true
```

| 键 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `onlyWhenAway` | boolean | `true` | 正在看刚结束的那场会话时不弹。 |
| `includeSubagents` | boolean | `false` | 子 Agent idle 时是否也弹。 |
| `title` | string | *（会话显示名）* | 可选的固定 toast 标题。 |
| `body` | string | `Task finished.` | 完成事件的 toast 正文。 |
| `completion` | boolean | `true` | 会话 `running → idle` 时弹。取消一轮也会 idle。 |
| `approval` | boolean | `true` | pending 种类 `approval`。 |
| `question` | boolean | `true` | pending 种类 `question`。 |
| `planReview` | boolean | `true` | pending 种类 `plan-review`。 |
| `otherWait` | boolean | `true` | 侧栏尚未命名的后续 pending 种类。 |

省略某个种类（或写成 `true`）表示继续弹；写成 `false` 只关掉那一种。

覆盖配置写在 profile 自己的 `cordis.patch.yml`，或参考 [`examples/profile-patch.yml`](examples/profile-patch.yml)。补丁会**整体替换**目标行的 `config`，省略的键回落到默认值。

设置页才是运行时开关：host 用 `installSection('notify-away')` 登记 namespace，浏览器半边注册 `settings.plugin.item` 卡片。保存写入用户层，不是 cordis 行。`window.__dshHelperNotifyAway` 仍可作为压过它们的紧急覆盖。

卡片要显示出来，三件事都得成立：host 的 namespace 必须被 `settings.describe` 提供（登记过就会）；卡片 store 必须给 React 一个**引用稳定**的快照——渲染器是通过 `useSyncExternalStore` 绑它的，每次调用都新建对象的 store 会一直重渲染到 React 抛错，随后插槽的 error boundary 把卡片藏掉，控制台会打 `slot entry crashed in 'settings.plugin.item'`；注册卡片的那条 fiber 只 inject 了 `slots` 和 `settingsScope`，所以它碰到的每个「环境服务」都必须用非严格访问器 `ctx.get(name)` 读——cordis 对 `ctx.locale` 会直接抛 `cannot get property "locale" without inject`，而这行在 `slots.register` 之前，一抛就完全没有卡片（控制台里那条报错就是唯一线索）。

## 工作原理

```text
sessions.list 快照                    ──►  running → idle 边沿
uiSession.pendingInteractions         ──►  新的等待 key（审批 / 提问 / …）
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

- 完成和等待共用同一条会话 toast 标签，后到的会替换前一条而不是堆叠。
- 在系统浏览器里权限由浏览器持有：提示被拒绝后，该源上插件会保持安静。dsh-helper 面板走 `postMessage`，不受这项权限限制。
- 取消一轮也会变成 idle，所以取消的任务仍会弹出「已完成」toast，除非关掉 `completion`。
- 等待 toast 的文案暂不可配。

## 兼容性

按 **dsh `0.1.5-rc.2`** 编写。用到的接缝：

| 接缝 | 用途 |
|---|---|
| host 行 `name: ./index.js` + `dsh.bundle.patch` | `link:` / `github:` 安装 |
| `package.json` 的 `dsh.client`（`platform: web`，`inject: [@deepseek-ai/dsh-client-runtime, @deepseek-ai/dsh-client-ui-settings-plugins]`） | Web UI 扫描并提供 `./client`，排在「插件」设置分区声明 `settings.plugin.item` 之后 |
| 客户端 `inject: ['sessions']` | `ctx.sessions.list` 快照 + `ctx.sessions.open`；等待 watcher 挂到 `ctx.uiSession.pendingInteractions` |
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
lib/schema.js                设置 namespace 的 schema（从 profile 解析 schemastery，否则用回退实现）
lib/policy.js                纯 shouldNotify / running→idle / 等待 key 折叠（已单测）
examples/                    profile 覆盖层与可携带的 host 行覆盖层
scripts/run-tests.mjs        单进程测试运行器
test/                        配置、策略、包形态、host 接线、client 工厂
test-support/harness.mjs     伪 Cordis ctx 与会话列表
README.md / README.zh.md     中英双语说明
```

## 许可证

MIT。
