# The 6 residual character errors (one clip, n = 1)

Reference: 97 Simplified characters. Model output: Traditional Chinese.
After converting the output to Simplified and normalizing digits, 6 characters
remain wrong. Deletions 0, insertions 0.

| # | reference | model output | note |
|---|---|---|---|
| 1 | 线 | 限 | 上线计划 -> 上限計畫 |
| 2 | 设 | 涉 | 设计和 -> 涉及和 |
| 3 | 计 | 及 | 设计 -> 涉及 |
| 4 | 那 | 大 | 那家新开 -> 大家新开 |
| 5 | 得 | 的 | 来得及 -> 来的急 |
| 6 | 及 | 急 | 来得及 -> 来的急 |

Errors 5 and 6 are the same word (来得及 / 来的急) counted as two characters.

This is one clip. It is a count, not a rate. It is published as 6 wrong
characters out of 97, not as an accuracy percentage.
