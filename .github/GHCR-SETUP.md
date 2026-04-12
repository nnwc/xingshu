# GitHub Actions / GHCR 使用说明

这个仓库已经配置好：

- push 到 `main` → 自动构建并推送 Docker 镜像
- 打 `v*` tag → 自动构建并推送对应 tag 镜像
- 支持手动触发 workflow_dispatch

## 镜像地址

默认推送到：

```text
ghcr.io/<owner>/<repo>:latest
```

例如仓库是：

```text
https://github.com/yourname/xingshu
```

镜像就是：

```text
ghcr.io/yourname/xingshu:latest
```

## GitHub 仓库需要开启的设置

进入仓库：

- Settings → Actions → General
- Workflow permissions → 选择 **Read and write permissions**
- 勾选 **Allow GitHub Actions to create and approve pull requests**（可选）

## 首次使用步骤

### 1. 换成你自己的仓库远程地址

```bash
git remote remove origin
git remote add origin https://github.com/<yourname>/<repo>.git
```

### 2. 推送代码

```bash
git branch -M main
git add .
git commit -m "feat: prepare github actions"
git push -u origin main
```

### 3. 查看 Actions

推送后去 GitHub 仓库页面：

- Actions
- 找到 `Build and Push Docker Image`

成功后会自动生成 GHCR 镜像。

## 常用发布方式

### 日常更新

```bash
git add .
git commit -m "feat: update xingshu"
git push
```

会生成：

- `ghcr.io/<owner>/<repo>:latest`
- `ghcr.io/<owner>/<repo>:sha-xxxxxxx`

### 版本发布

```bash
git tag v1.0.0
git push origin v1.0.0
```

会额外生成：

- `ghcr.io/<owner>/<repo>:v1.0.0`

## 服务器拉取更新

```bash
docker pull ghcr.io/<owner>/<repo>:latest
```
