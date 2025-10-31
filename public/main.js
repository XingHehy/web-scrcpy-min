const video = document.getElementById("screen");
const deviceListEl = document.getElementById("device-list");
const refreshBtn = document.getElementById("refresh");
const statusEl = document.getElementById("status");
const bitrateSelect = document.getElementById("bitrate-select");
const resolutionSelect = document.getElementById("resolution-select");
const fpsSelect = document.getElementById("fps-select");

let ws = null;
let screenWidth = 0;
let screenHeight = 0;
let frameCount = 0;
let currentDeviceId = null; // 保存当前连接的设备ID
let isConnected = false; // 连接状态标志
let allDevices = []; // 存储所有设备
let currentFilter = 'all'; // 当前过滤器
let isLoggedIn = false; // 登录状态
let authToken = null; // 认证 token

// 检查登录状态
function checkLoginStatus() {
  const token = sessionStorage.getItem('scrcpy-auth-token');
  if (token) {
    authToken = token;
    isLoggedIn = true;
    document.getElementById('login-overlay').style.display = 'none';
  }
}

// 获取认证请求头
function getAuthHeaders() {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

// 处理登录
async function handleLogin(event) {
  event.preventDefault();
  const passwordInput = document.getElementById('password-input');
  const loginError = document.getElementById('login-error');
  const password = passwordInput.value;

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password })
    });

    const data = await response.json();

    if (data.success && data.token) {
      authToken = data.token;
      isLoggedIn = true;
      sessionStorage.setItem('scrcpy-auth-token', data.token);
      document.getElementById('login-overlay').style.display = 'none';
      showStatus('登录成功', 'success');
      fetchDevices(); // 登录后加载设备列表
    } else {
      loginError.textContent = data.message || '密码错误';
      loginError.style.display = 'block';
      passwordInput.value = '';
      passwordInput.focus();
    }
  } catch (error) {
    console.error('Login error:', error);
    loginError.textContent = '登录失败，请检查网络连接';
    loginError.style.display = 'block';
  }
}

// 连接设备
async function connectDevice() {
  const input = document.getElementById('device-address-input');
  const address = input.value.trim();

  if (!address) {
    showStatus('请输入设备地址', 'error');
    return;
  }

  try {
    showStatus('正在连接设备...', 'info');
    const response = await fetch('/api/connect', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ address })
    });

    const data = await response.json();

    if (data.success) {
      showStatus(data.message, 'success');
      input.value = '';
      // 等待一下再刷新设备列表
      setTimeout(() => fetchDevices(), 1000);
    } else {
      showStatus(data.message, 'error');
    }
  } catch (error) {
    console.error('Connect error:', error);
    showStatus('连接失败，请检查网络', 'error');
  }
}

// 断开设备
async function disconnectDevice() {
  const input = document.getElementById('device-address-input');
  const address = input.value.trim();

  if (!address) {
    showStatus('请输入设备地址', 'error');
    return;
  }

  try {
    showStatus('正在断开设备...', 'info');
    const response = await fetch('/api/disconnect', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ address })
    });

    const data = await response.json();

    if (data.success) {
      showStatus(data.message, 'success');
      input.value = '';
      // 等待一下再刷新设备列表
      setTimeout(() => fetchDevices(), 1000);
    } else {
      showStatus(data.message, 'error');
    }
  } catch (error) {
    console.error('Disconnect error:', error);
    showStatus('断开失败，请检查网络', 'error');
  }
}

// 从 localStorage 加载设置
function loadSettings() {
  // 清除旧的模式设置（已废弃）
  localStorage.removeItem('scrcpy-mode');

  const savedBitrate = localStorage.getItem('scrcpy-bitrate');
  const savedResolution = localStorage.getItem('scrcpy-resolution');
  const savedFps = localStorage.getItem('scrcpy-fps');

  if (savedBitrate) bitrateSelect.value = savedBitrate;
  if (savedResolution) resolutionSelect.value = savedResolution;
  if (savedFps) fpsSelect.value = savedFps;
}

// 保存设置到 localStorage
function saveSettings() {
  localStorage.setItem('scrcpy-bitrate', bitrateSelect.value);
  localStorage.setItem('scrcpy-resolution', resolutionSelect.value);
  localStorage.setItem('scrcpy-fps', fpsSelect.value);
}

