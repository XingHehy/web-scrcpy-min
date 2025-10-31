import express from "express";
import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import net from "net";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 日志辅助函数
function getTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const milliseconds = String(now.getMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds},${milliseconds}`;
}

function log(level, message) {
  console.log(`${getTimestamp()} - ${level} - ${message}`);
}

const app = express();
const PORT = 8280;
const SCRCPY_SERVER_PATH = path.join(__dirname, "scrcpy-server.jar");
const SERVER_VERSION = "1.19-ws6";

const ACCESS_PASSWORD = "123456";

// 简单的 session 存储
const sessions = new Map();

// 生成随机 token
function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// 验证 token 的中间件
function requireAuth(req, res, next) {
  const token = req.headers["authorization"]?.replace("Bearer ", "");

  if (!token || !sessions.has(token)) {
    return res
      .status(401)
      .json({ success: false, message: "未授权访问，请先登录" });
  }

  // 检查 token 是否过期（24小时）
  const sessionData = sessions.get(token);
  if (Date.now() - sessionData.createdAt > 24 * 60 * 60 * 1000) {
    sessions.delete(token);
    return res
      .status(401)
      .json({ success: false, message: "登录已过期，请重新登录" });
  }

  next();
}

app.use(express.static("public"));
app.use(express.json());

// 显式处理根路径，确保 Nginx 反向代理下也能正常访问
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 密码验证
app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password === ACCESS_PASSWORD) {
    // 生成 token
    const token = generateToken();
    sessions.set(token, { createdAt: Date.now() });

    log(
      "INFO",
      `Login successful, token generated: ${token.substring(0, 10)}...`
    );
    res.json({ success: true, token });
  } else {
    log("WARNING", "Login failed - incorrect password");
    res.json({ success: false, message: "密码错误" });
  }
});

// 获取设备列表（需要认证）
app.get("/devices", requireAuth, (req, res) => {
  const adb = spawn("adb", ["devices"]);
  let out = "";
  adb.stdout.on("data", (d) => (out += d.toString()));
  adb.on("close", () => {
    const devices = out
      .split("\n")
      .slice(1)
      .map((l) => l.trim().split("\t"))
      .filter((l) => l[0])
      .map(([id, state]) => ({ id, state }));
    res.json({ devices });
  });
});

// 连接设备（需要认证）
app.post("/api/connect", requireAuth, (req, res) => {
  const { address } = req.body;
  if (!address) {
    return res.json({ success: false, message: "请输入设备地址" });
  }

  log("INFO", `Attempting to connect to device: ${address}`);
  const adb = spawn("adb", ["connect", address]);
  let out = "";
  let err = "";

  adb.stdout.on("data", (d) => (out += d.toString()));
  adb.stderr.on("data", (d) => (err += d.toString()));

  adb.on("close", (code) => {
    const output = out + err;
    log("INFO", `ADB connect output: ${output}`);

    if (output.includes("connected") || output.includes("already connected")) {
      res.json({ success: true, message: "设备连接成功" });
    } else {
      res.json({ success: false, message: `连接失败: ${output}` });
    }
  });
});

// 断开设备（需要认证）
app.post("/api/disconnect", requireAuth, (req, res) => {
  const { address } = req.body;
  if (!address) {
    return res.json({ success: false, message: "请输入设备地址" });
  }

  log("INFO", `Attempting to disconnect device: ${address}`);
  const adb = spawn("adb", ["disconnect", address]);
  let out = "";
  let err = "";

  adb.stdout.on("data", (d) => (out += d.toString()));
  adb.stderr.on("data", (d) => (err += d.toString()));

  adb.on("close", (code) => {
    const output = out + err;
    log("INFO", `ADB disconnect output: ${output}`);
    res.json({ success: true, message: "设备已断开" });
  });
});

const server = app.listen(PORT, () => {
  log("INFO", `Server running at http://localhost:${PORT}`);
  log("INFO", `WebSocket server ready for remote connections`);
  log("INFO", `H264 video stream mode (high quality, low latency)`);
});

const wss = new WebSocketServer({ server });

