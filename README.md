# DeepSeek Harness 桌面启动器

将 `npx @deepseek-ai/dsh web` 封装成一个双击即用的 Windows `.exe`，带大肥鱼图标，**无任何终端窗口**。

## 效果

- 双击 `DeepSeek-Harness.exe` → 静默启动 dsh web → 自动在浏览器打开 `http://127.0.0.1:3080` → **最小化到系统托盘**
- 如果 dsh web 已在运行，直接打开浏览器（不会重复启动）
- 启动前自动检测 Node.js 环境
- **托盘右键菜单**：打开浏览器 / 退出（退出时会一并停止服务）

## 文件结构

```
dsh-destop/
├── src/
│   ├── Launcher.cs           # C# 启动器主程序（GUI exe 入口，含系统托盘）
│   └── stop.js               # 停止服务的辅助脚本（托盘内嵌逻辑与之相同）
├── scripts/
│   ├── compile-cs.js         # C# 编译编排（生成最终 exe）
│   └── make-icon.js          # PNG → ICO 转换
├── assets/
│   └── whale.png             # 图标源图（透明 PNG，可替换以自定义图标）
├── build/                    # 构建中间产物（icon.ico）
├── dist/                     # 最终产物 DeepSeek-Harness.exe
├── package.json
├── build.bat                 # 一键构建（双击即可）
├── compile-launcher.bat      # 直接编译 C# 启动器（已有图标时）
├── stop.bat                  # 停止服务（双击即可）
└── README.md
```

## 打包步骤

### 前提条件

- [.NET Framework 4.x](https://dotnet.microsoft.com)（Windows 自带）
- [Node.js](https://nodejs.org) LTS（≥18，仅在需要重新生成图标时用到）
- [Git](https://git-scm.com)（用于拉取项目）

### 获取项目

```bash
# 克隆项目
git clone https://github.com/Woaiwojia1116/DSH-Harness-Quick.git
cd DSH-Harness-Quick

# 安装依赖（构建图标需要 sharp 和 png-to-ico）
npm install
```

> 如果项目已有更新，进入项目目录后执行 `git pull` 拉取最新代码，再重新构建即可。

### 一键构建

双击 **`build.bat`**，它会自动：

1. 检查 .NET C# 编译器
2. 检查/生成图标
3. 编译 C# 启动器为 GUI exe

产物在 `dist/DeepSeek-Harness.exe`（约 286 KB），复制到桌面即可。

### 直接编译（无需 Node.js）

如果图标已经生成（`build/icon.ico` 已存在），可以直接双击 **`compile-launcher.bat`**，无需 Node.js。

### 手动步骤

```bash
# 1. 准备图标（把大肥鱼 PNG 放到 assets/whale.png 后执行一次）
npm run build:icon

# 2. 编译 C# 启动器
npm run build:exe
```

### 自定义图标

启动器的图标（exe 图标 + 系统托盘图标）支持自定义，**在构建时指定**，运行时无法切换。步骤如下：

1. **替换源图片**：把你的透明 PNG 图标替换 `assets/whale.png`（任意尺寸，会自动缩放到 256×256），并删除build目录下的.ico文件
2. **重新生成图标并编译**：运行 `build.bat`（或依次执行 `npm run build:icon` + `npm run build:exe`）

> **注意**：托盘图标和 exe 图标是同一个。运行时托盘图标通过 `Icon.ExtractAssociatedIcon` 从编译好的 exe 自身读取，因此无法让托盘图标与 exe 图标不同。

如果 `assets/whale.png` 缺失，构建不会失败，会回退到默认托盘图标。

替换之后的dist目录下显示的仍是之前的图标，但是实际已经替换，重启资源管理器即可显示最新图标。

## 系统托盘

启动完成后程序常驻系统托盘（大肥鱼图标），右键图标弹出菜单：

| 菜单项 | 作用 |
| --- | --- |
| **打开 DeepSeek Harness** | 若服务未运行则先启动，再打开浏览器 |
| **重启** | 停止当前服务并重新启动 dsh web，就绪后自动打开浏览器 |
| **退出** | 停止服务 + 关闭托盘 |

托盘提示文字会显示当前状态（正在运行 / 已停止）。停止逻辑内嵌在 exe 中，分发的单文件也无需附带 `node` 即可停止服务。

## 停止服务

除了托盘菜单，仍可用以下任一方式停止（效果相同）：

- 双击 **`stop.bat`**
- 命令行：`node src/stop.js` 或 `npm run stop`

停止逻辑分两层：

1. **PID 文件精准杀**（默认）：启动器在 spawn dsh 服务时把它的 PID 写入临时目录的 `deepseek-harness-dsh.pid`。停止时先读该 PID，验证它仍存活且命令行含 `dsh`/`deepseek-ai`（防 PID 复用误杀），然后用 `taskkill /PID <pid> /T /F` 精准杀掉整棵进程树。
2. **`wmic` 扫描兜底**：如果 PID 文件不存在（旧版启动器、崩溃残留等），回退到列出全部 `node.exe`、按命令行特征匹配后逐个击杀。

托盘菜单的 C# 内嵌版本执行同一套两段式逻辑。

## 常见问题

### 双击后没反应 / 浏览器空白页
- 第一次启动 dsh web 需要几秒到几十秒（下载依赖、构建前端）。启动器会轮询端口直到服务就绪再开浏览器。
- 如果 60 秒内没起来，会提示并仍尝试打开浏览器。点击确定即可。

### 「Node.js required」提示
- 系统未安装 Node.js，或未加入 PATH。安装 LTS 版后重试。

### 端口 3080 被占用
- 启动器会检测到端口已开放就直接开浏览器。如果是别的程序占了 3080，关掉那个程序或换端口（改 `src/Launcher.cs` 的 `Port`）。

### 重复启动
- 启动器有单实例 Mutex（`DeepSeekHarnessLauncher`），双击多次不会重复启动。

### 重新构建 / 图标没变
- 替换 `assets/whale.png` 后，删除 `build/icon.ico` 和 `dist/`，再重新运行 `build.bat`。详见上方「自定义图标」。

## 技术细节

- **GUI 子系统**：C# `/target:winexe` 编译，PE 子系统为 `IMAGE_SUBSYSTEM_WINDOWS_GUI`（2），永不弹出控制台窗口
- **图标嵌入**：C# 编译器 `/win32icon` 直接嵌入 .ico；托盘图标通过 `Icon.ExtractAssociatedIcon` 从自身 exe 读取，分发单文件无需外部 .ico
- **系统托盘**：`NotifyIcon` + `ContextMenuStrip`，启动完成后常驻；`Application.Run()` 进入消息循环
- **端口检测**：TCP 连接 `127.0.0.1:3080`，不用固定 `setTimeout`
- **单实例**：命名 Mutex 防止重复启动
- **停止逻辑内嵌**：两段式 — PID 文件精准杀 + `wmic` 扫描兜底，C# 复刻 `src/stop.js`，无需 node 即可停止服务
- **体积**：~.NET 原生 exe，约 290 KB，无需捆绑 Node.js 运行时
