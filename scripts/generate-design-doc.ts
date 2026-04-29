import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  PageBreak,
} from 'docx';
import * as fs from 'fs';
import * as path from 'path';

function heading1(text: string) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 200, before: 400 },
  });
}

function heading2(text: string) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { after: 160, before: 320 },
  });
}

function heading3(text: string) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_3,
    spacing: { after: 120, before: 240 },
  });
}

function body(text: string, bold = false) {
  return new Paragraph({
    spacing: { after: 100, line: 360 },
    children: [
      new TextRun({
        text,
        bold,
        size: 22,
        font: { ascii: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' },
      }),
    ],
  });
}

function bullet(text: string, depth = 0) {
  return new Paragraph({
    spacing: { after: 60, line: 340 },
    bullet: { level: depth },
    children: [
      new TextRun({
        text,
        size: 22,
        font: { ascii: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' },
      }),
    ],
  });
}

function numberedBullet(num: string, text: string) {
  return new Paragraph({
    spacing: { after: 60, line: 340 },
    children: [
      new TextRun({
        text: `${num} `,
        bold: true,
        size: 22,
        font: { ascii: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' },
      }),
      new TextRun({
        text,
        size: 22,
        font: { ascii: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' },
      }),
    ],
  });
}

function boldBullet(prefix: string, text: string) {
  return new Paragraph({
    spacing: { after: 60, line: 340 },
    children: [
      new TextRun({
        text: prefix,
        bold: true,
        size: 22,
        font: { ascii: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' },
      }),
      new TextRun({
        text,
        size: 22,
        font: { ascii: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' },
      }),
    ],
  });
}

function code(text: string) {
  return new Paragraph({
    spacing: { after: 80, line: 300 },
    indent: { left: 400 },
    shading: { type: ShadingType.SOLID, color: 'F5F5F5', fill: 'F5F5F5' },
    children: [
      new TextRun({
        text,
        size: 18,
        font: { ascii: 'Consolas', eastAsia: 'Consolas' },
        color: '333333',
      }),
    ],
  });
}

function table(rows: string[][], headerRow = false) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
  const headerShading = { type: ShadingType.SOLID, color: '1A365D', fill: '1A365D' };

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (row, ri) =>
        new TableRow({
          children: row.map(
            (cell) =>
              new TableCell({
                children: [
                  new Paragraph({
                    spacing: { after: 40, line: 280 },
                    children: [
                      new TextRun({
                        text: cell,
                        size: 20,
                        bold: headerRow && ri === 0,
                        color: headerRow && ri === 0 ? 'FFFFFF' : '333333',
                        font: { ascii: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' },
                      }),
                    ],
                  }),
                ],
                shading: headerRow && ri === 0 ? headerShading : undefined,
                width: { size: Math.floor(100 / row.length), type: WidthType.PERCENTAGE },
                borders: { top: border, bottom: border, left: border, right: border },
              }),
          ),
        }),
    ),
  });
}

function separator() {
  return new Paragraph({ spacing: { after: 200 }, children: [] });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

function flowBox(title: string, steps: string[]) {
  const parts: TextRun[] = [
    new TextRun({
      text: title,
      bold: true,
      size: 20,
      font: { ascii: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' },
    }),
  ];
  for (let i = 0; i < steps.length; i++) {
    parts.push(
      new TextRun({
        text: i === 0 ? '\n    ' : '\n    ↓\n    ',
        size: 20,
        color: '1A365D',
        font: { ascii: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' },
      }),
    );
    parts.push(
      new TextRun({
        text: steps[i],
        size: 20,
        font: { ascii: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' },
      }),
    );
  }
  return new Paragraph({
    spacing: { after: 200 },
    indent: { left: 200 },
    shading: { type: ShadingType.SOLID, color: 'EBF5FB', fill: 'EBF5FB' },
    border: { left: { style: BorderStyle.SINGLE, size: 4, color: '2E86C1' } },
    children: parts,
  });
}

async function main() {
  const outputPath = path.join('D:', 'Desktop', 'OpenMAIC-交互式内容定制系统-技术架构设计.docx');

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          // ========== 封面 ==========
          new Paragraph({ spacing: { before: 3000 } }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [new TextRun({ text: 'OpenMAIC', size: 56, bold: true, color: '1A365D' })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
            children: [
              new TextRun({
                text: '交互式内容定制系统',
                size: 44,
                bold: true,
                color: '2E86C1',
                font: { ascii: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' },
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: '技术架构设计文档',
                size: 36,
                color: '555555',
                font: { ascii: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' },
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: 'Human-in-the-Loop Content Customization',
                size: 24,
                italics: true,
                color: '888888',
                font: { ascii: 'Consolas', eastAsia: 'Consolas' },
              }),
            ],
          }),
          new Paragraph({ spacing: { before: 2000 } }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: '版本: v1.0 | 日期: 2026-04-28',
                size: 22,
                color: '999999',
                font: { ascii: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' },
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: 'OpenMAIC Project | AGPL-3.0',
                size: 22,
                color: '999999',
                font: { ascii: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' },
              }),
            ],
          }),

          pageBreak(),

          // ========== 目录 ==========
          heading1('目录'),
          separator(),
          body('（在 Word 中右键此处 → 更新域 以生成目录）', false),

          pageBreak(),

          // ============================================
          // 第1章: 问题定义
          // ============================================
          heading1('1. 问题定义'),

          heading2('1.1 现状分析'),
          body(
            'OpenMAIC 当前采用两阶段生成管线：需求输入 → 大纲生成 → 场景内容生成 → 课堂播放。生成过程全自动，用户只能观看最终结果，无法对内容进行修改。',
          ),
          flowBox('当前生成流程', [
            '用户输入需求（Topic / PDF）',
            'AI 生成大纲 (Stage 1: Outline Generation)',
            'AI 逐场景生成内容 (Stage 2: Scene Generation)',
            'AI 生成动作序列 + TTS 语音',
            '课堂播放 (Playback)',
          ]),

          heading2('1.2 核心痛点'),
          bullet(
            '幻灯片内容无法修改：标题、文字、图片、图表均由 AI 一次性生成，出错后只能重新生成整节课',
          ),
          bullet('互动组件不可定制：游戏难度、模拟参数、3D 模型角度等无法根据受众调整'),
          bullet('缺乏人机协作：AI 生成结果没有人工确认环节，黑盒输出降低用户信任'),
          bullet('无多轮迭代：用户无法通过对话逐步优化内容'),

          heading2('1.3 设计目标'),
          bullet('引入 Human-in-the-Loop 机制，让用户通过自然语言修改已生成的课堂内容'),
          bullet(
            '支持幻灯片、测验题、互动组件(游戏/模拟/3D/思维导图/代码)、PBL 项目等全部场景类型',
          ),
          bullet('提供「预览 → 确认 → 应用」的三步确认流程，确保用户对修改有完全控制权'),
          bullet('所有修改可逆（快照 + 修改历史），支持一键恢复'),
          boldBullet('核心理念：', 'AI 永远是建议者，用户永远是决策者'),

          pageBreak(),

          // ============================================
          // 第2章: 设计哲学
          // ============================================
          heading1('2. 设计哲学：Confirmation-First Human-in-the-Loop'),

          body(
            '本系统采用"确认优先"的人机协作范式，将 AI 的能力与人类的判断力有机结合。每一次修改都遵循严格的三步闭环：',
          ),

          flowBox('修改闭环流程', [
            '用户发现修改点 → 输入自然语言指令',
            'AI 理解意图 → 若不明确则反问澄清',
            'AI 生成修改建议 → 流式预览 + 差异摘要',
            '用户确认(接受/继续迭代/拒绝回滚)',
          ]),

          heading2('2.1 四条核心原则'),
          numberedBullet(
            '1.',
            'AI 永远是建议者，用户永远是决策者 — 修改指令由用户发起，结果由用户审判',
          ),
          numberedBullet('2.', '任何修改必须先预览、再确认、后执行 — 杜绝直接写入，保障内容安全'),
          numberedBullet(
            '3.',
            '每一步都可逆 — 快照机制在修改前自动保存，支持一键回滚至任意历史版本',
          ),
          numberedBullet(
            '4.',
            'AI 有义务解释自己改了什么、为什么 — 每次修改附带差异摘要和自信度评分',
          ),

          heading2('2.2 体验设计原则'),
          bullet('渐进信任：从低风险修改（改文字）到高风险修改（重组布局），逐步建立用户信任'),
          bullet('即时反馈：流式渲染让用户在 AI 生成过程中就能看到变化，而非等待完成后突然出现'),
          bullet('可预测操作：任何修改都有明确的边界说明，用户始终知道 AI 会动什么、不会动什么'),
          bullet('低成本试错：基于快照的秒级回滚，鼓励用户大胆尝试不同修改策略'),

          pageBreak(),

          // ============================================
          // 第3章: 三种交互模式
          // ============================================
          heading1('3. 三种交互模式'),

          body('根据修改粒度和用户意图的复杂度，系统提供三种渐进的交互模式：'),

          heading2('3.1 Spot Edit — 元素级快速修改'),
          body(
            '适用于修改单个元素的场景。用户点击幻灯片中的任意元素，弹出指令框，输入简短的自然语言指令。',
          ),
          boldBullet('触发方式：', '点击元素 → 弹出指令框'),
          boldBullet(
            '典型用例：',
            '"把这行标题改成红色加粗"、"把这张图片替换成细胞膜的示意图"、"这个数字 42 改成 100"',
          ),
          boldBullet('响应时间：', '< 3 秒（使用闪电模型，非流式），预览实时渲染在元素原位'),
          boldBullet('适用场景：', '幻灯片元素的文字、样式、图片、位置微调'),

          heading2('3.2 Scene Modify — 场景级批量修改'),
          body(
            '适用于修改整页内容的场景。用户打开侧边修改面板，输入修改指令，系统流式生成修改结果并展示差异预览。',
          ),
          boldBullet('触发方式：', '场景侧边栏「修改」按钮 → 指令输入面板'),
          boldBullet(
            '典型用例：',
            '"把这页改成两栏布局，左边放文字右边放图表"、"简化这些题目，把 4 个选项改成 2 个"、"给这个游戏添加计时器"',
          ),
          boldBullet('响应时间：', '10-20 秒（流式预览，用户可实时看到变化）'),
          boldBullet('适用场景：', '布局调整、图片批量替换、题型改造、互动组件参数调整'),

          heading2('3.3 Conversational Refine — 对话式深度迭代'),
          body(
            '适用于复杂多轮优化的场景。用户像和 AI 助教讨论一样逐步迭代内容，AI 可以提问澄清意图，用户可以渐进描述需求。',
          ),
          boldBullet('触发方式：', '聊天窗口切换至「定制模式」'),
          boldBullet(
            '典型用例：',
            '"这个游戏太难了，小学生玩不了" → AI 提出 3 种改进方案 → 用户选择 → AI 修改 → 用户继续调整',
          ),
          boldBullet('响应时间：', '每轮 10-30 秒，多轮对话逐步收敛'),
          boldBullet('适用场景：', '互动游戏难度调整、PBL 项目阶段重构、复杂 3D 场景定制'),

          separator(),
          heading3('三种模式对比'),
          table(
            [
              ['特性', 'Spot Edit', 'Scene Modify', 'Conversational Refine'],
              ['修改范围', '单个元素', '整页场景', '跨场景 / 多轮'],
              ['响应方式', '非流式', '流式预览', '对话 + 流式'],
              ['AI 反问', '无', '可选', '核心机制'],
              ['历史记录', '元素级撤销', '场景级快照', '完整对话 + 快照'],
              ['典型耗时', '<3s', '10-20s', '30s-2min'],
              ['学习成本', '零（直觉操作）', '低（类似聊天）', '中（对话技巧）'],
            ],
            true,
          ),

          pageBreak(),

          // ============================================
          // 第4章: 系统架构
          // ============================================
          heading1('4. 系统架构总览'),

          heading2('4.1 分层架构'),
          body(
            '系统采用四层架构，从上到下依次为：表现层（UI）、状态层（Store）、服务层（API）、模型层（LLM/Prompt）。各层之间通过明确的接口契约解耦，修改仅影响对应层级。',
          ),

          heading3('架构分层图'),
          body('（架构图以文字描述形式呈现，对应下图结构）'),
          separator(),

          flowBox('┌─ 表现层 (Presentation) ─┐', [
            'Scene Renderers (Slide / Quiz / Interactive / PBL)',
            'Modification Panel (指令输入 → 模式选择 → 高级选项)',
            'Preview Dialog (并排 Diff 视图 → 确认 / 迭代 / 拒绝)',
            'Chat Area (Conversational Refine 对话区)',
          ]),
          separator(),
          flowBox('┌─ 状态层 (State) ─┐', [
            'Modification Store — pendingModification / history / mode / status',
            'Stage Store — 应用修改到场景数据',
            'Snapshot Store — 修改前自动保存，支持秒级回滚',
            'Settings Store — 用户偏好的模型 / 深度 / 对比模式',
          ]),
          separator(),
          flowBox('┌─ 服务层 (Service) ─┐', [
            '/api/modify-scene (SSE) — 场景修改 API',
            'Scene Modifier — 类型感知的内容修改引擎',
            'Diff Engine — 差异计算 + 结构化变更摘要',
            'LLM Layer (callLLM / streamLLM + ThinkingConfig)',
          ]),
          separator(),
          flowBox('┌─ 模型层 (Model) ─┐', [
            'Prompt Templates (modify-scene-content / modify-clarify)',
            'Snippets (modify-slide-guidelines / modify-quiz-guidelines / modify-interactive-guidelines)',
            'Provider Abstraction (14 providers, 60+ models)',
            'ThinkingConfig (快速 / 标准 / 深度 三档推理)',
          ]),

          heading2('4.2 数据流'),
          flowBox('一次修改的完整数据流', [
            '用户选择场景 → Modification Panel 输入指令',
            '→ Modification Store 记录原始内容 + 指令',
            '→ POST /api/modify-scene (sceneContent + instruction + mode)',
            '→ Prompt Builder 组装模板 + 上下文 + 修改指令',
            '→ streamLLM 流式生成修改后内容',
            '→ SSE 逐字段返回 delta + done(modifiedContent + diffSummary + confidence)',
            '→ Preview Dialog 展示差异对比',
            '→ 前端验证 → Snapshot Store 保存快照 (addSnapshot)',
            '→ 用户确认 → Stage Store 应用修改 → Scene Renderer 重新渲染',
            '→ 修改记录写入 Modification Store.history',
            '→ 用户拒绝 → Snapshot Store 回滚 (undo) → 状态恢复',
          ]),

          pageBreak(),

          // ============================================
          // 第5章: 核心组件设计
          // ============================================
          heading1('5. 核心组件详细设计'),

          heading2('5.1 Modification Store（新增 Zustand Store）'),
          body('Modification Store 是本次新增的核心状态管理模块，负责管理修改的全生命周期状态。'),
          code(`interface ModificationStore {
  activeSession: {
    sceneId: string;
    sceneType: 'slide' | 'quiz' | 'interactive' | 'pbl';
    originalContent: SceneContent;
    mode: 'spot' | 'scene' | 'conversational';
    status: 'idle' | 'clarifying' | 'streaming'
           | 'previewing' | 'applying' | 'error';
    instruction: string;
    aiQuestions?: string[];
    modifiedContent: SceneContent | null;
    diffSummary: DiffSummary | null;
    confidence: number;
    streamProgress: number;
  } | null;
  history: ModificationHistoryEntry[];
  maxHistoryPerScene: number; // default 20
  isPanelOpen: boolean;
  previewMode: 'split' | 'overlay';
}`),

          heading2('5.2 DiffSummary 差异摘要'),
          body('每次修改后，AI 必须返回结构化的差异摘要，让用户一目了然地理解改动内容。'),
          code(`interface DiffSummary {
  changedElements: string[];    // ["标题文字", "第3张图片"]
  unchangedHint: string;        // "其余 12 个元素未改动"
  riskyChanges?: string[];     // AI 标记的不确定改动
}
interface ModificationHistoryEntry {
  id: string;
  sceneId: string;
  timestamp: number;
  instruction: string;
  beforeSnapshot: number;      // 快照游标
  diffSummary: DiffSummary;
  accepted: boolean;
}`),

          heading2('5.3 Prompt 模板系统扩展'),
          body(
            '在现有 lib/prompts/ 体系中新增两个模板，充分利用已有的三级模板处理机制（snippet → 条件块 → 变量插值）。',
          ),

          heading3('模板 1: modify-scene-content（通用场景修改）'),
          code(`system.md 核心指令:
1. 理解用户意图。如果不明确 (< 70% 把握)，标记 confidence < 0.7 并说明疑问
2. 只修改用户提到的部分，保持其余内容不变
3. 输出结构严格匹配输入结构（同构 JSON）
4. 附带 DiffSummary，说明具体改了什么

{{#if sceneType === 'slide'}}
  {{snippet:modify-slide-guidelines}}
{{/if}}
{{#if sceneType === 'quiz'}}
  {{snippet:modify-quiz-guidelines}}
{{/if}}
{{#if sceneType === 'interactive'}}
  {{snippet:modify-interactive-guidelines}}
{{/if}}

输出 JSON:
{
  "modifiedContent": {...},      // 完整修改后内容
  "diffSummary": {
    "changedElements": [...],
    "unchangedHint": "...",
    "riskyChanges": [...]
  },
  "confidence": 0.0 - 1.0,
  "explanation": "..."           // 自然语言解释
}`),

          heading3('模板 2: modify-clarify（意图澄清）'),
          code(`当 AI 不确定用户意图时主动提问：
{
  "needsClarification": true,
  "questions": [
    { "question": "你想使用哪种布局？", "options": ["两栏", "三栏", "全宽"] }
  ]
}`),

          heading2('5.4 Modification Panel UI'),
          body('三个子面板，根据当前模式动态切换显示：'),

          heading3('Spot Edit 模式'),
          bullet('触发：点击幻灯片元素 → 元素周围出现高亮框 + 底部弹出指令气泡'),
          bullet('指令框：单行输入 + Enter 发送，支持 @ 引用其他元素'),
          bullet('快捷指令栏：改文字 / 换图片 / 调位置 / 改样式'),
          bullet('预览：修改结果直接渲染在元素原位（绿色闪烁 500ms 提示变化）'),

          heading3('Scene Modify 模式'),
          bullet('触发：场景侧边栏「修改」按钮 → 右侧滑出修改面板'),
          bullet('指令输入：多行文本框，带大纲提示（"描述你想要的修改..."）'),
          bullet('快捷指令 Chip：简化 / 翻译 / 加图 / 加题 / 重排'),
          bullet('高级选项折叠区：模型选择 + 推理深度滑块 + 输出风格偏好'),
          bullet('预览：并排展示「当前版本」vs「修改后」'),

          heading3('Conversational Refine 模式'),
          bullet('触发：聊天窗口切换至「定制模式」选项卡'),
          bullet('对话界面：类似 ChatGPT，用户消息 + AI 回答交替显示'),
          bullet('AI 可以发送结构化响应：文字说明 + 选项按钮 + 修改预览卡片'),
          bullet('支持引用历史消息进行迭代（"上一版的颜色再调亮一点"）'),

          heading2('5.5 Preview & Confirmation Dialog'),
          body(
            '确认对话框是 Human-in-the-Loop 的核心 UI。采用并排对比布局，左右两栏分别展示修改前后的状态。',
          ),

          heading3('布局结构'),
          bullet('顶部工具栏：查看模式切换（并排 / 叠加 ）、缩放控制、全屏预览'),
          bullet('左栏（当前版本）：半透明覆盖，表示即将被替换'),
          bullet('右栏（修改后）：完整渲染，绿色边框高亮'),
          bullet('差异高亮：修改过的元素标记颜色（绿色=新增，黄色=修改，红色=移除）'),
          bullet('底部信息栏：AI 变更说明 + 自信度指示器 + 变更统计'),

          heading3('操作按钮'),
          bullet('「✅ 应用修改」— 主操作按钮，将修改写入 Stage Store 并结束会话'),
          bullet('「🔄 继续修改」— 保留当前修改结果作为新基准，打开指令框进行下一轮迭代'),
          bullet('「↩ 拒绝」— 放弃修改，回滚到快照状态，保留指令到历史记录供后续参考'),

          heading2('5.6 流式预览体验'),
          body(
            '复用现有的 StreamBuffer 基础设施（lib/buffer/stream-buffer.ts），实现字符级渐进渲染，让用户在 AI 生成过程中就能实时看到变化。',
          ),

          table(
            [
              ['时间', '状态', '用户体验'],
              ['t=0ms', '点击生成', '快照保存 → 指令区显示加载动画'],
              ['t=2s', 'AI 开始返回', '进度条出现 → 标题区域出现骨架屏闪烁'],
              ['t=3s', '标题修改完成', '标题文字实时更新（绿色脉冲动画 500ms）'],
              ['t=5s', '图片生成中', '图片区显示 pulsating placeholder + 预计完成时间'],
              ['t=8s', '全部完成', 'DiffSummary 弹出 → 用户可以确认/拒绝了'],
            ],
            true,
          ),

          pageBreak(),

          // ============================================
          // 第6章: API 设计
          // ============================================
          heading1('6. API 设计'),

          heading2('6.1 POST /api/modify-scene（SSE 流式）'),
          body('核心修改 API，接收现有场景内容 + 用户指令，流式返回修改后内容。'),

          boldBullet('请求头：', 'x-model, x-api-key, x-base-url, x-thinking-effort'),
          separator(),

          boldBullet('请求体：', ''),
          code(`{
  sceneType: 'slide' | 'quiz' | 'interactive' | 'pbl',
  sceneContent: SceneContent,         // 当前场景完整内容
  instruction: string,                // 用户修改指令
  mode: 'spot' | 'scene' | 'conversational',
  conversationHistory?: Message[],    // Conversational 模式的历史
  languageDirective: string,          // 语言指令
  previousModification?: SceneContent // Refine 模式下上一版内容
}`),

          boldBullet('SSE 事件类型：', ''),
          table(
            [
              ['事件', '数据', '说明'],
              [
                'progress',
                '{ percent: number, status: string }',
                '流式进度更新（如"正在生成图片..."）',
              ],
              ['clarify', '{ questions: [...] }', 'AI 不确定意图，向用户反问'],
              ['delta', '{ field: string, value: any }', '增量字段更新（如标题/图片/选项）'],
              [
                'done',
                '{ modifiedContent, diffSummary, confidence, explanation }',
                '修改完成，附带差异摘要',
              ],
              ['error', '{ error: string }', '出错时返回错误信息'],
            ],
            true,
          ),

          heading2('6.2 GET /api/modify-scene/history'),
          body('查询场景的修改历史，支持恢复到任意版本。'),
          bullet('查询参数：stageId + sceneId'),
          bullet('返回：ModificationHistoryEntry[] 按时间倒序'),
          bullet('用于修改历史面板浏览 + 一键恢复'),

          pageBreak(),

          // ============================================
          // 第7章: 场景类型修改策略
          // ============================================
          heading1('7. 按场景类型的修改策略'),

          heading2('7.1 Slide 场景'),
          table(
            [
              ['修改类别', '示例指令', '技术方案'],
              ['文字修改', '"把标题改成红色的"', '直接修改 PPTTextElement.content + style 字段'],
              ['图片替换', '"换一张细胞膜的结构图"', '触发 AI 图片生成 → 替换 ImageElement.src'],
              ['布局调整', '"改成两栏布局"', 'AI 重新计算元素坐标(left/top/width/height)'],
              ['添加元素', '"加一个柱状图展示数据"', 'AI 生成 ChartElement → 插入到 elements 数组'],
              ['删除元素', '"去掉第三张图"', '从 elements 数组移除对应元素'],
            ],
            true,
          ),

          heading2('7.2 Quiz 场景'),
          table(
            [
              ['修改类别', '示例指令', '技术方案'],
              ['题目修改', '"把题干改成更简单的中文"', '修改 QuizQuestion.question 字段'],
              ['选项调整', '"再加一个 D 选项"', '动态 push 或 pop options 数组'],
              ['答案修改', '"正确答案改成 B"', '修改 QuizQuestion.correctAnswer 字段'],
              ['难度调整', '"出 3 道更难的题"', '重新生成整个 questions 数组，提高难度参数'],
              ['答案解析', '"给每道题加详细的解题步骤"', '修改 QuizQuestion.analysis 字段'],
            ],
            true,
          ),

          heading2('7.3 Interactive 场景'),
          table(
            [
              ['Widget 类型', '示例指令', '技术方案'],
              [
                'Simulation',
                '"把温度范围调到 -50 到 100"',
                '修改 SimulationConfig.variables 的 min/max',
              ],
              ['Game', '"改成匹配题而不是选择题"', '修改 GameConfig.gameType + 重新生成题目'],
              [
                'Visualization3D',
                '"把分子模型改成球棍模型"',
                '修改 objects 数组的 materials + 重新生成 HTML',
              ],
              ['Diagram', '"改成果树图而不是流程图"', '修改 diagramType → 重新生成 nodes/edges'],
              ['Code', '"把 Python 改成 JavaScript"', '修改 language + 重新生成 starterCode'],
              ['全部', '"加上计时器和得分显示"', '修改 widgetConfig + 重新生成完整 HTML'],
            ],
            true,
          ),

          heading2('7.4 PBL 场景'),
          table(
            [
              ['修改类别', '示例指令', '技术方案'],
              ['角色调整', '"再加一个 UI 设计师角色"', '修改 projectConfig.roles 数组'],
              ['阶段修改', '"把时间从 3 周压缩到 1 周"', '修改 stage 的时间线和里程碑'],
              ['任务重排', '"把需求分析放在设计前面"', '重新排列 stages 数组顺序'],
            ],
            true,
          ),

          pageBreak(),

          // ============================================
          // 第8章: 安全与质量保障
          // ============================================
          heading1('8. 安全与质量保障'),

          heading2('8.1 多层防护机制'),
          table(
            [
              ['机制', '触发条件', '行为'],
              ['结构校验', '每次修改后', 'zod schema 验证，不通过则拒绝修改并提示错误'],
              ['元素计数保护', '移除 > 50% 元素', '弹出警告："将删除 8/12 个元素，确认继续？"'],
              ['Diff 透明度', '每次修改', '展示清晰的颜色编码差异（绿=新增，红=移除，黄=修改）'],
              ['快照前置', '每次修改前', '自动 addSnapshot()，一键撤销任何修改'],
              ['自信度门禁', 'confidence < 0.5', '强制要求用户仔细确认修改结果'],
              ['自信度拒绝', 'confidence < 0.3', '建议用户重新描述需求或切换更强模型'],
              ['成本预估', '提交前', '根据内容大小 + 模型费率估算 token 消耗，超预算时警告'],
            ],
            true,
          ),

          heading2('8.2 错误处理与降级'),
          bullet('网络中断：SSE 断线重连（3 次指数退避），重连后从上次进度继续'),
          bullet('AI 超时：60s 超时自动终止，保留已生成的部分内容供用户查看'),
          bullet('JSON 解析失败：调用 jsonrepair 修复格式；仍失败则回退到上一有效快照'),
          bullet('模型不可用：自动降级到后备模型（配置在 Settings Store）'),
          bullet('并发修改：同一场景只允许一个活跃修改会话，防止竞态条件'),

          pageBreak(),

          // ============================================
          // 第9章: 实施路线图
          // ============================================
          heading1('9. 实施路线图'),

          heading2('9.1 分阶段交付计划'),
          table(
            [
              ['阶段', '内容', '工期', '交付物'],
              [
                'P1: Core',
                'Scene Modify (Slide + Quiz) / diff 预览 / 快照集成 / 基础 API',
                '2 周',
                '闭环可演示',
              ],
              [
                'P2: UX',
                'Spot Edit / 流式预览 / 确认面板动画 / 快捷指令',
                '1.5 周',
                '流畅的用户体验',
              ],
              [
                'P3: Interactive',
                'Interactive 场景修改 (widgetConfig + 重生成 HTML)',
                '1 周',
                '覆盖所有场景类型',
              ],
              [
                'P4: Conversational',
                '对话式多轮 Refine / AI 澄清 / 修改历史',
                '1.5 周',
                '深度交互模式',
              ],
              ['P5: Polish', '性能优化 / 错误处理 / 测试覆盖 / 文档', '1 周', '生产就绪'],
            ],
            true,
          ),

          heading2('9.2 各阶段技术依赖'),
          body('P1 仅依赖已有基础设施（prompt 系统、LLM layer、snapshot store），无需引入新框架。'),
          bullet('P1 → 依赖：buildPrompt + streamLLM + snapshotStore + stageStore'),
          bullet('P2 → 依赖 P1 + StreamBuffer + 动画组件'),
          bullet('P3 → 依赖 P1 + widgetConfig 解析 + HTML 后处理'),
          bullet('P4 → 依赖 P1 + agent-loop (复用 director-graph)'),
          bullet('P5 → 依赖 P1-P4 全部 + vitest 测试框架'),

          pageBreak(),

          // ============================================
          // 第10章: 前后对比
          // ============================================
          heading1('10. 引入修改系统前后对比'),

          table(
            [
              ['维度', '当前系统', '引入 Modification 后'],
              ['内容生产', '全自动，用户只能看', '全自动生成 + 手工精调'],
              ['修改能力', '无，只能重新生成', '自然语言修改任意元素 / 组件'],
              ['用户控制', '生成参数（课前）', '全生命周期控制（课前+课中+课后）'],
              ['多轮迭代', '不支持', '对话式逐步优化，最多 10 轮'],
              ['容错机制', '重新生成整节课', '撤销单次修改 / 恢复任意历史版本'],
              ['AI 透明度', '黑盒生成', '每次修改附变更说明 + 自信度评分'],
              ['修改粒度', 'N/A', '元素级 → 场景级 → 对话级 三级'],
              ['用户信任', '被动接受', '确认制：先预览、再确认、后执行'],
            ],
            true,
          ),

          pageBreak(),

          // ============================================
          // 第11章: 关键技术难点
          // ============================================
          heading1('11. 关键技术难点及解决方案'),

          table(
            [
              ['难点', '风险评估', '解决方案'],
              [
                'Slide JSON 体量大 (1000+ 行)',
                '中 — 流式传输慢，解析开销大',
                '先用 AI 提取差异 patch，再全量替换；流式渲染仅更新差异区域',
              ],
              [
                'AI 过度修改未指定部分',
                '高 — 核心质量风险',
                'System prompt 严格约束 + 输出后 diff 校验 + 过度修改时自动警告',
              ],
              [
                'iframe HTML 实时预览',
                '中 — 跨上下文通信延迟',
                'postMessage 协议替换 srcdoc；滚动位置通过 message 回传保持',
              ],
              [
                '多模型成本差异',
                '中 — 用户可能无感知',
                '提供「快速/标准/深度」三档，映射到不同模型 + ThinkingConfig',
              ],
              [
                '用户意图模糊',
                '高 — 影响使用体验',
                '内置 clarify 机制：AI 不理解时主动反问，而非猜测执行',
              ],
              [
                '流式渲染与快照竞态',
                '低 — 代码可控',
                '快照在流式开始前保存；流式期间禁止其他修改操作（UI 锁定）',
              ],
            ],
            true,
          ),

          separator(),
          separator(),

          // ========== 尾页 ==========
          new Paragraph({ spacing: { before: 2000 } }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [new TextRun({ text: '谢谢！', size: 44, bold: true, color: '1A365D' })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [new TextRun({ text: '问题与讨论', size: 28, color: '2E86C1' })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 600, after: 100 },
            children: [
              new TextRun({
                text: 'OpenMAIC — Open Multi-Agent Interactive Classroom',
                size: 20,
                italics: true,
                color: '888888',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: 'github.com/THU-MAIC/OpenMAIC | AGPL-3.0',
                size: 20,
                color: '999999',
              }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  console.log(`Document generated: ${outputPath}`);
}

main().catch(console.error);
