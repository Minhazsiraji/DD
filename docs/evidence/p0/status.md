# P0 Implementation Status

Final fresh Track-A replay and the current proof harness pass for:

- manifest hash pins and required step order;
- DD-CHK-31 exhaustive substitution corpus and 1,000,000 round trips;
- 39 P0 tables forced under RLS;
- P0+ exclusion checks;
- audit foundation presence;
- Domain-L clinical foreign-key exclusion.

The golden schema dump is `db/golden-p0.sql` and was generated from the final
fresh replay. PostgreSQL 17 emits a random `\\restrict` guard token in dumps;
the evidence process canonicalizes only those two guard lines before the
byte-for-byte comparison. The schema body is unchanged.

This is an implementation checkpoint, not final P0 acceptance. The complete
25-proof matrix, all 21 Set-A runtime assets, both B-1 extensions, the full
Domain-L model, adversarial multi-role tests, storage object policies, and the
remaining P0 RPC/state-machine surface are still outstanding.