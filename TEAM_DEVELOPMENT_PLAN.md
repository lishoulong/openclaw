# OpenClaw 多 Agent 调度方案 - 开发任务规划

## 项目概述
基于设计文档实现 OpenClaw 的多 Agent 调度方案，引入 Team 概念、稳定性保障和人机协作机制。

## 开发阶段

### 阶段一：基础框架（Phase 1: Core Framework）
**目标**: 建立 Team 概念和基本协调能力

#### 1.1 数据模型设计
- [ ] Team 接口定义 (`src/team/types.ts`)
- [ ] Agent 配置接口 (`src/team/agent-config.ts`)
- [ ] 团队状态枚举 (`src/team/team-state.ts`)

#### 1.2 Team Manager 核心实现
- [ ] TeamManager 类 (`src/team/team-manager.ts`)
  - 创建团队
  - 销毁团队
  - 成员管理
  - 列表查询
- [ ] Team 存储 (`src/team/team-store.ts`)
- [ ] YAML 配置解析 (`src/team/config-parser.ts`)

#### 1.3 团队工作区目录结构
- [ ] 工作区初始化 (`src/team/workspace-init.ts`)
- [ ] 目录结构创建
  - `teams/{teamId}/manifest.json`
  - `teams/{teamId}/coordinator.md`
  - `teams/{teamId}/summary.md`
  - `teams/{teamId}/mailbox/`
  - `teams/{teamId}/tasks/`
  - `teams/{teamId}/agents/`

#### 1.4 基础 Hub-and-Spoke 协调
- [ ] Coordinator 实现 (`src/team/coordinator.ts`)
- [ ] 任务分配逻辑
- [ ] 结果汇总逻辑

#### 1.5 sessions_spawn 增强
- [ ] 扩展 SpawnSubagentParams 接口
  - `role` 参数
  - `teamId` 参数
  - `requiresApproval` 参数

### 阶段二：稳定性提升（Phase 2: Stability）
**目标**: 引入心跳监控和自动恢复机制

#### 2.1 心跳监控模块
- [ ] HeartbeatMonitor 类 (`src/team/heartbeat-monitor.ts`)
  - 心跳检测逻辑
  - 超时处理
- [ ] 心跳文件管理 (`src/team/heartbeat-file.ts`)
- [ ] 状态流转实现

#### 2.2 自动恢复策略
- [ ] RecoveryManager 类 (`src/team/recovery-manager.ts`)
- [ ] 重试机制
- [ ] 退避策略

#### 2.3 死信队列
- [ ] DeadLetterQueue 实现 (`src/team/dead-letter-queue.ts`)
- [ ] 失败任务存储
- [ ] 人工介入接口

#### 2.4 健康检查 API
- [ ] 健康检查端点
- [ ] 状态报告

### 阶段三：人机协作（Phase 3: Human-in-the-loop）
**目标**: 实现分层控制模型

#### 3.1 计划审批机制
- [ ] PlanApproval 类 (`src/team/plan-approval.ts`)
- [ ] 审批流程实现
- [ ] 用户通知机制

#### 3.2 Hooks 系统
- [ ] Hooks 管理器 (`src/team/hooks-manager.ts`)
- [ ] 钩子类型实现
  - `agent:idle`
  - `agent:completed`
  - `agent:stuck`
  - `team:sync`

#### 3.3 任务分配干预
- [ ] 干预接口
- [ ] 重新分配逻辑

### 阶段四：高级功能（Phase 4: Advanced Features）
**目标**: 支持自然语言创建和模型路由

#### 4.1 自然语言团队创建
- [ ] 自然语言解析器 (`src/team/nl-parser.ts`)
- [ ] 意图识别

#### 4.2 角色驱动模型路由
- [ ] ModelRouter 类 (`src/team/model-router.ts`)
- [ ] 角色-模型映射配置
- [ ] 回退链实现

