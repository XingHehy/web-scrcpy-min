# web-scrcpy 部署

scrcpy使用的是 [Genymobile/scrcpy][scrcpy] 的修改版 [NetrisTV/scrcpy][NetrisTV_scrcpy]，该版本用于流式传输 H.264 视频

[scrcpy]: https://github.com/Genymobile/scrcpy
[NetrisTV_scrcpy]: https://github.com/NetrisTV/scrcpy/tree/feature/websocket-v1.19.x

## 演示效果

![web-scrcpy演示效果](https://github.com/XingHehy/web-scrcpy-min/blob/main/web-scrcpy-demo.gif)

## 🚀 快速部署

### 方案 1：使用本机密钥（推荐）⭐

**优势：** 本机密钥已被设备授权，线上可以直接连接，无需再次授权！

#### 步骤：

**1. 在本机准备密钥**

```powershell
# Windows 本机操作
# 进入项目目录
cd web-scrcpy-min

# 创建 adb-keys 目录
mkdir adb-keys

# 复制密钥
copy C:\Users\{USER}\.android\adbkey .\adb-keys\
copy C:\Users\{USER}\.android\adbkey.pub .\adb-keys\
```

**2. 上传到服务器并构建**

```bash
# 上传整个项目到服务器（包括 adb-keys 目录）

# 在服务器上构建
docker-compose build

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f web-scrcpy
```

你会看到：
```
[✓] 使用预置的 ADB 密钥
    设备应该已经授权过此密钥，可以直接连接
```

**3. 直接连接设备，无需授权！** ✅

---

### 方案 2：不使用本机密钥（需要设备授权）

如果不复制本机密钥，容器会自动生成新密钥，但需要在设备上授权。

**部署：**
```bash
# 不需要 adb-keys 目录，直接构建
docker-compose up -d --build
```

**首次连接设备：**

1. 在 Android 设备上撤销旧授权
   ```
   设置 > 开发者选项 > 撤销 USB 调试授权
   ```

2. 连接设备
   ```bash
   docker exec -it web-scrcpy bash
   adb connect YOUR_DEVICE_IP:PORT
   ```

3. 在设备上授权（勾选"始终允许"并点击"允许"）

---

## 📱 访问服务

浏览器打开：`http://your-server:8280`

**默认密码：** `123456` （请在 `server.js` 中修改 `ACCESS_PASSWORD` 变量）

## 🎮 操作指南

### 触摸操作
- **点击：** 鼠标左键点击
- **滑动：** 鼠标按住拖动
- **长按：** 鼠标左键按住 500ms 或右键点击
- **滚动：** 鼠标滚轮

### 键盘快捷键
- **普通字符：** 直接输入（a-z, 0-9, 符号等）
- **Backspace：** 删除
- **Enter：** 回车
- **Escape：** 返回
- **方向键：** 上下左右
- **Ctrl+C：** 从设备复制到电脑
- **Ctrl+V：** 从电脑粘贴到设备

### 导航按钮
- **◁ 返回** - Android 返回键
- **○ 主页** - Android 主页
- **▢ 最近任务** - 多任务切换

### 侧边按钮
- **🔆 电源** - 电源键
- **🔊 音量+** - 增加音量
- **🔉 音量-** - 减少音量

## 常用命令

```bash
# 重启服务
docker-compose restart web-scrcpy

# 查看已连接设备
docker exec web-scrcpy adb devices

# 检查密钥
docker exec web-scrcpy ls -la /root/.android/
```

## 核心功能

### 基础功能
- ✅ H264 实时视频流（低延迟、高画质）
- ✅ 触摸控制（点击、滑动、长按）
- ✅ 键盘输入支持
- ✅ 剪贴板双向同步
- ✅ 多设备管理
- ✅ 无线连接支持
- ✅ 可调节码率/分辨率/帧率
- ✅ 用户密码认证

### 高级功能
- ✅ **长按功能**
  - 鼠标左键按住 500ms 触发
  - 鼠标右键点击立即触发
  - 触摸屏按住 500ms 触发
  
- ✅ **键盘输入**
  - 普通字符直接输入
  - 特殊键映射（回车、删除、方向键等）
  - 自动转义特殊字符
  
- ✅ **剪贴板同步**
  - `Ctrl+C` - 从设备复制到浏览器
  - `Ctrl+V` - 从浏览器粘贴到设备
  - 双向自动同步

### 部署功能
- ✅ Nginx 反向代理支持（可直接访问 `/` 根路径）
- ✅ Docker 容器启动时自动生成 ADB 密钥
- ✅ 密钥通过 Docker 卷持久化

## 文件说明

- `server.js` - Node.js 服务
- `docker-entrypoint.sh` - Docker 启动脚本（自动生成密钥）
- `Dockerfile` - Docker 镜像定义
- `docker-compose.yml` - Docker 编排配置
