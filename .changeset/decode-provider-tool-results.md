---
"prompt-identifiers-ai-sdk": minor
---

Restore identifiers in the result of a tool the provider ran itself. A provider-executed tool (web search, a code interpreter, an MCP server the provider calls) receives the encoded arguments and echoes the placeholders back in its result, which reached the caller raw on both the generated and the streamed path. The result is now walked and decoded in its keys as well as its strings, and the decode warning scan reads it under a new `tool_result` source.
