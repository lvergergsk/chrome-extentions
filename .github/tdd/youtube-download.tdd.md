# YouTube 下载按钮 TDD 证据

## 来源与用户旅程

本次没有外部计划文件，行为由已确认的 Penpot 原型和用户请求派生：

- 普通视频观看者可在分享按钮之后下载当前视频。
- Shorts 观看者可在 Share 与 Remix 之间下载当前短视频。
- 解析或下载失败时按钮显示 Retry，并允许再次尝试。

## 验证记录

| 保证 | 类型 | 命令或检查 | 结果 |
|---|---|---|---|
| 实现前测试确实失败 | RED | `node --test utils/youtube-media-core.test.js` | 因缺少 `youtube-media-core.js` 失败 |
| 普通视频与 Shorts URL 均可识别 | 单元 | `node --test utils/youtube-media-core.test.js` | PASS |
| 仅选择受信任 Googlevideo 主机上的最高画质单文件流 | 单元 | 同上 | PASS |
| 文件名不会越出 `utils-youtube` 下载目录 | 单元 | 同上 | PASS |
| manifest 同时注入 MAIN 桥接与 ISOLATED 按钮脚本 | 集成 | 同上及扩展校验器 | PASS |
| 全仓库现有行为未回归 | 回归 | `npm test` | 121/121 PASS |
| Shorts 插入点位于 Share 与 Remix 之间 | 实页 | Chrome 中检查 `TqW4zXfDdiQ` 的动作栏 | PASS |
| Shorts 解析到的 MP4 直链可分段读取 | 实页 | Chrome 中对解析 URL 请求 `Range: bytes=0-0` | HTTP 206 |

## 覆盖率与已知边界

`node --test --experimental-test-coverage utils/youtube-media-core.test.js`：行 100%，分支 86.05%，函数 100%。

下载选择当前视频可用的最高画质单文件流，保证文件内同时有视频和音频。YouTube 的更高画质通常拆分音视频；本次不引入转码器或质量选择器。

## 提交证据

- RED：`6cbe4d8 test: add YouTube download behavior spec`
- GREEN：`2382b5f feat: add YouTube video downloads`
- 边界覆盖：`5ded19f test: cover YouTube media edge cases`
