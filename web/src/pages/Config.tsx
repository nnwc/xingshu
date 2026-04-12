import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Button,
  Message,
  Space,
  Divider,
  Typography,
  Modal,
  Spin,
  Tabs,
  Grid,
  Switch,
  Table,
} from '@arco-design/web-react';
import { IconSave, IconDownload, IconUpload, IconRefresh, IconLink } from '@arco-design/web-react/icon';
import axios from 'axios';
import TotpSettings from '@/components/TotpSettings';
import { getSystemLogs, type SystemLogEntry } from '@/api/systemLog';
import { authApi } from '@/api/auth';
import { loginLogApi, type LoginLog } from '@/api/loginLog';
import dayjs from 'dayjs';
import './Config.css';

const FormItem = Form.Item;
const { Title, Text } = Typography;
const TabPane = Tabs.TabPane;
const { Row, Col } = Grid;

interface DiskInfo {
  name: string;
  mount_point: string;
  total_space: number;
  available_space: number;
  used_space: number;
  usage_percent: number;
}

interface SystemInfo {
  cpu_usage: number;
  memory_total: number;
  memory_used: number;
  memory_available: number;
  memory_usage_percent: number;
  disks: DiskInfo[];
  start_time: number;
  uptime_seconds: number;
}

interface MicroWarpStatus {
  enabled: boolean;
  running: boolean;
  container_name: string;
  current_ip?: string;
  proxy_url: string;
  switch_mode: string;
  auto_switch_enabled: boolean;
  auto_switch_interval_minutes: number;
}

