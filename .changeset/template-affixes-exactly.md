---
"prompt-identifiers": patch
---

Read a template's affixes from the template. It says where its index sits, so its literals are the prefix and suffix exactly, at any pad width, and no probe has to outgrow the padding. A bare formatter function is still probed, because nothing can be read off it. A formatter function is probed at four spread indices rather than three, so a padded one has to be wider than sixteen digits before its padding is read as an affix.
