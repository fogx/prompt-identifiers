---
"prompt-identifiers-baml": minor
---

Walk only plain records. Every object was rebuilt from its entries, so a BAML media argument, which is a native handle with no own enumerable keys, arrived as `{}` and the runtime refused the call with `Invalid media source`. A `Date`, a `Map`, a `Set` and a class instance were flattened the same way. Anything whose prototype is not `Object.prototype` is now handed through by identity, on the way out and on the way back.
