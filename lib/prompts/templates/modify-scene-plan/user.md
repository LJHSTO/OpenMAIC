Scene type: {{sceneType}}
Scene title: {{sceneTitle}}
Modification mode: {{mode}}
Language directive: {{languageDirective}}
Selected element IDs: {{selectedElementIds}}

User instruction:
{{instruction}}

Scene context JSON:
{{sceneContext}}

Generate a safe EditPlan for this exact scene. Use only supported operation types. If the request targets unsupported PBL behavior, return a clarification question instead of generating operations.

When modification mode is `spot`, treat the selected element IDs as the hard scope boundary. The scene context may include non-selected element references only for layout awareness; do not modify them.
