# Chrome Extensions

个人 Chrome 扩展仓库。根目录下每个文件夹是一个独立 extension。

## Extensions

- `utils` - 个人工具箱。包含：
  - X/Twitter 帖子图片和视频一键下载（自动点赞）。
  - pixiv 作品原图一键下载（自动收藏）。作品页大图和列表缩略图都有按钮，多图作品一次下齐；已收藏的作品不会被重复写入（避免覆盖已有标签和留言）；うごイラ（动图）暂不支持。
  - YouTube 普通视频和 Shorts 一键下载。按钮位于分享按钮之后，下载当前视频可用的最高画质单文件格式（含音频，优先 MP4）。
  - HoYoLAB 自动签到：每天 09:10 和 15:10 检查原神、崩坏：星穹铁道、绝区零，Chrome 启动时也会补查一次；扩展弹窗可查看状态与上/下次时间、暂停自动签到或立即检查。直接复用当前 Chrome profile 的 HoYoLAB 登录状态，不保存 Cookie。
  - Sukebei (https://sukebei.nyaa.si/) 广告拦截（网络层拦截 + 页面桩注入 + 广告容器自动清理）。
  - ouo.io / ouo.press 广告拦截（挡住「I'm a human」的浮层、弹窗、广告脚本），验证完成后自动点继续。
  - orangepix.is 广告拦截（顶栏横幅、联盟图、/htsrc.js 弹窗、年龄确认层）。
  - Kemono (https://kemono.cr/) 广告拦截（TrafficStars / ExoClick 网络层拦截 + 广告容器清理 + 弹窗拦截）。
  - Sukebei 列表页：标题含 `AI生成` 或「アンソロジー」时整行文字标红。
  - Sukebei 列表页按钮：每隔约 3 秒打开未标红、且浏览记录里没访问过的条目；打开后标题会变成灰色，和手动点过一样。

## 本地加载

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

## 以后打包

每个 extension 保持自包含，方便以后把要公开的功能拆到独立插件。
