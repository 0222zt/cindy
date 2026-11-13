# Cindy Local 改动清单(thin fork)

本分支只改会挡住「无账号 / 离线 / 首次可验收」的地方。Agent Loop、数据库 migration、
供应商预设和 UI 结构都不动,方便跟着上游 rebase。

源码补丁统一用 `FORK(cindy-local):` 注释标记;`tools/pi/latest.json` 和
`tools/ripgrep/latest.json` 是元数据,用 `forkNote` 字段说明。`patches/cindy-local.patch`
是这份清单对应的统一补丁,在上游仓库根目录 `git apply -p1` 即可应用。

---

## 1. 补丁总览

| # | 文件 | 类型 | 目的 |
| --- | --- | --- | --- |
| 1 | `apps/desktop/src/main/plugin-market/registerIpc.ts` | 运行时补丁 | 本地模式跳过云端插件市场后台同步,消除离线重试日志 |
| 2 | `tools/pi/latest.json` | 资产元数据 | 把 pi 固定到实际内置的 1.5.0,避免启动时资产校验失败 |
| 3 | `tools/ripgrep/latest.json` | 资产元数据 | 把 ripgrep 固定到内置的 15.2.0 |
| 4 | `apps/desktop/scripts/validate-migrations.mjs` | 打包补丁 | 源码以 tarball 交付、没有 `.git` 时,用固定 SHA256 基线完成 migration 内容校验 |
| 5 | `apps/desktop/forge.config.ts` | 打包补丁 | 版本无关包(0.0.0)不构建永不执行的 `cindy-updater.exe` 等可选 Rust helper,并同步从 extraResource 清单里移除 |
| 6 | `apps/desktop/forge.config.ts` | 打包补丁 | 没有 `.git` 时写入可诊断的源码身份,避免打包产物校验失败 |
| 7 | `apps/desktop/forge.config.ts` | 打包补丁 | 版本无关包复用已备好的 Electron ABI `better_sqlite3.node`,避开没有 MSVC 时的源码重编 |

除此之外,`config/endpoint.local.json` 是启动脚本生成的**运行期文件**,不属于源码补丁;
`node_modules`、Electron 二进制、运行时资产是环境准备,不属于 fork。

## 2. 补丁 1:本地模式跳过插件市场后台同步

**文件**:`apps/desktop/src/main/plugin-market/registerIpc.ts`

**改动**:

```ts
// FORK(cindy-local): 本地离线模式没有云端插件市场;跳过后台目录同步,
// 避免完全断网时每轮重试 /api/plugins 产生日志噪音。
if (process.env.XDT_DESKTOP_DEV_MODE === 'local') return 'completed';
```

插入位置:

- `syncDefaultMarketPlugins()` 开头(覆盖 owner-ready / resume / periodic / background 触发);
- `refreshForegroundMarketPlugins()` 开头(覆盖前台刷新触发)。

**原因**:本地模式使用 `config/endpoint.local.json`,`pluginApiBaseUrl` 指向
`http://localhost:3343`。插件服务没启动时,上游会周期性请求 `GET /api/plugins`,每轮都打
`serverApiFetch.redacted_network_error`。这不影响对话,但对「离线可用」的演示是噪音,也容易
被误认为应用在联网。

**没有做什么**:没有删插件市场 UI,没有改 IPC handler。手动打开插件页仍会请求云端并按上游
逻辑失败,这是预期行为。

**验证**:

```powershell
Select-String -Path C:\cindy-local\dl\dev2.log -Pattern "/api/plugins" -Encoding UTF8
Select-String -Path C:\cindy-local\dl\dev2.log -Pattern "endpoint manifest" -Encoding UTF8
```

第 1 条应无输出(或仅在手动打开插件页后出现),第 2 条确认本地模式标记存在。

## 3. 补丁 2:pi 固定在 1.5.0

**文件**:`tools/pi/latest.json`

**改动**:`version` / `tag_name` / `name` / `published_at` 与官方 `v1.5.0` 发布一致;
`runtimeAssets` 的 6 个平台 URL、`sha256`、`size` 全部改为 v1.5.0 的值;增加 `forkNote`
说明「内置离线运行时是 pi 1.5.0」。

