# Pawchive 下载

## 已确认设计

用户于 2026-09-29 确认：按本会话展示的 Penpot `Admin` 第 5 页第 1–4 版实现。

[Penpot Admin，第 5 页](http://penpot.home.arpa/#/workspace?page-id=b8c23431-55a2-4d30-ba5c-2721dea3b2a7&file-id=1ef9ee10-a3d6-81f5-8008-850d5f000cc8&team-id=ccc38ea6-c561-809a-8008-848e26e14495)

| 版 | 当前画板 | 稳定 ID | 截图 |
| --- | --- | --- | --- |
| 1 | 01 · Author downloads · 1000 · Approved | dc250001-0000-4000-8000-000000000001 | [作者列表](pawchive-01.png) |
| 2 | 02 · Download states · 1000 · Approved | dc250001-0000-4000-8000-000000000003 | [整理、下载、失败状态](pawchive-02.png) |
| 3 | 03 · Download confirmation · 520 · Approved | dc250001-0000-4000-8000-000000000002 | [桌面确认](pawchive-03.png) |
| 4 | 04 · Download confirmation · 375 · Approved | dc250001-0000-4000-8000-000000000004 | [窄屏确认](pawchive-04.png) |

第 6 页 `06 · Utils Extension · Components`（`1c68a23e-67de-4fda-9268-712d5f6aeeff`）保存 8 个原生组件，画板内使用链接实例：

| 组件 | 主组件 ID |
| --- | --- |
| 下载全部 | e2d1bd0f-f2fb-4344-bb5a-b57883784abc |
| 取消 | 7f5260bd-1545-448b-9f1f-a1337a724a1e |
| 开始下载 | 21adfa2b-ab7d-42a0-9770-645aa804579b |
| 重试失败项 | c99ba1f6-869c-4579-8adc-58edfce068b6 |
| 停止下载 | c6270e8a-5380-4ebc-af18-e1bc58dad731 |
| 重新整理 | 371b49e2-9452-48ba-9d5f-e3bee846e2b4 |
| 帖子下载 | f2a25aa3-a5d1-4f0e-98c5-65d7578af7ed |
| 帖子完成 | 468c1510-b7ae-4b0e-85cc-e9a86159cdbc |

主组件和画板实例均完成渲染检查。第 5 页两列排版：同排间隔 100，第二排从 y=940 开始；没有覆盖已有的四页。

## 行为与边界

- 作者顶部“下载全部”始终从作者根地址读取所有分页，忽略当前页码和搜索条件。完整分页校验通过后才显示确认；单个帖子无法获取会计入摘要。
- 每帖原图、视频、直接附件与封面共用完整哈希去重；不下载缩略图或生成 ZIP。状态包括未下载、排队、下载中、部分失败、已停止、未归档、无法获取、已下载。
- 原文件目录为 `下载/utils-pawchive/<平台>/<作者ID>/<帖子ID>/`；原名清理后加入完整文件哈希。首个提交决定目的目录，其他帖子引用同一记录。
- 整理和确认不产生新下载。整理可取消；确认框支持 Tab、Shift+Tab、Escape，关闭后焦点返回触发按钮。
- 使用原生 `dialog`、`progress`、`button`，复用 Utils 下载 SVG；触控目标至少 44px，焦点为白色轮廓。375px 确认框换行显示路径和说明。
- 确认后后台队列继续运行。停止不删除完成记录；重试只补缺失文件，也重新获取此前无法读取的帖子。
- “已下载”表示曾成功完成；不扫描本地磁盘，不推断其他工具下载、已删除文件或被清除的历史。保留在 Chrome 中的已完成 Pawchive 下载会导入，后续记录另存于扩展 storage。
- 已持久化排队项可在后台重启后继续。启动结果不确定且 Chrome 历史无法佐证时显示失败，等待显式重试，不自动重发。
- 没有新增权限或依赖。收集与下载各最多并发 3。文件来源限定 `https://file.pawchive.pw/data/` 完整哈希路径；消息限定本扩展、顶层 Pawchive 页面与当前作者/帖子。

## 验证

`npm test` 包含 `pawchive-core.test.js` 与 `pawchive-downloads.test.js`，覆盖原始附件提取、分页与计数校验、取消、来源与 URL 校验、历史超过 1000 项、跨帖与多标签竞争、部分失败重试、丢失 ID 与后台重启、停止和恢复竞争。

可重复的浏览器模拟验证（不下载真实文件）：

```powershell
node scripts/pawchive-qa.mjs
```

打开控制台输出的本地 URL。测试入口刻意使用第 2 页及搜索参数。

已验证：确认摘要覆盖全部 4 帖、4 个待下载文件、1 个重复、1 个未归档帖子；确认前与取消后调用数为 0；并发峰值为 3；分页失败阻止确认；部分失败后的重试仅增加 1 次下载调用；停止后可继续；列表和详情刷新后保留勾选，未归档帖子不显示勾选。

1000px 桌面、768px 平板和 375px 窄屏检查覆盖对话框、长作者名、路径换行、44px 控件、可见焦点、取消后的焦点恢复和页面宽度。[桌面实测截图](pawchive-qa-desktop.png)、[窄屏实测截图](pawchive-qa-mobile.png)。

真实页面验证：Fanbox 作者 `37736420` 的帖子 `12637115` 下载了视频与封面共 2 项。下载中关闭帖子并重载扩展后，作者页显示“已完成 2 · 失败 0”，帖子保留勾选。作者页实测桌面和 375px 控件均可用。首次识别详情页附件只更新帖子按钮，任务摘要在提交后出现。

Chrome 行为依据：[Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)、[扩展后台生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)。
