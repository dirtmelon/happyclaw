---
name: matpool-gpu
description: |
  矩池云 GPU 服务器全生命周期管理：浏览机器、租用服务器、SSH 远程操作、释放服务器、账户管理。
  当用户请求"租 GPU"、"租服务器"、"矩池云"、"matpool"、"GPU 训练"、"分布式训练"、
  "超参搜索"、"释放机器"、"关机器"、"查看余额"、"查看实例"时使用。
  即使用户没有明确提到矩池云，只要涉及租用 GPU 云服务器进行训练或推理，都应优先使用此 skill。
---

# 矩池云 GPU 服务器管理

通过 API 自动化管理矩池云 GPU 服务器的完整生命周期。

## 认证信息

- **手机号**: 19568732460
- **密码**: deepshape0929
- **用户 ID**: 87493
- **Token Cookie 名**: `matpool_token`（URL 编码的 Bearer JWT）

### 获取 Token（API 方式，推荐）

Token 可以直接通过登录 API 获取，无需浏览器：

```bash
TOKEN=$(curl -s -X POST "https://matpool.com/api/login" \
  -H "Content-Type: application/json" \
  -d '{"mobile": "19568732460", "password": "deepshape0929"}' \
  | python3 -c "import json,sys; print('Bearer ' + json.load(sys.stdin)['token'])")
echo "$TOKEN"
```

Token 有效期约 7 天。过期后重新调用上述命令即可。

**检测 token 是否过期**：如果 API 返回 `code: 176` 或 `msg: "check jwt token failed"`，说明 token 过期，需要重新获取。

### 获取 Token（Playwright 备选方式）

如果 API 登录不可用，可通过 Playwright 浏览器登录：

1. 打开 `https://matpool.com/login`
2. 填入手机号和密码，点击登录
3. 从 cookie 提取 token：`document.cookie.match(/matpool_token=([^;]+)/)`
4. URL decode 后即为 `Bearer <jwt>`

### Token 使用

所有 API 请求需要 header: `Authorization: $TOKEN`（$TOKEN 包含 "Bearer " 前缀）

### 机器状态文件

所有正在运行的机器信息维护在 `~/.claude/matpool_machines.json` 文件中。
每次租用、释放、部署任务后都应更新此文件。这样不同 session 可以共享机器状态。

```bash
# 读取当前机器状态
cat ~/.claude/matpool_machines.json

# 格式见下方"机器状态管理"章节
```

## API 参考

Base URL: `https://matpool.com`

### 1. 用户与账户

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/user` | GET | 用户信息（id, 手机号, 实名状态, 网盘用量） |
| `/api/user/account` | GET | 余额（`balance` 单位为分，90180 = ¥901.80） |
| `/api/user/public_key` | GET | SSH 公钥 |
| `/api/domain/list` | GET | 区域列表 |

区域映射：`0=1区, 11=亚太2区, 13=13区, 15=国产卡, 16=16区`

### 2. 浏览机器市场

```bash
# 列出所有可用机器
curl -s "https://matpool.com/api/machines?domains=0&domains=11&domains=13&domains=15&domains=16&machine_category=0&page=1&per_page=50&tags=0&condition=eyJmaWx0ZXJzIjpudWxsLCJzb3J0cyI6bnVsbH0%3D" \
  -H "Authorization: $TOKEN"
```

返回 `machines[]`，每台包含：
- `agentId` — 机器标识，租用时需要
- `hardware.gpu.gpuName` — GPU 型号
- `hardware.priceMillicent` — 价格（厘/小时，55000 = ¥0.55/h）
- `gpu.available` — 可用 GPU 数量

### 3. 获取镜像列表

```bash
# 查看某台机器可用的系统镜像
curl -s "https://matpool.com/api/images?agent_id=<agent_id>&machine_category=0&page=1&per_page=100" \
  -H "Authorization: $TOKEN"
```

返回 `images[]`，每个含 `id`（租用时需要）和 `alias`（镜像名称如 "Pytorch 2.0"）

常用镜像 ID（可能随时间变化，建议每次查询确认）：
- Pytorch 2.0: `633745`
- Pytorch 1.11: `632602`

### 4. 租用服务器（创建实例）

```bash
curl -s -X POST "https://matpool.com/api/node" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": 119,
    "image_id": 633745,
    "vnc_switcher": false,
    "auto_password": true,
    "mount_infos": "[{\"source\":\"/\",\"dest\":\"/mnt\",\"readOnly\":false}]",
    "machine_category": 0,
    "hardware_qty": 1
  }'
```

参数说明：
- `agent_id` — 从 machines 列表获取
- `image_id` — 从 images 列表获取
- `hardware_qty` — GPU 数量（1 张起）
- `mount_infos` — 网盘挂载（默认 `/` → `/mnt`）
- `vnc_switcher` — 是否开启 VNC（一般不需要）

**安全提醒**：租用会产生真实费用，必须先确认用户意图再调用此 API。

### 5. 查看运行中的实例

```bash
# 列出运行中的实例（status 2=运行中, 1=启动中, 4=已释放）
curl -s "https://matpool.com/api/nodes?order=false&page=1&per_page=20&statuses=2" \
  -H "Authorization: $TOKEN"