**原因**:实际内置的 pi 运行时是 1.5.0,上游 `latest.json` 可能指向更高版本。启动时
`assertPinnedRuntimeAsset` 会校验 `cache.version === version` 且 URL 匹配,版本不一致会直接
失败。固定到实际版本后,首次启动不再尝试联网升级 pi。

**验证**:

```powershell
Get-Content C:\cindy-local\src\cindy-main\tools\pi\latest.json -Encoding UTF8 | ConvertFrom-Json |
  Select-Object version,tag_name
```

预期 `version=1.5.0`、`tag_name=v1.5.0`。

## 4. 补丁 3:ripgrep 固定在 15.2.0

**文件**:`tools/ripgrep/latest.json`

**改动**:`version` / `tag_name` / `name` 固定为 `15.2.0`;增加 `forkNote`,说明 ripgrep
来自内置 codex-package,不单独下载。

**原因**:离线环境不能依赖 GitHub 下载;内置 codex-package 已带 rg 15.2.0,元数据必须与内置
版本一致,避免启动时触发下载或校验失败。

**验证**:

```powershell
Get-Content C:\cindy-local\src\cindy-main\tools\ripgrep\latest.json -Encoding UTF8 | ConvertFrom-Json |
  Select-Object version,tag_name
```

预期 `version=15.2.0`。

## 5. 补丁 4:没有 `.git` 时的 migration 冻结校验

**文件**:`apps/desktop/scripts/validate-migrations.mjs`

**改动**:`validateMigrationFreeze()` 抛出的错误如果是「不是 Git 仓库」,不再直接判失败,
而是读取 `drizzle/migration-baseline.json`,逐个比对 80 条 migration SQL 和 23 条 runtime
script 的 SHA256;Git 侧的增量基线(main / PR base)跳过。只要目录里有 `.git`,仍然走原逻辑,
改写历史 migration 依旧会 fail closed。

**原因**:这次交付的源码是 tarball 解压出来的,没有 Git 历史。`package-desktop.mjs` 打包前会
跑 `db:validate`,第 6 步依赖 `git rev-parse`,在没有 `.git` 时直接中断打包。内容哈希本身不依赖
Git,能覆盖「改了历史 SQL」这类真正的风险。

**验证**:

```powershell
Set-Location C:\cindy-local\src\cindy-main\apps\desktop
node scripts/validate-migrations.mjs
```

预期最后两行是 `step 6/6 ok — 固定 SHA256 基线冻结 80 条 migration SQL + 23 条 runtime script…`
和 `✅ migration validation passed`。

## 6. 补丁 5:版本无关包跳过可选 helper 编译

**文件**:`apps/desktop/forge.config.ts`

**改动**:新增 `skipOptionalRustHelperForVersionless()`:`APP_VERSION=0.0.0`、目标产物不存在、
机器上也没有 cargo 时,跳过依赖 Rust 的 Windows 辅助程序编译——`cindy-updater.exe`、任务栏
addon、原子重命名 helper、游戏手柄/micro 输入 helper、Fn 语音监听、框选截图 helper。每处跳过
都会打印一行 `versionless build — skip ...`。

**原因**:版本无关包在运行时会整条跳过更新链(`isVersionlessAppVersion()`),
`cindy-updater.exe` 不会被拉起;其余 helper 在缺失时都有降级路径(截图照常、语音/手柄功能
关闭),不影响对话和文件操作。上游编译这些需要 Rust + MSVC + Windows SDK,为了几个可选二进制
装几 GB 依赖不划算。

同一处改动还包括 `extraResourcesForTarget()`:上游在 Windows 上无条件把
`resources/cindy-updater.exe` 列进 `extraResource`。只跳过编译、不去掉清单,
electron-packager 会在复制资源时报
`ENOENT: lstat '...\resources\cindy-updater.exe'`,整包失败。现在版本无关包且该文件确实
不存在时才省略它;`windows-installation-version.ps1` 和 app-local VC++ Runtime 仍照常打进包。

**没有做什么**:正式版本号打包行为不变,仍会硬失败而不是发一个缺 helper 的包;不伪造二进制,
缺就是缺,日志和文档里写明。

**验证**:打包日志里应出现
`[forge:prePackage] versionless build — skip cindy-updater (auto-update disabled)`,
且不再出现 `ENOENT ... cindy-updater.exe`。

