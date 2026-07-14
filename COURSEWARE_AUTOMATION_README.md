# OpenMAIC 本地课件批量生成、自检修复与归档说明

本文说明如何在 Windows 本地批量生成 OpenMAIC 课件，自动完成逐节结构检查、全局浏览器截图检查和一次 AI 布局修复，并将通过检查的 `.maic.zip` 按模型归档到指定文件夹。

## 一、先理解两个不同入口

### 1. 新生成的课件

网页生成和批量脚本都走完整流水线：

1. 每个场景生成后执行结构检查和确定性安全修复。
2. 全部场景生成后保存可渲染草稿。
3. Playwright Chromium 以 `1600x900` 逐页渲染并截图。
4. 检测文字溢出、元素越界、明显重叠、图片失败、控制台错误和请求失败。
5. 对文字溢出和明显重叠调用现有 Pro Mode `regenerate_scene` 后端修复一次。
6. 重新截图复检；严重问题未清零则阻止归档并保留证据。
7. 通过后生成包含课堂、媒体、音频、检查报告和截图的 `.maic.zip`。

### 2. 导入的 `.maic.zip`

导入课件后可以立即点击课程顶部的盾牌按钮进行结构检查，不需要先重新生成。

- “应用安全修复”只处理能够确定正确答案的问题，例如缺失 ID、重复顺序、错误的课程关联和缺失 doctype。
- “定位并进入 Pro Mode”只负责切换到问题场景并打开编辑器，不会在点击瞬间自动修改内容。
- 非数字尺寸、零尺寸、答案语义、互动逻辑等问题不能靠固定规则猜测正确值，需要在 Pro Mode 中手动编辑或使用右侧 Edit with AI。
- 同一页有多个非法元素时会显示多条问题，点击其中任意一条都会进入同一问题页，不需要逐个点击。

如果点击后没有进入 Pro Mode，请确认 `.env.local` 中有：

```dotenv
NEXT_PUBLIC_MAIC_EDITOR_ENABLED=true
```

修改 `NEXT_PUBLIC_*` 变量后必须重启 `pnpm dev`。当前版本已用真实导入 ZIP 验证：按钮会跳转到对应页并进入 Pro Mode。

## 二、环境准备

要求：

- Node.js `>=20.9.0`
- pnpm `10.x`
- PowerShell 5.1 或 7+
- 已安装 Playwright Chromium
- 至少配置一个可用的 LLM 服务

首次安装：

```powershell
cd D:\Projects\OpenMAIC
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
Copy-Item .env.example .env.local
```

在 `.env.local` 中配置模型供应商。以下仅为格式示例：

```dotenv
OPENAI_API_KEY=你的密钥
OPENAI_MODELS=gpt-5.5

DEEPSEEK_API_KEY=你的密钥
DEEPSEEK_MODELS=deepseek-v4-pro

NEXT_PUBLIC_MAIC_EDITOR_ENABLED=true
```

模型写法必须是 `provider:model`，例如：

- `openai:gpt-5.5`
- `deepseek:deepseek-v4-pro`
- `qwen:qwen3.7-plus`

## 三、配置输出目录和模型分组

在 `.env.local` 中设置：

```dotenv
OPENMAIC_COURSEWARE_OUTPUT_DIR=D:\Courseware\OpenMAIC
OPENMAIC_COURSEWARE_GROUP_BY_MODEL=true
```

默认会按实际解析到的模型创建子目录：

```text
D:\Courseware\OpenMAIC\
├── openai_gpt-5.5\
│   └── 函数极限入门__openai_gpt-5.5__20260715T010203Z.maic.zip
└── deepseek_deepseek-v4-pro\
    └── Python循环__deepseek_deepseek-v4-pro__20260715T020304Z.maic.zip
```

设置 `OPENMAIC_COURSEWARE_GROUP_BY_MODEL=false` 可恢复为单层输出目录。未设置输出目录时，默认根目录是 `data/courseware-output`。

## 四、编写批量任务

复制示例配置：

```powershell
Copy-Item .\scripts\courseware-batch.example.json .\courseware-batch.local.json
```

编辑 `courseware-batch.local.json`：

