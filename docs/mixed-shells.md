# Mixed Shell Environments on Windows

## The Problem

When switching between PowerShell and Git Bash in the same session, Windows-style
paths with backslashes get misinterpreted by Git Bash, producing garbage filenames
in the current working directory.

**Example:** A PowerShell path like `C:\tmp\reviews.json` passed into a Git Bash
context strips the backslashes and concatenates the components into a single filename:

```
C:\tmp\reviews.json        →  C:tmpreviews.json
C:\Users\rpgfo\reviews_tmp.json  →  Usersrpgforeviews_tmp.json
```

These files end up in the CWD (e.g. the project root) instead of the intended path.

## When It Happens

- Running searches or test commands that mix shells (e.g. spawning a Bash subprocess
  from PowerShell, or vice versa)
- Copy-pasting a Windows path from PowerShell output into a Git Bash command
- Any tool or script that constructs a path in one environment and passes it to another

## The Fix

Pick one shell and stick to it for the entire session. Don't mix PowerShell and
Git Bash in the same workflow.

- **Git Bash**: use forward-slash paths (`/c/dev/...`)
- **PowerShell**: use backslash paths (`C:\dev\...`)

If you find stray files like `C:tmpfoo.json` or `Userssomethingbar.json` in the
project root, they were created by shell mixing — just delete them. They are not
code bugs and do not require gitignore rules.
