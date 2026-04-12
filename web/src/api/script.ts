import request from '@/utils/request';
import type { Script } from '@/types';

export const scriptApi = {
  // 获取脚本列表
  list: () => request.get<Script[]>('/scripts'),

  // 获取脚本内容
  get: (path: string) => request.get(`/scripts/${path}`),

  // 更新脚本
  update: (path: string, content: string) =>
    request.put(`/scripts/${path}`, { content }),

  // 删除脚本
  delete: (path: string) => request.delete(`/scripts/${path}`),

  // 上传脚本
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request.post('/scripts', formData);
  },

  // 创建目录
  createDirectory: (path: string) =>
    request.post(`/scripts/directories/${path}`),

  // 执行脚本
  execute: (path: string) => request.get(`/scripts/execute/${path}`),

  // 调试执行
  debug: (content: string, type: string) =>
    request.post('/scripts/debug', { content, type }),
};