const Config: React.FC = () => {
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [saveLoading, setSaveLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [saveConcurrencyLoading, setSaveConcurrencyLoading] = useState(false);
  const [saveDelimiterLoading, setSaveDelimiterLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [logRetentionDaysEnabled, setLogRetentionDaysEnabled] = useState(true);
  const [logRetentionDays, setLogRetentionDays] = useState(30);
  const [logTotalLimitEnabled, setLogTotalLimitEnabled] = useState(true);
  const [logMaxCount, setLogMaxCount] = useState(5);
  const [logPerTaskLimitEnabled, setLogPerTaskLimitEnabled] = useState(false);
  const [logPerTaskLimit, setLogPerTaskLimit] = useState(20);
  const [maxAccountConcurrency, setMaxAccountConcurrency] = useState(3);
  const [defaultAccountSplitDelimiter, setDefaultAccountSplitDelimiter] = useState('@');
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('mirror');
  const [microWarpForm] = Form.useForm();
  const [microWarpLoading, setMicroWarpLoading] = useState(false);
  const [microWarpSwitchLoading, setMicroWarpSwitchLoading] = useState(false);
  const [microWarpStatus, setMicroWarpStatus] = useState<MicroWarpStatus | null>(null);
  const [microWarpStatusLoading, setMicroWarpStatusLoading] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [systemInfoLoading, setSystemInfoLoading] = useState(false);
  const [currentUptime, setCurrentUptime] = useState<number>(0);
  const [autoBackupForm] = Form.useForm();
  const [autoBackupLoading, setAutoBackupLoading] = useState(false);
  const [testConnectionLoading, setTestConnectionLoading] = useState(false);
  const [backupNowLoading, setBackupNowLoading] = useState(false);
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([]);
  const [systemLogsLoading, setSystemLogsLoading] = useState(false);
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);
  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);
  const [loginLogsLoading, setLoginLogsLoading] = useState(false);
  const [loginLogsPagination, setLoginLogsPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0,
  });
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const appVersion = useMemo(() => 'v1.5.0', []);
  const appUpdatedAt = useMemo(() => '2026/04/09', []);
  const restoreFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    loadConfig();
    loadLogRetentionConfig();
    loadAccountRunnerConfig();
    loadAutoBackupConfig();
    loadMicroWarpConfig();
    loadMicroWarpStatus();
    if (activeTab === 'system') {
      loadSystemInfo();
    }
    if (activeTab === 'systemlogs') {
      loadSystemLogs();
      // 启动 SSE 连接
      const token = localStorage.getItem('token');
      const eventSource = new EventSource(`/api/system/logs/stream?token=${token}`);

      eventSource.onmessage = (event) => {
        try {
          const logs = JSON.parse(event.data);
          setSystemLogs(logs);
        } catch (error) {
          console.error('Failed to parse log data:', error);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
      };

      return () => {
        eventSource.close();
      };
    }
    if (activeTab === 'login-logs') {
      loadLoginLogs();
    }
  }, [activeTab, loginLogsPagination.current, loginLogsPagination.pageSize]);

  useEffect(() => {
    if (systemInfo && activeTab === 'system') {
      // 初始化当前运行时间
      setCurrentUptime(systemInfo.uptime_seconds);

      // 每秒更新运行时间
      const timer = setInterval(() => {
        setCurrentUptime(prev => prev + 1);
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [systemInfo, activeTab]);

  const loadConfig = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('/api/configs/mirror/config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      form.setFieldsValue(res.data);
    } catch (error: any) {
      Message.error('加载配置失败');
    }
  };

  const loadLogRetentionConfig = async () => {
    try {
      const token = localStorage.getItem('token');
      const [retentionEnabledRes, retentionRes, totalEnabledRes, totalRes, perTaskEnabledRes, perTaskRes] = await Promise.allSettled([
        axios.get('/api/configs/log_retention_days_enabled', { headers: { Authorization: `Bearer ${token}` } }),
        axios.get('/api/configs/log_retention_days', { headers: { Authorization: `Bearer ${token}` } }),
        axios.get('/api/configs/log_total_limit_enabled', { headers: { Authorization: `Bearer ${token}` } }),
        axios.get('/api/configs/log_total_limit', { headers: { Authorization: `Bearer ${token}` } }),
        axios.get('/api/configs/log_per_task_limit_enabled', { headers: { Authorization: `Bearer ${token}` } }),
        axios.get('/api/configs/log_per_task_limit', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      setLogRetentionDaysEnabled(retentionEnabledRes.status === 'fulfilled' ? retentionEnabledRes.value.data?.value !== 'false' : true);
      setLogRetentionDays(retentionRes.status === 'fulfilled' && retentionRes.value.data?.value ? parseInt(retentionRes.value.data.value) : 30);
      setLogTotalLimitEnabled(totalEnabledRes.status === 'fulfilled' ? totalEnabledRes.value.data?.value !== 'false' : true);
      setLogMaxCount(totalRes.status === 'fulfilled' && totalRes.value.data?.value ? parseInt(totalRes.value.data.value) : 5);
      setLogPerTaskLimitEnabled(perTaskEnabledRes.status === 'fulfilled' ? perTaskEnabledRes.value.data?.value === 'true' : false);
      setLogPerTaskLimit(perTaskRes.status === 'fulfilled' && perTaskRes.value.data?.value ? parseInt(perTaskRes.value.data.value) : 20);
    } catch (error) {
      setLogRetentionDaysEnabled(true);
      setLogRetentionDays(30);
      setLogTotalLimitEnabled(true);
      setLogMaxCount(5);
      setLogPerTaskLimitEnabled(false);
      setLogPerTaskLimit(20);
    }
  };

  const loadAccountRunnerConfig = async () => {
    try {
      const token = localStorage.getItem('token');
      const [maxConcurrencyRes, splitDelimiterRes] = await Promise.allSettled([
        axios.get('/api/configs/account_max_concurrency', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get('/api/configs/account_split_delimiter', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (maxConcurrencyRes.status === 'fulfilled' && maxConcurrencyRes.value.data?.value) {
        setMaxAccountConcurrency(parseInt(maxConcurrencyRes.value.data.value) || 3);
      } else {
        setMaxAccountConcurrency(3);
      }

      if (splitDelimiterRes.status === 'fulfilled' && splitDelimiterRes.value.data?.value) {
        setDefaultAccountSplitDelimiter(splitDelimiterRes.value.data.value || '@');
      } else {
        setDefaultAccountSplitDelimiter('@');
      }
    } catch (error) {
      setMaxAccountConcurrency(3);
      setDefaultAccountSplitDelimiter('@');
    }
  };

  const loadSystemInfo = async () => {
    setSystemInfoLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('/api/system/info', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSystemInfo(res.data);
    } catch (error: any) {
      Message.error('加载系统信息失败');
    } finally {
      setSystemInfoLoading(false);
    }
  };

  const loadMicroWarpStatus = async () => {
    try {
      setMicroWarpStatusLoading(true);
      const token = localStorage.getItem('token');
      const res = await axios.get('/api/configs/microwarp/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMicroWarpStatus(res.data);
    } catch (error) {
      setMicroWarpStatus(null);
    } finally {
      setMicroWarpStatusLoading(false);
    }
  };

  const loadMicroWarpConfig = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('/api/configs/microwarp/config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      microWarpForm.setFieldsValue({
        enabled: res.data?.enabled ?? false,
        switch_url: res.data?.switch_url ?? '',
        proxy_url: res.data?.proxy_url ?? '',
        ip_check_url: res.data?.ip_check_url ?? 'https://api.ipify.org',
        timeout_ms: res.data?.timeout_ms ?? 15000,
        auto_switch_enabled: res.data?.auto_switch_enabled ?? false,
        auto_switch_interval_minutes: res.data?.auto_switch_interval_minutes ?? 0,
        container_name: res.data?.container_name ?? 'microwarp',
        reset_config_on_switch: res.data?.reset_config_on_switch ?? false,
      });
    } catch (error) {
      microWarpForm.setFieldsValue({
        enabled: false,
        switch_url: '',
        proxy_url: '',
        ip_check_url: 'https://api.ipify.org',
        timeout_ms: 15000,
        auto_switch_enabled: false,
        auto_switch_interval_minutes: 0,
        container_name: 'microwarp',
        reset_config_on_switch: false,
      });
    }
  };

  const handleSaveMicroWarp = async () => {
    try {
      const values = await microWarpForm.validate();
      setMicroWarpLoading(true);
      const token = localStorage.getItem('token');
      await axios.post('/api/configs/microwarp/config', values, {
        headers: { Authorization: `Bearer ${token}` },
      });
      Message.success('MicroWARP 配置已保存');
      loadMicroWarpStatus();
    } catch (error: any) {
      Message.error(error.response?.data?.message || '保存 MicroWARP 配置失败');
    } finally {
      setMicroWarpLoading(false);
    }
  };

  const handleSwitchMicroWarpIp = async () => {
    try {
      setMicroWarpSwitchLoading(true);
      const token = localStorage.getItem('token');
      const res = await axios.post('/api/configs/microwarp/switch', {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      Message.success(res.data?.message || 'IP 切换成功');
      loadMicroWarpStatus();
    } catch (error: any) {
      Message.error(error.response?.data || error.response?.data?.message || '切换 IP 失败');
    } finally {
      setMicroWarpSwitchLoading(false);
    }
  };

  const loadAutoBackupConfig = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('/api/configs/auto-backup/config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      autoBackupForm.setFieldsValue(res.data);
    } catch (error: any) {
      Message.error('加载自动备份配置失败');
    }
  };

  const handleSaveAutoBackup = async () => {
    try {
      const currentValues = autoBackupForm.getFieldsValue();
      if (currentValues.enabled) {
        await autoBackupForm.validate();
      }
      const values = autoBackupForm.getFieldsValue();
      if (!values.enabled) {
        values.cron = values.cron || '';
      }

      setAutoBackupLoading(true);
      const token = localStorage.getItem('token');
      await axios.post('/api/configs/auto-backup/config', values, {
        headers: { Authorization: `Bearer ${token}` },
      });

      Message.success('自动备份配置已保存');
    } catch (error: any) {
      if (error.response?.data?.message) {
        Message.error(error.response.data.message);
      } else {
        Message.error('保存失败');
      }
    } finally {
      setAutoBackupLoading(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      await autoBackupForm.validate(['webdav_url', 'webdav_username', 'webdav_password']);
      const values = autoBackupForm.getFieldsValue();

      setTestConnectionLoading(true);
      const token = localStorage.getItem('token');
      await axios.post('/api/configs/auto-backup/test', {
        webdav_url: values.webdav_url,
        webdav_username: values.webdav_username,
        webdav_password: values.webdav_password,
        enabled: false,
        cron: '',
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });

      Message.success('WebDAV 连接测试成功');
    } catch (error: any) {
      if (error.response?.data) {
        Message.error(error.response.data);
      } else {
        Message.error('连接测试失败');
      }
    } finally {
      setTestConnectionLoading(false);
    }
  };

  const handleBackupNow = async () => {
    try {
      setBackupNowLoading(true);
      const token = localStorage.getItem('token');
      await axios.post('/api/configs/auto-backup/backup-now', {}, {
        headers: { Authorization: `Bearer ${token}` },
      });

      Message.success('备份任务已启动，正在后台执行');
    } catch (error: any) {
      if (error.response?.data) {
        Message.error(error.response.data);
      } else {
        Message.error('启动备份失败');
      }
    } finally {
      setBackupNowLoading(false);
    }
  };

  const loadSystemLogs = async () => {
    try {
      setSystemLogsLoading(true);
      const data = await getSystemLogs();
      setSystemLogs(data.logs);
    } catch (error: any) {
      Message.error('加载系统日志失败');
    } finally {
      setSystemLogsLoading(false);
    }
  };

  const loadLoginLogs = async () => {
    try {
      setLoginLogsLoading(true);
      const response = await loginLogApi.list(loginLogsPagination.current, loginLogsPagination.pageSize);
      setLoginLogs(response.data);
      setLoginLogsPagination((prev) => ({
        ...prev,
        total: response.total,
      }));
    } catch (error: any) {
      Message.error('加载登录日志失败');
    } finally {
      setLoginLogsLoading(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}天`);
    if (hours > 0) parts.push(`${hours}小时`);
    if (minutes > 0) parts.push(`${minutes}分钟`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}秒`);

    return parts.join(' ');
  };

  const formatDateTime = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  const handleSaveLogRetention = async () => {
    try {
      const token = localStorage.getItem('token');
      await Promise.all([
        axios.put('/api/configs/log_retention_days_enabled', {
          value: String(logRetentionDaysEnabled),
          description: '是否启用按天数清理日志',
        }, { headers: { Authorization: `Bearer ${token}` } }),
        axios.put('/api/configs/log_retention_days', {
          value: logRetentionDays.toString(),
          description: '日志保留天数',
        }, { headers: { Authorization: `Bearer ${token}` } }),
        axios.put('/api/configs/log_total_limit_enabled', {
          value: String(logTotalLimitEnabled),
          description: '是否启用按全局总数清理日志',
        }, { headers: { Authorization: `Bearer ${token}` } }),
        axios.put('/api/configs/log_total_limit', {
          value: logMaxCount.toString(),
          description: '日志最大保留条数',
        }, { headers: { Authorization: `Bearer ${token}` } }),
        axios.put('/api/configs/log_per_task_limit_enabled', {
          value: String(logPerTaskLimitEnabled),
          description: '是否启用按每个脚本独立数量清理日志',
        }, { headers: { Authorization: `Bearer ${token}` } }),
        axios.put('/api/configs/log_per_task_limit', {
          value: logPerTaskLimit.toString(),
          description: '每个脚本最大保留日志条数',
        }, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      Message.success('保存成功');
    } catch (error: any) {
      Message.error(error.response?.data?.error || '保存失败');
    }
  };

  const handleSaveAccountConcurrency = async () => {
    try {
      setSaveConcurrencyLoading(true);
      const token = localStorage.getItem('token');
      await axios.put('/api/configs/account_max_concurrency', {
        value: String(Math.max(1, maxAccountConcurrency || 1)),
        description: '账号分账号运行的系统最大并发数',
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      Message.success('并发数量已保存');
    } catch (error: any) {
      Message.error(error.response?.data?.error || '保存失败');
    } finally {
      setSaveConcurrencyLoading(false);
    }
  };

  const handleSaveAccountSplitDelimiter = async () => {
    try {
      setSaveDelimiterLoading(true);
      const token = localStorage.getItem('token');
      await axios.put('/api/configs/account_split_delimiter', {
        value: defaultAccountSplitDelimiter,
        description: '账号分账号运行的系统默认拆分符',
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      Message.success('默认拆分符已保存');
    } catch (error: any) {
      Message.error(error.response?.data?.error || '保存失败');
    } finally {
      setSaveDelimiterLoading(false);
    }
  };

  const handleCleanupLogs = async () => {
    Modal.confirm({
      title: '确认清理日志',
      content: `将删除 ${logRetentionDays} 天前的所有日志，此操作不可逆。确定要继续吗？`,
      onOk: async () => {
        try {
          setCleanupLoading(true);
          const token = localStorage.getItem('token');
          const res = await axios.delete(`/api/logs/cleanup/${logRetentionDays}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          Message.success(`成功清理 ${res.data.deleted} 条日志`);
        } catch (error: any) {
          Message.error(error.response?.data?.error || '清理失败');
        } finally {
          setCleanupLoading(false);
        }
      },
    });
  };

  const handleSave = async () => {
    try {
      const values = await form.validate();
      setSaveLoading(true);

      const token = localStorage.getItem('token');
      await axios.post('/api/configs/mirror/config', values, {
        headers: { Authorization: `Bearer ${token}` },
      });

      Message.success('保存成功');
    } catch (error: any) {
      Message.error(error.response?.data?.error || '保存失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const setDefaultMirrors = () => {
    form.setFieldsValue({
      npm_registry: 'https://registry.npmmirror.com',
      pip_index: 'https://pypi.tuna.tsinghua.edu.cn/simple',
      apt_source: 'https://mirrors.tuna.tsinghua.edu.cn/ubuntu/',
    });
  };

  const handleBackup = async () => {
    try {
      setBackupLoading(true);
      setGlobalLoading(true);
      setLoadingText('正在创建备份，请稍候...');

      const token = localStorage.getItem('token');

      const response = await axios.get('/api/backup', {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });

      // 创建下载链接
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;

      // 从响应头获取文件名
      const contentDisposition = response.headers['content-disposition'];
      const filename = contentDisposition
        ? contentDisposition.split('filename=')[1].replace(/"/g, '')
        : `xingshu_backup_${new Date().getTime()}.tar.gz`;

      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      Message.success('备份下载成功');
    } catch (error: any) {
      Message.error('备份失败');
    } finally {
      setBackupLoading(false);
      setGlobalLoading(false);
      setLoadingText('');
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 先检查是否启用了TOTP
    let totpEnabled = false;
    try {
      const token = localStorage.getItem('token');
      const totpStatus = await axios.get('/api/auth/totp/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      totpEnabled = totpStatus.data.enabled;
    } catch (error) {
      console.error('Failed to check TOTP status:', error);
    }

    const performRestore = async (totpCode?: string) => {
      try {
        setRestoreLoading(true);
        setGlobalLoading(true);
        setLoadingText('正在恢复备份，请稍候...');

        const token = localStorage.getItem('token');

        const formData = new FormData();
        formData.append('file', file);
        if (totpCode) {
          formData.append('totp_code', totpCode);
        }

        const response = await axios.post('/api/backup/restore', formData, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
        });

        Message.success(response.data.message || '恢复成功');
      } catch (error: any) {
        if (error.response?.data?.requires_totp) {
          Message.error('需要提供TOTP验证码');
        } else {
          Message.error(error.response?.data?.message || '恢复失败');
        }
      } finally {
        setRestoreLoading(false);
        setGlobalLoading(false);
        setLoadingText('');
        // 清空 input，允许重复选择同一个文件
        e.target.value = '';
      }
    };

    if (totpEnabled) {
      // 如果启用了TOTP，先弹出验证码输入框
      let totpCode = '';
      Modal.confirm({
        title: '确认恢复备份',
        content: (
          <div>
            <p style={{ marginBottom: 16 }}>恢复备份将覆盖当前所有数据，此操作不可逆。</p>
            <p style={{ marginBottom: 8, fontWeight: 'bold' }}>请输入TOTP验证码：</p>
            <Input
              placeholder="请输入6位验证码"
              maxLength={6}
              onChange={(value) => {
                totpCode = value;
              }}
              autoFocus
            />
          </div>
        ),
        onOk: async () => {
          if (!totpCode || totpCode.length !== 6) {
            Message.error('请输入6位验证码');
            return Promise.reject();
          }
          await performRestore(totpCode);
        },
        onCancel: () => {
          // 取消时也清空 input
          e.target.value = '';
        },
      });
    } else {
      // 如果没有启用TOTP，直接确认恢复
      Modal.confirm({
        title: '确认恢复备份',
        content: '恢复备份将覆盖当前所有数据，此操作不可逆。确定要继续吗？',
        onOk: async () => {
          await performRestore();
        },
        onCancel: () => {
          // 取消时也清空 input
          e.target.value = '';
        },
      });
    }
  };

  return (
    <Spin
      loading={globalLoading}
      tip={loadingText}
      style={{
        display: 'block',
        minHeight: '100vh'
      }}
    >
      <div
        className="config-page-root"
        style={{
          pointerEvents: globalLoading ? 'none' : 'auto',
          opacity: globalLoading ? 0.6 : 1,
          transition: 'opacity 0.3s'
        }}
      >
      <div className="config-page-hero">
        <div className="config-page-description">调整系统行为、备份策略、安全设置与运行参数</div>
      </div>
      <Card className="config-page-card">
        <Tabs activeTab={activeTab} onChange={setActiveTab} type="card">
          <TabPane key="mirror" title="镜像源配置">
            <div className="config-tab-pane" style={{ padding: '16px 24px' }}>
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <Space>
                  <Button onClick={setDefaultMirrors}>
                    使用默认镜像
                  </Button>
                  <Button
                    type="primary"
                    icon={<IconSave />}
                    loading={saveLoading}
                    onClick={handleSave}
                  >
                    保存配置
                  </Button>
                </Space>
              </div>

              <Form form={form} layout="vertical">
                <Title heading={6}>Node.js 镜像源</Title>
                <FormItem
                  label="NPM 源地址"
                  field="npm_registry"
                  extra="用于 npm 包安装，留空使用官方源"
                >
                  <Input placeholder="https://registry.npmmirror.com" />
                </FormItem>

                <Divider />

                <Title heading={6}>Python 镜像源</Title>
                <FormItem
                  label="Pip 源地址"
                  field="pip_index"
                  extra="用于 Python 包安装，留空使用官方源"
                >
                  <Input placeholder="https://pypi.tuna.tsinghua.edu.cn/simple" />
                </FormItem>

                <Divider />

                <Title heading={6}>Linux 镜像源</Title>
                <FormItem
                  label="APT 源地址"
                  field="apt_source"
                  extra="用于 Linux 包安装，留空使用官方源"
                >
                  <Input placeholder="https://mirrors.tuna.tsinghua.edu.cn/ubuntu/" />
                </FormItem>
              </Form>

              <Divider />

              <div style={{ marginTop: 24 }}>
                <Title heading={6}>常用镜像源</Title>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div>
                    <Text bold>NPM:</Text>
                    <ul style={{ marginTop: 8 }}>
                      <li>淘宝镜像: https://registry.npmmirror.com</li>
                      <li>腾讯镜像: https://mirrors.cloud.tencent.com/npm/</li>
                      <li>华为镜像: https://mirrors.huaweicloud.com/repository/npm/</li>
                    </ul>
                  </div>
                  <div>
                    <Text bold>Pip:</Text>
                    <ul style={{ marginTop: 8 }}>
                      <li>清华镜像: https://pypi.tuna.tsinghua.edu.cn/simple</li>
                      <li>阿里镜像: https://mirrors.aliyun.com/pypi/simple/</li>
                      <li>豆瓣镜像: https://pypi.douban.com/simple/</li>
                    </ul>
                  </div>
                  <div>
                    <Text bold>APT:</Text>
                    <ul style={{ marginTop: 8 }}>
                      <li>清华镜像: https://mirrors.tuna.tsinghua.edu.cn/ubuntu/</li>
                      <li>阿里镜像: https://mirrors.aliyun.com/ubuntu/</li>
                      <li>网易镜像: https://mirrors.163.com/ubuntu/</li>
                    </ul>
                  </div>
                </Space>
              </div>
            </div>
          </TabPane>

          <TabPane key="microwarp" title="MicroWARP">
            <div className="config-tab-pane" style={{ padding: '16px 24px' }}>
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <Title heading={6} style={{ margin: 0 }}>MicroWARP 配置</Title>
                  <Text type="secondary">在系统配置里维护 MicroWARP 全局参数，并支持手动立即切换一次 IP。任务编辑页可按任务决定是否接入和运行前切换。</Text>
                </div>
                <Space wrap>
                  <Button loading={microWarpSwitchLoading} onClick={handleSwitchMicroWarpIp}>立即切换 IP</Button>
                  <Button type="primary" icon={<IconSave />} loading={microWarpLoading} onClick={handleSaveMicroWarp}>保存配置</Button>
                </Space>
              </div>

              <Card className="config-info-card" bordered={false} style={{ marginBottom: 16 }}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Title heading={6} style={{ margin: 0 }}>当前状态</Title>
                  {microWarpStatusLoading ? (
                    <Spin />
                  ) : (
                    <Row gutter={[16, 12]}>
                      <Col xs={24} md={12}>
                        <Text type="secondary">容器状态：</Text>
                        <Text style={{ marginLeft: 8 }}>{microWarpStatus?.running ? '运行中' : '未运行'}</Text>
                      </Col>
                      <Col xs={24} md={12}>
                        <Text type="secondary">当前出口 IP：</Text>
                        <Text style={{ marginLeft: 8 }}>{microWarpStatus?.current_ip || '暂未获取'}</Text>
                      </Col>
                      <Col xs={24} md={12}>
                        <Text type="secondary">切换模式：</Text>
                        <Text style={{ marginLeft: 8 }}>{microWarpStatus?.switch_mode === 'http-api' ? 'HTTP 接口' : '容器重启'}</Text>
                      </Col>
                      <Col xs={24} md={12}>
                        <Text type="secondary">代理地址：</Text>
                        <Text style={{ marginLeft: 8 }}>{microWarpStatus?.proxy_url || '未设置'}</Text>
                      </Col>
                    </Row>
                  )}
                </Space>
              </Card>

              <Form form={microWarpForm} layout="vertical">
                <Title heading={6}>基础开关</Title>
                <FormItem label="启用 MicroWARP" field="enabled" triggerPropName="checked" extra="开启后任务可以接入 MicroWARP 代理与切换能力。">
                  <Switch />
                </FormItem>

                <Divider />

                <Title heading={6}>连接与出口</Title>
                <FormItem label="切换 IP 接口地址" field="switch_url" extra="可选。如果留空，将自动改为重启 MicroWARP 容器实现切换。">
                  <Input placeholder="例如 http://127.0.0.1:4000/switch；留空则走容器重启方案" prefix={<IconLink />} />
                </FormItem>
                <FormItem label="MicroWARP 容器名" field="container_name" extra="当切换 IP 接口地址留空时，系统会通过重启这个容器来完成切换。默认 microwarp。">
                  <Input placeholder="例如 microwarp" />
                </FormItem>
                <FormItem label="代理地址" field="proxy_url" extra="用于出口流量和 IP 查询走 MicroWARP 代理，建议填写 socks5://127.0.0.1:1080。">
                  <Input placeholder="例如 socks5://127.0.0.1:1080 或 socks5://admin:123456@127.0.0.1:1080" />
                </FormItem>
                <FormItem label="出口 IP 查询地址" field="ip_check_url" extra="用于在任务日志里记录当前出口 IP 与切换前后 IP。默认使用纯文本接口。">
                  <Input placeholder="例如 https://api.ipify.org" prefix={<IconLink />} />
                </FormItem>

                <Divider />

                <Title heading={6}>切换策略</Title>
                <FormItem label="切换时删除配置" field="reset_config_on_switch" triggerPropName="checked" extra="开启后每次切换都会先删除 /etc/wireguard/wg0.conf，再重启 MicroWARP，适合真正换出口 IP。">
                  <Switch />
                </FormItem>
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <FormItem label="切换超时（毫秒）" field="timeout_ms">
                      <InputNumber min={1000} max={120000} precision={0} style={{ width: '100%' }} />
                    </FormItem>
                  </Col>
                  <Col xs={24} md={12}>
                    <FormItem label="自动切换开关" field="auto_switch_enabled" triggerPropName="checked">
                      <Switch />
                    </FormItem>
                  </Col>
                </Row>
                <Form.Item noStyle shouldUpdate>
                  {(values) => values.auto_switch_enabled ? (
                    <FormItem label="自动切换间隔（分钟）" field="auto_switch_interval_minutes" extra="这一版先保存配置，后续接入完整定时切换调度。">
                      <InputNumber min={1} max={1440} precision={0} style={{ width: '100%' }} />
                    </FormItem>
                  ) : (
                    <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 8, background: 'var(--color-fill-2)', color: 'var(--color-text-2)' }}>
                      当前自动切换未启用。你可以先手动切换并确认日志行为，后续再开启自动切换规则。
                    </div>
                  )}
                </Form.Item>
              </Form>
            </div>
          </TabPane>

          <TabPane key="backup" title="备份与恢复">
            <div className="config-tab-pane" style={{ padding: '16px 24px' }}>
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                <div>
                  <Typography.Title heading={6}>数据备份</Typography.Title>
                  <Typography.Text type="secondary">
                    备份包含所有任务、脚本、依赖、配置和日志数据
                  </Typography.Text>
                  <div style={{ marginTop: 12 }}>
                    <Button
                      type="primary"
                      icon={<IconDownload />}
                      loading={backupLoading}
                      onClick={handleBackup}
                    >
                      创建备份
                    </Button>
                  </div>
                </div>

                <Divider />

                <div>
                  <Typography.Title heading={6}>数据恢复</Typography.Title>
                  <Typography.Text type="secondary">
                    从备份文件恢复数据，将覆盖当前所有数据
                  </Typography.Text>
                  <div style={{ marginTop: 12 }}>
                    <input
                      ref={restoreFileInputRef}
                      type="file"
                      accept=".tar.gz,.tgz"
                      onChange={handleRestoreFile}
                      style={{ display: 'none' }}
                    />
                    <Button
                      type="outline"
                      icon={<IconUpload />}
                      loading={restoreLoading}
                      status="warning"
                      onClick={() => restoreFileInputRef.current?.click()}
                    >
                      恢复备份
                    </Button>
                  </div>
                </div>
              </Space>
            </div>
          </TabPane>

          <TabPane key="auto-backup" title="自动备份">
            <div className="config-tab-pane" style={{ padding: '16px 24px' }}>
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
                <Button
                  type="outline"
                  icon={<IconDownload />}
                  loading={backupNowLoading}
                  onClick={handleBackupNow}
                >
                  立即备份
                </Button>
                <Button
                  type="primary"
                  icon={<IconSave />}
                  loading={autoBackupLoading}
                  onClick={handleSaveAutoBackup}
                >
                  保存配置
                </Button>
              </div>

              <Form form={autoBackupForm} layout="vertical">
                <FormItem
                  label="启用自动备份"
                  field="enabled"
                  triggerPropName="checked"
                  extra="开启后将按照设置的时间自动备份到 WebDAV"
                >
                  <Switch />
                </FormItem>

                <FormItem
                  label="启动时自动恢复"
                  field="auto_restore_on_startup"
                  triggerPropName="checked"
                  extra="开启后，每次启动时会自动从 WebDAV 恢复最新的备份（谨慎使用）"
                >
                  <Switch />
                </FormItem>

                <Divider />

                <Form.Item noStyle shouldUpdate>
                  {(values) => !values.enabled ? (
                    <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 8, background: 'var(--color-fill-2)', color: 'var(--color-text-2)' }}>
                      当前自动备份未启用。你可以先填写并测试 WebDAV 连接，确认可用后再开启自动备份。
                    </div>
                  ) : null}
                </Form.Item>

                <Title heading={6}>WebDAV 配置</Title>

                <Form.Item noStyle shouldUpdate>
                  {(values) => (
                    <>
                      <FormItem
                        label="WebDAV 地址"
                        field="webdav_url"
                        rules={values.enabled ? [{ required: true, message: '请输入 WebDAV 地址' }] : undefined}
                        extra="例如: https://dav.example.com"
                      >
                        <Input placeholder="https://dav.example.com" />
                      </FormItem>

                      <FormItem
                        label="用户名"
                        field="webdav_username"
                        rules={values.enabled ? [{ required: true, message: '请输入用户名' }] : undefined}
                      >
                        <Input placeholder="用户名" />
                      </FormItem>

                      <FormItem
                        label="密码"
                        field="webdav_password"
                        rules={values.enabled ? [{ required: true, message: '请输入密码' }] : undefined}
                      >
                        <Input.Password placeholder="密码" />
                      </FormItem>
                    </>
                  )}
                </Form.Item>

                <FormItem
                  label="远程路径"
                  field="remote_path"
                  extra="备份文件保存的远程路径，留空则保存到根目录"
                >
                  <Input placeholder="/backups" />
                </FormItem>

                <div style={{ marginBottom: 16 }}>
                  <Button
                    type="outline"
                    loading={testConnectionLoading}
                    onClick={handleTestConnection}
                  >
                    测试连接
                  </Button>
                </div>

                <Divider />

                <Title heading={6}>备份计划</Title>

                <Form.Item noStyle shouldUpdate>
                  {(values) => (
                    <FormItem
                      label="Cron 调度表达式"
                      field="cron"
                      rules={values.enabled ? [{ required: true, message: '请输入 Cron 调度表达式' }] : undefined}
                      extra="支持 5 字段格式（分 时 日 月 周），例如: 0 2 * * * (每天凌晨2点)"
                    >
                      <Input placeholder="0 2 * * *" />
                    </FormItem>
                  )}
                </Form.Item>

                <Divider />

                <Title heading={6}>备份保留策略</Title>

                <FormItem
                  label="最大保留备份数"
                  field="max_backups"
                  extra="自动删除超过此数量的旧备份，留空表示不限制"
                >
                  <InputNumber
                    placeholder="10"
                    min={1}
                    max={100}
                    precision={0}
                    style={{ width: 200 }}
                  />
                </FormItem>

                <div style={{ marginTop: 24 }}>
                  <Title heading={6}>常用 Cron 调度表达式</Title>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <ul style={{ marginTop: 8 }}>
                      <li>每天凌晨2点: 0 2 * * *</li>
                      <li>每天中午12点: 0 12 * * *</li>
                      <li>每周日凌晨3点: 0 3 * * 0</li>
                      <li>每月1号凌晨4点: 0 4 1 * *</li>
                      <li>每6小时: 0 */6 * * *</li>
                      <li>每12小时: 0 */12 * * *</li>
                    </ul>
                  </Space>
                </div>
              </Form>
            </div>
          </TabPane>

          <TabPane key="logs" title="日志管理">
            <div className="config-tab-pane" style={{ padding: '16px 24px' }}>
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                <div>
                  <Typography.Title heading={6}>日志保留设置</Typography.Title>
                  <Typography.Text type="secondary">
                    这里把按天数清理、按全局总数清理、按每个脚本独立数量清理拆成三条独立策略。你可以只开其中一条，也可以同时开启多条。
                  </Typography.Text>
                  <Space direction="vertical" style={{ width: '100%', marginTop: 12 }} size="large">
                    <div style={{ padding: '16px', borderRadius: 10, background: 'var(--color-fill-2)' }}>
                      <Typography.Title heading={6} style={{ marginTop: 0 }}>按天数清理</Typography.Title>
                      <Typography.Text type="secondary">超过设定天数的日志会被删除。</Typography.Text>
                      <div style={{ marginTop: 12 }}>
                        <Space direction={isMobile ? 'vertical' : 'horizontal'} align="center">
                          <Switch checked={logRetentionDaysEnabled} onChange={setLogRetentionDaysEnabled} />
                          <InputNumber
                            value={logRetentionDays}
                            onChange={(value) => setLogRetentionDays(Number(value) || 30)}
                            style={{ width: 140 }}
                            placeholder="保留天数"
                            min={1}
                            max={365}
                            precision={0}
                            disabled={!logRetentionDaysEnabled}
                          />
                        </Space>
                      </div>
                    </div>

                    <div style={{ padding: '16px', borderRadius: 10, background: 'var(--color-fill-2)' }}>
                      <Typography.Title heading={6} style={{ marginTop: 0 }}>按全局总数清理</Typography.Title>
                      <Typography.Text type="secondary">限制整个程序的日志总量，超出后删除更旧的记录。</Typography.Text>
                      <div style={{ marginTop: 12 }}>
                        <Space direction={isMobile ? 'vertical' : 'horizontal'} align="center">
                          <Switch checked={logTotalLimitEnabled} onChange={setLogTotalLimitEnabled} />
                          <InputNumber
                            value={logMaxCount}
                            onChange={(value) => setLogMaxCount(Number(value) || 5)}
                            style={{ width: 160 }}
                            placeholder="最大保留条数"
                            min={1}
                            max={100000}
                            precision={0}
                            disabled={!logTotalLimitEnabled}
                          />
                        </Space>
                      </div>
                    </div>

                    <div style={{ padding: '16px', borderRadius: 10, background: 'var(--color-fill-2)' }}>
                      <Typography.Title heading={6} style={{ marginTop: 0 }}>按每个脚本独立数量清理</Typography.Title>
                      <Typography.Text type="secondary">限制每个任务/脚本自己最多保留多少条日志，不影响其它任务。</Typography.Text>
                      <div style={{ marginTop: 12 }}>
                        <Space direction={isMobile ? 'vertical' : 'horizontal'} align="center">
                          <Switch checked={logPerTaskLimitEnabled} onChange={setLogPerTaskLimitEnabled} />
                          <InputNumber
                            value={logPerTaskLimit}
                            onChange={(value) => setLogPerTaskLimit(Number(value) || 20)}
                            style={{ width: 180 }}
                            placeholder="每脚本最大条数"
                            min={1}
                            max={100000}
                            precision={0}
                            disabled={!logPerTaskLimitEnabled}
                          />
                          <Button type="primary" onClick={handleSaveLogRetention}>
                            保存设置
                          </Button>
                        </Space>
                      </div>
                    </div>
                  </Space>
                </div>

                <Divider />

                <div>
                  <Typography.Title heading={6}>手动清理日志</Typography.Title>
                  <Typography.Text type="secondary">
                    立即清理超过保留天数的日志
                  </Typography.Text>
                  <div style={{ marginTop: 12 }}>
                    <Button
                      type="outline"
                      status="warning"
                      loading={cleanupLoading}
                      onClick={handleCleanupLogs}
                    >
                      清理旧日志
                    </Button>
                  </div>
                </div>
              </Space>
            </div>
          </TabPane>

          <TabPane key="account-runner" title="并发管理">
            <div className="config-tab-pane" style={{ padding: '16px 24px' }}>
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                <div>
                  <Typography.Title heading={6}>并发管理</Typography.Title>
                  <Typography.Text type="secondary">
                    这里集中管理多账号运行相关的系统默认值。任务里留空时，会使用这里的配置。
                  </Typography.Text>
                </div>

                <div style={{ padding: '16px', borderRadius: 10, background: 'var(--color-fill-2)' }}>
                  <Typography.Title heading={6} style={{ marginTop: 0 }}>并发设置分区</Typography.Title>
                  <Typography.Text type="secondary">
                    控制多账号并发运行时的系统最大并发数。单个任务填写的并发数不会超过这里的上限。
                  </Typography.Text>
                  <div style={{ marginTop: 12 }}>
                    <Space direction={isMobile ? 'vertical' : 'horizontal'} align="center">
                      <InputNumber
                        value={maxAccountConcurrency}
                        onChange={(value) => setMaxAccountConcurrency(Number(value) || 1)}
                        style={{ width: 180 }}
                        placeholder="最大并发数"
                        min={1}
                        max={100}
                        precision={0}
                      />
                      <Button type="primary" loading={saveConcurrencyLoading} onClick={handleSaveAccountConcurrency}>
                        保存并发数量
                      </Button>
                    </Space>
                  </div>
                </div>

                <div style={{ padding: '16px', borderRadius: 10, background: 'var(--color-fill-2)' }}>
                  <Typography.Title heading={6} style={{ marginTop: 0 }}>拆分符设置分区</Typography.Title>
                  <Typography.Text type="secondary">
                    控制多账号字符串如何拆分。支持普通字符和特殊字符，例如 <code>@</code>、<code>|</code>、<code>#</code>、<code>&amp;</code>、<code>#&amp;</code>；这里按“整段文本”精确拆分，不是正则。
                  </Typography.Text>
                  <div style={{ marginTop: 8, color: 'var(--color-text-2)', fontSize: 13, lineHeight: 1.7 }}>
                    多个拆分符当前<strong>不能同时生效</strong>，一次只能填写<strong>一个默认拆分符规则</strong>。<br />
                    例如：<code>@</code> 表示按 <code>@</code> 拆；<code>#&amp;</code> 表示按连续文本 <code>#&amp;</code> 拆。<br />
                    如果你的数据里既可能有 <code>#</code> 又可能有 <code>&amp;</code>，需要统一源数据格式，或在具体任务里单独填写该任务自己的拆分符。
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <Space direction={isMobile ? 'vertical' : 'horizontal'} align="center">
                      <Input
                        value={defaultAccountSplitDelimiter}
                        onChange={setDefaultAccountSplitDelimiter}
                        style={{ width: 220 }}
                        placeholder="例如 @ 或 # 或 & 或 #&"
                        maxLength={20}
                      />
                      <Button type="primary" loading={saveDelimiterLoading} onClick={handleSaveAccountSplitDelimiter}>
                        保存默认拆分符
                      </Button>
                    </Space>
                  </div>
                </div>
              </Space>
            </div>
          </TabPane>

          <TabPane key="system" title="系统信息">
            <div className="config-tab-pane" style={{ padding: '16px 24px' }}>
              <Spin loading={systemInfoLoading}>
                <Space direction="vertical" style={{ width: '100%' }} size="large">
                  <div>
                    <Typography.Title heading={6}>基本信息</Typography.Title>
                    <Row gutter={[16, 16]}>
                      <Col xs={24} sm={12} md={12} lg={8} xl={6}>
                        <div>
                          <Text bold>版本:</Text> <Text>星枢 {appVersion}</Text>
                        </div>
                      </Col>
                      <Col xs={24} sm={12} md={12} lg={8} xl={6}>
                        <div>
                          <Text bold>更新时间:</Text> <Text>{appUpdatedAt}</Text>
                        </div>
                      </Col>
                      <Col xs={24} sm={12} md={12} lg={8} xl={6}>
                        <div>
                          <Text bold>后端:</Text> <Text>Rust + Axum</Text>
                        </div>
                      </Col>
                      <Col xs={24} sm={12} md={12} lg={8} xl={6}>
                        <div>
                          <Text bold>前端:</Text> <Text>React 18 + TypeScript + Arco Design</Text>
                        </div>
                      </Col>
                      <Col xs={24} sm={12} md={12} lg={8} xl={6}>
                        <div>
                          <Text bold>数据库:</Text> <Text>SQLite</Text>
                        </div>
                      </Col>
                      {systemInfo && (
                        <>
                          <Col xs={24} sm={12} md={12} lg={8} xl={6}>
                            <div>
                              <Text bold>启动时间:</Text> <Text>{formatDateTime(systemInfo.start_time)}</Text>
                            </div>
                          </Col>
                          <Col xs={24} sm={12} md={12} lg={8} xl={6}>
                            <div>
                              <Text bold>已运行:</Text> <Text>{formatUptime(currentUptime)}</Text>
                            </div>
                          </Col>
                        </>
                      )}
                    </Row>
                  </div>

                  {systemInfo && (
                    <>
                      <Divider />

                      <div>
                        <Typography.Title heading={6}>系统资源</Typography.Title>
                        <Row gutter={[16, 16]}>
                          <Col xs={24} sm={12} md={12} lg={8} xl={8}>
                            <Card title="CPU 使用情况" size="small" className="config-info-card">
                              <Space direction="vertical" style={{ width: '100%' }}>
                                <div>
                                  <Text bold>使用率:</Text> <Text>{systemInfo.cpu_usage.toFixed(2)}%</Text>
                                </div>
                              </Space>
                            </Card>
                          </Col>
                          <Col xs={24} sm={12} md={12} lg={8} xl={8}>
                            <Card title="内存" size="small" className="config-info-card">
                              <Space direction="vertical" style={{ width: '100%' }}>
                                <div>
                                  <Text bold>总容量:</Text> <Text>{formatBytes(systemInfo.memory_total)}</Text>
                                </div>
                                <div>
                                  <Text bold>已使用:</Text> <Text>{formatBytes(systemInfo.memory_used)}</Text>
                                </div>
                                <div>
                                  <Text bold>可用:</Text> <Text>{formatBytes(systemInfo.memory_available)}</Text>
                                </div>
                                <div>
                                  <Text bold>使用率:</Text> <Text>{systemInfo.memory_usage_percent.toFixed(2)}%</Text>
                                </div>
                              </Space>
                            </Card>
                          </Col>
                        </Row>
                      </div>

                      <Divider />

                      <div>
                        <Typography.Title heading={6}>磁盘</Typography.Title>
                        <Row gutter={[16, 16]}>
                          {systemInfo.disks
                            .filter((disk) => !['/etc/resolv.conf', '/etc/hostname', '/etc/hosts'].includes(disk.mount_point))
                            .map((disk, index) => (
                            <Col key={index} xs={24} sm={12} md={12} lg={8} xl={8}>
                              <Card title={disk.mount_point} size="small" className="config-info-card">
                                <Space direction="vertical" style={{ width: '100%' }}>
                                  <div>
                                    <Text bold>总容量:</Text> <Text>{formatBytes(disk.total_space)}</Text>
                                  </div>
                                  <div>
                                    <Text bold>已使用:</Text> <Text>{formatBytes(disk.used_space)}</Text>
                                  </div>
                                  <div>
                                    <Text bold>可用:</Text> <Text>{formatBytes(disk.available_space)}</Text>
                                  </div>
                                  <div>
                                    <Text bold>使用率:</Text> <Text>{disk.usage_percent.toFixed(2)}%</Text>
                                  </div>
                                </Space>
                              </Card>
                            </Col>
                          ))}
                        </Row>
                      </div>
                    </>
                  )}
                </Space>
              </Spin>
            </div>
          </TabPane>

          <TabPane key="login-logs" title="登录日志">
            <div className="config-tab-pane" style={{ padding: '16px 24px' }}>
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Title heading={6} style={{ margin: 0 }}>登录日志</Title>
                  <Button
                    icon={<IconRefresh />}
                    onClick={loadLoginLogs}
                  >
                    刷新
                  </Button>
                </div>
                <Table
                  className="config-table"
                  loading={loginLogsLoading}
                  columns={[
                    {
                      title: 'ID',
                      dataIndex: 'id',
                      width: 80,
                    },
                    {
                      title: '用户名',
                      dataIndex: 'username',
                      width: 150,
                    },
                    {
                      title: 'IP地址',
                      dataIndex: 'ip_address',
                      width: 180,
                    },
                    {
                      title: '登录时间',
                      dataIndex: 'created_at',
                      width: 200,
                      render: (created_at: string) => dayjs(created_at).format('YYYY-MM-DD HH:mm:ss'),
                    },
                  ]}
                  data={loginLogs}
                  scroll={{ x: 600 }}
                  pagination={{
                    ...loginLogsPagination,
                    onChange: (current, pageSize) => {
                      setLoginLogsPagination({ ...loginLogsPagination, current, pageSize });
                    },
                    showTotal: true,
                    sizeCanChange: !isMobile,
                    pageSizeChangeResetCurrent: true,
                    simple: isMobile,
                  }}
                  rowKey="id"
                />
              </Space>
            </div>
          </TabPane>

          <TabPane key="systemlogs" title="系统日志">
            <div className="config-tab-pane" style={{ padding: '16px 24px' }}>
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography.Title heading={6}>系统运行日志（最近100条）</Typography.Title>
                </div>

                <Spin loading={systemLogsLoading}>
                  <div
                    className="config-system-log-block"
                    style={{
                      color: 'var(--xingshu-code-text)',
                      padding: '16px',
                      borderRadius: '8px',
                      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                      fontSize: '13px',
                      lineHeight: '1.6',
                      maxHeight: '600px',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {systemLogs.length === 0 ? (
                      <div className="config-empty-log-state" style={{ color: 'var(--xingshu-code-muted)', textAlign: 'center', padding: '20px' }}>
                        暂无日志
                      </div>
                    ) : (
                      systemLogs.map((log, index) => {
                        const date = new Date(log.timestamp);
                        const timeStr = date.toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        });

                        let levelColor = '#4fc3f7';
                        if (log.level === 'ERROR') levelColor = '#f44336';
                        else if (log.level === 'WARN') levelColor = '#ff9800';
                        else if (log.level === 'INFO') levelColor = '#4caf50';
                        else if (log.level === 'DEBUG') levelColor = '#9e9e9e';

                        return (
                          <div key={index} style={{ marginBottom: '4px' }}>
                            <span style={{ color: 'var(--xingshu-code-muted)' }}>[{timeStr}]</span>
                            {' '}
                            <span style={{ color: levelColor, fontWeight: 'bold' }}>
                              {log.level.padEnd(5)}
                            </span>
                            {' '}
                            <span style={{ color: 'var(--xingshu-code-muted)' }}>{log.target}</span>
                            {' - '}
                            <span>{log.message}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </Spin>
              </Space>
            </div>
          </TabPane>

          <TabPane key="security" title="安全设置">
            <div className="config-tab-pane" style={{ padding: '16px 24px' }}>
              <TotpSettings />

              <Divider />

              <Title heading={6} style={{ marginBottom: 16 }}>修改密码</Title>
              <Form
                form={passwordForm}
                style={{ maxWidth: 500 }}
                layout="vertical"
                onSubmit={async (values: any) => {
                  if (values.newPassword !== values.confirmPassword) {
                    Message.error('两次密码不一致');
                    return;
                  }

                  setPasswordChangeLoading(true);
                  try {
                    await authApi.changePassword(values.oldPassword, values.newPassword);
                    Message.success('密码修改成功');
                    passwordForm.resetFields();
                  } catch (error: any) {
                    Message.error(error.response?.data || '修改失败');
                  } finally {
                    setPasswordChangeLoading(false);
                  }
                }}
              >
                <FormItem
                  label="当前密码"
                  field="oldPassword"
                  rules={[{ required: true, message: '请输入当前密码' }]}
                >
                  <Input.Password placeholder="请输入当前密码" />
                </FormItem>
                <FormItem
                  label="新密码"
                  field="newPassword"
                  rules={[
                    { required: true, message: '请输入新密码' },
                    { minLength: 6, message: '密码至少6个字符' }
                  ]}
                >
                  <Input.Password placeholder="请输入新密码" />
                </FormItem>
                <FormItem
                  label="确认新密码"
                  field="confirmPassword"
                  rules={[{ required: true, message: '请确认新密码' }]}
                >
                  <Input.Password placeholder="请再次输入新密码" />
                </FormItem>
                <FormItem>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={passwordChangeLoading}
                  >
                    修改密码
                  </Button>
                </FormItem>
              </Form>
            </div>
          </TabPane>
        </Tabs>
      </Card>
      </div>
    </Spin>
  );
};

export default Config;
