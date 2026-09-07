# Message to send Claude first

Upload the AlphaRadar specification pack first.

Then send this message:

---

You are now working on the AlphaRadar project.

I have uploaded the following authoritative documents:

- 01-PROJECT-CONSTITUTION.md
- 02-MVP-TECHNICAL-SPECIFICATION.md
- 04-IMPLEMENTATION-PLAN.md
- 05-ENVIRONMENT-CONTRACT.md
- 03-CLAUDE-BUILD-PROMPT.md

Read all of them before making code changes.

Treat the Project Constitution as non-negotiable product/engineering rules and the Technical Specification as the source of truth for the MVP.

Do NOT immediately start generating large amounts of code.

First inspect the existing repository and report:

1. Current repository structure.
2. Existing framework/package manager.
3. Existing applications/packages.
4. Existing database setup.
5. Existing useful code that can be reused.
6. Any conflicts between the existing repository and the AlphaRadar specification.
7. Your proposed Phase 0 → Phase 1 implementation sequence.

Do not invent missing requirements.

Do not add autonomous trading, autonomous minting, copy trading, private-key handling, or prohibited X automation.

After your repository report, wait for my confirmation before making the first large implementation change.

---
