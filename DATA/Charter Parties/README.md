# Charter Parties — base form references

This folder holds reference texts for the standard charter-party forms
that NEFGO and its counterparties use as the legal **base** of every
voyage charter. The CP recap that the trader sends as a fixture
is, by industry convention, a list of **modifications and additions**
to one of these standard forms — it does not restate the entire form.

So when the operator drops a recap into the system, the parser and
the AI Q&A assistant always read against two layers:

1. **The CP recap** — operator-specific terms, ranges, prices, laycan,
   demurrage rate, special clauses.
2. **The standard charter party** named in the recap's TITLE block
   (today: BPVOY4 for every fixture in our corpus).

The AI Q&A endpoint loads the recap, then layers the matching CP
reference from this folder underneath it, and answers every question
by citing whichever layer holds the answer.

```
Charter Parties/
  BPVOY4/
    bpvoy4-reference.md       (current default — every fixture in our
                                corpus is on a BPVOY4 base)
  BPVOY5/                     (future — newer BP iteration)
  Asbatankvoy/                (future — American standard tanker form)
  Shellvoy 6/                 (future — Shell standard form)
  Mobilvoy/                   (future — ExxonMobil)
```

## Why summaries instead of the verbatim form

Standard charter-party forms (BPVOY4 included) are copyrighted by the
publishing oil major (BP plc for BPVOY4, BIMCO/Shell for Shellvoy,
ASBA for Asbatankvoy). The reference docs in this folder are
**clause-by-clause plain-English summaries** that capture each
clause's number, title, party obligation, timing and key conditions —
enough for the AI to answer operational questions and cite the right
source — without reproducing the verbatim copyrighted text.

For internal compliance review, the operator should consult the actual
signed form, which lives in the legal/contracts archive. The summary
here is a working tool, not a legal substitute.
