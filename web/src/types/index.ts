// 任务类型
export interface Task {
  id: number;
  name: string;
  command: string;
  cron: string | string[]; // 支持单个或多个 cron 表达式
  type: 'cron' | 'manual' | 'startup';
  enabled: boolean;
  notify_enabled?: boolean;
  notify_channel?: string;
  notify_events?: Array<'success' | 'failed' | 'timeout'>;
  notify_attach_log?: boolean;
  notify_log_limit?: number;
  notify_log_mode?: 'full' | 'summary';
  env?: string;
  pre_command?: string;
  post_command?: string;
  group_id?: number;
  working_dir?: string;
  account_run_mode?: 'single' | 'sequential' | 'concurrent';
  account_env_key?: string;
  account_split_delimiter?: string;
  account_concurrency?: number;
  schedule_mode?: 'cron' | 'preset' | 'random_interval';
  schedule_config?: {
    interval_value?: number;
    interval_unit?: 'second' | 'minute' | 'hour' | 'day' | 'week' | 'year';
    min_value?: number;
    max_value?: number;
    unit?: 'second' | 'minute' | 'hour' | 'day' | 'week' | 'year';
  };
  use_microwarp?: boolean;
  microwarp_switch_ip_on_run?: boolean;
  last_run_at?: string;
  last_run_duration?: number;
  next_run_at?: string;
  created_at: string;
  updated_at: string;
}

// 脚本类型
export interface Script {
  name: string;
  path: string;
  size: number;
  modified: string;
  is_dir: boolean;
}

// 环境变量类型
export interface EnvVar {
  id: number;
  key: string;
  value: string;
  remark?: string;
  tag?: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// 依赖类型
export interface Dependence {
  id: number;
  name: string;
  dep_type: number; // 0: nodejs, 1: python, 2: linux
  status: number; // 0: installing, 1: installed, 2: failed, 3: removing, 4: removed
  log?: string; // JSON格式的日志数组
  remark?: string;
  created_at: string;
  updated_at: string;
}

// 订阅类型
export interface Subscription {
  id: number;
  name: string;
  url: string;
  branch: string;
  schedule: string;
  enabled: boolean;
  last_run_time?: string;
  last_run_status?: string;
  last_run_log?: string;
  created_at: string;
  updated_at: string;
}

// 日志类型
export interface Log {
  id: number;
  task_id: number;
  output?: string; // 列表接口不返回，详情接口才返回
  status: string;
  duration?: number; // 执行耗时（毫秒）
  created_at: string;
}

// 任务分组类型
export interface TaskGroup {
  id: number;
  name: string;
  description?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// 执行记录类型
export interface Execution {
  execution_id: string;
  task_id: number;
  task_name: string;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
}

// 用户类型
export interface User {
  username: string;
  token: string;
}

// API响应类型
export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  message?: string;
}