// 监听码率、分辨率和帧率变化
bitrateSelect.addEventListener('change', () => {
  saveSettings();
  // 如果已连接设备，重新连接
  if (currentDeviceId && ws && ws.readyState === WebSocket.OPEN) {
    showStatus("参数已更改，正在重新连接...", "info");
    startScrcpy(currentDeviceId);
  }
});

resolutionSelect.addEventListener('change', () => {
  saveSettings();
  // 如果已连接设备，重新连接
  if (currentDeviceId && ws && ws.readyState === WebSocket.OPEN) {
    showStatus("参数已更改，正在重新连接...", "info");
    startScrcpy(currentDeviceId);
  }
});

fpsSelect.addEventListener('change', () => {
  saveSettings();
  // 如果已连接设备，重新连接
  if (currentDeviceId && ws && ws.readyState === WebSocket.OPEN) {
    showStatus("参数已更改，正在重新连接...", "info");
    startScrcpy(currentDeviceId);
  }
});

// H264 解码相关
let videoDecoder = null;
let canvas = null;
let ctx = null;
let h264Timestamp = 0;

// 触摸/鼠标状态
let isDragging = false;
let startX = 0;
let startY = 0;
let lastTouchTime = 0;

// 显示状态消息
function showStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.style.display = "block";

  if (type !== "error") {
    setTimeout(() => {
      statusEl.style.display = "none";
    }, 3000);
  }
}

// 获取设备列表
async function fetchDevices() {
  try {
    const res = await fetch("/devices", {
      headers: getAuthHeaders()
    });

    // 检查是否未授权
    if (res.status === 401) {
      showStatus('登录已过期，请重新登录', 'error');
      sessionStorage.removeItem('scrcpy-auth-token');
      authToken = null;
      isLoggedIn = false;
      document.getElementById('login-overlay').style.display = 'flex';
      return;
    }

    const data = await res.json();
    allDevices = data.devices;

    if (allDevices.length === 0) {
      deviceListEl.innerHTML = '<div class="loading">未检测到设备，请检查 ADB 连接</div>';
      updateDeviceCounts(0, 0, 0);
      return;
    }

    // 统计设备数量
    const totalCount = allDevices.length;
    const onlineCount = allDevices.filter(d => d.state === "device").length;
    const offlineCount = allDevices.filter(d => d.state === "offline").length;

    // 更新设备统计显示
    updateDeviceCounts(totalCount, onlineCount, offlineCount);

    // 显示设备列表
    renderDevices();

    showStatus(`找到 ${allDevices.length} 个设备`, "success");
  } catch (e) {
    console.error("Failed to fetch devices:", e);
    showStatus("无法获取设备列表，请检查服务器连接", "error");
    updateDeviceCounts(0, 0, 0);
  }
}

// 更新设备数量统计
function updateDeviceCounts(total, online, offline) {
  document.getElementById("count-all").textContent = total;
  document.getElementById("count-online").textContent = online;
  document.getElementById("count-offline").textContent = offline;
}

// 渲染设备列表
function renderDevices() {
  deviceListEl.innerHTML = "";

  let devicesToShow = allDevices;

  // 根据当前过滤器筛选设备
  if (currentFilter === 'online') {
    devicesToShow = allDevices.filter(d => d.state === "device");
  } else if (currentFilter === 'offline') {
    devicesToShow = allDevices.filter(d => d.state === "offline");
  }

  if (devicesToShow.length === 0) {
    const filterText = currentFilter === 'online' ? '在线' : currentFilter === 'offline' ? '离线' : '';
    deviceListEl.innerHTML = `<div class="loading">没有${filterText}设备</div>`;
    return;
  }

  devicesToShow.forEach((dev) => {
    const btn = document.createElement("button");
    btn.className = "device-btn";
    // 如果是当前连接的设备，添加选中状态
    if (currentDeviceId === dev.id) {
      btn.classList.add("selected");
    }
    btn.textContent = `${dev.id} (${dev.state})`;
    btn.disabled = dev.state !== "device";
    btn.onclick = () => startScrcpy(dev.id);
    deviceListEl.appendChild(btn);
  });
}

// 存储 SPS 和 PPS
let spsData = null;
let ppsData = null;
let waitingForKeyFrame = false; // 配置后等待关键帧

