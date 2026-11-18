# Test fixture provenance

The three files originate from the user-supplied `melon-chart.zip`, SHA-256
`1ff862738a5e20acb6c8de5f1c2bf274099223888a60bfc1235a1b07732095bb`.
They are cropped/test fixtures, not independently verified complete HTTP captures.
The Tencent HTML includes fixture markers; its SPDX comment was added locally.

`genie-pages.json` exercises four pages and 200 entries. `flo-chart.json`
exercises 100 entries. `tencent-preview.html` exercises the public 10-entry
preview. Other parser tests construct synthetic markup/data in the test files.
None of these fixtures is eligible for a production snapshot or history import.
Test success proves parser behavior against these inputs, not current source
availability. Production source observations must be recorded separately.

`billboard-global-k-songs-20261031.html` is cropped from the official Billboard
Korea public page read on 2026-10-28. The original sanitized HTTP HTML hash is
`f31970ae8756056a2f5330fafad2d6880207355ed5a8dcfdad709d4ce99acb3a`.
It retains the canonical URL, exact heading, WEEK OF OCTOBER 31, 2026 label,
and the 100 public `.basic` rows in original order. Navigation, scripts, forms,
extra row panels and indentation were removed; an SPDX comment was added.
The issue label is not a source publication timestamp. It is a parser fixture,
never a production import or a substitute for a fresh public source read.
