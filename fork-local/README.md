# Cindy Local

Cindy 桌面端的本地分支:不登录 Cindy 账号、不依赖外网,接上自己机器上的模型,就能把
一次真实对话跑完。

上游默认把登录、云同步、遥测和模型调用绑在 Cindy 的账号与云服务上。对国内没有账号、
或者只能在内网使用的用户来说,第一步就走不下去。这个分支只做三件事:保留原有的
登录页并允许跳过、把模型请求指向任意 OpenAI 兼容端点、在本地模式下关掉后台的云端
同步与更新。Agent Loop、工具调用和数据库 migration 都不动,方便以后跟着上游 rebase。

所有改动都留在本机,没有 fork 到 GitHub,也没有推送。

## 现在能做什么

| 能力 | 说明 |
| --- | --- |
| 无账号启动 | 登录页选择「跳过登录」进入本地模式,数据写在本机 |
| 本地模型 | Ollama、LM Studio、vLLM,或任何实现了 `/v1/chat/completions` 的服务 |
| 国内云模型 | 内置 36 个供应商预设(DeepSeek、智谱、Kimi、百炼、火山、硅基流动等),填 Key 即用,需要外网 |
| 离线运行 | 模型在本机时,断网也能完成对话;云市场、云同步等入口不可用,但不影响对话 |
| 后台安静 | 本地模式下统计与心跳强制关闭,dev 构建不轮询更新,插件市场后台同步跳过 |

## 快速开始

### 1. 启动 Cindy

开发模式(源码树 + Electron):

```powershell
powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
```

桌面双击启动:桌面上已有 **Cindy Local.cmd**,双击即等价执行上面这条命令
(启动器会在 `Documents\*\cindy-local` 下自动定位 `start-dev.ps1`,不含硬编码中文路径)。

首次启动按提示走:登录页点「跳过登录」;进入应用后在 **设置 → 模型供应商** 里添加
自己的端点;新建会话,选好 Agent 和模型即可。

> dev 模式必须带 `--isolated=cindy-local`,否则会命中正式版 `CindyGlobal` 数据库。
> 本分支的数据目录是 `C:\Users\<你>\AppData\Roaming\CindyGlobal-dev2-cindy-local`。

### 2. 接一个模型

三种常见接法,模板都在 `providers\`:

| 模型 | Base URL | 模型 id |
| --- | --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` | `ollama list` 里的名字,如 `qwen2.5:7b` |
| LM Studio | `http://127.0.0.1:1234/v1` | Local Server 里加载的模型名 |
| vLLM / 其他 | 服务实际地址 + `/v1` | 服务暴露的模型名 |

供应商名称、Base URL、模型 id 填进 **设置 → 模型供应商 → 添加自定义供应商**;API Key
对本机服务可以随便填一个非空值。

### 3. 验证

- 真实模型:`ACCEPTANCE.md` 里的 Ollama 部分记录了完整步骤和截图位置。
- 没有模型时:`start-mock.ps1` 起一个零依赖的 Mock OpenAI 服务(`127.0.0.1:11435`),
  用来验证「界面 → 请求 → 流式回复」这条链路本身是否通。Mock 只做协议桩,不代表
  模型能力。

### 4. 直接用安装包

不想从源码启动时,用已经打好的版本无关包(`0.0.0`,不参与热更新):

```text
C:\cindy-local\src\cindy-main\apps\desktop\release\artifacts\global\unversioned\win32-x64\cindy-unversioned-Setup.exe
```

`--no-sign` 构建,Windows 首次运行会弹 SmartScreen,属预期行为。包里没有 Rust 编译的
可选 helper,自动更新、语音热键、手柄输入、框选截图吸附等功能会降级或关闭;对话、
文件读写和本地模型接入不受影响。想自己重打一遍:

```powershell
$env:PATH = 'C:\cindy-local\node22;' + $env:PATH
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
Set-Location C:\cindy-local\src\cindy-main\apps\desktop
node scripts/package-desktop.mjs --no-sign --skip-smoke
```

打包会复用 `pnpm ensure-deps` 准备好的 Electron ABI `better_sqlite3.node`,不需要
MSVC。原因和边界见 `FORK-CHANGES.md` 的补丁 5、7。

## 目录

```
cindy-local/
├─ mock/               零依赖 Mock OpenAI 服务,请求日志写在 mock-requests.jsonl
├─ providers/          供应商配置模板(照着在界面里手动添加)
├─ tools/cdp.mjs       开发调试脚本:通过 CDP 截图、驱动界面
├─ start-dev.ps1       以隔离数据目录启动 dev 版
├─ start-mock.ps1      启动 Mock 服务
├─ patches/            相对上游的统一补丁与应用说明
├─ FORK-CHANGES.md     相对上游的全部改动,逐条带 FORK: 标记
├─ OFFLINE.md          离线能力矩阵与取证方法
├─ ACCEPTANCE.md       验收步骤、实测记录与证据路径
└─ DELIVERY.md         交付清单与验收结论
```

## 常见问题:发消息报 `Connection error.`

界面上出现「网络异常,服务暂时不可达」并有 `Connection error.`,先看当前会话右上/右下角
显示的是哪个模型:

| 会话类型 | 默认模型 | 连不上时怎么修 |
| --- | --- | --- |
| 左侧「Cindy」伙伴会话 | `cindy-local-mock`(`127.0.0.1:11435`) | Mock 服务没启动:双击 `start-mock.ps1`,然后点「重试」 |
| 「新建」的普通对话 | `千问 2.5:7b`(`127.0.0.1:11434`) | Ollama 没启动:`ollama serve` 或打开 Ollama 应用 |

伙伴会话的模型锁在伙伴配置里,界面上没有切换入口;想要真实模型对话,直接用「新建」
开一条普通对话(默认就是 `千问 2.5:7b`)。Mock 只做协议桩,回复是固定文案,不代表
模型能力。

## 边界

- 本地模式不提供云同步、跨设备、云市场和云模型;相关入口会提示不可用或静默跳过。
- 完全断网时,插件市场、登录、更新检查都不可用——这些本来就需要 Cindy 的服务端。
- 这是 thin-fork:只保留必要的 `FORK:` 补丁,不改 Agent Loop、不改数据库 migration,
  补丁清单见 `FORK-CHANGES.md`。
- 安装包是版本无关包(`0.0.0`),不参与热更新,也不带可选的 Rust helper。打包版的
  「完全断网」还没有像 dev 模式那样逐项跑过日志取证,见 `OFFLINE.md`。
- 分发包未签名,Windows 首次运行会弹 SmartScreen 提示,属预期行为。

## 上游与许可

基于 Cindy 桌面端源码构建,遵循上游仓库附带的许可证。本目录只包含本地增量内容:
文档、Mock 服务、供应商模板和补丁说明;上游源码与其二进制不在此目录内分发。
