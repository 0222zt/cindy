# Cindy Local 验收记录

本文件给出可复现的验收路径,以及在当前机器上已经跑通的证据。

- 目标:不登录 Cindy 账号、不填云端 API Key,在本机完成一次真实模型对话。
- 已跑通的两条链路:
  1. **真实模型**:Ollama + `qwen2.5:7b`,100% GPU 推理。
  2. **协议桩**:零依赖 Mock OpenAI 服务,用来单独验证界面 → 请求 → 流式回复。
- 结论:**通过**。

---

## 1. 前置条件

| 项 | 当前机器 |
| --- | --- |
| 源码树 | `C:\cindy-local\src\cindy-main` |
| 便携 Node | `C:\cindy-local\node22\node.exe`(v22.22.3) |
| pnpm | 10.34.9 |
| Electron | 42.11.12 |
| 运行资产 | claude 2.1.321 / codex-package 0.166.0 / ripgrep 15.2.0 / pi 1.5.0 |
| 数据目录 | `C:\Users\35345\AppData\Roaming\CindyGlobal-dev2-cindy-local` |
| 本地模型 | Ollama 0.40.16 + `qwen2.5:7b`(4.7 GB) |
| 硬件 | Ryzen 7 8840HX / 16 GB RAM / RTX 5060 Laptop 8 GB |

依赖与资产检查(如需重装):

```powershell
$env:PATH = 'C:\cindy-local\node22;' + $env:PATH
Set-Location C:\cindy-local\src\cindy-main
pnpm ensure-deps
pnpm --filter desktop ensure-dev-runtime-assets
```

## 2. 启动本地模型

```powershell
ollama pull qwen2.5:7b
ollama list
ollama ps
```

预期 `ollama ps` 能看到模型加载在 GPU 上:

```text
NAME          ID              SIZE      PROCESSOR    CONTEXT
qwen2.5:7b    845dbda0ea48    4.8 GB    100% GPU     4096
```

> 本机 8 GB 显存,`qwen2.5:7b` 用 4096 上下文刚好落在 GPU 上。命令行 `ollama run`
> 默认会开到更大的上下文,可能报 `out of memory`;Cindy 走 OpenAI 兼容接口,
> 默认上下文是 4096,正常。

## 3. 启动 Cindy Local

```powershell
Set-Location C:\Users\35345\Documents\默认项目\cindy-local
powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
```

启动成功的标志(`C:\cindy-local\dl\dev2.log`):

```text
[cindy] dev isolated deviceId → dev-cindy-local-...
[updateService] Dev mode — skipping background polling
[localDb] {"event":"localDb.ensureReady.ok",...}
```

> `--isolated=cindy-local` 已固定在 `start-dev.ps1`。不要去掉,否则会命中正式
> `CindyGlobal` 数据库并触发 `MIGRATE_FAILED`。

## 4. 配置供应商

两个入口任选:

- **Ollama(推荐)**:设置 → 模型供应商 → 添加供应商 → 选 **Ollama**。应用会检测本机
  `127.0.0.1:11434` 并列出已安装模型,打开 `千问 2.5:7b` 的开关即可。
- **自定义**:添加自定义供应商,Base URL 填 `http://127.0.0.1:11434/v1`,模型 id 填
  `qwen2.5:7b`,API Key 随便填一个非空值。

配置完成后回到新会话,在输入框右下角把模型切到 **千问 2.5:7b**。

## 5. 执行验收对话

发送:

```text
请只回复四个字:本地模型成功。
```

预期回复包含:

```text
本地模型成功。
```

## 6. 实测证据(真实模型)

### 6.1 UI 截图

- 文件:`C:\cindy-local\dl\ui-30.png`
- 内容:用户消息 `请只回复四个字:本地模型成功。`,助手回复 `本地模型成功。`;
  输入框右下角显示模型 `千问 2.5:7b`。
- 截图时间:2026-11-13 14:05(+08:00)。

### 6.2 模型运行状态

```powershell
ollama ps
```

```text
NAME          ID              SIZE      PROCESSOR    CONTEXT    UNTIL
qwen2.5:7b    845dbda0ea48    4.8 GB    100% GPU     4096       4 minutes from now
```

`PROCESSOR=100% GPU` 说明推理确实发生在本机显卡上,不是云端转发。

### 6.3 请求路径

- Cindy 请求 `http://127.0.0.1:11434/v1/chat/completions`。
- Ollama 监听 `127.0.0.1:11434`,不监听公网地址。
- 会话记录在隔离数据目录的 `cindy-local-v1.db`。

## 7. Mock 链路(可选,用于排查)

没有本地模型时,可以用 Mock 单独验证协议链路:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-mock.ps1
```

监听 `http://127.0.0.1:11435/v1`,请求写入 `mock\mock-requests.jsonl`。

历史证据:

- 截图 `C:\cindy-local\dl\ui-21.png`:回复 `本地模式成功`。
- 日志最后一条 `2026-11-13T05:00:58.855Z`:`userText` 逐字等于验收句,请求为
  `system + user`、`stream=true`、`model=cindy-local-mock`。

Mock 只做协议桩,不代表模型能力;真实回答以第 5、6 节为准。

## 8. 打包验收(版本无关安装包)

### 8.1 命令与产物

