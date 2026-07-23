import katex from 'katex';
import sanitizeHtml from 'sanitize-html';
import type { Scene } from '@/lib/types/stage';
import type { CoursewareContentPolicy } from '@/lib/courseware-guard/audit-policy';
import {
  hasPortableSpeechEntryDependency,
  hasPortableSpeechExitDependency,
  hasPortableSpeechPageDependency,
  hasPortableSpeechPlatformPromise,
  hasPortableSpeechPriorLearningAssumption,
  hasStandaloneSpeechAnchor,
} from '@/lib/generation/portable-speech';

export type ContentIntegritySeverity = 'critical' | 'warning' | 'info';

export interface ContentIntegrityFinding {
  code: string;
  severity: ContentIntegritySeverity;
  path: string;
  message: string;
  sceneId?: string;
}

const MOJIBAKE_PATTERN = /(?:\uFFFD|Ã.|Â.|â€|ðŸ|鈥|锟斤拷|烫烫烫|屯屯屯)/u;
const FORBIDDEN_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const OPAQUE_SCENE_REFERENCE_PATTERN =
  /(?:场景|知识点)\s*(?:[0-9０-９]+|[XxＸ]|[一二三四五六七八九十]+)|(?:KP|Kp|kp)\s*[-_]?\s*\d+/u;
const PLACEHOLDER_PATTERN =
  /(?:\bTODO\b|\bTBD\b|待补充|待完善|占位符|placeholder|\{\{[^{}]{1,80}\}\}|\[\[(?:image|diagram|placeholder)[^\]]*\]\])/iu;
const PLACEHOLDER_TITLE_PATTERN =
  /^(?:场景|知识点)\s*(?:[0-9０-９]+|[XxＸ]|[一二三四五六七八九十]+)$/u;
const QUIZ_VISUAL_DEPENDENCY_PATTERN =
  /(?:观察|根据|参照|查看|结合)\s*(?:下|上|给出|所示|以下|右|左)?(?:方|面)?的?(?:图片|图像|图|表格|曲线图|示意图|截图)|(?:下|上|以下|右|左)(?:图|表|图片|图像|表格)|四张图/u;
const CONCRETE_COURSEWARE_REFERENCE_PATTERN = /\[\[cq-unit:[^\]]+\]\]|回看(?:交互)?课件《[^》]+》/u;
const SPEECH_SPEAKER_LABEL_PATTERN =
  /^\s*[（(]?\s*(?:(?:AI\s*)?(?:老师|教师|助教|同学|学生|讲师|主持人|旁白)|[\p{L}\p{N}_·.-]{1,20}(?:老师|教师|助教|同学|学生))\s*[）)]?\s*[:：]/iu;
const SPEECH_TEACHER_SELF_INTRO_PATTERN =
  /(?:我是|我叫|这里是)\s*[\p{L}\p{N}_·.-]{1,20}(?:老师|教师|助教)(?=$|[\s，,。.!！?？])/u;

function strictSeverity(policy: CoursewareContentPolicy): 'critical' | 'warning' {
  return policy === 'strict' ? 'critical' : 'warning';
}