```

### 6. 获取实例详情 + SSH 连接信息

```bash
curl -s "https://matpool.com/api/node?request_id=<displayID>" \
  -H "Authorization: $TOKEN"
```

关键字段：
- `userNode.node.id` — 数字 ID（释放时需要）
- `userNode.displayID` — 短 ID（如 PxNN0r）
- `userNode.sshAuths[0].BaseOn.Cred.user` — SSH 用户名（root）
- `userNode.sshAuths[0].BaseOn.Cred.password` — SSH 密码
- `userNode.node.ports[]` — 端口映射，protocol=1 为 SSH，从 `url` 提取 host:port

SSH 连接格式：`ssh -p <port> root@<host>`
- 本地已配置公钥免密登录，通常无需密码

### 7. 释放（停止）实例

```bash
# 用数字 ID 释放实例
curl -s -X DELETE "https://matpool.com/api/node" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id": <numeric_node_id>}'
```

**安全提醒**：
- 释放前确认不是包月机器（包月机器释放会浪费剩余时长）
- 释放后本地磁盘数据丢失，网盘 `/mnt` 数据保留
- 必须先获取 `node.id`（数字 ID），不是 displayID

### 8. 快照/环境管理

```bash
# 列出所有快照
curl -s "https://matpool.com/api/snapshots?page=1&per_page=20" \
  -H "Authorization: $TOKEN"
```

返回 `snapshots[]`，每个含：
- `id` — 快照 ID
- `nodeID` — 创建快照的实例 ID
- `path` — 快照文件路径（如 `/1862039_1760288970.snap`）
- `flag.subject` — 快照名称（如 "成功的crosstooth"）
- `enabled` — 是否可用

**⚠️ 重要：快照恢复只能通过网页操作，API 不支持 `source_type`/`snapshot_id` 参数**

#### 网页恢复快照流程（用 Playwright）

```
1. 打开 https://matpool.com/host-market/gpu
2. 点击目标机器的"租用"按钮
3. 在弹出面板中，点击"我的环境" tab（在"系统镜像"/"共享镜像"旁边）
4. 选择要恢复的环境（radio button）
5. 点击"下单"按钮
6. 等待启动（从环境恢复比普通镜像慢，需 1-3 分钟）
```

#### 已知快照（2026-03-28）

| ID | 名称 | 大小 | 内容 |
|----|------|------|------|
| 207452 | online_server | 30G | 当前包月机器镜像（推理服务） |
| 200179 | 成功的crosstooth | 4.6G | CrossTooth 推理代码 |
| 202039 | pointattn train | 2.5G | PointAttN 点云补全训练代码 |
| 204724 | AdaPoinTr | 1.7G | AdaPoinTr 补全 |

### 9. 其他 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/node/statistics` | GET | 各状态实例统计 |
| `/api/node/bill?request_id=<displayID>` | GET | 计费记录 |
| `/api/orders?catalog=1&domain=0` | GET | 订单列表 |
| `/api/snapshot/volumes?display_node_id=<displayID>` | GET | 快照/网盘信息 |
| `/api/snapshots?page=1&per_page=20` | GET | 快照列表 |
| `/api/groups?type=team` | GET | 团队信息 |

### API 已知问题

- **`gpu.available` 字段不可靠**：machines API 返回的 `gpu.available` 和 `gpu.total` 经常为 0，但网页显示有可用机器。需要直接租用或通过网页查看
- **节点 `status=-1`**：API 返回 -1 但 SSH 端口已分配，可能已可连接。用 `GET /api/nodes?order=false&page=1&per_page=10`（不带 statuses 过滤）可以看到所有实例

## 标准操作流程

### 流程一：租用并使用 GPU 服务器

```
1. 检查余额   → GET /api/user/account
2. 浏览机器   → GET /api/machines（筛选型号/价格/可用数量）
3. 选择镜像   → GET /api/images?agent_id=<id>
4. 下单租用   → POST /api/node（⚠️ 需用户确认）
5. 等待启动   → 轮询 GET /api/nodes?statuses=1&statuses=2（通常 30-60 秒）
6. 获取 SSH   → GET /api/node?request_id=<displayID>，提取 host:port 和密码
7. SSH 连接   → ssh -p <port> root@<host>（公钥免密或密码登录）
8. 部署代码   → scp -P <port> <file> root@<host>:/root/
9. 执行任务   → ssh 远程执行命令
10. 释放机器  → DELETE /api/node，body: {"id": <numeric_id>}（⚠️ 需用户确认）
```

### 流程二：批量租用做超参搜索

