import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FONT = 'Microsoft YaHei';

type RunOptions = {
  size?: number;
  bold?: boolean;
  color?: string;
  italics?: boolean;
  font?: { ascii?: string; eastAsia?: string } | string;
};

function run(text: string, options: RunOptions = {}) {
  return new TextRun({
    text,
    size: 22,
    font: { ascii: FONT, eastAsia: FONT },
    ...options,
  });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

function title(text: string) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
    children: [run(text, { size: 44, bold: true, color: '1F4E79' })],
  });
}

function subtitle(text: string) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 180 },
    children: [run(text, { size: 28, color: '666666' })],
  });
}

function h1(text: string) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 180 },
  });
}

function h2(text: string) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 120 },
  });
}

function p(text: string) {
  return new Paragraph({
    spacing: { after: 100, line: 330 },
    children: [run(text)],
  });
}

function bullet(text: string) {
  return new Paragraph({
    spacing: { after: 70, line: 320 },
    indent: { left: 300 },
    children: [run('• ', { bold: true, color: '1F4E79' }), run(text)],
  });
}

function note(text: string) {
  return new Paragraph({
    spacing: { before: 80, after: 140, line: 320 },
    shading: { type: ShadingType.SOLID, fill: 'EAF3F8', color: 'EAF3F8' },
    border: {
      left: { style: BorderStyle.SINGLE, size: 8, color: '2F75B5' },
    },
    indent: { left: 180 },
    children: [run(text, { color: '1F4E79', bold: true })],
  });
}

function codeBlock(text: string) {
  return new Paragraph({
    spacing: { before: 80, after: 140, line: 260 },
    shading: { type: ShadingType.SOLID, fill: 'F4F4F4', color: 'F4F4F4' },
    indent: { left: 260 },
    children: [
      new TextRun({
        text,
        size: 18,
        font: { ascii: 'Consolas', eastAsia: 'Microsoft YaHei' },
        color: '333333',
      }),
    ],
  });
}

function spacer(lines = 1) {
  return new Paragraph({ spacing: { before: lines * 80, after: lines * 80 } });
}

function cell(text: string, options: { header?: boolean; fill?: string; bold?: boolean } = {}) {
  const fill = options.header ? '1F4E79' : options.fill;
  return new TableCell({
    width: { size: 1, type: WidthType.AUTO },
    margins: { top: 90, bottom: 90, left: 120, right: 120 },
    shading: fill ? { type: ShadingType.SOLID, fill, color: fill } : undefined,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' },
    },
    children: [
      new Paragraph({
        spacing: { after: 0, line: 280 },
        children: [
          run(text, {
            size: 20,
            bold: options.header || options.bold,
            color: options.header ? 'FFFFFF' : '222222',
          }),
        ],
      }),
    ],
  });
}

function table(rows: string[][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (row, rowIndex) =>
        new TableRow({
          children: row.map((value) => cell(value, { header: rowIndex === 0 })),
        }),
    ),
  });
}

function twoColTable(leftTitle: string, rightTitle: string, rows: string[][]) {
  return table([[leftTitle, rightTitle], ...rows]);
}

function flowChart(titleText: string, steps: string[]) {
  const rows: TableRow[] = [];
  rows.push(
    new TableRow({
      children: [
        new TableCell({
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          shading: { type: ShadingType.SOLID, fill: '1F4E79', color: '1F4E79' },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: '1F4E79' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: '1F4E79' },
            left: { style: BorderStyle.SINGLE, size: 1, color: '1F4E79' },
            right: { style: BorderStyle.SINGLE, size: 1, color: '1F4E79' },
          },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 0 },
              children: [run(titleText, { bold: true, color: 'FFFFFF', size: 22 })],
            }),
          ],
        }),
      ],
    }),
  );

  steps.forEach((step, index) => {
    rows.push(
      new TableRow({
        children: [
          new TableCell({
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            shading: {
              type: ShadingType.SOLID,
              fill: index % 2 === 0 ? 'EAF3F8' : 'F7FBFD',
              color: 'EAF3F8',
            },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: '9ECAE1' },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: '9ECAE1' },
              left: { style: BorderStyle.SINGLE, size: 1, color: '9ECAE1' },
              right: { style: BorderStyle.SINGLE, size: 1, color: '9ECAE1' },
            },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 0 },
                children: [run(step, { bold: true, color: '1F4E79' })],
              }),
            ],
          }),
        ],
      }),
    );
    if (index < steps.length - 1) {
      rows.push(
        new TableRow({
          children: [
            new TableCell({
              margins: { top: 30, bottom: 30, left: 120, right: 120 },
              borders: {
                top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 0 },
                  children: [run('↓', { color: '2F75B5', size: 24, bold: true })],
                }),
              ],
            }),
          ],
        }),
      );
    }
  });

  return new Table({
    width: { size: 86, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.CENTER,
    rows,
  });
}