```powershell
$env:PATH = 'C:\cindy-local\node22;' + $env:PATH
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
Set-Location C:\cindy-local\src\cindy-main\apps\desktop
node scripts/package-desktop.mjs --no-sign --skip-smoke
```

- 产物:`release\artifacts\global\unversioned\win32-x64\cindy-unversioned-Setup.exe`
- 大小:378,498,547 字节(约 361 MB)
- SHA-256:`7f42dfa3953fa49075c138f501d08e766e23c505e32fc6efdc255f944666b514`
- 伴随 `build-info.json`:`version: null`、`versionless: true`、`region: global`、
  `schemaVersionMax: 149`、签名状态 `installerSigned: false`(`--no-sign`,预期行为)。

### 8.2 打包日志证据(`C:\cindy-local\dl\package-full.log`)

- `versionless build — skip cindy-updater.exe (no Rust toolchain; feature degrades gracefully)`:
  补丁 5 生效。
- `versionless build — reuse cached Electron 42.11.12 better-sqlite3 binding (12.11.1)`:
  补丁 7 生效,未触发 node-gyp / MSVC 依赖。
- packaged `resources\cindy-source.json` 内容为
  `{"sourceCommit":"local-source-tarball","builtAt":"2026-11-13T17:10:19.567+08:00"}`:
  补丁 6 生效(校验由收尾脚本完成,见 8.3)。
- NSIS 阶段 `building target=nsis file=dist\Cindy Setup 0.0.0.exe` 完成、
  block map 生成:安装包本体构建成功。

### 8.3 已知偏差(如实记录)

- 本机宿主环境(WorkBuddy 沙箱)的批量删除拦截器拦下了 NSIS maker 对
  `out\make\nsis\x64-tmp`(855 个文件的解包临时目录)的收尾清理,make 进程在
  「安装包已产出、清理临时目录」这一步报错退出,未自动走到归集步骤。
- 处理方式:不删除任何文件,用 `C:\cindy-local\dl\finish-package.mjs`(复用仓库
  `package-lib.mjs` / `ci/lib.mjs` 的校验与组装函数)手动完成校验、归集和
  `build-info.json` 生成。校验全部通过:packaged `cindy-source.json`、drizzle 资源、
  system-skills 版本记录。
- 残留:`out\make\nsis\x64-tmp` 目录仍在磁盘上(约 700 MB),确认产物可用后可手动删除。
- `--skip-smoke`:安装包未做装后启动冒烟,dev 模式的启动验收见第 3—6 节。

## 9. 验收检查清单

- [x] 不登录 Cindy 账号即可进入应用。
- [x] 供应商指向 `127.0.0.1`,对话不经过 Cindy 云。
- [x] 本地模型在 GPU 上实际推理(`ollama ps` 100% GPU)。
- [x] 回复内容与用户问题匹配,不是固定回显。
- [x] 首条用户消息完整到达模型,没有前缀污染。
- [x] 流式回复在 UI 正常渲染。
- [x] 数据写入隔离目录,不碰正式 Cindy 数据。
- [x] dev 日志显示更新器跳过后台轮询。
- [x] 本地模式日志中没有 `heartbeat client started`。
- [x] 版本无关安装包产出,SHA-256 与 `build-info.json` 一致。
- [x] 打包日志显示跳过 cindy-updater、复用 Electron ABI sqlite 二进制。
- [x] packaged 目录内 `cindy-source.json` / drizzle / system-skills 校验通过。
- [ ] 安装包装后冒烟(`--skip-smoke` 跳过,发布前需单独验证安装、启动与更新器行为)。

## 10. 失败时怎么排查

| 现象 | 检查 |
| --- | --- |
| 应用启动报 `MIGRATE_FAILED` | 是否漏了 `--isolated=cindy-local` |
| Ollama 供应商没出现 | `ollama list` 是否有模型;`Get-NetTCPConnection -LocalPort 11434` 是否在听 |
| 发送后报 out of memory | 显存不够;换更小的模型或把上下文降到 4096 |
| 模型列表为空 | Base URL 是否带 `/v1`;API Key 是否为空 |
| 回复是 Mock 文案 | 模型选择器还停在 `Cindy Local Mock` |
| CDP 截图超时 | 重试一次;`Page.captureScreenshot` 偶发 30s 超时 |

## 11. 本次验收使用的命令

```powershell
# 1. 本地模型
ollama pull qwen2.5:7b
ollama ps

# 2. 桌面端
powershell -ExecutionPolicy Bypass -File C:\Users\35345\Documents\默认项目\cindy-local\start-dev.ps1

# 3. 通过 CDP 读取/截图(可选)
$env:PATH = 'C:\cindy-local\node22;' + $env:PATH
node C:\Users\35345\Documents\默认项目\cindy-local\tools\cdp.mjs targets
node C:\Users\35345\Documents\默认项目\cindy-local\tools\cdp.mjs shot C:\cindy-local\dl\ui-30.png

# 4. 打包(版本无关安装包)
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
node C:\cindy-local\src\cindy-main\apps\desktop\scripts\package-desktop.mjs --no-sign --skip-smoke
# make 阶段被临时目录清理拦截时,用收尾脚本补齐归集(不删除任何文件):
node C:\cindy-local\dl\finish-package.mjs
```