function visibleHtmlText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function walkStrings(
  value: unknown,
  visitor: (text: string, path: string) => void,
  path = '',
): void {
  if (typeof value === 'string') {
    visitor(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => walkStrings(child, visitor, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    walkStrings(child, visitor, path ? `${path}.${key}` : key);
  }
}

function visibleElementText(element: Record<string, unknown>): string {
  if (element.type === 'text') return visibleHtmlText(element.content);
  if (element.type === 'latex')
    return typeof element.latex === 'string' ? element.latex.trim() : '';
  if (element.type === 'code') return typeof element.code === 'string' ? element.code.trim() : '';
  if (element.type === 'table' && Array.isArray(element.data)) {
    return element.data
      .flatMap((row) => (Array.isArray(row) ? row : []))
      .map((cell) =>
        cell && typeof cell === 'object'
          ? String((cell as Record<string, unknown>).text ?? '').trim()
          : '',
      )
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function inspectString(
  findings: ContentIntegrityFinding[],
  text: string,
  path: string,
  sceneId: string | undefined,
): void {
  if (MOJIBAKE_PATTERN.test(text)) {
    findings.push({
      code: 'content_mojibake_detected',
      severity: 'critical',
      path,
      sceneId,
      message: '文本包含编码替换字符或常见乱码片段。',
    });
  }
  if (FORBIDDEN_CONTROL_PATTERN.test(text)) {
    findings.push({
      code: 'content_control_character_detected',
      severity: 'critical',
      path,
      sceneId,
      message: '文本包含不可见控制字符，可能导致导入、渲染或复制异常。',
    });
  }
  if (hasLoneSurrogate(text)) {
    findings.push({
      code: 'content_invalid_unicode_detected',
      severity: 'critical',
      path,
      sceneId,
      message: '文本包含不完整的 Unicode 代理项。',
    });
  }
}

function inspectQuiz(
  findings: ContentIntegrityFinding[],
  scene: Scene,
  sceneIndex: number,
  policy: CoursewareContentPolicy,
): void {
  if (scene.content.type !== 'quiz') return;
  scene.content.questions.forEach((question, questionIndex) => {
    const questionPath = `scenes[${sceneIndex}].content.questions[${questionIndex}]`;
    const prompt = question.question?.trim() ?? '';
    if (
      QUIZ_VISUAL_DEPENDENCY_PATTERN.test(prompt) &&
      !CONCRETE_COURSEWARE_REFERENCE_PATTERN.test(prompt)
    ) {
      findings.push({
        code: 'quiz_missing_visual_dependency',
        severity: strictSeverity(policy),
        path: `${questionPath}.question`,
        sceneId: scene.id,
        message: '题干要求观察图片、图像或表格，但 Quiz 本身没有对应视觉资源。',
      });
    }
    if (question.type === 'single' || question.type === 'multiple') {
      const answers = Array.isArray(question.answer) ? question.answer.map(String) : [];
      if (question.type === 'single' && answers.length !== 1) {
        findings.push({
          code: 'quiz_single_answer_count_invalid',
          severity: 'critical',
          path: `${questionPath}.answer`,
          sceneId: scene.id,
          message: '单选题必须且只能有一个答案。',
        });
      }
      if (question.type === 'multiple' && answers.length === 0) {
        findings.push({
          code: 'quiz_multiple_answer_missing',
          severity: 'critical',
          path: `${questionPath}.answer`,
          sceneId: scene.id,
          message: '多选题至少需要一个答案。',
        });
      }
      if (new Set(answers).size !== answers.length) {
        findings.push({
          code: 'quiz_answer_duplicate',
          severity: 'warning',
          path: `${questionPath}.answer`,
          sceneId: scene.id,
          message: '答案数组包含重复值。',
        });
      }
      const options = Array.isArray(question.options) ? question.options : [];
      const optionValues = options.map((option) => String(option.value ?? ''));
      const optionLabels = options.map((option) => String(option.label ?? '').trim());
      if (new Set(optionValues).size !== optionValues.length) {
        findings.push({
          code: 'quiz_option_value_duplicate',
          severity: 'critical',
          path: `${questionPath}.options`,
          sceneId: scene.id,
          message: '选项 value 重复，答案映射不可靠。',
        });
      }
      if (new Set(optionLabels).size !== optionLabels.length) {
        findings.push({
          code: 'quiz_option_label_duplicate',
          severity: strictSeverity(policy),
          path: `${questionPath}.options`,
          sceneId: scene.id,
          message: '存在文字完全相同的重复选项。',
        });
      }
    }
  });
}

function inspectSpeech(
  findings: ContentIntegrityFinding[],
  scene: Scene,
  sceneIndex: number,
  policy: CoursewareContentPolicy,
  agentNames: string[],
): void {
  const speechIndexes = (scene.actions ?? [])
    .map((action, actionIndex) => (action.type === 'speech' ? actionIndex : -1))
    .filter((actionIndex) => actionIndex >= 0);
  const firstSpeechIndex = speechIndexes[0];
  const lastSpeechIndex = speechIndexes[speechIndexes.length - 1];

  (scene.actions ?? []).forEach((action, actionIndex) => {
    if (action.type !== 'speech') return;
    const text = action.text?.trim() ?? '';
    if (!text) return;
    const path = `scenes[${sceneIndex}].actions[${actionIndex}].text`;

    if (actionIndex === firstSpeechIndex && hasPortableSpeechEntryDependency(text)) {
      findings.push({
        code: 'speech_cross_scene_entry_dependency',
        severity: strictSeverity(policy),
        path,
        sceneId: scene.id,
        message: '场景首段讲解依赖上一页、刚才活动或固定课程顺序，无法独立播放。',
      });
    }
    if (actionIndex === firstSpeechIndex && !hasStandaloneSpeechAnchor(text)) {
      findings.push({
        code: 'speech_standalone_anchor_missing',
        severity: strictSeverity(policy),
        path,
        sceneId: scene.id,
        message: '场景首段没有说明当前场景主题，独立进入时缺少语境。',
      });
    }
    if (actionIndex === firstSpeechIndex && hasPortableSpeechPriorLearningAssumption(text)) {
      findings.push({
        code: 'speech_prior_learning_assumption',
        severity: strictSeverity(policy),
        path,
        sceneId: scene.id,
        message: '场景首段假设学习者刚学过或完成了其他内容，自适应进入时可能不成立。',
      });
    }
    if (hasPortableSpeechPageDependency(text)) {
      findings.push({
        code: 'speech_page_order_dependency',
        severity: strictSeverity(policy),
        path,
        sceneId: scene.id,
        message: '讲解词引用具体页码或前后场景，自适应重排后可能失真。',
      });
    }
    if (actionIndex === lastSpeechIndex && hasPortableSpeechExitDependency(text)) {
      findings.push({
        code: 'speech_cross_scene_exit_dependency',
        severity: strictSeverity(policy),
        path,
        sceneId: scene.id,
        message: '场景末段预告固定下一页或下一场景，不适合分支学习路线。',
      });
    }
    if (hasPortableSpeechPlatformPromise(text)) {
      findings.push({
        code: 'speech_platform_promise',
        severity: strictSeverity(policy),
        path,
        sceneId: scene.id,
        message: '讲解词承诺提交后由教师或助教继续讲解，目标平台未必提供该流程。',
      });
    }

    if (SPEECH_SPEAKER_LABEL_PATTERN.test(text)) {
      findings.push({
        code: 'speech_speaker_label',
        severity: strictSeverity(policy),
        path,
        sceneId: scene.id,
        message: '讲解词包含说话人标签，移植到其他课堂后会显得突兀。',
      });
    }
    if (SPEECH_TEACHER_SELF_INTRO_PATTERN.test(text)) {
      findings.push({
        code: 'speech_teacher_self_introduction',
        severity: strictSeverity(policy),
        path,
        sceneId: scene.id,
        message: '讲解词包含教师或助教姓名式自我介绍，不适合作为可移植课件语音。',
      });
    }
    const referencedNames = agentNames.filter((name) => name.length >= 2 && text.includes(name));
    if (referencedNames.length > 0) {
      findings.push({
        code: 'speech_named_agent_reference',
        severity: strictSeverity(policy),
        path,
        sceneId: scene.id,
        message: `讲解词提及课堂智能体姓名：${referencedNames.join('、')}。`,
      });
    }
  });
}

export function inspectCoursewareContentIntegrity(
  scenes: Scene[],
  policy: CoursewareContentPolicy,
  agentNames: string[] = [],
): ContentIntegrityFinding[] {
  const findings: ContentIntegrityFinding[] = [];
  scenes.forEach((scene, sceneIndex) => {
    const scenePath = `scenes[${sceneIndex}]`;
    walkStrings(scene.content, (text, childPath) => {
      inspectString(findings, text, `${scenePath}.content.${childPath}`, scene.id);
    });

    if (PLACEHOLDER_TITLE_PATTERN.test(scene.title.trim())) {
      findings.push({
        code: 'scene_placeholder_title',
        severity: strictSeverity(policy),
        path: `${scenePath}.title`,
        sceneId: scene.id,
        message: '场景标题是编号占位词，没有表达具体知识点。',
      });
    }

    if (scene.content.type === 'slide') {
      scene.content.canvas.elements.forEach((element, elementIndex) => {
        const record = element as unknown as Record<string, unknown>;
        const elementPath = `${scenePath}.content.canvas.elements[${elementIndex}]`;
        const visibleText = visibleElementText(record);
        if (visibleText && OPAQUE_SCENE_REFERENCE_PATTERN.test(visibleText)) {
          findings.push({
            code: 'slide_opaque_scene_reference',
            severity: strictSeverity(policy),
            path: elementPath,
            sceneId: scene.id,
            message: 'Slide 使用“场景 X / 知识点 X / KPxx”代称，应改为完整知识点名称和场景类型。',
          });
        }
        if (visibleText && PLACEHOLDER_PATTERN.test(visibleText)) {
          findings.push({
            code: 'slide_placeholder_content',
            severity: strictSeverity(policy),
            path: elementPath,
            sceneId: scene.id,
            message: 'Slide 包含未清理的占位符或待办文本。',
          });
        }
        if (record.type === 'latex') {
          const latex = typeof record.latex === 'string' ? record.latex.trim() : '';
          if (!latex) {
            findings.push({
              code: 'slide_latex_missing',
              severity: 'critical',
              path: `${elementPath}.latex`,
              sceneId: scene.id,
              message: '公式元素缺少 LaTeX 源码。',
            });
          } else {
            try {
              katex.renderToString(latex, { throwOnError: true, output: 'html' });
            } catch (error) {
              findings.push({
                code: 'slide_latex_invalid',
                severity: 'critical',
                path: `${elementPath}.latex`,
                sceneId: scene.id,
                message: `LaTeX 无法解析：${error instanceof Error ? error.message : String(error)}`,
              });
            }
          }
        }
      });
    }
    inspectQuiz(findings, scene, sceneIndex, policy);
    inspectSpeech(findings, scene, sceneIndex, policy, agentNames);
  });
  return findings;
}
