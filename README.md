# 🎵 网易云音乐淡出歌单插件

自动将播放过程中被手动跳过的歌曲（播放进度 < 50%）添加到你的“淡出”歌单，帮你记录那些没听完就切走的歌曲。

---

## ✨ 功能特点

- 🎯 **精准识别**：自动检测用户点击“下一曲”、键盘快捷键等手动跳过操作
- 📊 **智能判断**：仅当播放进度 < 50% 且歌曲时长 > 30 秒时才添加，自然播放结束不会被误加
- 🔐 **自动登录**：无需手动配置 Cookie，自动从浏览器获取网易云音乐登录状态
- 🎨 **友好提示**：页面底部弹出通知，告知歌曲添加结果
- 📝 **详细日志**：完整的运行日志，方便调试和问题排查

---

## 📦 安装方法

### 开发模式安装
1. 下载或克隆本项目到本地
2. 打开 Chrome 浏览器，访问 `chrome://extensions/`
3. 开启右上角的 **“开发者模式”**
4. 点击 **“加载已解压的扩展程序”**
5. 选择项目文件夹，完成安装

### 使用要求
- Chrome 浏览器（版本 88 或更高）
- 已登录 [网易云音乐网页版](https://music.163.com)

---

## 🚀 使用方法

1. **首次使用**：
   - 打开 [网易云音乐网页版](https://music.163.com) 并确保已登录
   - 插件会自动获取 Cookie 并查找你创建的“淡出”歌单

2. **创建淡出歌单**（如尚未创建）：
   - 在网易云音乐中创建一个新歌单，名称包含“淡出”二字（如：`淡出歌单`、`Fade Out`）
   - 刷新页面，插件会自动识别

3. **日常使用**：
   - 正常听歌，当你想跳过当前歌曲时，点击“下一曲”或使用快捷键
   - 如果播放进度 < 50%，歌曲会自动加入“淡出”歌单
   - 页面右下角会显示提示信息

---

## 🛠️ 项目结构

```
netease-fadeout-playlist/
├── manifest.json          # 扩展配置文件
├── background.js          # 后台服务，处理歌单添加逻辑
├── content.js             # 页面脚本，监听用户交互和歌曲状态
├── popup.html             # 弹出窗口界面
├── popup.js               # 弹出窗口逻辑
├── utils/
│   ├── logger.js          # 日志工具
│   ├── cookie-manager.js  # Cookie 管理
│   └── playlist-manager.js # 歌单 API 管理
└── ui/
    ├── toast.js           # 页面提示组件
    └── toast.css          # 提示样式
```

---

## 🔧 技术原理

### 工作流程
```
用户点击“下一曲”
       ↓
content.js 捕获点击事件
       ↓
标记 isManualSkip = true
获取当前歌曲信息（ID、名称、进度）
       ↓
发送 SONG_CHANGE_UPDATE 消息
       ↓
background.js 接收消息
       ↓
判断条件：进度 < 50% && 手动跳过 && 时长 > 30 秒
       ↓
调用网易云 API 添加歌曲到“淡出”歌单
       ↓
页面显示添加结果提示
```

### 关键技术点
- **Chrome Extension Manifest V3**
- **事件捕获**：使用捕获阶段监听点击，绕过页面的 `stopPropagation()`
- **DOM 监听**：通过选择器获取歌曲信息（`.fc1`、`audio` 元素等）
- **Cookie 管理**：使用 `chrome.cookies` API 自动获取并验证登录状态
- **网易云 API**：调用 `/api/playlist/manipulate/tracks` 添加歌曲到歌单

---

## ⚙️ 配置说明

### 修改歌单匹配规则
在 `utils/playlist-manager.js` 中修改 `findFadeOutPlaylist` 方法，调整歌单名称匹配关键词：

```javascript
const fadeOutPlaylist = data.playlist.find(p => 
  p.name.includes('淡出') ||      // 中文
  p.name.includes('Fade Out') ||  // 英文
  p.name.includes('跳过')         // 自定义
);
```

### 修改跳过阈值
在 `background.js` 的 `shouldAddToPlaylist` 方法中调整进度阈值和时长限制：

```javascript
if (song.playPercent >= 50) return false;  // 修改 50 为其他值
if (song.duration < 30) return false;       // 修改 30 为其他值
```

---

## 🐛 常见问题

### Q: 插件无法获取歌曲信息
**A**: 网易云音乐可能更新了页面结构，请更新 `content.js` 中的选择器：
- 在控制台执行 `document.querySelector('.fc1')?.innerText` 测试
- 将有效选择器添加到 `getSongName` 方法的选择器数组中

### Q: 提示“未找到淡出歌单”
**A**: 请确保已在网易云音乐创建名称包含“淡出”的歌单，然后刷新页面。

### Q: 添加歌曲失败，提示 Cookie 无效
**A**: 
- 重新登录网易云音乐网页版
- 确保未在隐私模式下使用
- 检查是否安装了其他可能干扰 Cookie 的扩展

### Q: 自然播放结束的歌曲也被添加了
**A**: 检查 `content.js` 中 `isManualSkip` 标记逻辑，确保只在手动操作时设为 `true`。

---

## 📝 更新日志

### v1.0.0 (2026-03-22)
- ✅ 实现手动跳过歌曲检测
- ✅ 自动获取 Cookie 和歌单
- ✅ 集成网易云 API 添加歌曲
- ✅ 页面提示功能
- ✅ 完整的日志系统

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📄 许可证

MIT License

---

## 🙏 致谢

感谢网易云音乐提供的 API 接口，以及 Chrome 扩展生态的支持。

---

**Enjoy your music! 🎧**