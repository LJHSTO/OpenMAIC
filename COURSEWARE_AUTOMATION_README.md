# OpenMAIC 课件生成、自检修复与批量归档使用说明

本文说明如何安装 OpenMAIC、配置模型、批量读取提示词和 PDF 生成课件、检查导入课件，以及查看自动修复后的课件、报告和截图。

文中的 `$PROJECT_ROOT` 表示 OpenMAIC 仓库根目录。

## 1. 环境要求

- Node.js `>=20.9.0`
- pnpm `10.x`
- PowerShell 5.1 或 PowerShell 7+
- Chromium（由 Playwright 安装）
- 至少一个可用的文本模型
- 启用多模态截图检查时，需要一个支持图片输入的模型

## 2. 安装

Windows PowerShell：

```powershell
Set-Location C:\path\to\OpenMAIC
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
Copy-Item .env.example .env.local
```

Linux 或 macOS：

```bash
cd /path/to/OpenMAIC
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
cp .env.example .env.local
```

## 3. 配置 `.env.local`

`.env.local` 位于项目根目录。不要把真实密钥提交到 Git。

### 3.1 InnoSpark

```dotenv
INNOSPARK_API_KEY=your_api_key
INNOSPARK_BASE_URL=https://api.innospark.cn/v1
INNOSPARK_MODELS=gpt-5.4-pro,gpt-5.4,claude-opus-4-6,claude-sonnet-4-6,gemini-3.1-pro-preview,gemini-3-flash-preview,deepseek-v4-pro,deepseek-v4-flash,doubao-seed-2-0-pro-260215,doubao-seed-2-0-code-preview-260215,kimi-k2.6
DEFAULT_MODEL=innospark:gpt-5.4
MODEL_ROUTES={"courseware-vision-audit":"innospark:gpt-5.4"}
```

字段说明：

| 变量 | 填写内容 | 作用 |
| --- | --- | --- |
| `INNOSPARK_API_KEY` | InnoSpark 控制台生成的密钥 | 服务端调用 InnoSpark |
| `INNOSPARK_BASE_URL` | `https://api.innospark.cn/v1` | OpenAI 兼容接口根地址，不要追加 `/chat/completions` |
| `INNOSPARK_MODELS` | 账号可用模型 ID，英文逗号分隔 | 在 OpenMAIC 模型列表中公开这些模型 |
| `DEFAULT_MODEL` | `provider:model` | 没有浏览器或任务模型时使用的服务端默认模型 |
| `MODEL_ROUTES` | JSON 对象 | 为指定处理阶段固定模型 |

`courseware-vision-audit` 必须使用支持图片输入的模型。浏览器中的完整自动修复使用当前选中的课程模型修复 slide；批量任务使用该课程在 `config.json` 中填写的 `model`。视觉审查使用 `MODEL_ROUTES.courseware-vision-audit`。

截图路由只能填写模型目录中声明支持图片输入的条目。上述 InnoSpark 配置中，`gpt-5.4-pro`、`gpt-5.4`、Claude、Gemini、`doubao-seed-2-0-pro-260215` 和 `kimi-k2.6` 可用于截图路由；DeepSeek 和代码模型只用于文本任务。

如需把生成和 slide 修复也固定到同一模型，可以增加对应阶段：

```dotenv
MODEL_ROUTES={"scene-content":"innospark:gpt-5.4","scene-actions":"innospark:gpt-5.4","courseware-vision-audit":"innospark:gpt-5.4"}
```

设置 `scene-content` 或 `scene-actions` 后，浏览器和批量配置中选择的其他生成模型会被这些路由覆盖。

### 3.2 其他模型供应商

供应商变量统一使用以下格式：

```dotenv
PROVIDER_API_KEY=your_api_key
PROVIDER_BASE_URL=https://provider.example/v1
PROVIDER_MODELS=model-a,model-b
DEFAULT_MODEL=provider:model-a
MODEL_ROUTES={"courseware-vision-audit":"provider:vision-model"}
```

