/**
 * Summary Parser - Extracts idea and plan summaries from Claude's text output
 *
 * Since UpdateCard is not a real Claude Code tool, Claude outputs summaries
 * in a recognizable format. This parser extracts that structured data.
 */

export interface ParsedSummary {
  type: 'idea' | 'plan';
  summary: string;      // The short bullet-point summary
  content?: string;     // Full detailed content (for plans)
  bulletPoints: string[];
}

// Common line prefixes that indicate summary content
const SUMMARY_LINE_PREFIXES = [
  'main goal:',
  'key features:',
  'scope:',
  'open questions:',
  'style:',
  'tech stack:',
  'platform:',
  'step 1:',
  'step 2:',
  'step 3:',
  'step 4:',
  'step 5:',
  'key files:',
  'risk:',
  'risks:',
  'testing:',
  'approach:',
  'overview:',
];

/**
 * Check if a line looks like a summary line (bullet or known prefix)
 */
function isSummaryLine(line: string): boolean {
  const trimmed = line.trim();

  // Bullet markers
  if (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*')) {
    return true;
  }

  // Known prefixes (case-insensitive)
  const lower = trimmed.toLowerCase();
  return SUMMARY_LINE_PREFIXES.some(prefix => lower.startsWith(prefix));
}

/**
 * Parse Claude's text output for Idea Summary patterns
 */
export function parseIdeaSummary(text: string): string | null {
  // Look for "Idea Summary:" followed by content lines
  // The content can be bullet points OR lines starting with known prefixes

  const patterns = [
    // Match "**Idea Summary:**" (bold with colon inside)
    /(?:^|\n)\*\*Idea Summary:\*\*\s*\n((?:.+\n?)+?)(?=\n\n|\n---|\n[A-Z][^a-z]|\n#{1,3}\s|$)/im,
    // Match "Idea Summary:" or "**Idea Summary**:"
    /(?:^|\n)(?:\*\*)?Idea Summary(?:\*\*)?:?\s*\n((?:.+\n?)+?)(?=\n\n|\n---|\n[A-Z][^a-z]|\n#{1,3}\s|$)/im,
    // Match markdown header
    /(?:^|\n)##?\s*Idea Summary:?\s*\n((?:.+\n?)+?)(?=\n\n|\n---|\n[A-Z][^a-z]|\n#{1,3}\s|$)/im,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const summary = cleanSummary(match[1]);
      if (summary) return summary;
    }
  }

  return null;
}

/**
 * Parse Claude's text output for Plan Summary patterns
 */
export function parsePlanSummary(text: string): string | null {
  const patterns = [
    // Match "**Plan Summary:**" (bold with colon inside)
    /(?:^|\n)\*\*Plan Summary:\*\*\s*\n((?:.+\n?)+?)(?=\n\n|\n---|\n[A-Z][^a-z]|\n#{1,3}\s|$)/im,
    // Match "Plan Summary:" or "**Plan Summary**:"
    /(?:^|\n)(?:\*\*)?Plan Summary(?:\*\*)?:?\s*\n((?:.+\n?)+?)(?=\n\n|\n---|\n[A-Z][^a-z]|\n#{1,3}\s|$)/im,
    // Match markdown header
    /(?:^|\n)##?\s*Plan Summary:?\s*\n((?:.+\n?)+?)(?=\n\n|\n---|\n[A-Z][^a-z]|\n#{1,3}\s|$)/im,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const summary = cleanSummary(match[1]);
      if (summary) return summary;
    }
  }

  return null;
}

/**
 * Parse full plan content (markdown between Implementation Plan header and next section)
 */
export function parsePlanContent(text: string): string | null {
  const patterns = [
    /(?:^|\n)##?\s*Implementation Plan\s*\n([\s\S]+?)(?=\n##|\n\*\*Plan Summary|$)/im,
    /(?:^|\n)\*\*Implementation Plan\*\*\s*\n([\s\S]+?)(?=\n##|\n\*\*Plan Summary|$)/im,
    /(?:^|\n)##?\s*(?:Detailed\s+)?Plan\s*\n([\s\S]+?)(?=\n##|\n\*\*Plan Summary|$)/im,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const content = match[1].trim();
      if (content.length > 100) return content;
    }
  }

  return null;
}

/**
 * Clean and normalize a summary string
 * Handles both bullet-style lines and prefix-style lines
 */
function cleanSummary(raw: string): string | null {
  const lines = raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && isSummaryLine(line))
    .map(line => {
      // Normalize to bullet format
      if (line.startsWith('-') || line.startsWith('•') || line.startsWith('*')) {
        return '- ' + line.replace(/^[-•*]\s*/, '').trim();
      }
      // Lines with known prefixes - add bullet marker
      return '- ' + line;
    });

  if (lines.length === 0) return null;

  return lines.join('\n');
}

/**
 * Extract bullet points from a summary
 */
export function extractBulletPoints(summary: string): string[] {
  return summary
    .split('\n')
    .filter(line => line.trim().startsWith('-') || line.trim().startsWith('•'))
    .map(line => line.replace(/^[\s\-•*]+/, '').trim())
    .filter(Boolean);
}

/**
 * Check if the text appears to have a complete summary
 * (used to avoid partial parsing during streaming)
 */
export function hasCompleteSummary(text: string, type: 'idea' | 'plan'): boolean {
  if (type === 'idea') {
    const summary = parseIdeaSummary(text);
    // Consider complete if we have at least 2 lines
    return summary !== null && extractBulletPoints(summary).length >= 2;
  } else {
    const summary = parsePlanSummary(text);
    return summary !== null && extractBulletPoints(summary).length >= 2;
  }
}

/**
 * Parse all summaries from text (returns both idea and plan if found)
 */
export function parseAllSummaries(text: string): {
  ideaSummary?: string;
  planSummary?: string;
  planContent?: string;
} {
  const result: {
    ideaSummary?: string;
    planSummary?: string;
    planContent?: string;
  } = {};

  const ideaSummary = parseIdeaSummary(text);
  if (ideaSummary) {
    result.ideaSummary = ideaSummary;
  }

  const planSummary = parsePlanSummary(text);
  if (planSummary) {
    result.planSummary = planSummary;
  }

  const planContent = parsePlanContent(text);
  if (planContent) {
    result.planContent = planContent;
  }

  return result;
}
