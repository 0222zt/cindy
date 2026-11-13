# Cindy Local 离线能力与边界

本文回答三个问题:

1. 不登录 Cindy 账号,能不能对话？——能。
2. 完全断网时,哪些功能仍可用？——本地模型对话、本地会话、本地插件/技能读取、设置。
3. 遥测、心跳、更新器、云市场到底关没关？——本地 dev 模式下均不会产生有效云端上报;详见下表与代码位置。

> 适用范围:`start-dev.ps1` 启动的 **dev 本地模式**(`XDT_DESKTOP_DEV_MODE=local`)。
> 打包后的 personal runtime 行为不同,见文末「已知例外」。

---

## 1. 本地模式是怎么进入的

- 登录页点击 **跳过登录**(真实 testid:`[data-testid=login-local-mode]`)。
- 主进程 auth 状态进入本地模式(`mode = local`,无 cloud session、无 user)。
- 启动脚本 `start-dev.ps1` → `pnpm --filter desktop dev` → `scripts/dev-local-env.mjs`:
  - 设置 `XDT_DESKTOP_DEV_MODE=local`;
  - 生成并指定 `config/endpoint.local.json`,把 auth / device-link / oss / model-access / plugin 等端点指向 `localhost`;
  - 使用 `--isolated=cindy-local` 独立数据目录,不读写正式 Cindy 数据。

## 2. 网络能力矩阵

| 能力 | 本地 dev 模式 | 证据 / 代码位置 |
| --- | --- | --- |
| 账号登录 | 不需要,可跳过 | 登录页 `login-local-mode`;auth 状态 `mode=local` |
| 对话 | 可用;指向本机或任意 OpenAI 兼容端点 | `providers/*.json`、Mock 请求日志 |
| 云端心跳 | **不启动** | `apps/desktop/src/main/heartbeatService.ts`:仅 `mode === 'cloud' && isAuthenticated && user` 才启动;本地模式 `verifiedCloudUserId()` 返回 `null` |
| 统计 / TapDB | **dev 构建闸直接拒绝** | `apps/desktop/src/main/analytics-settings-store.ts`:`isReportingBuild()` 仅在 `app.isPackaged === true` 或显式 `XDT_TAPDB_DEV=1` 时为真;否则 `isAnalyticsAllowed()` 恒为 `false` |
| 隐私同意 | 跳过登录不会写入 `privacyConsentAccepted` | 同上文件:同意仅在账号登录协议门放行时写入;跳过登录被豁免,因此保持默认 `false` |
| 自动更新 | **不后台轮询** | `updateService.ts` `initUpdateService()`:`if (isDev() || isCindyPersonalRuntime()) { log.info('Dev mode — skipping background polling'); return; }`;`update-check-startup` 在 dev 直接返回 `hasUpdate:false` |
| 云端模型目录 | 使用打包的 last-known-good 预设;离线时日志降级 | `provider-service` 先尝试远端,失败后读取本地快照/内置 36 个供应商预设 |
| 云市场后台同步 | **跳过**(本项目补丁) | `plugin-market/registerIpc.ts`:本地模式下 `syncDefaultMarketPlugins` / `refreshForegroundMarketPlugins` 直接返回 `completed` |
| 云市场手动打开 | 仍会请求 `pluginApiBaseUrl`,离线报错但可恢复 | `plugin-market/api.ts`;不影响对话 |
| 设备互联 / 云同步 / 分享 / 更新下载 | 需要网络与账号,本地模式不可用 | 相关入口会提示不可用或静默失败 |
| 国内云厂商模型 | 需要外网与 API Key;不属于“完全离线” | 内置预设 + 设置页填写 Key |
| Ollama / LM Studio / vLLM | 可用(本机 HTTP) | `providers/ollama-local.json`、`providers/lmstudio-local.json` |

## 3. 完全断网时仍会看到的“无害日志”

这些请求失败不会阻塞启动或对话,属于上游为云端功能做的后台探测:

- `serverApiFetch ... path=/api/plugins`:仅在手动打开插件页时出现;后台同步已在本地模式禁用。
- `serverApiFetch ... path=/api/device-link/devices`:设备互联探测。
- `Chat group action failed { code: 'AUTH_REQUIRED' }`:本地模式没有云端身份。
- `releaseNotesService HTTP 404 ...`:更新公告探测。
- `provider-service remote catalog read/parse failed, trying fallback`:随后会使用本地预设。