具体变量名前缀和默认地址见 `.env.example`。模型字符串必须包含供应商前缀，例如 `openai:gpt-5.5`、`deepseek:deepseek-v4-pro` 或 `innospark:gpt-5.4`。

### 3.3 课件输出目录

Windows：

```dotenv
OPENMAIC_COURSEWARE_OUTPUT_DIR=C:\Courseware\OpenMAIC
OPENMAIC_COURSEWARE_GROUP_BY_MODEL=true
```

Linux 或 macOS：

```dotenv
OPENMAIC_COURSEWARE_OUTPUT_DIR=/srv/openmaic/courseware
OPENMAIC_COURSEWARE_GROUP_BY_MODEL=true
```

| 变量 | 值 | 作用 |
| --- | --- | --- |
| `OPENMAIC_COURSEWARE_OUTPUT_DIR` | 绝对路径或相对项目根目录的路径 | 保存最终 `.maic.zip` |
| `OPENMAIC_COURSEWARE_GROUP_BY_MODEL` | `true` 或 `false` | 是否按模型建立子目录 |

未设置输出目录时，文件保存到 `$PROJECT_ROOT/data/courseware-output`。

输出示例：

```text
<output>/
└── innospark_gpt-5.4/
    └── 函数极限入门__innospark_gpt-5.4__20260715T010203Z.maic.zip
```

### 3.4 Pro Mode

```dotenv
NEXT_PUBLIC_MAIC_EDITOR_ENABLED=true
```

该变量控制网页中的 Pro Mode 编辑器。修改任何 `NEXT_PUBLIC_*` 变量后必须重新启动服务。

### 3.5 访问码

```dotenv
ACCESS_CODE=your_access_code
```

设置后，网页和批量脚本都必须通过访问码验证。批量脚本使用 `OPENMAIC_ACCESS_CODE` 传入同一个值。

## 4. 启动服务

```powershell
Set-Location C:\path\to\OpenMAIC
pnpm dev --hostname 127.0.0.1 --port 3000
```

浏览器打开 `http://127.0.0.1:3000`。修改 `.env.local` 后需要停止并重新启动该命令。

## 5. 网页生成课件

1. 打开设置，启用已经配置的模型供应商并选择课程模型。
2. 输入课程要求，按需上传 PDF。
3. 生成课程。
4. 每个场景生成后，系统执行结构检查和确定性安全修复。
5. 全部场景和媒体完成后，系统逐页渲染 slide、保存截图并执行多模态检查。
6. 文字溢出、明确重叠和元素越界先执行不改写内容的确定性几何修复。
7. 公式、媒体或无法确定处理方式的 slide 问题交给课程模型修复。
8. 修复后的 slide 会重新渲染、截图和复检；复检发现新的可修复问题时继续修复，最多执行 5 轮。
9. 结构检查与视觉复检均通过后，系统生成最终 `.maic.zip`。

最终复检仍有严重问题时不会生成成功归档。证据保存在：

```text
$PROJECT_ROOT/data/courseware-audits/<classroomId>/<timestamp>/
```

## 6. 导入 `.maic.zip` 后检查和修复

导入操作只把课件及其资源写入本地课堂，不会在导入瞬间调用模型。

1. 在首页点击“导入课堂”，选择 `.maic.zip`。
2. 打开导入后的课堂。
3. 确认设置中选中了可用的课程模型。
4. 点击课堂顶部的盾牌图标，打开“课件检查”。
5. 点击“完整自检并自动修复”。
6. 等待结构检查、Playwright 渲染、多模态检查、AI 修复和复检完成。
7. 检查通过后，点击“下载课件”，或到 `OPENMAIC_COURSEWARE_OUTPUT_DIR` 查看归档。

按钮说明：