// 提取 NAL unit
function extractNALUnit(data, startIndex) {
  // 找到下一个起始码
  for (let i = startIndex + 4; i < data.length - 3; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
      return data.slice(startIndex + 4, i);
    }
  }
  // 如果没找到下一个起始码，返回到末尾
  return data.slice(startIndex + 4);
}

// 创建 avcC 格式的 description
function createAvcCDescription(sps, pps) {
  const avcC = new Uint8Array(11 + sps.length + pps.length);
  let offset = 0;

  avcC[offset++] = 1; // configurationVersion
  avcC[offset++] = sps[1]; // AVCProfileIndication
  avcC[offset++] = sps[2]; // profile_compatibility
  avcC[offset++] = sps[3]; // AVCLevelIndication
  avcC[offset++] = 0xFF; // lengthSizeMinusOne (4 bytes)
  avcC[offset++] = 0xE1; // numOfSequenceParameterSets (1)

  // SPS length (big endian)
  avcC[offset++] = (sps.length >> 8) & 0xFF;
  avcC[offset++] = sps.length & 0xFF;

  // SPS data
  avcC.set(sps, offset);
  offset += sps.length;

  // numOfPictureParameterSets
  avcC[offset++] = 1;

  // PPS length (big endian)
  avcC[offset++] = (pps.length >> 8) & 0xFF;
  avcC[offset++] = pps.length & 0xFF;

  // PPS data
  avcC.set(pps, offset);

  return avcC;
}

// 将 Annex B 格式转换为 AVCC 格式（起始码 -> 长度前缀）
function annexBToAvcc(data) {
  const result = [];
  let i = 0;

  while (i < data.length) {
    // 查找起始码
    if (i + 3 < data.length &&
      data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {

      // 找到下一个起始码或数据末尾
      let nextStart = data.length;
      for (let j = i + 4; j < data.length - 3; j++) {
        if (data[j] === 0 && data[j + 1] === 0 && data[j + 2] === 0 && data[j + 3] === 1) {
          nextStart = j;
          break;
        }
      }

      // NAL unit 数据（不包括起始码）
      const nalUnit = data.slice(i + 4, nextStart);
      const nalLength = nalUnit.length;

      // 写入长度（4字节，大端序）
      result.push((nalLength >> 24) & 0xFF);
      result.push((nalLength >> 16) & 0xFF);
      result.push((nalLength >> 8) & 0xFF);
      result.push(nalLength & 0xFF);

      // 写入 NAL unit 数据
      result.push(...nalUnit);

      i = nextStart;
    } else {
      i++;
    }
  }

  return new Uint8Array(result);
}

// 初始化 H264 解码器（WebCodecs）
function initH264Decoder() {
  if (!('VideoDecoder' in window)) {
    showStatus("浏览器不支持 WebCodecs，请使用 Chrome 94+", "error");
    return false;
  }

  // 创建 Canvas（用于 H264 渲染）
  if (!canvas) {
    video.style.display = 'none';
    canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.maxHeight = '70vh';
    canvas.style.objectFit = 'contain';
    canvas.style.backgroundColor = '#000';
    canvas.id = 'videoCanvas';
    video.parentNode.insertBefore(canvas, video);
    ctx = canvas.getContext('2d');

    // 更新事件监听目标
    setupCanvasEvents();
  }

  try {
    let isConfigured = false;

    videoDecoder = new VideoDecoder({
      output: (frame) => {
        console.log(`Frame decoded! ${frame.displayWidth}x${frame.displayHeight}, timestamp: ${frame.timestamp}`);
        // 调整 Canvas 尺寸
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
          console.log(`Canvas resized to ${frame.displayWidth}x${frame.displayHeight}`);
        }
        // 渲染帧
        ctx.drawImage(frame, 0, 0);
        frame.close();
        console.log(`Frame rendered to canvas`);
      },
      error: (e) => {
        console.error("VideoDecoder error:", e);
        showStatus(`解码错误: ${e.message}`, "error");
      }
    });

    // 暂时不配置，等收到第一个 SPS/PPS 数据
    console.log("H264 decoder created (will configure on first SPS/PPS)");
    return true;
  } catch (e) {
    console.error("Failed to init H264 decoder:", e);
    showStatus("无法初始化 H264 解码器", "error");
    return false;
  }
}

