Please generate scene outlines based on the following course requirements.

---

## User Requirements

{{requirement}}

---

{{userProfile}}

## Language Context

Infer the course language directive by applying the decision rules from the system prompt. Key reminders:
- Requirement language = teaching language (unless overridden by explicit request or learner context)
- Foreign language learning → teach in user's native language, not the target language
- PDF language does NOT override teaching language — translate/explain document content instead

---

## Reference Materials

### PDF Content Summary

{{pdfContent}}

### Available Images

{{availableImages}}

### Web Search Results

{{researchContext}}

{{teacherContext}}

---

## Output Requirements

Please automatically infer the following from user requirements:

- Course topic and core content
- Target audience and difficulty level
- Course duration (default 15-30 minutes if not specified)
- Teaching style (formal/casual/interactive/academic)
- Visual style (minimal/colorful/professional/playful)

Then output your response as a single JSON object.

**Top-level shape — this is what you MUST return:**

```json
{
  "languageDirective": "2-5 sentence instruction describing the course language behavior",
  "courseTitle": "concise course name, ≤30 chars, in the teaching language",
  "outlines": [ /* array of scene objects, schema described below */ ]
}
```

Never return a bare array. Never omit `languageDirective` or `courseTitle`. All three keys are required.

**Each scene inside the `outlines` array has this minimum shape:**

```json
{
  "id": "scene_1",
  "type": "slide" | "quiz" | "interactive" | "pbl",
  "title": "Scene Title",
  "description": "Teaching purpose description",
  "keyPoints": ["Point 1", "Point 2", "Point 3"],
  "order": 1
}
```

### Special Notes

- **quiz scenes must include quizConfig**:
   ```json
   "quizConfig": {
     "questionCount": 2,
     "difficulty": "easy" | "medium" | "hard",
     "questionTypes": ["single", "multiple"]
   }
   ```
{{#if hasSourceImages}}
- **If source images are available**, add `suggestedImageIds` to relevant slide scenes. Only use image IDs listed under Available Images.
{{/if}}
- **Interactive scenes**: If a concept benefits from hands-on simulation/visualization, use `"type": "interactive"` with `widgetType` and `widgetOutline` fields. Limit to 1-2 per course by default. Explicit interactive coverage requirements override this default: honour all requested widget types, counts, and per-concept coverage.
   - Select widgetType based on concept: simulation (physics/chem), diagram (processes), code (programming), game (practice), visualization3d (3D models)
   - Provide appropriate widgetOutline for the widget type
- **Scene count**: Based on inferred duration, typically 1-2 scenes per minute
- **Quiz placement**: Recommend inserting a quiz every 3-5 slides for assessment
- **Language**: Infer from the user's requirement text and context, then output all content in the inferred language
- **If web search results are provided**, treat them as supplementary evidence only. Preserve the user's requested knowledge points, learner level, difficulty, scene structure, and quiz scope. Use only directly relevant current facts, examples, or sources; ignore tangents and do not add advanced concepts merely because they appear in search results. When a search result conflicts with the user's requirement or supplied course material, follow the requirement and course material.

**Final reminder**: your entire response must be a JSON **object** with exactly three top-level keys — `languageDirective` (string), `courseTitle` (string, ≤30 chars, in the teaching language), and `outlines` (array). Do not return a bare array. Do not wrap in prose or code fences.