## 7. 补丁 6:没有 Git 时仍能写出可诊断的源码身份

**文件**:`apps/desktop/forge.config.ts` 的 `stageCindySourceMetadata()`

**改动**:

```ts
// FORK(cindy-local): tarball 交付没有 .git,上游这里会写空 sourceCommit,
// 随后 verifyPackagedSourceMetadata 以「空值」拒绝产物。写一个明确的占位值,
// 让诊断信息仍然说明包来自本地源码树;有 Git 时照旧写真实 commit。
const sourceCommit = resolveSourceCommit() || 'local-source-tarball';
```

**原因**:上游在 `prePackage` 阶段用 `git rev-parse HEAD` 生成
`resources/cindy-source.json`,让安装包能说明自己来自哪次提交。tarball 交付没有 `.git`
时,`sourceCommit` 为空;打包完成后 `verifyPackagedSourceMetadata()` 会因为空值直接拒绝产物。
写一个明确的占位值,既不伪造提交哈希,也让诊断信息能区分「本地源码包」和正式构建。有 Git
时行为与上游完全一致。

**没有做什么**:没有改动校验逻辑本身,`sourceCommit` 非空、`builtAt` 可解析、与预期提交一致
这几项检查原样保留;没有伪造 commit。

**验证**:

```powershell
Get-Content C:\cindy-local\src\cindy-main\apps\desktop\resources\cindy-source.json -Encoding UTF8
```

预期 `sourceCommit=local-source-tarball`、`builtAt` 为合法时间;打包日志应出现
`verified packaged source metadata: local-source-tarball`。

## 8. 补丁 7:复用 Electron ABI 的 better-sqlite3 预编译件

**文件**:`apps/desktop/forge.config.ts` 的 `tryUseCachedElectronSqlite()` 与
`rebuildNativeDepsInPackage()`

**改动**:上游在 `afterCopy` 阶段对 packaged app 里的 `better-sqlite3` 强制调用
`@electron/rebuild`。本机没有 MSVC / Windows SDK,`node-gyp` 会直接报
`Could not find any Visual Studio installation to use`,打包停在 `Finalizing package`。

版本无关包(`APP_VERSION=0.0.0`)现在先找 `ensure-deps` 准备好的缓存:

```text
node_modules/.xdt-electron-native/
  electron-<electronVersion>-<platform>-<arch>-better-sqlite3-<moduleVersion>/
    .xdt-native-marker.json
    node_modules/better-sqlite3/build/Release/better_sqlite3.node
```

标记文件里的 `moduleVersion` / `electronVersion` / `platform` / `arch` 必须与本轮打包
全部一致,才把这份 `.node` 复制进 packaged app。命中后不再把 `better-sqlite3` 放进
`onlyModules`,也就不会触发 `node-gyp`;缓存缺失、标记不匹配或打包的是正式版本号时,
仍然走上游原路径重编,不静默降级。`node-pty` 的处理完全不变。

**为什么可以复用**:`betterSqliteFactory.ts` 本来就设计了
`XDT_BETTER_SQLITE3_NATIVE_BINDING` 和 `.xdt-electron-native` 缓存,dev 模式一直靠它加载
Electron ABI 的二进制。`ensure-deps` 生成缓存时写入标记,说明这份二进制就是为当前
Electron / 平台 / 架构准备的。本机另外验证过:该 `.node` 在 Node ABI 下加载失败、
在 `ELECTRON_RUN_AS_NODE=1` 的 Electron 下加载成功。

**验证**:

```powershell
Select-String -Path C:\cindy-local\dl\package-full.log -Pattern "reuse cached Electron|rebuilding native" -Encoding UTF8
```

预期出现 `versionless build — reuse cached Electron 42.11.12 better-sqlite3 binding (12.11.1)`,
不出现 `rebuilding native modules (better-sqlite3)`。打包完成后
`out\Cindy-win32-x64\resources\app.asar.unpacked` 里应有 `better_sqlite3.node`。

## 9. 环境准备(不是源码补丁)

这些改动只存在于本机环境,不会出现在上游源码 diff 里:

| 项 | 做法 |
| --- | --- |
| 便携 Node | `C:\cindy-local\node22`(v22.22.3) |
| 包管理器 | pnpm 10.34.9 |
| 镜像 | npmmirror(registry / Electron / better-sqlite3 预编译包) |
| 依赖安装 | `pnpm install --ignore-scripts` 后补跑需要的安装脚本 |
| better-sqlite3 | 同时部署 Node ABI `node-v127` 与 Electron ABI `electron-v146` |
| Electron | 42.11.12 二进制 |
| 运行时资产 | claude 2.1.321、codex-package 0.166.0、ripgrep 15.2.0、pi 1.5.0 |
| 数据隔离 | 启动参数 `--isolated=cindy-local` |
| 本地端点 | `scripts/dev-local-env.mjs` 生成 `config/endpoint.local.json` |

检查命令:

```powershell
$env:PATH = 'C:\cindy-local\node22;' + $env:PATH
Set-Location C:\cindy-local\src\cindy-main
pnpm ensure-deps
pnpm --filter desktop ensure-dev-runtime-assets
```

## 10. 明确没有改的部分

- `packages/maker-core` 的 Agent Loop;
- 数据库 schema / migration(仍由上游 migration 管理;当前沙箱 `currentVersion=149`、`pendingCount=0`);
- 36 个内置供应商预设;
- 登录页、设置页、会话 UI;
- 上游遥测/心跳/更新器代码(本地模式本来就不会启用,见 `OFFLINE.md`)。

## 11. 如何找到所有本地补丁

```powershell
Set-Location C:\cindy-local\src\cindy-main
Get-ChildItem apps,packages,tools -Recurse -File -Include *.ts,*.tsx,*.mjs,*.json |
  Where-Object { $_.FullName -notmatch "\\node_modules\\" } |
  Select-String -Pattern "FORK\(cindy-local\)" |
  ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }
```

当前应命中 3 个文件、9 处注释:`registerIpc.ts` 2 处、`validate-migrations.mjs` 1 处、
`forge.config.ts` 6 处。两个 `latest.json` 用 `forkNote` 字段标记,不在这条命令的结果里。

## 12. 跟随上游 rebase 的步骤

1. 用上游新 tarball 覆盖 `C:\cindy-local\src\cindy-main`(保留本文件、`patches/`、
   `providers/`、`mock/` 这些交付层)。
2. 重新执行第 9 节的环境准备。
3. 用 `git apply -p1 patches/cindy-local.patch` 重新应用七个补丁:
   - 若上游已修复插件市场后台重试,可删除补丁 1;
   - 若上游已把 pi / ripgrep 元数据固定到内置版本,可删除对应补丁;
   - 若打包机有 Rust 工具链,可删除补丁 5;
   - 若打包机有 MSVC / Windows SDK,可删除补丁 7;
   - 若源码树带 `.git`,补丁 4 和 6 会自动走上游原逻辑,无需删除。
4. 重跑 `ACCEPTANCE.md` 的验收流程。
5. 检查 `dev2.log`:`ensureReady.ok`、`Dev mode — skipping background polling`、无
   `heartbeat client started`。

## 13. 风险与边界

- 补丁 1 依赖 `XDT_DESKTOP_DEV_MODE=local`。只有通过 `start-dev.ps1` / `dev-local-env.mjs`
  启动才生效;手工用其他方式启动 dev 不会跳过插件市场同步。
- 补丁 2/3 是元数据固定,不改变二进制;如果上游升级了内置运行时,必须同步更新
  URL / sha256 / size,否则启动校验会失败。
- 补丁 5 会让版本无关包缺少若干可选 Windows helper:自动更新、任务栏扩展、语音热键、
  手柄输入、框选截图吸附等功能降级或关闭。核心对话、文件读写不受影响;需要完整功能时
  请装 Rust + MSVC + Windows SDK 并按正式版本号打包。
- 补丁 6 只在没有 Git 历史时生效,产生的 `sourceCommit` 是占位值,不能用于追溯具体提交。
- 补丁 7 只在版本无关包且缓存标记完全匹配时生效。缓存来自本机 `ensure-deps`,换机器或升级
  Electron / better-sqlite3 后必须重新准备缓存,否则会自动回退到源码重编(需要 MSVC)。
- 本分支没有推送到 GitHub,补丁和产物都只在本机。