如果希望演示时日志更干净,可以:

```powershell
# 只看与对话相关的日志
Get-Content C:\cindy-local\dl\dev2.log -Encoding UTF8 |
  Select-String -Pattern "maker|pi|localDb|Mock|ERROR" |
  Select-Object -Last 40
```

## 4. 如何自证“没有联网上报”

1. **Mock 只监听回环地址**:

   ```powershell
   Get-NetTCPConnection -State Listen -LocalPort 11435 |
     Select-Object LocalAddress,LocalPort,OwningProcess
   ```

   预期 `LocalAddress` 为 `127.0.0.1`。

2. **心跳没有启动**:在 `dev2.log` 中搜索 `heartbeat client started`,本地模式应无结果。

3. **更新器跳过后台轮询**:日志应包含:

   ```text
   [updateService] Dev mode — skipping background polling
   ```

4. **统计构建闸**:日志应包含:

   ```text
   [INFO ] [maker/analytics-settings-store] analytics build gate evaluated
     packaged : false
     devOptIn : false
   ```

   且不会出现有效上报请求。

5. **对话请求只到本机**:

   ```powershell
   Get-Content C:\Users\35345\Documents\默认项目\cindy-local\mock\mock-requests.jsonl -Encoding UTF8 -Tail 1
   ```

6. **真实模型确实在本机推理**:接 Ollama 时,请求地址是 `http://127.0.0.1:11434/v1/chat/completions`。
   `ollama ps` 显示 `qwen2.5:7b` 以 `100% GPU`、4096 上下文加载,说明回答来自本机显卡,
   不是云端转发。截图 `C:\cindy-local\dl\ui-30.png` 记录了这条链路的一次完整对话;
   复现步骤见 `ACCEPTANCE.md`。Mock 只用来验证协议链路,判断「有没有联网」应以真实模型
   这条链路为准。

## 5. 数据留在哪里

- 应用数据(DB、设置、日志):
  `C:\Users\35345\AppData\Roaming\CindyGlobal-dev2-cindy-local\`
- 会话数据库:`cindy-local-v1.db`
- Mock 请求证据:
  `C:\Users\35345\Documents\默认项目\cindy-local\mock\mock-requests.jsonl`
- 源码构建树:`C:\cindy-local\src\cindy-main`

`--isolated=cindy-local` 会生成 `CindyGlobal-dev2-cindy-local` 目录;不带该参数时,dev 会命中正式 `CindyGlobal` 数据并可能触发 `MIGRATE_FAILED` 保护,**不要省略**。

## 6. 已知例外(需要在打包版复核)

- `isCindyPersonalRuntime()` 只有在从 `cindy-versions/...` 版本目录启动时才为真。
- 如果直接把 personal runtime 的安装包从任意目录启动,更新器可能不会走“personal runtime 跳过”分支。本交付的对话链路以 dev 源码模式验收,打包安装版的更新器行为需在发布前单独验证。
- 手动打开插件市场仍会访问云端;本项目的补丁只关闭了后台自动同步,没有删除插件市场 UI。
- 安装包是**版本无关包**(`0.0.0`,不参与热更新)。为了让没有 Rust 工具链的机器也能打出包,
  补丁 5 跳过了可选 Windows helper 的编译,补丁 7 让 `better-sqlite3` 复用已备好的 Electron ABI
  预编译件。这些改动只影响打包流程,不改变运行时对云服务的判断;但「打包版完全断网」目前
  还没有像 dev 模式这样逐项跑过日志取证,属于待复核项。

## 7. 相关代码索引

| 主题 | 文件 |
| --- | --- |
| 本地端点生成 | `scripts/shared/endpoint-local-file.mjs`、`apps/desktop/scripts/dev-local-env.mjs` |
| 心跳边界 | `apps/desktop/src/main/heartbeatService.ts` |
| 统计闸 | `apps/desktop/src/main/analytics-settings-store.ts` |
| 更新器 | `apps/desktop/src/main/updateService.ts` |
| 云市场后台同步 | `apps/desktop/src/main/plugin-market/registerIpc.ts` |
| 隔离数据目录 | `apps/desktop/src/main/devCliFlags.ts`、`cindy-make/versionStore.ts` |
