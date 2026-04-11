---
name: sync-skills
description: >
  Sync skills between local and GitHub repo (lhrst/claude-config).
  Use when the user wants to pull new skills from GitHub, push local skills to GitHub,
  or do a bidirectional sync. Triggers on phrases like "sync skills", "pull skills",
  "push skills", "update skills repo".
---

# Sync Skills

Synchronize skills between the local `container/skills/` directory and the GitHub repo `lhrst/claude-config` (under the `skills/` folder).

## Workflow

### 1. Clone the remote repo to a temp directory

```bash
git clone https://github.com/lhrst/claude-config.git /tmp/claude-config-sync
```

### 2. Determine sync direction

Based on the user's request:

- **pull** — Copy new/updated skills from GitHub to local
- **push** — Copy new/updated local skills to GitHub
- **sync** (default) — Bidirectional: pull first, then push

### 3. Pull (GitHub → Local)

```bash
rsync -av /tmp/claude-config-sync/skills/ <project-root>/container/skills/
```

This brings in any new or updated skills from the remote repo without deleting local-only skills.

### 4. Push (Local → GitHub)

```bash
rsync -av <project-root>/container/skills/ /tmp/claude-config-sync/skills/
```

Then commit and push:

```bash
cd /tmp/claude-config-sync
git add skills/
git status --short
# Review changes, then:
git commit -m "同步: 更新 skills"
git push origin main
```

### 5. Clean up

```bash
rm -rf /tmp/claude-config-sync
```

## Notes

- `rsync` without `--delete` ensures local-only or remote-only skills are preserved during sync
- When pushing, always review `git status` before committing to confirm changes are expected
- The commit message should briefly describe what changed (e.g., "同步: 新增 xxx skill" or "同步: 更新 skills")
- If there are conflicts (same file modified both locally and remotely), notify the user and let them decide
- `<project-root>` is the HappyClaw project root, typically the parent of `container/`
