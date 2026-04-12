# 星枢（Xingshu）架构说明

## 1. 项目定位

星枢是一个面向 **脚本执行、任务调度、环境变量管理、日志追踪与自托管运维** 的管理面板。

它的核心目标不是做“重型平台”，而是提供一套：

- 足够轻量
- 易于部署
- 界面直观
- 适合中文用户
- 同时支持 Docker 和本地二进制运行

的日常运维入口。

适合场景包括：

- 个人 VPS
- 家庭实验室 / NAS
- 小型自托管服务集群
- 自动化脚本与定时任务集中管理

---

## 2. 整体架构

星枢采用 **前后端分离** 架构：

- **前端**：React + TypeScript + Vite
- **后端**：Rust + Axum
- **数据库**：SQLite
- **调度系统**：基于 tokio 与 tokio-cron-scheduler
- **部署方式**：Docker / Docker Compose / 本地二进制

架构分层如下：

```text
Browser
  ↓
React Frontend (web)
  ↓ HTTP / SSE
Axum API Server (src/api)
  ↓
Services Layer (src/services)
  ↓
Models / DB / Scheduler
  ↓
SQLite + Scripts + Logs + Runtime State
```

---

## 3. 目录结构

```text
xingshu/
├── src/                    # Rust 后端源码
│   ├── api/               # HTTP API 路由与处理器
│   ├── middleware/        # 认证等中间件
│   ├── models/            # 数据模型与数据库初始化
│   ├── scheduler/         # 定时调度、订阅调度、备份调度
│   ├── services/          # 业务逻辑层
│   ├── utils/             # 工具函数
│   └── main.rs            # 服务入口
├── web/                   # React 前端
│   ├── public/            # favicon 等静态资源
│   ├── src/
│   │   ├── api/          # 前端 API 封装
│   │   ├── components/   # 公共组件
│   │   ├── layouts/      # 布局组件
│   │   ├── pages/        # 页面级功能
│   │   ├── router/       # 路由配置
│   │   ├── stores/       # 状态管理
│   │   ├── types/        # TS 类型定义
│   │   └── utils/        # 请求与工具函数
│   └── package.json
├── data/                  # 运行时数据目录
│   ├── app.db            # SQLite 数据库
│   └── scripts/          # 脚本目录
├── logs/                  # 日志目录
├── Dockerfile
├── docker-compose.yml
└── Cargo.toml
```

---

## 4. 后端架构

### 4.1 入口与启动流程

后端入口位于：

- `src/main.rs`

启动流程大致为：

1. 初始化日志系统
2. 读取运行目录与配置
3. 初始化数据库
4. 初始化各类 service
5. 启动任务调度器 / 订阅调度器 / 备份调度器
6. 启动日志清理任务
7. 创建 Axum Router
8. 提供 API 与静态前端入口

后端默认监听：

```text
0.0.0.0:3000
```

---

### 4.2 API 层

API 路由位于：

- `src/api/mod.rs`

主要模块包括：

- `task`：任务管理
- `task_group`：任务分组
- `log`：执行日志
- `script`：脚本管理
- `env`：环境变量
- `dependence`：依赖管理
- `subscription`：订阅管理
- `config`：系统配置
- `auth`：登录认证
- `backup`：备份相关
- `system` / `system_log`：系统信息与系统日志
- `login_log`：登录日志
- `terminal`：终端能力（非 Android）

API 层职责：

- 接收请求
- 参数解析
- 调用 service
- 返回 JSON / SSE / 静态内容

---

### 4.3 Service 层

Service 层位于：

- `src/services/`

这是星枢的业务核心层，负责：

- 数据读写
- 任务执行
- 环境变量处理
- 日志落库
- 认证逻辑
- 配置加载
- 订阅更新
- 备份操作

常见服务包括：

- `TaskService`
- `LogService`
- `EnvService`
- `ScriptService`
- `DependenceService`
- `ConfigService`
- `SubscriptionService`
- `AuthService`
- `Executor`
- `TotpService`

其中：

### `Executor`
负责真正执行任务命令，包括：

- 启动进程
- 收集输出
- 维护运行中任务状态
- 支持终止执行
- 支持流式日志

---

### 4.4 调度系统

调度位于：

- `src/scheduler/`

当前包含：

- `Scheduler`：主任务调度器
- `SubscriptionScheduler`：订阅调度器
- `BackupScheduler`：自动备份调度器