#### 4.3 Mesh 协调模式
- [ ] MeshCoordinator 实现 (`src/team/mesh-coordinator.ts`)
- [ ] 点对点通信

#### 4.4 Team 子命令
- [ ] CLI 命令实现
  - `openclaw team create`
  - `openclaw team list`
  - `openclaw team status`
  - `openclaw team pause/resume/destroy`
  - `openclaw team member add/remove/list`

### 阶段五：测试与文档（Phase 5: Testing & Documentation）
**目标**: 确保代码质量和文档完整

#### 5.1 单元测试
- [ ] TeamManager 测试
- [ ] HeartbeatMonitor 测试
- [ ] RecoveryManager 测试
- [ ] Coordinator 测试

#### 5.2 集成测试
- [ ] 端到端团队协作测试
- [ ] 故障恢复测试

#### 5.3 文档
- [ ] API 文档
- [ ] 使用指南
- [ ] 架构文档

## 技术规范

### 目录结构
```
src/team/
├── index.ts                 # 入口导出
├── types.ts                 # 类型定义
├── team-manager.ts          # 团队管理器
├── team-store.ts            # 团队存储
├── config-parser.ts         # 配置解析
├── workspace-init.ts        # 工作区初始化
├── coordinator.ts           # Hub-and-Spoke 协调器
├── mesh-coordinator.ts      # Mesh 协调器
├── heartbeat-monitor.ts     # 心跳监控
├── heartbeat-file.ts        # 心跳文件
├── recovery-manager.ts      # 恢复管理器
├── dead-letter-queue.ts     # 死信队列
├── plan-approval.ts         # 计划审批
├── hooks-manager.ts         # Hooks 管理
├── model-router.ts          # 模型路由
├── nl-parser.ts             # 自然语言解析
└── cli/                     # CLI 命令
    ├── create.ts
    ├── list.ts
    ├── status.ts
    ├── pause.ts
    ├── resume.ts
    ├── destroy.ts
    └── member.ts
```

### 接口定义
```typescript
// Team 配置
interface TeamConfig {
  teamId: string;
  task: string;
  coordinationMode: 'hub-and-spoke' | 'mesh';
  lead?: AgentConfig;
  members: AgentConfig[];
  sharedWorkspace: string;
  planApproval?: PlanApprovalConfig;
  recovery?: RecoveryConfig;
}

// Agent 配置
interface AgentConfig {
  agentId: string;
  role: 'lead' | 'planning' | 'coding' | 'review' | 'testing' | 'custom';
  model?: string;
  systemPrompt?: string;
  requiresApproval?: boolean;
}

// 心跳配置
interface HeartbeatConfig {
  intervalMs: number;
  timeoutMs: number;
  maxRetries: number;
  backoffMultiplier: number;
}
```

## 开发顺序

### 第1周：基础框架
1. 技术经理：设计数据模型和接口
2. 后端开发1：实现 TeamManager 和存储
3. 后端开发2：实现工作区初始化和基础协调

### 第2周：稳定性
1. 后端开发3：实现心跳监控
2. 后端开发4：实现恢复管理器和死信队列
3. 测试人员：编写稳定性测试

### 第3周：人机协作
1. 后端开发1：实现计划审批
2. 后端开发2：实现 Hooks 系统
3. 前端开发：CLI 命令界面

### 第4周：高级功能
1. 后端开发3：模型路由和自然语言解析
2. 后端开发4：Mesh 协调模式
3. 技术经理：代码审查和集成

### 第5周：测试与优化
1. 测试人员：全面测试
2. 全体开发：Bug 修复
3. 技术经理：性能优化

## 依赖关系

```
[Data Models] -> [TeamManager] -> [Coordinator]
     |                |                 |
     v                v                 v
[Workspace]    [Heartbeat] -> [Recovery]
     |                |
     v                v
[Shared State]  [Plan Approval] -> [Hooks]
     |                |
     v                v
[CLI Commands]  [Model Router]
```
