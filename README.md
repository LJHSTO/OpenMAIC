<p align="center">
  <img src="assets/banner.png" alt="OpenMAIC" width="680">
</p>

# OpenMAIC

OpenMAIC 是一个本地运行的 AI 互动课堂工具。输入课程要求并按需上传 PDF，即可生成
Slide、Quiz、交互场景和语音讲解。网页生成、批量生成和下载共用同一套课件自检、自动修复、
复检与归档流程。

## 快速开始

环境要求：

- Node.js `>=20.9.0`
- pnpm `>=10`

安装：

```powershell
git clone https://github.com/LJHSTO/OpenMAIC.git
Set-Location OpenMAIC
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
Copy-Item .env.example .env.local
```

打开 `.env.local`，填写 `.env.example` 中已预设服务对应的 API Key。默认模型、课程生成路由、
质量检查路由和自检参数已经配置，无需再填写模型名。

启动：

```powershell
pnpm dev --hostname 127.0.0.1 --port 3000
```

浏览器打开 `http://127.0.0.1:3000`。

## 网页生成

1. 输入课程主题、学习者基础、知识范围和测验要求。
2. 只有教材确实对应课程内容时才上传 PDF。
3. 按需开启联网搜索、图片、视频或语音。
4. 确认大纲后等待全部场景生成。
5. 系统自动执行完整自检、限次修复、复检和归档。

新生成课程通过门禁后才会标记完成。导入课件、人工编辑后的课件或从未检查过的课件在下载时
会自动重新检查，无需额外手动点击。只有自动修复后仍有严重问题时，才需要根据报告人工处理。

## 质量门禁

| 档位 | 用途 |
| --- | --- |
| `fast` | 快速检查旧课件，不调用视觉模型或 AI 修复 |
| `balanced` | 默认档位，适合日常生成和下载 |
| `strict` | 正式发布，额外阻断外部资源依赖 |

完整流程检查：

- 场景结构、ID、顺序和动作引用。
- 大纲与已生成场景的对应关系。
- 乱码、占位符、公式语法和无配图 Quiz。
- Quiz 题型、选项、答案和解析。
- 本地图片、音频、视频及资源路径。
- Slide 渲染、溢出、重叠、越界、坏图和视觉语义。
- 交互页面加载、脚本错误、控件操作、空白页面和外部依赖。
- 讲解词中的人名、跨场景依赖和失效音频引用。

修复后只复检发生变化的场景；修复变差时保留较好的上一版本。仍有严重问题时不会生成最终
归档。

自检可以保障结构、资源、渲染和已定义规则，但不能单独证明所有学科结论正确。重要公式、
证明和答案仍应以教材或人工复核为准。

## PDF 限制

默认配置：

```dotenv
NEXT_PUBLIC_MAX_PDF_CONTENT_CHARS=120000
NEXT_PUBLIC_MAX_VISION_IMAGES=128
```

- PDF 正文允许配置为 `10000-500000` 字符。
- 视觉图片允许配置为 `1-128` 张。
- 超过视觉上限的图片不会作为图片输入发送，仍可保留为文本描述。
- 修改 `NEXT_PUBLIC_*` 后需要重启服务。

## 批量生成

复制示例配置：

```powershell
Copy-Item scripts\courseware-batch.example.json batch\config.json
```

只检查配置：

```powershell
.\scripts\batch-generate-courseware.ps1 -ConfigPath .\batch\config.json -ValidateOnly
```

开始生成：

```powershell
.\scripts\batch-generate-courseware.ps1 -ConfigPath .\batch\config.json
```

批量任务自动完成 PDF 解析、课程生成、自检、修复、复检和归档。课程级 `model` 可以省略，
此时使用 `.env.local` 的默认配置。

详细字段和 PDF 页码写法见
[课件生成与批量归档](COURSEWARE_AUTOMATION_README.md)。

## 输出

默认归档目录：

```text
data/courseware-output/
```

检查证据目录：

```text
data/courseware-audits/<classroomId>/<runId>/
```

可通过以下变量修改输出位置：

```dotenv
OPENMAIC_COURSEWARE_OUTPUT_DIR=C:\Courseware\OpenMAIC
OPENMAIC_COURSEWARE_GROUP_BY_MODEL=true
```

## 开发验证

```powershell
pnpm format
pnpm lint
npx tsc --noEmit
pnpm test
pnpm check:i18n-keys
pnpm build
```

## 许可证

本项目使用 [MIT License](LICENSE)。
