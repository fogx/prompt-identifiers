---
"prompt-identifiers-baml": minor
---

Walk a value only when its state is in its own enumerable keys. Every object was rebuilt from its entries, so a BAML media argument, which is a native handle with no own enumerable keys, arrived as `{}` and the runtime refused the call with `Invalid media source`. A `Date`, a `Map`, a `Set`, a `RegExp` and a `Promise` were flattened the same way. All of them are now handed through by identity, on the way out and on the way back, as is a typed array, whose own keys are its bytes. Anything else is walked and rebuilt on its own prototype, so the identifiers in a class instance or in a record built with no prototype are encoded and its methods and its type survive.
