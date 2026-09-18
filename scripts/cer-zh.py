# 中文 CER：把"繁简差异"和"真错字"分开算
#
# 模型对 zh 输出的是繁体（開會、會議、討論…），参照是简体。
# 直接按字比，光繁简不同就吃掉三十几个字，那个数不说明任何问题。
# 所以报三个数：原样比、繁转简之后比、繁转简+数字归一之后比。
import json, re, sys
from zhconv import convert

RES = r'C:/Users/Administrator/WorkBuddy AI/2026-09-17-19-40-53/agent-ready/ab-results/zh-2026-09-18.json'
REF = r'C:/Users/Administrator/WorkBuddy AI/2026-09-16-15-52-49/zh20.txt'

PUNCT = re.compile(r'[\s，。、；：？！「」『』（）()《》〈〉,.!?;:"\'`—\-…·]')
strip = lambda s: PUNCT.sub('', s)

DIGITS = {'0': '零', '1': '一', '2': '二', '3': '三', '4': '四', '5': '五',
          '6': '六', '7': '七', '8': '八', '9': '九'}
num2han = lambda s: ''.join(DIGITS.get(c, c) for c in s)


def align(ref, hyp):
    R, H = list(ref), list(hyp)
    n, m = len(R), len(H)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i - 1][j - 1] + (R[i - 1] != H[j - 1]),
                          d[i - 1][j] + 1, d[i][j - 1] + 1)
    i, j = n, m
    ops = []
    sub = dele = ins = 0
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (R[i - 1] != H[j - 1]):
            if R[i - 1] != H[j - 1]:
                sub += 1
                ops.append(('sub', R[i - 1], H[j - 1]))
            else:
                ops.append(('ok', R[i - 1], H[j - 1]))
            i -= 1
            j -= 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            dele += 1
            ops.append(('del', R[i - 1], '·'))
            i -= 1
        else:
            ins += 1
            ops.append(('ins', '·', H[j - 1]))
            j -= 1
    ops.reverse()
    return dict(refLen=n, hypLen=m, sub=sub, dele=dele, ins=ins,
                err=sub + dele + ins, cer=(sub + dele + ins) / n if n else None, ops=ops)


res = json.load(open(RES, encoding='utf-8'))
ref = strip(open(REF, encoding='utf-8').read())
hyp_raw = strip(res['text'])
hyp_s = strip(convert(res['text'], 'zh-cn'))
hyp_sn = num2han(hyp_s)
ref_n = num2han(ref)

variants = [
    ('A 原样（繁简不同全算错）', ref, hyp_raw),
    ('B 繁转简之后', ref, hyp_s),
    ('C 繁转简 + 数字归一（3点→三点）', ref_n, hyp_sn),
]

print('转写原文:')
print('  ' + res['text'])
print('繁转简后:')
print('  ' + convert(res['text'], 'zh-cn'))
print('参照:')
print('  ' + open(REF, encoding='utf-8').read().strip())
print()
for name, r, h in variants:
    a = align(r, h)
    print(f"{name}: 参照{a['refLen']}字 转写{a['hypLen']}字 "
          f"替换{a['sub']} 漏{a['dele']} 多{a['ins']} → 错{a['err']}  CER {a['cer']*100:.1f}%")

a = align(ref_n, hyp_sn)
print('\nC 口径下逐字差异（参照字 → 转写字）:')
bad = [(x[1], x[2]) for x in a['ops'] if x[0] != 'ok']
for r_, h_ in bad:
    print(f"  {r_} → {h_}")
print(f"共 {len(bad)} 处")
