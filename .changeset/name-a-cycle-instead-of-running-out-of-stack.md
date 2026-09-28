---
"prompt-identifiers-baml": patch
---

Name a value that refers back to itself. The walk had no cycle guard on either half, so an ORM entity with a parent backreference, which is walked since class instances started being walked, died with `RangeError: Maximum call stack size exceeded` and nothing said which payload it came from. Both halves now throw a `TypeError` naming the BAML argument or the BAML answer, the way the ai-sdk package already does for a tool payload and a tool result, and both guard the array walk as well as the object walk, so a cycle that closes through an array is named too. The same value reachable under two keys is not a cycle and still encodes and decodes as it did.
