---
"prompt-identifiers-ai-sdk": minor
---

Add a single `instruction` option, and append it on every call rather than only on calls whose prompt carried an ID.

Injecting only when an ID appeared changed the system message mid-conversation, which costs a full prompt-cache rewrite of the system block at the provider. It goes in on every call now. Every `{format}` in the text is replaced with an example placeholder when the middleware is built, not on each call.

`instruction` takes the text you want, or `false` to send none and leave the system message alone. Omitted, it is the text the package shipped before, so a caller who set nothing keeps the instruction they were getting.

`injectInstruction` and `customInstruction` still work and are deprecated. `injectInstruction: false` sends none, `customInstruction` supplies the text, and `instruction` wins over both where they are given together. An instruction is ignored under the `Passthrough` output format, which encodes nothing.
