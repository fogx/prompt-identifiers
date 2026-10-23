---
"prompt-identifiers-baml": minor
---

Walk a value only when its state is in its own enumerable keys. Every object was rebuilt from its entries, so a BAML media argument, which is a native handle with no own enumerable keys, arrived as `{}` and the runtime refused the call with `Invalid media source`. A `Date`, a `Map`, a `Set`, a `RegExp`, a `Promise` and an `Error` were flattened the same way, and so was any of them carrying an own field, which came back with its prototype and none of its state. All of them are now handed through by identity, on the way out and on the way back, recognised by their own `Object.prototype.toString` tag, as is a typed array. Anything else is walked and rebuilt on its own prototype, so the identifiers in a class instance or in a record built with no prototype are encoded and its methods and its type survive.
