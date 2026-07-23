# OpenMAIC 课件生成与批量归档

本文说明如何配置 API、批量读取提示词和 PDF，并自动完成课程生成、自检、修复、复检和归档。

## 1. 安装

```powershell
Set-Location C:\path\to\OpenMAIC
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
Copy-Item .env.example .env.local
```

打开 `.env.local`，填写 `.env.example` 中已预设服务对应的 API Key。默认模型和两阶段路由
已经配置。

可选输出配置：

```dotenv
OPENMAIC_COURSEWARE_OUTPUT_DIR=C:\Courseware\OpenMAIC
OPENMAIC_COURSEWARE_GROUP_BY_MODEL=true
OPENMAIC_COURSEWARE_AUDIT_PROFILE=balanced
NEXT_PUBLIC_MAX_PDF_CONTENT_CHARS=120000
NEXT_PUBLIC_MAX_VISION_IMAGES=128
```

修改配置后重新启动服务：

```powershell
pnpm dev --hostname 127.0.0.1 --port 3000
```

## 2. 自动质量流程

网页生成和批量生成都调用同一个最终流程：

1. 检查并安全修复场景结构、Quiz、公式、乱码和讲解词。
2. 核对大纲与已生成场景是否一一对应。
3. 检查图片、音频、视频和资源路径。
4. 使用浏览器渲染全部 Slide 和交互场景。
5. 检查 Slide 布局、视觉语义和交互运行错误。
6. 对可修复问题执行限次修复。
7. 只复检发生变化的场景。
8. 全部门禁通过后生成 `.maic.zip`。

生成后无需再手动运行一次自检。导入、人工编辑或未检查的课件在下载时会自动复检。自动修复
仍失败时，系统保留报告和当前最好版本，但不会生成成功归档。

## 3. 批量目录

```text
OpenMAIC/
├── batch/
│   ├── config.json
│   ├── prompts/
│   │   └── lesson-01.md
│   └── pdfs/
│       └── textbook.pdf
└── scripts/
    ├── batch-generate-courseware.ps1
    └── courseware-batch.example.json
```

创建配置：

```powershell
New-Item -ItemType Directory -Force batch\prompts, batch\pdfs | Out-Null
Copy-Item scripts\courseware-batch.example.json batch\config.json
```

## 4. 最小配置

```json
{
  "baseUrl": "http://127.0.0.1:3000",
  "paths": {
    "promptsDir": "batch/prompts",
    "pdfDir": "batch/pdfs"
  },
  "defaults": {
    "pdfProviderId": "unpdf",
    "enableWebSearch": false,
    "enableImageGeneration": false,
    "enableVideoGeneration": false,
    "enableTTS": false,
    "enableVisionAudit": true,
    "auditProfile": "balanced",
    "agentMode": "default"
  },
  "courses": [
    {
      "title": "函数极限入门",
      "promptFile": "lesson-01.md",
      "pdfs": [
        {
          "file": "textbook.pdf",
          "pages": "1-12"
        }
      ]
    }
  ]
}
```

课程级 `model` 可以省略，系统使用 `.env.local` 的默认配置。需要覆盖时填写
`provider:model`。

## 5. 常用字段

| 字段 | 说明 |
| --- | --- |
| `title` | 课程名和归档文件名 |
| `requirement` | 直接填写课程要求 |
| `promptFile` | 相对于 `promptsDir` 的 UTF-8 提示词 |
| `pdfs` | PDF 文件和可选页码 |
| `pdfProviderId` | PDF 解析器 |
| `enableWebSearch` | 是否联网补充资料 |
| `enableImageGeneration` | 是否生成图片 |
| `enableVideoGeneration` | 是否生成视频 |
| `enableTTS` | 是否生成语音 |
| `enableVisionAudit` | 是否执行 Slide 截图复核 |
| `auditProfile` | `fast`、`balanced` 或 `strict` |
| `agentMode` | 使用默认课堂角色或生成角色 |

`requirement` 和 `promptFile` 同时存在时会按顺序合并。

## 6. PDF 页码

| 写法 | 含义 |
| --- | --- |
| `"3"` | 第 3 页 |
| `"1-10"` | 第 1 至 10 页 |
| `"1-3,7,10-12"` | 多个页段 |
| 省略 | 全部页面 |

页码从 1 开始。非法字符、倒序范围或超出页数会中止任务。没有 PDF 依据的课程可以不配置
`pdfs`。

PDF 图片会进入与网页上传相同的视觉输入路径。每次最多发送
`NEXT_PUBLIC_MAX_VISION_IMAGES` 张图片，超出部分只保留文本描述。

## 7. 运行

只检查配置：

```powershell
.\scripts\batch-generate-courseware.ps1 -ConfigPath .\batch\config.json -ValidateOnly
```

开始生成：

```powershell
.\scripts\batch-generate-courseware.ps1 -ConfigPath .\batch\config.json
```

继续处理其他课程：

```powershell
.\scripts\batch-generate-courseware.ps1 -ConfigPath .\batch\config.json -ContinueOnError
```

如果站点启用了访问码：

```powershell
$env:OPENMAIC_ACCESS_CODE='your_access_code'
.\scripts\batch-generate-courseware.ps1 -ConfigPath .\batch\config.json
```

## 8. 输出与排错

成功归档：

```text
<output>/<model-group>/<course-title>.maic.zip
```

自检证据：

```text
data/courseware-audits/<classroomId>/<runId>/
```

归档未生成时，查看任务错误和审计目录中的结构、知识、资源、Slide、交互及修复报告。严重问题
必须修复并重新通过门禁。

自检不能单独证明所有学科结论正确。正式课程仍应核对教材依据、公式、证明和答案。
