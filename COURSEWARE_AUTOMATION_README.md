# OpenMAIC 课件生成、自检修复与批量归档指南

本文面向所有本地部署或服务器部署用户，说明如何：

- 对网页生成和导入的 `.maic.zip` 课件运行结构检查、浏览器截图检查和真实多模态模型检查。
- 对可修复的问题调用现有课件编辑模型自动修复，并重新截图复检。
- 用一个 PowerShell 脚本批量读取提示词和多个 PDF，按页码范围生成课件。
- 将最终课件按“模型/课程标题”自动归档到指定目录。

文中的 `$PROJECT_ROOT` 表示 OpenMAIC 仓库根目录。Windows 示例可替换为
`C:\path\to\OpenMAIC`，Linux/macOS 示例可替换为 `/path/to/OpenMAIC`。仓库代码和配置中
不依赖这些示例路径。

## 1. 当前自检到底做了什么

| 层次 | 是否调用模型 | 能检查什么 | 能否自动修复 |
| --- | --- | --- | --- |
| TypeScript 结构规则 | 否 | ID、场景关联、顺序、非法尺寸、越界、测验结构、HTML 基础安全等 | 只修复答案确定的问题 |
| Playwright Chromium | 否 | 实际渲染、文字溢出、明显重叠、图片失败、请求失败、控制台错误 | 只生成证据和问题描述 |
| 多模态截图审查 | 是 | 遮挡、裁切、低对比度、字号过小、公式/图表/图片外观、重复或空白内容、视觉层次等 | 将严重问题交给课件编辑模型 |
| 课件编辑模型 | 是 | 根据结构问题、浏览器问题和多模态问题重生成出错场景 | 修复后再次截图复检 |

`enableVisionAudit: true` 时，每张 Playwright 截图会真的发送给支持图片输入的模型；这不是仅靠
Playwright 模拟出来的“AI 检查”。如果模型没有声明视觉能力，检查会明确失败，而不会假装已经完成。
截图和页面中的教学内容会发送给 `courseware-vision-audit` 实际解析到的模型供应商；处理敏感课程前，
请先确认供应商的数据保留、隐私和合规政策。

Playwright 很适合测量 DOM、资源和运行时状态，但它本身不能可靠判断教学表达、审美、视觉层次、
低对比度或“学生是否能理解”。多模态模型能补足一部分视觉和语义判断，但仍可能误报或漏报，
所以任何系统都不能诚实地保证“自动发现所有错误”。重要课程发布前仍应保留人工抽检。

### 生成课件的检查时机

1. 每个场景生成后立即运行结构规则和确定性安全修复。
2. 所有场景和媒体生成完成后保存一个可渲染草稿。
3. Playwright 以 `1600x900` 逐页渲染并保存截图。
4. 开启多模态检查时，把每张截图交给视觉模型。
5. 对严重且可修复的问题调用现有 `regenerate_scene` 编辑流程。
6. 保存修复后的场景并重新运行浏览器与多模态检查。
7. 严重问题清零后才生成最终 `.maic.zip`；否则保留报告和截图，阻止归档。

逐场景阶段只做不依赖最终媒体的结构检查。完整的截图检查放在全部内容和媒体生成完成后执行，
避免把尚未生成的图片或视频占位符误判为最终错误。

## 2. 导入课件后如何自检和修改

导入 `.maic.zip` 后不需要先重新生成。进入课堂后，点击顶部工具栏的盾牌图标打开“课件检查”。

对话框中的按钮含义：

- **完整自检并自动修复**：上传当前浏览器中的本地媒体，运行结构规则、Playwright 截图、真实多模态
  审查、AI 修复和复检。这是导入课件的完整自动处理入口。
- **应用安全修复**：只处理无需模型判断的确定性问题，例如缺失 ID、错误课程关联和缺失 doctype。
  没有确定性修复项时按钮会禁用，这是预期行为。
- **定位并进入 Pro Mode**：切换到对应页并打开编辑器，不会仅因点击该按钮就自动改内容。
- **下载检查报告**：下载当前结构规则报告。

问题项会显示页码、场景标题、元素 ID、字段名和完整数据路径。完整检查执行后，同一可滚动列表还会
显示浏览器与多模态模型的具体描述、问题类别和相关元素 ID。即使自动修复后仍未通过，已经修复的
场景和剩余报告也会返回浏览器，不会只显示一句无法区分的通用错误。

Pro Mode 需要在 `.env.local` 中启用：

```dotenv
NEXT_PUBLIC_MAIC_EDITOR_ENABLED=true
```

