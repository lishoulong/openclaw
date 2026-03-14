# OpenClaw 多 Agent 调度方案

基于 Hub-and-Spoke 架构的多 Agent 团队协作系统，提供稳定性保障、人机协作和灵活的角色模型路由。

## 特性

- 🏗️ **团队管理**: 创建、配置、销毁多 Agent 团队
- 🔄 **协调模式**: 支持 Hub-and-Spoke 和 Mesh 两种协调模式
- 💓 **心跳监控**: 自动检测 Agent 健康状态
- 🛡️ **故障恢复**: 自动重试、死信队列、人工介入
- 👥 **人机协作**: 计划审批、Hooks 机制、任务干预
- 🤖 **模型路由**: 基于角色自动选择最优模型
- 📝 **自然语言**: 支持自然语言创建团队

## 快速开始

### 创建团队

```typescript
import { TeamManager } from './team/index.js';

const manager = new TeamManager();

// 从配置文件创建
const result = await manager.createTeamFromConfig('./team-config.yaml');
if (result.success) {
  console.log('团队创建成功:', result.data.teamId);
}
```

### YAML 配置示例

```yaml
team:
  id: auth-refactor-team
  task: 重构认证模块，提升安全性和可维护性
  coordinationMode: hub-and-spoke

  planApproval:
    enabled: true
    rules:
      - 必须包含单元测试
      - 不能修改数据库 Schema

  lead:
    model: gpt-4o
    systemPrompt: |
      你是团队负责人，负责：
      1. 将任务分解为可执行的子任务
      2. 协调团队成员
      3. 汇总最终成果

  members:
    - id: planner
      role: planning
      model: claude-3-5-sonnet
      task: 分析现有代码，制定重构计划

    - id: coder
      role: coding
      model: claude-3-5-sonnet
      task: 执行重构，编写代码

    - id: reviewer
      role: review
      model: claude-3-5-sonnet
      task: 代码审查，确保安全性和质量

  sharedWorkspace: ~/.openclaw/workspace/teams/auth-refactor

  recovery:
    heartbeatInterval: 30000
    maxRetries: 3
    autoRecover: true
```

### 使用协调器

```typescript
import { createCoordinator, SharedStateManager } from './team/index.js';

const coordinator = createCoordinator({
  teamId: 'my-team',
  mode: 'hub-and-spoke',
  assignmentStrategy: 'round-robin',
}, stateManager);

// 创建任务
const task = await coordinator.createTask('实现 API', '开发用户 API');

// 分配任务
await coordinator.assignTask(task.taskId, 'coder-1');

// 提交结果
await coordinator.submitTaskResult('coder-1', task.taskId, {
  status: 'completed',
  output: 'API 实现完成',
});

// 汇总结果
const summary = await coordinator.aggregateResults();
```

### 心跳监控

```typescript
import { HeartbeatMonitor } from './team/index.js';

const monitor = new HeartbeatMonitor({
  intervalMs: 30000,
  timeoutMs: 120000,
  maxRetries: 3,
  autoRecover: true,
});

// 开始监控
await monitor.startMonitoring(agentId, sessionId, workspacePath, teamId);

// Agent 上报状态
await monitor.reportStatus(agentId, 'working', 'task-name', 50, 'output');
```

### 计划审批

```typescript
import { configureApproval, createExecutionPlan, submitForApproval } from './team/index.js';

// 配置审批
configureApproval({
  enabled: true,
  autoApprove: false,
});

// 创建计划
const plan = createExecutionPlan('重构计划', '认证模块重构', [
  { id: 'step-1', title: '分析现有代码', assignee: 'planner' },
  { id: 'step-2', title: '实施重构', assignee: 'coder' },
]);

// 提交审批
const request = await submitForApproval(teamId, leadId, 'lead', plan);

// 批准/拒绝
await approvePlan(request.requestId, userId, '批准执行');
// await rejectPlan(request.requestId, userId, '需要修改');
```

## 架构

```
src/team/
├── types.ts              # 类型定义
├── team-state.ts         # 状态管理
├── team-manager.ts       # 团队管理器
├── team-store.ts         # 团队存储
├── config-parser.ts      # 配置解析
├── workspace-init.ts     # 工作区初始化
├── coordinator.ts        # Hub-and-Spoke 协调器
├── shared-state.ts       # 共享状态管理
├── heartbeat-monitor.ts  # 心跳监控
├── heartbeat-file.ts     # 心跳文件管理
├── recovery-manager.ts   # 恢复管理器
├── dead-letter-queue.ts  # 死信队列
├── plan-approval.ts      # 计划审批
├── hooks-manager.ts      # Hooks 管理
├── model-router.ts       # 模型路由
├── nl-parser.ts          # 自然语言解析
└── index.ts              # 入口导出
```

## 开发

### 安装依赖

```bash
pnpm install
```

### 运行测试

```bash
# 运行所有测试
pnpm test

# 运行团队模块测试
pnpm vitest run test/team/

# 监视模式
pnpm vitest watch test/team/
```

### 代码检查

```bash
pnpm lint
pnpm typecheck
```

## 模块说明

### TeamManager
团队生命周期管理：创建、销毁、暂停、恢复、成员管理

### Coordinator
任务协调：分配、执行、结果汇总。支持 round-robin、least-loaded、role-based 分配策略

### HeartbeatMonitor
健康监控：心跳检测、超时处理、状态回调

### RecoveryManager
故障恢复：重试机制、退避策略、状态流转、死信队列

### PlanApproval
人机协作：计划审批、审批流程、用户通知

### HooksManager
事件系统：agent:idle、agent:completed、agent:stuck、team:sync

### ModelRouter
智能路由：角色-模型映射、回退链、用户覆盖

### SharedStateManager
状态同步：coordinator.md、summary.md、任务列表管理

## License

MIT
