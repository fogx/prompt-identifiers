---
"prompt-identifiers-ai-sdk": patch
---

Escape an identifier written back into tool call input. Tool input is serialised JSON rewritten as text rather than parsed, so an identifier carrying a quote, a backslash or a control character, which a custom input format can match, left the SDK unable to parse the arguments the tool was called with. Identifiers a built-in format matches are unaffected.
