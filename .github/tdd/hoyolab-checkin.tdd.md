# HoYoLAB 自动签到 TDD 证据

## 用户目标

Chrome 的 Utils 扩展每天自动检查并领取原神、崩坏：星穹铁道和绝区零的 HoYoLAB 签到奖励，不依赖 Windows 计划任务，也不保存或读取 Cookie 值。

## RED / GREEN

| 阶段 | 命令 | 结果 | 提交 |
| --- | --- | --- | --- |
| RED | `node --test utils/hoyolab-checkin.test.js` | 预期失败：生产模块尚不存在 | `80e1796` |
| GREEN | `node --test utils/hoyolab-checkin.test.js` | 10/10 通过 | `c4b76eb` |
| 弹窗 RED | `node --test utils/hoyolab-checkin.test.js` | 预期失败：状态存储与弹窗视图接口尚不存在 | `5178312` |
| 弹窗 GREEN | `node --test utils/hoyolab-checkin.test.js` | 16/16 通过 | `5e73a93` |
| 全量 | `npm test` | 115/115 通过；扩展清单验证通过 | 当前分支 |

## 保证范围

- 缺失的 09:10 / 15:10 持久化闹钟会被补建，现有闹钟不会被重复覆盖。
- 三个游戏先读取服务器 `is_sign`，未签到时才调用 `/sign`，并再次读取 `is_sign` 确认成功。
- 登录失效、HTTP、网络、格式和 API 错误均失败关闭；单个游戏失败不会阻断其余游戏。
- Manifest 只新增 `alarms`、`storage` 和 HoYoLAB API 主机权限，不申请 `cookies` 权限。
- 弹窗显示运行状态、上次和下次检查时间，可暂停两条闹钟或手动检查；持久化结果不包含服务端错误正文。
- 原生开关、实时状态区、键盘焦点和 44px 操作区通过静态与浏览器可访问性检查。

## 覆盖率与边界

`node --test --experimental-test-coverage utils/hoyolab-checkin.test.js`：行 97.57%，分支 94.23%，函数 96.15%。Lighthouse 静态快照的可访问性与最佳实践均为 100。真实 Chrome 登录态与闹钟注册需在变更合并并由现有 Utils 安装路径重新加载后验证。
