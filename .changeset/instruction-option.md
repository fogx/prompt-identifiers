---
"prompt-identifiers-ai-sdk": minor
---

**Breaking:** Replace `injectInstruction` and `customInstruction` with a single required `instruction` option, and append it on every call rather than only on calls whose prompt carried an ID.

The package no longer ships an instruction of its own: pass the text you want, or `false` to send none and leave the system message alone. Injecting only when an ID appeared changed the system message mid-conversation, which costs a full prompt-cache rewrite of the system block at the provider. Every `{format}` in the text is replaced with an example placeholder when the middleware is built, not on each call.

The option is required because most models strip the delimiters out of tool call arguments without one, and the old default was `true`. A caller who never set `injectInstruction` was getting an instruction and would otherwise have lost it silently, with a return of `stripped_delimiter` warnings as the first symptom. Passing neither now fails to compile, and throws for a caller with no types. Callers on `injectInstruction: true` pass their own text; callers on `injectInstruction: false` pass `false`. An `instruction` is ignored under the `Passthrough` output format, which encodes nothing.