class ScrcpyClient {
  constructor(ws, deviceId, options = {}) {
    this.ws = ws;
    this.deviceId = deviceId;
    this.bitrate = options.bitrate || 2000000; // 默认 2 Mbps
    this.maxSize = options.maxSize || 1080; // 默认 1080p
    this.maxFps = options.maxFps || 30; // 默认 30 FPS
    this.serverProcess = null;
    this.videoSocket = null;
    this.localPort = 27183 + Math.floor(Math.random() * 1000);
    this.screenWidth = 0;
    this.screenHeight = 0;
    this.onDisconnect = null; // 断开回调
  }

  async start() {
    try {
      log("INFO", `Starting H264 video stream for device: ${this.deviceId}`);
      await this.startH264Stream();
      log("INFO", `H264 mode started successfully`);
    } catch (err) {
      log("ERROR", `Failed to start H264 mode: ${err.message}`);
      this.stop();
      if (this.ws.readyState === this.ws.OPEN) {
        this.ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
    }
  }

  // H264 视频流模式
  async startH264Stream() {
    log("INFO", "Starting H264 video stream...");
    log("INFO", `Using local port: ${this.localPort}`);
    log(
      "INFO",
      `User settings: Bitrate=${this.bitrate / 1000000} Mbps, Resolution=${
        this.maxSize
      }p (short edge), FPS=${this.maxFps}`
    );
    log("INFO", `If stream doesn't start automatically, try accessing:`);
    log("INFO", `   http://localhost:${this.localPort}/`);

    // 检查 scrcpy-server.jar
    if (!fs.existsSync(SCRCPY_SERVER_PATH)) {
      throw new Error("scrcpy-server.jar not found");
    }

    // 0. 预先获取屏幕尺寸
    await this.fetchScreenSize();

    // 1. 推送 server
    await this.pushServer();

    // 2. 转发端口
    await this.forwardPort();

    // 3. 启动 scrcpy-server
    await this.startScrcpyServer();

    // 4. 连接视频流（同时内部触发 scrcpy-server）
    await this.connectVideoStream();
  }

  fetchScreenSize() {
    return new Promise((resolve) => {
      log("INFO", "Fetching screen size from ADB...");
      const sizeProc = spawn("adb", [
        "-s",
        this.deviceId,
        "shell",
        "wm",
        "size",
      ]);
      let sizeOutput = "";

      sizeProc.stdout.on("data", (data) => {
        sizeOutput += data.toString();
      });

      sizeProc.on("close", () => {
        const match = sizeOutput.match(/(\d+)x(\d+)/);
        if (match) {
          this.screenWidth = parseInt(match[1]);
          this.screenHeight = parseInt(match[2]);
          log(
            "INFO",
            `Screen size from ADB: ${this.screenWidth}x${this.screenHeight}`
          );

          // 立即发送给客户端
          if (this.ws.readyState === this.ws.OPEN) {
            this.ws.send(
              JSON.stringify({
                type: "screenSize",
                width: this.screenWidth,
                height: this.screenHeight,
              })
            );
          }
        } else {
          log("WARN", "Could not get screen size from ADB");
        }
        resolve();
      });

      sizeProc.on("error", (err) => {
        log("ERROR", `Error fetching screen size: ${err.message}`);
        resolve();
      });
    });
  }

  pushServer() {
    return new Promise((resolve, reject) => {
      log("INFO", "Pushing scrcpy-server...");
      const push = spawn("adb", [
        "-s",
        this.deviceId,
        "push",
        SCRCPY_SERVER_PATH,
        "/data/local/tmp/scrcpy-server.jar",
      ]);

      push.on("close", (code) => {
        if (code === 0) {
          log("INFO", "Server pushed");
          resolve();
        } else {
          reject(new Error("Failed to push server"));
        }
      });

      push.on("error", reject);
    });
  }

  forwardPort() {
    return new Promise((resolve, reject) => {
      log("INFO", `Forwarding port ${this.localPort}...`);
      const forward = spawn("adb", [
        "-s",
        this.deviceId,
        "forward",
        `tcp:${this.localPort}`,
        "localabstract:scrcpy",
      ]);

      forward.on("close", (code) => {
        if (code === 0) {
          log("INFO", "Port forwarded");
          resolve();
        } else {
          reject(new Error("Failed to forward port"));
        }
      });

      forward.on("error", reject);
    });
  }

  triggerScrcpyServer() {
    return new Promise((resolve) => {
      log("INFO", "Triggering scrcpy-server with TCP poke...");

      // 使用纯 TCP 连接来触发，而不是 HTTP
      const triggerSocket = net.connect(this.localPort, "localhost");

      let triggered = false;

      triggerSocket.on("connect", () => {
        log("INFO", "Trigger connection established");

        // 立即关闭，仅用于"唤醒" scrcpy-server
        setTimeout(() => {
          if (!triggered) {
            triggered = true;
            triggerSocket.destroy();
            log("INFO", "Trigger connection closed");

            // 短暂延迟让 scrcpy-server 处理
            setTimeout(() => {
              log("INFO", "Trigger complete");
              resolve();
            }, 500);
          }
        }, 50);
      });

      triggerSocket.on("error", (err) => {
        if (!triggered) {
          triggered = true;
          log("WARN", `Trigger failed: ${err.message}`);
          resolve();
        }
      });

      // 3 秒超时
      setTimeout(() => {
        if (!triggered) {
          triggered = true;
          triggerSocket.destroy();
          log("WARN", "Trigger timeout");
          resolve();
        }
      }, 3000);
    });
  }

  startScrcpyServer() {
    return new Promise((resolve, reject) => {
      log("INFO", "Starting scrcpy-server...");

      // 计算正确的 maxSize（scrcpy 的 maxSize 是长边）
      // 用户选择的是短边（480p, 720p等）
      let calculatedMaxSize = this.maxSize;
      if (this.screenWidth && this.screenHeight) {
        const shortEdge = Math.min(this.screenWidth, this.screenHeight);
        const longEdge = Math.max(this.screenWidth, this.screenHeight);
        const scale = this.maxSize / shortEdge;
        calculatedMaxSize = Math.round(longEdge * scale);
        log(
          "INFO",
          `Resolution calculation: ${this.screenWidth}x${this.screenHeight} -> short:${this.maxSize} -> long:${calculatedMaxSize}`
        );
      }

      const params = [
        SERVER_VERSION,
        "info", // log_level
        String(calculatedMaxSize), // max_size (长边)
        String(this.bitrate), // bit_rate (用户选择的码率)
        String(this.maxFps), // max_fps (用户选择的帧率)
        "-1", // lock_video_orientation
        "true", // tunnel_forward
        "-", // crop
        "false", // send_frame_meta
        "false", // control
        "0", // display_id
        "false", // show_touches
        "false", // stay_awake
        "-", // codec_options
        "-", // encoder_name
        "false", // power_off_on_close
      ];

      const cmd = `CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server ${params.join(
        " "
      )}`;

      this.serverProcess = spawn("adb", ["-s", this.deviceId, "shell", cmd]);

      let serverReady = false;

      this.serverProcess.stdout.on("data", (data) => {
        const output = data.toString().trim();
        log("INFO", `SCRCPY: ${output}`);

        // 检测服务器是否准备好
        if (
          !serverReady &&
          (output.includes("success") ||
            output.includes("codec") ||
            output.includes("encoder"))
        ) {
          serverReady = true;
          log("INFO", "scrcpy-server is initializing...");
        }
      });

      this.serverProcess.stderr.on("data", (data) => {
        log("INFO", `SCRCPY: ${data.toString().trim()}`);
      });

      this.serverProcess.on("error", reject);

      // 增加等待时间到 6 秒，给 scrcpy-server 足够的初始化时间
      setTimeout(() => {
        log(
          "INFO",
          "Waiting period complete, scrcpy-server should be ready..."
        );
        resolve();
      }, 6000);
    });
  }

  connectVideoStream() {
    return new Promise((resolve, reject) => {
      log("INFO", `Connecting to video stream on port ${this.localPort}...`);

      let retryCount = 0;
      const maxRetries = 15;
      const retryDelay = 800; // 每次重试等待 800ms
      let mainConnectionEstablished = false;

      const attemptConnection = () => {
        this.videoSocket = net.connect(this.localPort, "localhost");

        // 设置连接超时（增加到 60 秒，等待第一个数据包）
        this.videoSocket.setTimeout(60000);

        log(
          "INFO",
          `Attempting to connect to localhost:${this.localPort} (attempt ${
            retryCount + 1
          }/${maxRetries})...`
        );

        this.videoSocket.on("timeout", () => {
          log(
            "WARN",
            `Connection timeout (attempt ${retryCount + 1}/${maxRetries})`
          );
          this.videoSocket.destroy();

          retryCount++;
          if (retryCount < maxRetries) {
            log("INFO", `Retrying connection in ${retryDelay}ms...`);
            setTimeout(attemptConnection, retryDelay);
          } else {
            reject(
              new Error(
                "Failed to connect to scrcpy-server after multiple attempts"
              )
            );
          }
        });

        let connectionEstablished = false;
        let buffer = Buffer.alloc(0);
        let headerParsed = false;

        this.videoSocket.on("connect", () => {
          log("INFO", "Main TCP connection established");

          if (!mainConnectionEstablished) {
            mainConnectionEstablished = true;

            // 主连接建立后，立即发起触发来激活 scrcpy-server
            log("INFO", "Triggering scrcpy-server to start streaming...");
            this.triggerScrcpyServer().then(() => {
              log("INFO", "Waiting for data from scrcpy-server...");
            });
          }
        });

        this.videoSocket.on("data", (data) => {
          // 第一次收到数据时才认为连接真正成功
          if (!connectionEstablished) {
            connectionEstablished = true;
            this.videoSocket.setTimeout(0); // 清除超时
            log("INFO", "Data stream started! scrcpy-server is now active!");
            resolve();
          }

          buffer = Buffer.concat([buffer, data]);

          // 解析 scrcpy 头部
          if (!headerParsed && buffer.length >= 69) {
            // 打印前 70 字节的十六进制用于调试
            log(
              "DEBUG",
              `Header bytes (first 70): ${buffer.slice(0, 70).toString("hex")}`
            );
            log(
              "DEBUG",
              `Bytes 64-68: ${buffer.slice(64, 69).toString("hex")}`
            );

            const deviceName = buffer
              .slice(0, 64)
              .toString("utf8")
              .replace(/\0.*$/g, "");

            // 只在还没有屏幕尺寸时才从头部解析
            if (
              !this.screenWidth ||
              !this.screenHeight ||
              this.screenWidth < 100 ||
              this.screenHeight < 100
            ) {
              // 尝试两种字节序
              const widthBE = buffer.readUInt16BE(64);
              const heightBE = buffer.readUInt16BE(66);
              const widthLE = buffer.readUInt16LE(64);
              const heightLE = buffer.readUInt16LE(66);

              log("DEBUG", `Width BE: ${widthBE}, LE: ${widthLE}`);
              log("DEBUG", `Height BE: ${heightBE}, LE: ${heightLE}`);

              // 使用更合理的值
              if (
                widthBE > 100 &&
                widthBE < 5000 &&
                heightBE > 100 &&
                heightBE < 5000
              ) {
                this.screenWidth = widthBE;
                this.screenHeight = heightBE;
              } else if (
                widthLE > 100 &&
                widthLE < 5000 &&
                heightLE > 100 &&
                heightLE < 5000
              ) {
                this.screenWidth = widthLE;
                this.screenHeight = heightLE;
              } else {
                log("WARN", "Invalid screen size from header");
              }
            } else {
              log(
                "INFO",
                `Using pre-fetched screen size: ${this.screenWidth}x${this.screenHeight}`
              );
            }

            const codecByte = buffer[68];

            log("INFO", `Device: ${deviceName}`);
            log("INFO", `Screen: ${this.screenWidth}x${this.screenHeight}`);
            log("INFO", `Codec: 0x${codecByte.toString(16)}`);

            if (
              this.ws.readyState === this.ws.OPEN &&
              this.screenWidth > 0 &&
              this.screenHeight > 0
            ) {
              this.ws.send(
                JSON.stringify({
                  type: "screenSize",
                  width: this.screenWidth,
                  height: this.screenHeight,
                })
              );
            }

            headerParsed = true;
            buffer = buffer.slice(69);
            log("INFO", "Header parsed, streaming H264 data...");

            if (buffer.length > 0 && this.ws.readyState === this.ws.OPEN) {
              this.ws.send(buffer);
              buffer = Buffer.alloc(0);
            }
          } else if (headerParsed) {
            if (this.ws.readyState === this.ws.OPEN) {
              this.ws.send(buffer);
            }
            buffer = Buffer.alloc(0);
          }
        });

        this.videoSocket.on("error", (err) => {
          if (err.code === "ECONNREFUSED") {
            log(
              "WARN",
              `Connection refused (attempt ${
                retryCount + 1
              }/${maxRetries}), scrcpy-server may not be ready yet`
            );

            retryCount++;
            if (retryCount < maxRetries) {
              log("INFO", `Retrying connection in ${retryDelay}ms...`);
              setTimeout(attemptConnection, retryDelay);
            } else {
              reject(
                new Error("Failed to connect to scrcpy-server: " + err.message)
              );
            }
          } else {
            log("ERROR", `Video socket error: ${err.message}`);
            // 如果连接已经建立，通知前端断开并清理
            if (connectionEstablished) {
              log("ERROR", "Device disconnected unexpectedly");
              if (this.ws && this.ws.readyState === 1) {
                this.ws.send(JSON.stringify({ type: "ended" }));
              }
              // 调用断开回调
              if (this.onDisconnect) {
                this.onDisconnect();
              }
            } else {
              reject(err);
            }
          }
        });

        this.videoSocket.on("close", () => {
          log("INFO", "Video stream closed");

          // 清理资源
          if (this.serverProcess) {
            try {
              this.serverProcess.kill();
              this.serverProcess = null;
              log("INFO", "Server process killed after video stream closed");
            } catch (e) {
              log("WARN", `Failed to kill server process: ${e.message}`);
            }
          }

          // 通知前端断开
          if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({ type: "ended" }));
          }

          // 调用断开回调
          if (this.onDisconnect) {
            this.onDisconnect();
          }
        });
      };

      // 开始第一次连接尝试
      attemptConnection();
    });
  }

  stop() {
    return new Promise((resolve) => {
      log("INFO", `Stopping H264 video stream...`);

      if (this.videoSocket) {
        this.videoSocket.removeAllListeners(); // 移除所有监听器，避免触发 close 事件
        this.videoSocket.destroy();
        this.videoSocket = null;
        log("INFO", "Video socket destroyed");
      }

      if (this.serverProcess) {
        this.serverProcess.kill();
        this.serverProcess = null;
        log("INFO", "Server process killed");
      }

      // 移除端口转发
      const removeForward = spawn("adb", [
        "-s",
        this.deviceId,
        "forward",
        "--remove",
        `tcp:${this.localPort}`,
      ]);
      removeForward.on("close", (code) => {
        log("INFO", `Port forward removed (code: ${code})`);
        log("INFO", `H264 stream stopped completely`);
        resolve();
      });
      removeForward.on("error", (err) => {
        log("WARN", `Failed to remove port forward: ${err.message}`);
        log("INFO", `H264 stream stopped (with warnings)`);
        resolve();
      });

      // 超时保护，确保不会永久挂起
      setTimeout(() => {
        log("WARN", "Stop operation timeout, forcing resolve");
        resolve();
      }, 2000);
    });
  }
}

