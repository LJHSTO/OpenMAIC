type SanitizeOptions = {
  allowedTags: string[];
  allowedAttributes: Record<string, string[]>;
  allowedSchemes: string[];
  allowedSchemesAppliedToAttributes: string[];
  allowedStyles: Record<string, Record<string, RegExp[]>>;
  allowProtocolRelative: boolean;
  enforceHtmlBoundary: boolean;
};

import sanitizeHtml from 'sanitize-html';

const COLOR_VALUE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|hsla?\([\d\s,.%]+\)|[a-z]+)$/i;
const LENGTH_VALUE = /^\d+(\.\d+)?(px|pt|em|rem|%)?$/i;

const SANITIZE_OPTIONS: SanitizeOptions = {
  allowedTags: [
    'a',
    'b',
    'blockquote',
    'br',
    'code',
    'div',
    'em',
    'i',
    'li',
    'ol',
    'p',
    's',
    'span',
    'strong',
    'sub',
    'sup',
    'u',
    'ul',
  ],
  allowedAttributes: {
    a: ['href', 'rel', 'target'],
    '*': ['style'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowedStyles: {
    '*': {
      color: [COLOR_VALUE],
      'background-color': [COLOR_VALUE],
      'font-family': [/^[\w\s"',.-]+$/],
      'font-size': [LENGTH_VALUE],
      'font-style': [/^(normal|italic|oblique)$/i],
      'font-weight': [/^(normal|bold|bolder|lighter|[1-9]00)$/i],
      'letter-spacing': [LENGTH_VALUE],
      'line-height': [LENGTH_VALUE],
      'text-align': [/^(left|right|center|justify)$/i],
      'text-decoration': [/^(none|underline|line-through|overline)$/i],
    },
  },
  allowProtocolRelative: false,
  enforceHtmlBoundary: true,
};

export function hasUnsafeHtml(value: string): boolean {
  return sanitizeHtmlFragment(value) !== value;
}

export function sanitizeHtmlFragment(value: string): string {
  return sanitizeHtml(value, SANITIZE_OPTIONS);
}

export function sanitizeStringsDeep<T>(value: T): T {
  if (typeof value === 'string') return sanitizeHtmlFragment(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeStringsDeep(item)) as T;
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, sanitizeStringsDeep(entry)]),
  ) as T;
}
