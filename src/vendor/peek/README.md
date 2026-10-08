# Peek SVG core

Source: https://github.com/doan-labs/peek
Commit: 304f354e08c8e8eb7318eadab70f8daf5c97213c
License: MIT (see LICENSE).

Unmodified upstream svg.ts, identity.ts, draw.ts and tables.ts. Only the dependency-free SVG core is included; the React 19 component is excluded for compatibility with this app's React 18. Avatar identity is pinned to style version 1 in UserAvatar.tsx.

To update, review the pinned source and license, replace these four files together, and run the avatar tests and application build. Preserve the identity version unless changing existing avatars is intended.
