---
"prompt-identifiers-ai-sdk": patch
---

Report `debugData.durationMs` on a stream as the time spent decoding rather than the generation's wall clock. It stamped the clock at the first text delta and stopped at the report, so it carried the model's latency: 93ms measured against the 0.1ms the generated path reports for the same decode.