| 按钮 | 作用 |
| --- | --- |
| 完整自检并自动修复 | 运行完整结构、截图、多模态、修复和复检流程 |
| 应用安全修复 | 只修复无需模型判断的确定性问题；没有此类问题时按钮禁用 |
| 在 Pro Mode 修改 | 定位到对应场景并打开编辑模式，不会自动改写内容 |
| 下载检查报告 | 下载当前结构报告和最近一次视觉报告 |
| 下载课件 | 导出当前已通过检查的课件 |

## 7. 批量任务目录

```text
OpenMAIC/
├── batch/
│   ├── config.json
│   ├── prompts/
│   │   ├── limits.md
│   │   └── python-loop.md
│   └── pdfs/
│       ├── calculus.pdf
│       └── exercises.pdf
├── scripts/
│   ├── batch-generate-courseware.ps1
│   └── courseware-batch.example.json
└── .env.local
```

创建目录和配置：

```powershell
Set-Location C:\path\to\OpenMAIC
New-Item -ItemType Directory -Force batch\prompts, batch\pdfs | Out-Null
Copy-Item scripts\courseware-batch.example.json batch\config.json
```

`paths.promptsDir` 和 `paths.pdfDir` 的相对路径以项目根目录为基准，也可以填写绝对路径。

## 8. 提示词文件

提示词文件使用 UTF-8 文本或 Markdown，例如 `batch/prompts/limits.md`：

```markdown
面向大学一年级学生生成“函数极限入门”课程，使用简体中文。

要求：
- 先用直观图像解释趋近，再给出严格定义。
- 包含两个逐步例题和一个常见错误辨析。
- 最后安排选择题和开放题。
- 公式、图表和正文不能互相遮挡。
```

配置中的 `promptFile` 填写相对于 `promptsDir` 的路径。也可以直接填写 `requirement`。两者同时存在时，脚本按“`requirement` + 提示词文件”的顺序合并。

## 9. PDF 和页码

PDF 默认放在 `batch/pdfs/`。一门课程可以填写多个 PDF。

页码格式：

| 写法 | 含义 |
| --- | --- |
| `"3"` | 第 3 页 |
| `"1-10"` | 第 1 至 10 页，包含首尾 |
| `"1-3,7,10-12"` | 多个页段 |
| 省略或空字符串 | 全部页面 |

页码从 1 开始。超出总页数、倒序范围或非法字符会中止该任务。

支持的 PDF 解析器：

| `providerId` | 配置方式 |
| --- | --- |
| `unpdf` | 本地解析，不需要 API 密钥 |
| `mineru` | 按 `.env.example` 配置对应地址和密钥 |
| `mineru-cloud` | 按 `.env.example` 配置云端密钥 |
| `alidocmind` | 配置 AccessKey ID、AccessKey Secret 和可选 Base URL |

只有解析器返回页级结果时才能使用页码筛选。不能可靠分页时，任务会报错，不会用整本 PDF 替代所选页面。

## 10. `batch/config.json`

```json
{
  "baseUrl": "http://127.0.0.1:3000",
  "paths": {
    "promptsDir": "batch/prompts",
    "pdfDir": "batch/pdfs"
  },
  "defaults": {
    "model": "innospark:gpt-5.4",
    "pdfProviderId": "unpdf",
    "enableWebSearch": false,
    "enableImageGeneration": false,
    "enableVideoGeneration": false,
    "enableTTS": false,
    "enableVisionAudit": true,
    "agentMode": "default"
  },
  "courses": [
    {
      "title": "函数极限入门",
      "promptFile": "limits.md",
      "pdfs": [
        {
          "file": "calculus.pdf",
          "pages": "1-12"
        },
        {
          "file": "exercises.pdf",
          "pages": "3,5-7",
          "providerId": "mineru-cloud",
          "apiKeyEnv": "MINERU_API_KEY"
        }
      ]
    },
    {
      "title": "Python 循环",
      "model": "deepseek:deepseek-v4-pro",
      "requirement": "面向零基础学习者讲解 Python for 循环，使用简体中文。",
      "enableVisionAudit": false,
      "pdfs": []
    }
  ]
}
```