function decisionFlow() {
  return table([
    ['阶段', 'AI 产物', '用户动作', '系统动作'],
    [
      '1. 意图分析',
      '理解用户需求，识别修改范围',
      '补充说明或选择目标元素',
      '锁定 scene / element 上下文',
    ],
    [
      '2. 计划生成',
      'EditPlan + 风险等级 + 变更摘要',
      '确认计划 / 要求调整 / 取消',
      '不写入真实 Stage',
    ],
    ['3. 预览执行', '基于计划生成 Preview Scene', '查看 Before / After', '只修改 Preview Branch'],
    ['4. 最终确认', '解释差异与自信度', 'Accept / Refine / Reject', 'Accept 才写入 Stage Store'],
  ]);
}

function main() {
  const outputPath = path.join(
    'D:',
    'Desktop',
    'OpenMAIC-Interactive-Customization-Architecture.docx',
  );

  const children = [
    spacer(8),
    title('OpenMAIC 交互式内容定制化'),
    subtitle('技术方案可行性分析、需求文档与开发计划'),
    subtitle('Human-in-the-Loop · Edit Plan · Preview Branch · Agent Tool Layer'),
    spacer(8),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run('面向组会汇报版本 | 2026-04-28', { color: '888888' })],
    }),
    pageBreak(),

    h1('0. 执行摘要'),
    note(
      '结论：方案完全可行，但建议从“LLM 直接生成完整 Scene JSON”升级为“Intent → Edit Plan → Preview Branch → Human Approval → Commit”的结构化编辑架构。',
    ),
    p(
      'OpenMAIC 当前已经具备场景数据管理、Stage API、快照撤销、Prompt 模板、LLM 调用、SSE 流式、IndexedDB 持久化等关键基础设施。交互式内容定制化可以作为增量模块接入，不需要重构主生成链路。',
    ),
    p(
      '推荐方案的核心思想是：AI 不直接覆盖真实课堂内容，而是先生成可审查的修改计划；系统在临时预览分支中执行确定性的编辑操作；用户确认后才提交到真实 Stage。',
    ),
    flowChart('推荐核心流程', [
      '用户输入自然语言修改需求',
      'AI 生成 Edit Plan（修改计划）',
      '用户确认计划或要求调整',
      '系统在 Preview Branch 执行操作',
      '用户查看 Before / After 预览',
      'Accept 提交 / Refine 继续 / Reject 丢弃',
    ]),

    h1('1. 之前方案可行性分析'),
    h2('1.1 之前方案概述'),
    p(
      '之前方案采用“用户提示词 → LLM 生成修改后的完整 SceneContent → 用户预览 → 确认应用”的路径。该方案能实现基础闭环，但对复杂场景存在可靠性和可控性风险。',
    ),
    twoColTable('优点', '问题', [
      ['实现直接，改造成本较低', 'LLM 容易误改用户未指定内容'],
      ['适合快速验证 MVP', '大尺寸 slide canvas JSON 不稳定'],
      ['能够复用现有 generate-scene 逻辑', 'Diff 只能事后计算，难以解释“为什么改”'],
      ['可以快速支持自然语言修改', 'Interactive HTML 全量重写容易破坏交互'],
    ]),
    h2('1.2 风险评估'),
    table([
      ['风险', '影响', '严重程度', '建议'],
      [
        'LLM 直接返回完整 SceneContent',
        '可能改坏未指定元素或丢失字段',
        '高',
        '改为 EditOperation 执行器',
      ],
      [
        'Interactive HTML 重写',
        'iframe 无法运行、交互状态丢失',
        '高',
        '优先修改 widgetConfig，必要时重生成 HTML',
      ],
      ['用户只看到最终结果', 'Human-in-the-loop 表达不充分', '中', '加入“确认计划”前置环节'],
      ['修改历史难追踪', '无法说明每次变更来源', '中', '保存 EditPlan + operation log'],
      ['全量 JSON diff 不直观', '用户看不懂变更范围', '中', '生成用户可读 DiffSummary'],
    ]),

    h1('2. 推荐方案：结构化编辑代理架构'),
    h2('2.1 架构原则'),
    bullet('AI 负责理解意图和生成修改计划，不直接修改真实数据。'),
    bullet('系统使用确定性的 Operation Executor 执行编辑，降低 AI 输出不稳定风险。'),
    bullet('所有修改先进入 Preview Branch，用户确认后才提交到 Stage Store。'),
    bullet('每次修改都保存 EditPlan、operation log、diff summary 和快照游标。'),
    bullet(
      '高风险操作必须触发二次确认，例如删除大量元素、改 quiz 正确答案、重写 interactive HTML。',
    ),
    h2('2.2 新旧架构对比'),
    table([
      ['维度', '旧方案', '推荐方案'],
      ['AI 输出', '完整 SceneContent', 'EditPlan + EditOperation[]'],
      ['执行方式', '直接替换内容', '确定性操作执行器'],
      ['Human-in-the-loop', '结果确认', '计划确认 + 结果确认'],
      ['Diff 来源', '事后 JSON 对比', '操作日志 + 视觉差异'],
      ['可控性', '中', '高'],
      ['适合复杂 interactive', '风险高', '先改 config，必要时再重生成 HTML'],
      ['可测试性', '较弱', '强，可单测每个 operation'],
    ]),
    h2('2.3 Human-in-the-loop 决策流'),
    decisionFlow(),

    h1('3. 需求文档'),
    h2('3.1 背景'),
    p(
      'OpenMAIC 可以基于主题或文档生成完整 AI 课堂，包括幻灯片、测验、互动实验、游戏、3D 可视化、思维导图、在线编程和 PBL 项目。但当前生成后内容基本不可编辑，用户只能重新生成或接受结果。',
    ),
    h2('3.2 产品目标'),
    table([
      ['目标', '说明'],
      ['自然语言定制', '用户用提示词修改已生成内容'],
      ['人类确认优先', 'AI 先展示计划和预览，用户确认后才执行'],
      ['可逆修改', '所有修改支持撤销、拒绝和恢复历史版本'],
      ['多场景覆盖', '支持 slide、quiz、interactive、pbl'],
      ['低风险执行', '使用结构化 operation，而不是让 AI 直接重写大 JSON'],
      ['体验接近 Agent', 'AI 解释计划，等待用户确认，再执行修改'],
    ]),
    h2('3.3 用户故事'),
    table([
      ['编号', '用户故事'],
      ['US-1', '作为用户，我希望输入“让这页更适合小学生”，系统能告诉我它计划简化哪些内容。'],
      ['US-2', '作为用户，我希望 AI 修改前先展示修改计划，而不是直接覆盖原内容。'],
      ['US-3', '作为用户，我希望看到修改前后对比，并决定接受、继续修改或拒绝。'],
      ['US-4', '作为用户，我希望点击单个元素后说“把这张图换成细胞结构图”。'],
      ['US-5', '作为用户，我希望能修改互动游戏的规则、难度和反馈方式。'],
      ['US-6', '作为用户，我希望任何 AI 修改都可以撤销。'],
      ['US-7', '作为用户，我希望 AI 在不确定时先问我，而不是猜测执行。'],
    ]),
    h2('3.4 功能范围'),
    table([
      ['阶段', '功能', '说明'],
      ['MVP', 'Scene Modify', '针对当前场景整体修改'],
      ['MVP', 'Edit Plan 生成', 'AI 输出修改计划，不直接应用'],
      ['MVP', 'Plan Approval', '用户确认计划后才进入预览执行'],
      ['MVP', 'Preview Branch', '修改先应用到临时副本'],
      ['MVP', 'Before / After 预览', '展示修改前后效果'],
      ['MVP', 'Accept / Reject', '接受写入 Stage，拒绝丢弃'],
      ['MVP', 'Snapshot 集成', '提交前自动保存快照'],
      ['MVP', 'Slide + Quiz 支持', '优先支持最稳定、最易演示的场景'],
      ['Phase 2', 'Spot Edit', '点击单个元素后局部修改'],
      ['Phase 3', 'Interactive 支持', '修改 simulation/game/code/3D/mindmap'],
      ['Phase 4', 'Conversational Refine', '对话式多轮定制'],
    ]),

    h1('4. 技术架构设计'),
    h2('4.1 现有代码可复用能力'),
    table([
      ['能力', '现有位置', '复用方式'],
      ['场景数据管理', 'lib/store/stage.ts', '修改后写入 scenes 并自动持久化'],
      ['快照撤销', 'lib/store/snapshot.ts', 'commit 前自动 addSnapshot()'],
      ['Stage API', 'lib/api/stage-api.ts', '作为结构化修改执行层'],
      ['元素操作', 'lib/api/stage-api-element.ts', 'add/update/delete/move slide 元素'],
      ['Prompt 系统', 'lib/prompts/', '新增 modify-scene-plan 模板'],
      ['LLM 调用', 'lib/ai/llm.ts', '复用 callLLM / streamLLM'],
      ['SSE 流式', 'app/api/chat/route.ts', '复用进度和解释的流式返回模式'],
      ['Agent Loop', 'lib/chat/agent-loop.ts', '后续扩展为多轮 modification loop'],
      ['PBL Tool 模式', 'lib/pbl/generate-pbl.ts', '参考 AI 调工具修改结构的模式'],
    ]),
    h2('4.2 模块划分'),
    table([
      ['模块', '建议位置', '职责'],
      ['Modification Panel', 'components/modification/', '用户输入修改指令、选择模式、查看计划'],
      ['Modification Store', 'lib/store/modification.ts', '管理修改会话、预览态、历史记录'],
      ['Plan API', 'app/api/modify-scene/plan/route.ts', '调用 LLM 生成 EditPlan'],
      ['Preview API', 'app/api/modify-scene/preview/route.ts', '执行预览并返回 diff'],
      ['Plan Generator', 'lib/modification/plan-generator.ts', '解析用户意图并生成结构化计划'],
      [
        'Operation Executor',
        'lib/modification/operation-executor.ts',
        '在 preview scene 上执行 operations',
      ],
      ['Diff Engine', 'lib/modification/diff-engine.ts', '生成可读差异摘要'],
      ['Validators', 'lib/modification/validators.ts', '校验操作合法性和风险等级'],
      [
        'Stage Modification Tools',
        'lib/modification/stage-modification-tools.ts',
        '后续 Agent 工具层',
      ],
    ]),
    h2('4.3 运行时架构流程图'),
    flowChart('Runtime Architecture', [
      'Classroom 页面选中当前 Scene / Element',
      'Modification Panel 收集用户指令',
      'POST /api/modify-scene/plan 生成 EditPlan',
      'Plan Approval Dialog 展示计划和风险',
      'POST /api/modify-scene/preview 执行 Preview Branch',
      'Before / After 预览 + DiffSummary',
      'Accept: addSnapshot → updateScene → IndexedDB 持久化',
      'Reject: 丢弃 preview，不影响真实 Stage',
    ]),

    h1('5. 数据模型设计'),
    h2('5.1 ModificationSession'),
    codeBlock(`interface ModificationSession {
  id: string;
  stageId: string;
  sceneId: string;
  sceneType: SceneType;
  mode: 'spot' | 'scene' | 'conversation';
  status:
    | 'idle'
    | 'planning'
    | 'waiting_plan_approval'
    | 'executing_preview'
    | 'previewing'
    | 'committing'
    | 'rejected'
    | 'error';

  userInstruction: string;
  originalScene: Scene;
  previewScene?: Scene;
  editPlan?: EditPlan;
  diffSummary?: DiffSummary;
  error?: string;
}`),
    h2('5.2 EditPlan'),
    codeBlock(`interface EditPlan {
  id: string;
  summary: string;
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high';
  requiresConfirmation: boolean;
  operations: EditOperation[];
  clarificationQuestions?: ClarificationQuestion[];
}`),
    h2('5.3 EditOperation 类型'),
    table([
      ['类型', '操作', '说明'],
      ['Slide', 'update_element', '修改文本、样式、图表或元素属性'],
      ['Slide', 'add_element', '新增文本、图片、图表、形状等元素'],
      ['Slide', 'delete_element', '删除指定元素，高风险时要求确认'],
      ['Slide', 'move_element', '调整元素位置'],
      ['Slide', 'replace_image', '生成或替换图片'],
      ['Quiz', 'update_question', '修改题干、选项、答案或解析'],
      ['Quiz', 'add_question', '新增题目'],
      ['Quiz', 'delete_question', '删除题目'],
      ['Interactive', 'update_widget_config', '修改变量范围、游戏规则、节点结构等'],
      ['Interactive', 'regenerate_widget_html', '必要时重生成 HTML'],
      ['PBL', 'update_project_config', '修改角色、阶段、任务和产出物'],
    ]),

    h1('6. API 设计'),
    h2('6.1 POST /api/modify-scene/plan'),
    p('负责根据当前 Scene、用户指令和选中元素生成 EditPlan。该接口不修改真实数据。'),
    codeBlock(`Request:
{
  stageId: string;
  sceneId: string;
  scene: Scene;
  instruction: string;
  mode: 'spot' | 'scene' | 'conversation';
  selectedElementIds?: string[];
  languageDirective?: string;
}

Response:
{
  success: true;
  plan: EditPlan;
}

Clarification Response:
{
  success: true;
  needsClarification: true;
  questions: [{ question: string; options?: string[] }];
}`),
    h2('6.2 POST /api/modify-scene/preview'),
    p('负责在临时副本上执行 EditPlan，返回 previewScene 和 diffSummary。'),
    codeBlock(`Request:
{
  scene: Scene;
  plan: EditPlan;
}

Response:
{
  success: true;
  previewScene: Scene;
  diffSummary: DiffSummary;
}`),
    h2('6.3 前端提交逻辑'),
    codeBlock(`async function acceptModification(sceneId: string, previewScene: Scene) {
  await useSnapshotStore.getState().addSnapshot();
  useStageStore.getState().updateScene(sceneId, previewScene);
}

function rejectModification(sessionId: string) {
  useModificationStore.getState().discardPreview(sessionId);
}`),

    h1('7. Human-in-the-loop 体验设计'),
    h2('7.1 第一次确认：确认修改计划'),
    p('用户输入“把这页改得更适合小学生，并加一些图片”后，AI 不直接修改，而是先展示计划。'),
    table([
      ['AI 计划项', '说明'],
      ['简化标题和正文措辞', '降低认知负担，保留核心知识点'],
      ['删除两个抽象概念', '避免超出目标年龄段'],
      ['添加一张卡通风格示意图', '增强视觉理解'],
      ['把长段落改成 3 个要点', '提升可读性'],
      ['风险等级：中', '会改变表达方式，但不改变知识点'],
    ]),
    h2('7.2 第二次确认：确认修改结果'),
    table([
      ['当前版本', '修改后版本'],
      ['原标题：细胞器功能概览', '新标题：细胞里的小工厂'],
      ['正文 126 字长段落', '正文压缩为 3 个要点，共 54 字'],
      ['无辅助图', '新增线粒体示意图'],
      ['原讲解动作保留', '讲解动作不变'],
    ]),
    h2('7.3 高风险操作确认'),
    table([
      ['高风险行为', '示例', '系统动作'],
      ['删除大量元素', '删除超过 50% slide 元素', '强制二次确认'],
      ['修改正确答案', '改变 quiz.correctAnswer', '高亮提示并要求确认'],
      ['重写 interactive HTML', '替换整个 iframe 内容', '先预览 iframe，再确认'],
      ['修改 PBL 项目目标', '改变核心学习目标', '要求用户选择确认'],
      ['跨场景批量修改', '同时修改多页', '展示影响范围列表'],
    ]),

    h1('8. 开发计划'),
    h2('8.1 Phase 0：技术准备（2 天）'),
    table([
      ['任务', '文件', '验收标准'],
      ['定义 EditPlan / EditOperation 类型', 'lib/types/modification.ts', 'TypeScript 无类型错误'],
      ['新建 modification store', 'lib/store/modification.ts', '可创建 active session'],
      ['新增基础 prompt 模板', 'lib/prompts/templates/modify-scene-plan/', 'buildPrompt 正常输出'],
      ['操作执行器骨架', 'lib/modification/operation-executor.ts', '可执行 no-op plan'],
    ]),
    h2('8.2 Phase 1：Slide + Quiz 闭环（1.5-2 周）'),
    table([
      ['任务', '说明'],
      ['实现 /api/modify-scene/plan', 'LLM 根据 scene + instruction 返回 EditPlan'],
      ['实现 Slide operations', 'update/add/delete/move element'],
      ['实现 Quiz operations', 'update/add/delete question'],
      ['实现 Preview Branch', 'clone 当前 scene 后执行操作'],
      ['实现 Diff Summary', '对比 originalScene 和 previewScene'],
      ['实现确认 UI', 'Plan Approval + Preview Approval'],
      ['接入 snapshot', 'commit 前自动保存快照'],
    ]),
    h2('8.3 Phase 2：Spot Edit（1 周）'),
    table([
      ['任务', '说明'],
      ['元素选择接入', '复用 canvas activeElementIdList'],
      ['选中元素上下文', 'prompt 中只传目标元素和局部上下文'],
      ['快速修改 API', '小改动走轻量模型'],
      ['原位预览', '修改元素高亮闪烁'],
      ['快捷指令', '改文字、换图片、改颜色、放大、居中'],
    ]),
    h2('8.4 Phase 3：Interactive 场景（1.5 周）'),
    table([
      ['任务', '说明'],
      ['update_widget_config', '修改 simulation/game/code/3D 参数'],
      ['HTML 重生成', '必要时重新生成 iframe html'],
      ['iframe 预览', 'previewScene.content.html 直接渲染'],
      ['安全校验', '拦截危险 script、外链和恶意 iframe'],
      ['TeacherAction 更新', '修改互动引导动作'],
    ]),
    h2('8.5 Phase 4：Conversational Refine（1-2 周）'),
    table([
      ['任务', '说明'],
      ['复用 agent-loop', '改造成 modification loop'],
      ['多轮上下文', '保存 conversationHistory'],
      ['AI 澄清', '不确定时提问'],
      ['连续 refine', '基于 previewScene 继续改'],
      ['版本历史', '每轮都有可恢复记录'],
    ]),

    h1('9. 测试计划'),
    table([
      ['测试类型', '模块', '验证内容'],
      ['单元测试', 'operation-executor', '每种 operation 是否正确修改 scene'],
      ['单元测试', 'diff-engine', '是否准确识别新增、删除、修改'],
      ['单元测试', 'validators', '非法操作是否被拦截'],
      ['单元测试', 'plan-parser', 'LLM 返回 JSON 是否可修复和解析'],
      ['集成测试', 'plan → preview → accept', 'Stage scenes 正确更新'],
      ['集成测试', 'plan → preview → reject', 'Stage scenes 不变'],
      ['集成测试', 'modify → undo', '恢复到修改前'],
      ['E2E', '修改 slide 标题', '页面显示新标题'],
      ['E2E', '修改 quiz 选项', '题目选项变化'],
      ['E2E', '修改 interactive game', 'iframe 预览变化'],
    ]),

    h1('10. 风险与解决方案'),
    table([
      ['风险', '解决方案'],
      ['AI 误改未指定内容', '使用 operation 而非 full JSON replacement'],
      ['用户意图模糊', '先进入 clarification flow'],
      ['Slide JSON 太大', '传局部上下文，Spot Edit 只传选中元素'],
      ['Interactive HTML 不稳定', '优先改 widgetConfig，必要时才重生成 HTML'],
      ['修改后结构非法', 'zod schema + validators 拦截'],
      ['用户不信任 AI', '双确认：确认计划 + 确认结果'],
      ['多轮修改混乱', 'preview branch + modification history'],
      ['成本过高', '快速/标准/深度三档模型策略'],
    ]),

    h1('11. MVP 推荐范围'),
    note(
      '建议第一版只做：当前场景 → 用户输入修改需求 → AI 生成 EditPlan → 用户确认计划 → 预览 → 用户确认应用。',
    ),
    table([
      ['MVP 支持', 'MVP 不支持'],
      ['Slide 修改', 'Interactive HTML 重写'],
      ['Quiz 修改', '多场景批量修改'],
      ['Scene-level 修改', '长对话式修改'],
      ['Accept / Reject', '版本分支管理'],
      ['Snapshot 撤销', '高级 agent 工具调用'],
    ]),
    p(
      '这条 MVP 链路最适合组会演示：生成一页 PPT → 输入“把这页改得更适合小学生” → AI 展示计划 → 用户确认 → 展示修改前后对比 → 应用修改 → 一键撤销。它能最清晰体现 Human-in-the-Loop 的核心价值。',
    ),

    pageBreak(),
    spacer(8),
    title('谢谢'),
    subtitle('Q&A'),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  Packer.toBuffer(doc).then((buffer) => {
    fs.writeFileSync(outputPath, buffer);
    console.log(`Generated: ${outputPath}`);
  });
}

main();
