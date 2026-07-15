# Calculus Quest v16 教材对齐与 OpenMAIC 批量资产设计

## 目标

在不改变 OpenMAIC 批处理接口的前提下，交付一套可直接批量生成 Calculus Quest 主体高数课件的资产：14 份模块提示词、MML 第 5/7 章连续 PDF 切片、JSON 批量配置、API 选项说明和 Windows PowerShell 操作步骤。

## 不变量

- 保留 GH-01 至 GH-14 模块 ID，避免后续 route/KG 引用迁移。
- 每个知识点生成 `slide`、`simulation`、`diagram`、`game`、`visualization3d` 五类场景。
- 每个模块生成且只生成前测、形成性测验、后测三个 quiz。
- OpenMAIC 输出只使用 `languageDirective`、`courseTitle`、`outlines` 顶层结构；interactive 使用 `widgetType` 与 `widgetOutline`，不使用废弃的 `interactiveConfig`。
- 强制场景类型不限定视觉模板；模型可以自由选择布局、隐喻、颜色、控件和情境。

## 教材边界

MML Chapter 5 直接支撑一元导数、Taylor、偏导/梯度、Jacobian、矩阵梯度、自动微分和 Hessian；Chapter 7 直接支撑梯度下降、步长/动量/小批量、约束与 Lagrange、凸优化及线性/二次规划。极限、连续、完整积分方法、单调性和初等极值建模使用“标准高数补充”标记，不能伪造为 MML 第 5/7 章页码。

## 批量资产

```text
batch/calculus-quest-v16/
├── README.md
├── API-OPTIONS.md
├── SOURCE-MAP.md
├── config.json
├── config.cost-saving.example.json
├── build-pdf-slices.py
├── pdfs/
└── prompts/
    ├── GH-01.md ... GH-14.md
    └── SUP-01-multiple-integrals-probability.md
```

`config.json` 使用现有 `scripts/batch-generate-courseware.ps1` 的 JSON schema；不使用 CSV，不要求手写内部 scene schema。模型为 `provider:model`，密钥只从 `.env.local` 或环境变量读取。

## PDF 页码

切片按原始 PDF 1-based 页码生成：145-146、147-152、153-154、155-160、161-164、165-170、170-175、231-232、233-238、239-242、243-251。切片脚本输出页数、字节数和 SHA-256；不复制整本教材。

## 提示词契约

每份模块提示词必须明确：模块目标、先修基础、MML 直接证据与标准高数补充、知识点公式族及适用条件、初学者直觉顺序、五类场景的职责、三类 quiz 的覆盖与证据引用、2D fallback，以及 JSON/字段/可操作性自检。Slide 需要定义、直觉、符号/维度、最小推导桥梁、一步例题、误解和可引用观察点；interactive 需要 controls、student actions、feedback、success condition/observableEvidence。

## 验收

1. `-ValidateOnly` 通过：JSON、提示词、PDF 和页码均存在且格式正确。
2. 先生成 GH-01、GH-03、GH-08、GH-12，检查五类场景、三个 quiz、公式和初学者节奏。
3. 全量生成后运行 courseware guard、Playwright；若模型支持图片，再开启 `enableVisionAudit`。
4. 重点人工确认公式无溢出、互动可操作、diagram 有关系、simulation 有可量化反馈、3D 失败有 2D fallback、教材未覆盖内容未冒充 MML。