```json
{
  "baseUrl": "http://127.0.0.1:3000",
  "defaults": {
    "model": "openai:gpt-5.5",
    "enableWebSearch": false,
    "enableImageGeneration": false,
    "enableVideoGeneration": false,
    "enableTTS": false,
    "agentMode": "default"
  },
  "courses": [
    {
      "title": "函数极限入门",
      "requirement": "面向大学一年级学生生成函数极限入门课程，使用简体中文。"
    },
    {
      "title": "Python 循环",
      "model": "deepseek:deepseek-v4-pro",
      "requirement": "面向零基础学习者讲解 Python for 循环，使用简体中文。"
    }
  ]
}
```

`defaults` 是所有任务的默认值；单个课程中的同名字段会覆盖默认值。`title` 只用于脚本日志，最终 ZIP 中的课程标题由模型生成的课堂标题决定。

## 五、运行批量生成

先启动本地服务并保持终端运行：

```powershell
cd D:\Projects\OpenMAIC
pnpm dev --hostname 127.0.0.1 --port 3000
```

在另一个 PowerShell 窗口先校验配置，不调用 API：

```powershell
.\scripts\batch-generate-courseware.ps1 `
  -ConfigPath .\courseware-batch.local.json `
  -ValidateOnly
```

开始生成：

```powershell
.\scripts\batch-generate-courseware.ps1 `
  -ConfigPath .\courseware-batch.local.json `
  -PollIntervalSeconds 5 `
  -TimeoutMinutes 90 `
  -ContinueOnError
```

脚本默认顺序执行任务，避免同时生成大量场景触发模型限流。去掉 `-ContinueOnError` 后，任意任务失败都会立即停止整个批次。

如果站点启用了 `ACCESS_CODE`，不要把访问码写入 JSON。运行前设置进程级环境变量：

```powershell
$env:OPENMAIC_ACCESS_CODE='你的访问码'
.\scripts\batch-generate-courseware.ps1 -ConfigPath .\courseware-batch.local.json
Remove-Item Env:OPENMAIC_ACCESS_CODE
```

## 六、模型选择和路由优先级

每个批量任务都可以发送自己的 `model`。实际优先级是：

1. `MODEL_ROUTES` 中的 `generate-classroom` 路由。
2. 当前批量任务的 `model`。
3. `.env.local` 中的 `DEFAULT_MODEL`。

因此，如果配置了下面的路由，所有批量任务都会使用路由指定的模型，而不是各任务的 `model`：

```dotenv
MODEL_ROUTES='{"generate-classroom":"openai:gpt-5.5"}'
```

需要比较多个模型时，不要固定 `generate-classroom` 路由，让每个任务自己的 `model` 生效。归档目录按最终实际解析到的模型命名。

## 七、成功和失败产物

成功 ZIP 包含：

- `manifest.json`
- `classroom.json`
- `courseware-guard-report.json`
- `courseware-visual-report.json`
- `screenshots/`
- 存在资源时的 `media/` 和 `audio/`

视觉检查失败时不会生成最终 ZIP。截图和报告保留在：

```text
data/courseware-audits/<classroomId>/<timestamp>/
```

课堂草稿仍可通过脚本输出的课堂 ID 或 `data/classrooms/<classroomId>` 找到，并在网页 Pro Mode 中继续修改。

## 八、常见问题

### 点击“定位并进入 Pro Mode”后没有自动修复

这是正常设计。该按钮负责定位，不是“立即修复”。进入 Pro Mode 后使用右侧 Edit with AI 描述修改，或直接编辑元素。

### “应用安全修复”是灰色

当前问题没有确定性的修复答案。例如非法 `height` 只能知道它错了，不能确定应该改成多少，因此必须人工或 AI 判断。

### 脚本返回 401

站点启用了访问码。设置 `OPENMAIC_ACCESS_CODE`，并确认它与服务端 `.env.local` 的 `ACCESS_CODE` 一致。

### Playwright/Chromium 启动失败

执行：

```powershell
pnpm exec playwright install chromium
```

### 生成完成但没有 ZIP

查看任务错误和 `data/courseware-audits`。只要结构检查或视觉复检仍有严重问题，系统就会阻止归档，这是预期行为。

### 修改 `.env.local` 后配置没有生效

停止并重新执行 `pnpm dev`。`NEXT_PUBLIC_*` 和服务端模型路由都在启动时读取。

### Windows 全量测试出现多组 5 秒超时

默认并发可能在大型测试集上造成 CPU 争用。使用受控并发重跑：

```powershell
pnpm exec vitest run --maxWorkers=4
```

不要把仅在高并发下出现、而单文件重跑通过的超时直接判断为功能回归。
