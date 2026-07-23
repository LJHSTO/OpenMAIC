import type { AgentInfo } from '@/lib/generation/pipeline-types';

export interface PortableSpeechContext {
  sceneTitle?: string;
  sceneType?: 'slide' | 'quiz' | 'interactive' | 'pbl';
  isFirstSpeech?: boolean;
  isLastSpeech?: boolean;
}

export interface PortableSpeechSanitization {
  text: string;
  changed: boolean;
  removedAgentNames: string[];
}

const ROLE_SUFFIX = '(?:老师|教师|助教|同学|学生)?';
const GENERIC_SPEAKER_LABEL =
  /^(?:\s*[（(]?\s*(?:AI\s*)?(?:老师|教师|助教|同学|学生|讲师|主持人|旁白)\s*[）)]?\s*[:：]\s*)/iu;
const GENERIC_TEACHER_INTRO =
  /(?:我是|我叫|这里是)\s*[\p{L}\p{N}_·.-]{1,20}(?:老师|教师|助教)\s*[，,。.!！]?\s*/gu;
const GREETING_PREFIX =
  /^(?:(?:同学们|同学|大家|各位学习者)\s*(?:好|好呀)[！!。,\s]*)|^(?:欢迎(?:大家|你)?来到[^。！？!?]*[。！？!?]\s*)/u;
const ENGLISH_GREETING_PREFIX =
  /^(?:hello|hi|welcome)(?:\s+(?:everyone|learners|to[^.!?]*))?[.!?]\s*/iu;
const ENTRY_DEPENDENCY_PATTERN =
  /^(?:好(?:的)?[，,。]\s*)?(?:(?:承接|延续|回到)[^，,。！？!?]{0,80}|(?:上一页|前一页|上一个场景|前一个场景|刚才|方才|之前|前面)(?:我们|大家)?[^，,。！？!?]{0,120}|(?:我们|大家)(?:刚才|刚刚|之前|前面)[^，,。！？!?]{0,120})/u;
const PAGE_ORDER_DEPENDENCY_PATTERN =
  /(?:上一页|前一页|下一页|上一个场景|前一个场景|下一个场景|前面的场景|后面的场景|第\s*[0-9０-９]+\s*页|previous page|next page|earlier scene|next scene|as mentioned on page\s*\d+)/iu;