修改 `NEXT_PUBLIC_*` 变量后必须重启 OpenMAIC。完整自检按钮不依赖“这门课是否由当前 OpenMAIC
生成”，但需要可用的 Playwright Chromium、课件编辑模型和视觉模型。

## 3. 安装和启动

要求：

- Node.js `>=20.9.0`
- pnpm `10.x`
- PowerShell 5.1 或 PowerShell 7+
- 至少一个文本生成模型；启用真实截图审查时还需要支持图片输入的模型

Windows PowerShell：

```powershell
Set-Location C:\path\to\OpenMAIC
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
Copy-Item .env.example .env.local
pnpm dev --hostname 127.0.0.1 --port 3000
```

Linux/macOS：

```bash
cd /path/to/OpenMAIC
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
cp .env.example .env.local
pnpm dev --hostname 127.0.0.1 --port 3000
```

浏览器打开 `http://127.0.0.1:3000`。

## 4. 配置生成模型、视觉模型和输出目录

先按项目主 README 配置至少一个模型供应商，并设置服务端默认模型。例如：

```dotenv
OPENAI_API_KEY=your_api_key
OPENAI_MODELS=gpt-5.5
DEFAULT_MODEL=openai:gpt-5.5
```

模型名称统一使用 `provider:model`，例如 `openai:gpt-5.5`。实际可用模型以当前供应商账号和
OpenMAIC 模型列表为准。

如果生成模型不支持图片输入，应给视觉检查单独路由一个视觉模型：

```dotenv
MODEL_ROUTES={"courseware-vision-audit":"openai:gpt-5.5"}
```

路由优先级是：

1. `MODEL_ROUTES` 中对应阶段的模型。
2. 浏览器或批量任务发送的模型。
3. `DEFAULT_MODEL`。

因此，批量比较多个生成模型时不要固定 `generate-classroom` 路由；可以只固定
`courseware-vision-audit`，让所有课件使用同一个视觉审查模型。

指定归档目录：

```dotenv
# Windows 示例
OPENMAIC_COURSEWARE_OUTPUT_DIR=C:\Courseware\OpenMAIC

# Linux/macOS 示例
# OPENMAIC_COURSEWARE_OUTPUT_DIR=/srv/openmaic/courseware

OPENMAIC_COURSEWARE_GROUP_BY_MODEL=true
```

未设置时输出到 `$PROJECT_ROOT/data/courseware-output`。默认按实际生成模型建立子目录：

```text
<output>/
├── openai_gpt-5.5/
│   └── 函数极限入门__openai_gpt-5.5__20260715T010203Z.maic.zip
└── deepseek_deepseek-v4-pro/
    └── Python循环__deepseek_deepseek-v4-pro__20260715T020304Z.maic.zip
```

设为 `OPENMAIC_COURSEWARE_GROUP_BY_MODEL=false` 可使用单层目录。批量配置里的 `title` 会直接用于
课堂标题和 ZIP 文件名，不再只是日志标签。

## 5. 准备批量目录

推荐结构：

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

Windows：

```powershell
Set-Location C:\path\to\OpenMAIC
New-Item -ItemType Directory -Force batch\prompts, batch\pdfs | Out-Null
Copy-Item scripts\courseware-batch.example.json batch\config.json
```

Linux/macOS 上仍需安装 PowerShell (`pwsh`) 才能运行本脚本：

```bash
cd /path/to/OpenMAIC
mkdir -p batch/prompts batch/pdfs
cp scripts/courseware-batch.example.json batch/config.json
```

`paths.promptsDir` 和 `paths.pdfDir` 的相对路径始终相对于项目根目录，不受当前终端目录或
`config.json` 所在位置影响。也可以填写绝对路径。

## 6. 提示词文件怎么写

把每门课的生成要求保存为 UTF-8 文本或 Markdown，例如 `batch/prompts/limits.md`：

```markdown
面向大学一年级学生生成“函数极限入门”课程，使用简体中文。

要求：
- 先用直观图像解释趋近，再给出严格定义。
- 包含至少两个逐步例题和一个常见错误辨析。
- 最后安排选择题和开放题。
- 公式必须可读，不能与正文重叠。
```

配置中用 `promptFile` 写相对于 `promptsDir` 的文件名。也可以直接使用 `requirement`。两者同时
存在时会按“内联 requirement + 提示词文件内容”的顺序合并。

## 7. PDF 放在哪里，页码怎么填

PDF 默认放在 `batch/pdfs/`，配置里的 `file` 相对于 `paths.pdfDir`。一门课可以有零个、一个或多个
PDF；脚本会依次解析并把文本和图片合并为同一课程资料。