// 重置解码器（切换模式时）
function resetDecoder() {
  if (videoDecoder) {
    try {
      videoDecoder.close();
    } catch (e) {
      // ignore
    }
    videoDecoder = null;
  }

  spsData = null;
  ppsData = null;
  waitingForKeyFrame = false;

  if (canvas) {
    canvas.style.display = 'none';
  }

  video.style.display = 'none'; // 初始隐藏，等待画面
  h264Timestamp = 0;
  frameCount = 0;
}

// 显示加载动画
function showLoader(text = "正在连接设备...") {
  const loader = document.getElementById("screen-loader");
  if (loader) {
    loader.querySelector(".loader-text").textContent = text;
    loader.style.display = "flex";
  }
}

// 隐藏加载动画
function hideLoader() {
  const loader = document.getElementById("screen-loader");
  if (loader) {
    loader.style.display = "none";
  }
}

// 显示占位提示
function showPlaceholder() {
  const placeholder = document.getElementById("screen-placeholder");
  if (placeholder) {
    placeholder.style.display = "flex";
  }
  video.style.display = "none";
  if (canvas) {
    canvas.style.display = "none";
  }
}

// 隐藏占位提示
function hidePlaceholder() {
  const placeholder = document.getElementById("screen-placeholder");
  if (placeholder) {
    placeholder.style.display = "none";
  }
}

// 显示断开连接遮罩
function showBrokenScreen() {
  const brokenScreen = document.getElementById("screen-broken");
  if (brokenScreen) {
    brokenScreen.style.display = "flex";
  }
}

// 隐藏断开连接遮罩
function hideBrokenScreen() {
  const brokenScreen = document.getElementById("screen-broken");
  if (brokenScreen) {
    brokenScreen.style.display = "none";
  }
}

