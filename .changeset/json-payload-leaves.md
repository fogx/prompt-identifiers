---
"prompt-identifiers-ai-sdk": patch
---

Identifiers in a tool call's arguments and in a JSON tool result are found wherever they sit. Both payloads were serialised, encoded as one string, then parsed back, which ran the identifier patterns over JSON's own escapes. `JSON.stringify` writes a newline as a backslash and an `n`, and both patterns open on a word boundary, so an identifier written straight after a newline, tab, carriage return, form feed or vertical tab was never matched and travelled to the model uncompressed with no warning. A newline-separated list of five identifiers in a JSON tool result compressed one of them; the same string in a text part compressed all five.

Encoding now walks the payload and encodes each string it carries, keys included, in the form the provider will serialise. `JSON.stringify` asks a value for its JSON form before writing it, so a `Date` is encoded as the string it becomes and an identifier returned by a `toJSON` method is encoded rather than reaching the model untouched. A payload that refers to itself reports a circular structure instead of exhausting the stack.

An output format whose placeholder carries a double quote, a backslash or a control character is refused when the middleware is built, naming the character. A tool payload reaches the model as JSON and comes back as JSON text the decoder reads without parsing it, so a placeholder JSON has to escape is written one way and read another. `{ template: '"{i:03}"' }` used to throw a bare `SyntaxError` out of `transformParams`, and `\u004{i:03}` minted the key `@00`, which JSON read as `@` followed by `00`, so the model was sent `@00` and the identifier was neither in the prompt nor recoverable from the mapping. Every built-in format is unaffected.
