# HoYoLAB 自动签到 TDD 证据

## 用户目标

Chrome 的 Utils 扩展每天自动检查并领取原神、崩坏：星穹铁道和绝区零的 HoYoLAB 签到奖励，不依赖 Windows 计划任务，也不保存或读取 Cookie 值。

## RED / GREEN

| 阶段 | 命令 | 结果 | 提交 |
| --- | --- | --- | --- |
| RED | `node --test utils/hoyolab-checkin.test.js` | 预期失败：生产模块尚不存在 | `80e1796` |
| GREEN | `node --test utils/hoyolab-checkin.test.js` | 10/10 通过 | `c4b76eb` |
| 全量 | `npm test` | 108/108 通过；扩展清单验证通过 | 当前分支 |

## 保证范围

- 缺失的 09:10 / 15:10 持久化闹钟会被补建，现有闹钟不会被重复覆盖。
- 三个游戏先读取服务器 `is_sign`，未签到时才调用 `/sign`，并再次读取 `is_sign` 确认成功。
- 登录失效、HTTP、网络、格式和 API 错误均失败关闭；单个游戏失败不会阻断其余游戏。
- Manifest 只新增 `alarms` 和 HoYoLAB API 主机权限，不申请 `cookies` 权限。

## 覆盖率与边界

`node --test --experimental-test-coverage utils/hoyolab-checkin.test.js`：行 95.62%，分支 90.91%，函数 100%。真实 Chrome 登录态与闹钟注册需在变更合并并由现有 Utils 安装路径重新加载后验证。