// 清除屏幕画面
function clearScreen() {
  // 清除 video 的 src
  if (video.src && video.src.startsWith('blob:')) {
    URL.revokeObjectURL(video.src);
  }
  video.src = "";
  video.removeAttribute('src');

  // 清除 canvas
  if (canvas && ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // 显示占位提示
  showPlaceholder();

  // 隐藏断开连接遮罩
  hideBrokenScreen();
}

// 连接设备
function startScrcpy(deviceId) {
  currentDeviceId = deviceId; // 保存当前设备ID

  // 更新设备列表显示（标记选中状态）
  renderDevices();

  // 先关闭旧的 WebSocket（在设置 isConnected 之前，避免触发断开遮罩）
  if (ws) {
    isConnected = false; // 临时设置为 false，避免旧连接的 onclose 触发遮罩
    ws.close();
    ws = null;
  }

  // 清除原有画面
  clearScreen();

  // 确保隐藏断开遮罩（重新连接时）
  hideBrokenScreen();

  // 显示加载动画
  showLoader(`正在启动 H264 视频流...`);

  showStatus(`正在启动 H264 视频流...`, "info");

  // 重置状态
  resetDecoder();

  // 初始化解码器
  if (!initH264Decoder()) {
    showStatus("H264 模式不可用，请使用支持 WebCodecs 的浏览器 (Chrome 94+)", "error");
    hideLoader();
    showPlaceholder();
    return;
  }
  video.style.display = 'none';
  canvas.style.display = 'none'; // 初始隐藏，等待第一帧
  console.log(`Canvas will be displayed when first frame arrives`);

  // 根据当前页面协议自动选择 ws:// 或 wss://
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;
  console.log(`Connecting to WebSocket: ${wsUrl}`);

  ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    console.log(`WebSocket connected`);

    // WebSocket 连接成功后，设置为已连接状态
    isConnected = true;

    const startConfig = {
      action: "start",
      deviceId,
      bitrate: parseInt(bitrateSelect.value),
      maxSize: parseInt(resolutionSelect.value),
      maxFps: parseInt(fpsSelect.value),
      token: authToken // 传递认证 token
    };

    console.log(`Bitrate: ${startConfig.bitrate / 1000000} Mbps, Resolution: ${startConfig.maxSize}p, FPS: ${startConfig.maxFps}`);

    ws.send(JSON.stringify(startConfig));
    showStatus(`已连接，正在启动...`, "info");
  };

  ws.onmessage = async (event) => {
    if (typeof event.data === "string") {
      const msg = JSON.parse(event.data);
      console.log("Received:", msg);

      if (msg.type === "error") {
        showStatus(msg.message, "error");
        // 如果是认证错误，返回登录页面
        if (msg.message.includes("未授权") || msg.message.includes("登录")) {
          sessionStorage.removeItem('scrcpy-auth-token');
          authToken = null;
          isLoggedIn = false;
          document.getElementById('login-overlay').style.display = 'flex';
          if (ws) {
            ws.close();
          }
        }
      } else if (msg.type === "screenSize") {
        screenWidth = msg.width;
        screenHeight = msg.height;
        console.log(`Screen size: ${screenWidth}x${screenHeight}`);
        video.style.aspectRatio = `${screenWidth}/${screenHeight}`;
        showStatus(`正在接收画面...`, "success");
        showLoader("正在接收画面...");
      } else if (msg.type === "ended") {
        showStatus("设备已断开连接", "error");
        isConnected = false; // 设置为未连接状态
        showBrokenScreen(); // 显示断开连接遮罩
        hideLoader();
      }
    } else {
      // 二进制数据 - H264 视频流
      frameCount++;
      if (frameCount <= 5 || frameCount % 50 === 0) {
        console.log(`Frame ${frameCount}: ${event.data.byteLength} bytes`);
      }

      // 使用 WebCodecs 解码
      if (videoDecoder) {
        try {
          const data = new Uint8Array(event.data);

          // 提取 SPS 和 PPS（如果还没有）
          if (!spsData || !ppsData) {
            for (let i = 0; i < data.length - 4; i++) {
              if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
                const nalType = data[i + 4] & 0x1F;

                if (nalType === 7 && !spsData) { // SPS
                  spsData = extractNALUnit(data, i);
                  console.log(`Extracted SPS: ${spsData.length} bytes`);
                } else if (nalType === 8 && !ppsData) { // PPS
                  ppsData = extractNALUnit(data, i);
                  console.log(`Extracted PPS: ${ppsData.length} bytes`);
                }

                if (spsData && ppsData) break;
              }
            }
          }

          // 配置解码器（当有 SPS 和 PPS 且还未配置时）
          if (videoDecoder.state === 'unconfigured' && spsData && ppsData) {
            console.log("Configuring H264 decoder with avcC description...");

            const avcC = createAvcCDescription(spsData, ppsData);
            console.log(`avcC description created: ${avcC.length} bytes`);

            videoDecoder.configure({
              codec: 'avc1.42E01E', // H.264 Baseline Profile
              codedWidth: screenWidth || 1080,
              codedHeight: screenHeight || 1920,
              optimizeForLatency: true,
              hardwareAcceleration: 'prefer-hardware',
              description: avcC
            });

            console.log("H264 decoder configured with description");
            waitingForKeyFrame = true; // 配置后等待第一个关键帧
            console.log("Waiting for first IDR frame...");
            return;
          }

          // 只在配置后解码帧
          if (videoDecoder.state === 'configured') {
            // 检查这一帧的类型
            let isKeyFrame = false;
            for (let i = 0; i < Math.min(data.length - 4, 100); i++) {
              if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
                const nalType = data[i + 4] & 0x1F;
                if (nalType === 5) { // IDR
                  isKeyFrame = true;
                  console.log("Found IDR frame (NAL type 5)");
                  break;
                } else if (nalType === 1) {
                  console.log("Found non-IDR frame (NAL type 1)");
                  break;
                }
              }
            }

            // 跳过纯配置帧（只有 SPS/PPS）
            let hasOnlyConfig = true;
            for (let i = 0; i < data.length - 4; i++) {
              if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
                const nalType = data[i + 4] & 0x1F;
                if (nalType !== 7 && nalType !== 8) {
                  hasOnlyConfig = false;
                  break;
                }
              }
            }

            if (!hasOnlyConfig) {
              // 如果在等待关键帧，跳过非关键帧
              if (waitingForKeyFrame && !isKeyFrame) {
                console.log(`Skipping DELTA frame ${frameCount}, waiting for IDR...`);
                return;
              }

              console.log(`Decoding frame ${frameCount}, type: ${isKeyFrame ? 'KEY' : 'DELTA'}, size: ${event.data.byteLength} bytes`);

              // 转换为 AVCC 格式
              const avccData = annexBToAvcc(data);
              console.log(`Converted to AVCC: ${data.byteLength} -> ${avccData.byteLength} bytes`);

              const chunk = new EncodedVideoChunk({
                type: isKeyFrame ? 'key' : 'delta',
                timestamp: h264Timestamp * 16666,
                data: avccData
              });

              h264Timestamp++;

              try {
                videoDecoder.decode(chunk);
                console.log(`Decode queued, decoder queue size: ${videoDecoder.decodeQueueSize}`);

                // 如果这是配置后的第一个关键帧，清除等待标志
                if (waitingForKeyFrame && isKeyFrame) {
                  waitingForKeyFrame = false;
                  console.log("First IDR frame decoded, now accepting all frames");
                  showStatus("H264 视频流已启动", "success");
                  hideLoader();
                  hidePlaceholder();
                  if (canvas) {
                    canvas.style.display = 'block';
                  }
                }
              } catch (err) {
                console.error(`Decode failed:`, err);
              }
            }
          }
        } catch (e) {
          if (frameCount <= 10) {
            console.error("Decode error:", e);
          }
        }
      }
    }
  };

  ws.onclose = () => {
    console.log("WebSocket disconnected");
    showStatus("设备已断开连接", "error");
    hideLoader();

    // 如果之前是连接状态，显示断开遮罩
    if (isConnected) {
      isConnected = false; // 设置为未连接状态
      showBrokenScreen();
    } else {
      clearScreen(); // 清除画面并显示占位提示
    }

    currentDeviceId = null; // 清除设备ID
    renderDevices(); // 更新设备列表显示（移除选中状态）
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    showStatus("WebSocket 连接错误", "error");
    hideLoader();
  };
}

