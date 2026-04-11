---
name: server-init
description: Initialize a new remote server (typically a Chinese cloud GPU server like Matpool) with Clash proxy and Claude Code. Use when the user wants to set up a new server, install proxy/VPN/Clash on a remote machine, install Claude Code on a remote server, or prepare a server environment for development behind the GFW.
---

# Server Init

A skill for initializing a new remote server with Clash proxy and Claude Code. This is designed for Chinese cloud GPU servers (e.g., Matpool) that are behind the GFW and need proxy access to reach external services like GitHub, npm, and Anthropic API.

## Prerequisites

The following must exist on the **local machine** before running this skill:

- SSH key pair at `~/.ssh/id_ed25519` (or other key type)
- Clash config file at `~/.config/clash/独角兽.yaml`
- GeoIP database at `~/.config/clash/Country.mmdb`
- Mihomo (Clash Meta) binary for linux-amd64 — if not cached at `/tmp/mihomo-linux-amd64`, it will be downloaded

If any prerequisite is missing, inform the user and help them obtain it before proceeding.

## Workflow

When the user provides an SSH connection string (e.g., `ssh -p PORT user@host`), follow these steps in order:

### Step 0: Parse Connection Info

Extract `host`, `port`, and `user` from the SSH command. All subsequent `ssh` and `scp` commands should use these values. Use `-o ConnectTimeout=10` on all SSH commands.

### Step 1: Verify SSH Access

```bash
ssh -p PORT -o ConnectTimeout=10 user@host "echo 'connected' && uname -m && cat /etc/os-release | head -3"
```

If this fails, guide the user through setting up SSH key-based auth:
1. Generate key if needed: `ssh-keygen -t ed25519`
2. Ask the user to run `ssh-copy-id -p PORT user@host` (requires interactive password input)
3. Retry after they confirm

### Step 2: Install Clash

1. **Create config directory** on the remote server:
   ```bash
   ssh ... "mkdir -p ~/.config/clash"
   ```

2. **Upload config and MMDB** from local machine:
   ```bash
   scp -P PORT ~/.config/clash/独角兽.yaml user@host:~/.config/clash/config.yaml
   scp -P PORT ~/.config/clash/Country.mmdb user@host:~/.config/clash/Country.mmdb
   ```

3. **Upload Clash binary**. The server likely can't download from GitHub directly (GFW), so download locally first, then upload:
   - Check if `/tmp/mihomo-linux-amd64` exists locally; if not, download it:
     ```bash
     curl -L -o /tmp/mihomo-linux-amd64.gz "https://github.com/MetaCubeX/mihomo/releases/download/v1.18.10/mihomo-linux-amd64-v1.18.10.gz"
     gunzip -f /tmp/mihomo-linux-amd64.gz
     chmod +x /tmp/mihomo-linux-amd64
     ```
   - Upload to server:
     ```bash
     scp -P PORT /tmp/mihomo-linux-amd64 user@host:/usr/local/bin/clash
     ssh ... "chmod +x /usr/local/bin/clash"
     ```

4. **Start Clash** and verify:
   ```bash
   ssh ... "nohup clash -d ~/.config/clash > ~/.config/clash/clash.log 2>&1 & sleep 3 && cat ~/.config/clash/clash.log"
   ```
   Confirm you see "Initial configuration complete" and the HTTP/SOCKS proxy lines.

5. **Test proxy**:
   ```bash
   ssh ... "curl -s -o /dev/null -w '%{http_code}' --connect-timeout 10 -x http://127.0.0.1:7890 https://www.google.com"
   ```
   Should return `200` or `302`.

### Step 3: Configure Shell Environment

Append proxy settings and Clash auto-start to `~/.bashrc`:

```bash
ssh ... "cat >> ~/.bashrc << 'EOF'

# Clash proxy
export http_proxy=http://127.0.0.1:7890
export https_proxy=http://127.0.0.1:7890
export no_proxy=localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16

# Auto-start Clash if not running
if ! pgrep -x clash > /dev/null 2>&1; then
    nohup /usr/local/bin/clash -d ~/.config/clash > ~/.config/clash/clash.log 2>&1 &
    echo 'Clash started.'
fi
EOF"
```

### Step 4: Install Node.js

The server likely has an old Node.js or none. Claude Code requires Node.js 18+.

Download the binary directly (apt/npm may be broken or slow on these servers):

```bash
ssh ... "export https_proxy=http://127.0.0.1:7890 && curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz -o /tmp/node.tar.xz && tar -xf /tmp/node.tar.xz -C /usr/local --strip-components=1 && node -v && npm -v"
```

### Step 5: Install Claude Code

Fix npm registry if it points to an expired mirror, then install:

```bash
ssh ... "npm config set registry https://registry.npmjs.org/ && export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 && npm install -g @anthropic-ai/claude-code 2>&1 | tail -5"
```

Verify:
```bash
ssh ... "claude --version"
```

### Step 6: Summary

After all steps complete, print a summary:

```
Server initialization complete!
- Clash proxy: running (HTTP :7890, SOCKS :7891)
- Proxy env vars: configured in .bashrc
- Node.js: vXX.XX.X
- Claude Code: vX.X.X

To use: ssh -p PORT user@host, then run `claude`
```

## Error Handling

- **GitHub download fails locally**: Check local internet connection. The local machine should have direct access to GitHub.
- **npm registry expired cert**: Reset to official registry with `npm config set registry https://registry.npmjs.org/`
- **No systemd**: These are typically Docker containers. Don't try systemd — use the .bashrc auto-start approach instead.
- **MMDB download hangs on server**: Always upload from local, never let the server download it directly.
- **Node.js apt conflicts**: Skip apt entirely, use direct binary tarball installation.
