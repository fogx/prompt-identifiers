---
"prompt-identifiers-ai-sdk": patch
---

Refuse a placeholder JSON would rewrite. A tool payload reaches the model as JSON and comes back as JSON text the decoder scans without parsing, so a placeholder carrying a quote, a backslash or a control character is written one way and read another, and the identifier never comes back. The guard asked the format for index 0 alone, so a format unsafe anywhere else was accepted and lost an identifier out of a tool call's arguments. It now reads the same spread of indices the affixes are derived from, which catches a format unsafe wherever it is read before any call is made, and every placeholder is checked again as it is minted, which catches the rest: indices are minted densely from zero, and no fixed set of probes covers a lookup table that is safe at zero and unsafe at one. A formatter that refuses a high index is still accepted.