// 获取相对坐标（自动适配 canvas）
function getRelativePosition(event) {
  const element = canvas || video;
  const rect = element.getBoundingClientRect();
  let clientX, clientY;

  if (event.touches && event.touches.length > 0) {
    clientX = event.touches[0].clientX;
    clientY = event.touches[0].clientY;
  } else {
    clientX = event.clientX;
    clientY = event.clientY;
  }

  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;

  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

// 发送触摸事件
function sendTouch(x, y) {
  if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket not connected");
    showStatus("设备未连接，无法操作", "error");
    return;
  }

  console.log(`Sending touch: (${x.toFixed(2)}, ${y.toFixed(2)})`);
  ws.send(JSON.stringify({
    action: "touch",
    x,
    y
  }));
}

// 发送滑动事件
function sendSwipe(x1, y1, x2, y2, duration) {
  if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket not connected");
    showStatus("设备未连接，无法操作", "error");
    return;
  }

  console.log(`Sending swipe: (${x1.toFixed(2)}, ${y1.toFixed(2)}) -> (${x2.toFixed(2)}, ${y2.toFixed(2)}), ${duration}ms`);
  ws.send(JSON.stringify({
    action: "swipe",
    x1,
    y1,
    x2,
    y2,
    duration
  }));
}

// 发送按键事件
function sendKey(keyCode) {
  if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
    showStatus("设备未连接，无法操作", "error");
    return;
  }

  ws.send(JSON.stringify({
    action: "keyevent",
    keyCode
  }));
}

// 鼠标事件
video.addEventListener("mousedown", (e) => {
  e.preventDefault();
  const pos = getRelativePosition(e);
  isDragging = true;
  startX = pos.x;
  startY = pos.y;
  lastTouchTime = Date.now();
});

video.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  e.preventDefault();
});

video.addEventListener("mouseup", (e) => {
  if (!isDragging) return;
  e.preventDefault();

  const pos = getRelativePosition(e);
  const endX = pos.x;
  const endY = pos.y;
  const duration = Date.now() - lastTouchTime;

  const distance = Math.sqrt(
    Math.pow((endX - startX) * screenWidth, 2) +
    Math.pow((endY - startY) * screenHeight, 2)
  );

  if (distance < 10 && duration < 300) {
    sendTouch(startX, startY);
  } else {
    sendSwipe(startX, startY, endX, endY, Math.min(duration, 500));
  }

  isDragging = false;
});

// 触摸事件
video.addEventListener("touchstart", (e) => {
  e.preventDefault();
  const pos = getRelativePosition(e);
  isDragging = true;
  startX = pos.x;
  startY = pos.y;
  lastTouchTime = Date.now();
});

video.addEventListener("touchmove", (e) => {
  e.preventDefault();
});

