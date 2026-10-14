# Idea Forge: working notes

## Screen sizes

Design for wide-screen monitors first. The smallest screen that must work well is a **1366×768 laptop**: no sideways scrolling, and the main controls of each tool on screen without hunting. Production is never accessed from a phone.

- Lay out for 1920×1080 and up. Check every change at 1366×768.
- Don't spend effort on phone layouts. The existing phone rules (sidebar drawer, stacked panels) stay because the owner sometimes checks the dev deployment from a phone, but they are not a target. Don't add phone-only features or tests.
- The Slicer e2e (`scripts/slicer-e2e.mjs`) checks the 1366×768 layout and runs the full flow at 1920×1080.

## Look and feel

Keep the existing shell and style when adding screens:
- **Shell:** the sidebar (Air Force lockup, Idea Forge mark, Workspace and Tools menus), the top bar (search, Ask your Wingman, service switch, profile) and the hero art.
- **Style:** the tokens in `client/src/foundry.css`; Barlow Condensed headings over IBM Plex Sans body text; translucent panels; glowing stage chips; blue primary buttons; purple for anything Wingman (AI) does.

New features slot into this shell rather than replacing it. The Gallery and Community stay.
