import request from '@/utils/request';

export interface LoginLog {
  id: number;
  username: string;
  ip_address: string;
  created_at: string;
}

export interface LoginLogListResponse {
  data: LoginLog[];
  total: number;
  page: number;
  page_size: number;
}

export const loginLogApi = {
  list: (page = 1, pageSize = 20) =>
    request.get<LoginLogListResponse>('/login-logs', { params: { page, page_size: pageSize } }),
};
