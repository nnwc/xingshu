# 星枢前端 · Xingshu Web

星枢前端是项目的 Web 管理界面，负责承载任务配置、脚本管理、变量管理、日志查看与系统设置等交互功能。

它基于 **React + TypeScript + Vite + Arco Design** 构建，目标是提供一个：

- 界面直观
- 中文友好
- 适合管理面板场景
- 同时兼顾桌面端与移动端体验

的前端控制台。

---

## 技术栈

- **React 18** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **Arco Design** - UI 组件库
- **React Router 6** - 路由管理
- **Zustand** - 状态管理
- **Axios** - HTTP 请求封装

---

## 主要功能

前端目前主要承载这些页面能力：

- **仪表盘**
  - 任务统计
  - CPU / 内存信息
  - 最近执行日志

- **任务管理**
  - 定时任务 / 手动任务 / 开机任务
  - 选项式定时
  - 随机区间调度
  - Cron 高级模式

- **脚本管理**
  - 浏览脚本
  - 编辑脚本
  - 上传脚本
  - 执行脚本

- **环境变量**
  - 新增 / 编辑 / 删除
  - 启用 / 禁用
  - 标签与备注

- **依赖管理**
  - Python / Node.js / Linux 依赖的管理入口

- **日志查看**
  - 执行日志
  - 实时日志
  - 系统日志 / 登录日志

- **系统配置**
  - 基础配置
  - 备份相关配置
  - 运行设置

---

## 本地开发

### 安装依赖

```bash
npm install
```

### 启动开发模式

```bash
npm run dev
```

默认访问：

```text
http://localhost:5173
```

---

## 生产构建

```bash
npm run build
```

构建产物输出到：

```text
dist/
```

如需本地预览生产构建：

```bash
npm run preview
```

---

## 目录结构

```text
src/
├── api/              # API 接口封装
├── assets/           # 静态资源
├── components/       # 公共组件
├── layouts/          # 布局组件
├── pages/            # 页面级功能
├── router/           # 路由配置
├── stores/           # 状态管理
├── types/            # 类型定义
├── utils/            # 请求与工具函数
├── App.tsx           # 根组件
└── main.tsx          # 入口文件
```

---

## 与后端的对接方式

前端通过 `/api` 调用后端接口。开发模式下通常通过 Vite 代理到后端服务：

```ts
proxy: {
  '/api': {
    target: 'http://localhost:3000',
    changeOrigin: true,
  },
}
```

生产环境下，通常有两种方案：

1. 后端直接托管前端构建产物
2. 使用 Nginx 等反向代理，将 `/api` 转发到后端

---

## 部署建议

如果单容器部署，通常由后端直接托管 `web/dist`。  
如果前后端分离部署，则可以把 `dist` 部署到任意静态文件服务器。

### Nginx 示例

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /path/to/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 设计目标

星枢前端并不追求“花哨的大而全后台模板”，而是更强调：

- 管理动作足够直接
- 常用操作尽量少跳转
- 运维类信息展示清晰
- 在小屏设备上也能完成基础操作

---

## 后续方向

后续前端会继续朝这些方向优化：

- 更统一的品牌风格
- 更完整的深色终端感视觉语言
- 更清晰的任务状态展示
- 更顺滑的日志与执行反馈
- 更稳定的移动端适配