支持的页码写法：

- `"3"`：只使用第 3 页。
- `"1-10"`：使用第 1 至 10 页，包含首尾。
- `"1-3,7,10-12"`：组合多个页段。
- 省略 `pages` 或填空字符串：使用全部页面。

页码从 1 开始。重复页会自动去重并排序。超出 PDF 页数、倒序范围或非法字符会明确报错。

`unpdf` 会逐页提取文本和图片，最适合本地、无需 API 的分页。MinerU 和 AliDocMind 只有在供应商
返回页级文本/布局信息时才能安全分页；如果供应商只返回合并全文，OpenMAIC 会拒绝页码筛选，
不会悄悄把整本 PDF 当成所选页面。

## 8. 完整批量配置

`batch/config.json` 示例：

```json
{
  "baseUrl": "http://127.0.0.1:3000",
  "paths": {
    "promptsDir": "batch/prompts",
    "pdfDir": "batch/pdfs"
  },
  "defaults": {
    "model": "openai:gpt-5.5",
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
      "pdfs": []
    }
  ]
}
```

常用字段：

| 字段 | 位置 | 说明 |
| --- | --- | --- |
| `title` | course | 必填；课堂标题和归档文件名 |
| `model` | defaults/course | 必填；`provider:model`，课程值覆盖默认值 |
| `promptFile` | defaults/course | 相对 `promptsDir` 的 UTF-8 文件 |
| `requirement` | defaults/course | 内联提示词；与 `promptFile` 至少有一个 |
| `pdfs` | course | PDF 字符串或 PDF 对象数组 |
| `pdfProviderId` | defaults/course | 默认 `unpdf`；也可在单个 PDF 覆盖 |
| `pages` | PDF | 页码范围；省略表示全文 |
| `enableVisionAudit` | defaults/course | `true` 才会调用真实多模态模型 |
| `enableTTS` | defaults/course | 是否生成讲解音频 |
| `enableImageGeneration` | defaults/course | 是否生成图片资源 |
| `enableVideoGeneration` | defaults/course | 是否生成视频资源 |
| `agentMode` | defaults/course | `default` 或 `generate` |

### PDF 解析器和凭据

支持 `unpdf`、`mineru`、`mineru-cloud`、`alidocmind`。优先在服务端 `.env.local` 或
`server-providers.yml` 配置解析器；脚本也支持用环境变量名传入未托管解析器的凭据：

```json
{
  "file": "paper.pdf",
  "pages": "2-8",
  "providerId": "mineru-cloud",
  "apiKeyEnv": "MINERU_API_KEY",
  "baseUrl": "https://example-parser.invalid"
}
```

AliDocMind 可使用 `accessKeyIdEnv` 和 `accessKeySecretEnv`。JSON 中写的是环境变量名称，不是密钥值：

```json
{
  "file": "course.pdf",
  "providerId": "alidocmind",
  "accessKeyIdEnv": "ALIDOCMIND_ACCESS_KEY_ID",
  "accessKeySecretEnv": "ALIDOCMIND_ACCESS_KEY_SECRET"
}
```

PowerShell 中设置当前进程环境变量：

```powershell
$env:MINERU_API_KEY = 'your_key'
$env:ALIDOCMIND_ACCESS_KEY_ID = 'your_id'
$env:ALIDOCMIND_ACCESS_KEY_SECRET = 'your_secret'
```

## 9. 校验并运行批量任务

先保持 OpenMAIC 服务运行。另开一个 PowerShell 窗口，在仓库根目录执行只读校验：

```powershell
.\scripts\batch-generate-courseware.ps1 `
  -ConfigPath .\batch\config.json `
  -ValidateOnly
```

校验会检查模型格式、提示词文件、PDF 文件和页码语法，不会上传文件或调用模型。

开始生成：

```powershell
.\scripts\batch-generate-courseware.ps1 `
  -ConfigPath .\batch\config.json `
  -PollIntervalSeconds 5 `
  -TimeoutMinutes 90 `
  -ContinueOnError
```

脚本兼容 Windows PowerShell 5.1，不依赖 PowerShell 7 才有的 `Invoke-RestMethod -Form`。任务默认顺序
执行，避免同时生成大量场景触发 API 限流。去掉 `-ContinueOnError` 后，任一课程失败会停止整个批次。

站点启用了 `ACCESS_CODE` 时：

```powershell
$env:OPENMAIC_ACCESS_CODE = 'your_access_code'
.\scripts\batch-generate-courseware.ps1 -ConfigPath .\batch\config.json
Remove-Item Env:OPENMAIC_ACCESS_CODE
```

