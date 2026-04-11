---
name: sync-credentials
description: 同步 Claude Code 登录凭证到远程开发机。从本地 Mac Keychain 提取 OAuth token，通过 SSH 写入目标机器的 ~/.claude/.credentials.json。当用户请求"同步凭证"、"sync credentials"、"同步登录"、"推送凭证"、"凭证同步"、"同步 token"时使用。
---

# Sync Claude Code Credentials

将本地 Mac Keychain 中的 Claude Code OAuth 凭证同步到远程开发机。

## 目标机器

| 别名 | 地址 | 用户名 | 凭证路径 |
|------|------|--------|----------|
| Mac Mini | 192.168.31.100 | litianqi | ~/.claude/.credentials.json |

如果用户提到新的目标机器，追加到上表并同步。

## 执行步骤

### 1. 提取本地凭证

```bash
security find-generic-password -s "Claude Code-credentials" -w
```

### 2. 校验 JSON

用 `python3 -m json.tool` 验证提取结果是有效 JSON。如果无效，提示用户本地凭证可能已损坏，需要重新 `claude login`。

### 3. 推送到目标机器

对每个目标：

```bash
CRED=$(security find-generic-password -s "Claude Code-credentials" -w)
ssh <user>@<host> "mkdir -p ~/.claude && cat > ~/.claude/.credentials.json << 'CREDEOF'
$CRED
CREDEOF
chmod 600 ~/.claude/.credentials.json"
```

### 4. 验证

SSH 到目标机器，读取 `.credentials.json` 前几行确认写入成功。

## 注意事项

- 凭证文件权限必须设为 600
- 如果 SSH 连不上，先尝试 Tailscale IP（Mac Mini: 100.65.225.15）
- 如果目标机器需要 sudo 密码解锁 keychain，用户密码是 000202
- token 有过期时间（expiresAt 字段），同步前可以检查是否快过期，提醒用户
