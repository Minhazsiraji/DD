# Typecheck Attribution

The exact parent commit is `0d10a6312c0ece44780e0ba3b3354e31a7d916bc`.

The first detached-parent build reached TypeScript but Turbopack aborted with a
core dump in this container, so its initial zero-diagnostic result was invalid.
After the current branch's successful final build, the current `npm run
typecheck` passes with zero diagnostics. The transient 23 `PageProps` and
`LayoutProps` diagnostics are therefore not present in the final branch and are
not classified as inherited baseline debt or a P0 regression. The temporary
detached worktree was removed; the implementation tree was not changed by the
comparison.