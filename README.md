# 星枢 · Xingshu

<div align="center">

轻量、直观、适合中文用户的 **脚本执行与任务调度控制台**

**当前版本：v1.5.0**

适用于：
**个人服务器 / 家庭实验室 / VPS / 自托管工具集 / 自动化运维场景**

</div>

---

## 项目简介

星枢（Xingshu）是一个基于 **Rust + React** 构建的可视化任务与脚本管理面板，面向需要统一管理：

- 定时任务
- 手动运维任务
- 启动任务
- 环境变量
- 脚本文件
- 执行日志
- 通知推送

的自托管用户。

相比直接维护 crontab、零散 shell 脚本和环境变量文件，星枢提供了一套更直观、更适合长期维护的中文界面。

---

## 1.5.0 版本亮点

### 任务管理增强
- 支持任务多选与批量操作
- 更适合移动端的任务管理布局
- 任务编辑体验优化

### 日志管理增强
- 支持按天数 / 全局总数 / 每脚本数量三套独立清理策略
- 日志推送支持 `full / summary`
- 日志查看与分页体验优化

### 订阅与导入增强
- 订阅后自动扫描并导入 `_Loader.py / _Loader.js / _Loader.sh`
- 自动命名为 `GitHub用户名-文件名`
- 自动按 GitHub 用户分组

### MicroWARP 集成
- 系统配置中可统一配置 MicroWARP
- 任务级可选启用
- 支持运行前切换 IP
- 日志中记录 MicroWARP 切换过程

### 脚本管理修复
- 修复脚本管理中部分路径/中文路径保存问题
- 改善脚本运行日志的实时同步体验

---

## 核心功能

### 任务管理
支持三类任务：

- **定时任务**
- **手动任务**
- **开机任务**

支持配置：

- 执行命令
- 工作目录
- 前置 / 后置命令
- 分组
- 启用 / 禁用
- 账号运行模式（single / sequential / concurrent）

### 脚本管理
- 浏览脚本目录
- 新建 / 编辑 / 上传脚本
- 直接运行脚本
- 调试运行
- 查看执行日志

### 环境变量管理
- 新增 / 编辑 / 删除变量
- 启用 / 禁用
- 标签与备注
- 统一给任务 / 脚本使用

### 日志与通知
- 任务执行日志
- 系统日志
- 登录日志
- Webhook / Telegram 等通知渠道
- 日志推送 `full / summary` 模式

### 订阅与依赖
- 订阅仓库自动同步
- 自动导入 Loader 脚本
- 依赖管理与安装

### MicroWARP
- 系统级配置代理能力
- 任务级启用
- 可记录切换与出口 IP 相关日志
- 支持和账号轮询场景联动

---

## 快速开始

### Docker 方式（推荐）

```bash
docker run -d \
  --name xingshu \
  --restart unless-stopped \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e TZ=Asia/Shanghai \
  ghcr.io/nnwc/XingShu:latest
```

访问：

```text
http://你的服务器IP:3000
```

---

## Docker Compose

```yaml
services:
  xingshu:
    image: ghcr.io/nnwc/XingShu:latest
    container_name: xingshu
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - DATABASE_URL=sqlite:///app/data/db/xingshu.db
      - RUST_LOG=info
      - TZ=Asia/Shanghai
    restart: unless-stopped
```

启动：

```bash
docker compose up -d
```

---

## 适用场景

星枢适合：

- VPS 定时任务面板
- 家庭服务器脚本调度中心
- 自托管服务自动维护入口
- 多脚本统一管理
- 需要中文界面的轻量运维面板

---

## 技术栈

### 后端
- Rust
- Axum
- SQLx
- SQLite
- tokio-cron-scheduler

### 前端
- React
- TypeScript
- Vite
- Arco Design

---

## 说明

- 项目面向 **服务端 / 自托管场景**
- 建议配合 Docker 使用
- 部分网络能力（如代理 / MicroWARP）更适合 Linux 服务器环境

---

## License

MIT