// 检查设备是否在线
function checkDeviceOnline(deviceId) {
  return new Promise((resolve) => {
    const adb = spawn("adb", ["devices"]);
    let output = "";

    adb.stdout.on("data", (data) => {
      output += data.toString();
    });

    adb.on("close", () => {
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.includes(deviceId) && line.includes("device")) {
          resolve(true);
          return;
        }
      }
      resolve(false);
    });

    adb.on("error", () => {
      resolve(false);
    });
  });
}

// WebSocket 连接处理
wss.on("connection", (ws) => {
  log("INFO", "WebSocket client connected");

  let scrcpyClient = null;
  let isAuthenticated = false; // WebSocket 认证状态

  // 监听设备断开事件，清理 scrcpyClient
  const handleDeviceDisconnect = async () => {
    if (scrcpyClient) {
      log("INFO", "Device disconnected, cleaning up scrcpyClient...");
      await scrcpyClient.stop();
      scrcpyClient = null;
      log("INFO", "scrcpyClient cleaned up, ready for new connection");
    }
  };

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      // 验证 token（第一个消息必须包含 token）
      if (!isAuthenticated) {
        const token = data.token;
        if (!token || !sessions.has(token)) {
          log(
            "WARNING",
            "WebSocket authentication failed - invalid or missing token"
          );
          ws.send(
            JSON.stringify({ type: "error", message: "未授权访问，请先登录" })
          );
          ws.close();
          return;
        }

        // 检查 token 是否过期
        const sessionData = sessions.get(token);
        if (Date.now() - sessionData.createdAt > 24 * 60 * 60 * 1000) {
          sessions.delete(token);
          log("WARNING", "WebSocket authentication failed - token expired");
          ws.send(
            JSON.stringify({ type: "error", message: "登录已过期，请重新登录" })
          );
          ws.close();
          return;
        }

        isAuthenticated = true;
        log("INFO", "WebSocket authenticated successfully");
      }

      if (data.action === "start") {
        const { deviceId, bitrate, maxSize, maxFps } = data;

        // 停止之前的客户端（等待完成）
        if (scrcpyClient) {
          log(
            "INFO",
            "Stopping previous client before starting new connection..."
          );
          await scrcpyClient.stop();
          scrcpyClient = null;
          log("INFO", "Previous client stopped, starting new connection...");
        }

        // 创建并启动新客户端
        const options = {};
        if (bitrate) options.bitrate = bitrate;
        if (maxSize) options.maxSize = maxSize;
        if (maxFps) options.maxFps = maxFps;

        scrcpyClient = new ScrcpyClient(ws, deviceId, options);

        // 绑定断开处理
        scrcpyClient.onDisconnect = handleDeviceDisconnect;

        await scrcpyClient.start();
      }

      // ADB 控制命令（需要先认证）
      else if (data.action === "touch") {
        if (!isAuthenticated) {
          log("WARNING", "Unauthorized touch command attempt");
          ws.send(JSON.stringify({ type: "error", message: "未授权的操作" }));
          return;
        }
        const { x, y } = data;
        if (scrcpyClient) {
          // 如果屏幕尺寸未知，尝试获取
          if (!scrcpyClient.screenWidth || !scrcpyClient.screenHeight) {
            log("WARN", "Screen size not available, fetching...");
            const sizeProc = spawn("adb", [
              "-s",
              scrcpyClient.deviceId,
              "shell",
              "wm",
              "size",
            ]);
            let sizeOutput = "";
            let errorOutput = "";

            sizeProc.stdout.on("data", (data) => {
              sizeOutput += data.toString();
            });

            sizeProc.stderr.on("data", (data) => {
              errorOutput += data.toString();
            });

            sizeProc.on("close", () => {
              // 检查设备是否离线
              if (
                errorOutput.includes("device offline") ||
                errorOutput.includes("device not found")
              ) {
                log("ERROR", `Device ${scrcpyClient.deviceId} is offline`);
                ws.send(JSON.stringify({ type: "ended" }));
                return;
              }

              const match = sizeOutput.match(/(\d+)x(\d+)/);
              if (match) {
                scrcpyClient.screenWidth = parseInt(match[1]);
                scrcpyClient.screenHeight = parseInt(match[2]);
                log(
                  "INFO",
                  `Screen size fetched: ${scrcpyClient.screenWidth}x${scrcpyClient.screenHeight}`
                );

                // 执行点击
                const actualX = Math.round(x * scrcpyClient.screenWidth);
                const actualY = Math.round(y * scrcpyClient.screenHeight);
                log(
                  "INFO",
                  `Touch: (${x.toFixed(2)}, ${y.toFixed(
                    2
                  )}) -> (${actualX}, ${actualY})`
                );

                const tapCmd = spawn("adb", [
                  "-s",
                  scrcpyClient.deviceId,
                  "shell",
                  "input",
                  "tap",
                  actualX.toString(),
                  actualY.toString(),
                ]);
                tapCmd.stderr.on("data", (data) => {
                  const error = data.toString();
                  if (
                    error.includes("device offline") ||
                    error.includes("device not found")
                  ) {
                    log("ERROR", `Device ${scrcpyClient.deviceId} is offline`);
                    ws.send(JSON.stringify({ type: "ended" }));
                  }
                });
              }
            });
            return;
          }

          const actualX = Math.round(x * scrcpyClient.screenWidth);
          const actualY = Math.round(y * scrcpyClient.screenHeight);
          log(
            "INFO",
            `Touch: (${x.toFixed(2)}, ${y.toFixed(
              2
            )}) -> (${actualX}, ${actualY}) [Screen: ${
              scrcpyClient.screenWidth
            }x${scrcpyClient.screenHeight}]`
          );

          const cmd = spawn("adb", [
            "-s",
            scrcpyClient.deviceId,
            "shell",
            "input",
            "tap",
            actualX.toString(),
            actualY.toString(),
          ]);

          cmd.stderr.on("data", (data) => {
            const error = data.toString();
            if (
              error.includes("device offline") ||
              error.includes("device not found")
            ) {
              log("ERROR", `Device ${scrcpyClient.deviceId} is offline`);
              ws.send(JSON.stringify({ type: "ended" }));
            }
          });

          cmd.on("error", (err) =>
            log("ERROR", `Touch command error: ${err.message}`)
          );
        }
      } else if (data.action === "swipe") {
        if (!isAuthenticated) {
          log("WARNING", "Unauthorized swipe command attempt");
          ws.send(JSON.stringify({ type: "error", message: "未授权的操作" }));
          return;
        }
        const { x1, y1, x2, y2, duration } = data;
        if (scrcpyClient) {
          // 如果屏幕尺寸未知，使用默认值或跳过
          if (!scrcpyClient.screenWidth || !scrcpyClient.screenHeight) {
            log("WARN", "Screen size not available for swipe, skipping...");
            return;
          }

          const actualX1 = Math.round(x1 * scrcpyClient.screenWidth);
          const actualY1 = Math.round(y1 * scrcpyClient.screenHeight);
          const actualX2 = Math.round(x2 * scrcpyClient.screenWidth);
          const actualY2 = Math.round(y2 * scrcpyClient.screenHeight);
          log(
            "INFO",
            `Swipe: (${actualX1}, ${actualY1}) -> (${actualX2}, ${actualY2}), ${duration}ms`
          );

          const cmd = spawn("adb", [
            "-s",
            scrcpyClient.deviceId,
            "shell",
            "input",
            "swipe",
            actualX1.toString(),
            actualY1.toString(),
            actualX2.toString(),
            actualY2.toString(),
            duration.toString(),
          ]);

          cmd.stderr.on("data", (data) => {
            const error = data.toString();
            if (
              error.includes("device offline") ||
              error.includes("device not found")
            ) {
              log("ERROR", `Device ${scrcpyClient.deviceId} is offline`);
              ws.send(JSON.stringify({ type: "ended" }));
            }
          });

          cmd.on("error", (err) =>
            log("ERROR", `Swipe command error: ${err.message}`)
          );
        }
      } else if (data.action === "keyevent") {
        if (!isAuthenticated) {
          log("WARNING", "Unauthorized keyevent command attempt");
          ws.send(JSON.stringify({ type: "error", message: "未授权的操作" }));
          return;
        }
        const { keyCode } = data;
        if (scrcpyClient) {
          log("INFO", `Key event: ${keyCode}`);
          const cmd = spawn("adb", [
            "-s",
            scrcpyClient.deviceId,
            "shell",
            "input",
            "keyevent",
            keyCode.toString(),
          ]);

          cmd.stderr.on("data", (data) => {
            const error = data.toString();
            if (
              error.includes("device offline") ||
              error.includes("device not found")
            ) {
              log("ERROR", `Device ${scrcpyClient.deviceId} is offline`);
              ws.send(JSON.stringify({ type: "ended" }));
            }
          });

          cmd.on("error", (err) =>
            log("ERROR", `Key command error: ${err.message}`)
          );
        }
      }
    } catch (e) {
      log("ERROR", `Error handling message: ${e.message}`);
    }
  });

  ws.on("close", async () => {
    log("INFO", "WebSocket client disconnected");
    if (scrcpyClient) {
      await scrcpyClient.stop();
      scrcpyClient = null;
    }
  });

  ws.on("error", (error) => {
    log("ERROR", `WebSocket error: ${error.message}`);
  });
});
