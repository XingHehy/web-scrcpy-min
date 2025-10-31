# web-scrcpy 部署

scrcpy使用的是 [Genymobile/scrcpy][scrcpy] 的修改版 [NetrisTV/scrcpy][NetrisTV_scrcpy]，该版本用于流式传输 H.264 视频

[scrcpy]: https://github.com/Genymobile/scrcpy
[NetrisTV_scrcpy]: https://github.com/NetrisTV/scrcpy/tree/feature/websocket-v1.19.x
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

- ✅ Nginx 反向代理支持（可直接访问 `/` 根路径）
- ✅ Docker 容器启动时自动生成 ADB 密钥
- ✅ 密钥通过 Docker 卷持久化

## 文件说明

- `server.js` - Node.js 服务
- `docker-entrypoint.sh` - Docker 启动脚本（自动生成密钥）
- `Dockerfile` - Docker 镜像定义
- `docker-compose.yml` - Docker 编排配置