const EXIT_DEPENDENCY_PATTERN =
  /(?:下一页|下一个场景|后面的场景|接下来[，,]?\s*(?:我们)?(?:将|会|要)?(?:学习|进入|讲解|介绍|探索|通过)|后面[，,]?\s*(?:我们)?(?:将|会|要)(?:学习|进入|讲解|介绍|探索)|in the next (?:page|scene)|next,? we(?:'ll| will) (?:learn|cover|explore))/iu;
const PLATFORM_PROMISE_PATTERN =
  /(?:(?:提交|作答|完成)(?:答案|测验|练习)?后[^。！？!?]{0,100}(?:我|老师|助教|我们)[^。！？!?]{0,60}(?:讲解|讨论|分析|反馈|陪你|带你|解析)|(?:我|老师|助教|我们)[^。！？!?]{0,80}(?:在|等你)?(?:提交|作答|完成)(?:答案|测验|练习)?后[^。！？!?]{0,60}(?:讲解|讨论|分析|反馈|陪你|带你|解析)|(?:I(?:'ll| will)|we(?:'ll| will))[^.!?]{0,100}after you submit)/iu;
const STANDALONE_ANCHOR_PATTERN =
  /^(?:本场景|本页|这一场景|这是一组|本次(?:学习|练习|测验|任务)|在“[^”]+”中|This scene|This page|This quiz|In this scene)/iu;
const PRIOR_LEARNING_ASSUMPTION_PATTERN =
  /(?:我们|大家|你)(?:刚学的|刚刚学过的|已经学过的|刚完成的|已经完成的)|(?:what|ideas) we just (?:learned|covered)/iu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizedAgentNames(agents?: AgentInfo[]): string[] {
  return [
    ...new Set((agents ?? []).map((agent) => agent.name.trim()).filter((name) => name.length >= 2)),
  ].sort((left, right) => right.length - left.length);
}

function cleanPunctuation(value: string): string {
  return value
    .replace(/^[\s，,、:：；;。.!！?？]+/u, '')
    .replace(/[，,、]{2,}/gu, '，')
    .replace(/\s+([，。！？；：,.!?;:])/gu, '$1')
    .replace(/([，。！？；：])\s+/gu, '$1')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

function sceneAnchor(context: PortableSpeechContext, usesCjk: boolean): string {
  const title = context.sceneTitle?.trim();
  if (usesCjk) {
    if (!title) return '本场景将独立说明当前知识点。';
    if (context.sceneType === 'quiz') return `这是一组关于“${title}”的独立测验。`;
    if (context.sceneType === 'interactive') return `本场景通过交互探索“${title}”。`;
    if (context.sceneType === 'pbl') return `本场景的任务是“${title}”。`;
    return `本场景聚焦“${title}”。`;
  }
  if (!title) return 'This scene explains its current concept independently.';
  if (context.sceneType === 'quiz') return `This is a standalone quiz on "${title}".`;
  if (context.sceneType === 'interactive')
    return `This scene explores "${title}" through interaction.`;
  if (context.sceneType === 'pbl') return `This scene focuses on the task "${title}".`;
  return `This scene focuses on "${title}".`;
}

function stripEntryDependency(text: string): string {
  let next = text;
  for (let pass = 0; pass < 3; pass += 1) {
    if (!ENTRY_DEPENDENCY_PATTERN.test(next)) break;
    const commaIndex = next.search(/[，,]/u);
    const sentenceEndIndex = next.search(/[。！？!?]/u);
    if (commaIndex >= 0 && (sentenceEndIndex < 0 || commaIndex < sentenceEndIndex)) {
      next = next.slice(commaIndex + 1).trimStart();
      continue;
    }
    if (sentenceEndIndex >= 0) {
      next = next.slice(sentenceEndIndex + 1).trimStart();
      continue;
    }
    return '';
  }
  return next
    .replace(/^(?:亲眼|清楚地)?看到了/u, '可以观察到')
    .replace(/^好(?:的)?[，,]\s*/u, '')
    .replace(/^现在[，,]\s*/u, '')
    .replace(/^接下来[，,]\s*/u, '');
}

function stripOpeningGreetings(text: string): string {
  let next = text;
  for (let pass = 0; pass < 4; pass += 1) {
    const cleaned = next
      .replace(GREETING_PREFIX, '')
      .replace(ENGLISH_GREETING_PREFIX, '')
      .trimStart();
    if (cleaned === next) break;
    next = cleaned;
  }
  return next;
}

function removeExitDependencies(text: string, usesCjk: boolean): string {
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/gu) ?? [text];
  const kept = sentences.filter((sentence) => !EXIT_DEPENDENCY_PATTERN.test(sentence));
  if (kept.length > 0) return kept.join('');
  return usesCjk
    ? '请根据当前场景的内容，确认你能解释其中的核心关系。'
    : 'Use the current scene to check that you can explain its central relationship.';
}

function removePlatformPromises(text: string, usesCjk: boolean): string {
  if (!PLATFORM_PROMISE_PATTERN.test(text)) return text;
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/gu) ?? [text];
  const kept = sentences.filter((sentence) => !PLATFORM_PROMISE_PATTERN.test(sentence));
  const replacement = usesCjk
    ? '请独立完成每道题，准备好后提交答案。'
    : 'Answer each question independently and submit when you are ready.';
  const prefix = kept.join('').trim();
  return prefix ? `${prefix}${usesCjk ? '' : ' '}${replacement}` : replacement;
}

export function hasPortableSpeechEntryDependency(text: string): boolean {
  return (
    GREETING_PREFIX.test(text.trim()) ||
    ENGLISH_GREETING_PREFIX.test(text.trim()) ||
    ENTRY_DEPENDENCY_PATTERN.test(text.trim())
  );
}

export function hasPortableSpeechPageDependency(text: string): boolean {
  return PAGE_ORDER_DEPENDENCY_PATTERN.test(text);
}

export function hasPortableSpeechExitDependency(text: string): boolean {
  return EXIT_DEPENDENCY_PATTERN.test(text);
}

export function hasPortableSpeechPlatformPromise(text: string): boolean {
  return PLATFORM_PROMISE_PATTERN.test(text);
}

export function hasPortableSpeechPriorLearningAssumption(text: string): boolean {
  return PRIOR_LEARNING_ASSUMPTION_PATTERN.test(text);
}

export function hasStandaloneSpeechAnchor(text: string): boolean {
  return STANDALONE_ANCHOR_PATTERN.test(text.trim());
}

/**
 * Makes narration portable while preserving continuity between speech beats
 * inside the same scene. Only the scene entry and exit are decoupled from the
 * surrounding course order.
 */
export function sanitizePortableSpeech(
  text: string,
  agents?: AgentInfo[],
  context: PortableSpeechContext = {},
): PortableSpeechSanitization {
  const original = text;
  const usesCjk = /[\u3400-\u9fff]/u.test(original);
  const groupWord = usesCjk ? '大家' : 'everyone';
  const neutralMention = usesCjk ? '这里需要注意' : 'A useful point is';
  const collectiveSubject = usesCjk ? '我们' : 'we';
  const neutralPossessive = usesCjk ? '这个' : 'the';
  const names = normalizedAgentNames(agents);
  const removedAgentNames = names.filter((name) => original.includes(name));
  let sanitized = original.trim().replace(GENERIC_SPEAKER_LABEL, '');

  if (names.length > 0) {
    const namesPattern = names.map(escapeRegExp).join('|');
    const namedPerson = `(?:(?:${namesPattern})${ROLE_SUFFIX})`;
    const namedSpeakerLabel = new RegExp(
      `^\\s*[（(]?\\s*${namedPerson}\\s*[）)]?\\s*[:：]\\s*`,
      'u',
    );
    const namedSelfIntroduction = new RegExp(
      `(?:(?:我是|我叫|这里是)|(?:I\\s+am|I'm|This\\s+is))\\s*${namedPerson}\\s*[，,。.!！]?\\s*`,
      'giu',
    );
    const namedDirectAddress = new RegExp(
      `${namedPerson}(?:\\s*[、,，/和及与&]\\s*${namedPerson})*\\s*[，,:：]\\s*(?=你们|你|请|来|能|还|帮|试|说|回答|想|记得|准备|you|please|can|could|would|try|remember)`,
      'giu',
    );
    const namedSpeechReference = new RegExp(
      `(?:刚才|前面|方才|earlier|just)?\\s*${namedPerson}\\s*(?:说过|提到过|讲过|解释过|指出过|提醒过|告诉过我们?|said|mentioned|explained|noted|reminded\\s+us)`,
      'giu',
    );
    const namedGuidanceReference = new RegExp(
      `(?:刚才|前面|方才)?\\s*${namedPerson}\\s*(?:带|带着|带领|帮助|帮着|为)\\s*我们`,
      'gu',
    );
    const namedPossessiveReference = new RegExp(
      `${namedPerson}\\s*的\\s*(?=回答|答案|想法|发现|解释|演示|结论|提醒)`,
      'gu',
    );
    const namedReminder = new RegExp(`${namedPerson}\\s*(?:先)?\\s*(?:提个醒|提醒一下)`, 'gu');
    const namedClassPrompt = new RegExp(`${namedPerson}\\s*(?:先)?\\s*请大家`, 'gu');
    const namedToolObservation = new RegExp(
      `${namedPerson}\\s*在(?=图形|互动|实验|课件|计算器)`,
      'gu',
    );
    const namedPeerGroup = new RegExp(`${namedPerson}\\s*(?:和|与)\\s*其他同学`, 'gu');
    const namedQuizReference = new RegExp(
      `${namedPerson}\\s*在第[^。！？!?]{0,40}题[^。！？!?]*[。！？!?]?\\s*`,
      'gu',
    );
    const anyNamedPerson = new RegExp(namedPerson, 'gu');

    sanitized = sanitized
      .replace(namedSpeakerLabel, '')
      .replace(namedSelfIntroduction, '')
      .replace(namedDirectAddress, '')
      .replace(namedSpeechReference, neutralMention)
      .replace(namedGuidanceReference, collectiveSubject)
      .replace(namedPossessiveReference, neutralPossessive)
      .replace(namedReminder, usesCjk ? '提醒一下' : 'A quick reminder')
      .replace(namedClassPrompt, usesCjk ? '请大家' : 'everyone, please')
      .replace(namedToolObservation, usesCjk ? '学习者在' : 'the learner in')
      .replace(namedPeerGroup, usesCjk ? '大家' : 'the group')
      .replace(namedQuizReference, '')
      .replace(anyNamedPerson, groupWord);
  }

  sanitized = sanitized
    .replace(GENERIC_TEACHER_INTRO, '')
    .replace(/(^|[。！？!?]\s*)帮大家(?=点击|点开|观察|尝试|操作)/gu, '$1请');

  if (context.isFirstSpeech) {
    sanitized = stripOpeningGreetings(sanitized);
    sanitized = stripEntryDependency(sanitized);
    sanitized = sanitized
      .replace(
        /(?:我们|大家)(?:刚学的|刚刚学过的|已经学过的|刚完成的|已经完成的)/gu,
        '当前场景中的',
      )
      .replace(/(?:what|ideas) we just (?:learned|covered)/giu, 'the current concept');
  }

  if (context.isLastSpeech) sanitized = removeExitDependencies(sanitized, usesCjk);

  sanitized = sanitized
    .replace(/大家(?:和|与)其他同学/gu, '大家')
    .replace(/在自己的讲义上找到这个部分/gu, '在当前页面中定位这个部分')
    .replace(/在下一部分理解/gu, '进一步理解')
    .replace(/接下来要/gu, '需要')
    .replace(/接下来[，,]?\s*我们/gu, '本场景中，我们');

  sanitized = removePlatformPromises(sanitized, usesCjk);

  sanitized = cleanPunctuation(sanitized);
  if (context.isFirstSpeech && !hasStandaloneSpeechAnchor(sanitized)) {
    sanitized = `${sceneAnchor(context, usesCjk)}${sanitized ? (usesCjk ? '' : ' ') + sanitized : ''}`;
  }
  if (!sanitized) sanitized = sceneAnchor(context, usesCjk);

  return {
    text: sanitized,
    changed: sanitized !== original,
    removedAgentNames,
  };
}