```
1. 确定搜索空间（超参组合数 = 需要的服务器数）
2. 查找足够的可用机器（可能需要不同型号混合）
3. 批量租用 → 循环调用 POST /api/node
4. 等待全部启动 → 轮询直到 statuses=2 数量满足
5. 获取所有 SSH 信息 → 逐个 GET /api/node?request_id=<displayID>
6. 并行部署训练脚本 → scp + ssh（后台执行，nohup）
7. 监控进度 → 定期 ssh tail 日志
8. 收集结果 → 从 /mnt（网盘）读取结果 JSON
9. 释放全部 → 循环 DELETE /api/node
```

## 远程执行注意事项

### Conda 环境

矩池云的 PyTorch 镜像中，torch 不在默认 python3 中，需要先激活 conda 环境：

```bash
# 正确方式
ssh -p <port> root@<host> "nohup bash -c 'source /root/miniconda3/etc/profile.d/conda.sh && conda activate myconda && python /root/train.py' > /root/train.log 2>&1 &"

# 错误方式（会报 ModuleNotFoundError: No module named 'torch'）
ssh -p <port> root@<host> "python3 /root/train.py"
```

### 数据集

矩池云预置了公共数据集在 `/public/` 目录，包括：
- `/public/torchvision_datasets/MNIST` — MNIST 完整数据
- `/public/huggingface_models/` — HuggingFace 模型
- 更多参见 `/public/` 目录

从外网下载数据集会很慢（矩池云限速），优先使用本地公共数据集。

### 结果保存

- 保存到 `/mnt/`（网盘）→ 释放后数据保留
- 保存到其他目录 → 释放后数据丢失
- 不同区域的网盘不互通

## 当前长期实例

用户有一台包月 A16 服务器，**绝对不能释放**：
- Display ID: `PxNN0r`
- Numeric ID: `1831057`
- Host: `hz-4.matpool.com:29649`
- GPU: NVIDIA A16 (15G)
- 计费: 包月 ¥277.20/月
- 用途: 推理服务器

## 网盘内容（/mnt/，1区）

### 训练数据
- `upperdata.zip` (7.0G) — 上颌高质量数据（~2060 样本：OBJ + modified_seg + tooth_features）
- `202508标注完成upper_jaw.zip` (4.4G) — 早期上颌标注数据（~720 样本）

### 模型代码 & 权重
- `CrossTooth_CVPR2025-main.zip` (29M), `PointTransformer.zip` (43K), `PointAttN.zip` (13M), `PoinTr.zip` (26M)
- TGNet 系列权重 .h5: tgnet_fps(62M), pointnet(36M), pointnetpp(35M), pointtransformer(31M), tsegnet(9.3M), dgcnn(3.8M)

### 快照文件（39GB，可清理释放空间）
- 4 个 .snap 文件共占 39GB

### 网盘扩容
- 免费 5GB，扩容 ¥0.50/GB/月
- 管理页面：`/user/matbox`
- 当前配额 55GB，已用 ~50GB

## 机器状态管理

所有运行中的机器及其任务记录在 `~/.claude/matpool_machines.json`。
**每次租用、释放、部署任务后必须更新此文件。** 不同 session 通过读取此文件来了解当前机器状态。

### 文件格式

```json
{
  "last_updated": "2026-04-04T14:30:00",
  "token": "Bearer eyJ...(最新token)",
  "machines": {
    "PxNN0r": {
      "node_id": 1831057,
      "gpu": "NVIDIA A16",
      "ram_gb": 14,
      "ssh": "ssh -p 29649 root@hz-4.matpool.com",
      "billing": "monthly",
      "price_per_hour": 0,
      "task": "推理服务 (inference_server)",
      "status": "running",
      "note": "永不释放"
    }
  }
}
```

### 操作规范

1. **租用后**: 立即添加新机器条目（包含 SSH、GPU、任务描述）
2. **部署任务后**: 更新 `task` 字段说明正在跑什么
3. **释放前**: 先读取文件确认没有其他 session 在使用该机器，确认后删除条目
4. **每次 session 开始时**: 读取此文件了解当前可用机器
5. **获取新 token 后**: 更新 `token` 字段，其他 session 可以复用

### 常用操作

```bash
# 读取当前状态
cat ~/.claude/matpool_machines.json | python3 -m json.tool

# 获取新 token 并更新
TOKEN=$(curl -s -X POST "https://matpool.com/api/login" \
  -H "Content-Type: application/json" \
  -d '{"mobile": "19568732460", "password": "deepshape0929"}' \
  | python3 -c "import json,sys; print('Bearer ' + json.load(sys.stdin)['token'])")
# 然后更新 ~/.claude/matpool_machines.json 中的 token 字段
```

## 安全规则

1. **租用前必须确认**：告知用户费用估算，等待明确确认
2. **释放前必须确认**：先读取 matpool_machines.json 确认机器状态和任务，特别是包月机器绝不能释放
3. **PxNN0r (ID 1831057) 永远不释放**，除非用户三次明确确认
4. Token 过期后用 API 登录获取新 token（`POST /api/login`），不要用过期 token 反复重试
5. **释放前检查**: 先 SSH 到机器确认没有正在运行的训练进程（`ps aux | grep python`），再释放
