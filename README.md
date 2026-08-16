# Chrome Extensions

个人 Chrome 扩展仓库。根目录下每个文件夹是一个独立 extension。

## Extensions

- `utils` - 个人工具箱。当前包含 X/Twitter 帖子图片和视频下载。

## 本地加载

1. 打开 `chrome://extensions`。
2. 打开开发者模式。
3. 点击 **加载已解压的扩展程序**。
4. 选择扩展文件夹，例如 `utils`。
5. 打开 `x.com` 或 `twitter.com`。带图片或视频的帖子会在操作栏出现下载按钮。

## 以后打包

每个 extension 保持自包含，方便以后把要公开的功能拆到独立插件。
