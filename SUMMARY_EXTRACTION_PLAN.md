# Plan: Auto-Extract Summaries from Claude's Responses

## Problem

Claude is generating idea/plan summaries inline in its text responses (as shown in screenshot), but the left pane isn't updating because:

1. `UpdateCard` is listed in allowed tools, but it's **not a real Claude Code tool**
2. Claude Code CLI doesn't have an `UpdateCard` tool - so Claude just outputs text
3. We need to extract structured data from Claude's natural language output

## Solution: Parse Claude's Output for Summary Patterns

Since Claude consistently formats summaries in a recognizable pattern, we can parse the streaming text and extract summaries automatically.

### Pattern Recognition

Claude outputs summaries like:
```
Idea Summary:
- Main goal: Personal productivity tracking with simple start/stop timer
- Key features: Timer tied to projects, start/stop button interaction
- Scope: Personal use only (not for billing/teams)
- Open questions: What defines a "project"? What reporting/views are needed?
```

Or for plans:
```
Plan Summary:
- Step 1: Create timer component
- Step 2: Add project selector
- Key files: src/components/Timer.tsx, src/stores/timerStore.ts
- Risk: State persistence across sessions
```

### Implementation Approach

#### 1. Create Summary Parser Utility

```typescript
// src/lib/summaryParser.ts

interface ParsedSummary {
  type: 'idea' | 'plan';
  content: string;        // Full summary text
  bulletPoints: string[]; // Individual bullet points
}

export function parseSummaryFromText(text: string): ParsedSummary | null {
  // Look for "Idea Summary:" or "Plan Summary:" patterns
  const ideaMatch = text.match(/Idea Summary:\s*([\s\S]*?)(?=\n\n|\n[A-Z]|$)/i);
  const planMatch = text.match(/Plan Summary:\s*([\s\S]*?)(?=\n\n|\n[A-Z]|$)/i);

  if (ideaMatch) {
    return {
      type: 'idea',
      content: ideaMatch[1].trim(),
      bulletPoints: extractBulletPoints(ideaMatch[1]),
    };
  }

  if (planMatch) {
    return {
      type: 'plan',
      content: planMatch[1].trim(),
      bulletPoints: extractBulletPoints(planMatch[1]),
    };
  }

  return null;
}

function extractBulletPoints(text: string): string[] {
  return text
    .split('\n')
    .filter(line => line.trim().startsWith('-') || line.trim().startsWith('•'))
    .map(line => line.replace(/^[\s\-•]+/, '').trim());
}
```

#### 2. Hook into Message Processing

In each panel component (IdeasPanel, SpecPanel), after appending text to messages:

```typescript
// In handleClaudeEvent, after text_chunk handling:
case 'text_chunk':
  if (event.text) {
    appendToLastMessage(sessionIdRef.current, event.text);

    // Check if we have a complete summary to extract
    const session = getSessionByCardId(card.id);
    if (session) {
      const fullText = session.messages
        .filter(m => m.role === 'assistant')
        .map(m => m.content)
        .join('');

      const summary = parseSummaryFromText(fullText);
      if (summary) {
        if (summary.type === 'idea' && summary.content !== card.ideaSummary) {
          updateCard(card.id, { ideaSummary: summary.content });
        } else if (summary.type === 'plan' && summary.content !== card.planSummary) {
          updateCard(card.id, { planSummary: summary.content });
        }
      }
    }
  }
  break;
```

#### 3. Also Parse on Session Complete

When session completes, do a final parse to catch any summaries:

```typescript
case 'session_completed':
  // ... existing code ...

  // Final summary extraction
  const finalText = getFullConversationText(sessionIdRef.current);
  const summary = parseSummaryFromText(finalText);
  if (summary) {
    if (summary.type === 'idea') {
      updateCard(card.id, {
        ideaSummary: summary.content,
        ideaContent: finalText  // Save full conversation as detailed content
      });
    } else if (summary.type === 'plan') {
      updateCard(card.id, {
        planSummary: summary.content,
        planContent: finalText
      });
    }
  }
  break;
```

#### 4. Update Prompts to Ensure Consistent Format

Make sure our prompts tell Claude to use a consistent format:

```typescript
// In generateIdeaPrompt():
`After discussing, provide an "Idea Summary:" section with bullet points:
- Main goal: [what we're trying to achieve]
- Key features: [core functionality]
- Scope: [what's in/out]
- Open questions: [things still to decide]`

// In generatePlanPrompt():
`After creating the plan, provide a "Plan Summary:" section with bullet points:
- Step 1: [first major step]
- Step 2: [second major step]
- Key files: [files to modify]
- Risk: [main concerns]`
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/summaryParser.ts` | NEW - Summary extraction utility |
| `src/components/panel/IdeasPanel.tsx` | Add summary parsing to event handler |
| `src/components/panel/SpecPanel.tsx` | Add summary parsing to event handler |

## Alternative: Debounced Parsing

To avoid parsing on every text chunk, we could debounce:

```typescript
const debouncedParseRef = useRef(
  debounce((text: string, cardId: string) => {
    const summary = parseSummaryFromText(text);
    if (summary?.type === 'idea') {
      updateCard(cardId, { ideaSummary: summary.content });
    }
  }, 1000)
);
```

## Testing

1. Open an Ideas card, let Claude generate a response with "Idea Summary:"
2. Verify left pane updates with the summary
3. Expand to see full content
4. Same for Plan mode with "Plan Summary:"

## Edge Cases

- Multiple summaries in one response → Use the last one
- Summary spans multiple messages → Parse full conversation text
- Partial summary (streaming) → Only save when pattern is complete
- No summary generated → Left pane shows "Chat to flesh out idea" prompt
