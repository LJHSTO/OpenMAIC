Scene type: {{sceneType}}
Scene title: {{sceneTitle}}
Modification mode: {{mode}}
Language directive: {{languageDirective}}
Selected element IDs: {{selectedElementIds}}

Conversation context JSON:
{{conversationHistory}}

User instruction:
{{instruction}}

Scene context JSON:
{{sceneContext}}

Generate a safe EditPlan for this exact scene. Use only supported operation types. If the request targets unsupported PBL behavior, return a clarification question instead of generating operations.

When modification mode is `spot`, treat the selected element IDs as the hard scope boundary. The scene context may include non-selected element references only for layout awareness; do not modify them.

When modification mode is `conversation`, use the conversation context only to understand prior accepted or previewed intent. The current user instruction is authoritative for the next refinement.