顶层字段：

| 字段 | 是否必填 | 填写内容 |
| --- | --- | --- |
| `baseUrl` | 否 | OpenMAIC 服务地址；默认 `http://127.0.0.1:3000` |
| `paths.promptsDir` | 否 | 提示词目录；默认 `batch/prompts` |
| `paths.pdfDir` | 否 | PDF 目录；默认 `batch/pdfs` |
| `defaults` | 否 | 所有课程共用的默认值 |
| `courses` | 是 | 至少一个课程对象 |

课程字段：

| 字段 | 是否必填 | 填写内容 |
| --- | --- | --- |
| `title` | 否 | 课堂标题和归档文件名；省略时使用课程序号 |
| `model` | 否 | `provider:model`；课程值覆盖 `defaults.model`，两处至少填写一处 |
| `promptFile` | 至少一项 | 相对于 `promptsDir` 的 UTF-8 文件 |
| `requirement` | 至少一项 | 内联提示词；可与 `promptFile` 合并 |
| `pdfs` | 否 | PDF 字符串或 PDF 对象数组 |
| `pdfProviderId` | 否 | 默认 PDF 解析器；默认 `unpdf` |
| `enableWebSearch` | 否 | 是否启用联网搜索 |
| `webSearchProviderId` | 否 | 搜索供应商 ID |
| `enableImageGeneration` | 否 | 是否生成图片 |
| `enableVideoGeneration` | 否 | 是否生成视频 |
| `enableTTS` | 否 | 是否生成讲解音频 |
| `enableVisionAudit` | 否 | 是否把 Playwright 截图发送给真实多模态模型 |
| `agentMode` | 否 | `default` 或 `generate` |

PDF 对象字段：

| 字段 | 是否必填 | 填写内容 |
| --- | --- | --- |
| `file` | 是 | 相对于 `pdfDir` 的 PDF 路径，或绝对路径 |
| `pages` | 否 | 页码或页码范围 |
| `providerId` | 否 | 覆盖课程的 PDF 解析器 |
| `baseUrl` | 否 | 覆盖解析器地址 |
| `apiKeyEnv` | 否 | 保存 API 密钥的环境变量名称，不是密钥本身 |
| `accessKeyIdEnv` | 否 | AliDocMind AccessKey ID 的环境变量名称 |
| `accessKeySecretEnv` | 否 | AliDocMind AccessKey Secret 的环境变量名称 |

## 11. 校验和运行批量任务

先启动 OpenMAIC，再打开另一个 PowerShell 窗口。

只校验配置，不上传文件、不调用模型：

```powershell
Set-Location C:\path\to\OpenMAIC
.\scripts\batch-generate-courseware.ps1 `
  -ConfigPath .\batch\config.json `
  -ValidateOnly
```

开始批量生成：

```powershell
.\scripts\batch-generate-courseware.ps1 `
  -ConfigPath .\batch\config.json `
  -PollIntervalSeconds 5 `
  -TimeoutMinutes 90 `
  -ContinueOnError
```

参数说明：

| 参数 | 作用 |
| --- | --- |
| `-ConfigPath` | 批量 JSON 配置路径 |
| `-BaseUrl` | 覆盖 JSON 中的服务地址 |
| `-PollIntervalSeconds` | 查询任务进度的秒数 |
| `-TimeoutMinutes` | 单个任务超时时间 |
| `-ContinueOnError` | 一门课失败后继续下一门；省略时立即停止 |
| `-ValidateOnly` | 只校验本地配置和文件 |

启用访问码时：

```powershell
$env:OPENMAIC_ACCESS_CODE = 'your_access_code'
.\scripts\batch-generate-courseware.ps1 -ConfigPath .\batch\config.json
Remove-Item Env:OPENMAIC_ACCESS_CODE
```

## 12. 输出文件

通过最终检查的 ZIP 包含：

