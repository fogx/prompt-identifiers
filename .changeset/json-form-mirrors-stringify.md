---
"prompt-identifiers-ai-sdk": patch
---

Serialise a tool payload the way the provider will. A `toJSON` now speaks for its slot once: what it returns is walked as it stands, a boxed string or number it returns is unwrapped, and a function it leaves on the result is dropped rather than handed to the provider, which would otherwise call it after encoding and write an identifier the encoder never saw.