任务调度支持：

- 传统 Cron 表达式
- 选项式定时（每 xx 秒 / 分钟 / 小时 / 天 / 周 / 年）
- 随机区间调度（例如 15~20 分钟随机运行）
- 立即执行
- 开机启动任务

调度逻辑会配合数据库中的：

- `last_run_at`
- `last_run_duration`
- `next_run_at`

来更新任务执行状态。

---

### 4.5 数据模型与数据库

数据模型位于：

- `src/models/`

数据库初始化位于：

- `src/models/db.rs`

当前主要使用 **SQLite**，适合单机自托管场景。  
数据库中核心表包括：

- `tasks`：任务
- `task_groups`：任务分组
- `logs`：执行日志
- `env_vars`：环境变量
- `dependences`：依赖记录
- `subscriptions`：订阅配置
- `system_configs`：系统配置
- `users`：用户
- `login_logs`：登录日志

数据库特点：

- WAL 模式
- 自动迁移式 `ALTER TABLE` 补字段
- 轻量，部署简单
- 适合和 Docker volume 一起保存

---

## 5. 前端架构

前端位于：

- `web/`

技术栈：

- React
- TypeScript
- Vite
- Arco Design
- React Router
- Axios

### 5.1 页面结构

主要页面包括：

- 仪表盘
- 任务管理
- 脚本管理
- 环境变量
- 依赖管理
- 订阅管理
- 执行日志
- 系统配置
- 登录页 / 初始化页

### 5.2 前端职责

前端主要负责：

- 展示任务与系统状态
- 表单配置任务、变量、依赖、订阅
- 调用 API
- 展示执行日志
- 处理交互与响应式布局

### 5.3 静态资源

前端构建产物输出到：

```text
web/dist
```

后端会直接托管这部分静态文件，并在非 `/api/*` 路径下回退到 `index.html`，用于 SPA 路由。

---

## 6. 日志与运行状态

星枢包含多层日志：

### 6.1 系统日志

由 Rust tracing 体系输出：

- 控制台日志
- 文件日志（按天滚动）
- 内存收集的系统日志

### 6.2 任务执行日志

每次任务执行会记录：

- 输出内容
- 执行状态
- 耗时
- 执行时间

### 6.3 登录日志

用于记录：

- 用户名
- IP 地址
- 登录时间

---

## 7. 认证与安全

当前项目包含：

- JWT 登录认证
- 中间件鉴权
- 登录日志记录
- TOTP 能力
- Webhook 独立鉴权

当前定位仍偏向：

- 单用户 / 自托管
- 受信环境内部使用

如果未来继续演进，可以增强：

- 多用户 / RBAC
- 更细粒度权限控制
- 更完整的审计能力

---

## 8. 部署架构

### 8.1 Docker 部署

推荐部署方式：

- 镜像运行星枢服务
- 挂载 `/app/data`
- 暴露 `3000` 端口
- 使用反向代理绑定域名

### 8.2 本地二进制部署

适合：

- 本地调试
- 小规模环境
- 快速验证

### 8.3 GHCR + GitHub Actions

项目已支持：

- push 到 `main` 自动构建 Docker 镜像
- 推送到 `ghcr.io/nnwc/XingShu`

这让发布链路可以收敛为：

```text
代码变更 → GitHub Actions → GHCR 镜像 → 服务器拉取更新
```

---

## 9. 当前架构特点

### 优点

- Rust 后端性能与稳定性较好
- SQLite 部署简单
- Docker 友好
- 前后端职责清晰
- 适合个人和轻量自托管场景

### 当前取舍

- 更偏单机 / 单实例
- 更偏个人运维而非团队协作平台
- 优先轻量和可部署性，而不是复杂企业功能

---

## 10. 后续演进方向

后续可以继续完善：

- 更丰富的任务运行状态展示
- 更清晰的变量体系（全局变量 / 独立变量）
- 更稳定的日志流与执行可视化
- 更统一的品牌与设计语言
- 更顺滑的自动更新与镜像发布流程
- 更完善的权限模型

---

## 11. 总结

星枢的架构目标很明确：

> 用一套足够轻量、足够稳定、足够直观的前后端架构，承载个人自托管环境中的脚本、任务与运维操作。

它不是为了做最重的平台，而是为了做一套真正**能部署、能用、能维护**的日常运维面板。