video.addEventListener("touchend", (e) => {
  if (!isDragging) return;
  e.preventDefault();

  const pos = getRelativePosition(e.changedTouches[0]);
  const endX = pos.x;
  const endY = pos.y;
  const duration = Date.now() - lastTouchTime;

  const distance = Math.sqrt(
    Math.pow((endX - startX) * screenWidth, 2) +
    Math.pow((endY - startY) * screenHeight, 2)
  );

  if (distance < 10 && duration < 300) {
    sendTouch(startX, startY);
  } else {
    sendSwipe(startX, startY, endX, endY, Math.min(duration, 500));
  }

  isDragging = false;
});

// 滚轮事件（JPEG 模式使用）
video.addEventListener("wheel", handleWheel, { passive: false });

// 滚轮滚动处理
function handleWheel(e) {
  e.preventDefault();

  const pos = getRelativePosition(e);
  const centerX = pos.x;
  const centerY = pos.y;

  // 根据滚轮方向模拟滑动
  const scrollAmount = 0.15; // 滚动距离（屏幕高度的15%）

  let startY, endY;
  if (e.deltaY < 0) {
    // 向上滚动：从下往上滑
    startY = Math.min(centerY + scrollAmount, 0.9);
    endY = Math.max(centerY - scrollAmount, 0.1);
  } else {
    // 向下滚动：从上往下滑
    startY = Math.max(centerY - scrollAmount, 0.1);
    endY = Math.min(centerY + scrollAmount, 0.9);
  }

  // 发送滑动命令
  sendSwipe(centerX, startY, centerX, endY, 200);
}

// 为 Canvas 设置事件监听（H264 模式使用）
function setupCanvasEvents() {
  if (!canvas) return;

  canvas.addEventListener("mousedown", handleMouseDown);
  canvas.addEventListener("mousemove", handleMouseMove);
  canvas.addEventListener("mouseup", handleMouseUp);
  canvas.addEventListener("touchstart", handleTouchStart);
  canvas.addEventListener("touchmove", handleTouchMove);
  canvas.addEventListener("touchend", handleTouchEnd);
  canvas.addEventListener("wheel", handleWheel, { passive: false });
}

// 统一的事件处理函数
function handleMouseDown(e) {
  e.preventDefault();
  const pos = getRelativePosition(e);
  isDragging = true;
  startX = pos.x;
  startY = pos.y;
  lastTouchTime = Date.now();
}

function handleMouseMove(e) {
  if (!isDragging) return;
  e.preventDefault();
}

function handleMouseUp(e) {
  if (!isDragging) return;
  e.preventDefault();

  const pos = getRelativePosition(e);
  const endX = pos.x;
  const endY = pos.y;
  const duration = Date.now() - lastTouchTime;

  const distance = Math.sqrt(
    Math.pow((endX - startX) * screenWidth, 2) +
    Math.pow((endY - startY) * screenHeight, 2)
  );

  if (distance < 10 && duration < 300) {
    sendTouch(startX, startY);
  } else {
    sendSwipe(startX, startY, endX, endY, Math.min(duration, 500));
  }

  isDragging = false;
}

function handleTouchStart(e) {
  e.preventDefault();
  const pos = getRelativePosition(e);
  isDragging = true;
  startX = pos.x;
  startY = pos.y;
  lastTouchTime = Date.now();
}

function handleTouchMove(e) {
  e.preventDefault();
}

function handleTouchEnd(e) {
  if (!isDragging) return;
  e.preventDefault();

  const pos = getRelativePosition(e.changedTouches[0]);
  const endX = pos.x;
  const endY = pos.y;
  const duration = Date.now() - lastTouchTime;

  const distance = Math.sqrt(
    Math.pow((endX - startX) * screenWidth, 2) +
    Math.pow((endY - startY) * screenHeight, 2)
  );

  if (distance < 10 && duration < 300) {
    sendTouch(startX, startY);
  } else {
    sendSwipe(startX, startY, endX, endY, Math.min(duration, 500));
  }

  isDragging = false;
}

// 刷新设备按钮
refreshBtn.onclick = fetchDevices;

// 标签页切换
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // 更新激活状态
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // 更新过滤器
    currentFilter = btn.dataset.filter;

    // 重新渲染设备列表
    renderDevices();
  });
});

// 切换主标签页
function switchMainTab(tabName) {
  // 更新标签按钮状态
  document.querySelectorAll('.main-tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');

  // 更新内容显示
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById('tab-' + tabName).classList.add('active');
}

// 初始化
checkLoginStatus(); // 先检查登录状态
loadSettings();
if (isLoggedIn) {
  fetchDevices();
}
