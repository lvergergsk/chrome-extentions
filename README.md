# Utils

个人 Chrome 扩展。签到、下载、广告拦截都放在这一个插件里。

扩展本体在 `utils/`。Chrome 请加载这个文件夹，不要选仓库根目录，否则会把测试和脚本一并装进去。

## 功能

- Windows Native Messaging：配合 `gg browser` 列出、打开和整理标签页；按 URL/标题排序、完全相同 URL 去重，保留分组，固定标签页默认不动。
- Claude 用量：`gg agents usage` 通过同一个扩展实时查询 Chrome 已登录账号的额度、可用重置次数和到期日。仅支持唯一的个人 Pro/Max 订阅；多订阅不自动选择。Cookie 和账号信息留在浏览器内，不缓存用量，也不执行重置。
- 标签页快捷键：`Alt+Shift+←/→` 移动选中标签页，`Alt+Shift+↑/↓` 移到所在固定/非固定区域的最前/最后。
- 弹窗只提供按网址或标题排序的按钮，不显示移动按钮或快捷键提示；移动标签页只用快捷键。排序保留重复标签页、分组与固定标签页。
- X/Twitter 帖子图片和视频一键下载（自动点赞）。
- pixiv 作品原图一键下载（自动收藏）。作品页大图和列表缩略图都有按钮，多图作品一次下齐；已收藏的作品不会被重复写入（避免覆盖已有标签和留言）；うごイラ（动图）暂不支持。
- YouTube 普通视频和 Shorts 一键下载。按钮位于分享按钮之后，下载当前视频可用的最高画质单文件格式（含音频，优先 MP4）。
- HoYoLAB 自动签到：每天 09:10 和 15:10 检查原神、崩坏：星穹铁道、绝区零，Chrome 启动时也会补查一次；扩展弹窗可查看状态与上/下次时间、暂停自动签到或立即检查。直接复用当前 Chrome profile 的 HoYoLAB 登录状态，不保存 Cookie。
- Sukebei (https://sukebei.nyaa.si/) 广告拦截（网络层拦截 + 页面桩注入 + 广告容器自动清理）。
- ouo.io / ouo.press 广告拦截（挡住「I'm a human」的浮层、弹窗、广告脚本），验证完成后自动点继续。
- orangepix.is 广告拦截（顶栏横幅、联盟图、/htsrc.js 弹窗、年龄确认层）。
- Kemono (https://kemono.cr/) 广告拦截（TrafficStars / ExoClick 网络层拦截 + 广告容器清理 + 弹窗拦截）。
- GameBanana (https://gamebanana.com/) 广告拦截（Playwire/RAMP 左右底栏、列表内嵌广告位、GPT 广告框、竞价与身份追踪域）。站点用于检测拦截器的诱饵元素保持原样。
- Sukebei 列表页：标题含 `AI生成` 或「アンソロジー」时整行文字标红。
- Sukebei 列表页按钮：每隔约 3 秒打开未标红、且浏览记录里没访问过的条目；打开后标题会变成灰色，和手动点过一样。

## 本地加载

### GG Native Messaging

在个人 Windows 电脑更新 [gg-cli](https://github.com/lvergergsk/gg-cli)，于该仓库执行：

```powershell
make install
gg browser install
```

然后重新加载 Utils（新增 `nativeMessaging`、`tabs`、`tabGroups` 权限），执行：

```powershell
gg browser status
gg browser tabs
gg browser organize
gg browser organize --apply
```

`organize` 默认仅预览，`--apply` 才排序和关闭重复 URL 标签页。支持 `--sort-by title`、`--window ID`、`--keep-duplicates`、`--include-pinned`。去重优先保留固定、活动、最左侧副本；查询参数和锚点不同的 URL 不合并。

只在一个 Chrome profile 启用 Utils 桥接。扩展断线后每分钟重连；快捷键冲突可在 `chrome://extensions/shortcuts` 修改。桥接仅接受 `ping`、`tabs.list`、`tabs.open`、`tabs.organize`、`claude.usage`；网页和 content script 不能向 Native Host 转发命令。`claude.usage` 不接受参数，只查询固定的 Claude 官方接口；需要新增的 `claude.ai` 网站权限，更新后重新加载 Utils。卸载用 `gg browser uninstall`，随后重新加载 Utils。

Windows/Chrome 实机安装、重连和分组保持仍需验证；协议与步骤见 [Chrome bridge 文档](https://github.com/lvergergsk/gg-cli/blob/develop/docs/browser.md)。现有弹窗保持原样。

### 加载扩展

Chrome 151 已去掉 `--load-extension`，**第一次安装必须在扩展页点一次「加载已解压的扩展程序」**。装过之后可以用脚本更新：

```powershell
npm run load      # 未安装：打开扩展页并选中 utils 文件夹
npm run reload    # 已安装：请求 Chrome 重新加载 Utils
```

手动步骤（只在第一次）：

1. 打开 `chrome://extensions`，打开开发者模式。
2. 点击 **加载已解压的扩展程序**，选 `utils`。
3. 打开 `x.com` 或 `twitter.com`。带图片或视频的帖子会在操作栏出现下载按钮。
4. 打开 `www.pixiv.net`。作品页大图右上角和列表缩略图右上角会出现下载按钮。
5. 打开 YouTube 普通视频或 Shorts。分享按钮之后会出现下载按钮。
6. 在同一个 Chrome profile 登录一次 HoYoLAB；之后由扩展后台签到，不需要 Windows 计划任务。