也可用 `-BaseUrl https://your-openmaic.example` 连接远程部署。PDF、提示词和课件内容会发送到该部署，
使用远程服务前应确认数据合规和上传限制。

## 10. 产物和失败证据

成功 ZIP 包含：

- `manifest.json`
- `classroom.json`
- `courseware-guard-report.json`
- `courseware-visual-report.json`
- `screenshots/`
- 存在资源时的 `media/` 和 `audio/`

未通过最终检查时不会生成成功 ZIP。结构报告、两轮视觉报告、截图和修复失败信息保存在：

```text
$PROJECT_ROOT/data/courseware-audits/<classroomId>/<timestamp>/
```

课堂草稿保存在 `data/classrooms/<classroomId>`，可以用任务输出的课堂 ID 打开网页继续修改。

## 11. Page Agent、Stagehand 和其他浏览器 Agent

### alibaba/page-agent

[Page Agent](https://github.com/alibaba/page-agent) 的定位是页面内 GUI Agent。其公开说明强调基于文本 DOM、
不使用截图和多模态模型。它适合增加“用自然语言操作当前网页”的产品能力，但看不到真实像素，不能可靠
发现遮挡、渲染重叠、低对比度或公式外观损坏，因此不适合作为课件视觉质检核心。

### browserbase/stagehand

[Stagehand](https://github.com/browserbase/stagehand) 适合把代码和自然语言浏览器操作结合起来，可用于后续
增加“像学生一样翻页、滚动、答题、点击互动控件、检查按钮是否可用”的端到端巡检。它可以作为
Playwright 上层的可选用户流程检查器，但不能替代当前的结构规则、DOM 测量和多模态截图审查。

推荐的长期架构是：

1. TypeScript/DSL 确定性规则。
2. Playwright DOM、资源和运行时检查。
3. 多模态模型审查真实截图。
4. 现有课件编辑模型修复。
5. 重新渲染复检。
6. Stagehand 可选执行学生端完整操作流程。
7. 人工抽检高风险课程。

当前版本没有引入 Page Agent 或 Stagehand 依赖，避免为了一个可选层改变现有 Pro Mode 和编辑器架构。

## 12. 常见问题

### 导入课件后为什么以前不能自动修复

旧入口只运行本地结构规则并跳转 Pro Mode，没有调用最终检查 API；同时非法几何等结构错误没有进入
AI 修复集合。当前“完整自检并自动修复”已接入完整流水线，导入课件不需要先重新生成。

### 为什么“应用安全修复”还是灰色

它只处理确定性问题。非法高度只能确定“错了”，不能仅靠规则知道应改成多少，因此要使用“完整自检并
自动修复”或 Pro Mode。禁用状态不代表完整自动修复不可用。

### 多模态检查提示模型不支持视觉

当前课程模型的 `capabilities.vision` 不是 `true`。改用支持图片输入的模型，或设置：

```dotenv
MODEL_ROUTES={"courseware-vision-audit":"openai:gpt-5.5"}
```

如果明确只需要规则和 Playwright 检查，可在批量配置设 `"enableVisionAudit": false`，但这不再是
真实大模型截图审查。

### Playwright 或 Chromium 启动失败

```powershell
pnpm exec playwright install chromium
```

Linux 服务器可能还需要 Playwright 系统依赖，按 Playwright 官方文档使用适合该发行版的安装命令。

### 页码范围被拒绝

先确认页码没有超过 PDF 总页数。若错误提示解析器没有返回 page-level text，改用 `unpdf`，或选择能
返回页级布局信息的 MinerU/AliDocMind 配置。系统不会对无法可靠分页的结果静默使用全文。

### 生成完成但没有 ZIP

查看任务错误和 `data/courseware-audits`。只要结构或视觉复检仍有严重问题，系统就会阻止归档。

### 修改 `.env.local` 后没有生效

停止并重新启动 `pnpm dev`。模型路由、输出目录和 `NEXT_PUBLIC_*` 设置都在启动时读取。

### 批量任务返回 401

站点启用了访问码。设置 `OPENMAIC_ACCESS_CODE`，并确认它与服务端 `ACCESS_CODE` 一致。

### 多模态检查的成本为什么明显增加

每张幻灯片至少调用一次视觉模型；发生修复时还会再截图并复检。可用较便宜但可靠的视觉模型单独配置
`courseware-vision-audit` 路由。降低成本时不要关闭最终复检，否则无法确认修复是否真的生效。
