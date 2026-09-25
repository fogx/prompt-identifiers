---
"prompt-identifiers-baml": minor
---

Decode a placeholder sitting in an object key. A model asked to group its answer by identifier returns a `map<string, T>` whose keys are placeholders, and `deepDecode` walked only values, so those keys came back raw while a sibling text field decoded. Keys are now decoded too, counted in the debug total, and defined as own properties so a decoded `__proto__` cannot reach the prototype.

Close the wrapped generator when a consumer stops reading. Breaking out of a `for await` over `wrapBamlStreamingFunction`, or throwing inside it, left the underlying BAML stream open.