- `manifest.json`
- `classroom.json`
- `courseware-guard-report.json`
- `courseware-visual-report.json`
- `screenshots/`
- 存在资源时的 `media/` 和 `audio/`

检查过程证据：

```text
$PROJECT_ROOT/data/courseware-audits/<classroomId>/<timestamp>/
├── courseware-guard-report.json
├── courseware-visual-report-pass-1.json
├── courseware-visual-report-pass-2.json
├── ...
├── courseware-visual-report-pass-6.json
├── courseware-visual-report.json
├── screenshots/
├── screenshots-repaired/
├── screenshots-repaired-pass-2/
├── ...
├── screenshots-repaired-pass-5/
└── courseware-repair-failures.json
```

只有实际发生修复时才会生成 `screenshots-repaired/`。第二轮及后续修复会生成带轮次编号的目录；只有修复调用失败时才会生成 `courseware-repair-failures.json`。

## 13. 当前检查范围

| 内容 | 结构检查 | Playwright 截图检查 | 多模态检查 | 自动修复 |
| --- | --- | --- | --- | --- |
| Slide | 是 | 是 | 是 | 确定性安全修复和 AI 修复 |
| Quiz | 是 | 否 | 否 | 仅修复可确定的 ID 等字段 |
| Interactive | 基础结构和危险 URL | 否 | 否 | 仅确定性安全修复 |
| PBL | 基础结构 | 否 | 否 | 否 |

Quiz 结构检查包括：题目是否存在、题目对象、题目 ID、题干、选择题选项数量，以及答案值是否存在于选项中。当前版本不会用大模型判断答案是否正确，也不会自动重写题干、选项或答案。

Playwright 负责真实浏览器渲染、DOM 尺寸、文字溢出、明显重叠、资源失败、控制台错误和页面截图。开启 `enableVisionAudit` 后，截图会发送给多模态模型检查裁切、遮挡、对比度、可读性、公式或媒体外观、重复内容和视觉层次。

多模态报告中的 `semantic_confusion` 统一记为需人工确认的警告，不会自动改写 slide，也不会单独阻止归档。发布前在最终截图中确认这些警告；其他严重视觉问题会阻止归档。

## 14. 故障处理

### 修改 `.env.local` 后没有生效

停止并重新启动 `pnpm dev`。

### InnoSpark 不出现在模型设置中

确认 `INNOSPARK_API_KEY` 非空，`INNOSPARK_BASE_URL` 以 `/v1` 结尾，并重新启动服务。

### 提示模型不支持视觉

把 `MODEL_ROUTES.courseware-vision-audit` 改为声明支持图片输入的模型，然后重新启动服务。

### Playwright 或 Chromium 启动失败

```powershell
pnpm exec playwright install chromium
```

Linux 服务器还需要安装 Chromium 所需的系统依赖。

### “应用安全修复”按钮禁用

当前报告中没有可由确定性规则直接修复的问题。使用“完整自检并自动修复”处理需要模型判断的 slide 问题。

### 导入后没有自动开始检查

导入与完整检查是两个步骤。打开课堂的盾牌菜单，点击“完整自检并自动修复”。

### 完整检查失败但页面内容已经变化

服务端会返回已完成的修复结果并保存报告。查看错误消息中的 `Evidence` 目录和 `courseware-visual-report.json`，再使用 Pro Mode 处理剩余问题。

### 生成完成但输出目录没有 ZIP

结构检查或视觉复检仍有严重问题时不会归档。查看 `data/courseware-audits` 下对应课堂的最新证据目录。

### 页码范围被拒绝

确认范围未超过 PDF 总页数。解析器不能返回页级结果时改用 `unpdf`，或取消 `pages` 使用全文。

### 批量任务返回 401

服务端启用了 `ACCESS_CODE`。设置相同的 `OPENMAIC_ACCESS_CODE` 后重新运行脚本。

### 批量任务触发 429

脚本按课程顺序执行。等待供应商限流窗口恢复后重试失败课程。
