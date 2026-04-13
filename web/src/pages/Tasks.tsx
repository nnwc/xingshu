import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Switch,
  Message,
  Popconfirm,
  Tag,
  Select,
  Tabs,
  Grid,
  Divider,
  Spin,
  Dropdown,
  Menu,
  Typography,
  InputNumber,
  Radio,
  Checkbox,
} from '@arco-design/web-react';
import { IconPlus, IconPlayArrow, IconEdit, IconDelete, IconInfoCircle, IconStop, IconFile, IconMore, IconLink } from '@arco-design/web-react/icon';
import { taskApi } from '@/api/task';
import { logApi } from '@/api/log';
import { notifyApi, type NotificationChannelConfig } from '@/api/notify';
import axios from 'axios';
import type { Task, TaskGroup } from '@/types';
import './Tasks.css';

const FormItem = Form.Item;
const { Option } = Select;
const RadioGroup = Radio.Group;
const { Row, Col } = Grid;
const TabPane = Tabs.TabPane;

const SCHEDULE_UNIT_OPTIONS = [
  { label: '秒', value: 'second' },
  { label: '分钟', value: 'minute' },
  { label: '小时', value: 'hour' },
  { label: '天', value: 'day' },
  { label: '周', value: 'week' },
  { label: '年', value: 'year' },
];

const buildPresetCron = (value: number, unit: string) => {
  const safeValue = Math.max(1, Math.floor(value || 1));
  switch (unit) {
    case 'second':
      return `*/${safeValue} * * * * *`;
    case 'minute':
      return `*/${safeValue} * * * *`;
    case 'hour':
      return `0 */${safeValue} * * *`;
    case 'day':
      return `0 0 */${safeValue} * *`;
    case 'week':
      return `0 0 */${safeValue * 7} * *`;
    case 'year':
      return `0 0 1 1 *`;
    default:
      return `*/${safeValue} * * * *`;
  }
};

const formatTaskSchedule = (task: Task) => {
  if (task.type !== 'cron') return '-';

  if (task.schedule_mode === 'random_interval') {
    const config = task.schedule_config || {};
    return `每 ${config.min_value ?? 15}-${config.max_value ?? 20} ${SCHEDULE_UNIT_OPTIONS.find(v => v.value === config.unit)?.label || '分钟'}随机运行`;
  }

  if (task.schedule_mode === 'preset') {
    const config = task.schedule_config || {};
    return `每 ${config.interval_value ?? 1} ${SCHEDULE_UNIT_OPTIONS.find(v => v.value === config.interval_unit)?.label || '分钟'}`;
  }

  const cronArray = Array.isArray(task.cron) ? task.cron : [task.cron];
  return cronArray.join('\n');
};

const Tasks: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runningTasks, setRunningTasks] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [form] = Form.useForm();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // 分组相关状态
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [activeTab, setActiveTab] = useState<string>('default');
  const [groupManageVisible, setGroupManageVisible] = useState(false);
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [groupForm] = Form.useForm();

  // 日志相关状态
  const [logVisible, setLogVisible] = useState(false);
  const [logContent, setLogContent] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const [isLiveLog, setIsLiveLog] = useState(false);
  const [currentViewTask, setCurrentViewTask] = useState<Task | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const runningTasksEventSourceRef = useRef<EventSource | null>(null);
  const timerRef = useRef<number | null>(null);

  // Webhook相关状态
  const [webhookVisible, setWebhookVisible] = useState(false);
  const [webhookToken, setWebhookToken] = useState<string>('');
  const [currentWebhookTaskId, setCurrentWebhookTaskId] = useState<number | null>(null);
  const [notificationChannels, setNotificationChannels] = useState<NotificationChannelConfig[]>([]);
  const [defaultAccountSplitDelimiter, setDefaultAccountSplitDelimiter] = useState('@');
  const [maxAccountConcurrency, setMaxAccountConcurrency] = useState(3);
  const [taskModalTab, setTaskModalTab] = useState('basic');
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);

  const isChannelConfigured = React.useCallback((channel: NotificationChannelConfig) => {
    const hasWebhookUrl = !!channel?.webhook_url
      && !(channel.channel === 'webhook' && channel.webhook_url === 'https://example.com/webhook')
      && !channel.webhook_url.includes('<token>')
      && !channel.webhook_url.includes('<topic>')
      && !channel.webhook_url.includes('<id>');
    const hasRemark = !!channel?.remark?.trim();
    const hasFieldValues = Object.values(channel?.fields || {}).some((value) => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return true;
      return String(value ?? '').trim() !== '';
    });
    return hasWebhookUrl || hasRemark || hasFieldValues;
  }, []);

  useEffect(() => {
    loadGroups();
    loadWebhookToken();
    loadNotificationChannels();
    loadAccountRunnerDefaults();

    // 使用SSE订阅运行中的任务
    const token = localStorage.getItem('token');
    const url = `/api/tasks/running/stream${token ? `?token=${token}` : ''}`;

    const connectRunningTasksSSE = () => {
      const eventSource = new EventSource(url);
      runningTasksEventSourceRef.current = eventSource;

      eventSource.onopen = () => {
      };

      eventSource.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data);

          // 更新运行中任务列表
          setRunningTasks(new Set<number>(update.running_ids));

          // 如果任务开始，立即更新执行时间为当前时间（不显示耗时）
          if (update.change_type === 'started' && update.changed_task_id) {
            setTasks(prevTasks =>
              prevTasks.map(t =>
                t.id === update.changed_task_id
                  ? { ...t, last_run_at: new Date().toISOString(), last_run_duration: undefined }
                  : t
              )
            );
          }

          // 如果任务结束且包含任务数据，直接更新本地状态
          if (update.change_type === 'finished' && update.task_data) {
            setTasks(prevTasks =>
              prevTasks.map(t => t.id === update.changed_task_id ? update.task_data : t)
            );
          }
        } catch (error) {
          console.error('解析运行任务数据失败:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('运行任务SSE错误:', error);
        eventSource.close();
        // 3秒后重连
        setTimeout(connectRunningTasksSSE, 3000);
      };
    };

    connectRunningTasksSSE();

    // 监听窗口大小变化
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      // 清理SSE连接
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (runningTasksEventSourceRef.current) {
        runningTasksEventSourceRef.current.close();
      }
      // 清理计时器
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    loadTasks();
  }, [activeTab]);

  useEffect(() => {
    setSelectedTaskIds((prev) => prev.filter((id) => tasks.some((task) => task.id === id)));
  }, [tasks]);

  const loadGroups = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('/api/task-groups', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setGroups((res.data || []).slice().sort((a: TaskGroup, b: TaskGroup) => (a.sort_order ?? 0) - (b.sort_order ?? 0)));
    } catch (error) {
      console.error('Failed to load groups:', error);
    }
  };

  const loadTasks = async () => {
    setLoading(true);
    try {
      if (activeTab === 'default') {
        const res: any = await taskApi.list();
        setTasks((res || []).filter((task: any) => !task.group_id));
      } else {
        const groupId = parseInt(activeTab);
        const token = localStorage.getItem('token');
        const res = await axios.get(`/api/task-groups/${groupId}/tasks`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setTasks(res.data);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadWebhookToken = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('/api/system/webhook-config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data.configured && res.data.token) {
        setWebhookToken(res.data.token);
      }
    } catch (error) {
      console.error('Failed to load webhook token:', error);
    }
  };

  const loadNotificationChannels = async () => {
    try {
      const configs = await notifyApi.listChannelConfigs();
      setNotificationChannels(configs || []);
    } catch (error) {
      console.error('Failed to load notification channels:', error);
    }
  };

  const loadAccountRunnerDefaults = async () => {
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
      }
      if (splitDelimiterRes.status === 'fulfilled' && splitDelimiterRes.value.data?.value) {
        setDefaultAccountSplitDelimiter(splitDelimiterRes.value.data.value || '@');
      }
    } catch (error) {
      console.error('Failed to load account runner defaults:', error);
    }
  };

  const taskNotifyChannelOptions = React.useMemo(() => {
    const labelMap: Record<string, string> = {
      webhook: '通用 Webhook',
      telegram: 'Telegram',
      bark: 'Bark',
      ntfy: 'ntfy',
      gotify: 'Gotify',
      wecom: '企业微信',
      dingtalk: '钉钉',
      feishu: '飞书',
      discord: 'Discord',
      slack: 'Slack',
      serverchan: 'Server酱',
      pushplus: 'PushPlus',
      email: 'Email',
    };

    const available = notificationChannels.filter((channel) => channel.enabled && isChannelConfigured(channel));
    if (!available.some((channel) => channel.channel === 'webhook')) {
      available.unshift({
        channel: 'webhook',
        enabled: true,
        webhook_url: '',
        task_events_enabled: true,
        system_events_enabled: true,
        fields: {},
      });
    }

    return available.map((channel) => ({
      value: channel.channel,
      label: labelMap[channel.channel] || channel.channel,
    }));
  }, [notificationChannels, isChannelConfigured]);

  const showWebhookUrl = (taskId: number) => {
    setCurrentWebhookTaskId(taskId);
    setWebhookVisible(true);
  };

  const copyWebhookUrl = async () => {
    if (!currentWebhookTaskId) {
      Message.warning('当前没有可复制的 Webhook 地址');
      return;
    }

    const url = `${window.location.origin}/api/webhook/tasks/${currentWebhookTaskId}/trigger`;
    try {
      await navigator.clipboard.writeText(url);
      Message.success('Webhook 地址已复制到剪贴板');
    } catch (error) {
      Message.error('复制失败，请手动复制');
    }
  };

  const handleMoveGroup = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= groups.length) return;

    const nextGroups = [...groups];
    const [moved] = nextGroups.splice(index, 1);
    nextGroups.splice(targetIndex, 0, moved);

    setGroups(nextGroups);

    try {
      const token = localStorage.getItem('token');
      await axios.post('/api/task-groups/reorder', {
        group_ids: nextGroups.map(group => group.id),
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      Message.success('分组顺序已更新');
      loadGroups();
    } catch (error: any) {
      Message.error(error.response?.data?.error || '排序更新失败');
      loadGroups();
    }
  };

  const handleEditGroup = (group: TaskGroup) => {
    setEditingGroup(group);
    groupForm.setFieldsValue(group);
    setGroupModalVisible(true);
  };

  const handleSubmitGroup = async () => {
    try {
      const values = await groupForm.validate();
      const token = localStorage.getItem('token');

      if (editingGroup) {
        await axios.put(`/api/task-groups/${editingGroup.id}`, values, {
          headers: { Authorization: `Bearer ${token}` },
        });
        Message.success('更新成功');
      } else {
        await axios.post('/api/task-groups', values, {
          headers: { Authorization: `Bearer ${token}` },
        });
        Message.success('创建成功');
      }
      setGroupModalVisible(false);
      groupForm.resetFields();
      setEditingGroup(null);
      loadGroups();
    } catch (error: any) {
      Message.error(error.response?.data?.error || '操作失败');
    }
  };

  const handleDeleteGroup = async (id: number) => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`/api/task-groups/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      Message.success('删除成功');
      if (activeTab === id.toString()) {
        setActiveTab('default');
      }
      loadGroups();
    } catch (error: any) {
      Message.error(error.response?.data?.error || '删除失败');
    }
  };

  const handleAdd = () => {
    setEditingTask(null);
    setTaskModalTab('basic');
    form.resetFields();
    form.setFieldsValue({
      type: 'cron',
      enabled: true,
      notify_enabled: false,
      notify_channel: 'webhook',
      notify_events: ['failed'],
      notify_attach_log: true,
      notify_log_limit: 2000,
      notify_log_mode: 'summary',
      account_run_mode: 'single',
      account_env_key: '',
      account_split_delimiter: '',
      account_concurrency: maxAccountConcurrency,
      schedule_mode: 'preset',
      schedule_config: {
        interval_value: 5,
        interval_unit: 'minute',
        min_value: 15,
        max_value: 20,
        unit: 'minute',
      },
      use_microwarp: false,
      microwarp_switch_ip_on_run: false,
      cron: ['*/5 * * * *'],
    });
    setVisible(true);
  };

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setTaskModalTab('basic');
    // 确保 cron 是数组格式
    const formData = {
      ...task,
      notify_enabled: task.notify_enabled ?? false,
      notify_channel: task.notify_channel || 'webhook',
      notify_events: task.notify_events || ['failed'],
      notify_attach_log: task.notify_attach_log ?? true,
      notify_log_limit: task.notify_log_limit ?? 2000,
      notify_log_mode: task.notify_log_mode || 'summary',
      account_run_mode: task.account_run_mode || 'single',
      account_env_key: task.account_env_key || '',
      account_split_delimiter: task.account_split_delimiter || '',
      account_concurrency: task.account_concurrency ?? maxAccountConcurrency,
      schedule_mode: task.schedule_mode || 'cron',
      schedule_config: {
        interval_value: task.schedule_config?.interval_value ?? 5,
        interval_unit: task.schedule_config?.interval_unit ?? 'minute',
        min_value: task.schedule_config?.min_value ?? 15,
        max_value: task.schedule_config?.max_value ?? 20,
        unit: task.schedule_config?.unit ?? 'minute',
      },
      use_microwarp: task.use_microwarp ?? false,
      microwarp_switch_ip_on_run: task.microwarp_switch_ip_on_run ?? false,
      cron: Array.isArray(task.cron) ? task.cron : [task.cron],
    };
    form.setFieldsValue(formData);
    setVisible(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validate();

      // 如果不是定时任务，设置默认的cron表达式
      if (values.type !== 'cron') {
        values.cron = ['0 0 * * *'];
        values.schedule_mode = 'cron';
        values.schedule_config = null;
      } else {
        if (values.schedule_mode === 'preset') {
          const intervalValue = values.schedule_config?.interval_value || 1;
          const intervalUnit = values.schedule_config?.interval_unit || 'minute';
          values.cron = [buildPresetCron(intervalValue, intervalUnit)];
          values.schedule_config = {
            interval_value: intervalValue,
            interval_unit: intervalUnit,
          };
        } else if (values.schedule_mode === 'random_interval') {
          const minValue = values.schedule_config?.min_value || 15;
          const maxValue = values.schedule_config?.max_value || 20;
          const unit = values.schedule_config?.unit || 'minute';
          values.cron = ['0 0 * * *'];
          values.schedule_config = {
            min_value: minValue,
            max_value: maxValue,
            unit,
          };
        } else {
          values.schedule_config = null;
        }
      }

      if (!values.notify_enabled) {
        values.notify_channel = '';
        values.notify_events = [];
        values.notify_attach_log = false;
        values.notify_log_limit = null;
        values.notify_log_mode = null;
      } else if (!values.notify_attach_log) {
        values.notify_log_limit = null;
        values.notify_log_mode = null;
      }

      if (values.account_run_mode === 'single') {
        values.account_env_key = '';
        values.account_split_delimiter = '';
        values.account_concurrency = null;
      } else if (values.account_run_mode !== 'concurrent') {
        values.account_concurrency = null;
      }

      if (!values.use_microwarp) {
        values.microwarp_switch_ip_on_run = false;
      }

      values.env = null;

      if (editingTask) {
        await taskApi.update(editingTask.id, values);
        Message.success('更新成功');
      } else {
        await taskApi.create(values);
        Message.success('创建成功');
      }
      setVisible(false);
      setTaskModalTab('basic');
      form.resetFields();
      setEditingTask(null);
      loadTasks();
    } catch (error: any) {
      Message.error(error.response?.data?.error || '操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await taskApi.delete(id);
      Message.success('删除成功');
      loadTasks();
    } catch (error: any) {
      Message.error(error.response?.data?.error || '删除失败');
    }
  };

  const selectableTaskIds = useMemo(() => tasks.filter((task) => !runningTasks.has(task.id)).map((task) => task.id), [tasks, runningTasks]);
  const allSelectableChecked = selectableTaskIds.length > 0 && selectableTaskIds.every((id) => selectedTaskIds.includes(id));

  const toggleSelectAll = (checked: boolean) => {
    setSelectedTaskIds(checked ? selectableTaskIds : []);
  };

  const toggleTaskSelection = (taskId: number, checked: boolean) => {
    setSelectedTaskIds((prev) => checked ? Array.from(new Set([...prev, taskId])) : prev.filter((id) => id !== taskId));
  };

  const handleBatchSetEnabled = async (enabled: boolean) => {
    if (selectedTaskIds.length === 0) return;
    try {
      await Promise.all(selectedTaskIds.map((id) => taskApi.update(id, { enabled })));
      Message.success(enabled ? '批量启用成功' : '批量禁用成功');
      setSelectedTaskIds([]);
      loadTasks();
    } catch (error: any) {
      Message.error(error.response?.data?.error || '批量操作失败');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedTaskIds.length === 0) return;
    try {
      await Promise.all(selectedTaskIds.map((id) => taskApi.delete(id)));
      Message.success('批量删除成功');
      setSelectedTaskIds([]);
      loadTasks();
    } catch (error: any) {
      Message.error(error.response?.data?.error || '批量删除失败');
    }
  };

  const handleRun = async (id: number) => {
    try {
      await taskApi.run(id);
      Message.success('任务已开始执行');
      // SSE会自动更新运行状态和任务数据，无需手动刷新
    } catch (error: any) {
      Message.error(error.response?.data?.error || '执行失败');
    }
  };

  const handleKill = async (id: number) => {
    try {
      await taskApi.kill(id);
      Message.success('任务已终止');
      // SSE会自动更新运行状态和任务数据
    } catch (error: any) {
      Message.error(error.response?.data?.error || '终止失败');
    }
  };

  const handleViewLog = async (task: Task) => {
    setLogVisible(true);
    setLogContent('');
    setLogLoading(true);
    setCurrentViewTask(task);

    // 清除之前的计时器
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // 直接使用当前的 runningTasks 状态判断
    const isRunning = runningTasks.has(task.id);

    if (isRunning) {
        // 实时日志 - 使用SSE
        setIsLiveLog(true);

        // 先获取最近的执行记录
        try {
          const executions: any = await taskApi.listExecutions();

          // 找到该任务的执行记录（ExecutionInfo没有status字段，直接找task_id匹配的）
          const currentExecution = executions.find((e: any) => e.task_id === task.id);

          if (currentExecution) {
            // 启动实时耗时计时器 - 使用执行记录的开始时间
            const startTimestamp = new Date(currentExecution.started_at).getTime();
            setElapsedTime(Date.now() - startTimestamp);

            timerRef.current = setInterval(() => {
              setElapsedTime(Date.now() - startTimestamp);
            }, 100);

            // 连接SSE获取实时日志
            const token = localStorage.getItem('token');
            const url = `/api/executions/${currentExecution.execution_id}/logs${token ? `?token=${token}` : ''}`;

            setLogContent('[正在连接日志流...]\n');

            const eventSource = new EventSource(url);
            eventSourceRef.current = eventSource;

            // 设置连接超时
            const connectTimeout = setTimeout(() => {
              if (eventSource.readyState === EventSource.CONNECTING) {
                console.warn('SSE连接超时');
                setLogContent(prev => prev + '[连接超时，请检查网络或任务状态]\n');
              }
            }, 5000);

            eventSource.onopen = () => {
              clearTimeout(connectTimeout);
              setLogLoading(false);
              setLogContent(prev => prev.replace('[正在连接日志流...]\n', '[日志流已连接]\n'));
            };

            eventSource.onmessage = (event) => {
              setLogLoading(false);
              setLogContent(prev => prev + event.data + '\n');
            };

            eventSource.onerror = (error) => {
              clearTimeout(connectTimeout);
              console.error('SSE错误:', error);
              eventSource.close();
              setIsLiveLog(false);
              setLogLoading(false);

              // 停止计时器
              if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
              }

              // 不要覆盖已有的日志内容
              setLogContent(prev => prev ? prev + '\n[日志流已结束]' : '日志流连接失败');
            };
          } else {
            setLogLoading(false);
            setLogContent('未找到运行中的执行记录');
          }
        } catch (error) {
          console.error('获取执行记录失败:', error);
          setLogLoading(false);
          setLogContent('获取执行记录失败');
        }
      } else {
        // 历史日志 - 直接获取最后一次执行的日志详情
        setIsLiveLog(false);

        try {
          const logDetail = await logApi.getLatestByTask(task.id);
          setLogLoading(false);
          const startTime = new Date(logDetail.created_at).toLocaleString('zh-CN');
          setLogContent(`[任务开始时间: ${startTime}]\n${logDetail.output || '无日志输出'}`);
        } catch (error: any) {
          setLogLoading(false);
          if (error.response?.status === 404) {
            setLogContent('暂无执行日志');
          } else {
            setLogContent('获取日志失败: ' + (error.message || '未知错误'));
          }
        }
      }
  };

  const handleCloseLog = () => {
    setLogVisible(false);
    setLogContent('');
    setIsLiveLog(false);
    setCurrentViewTask(null);
    setElapsedTime(0);

    // 关闭SSE连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // 清除计时器
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const getTaskTypeTag = (type: string) => {
    const typeMap: Record<string, { color: string; text: string }> = {
      cron: { color: 'blue', text: '定时任务' },
      manual: { color: 'orange', text: '手动任务' },
      startup: { color: 'green', text: '开机任务' },
    };
    const config = typeMap[type] || { color: 'gray', text: type };
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'name',
      width: isMobile ? 100 : 200,
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: isMobile ? 70 : 120,
      render: (type: string) => getTaskTypeTag(type),
    },
    {
      title: '定时方式',
      dataIndex: 'cron',
      width: isMobile ? 150 : 240,
      render: (_cron: string | string[], record: Task) => {
        if (record.type !== 'cron') return '-';
        const text = formatTaskSchedule(record);
        return (
          <div className="tasks-schedule-block" style={{ fontSize: isMobile ? '10px' : '12px', whiteSpace: 'pre-wrap' }}>
            {text.split('\n').map((line, idx) => (
              <code
                key={idx}
                className="tasks-inline-code"
                style={{ display: 'block', marginBottom: idx < text.split('\n').length - 1 ? '4px' : 0 }}
              >
                {line}
              </code>
            ))}
          </div>
        );
      },
    },
    {
      title: '命令',
      dataIndex: 'command',
      width: isMobile ? 120 : 250,
      ellipsis: true,
      render: (command: string) => (
        <span className="tasks-command-text" style={{ fontSize: isMobile ? '10px' : '12px' }}>{command}</span>
      ),
    },
    {
      title: '任务状态',
      dataIndex: 'enabled',
      width: isMobile ? 70 : 100,
      render: (enabled: boolean, record: Task) => {
        const isRunning = runningTasks.has(record.id);
        return (
          <Space direction="vertical" size="small">
            <Tag color={enabled ? 'green' : 'gray'}>
              {enabled ? '启用' : '禁用'}
            </Tag>
            {isRunning && (
              <Tag color="blue" icon={<IconPlayArrow />}>
                {!isMobile && '运行中'}
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: '最后执行',
      dataIndex: 'last_run_at',
      width: isMobile ? 130 : 180,
      render: (time: string, record: Task) => {
        if (!time) return '-';
        const duration = record.last_run_duration
          ? ` (${record.last_run_duration}ms)`
          : '';
        return (
          <div>
            <div style={{ fontSize: isMobile ? '11px' : '14px' }}>
              {new Date(time).toLocaleString('zh-CN')}
            </div>
            {duration && !isMobile && (
              <div style={{ fontSize: 12, color: 'var(--color-text-3)' }}>
                {duration}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: '下次执行',
      dataIndex: 'next_run_at',
      width: isMobile ? 130 : 180,
      render: (time: string) =>
        time ? (
          <span style={{ fontSize: isMobile ? '11px' : '14px' }}>
            {new Date(time).toLocaleString('zh-CN')}
          </span>
        ) : '-',
    },
    {
      title: '操作',
      width: isMobile ? 180 : 260,
      fixed: 'right' as const,
      render: (_: any, record: Task) => {
        const isRunning = runningTasks.has(record.id);

        const droplist = (
          <Menu>
            {webhookToken && (
              <Menu.Item key="webhook" onClick={() => showWebhookUrl(record.id)}>
                <Space>
                  <IconLink />
                  Webhook
                </Space>
              </Menu.Item>
            )}
          </Menu>
        );

        return (
          <div className="tasks-action-grid">
            <Button
              type="text"
              size="small"
              icon={<IconPlayArrow />}
              onClick={() => handleRun(record.id)}
              disabled={isRunning}
            >
              {!isMobile && '执行'}
            </Button>
            {isRunning ? (
              <Popconfirm
                title="确定终止此任务吗？"
                onOk={() => handleKill(record.id)}
              >
                <Button
                  type="text"
                  size="small"
                  status="warning"
                  icon={<IconStop />}
                >
                  {!isMobile && '终止'}
                </Button>
              </Popconfirm>
            ) : (
              <Button
                type="text"
                size="small"
                icon={<IconEdit />}
                onClick={() => handleEdit(record)}
                disabled={isRunning}
              >
                {!isMobile && '编辑'}
              </Button>
            )}
            <Button
              type="text"
              size="small"
              icon={<IconFile />}
              onClick={() => handleViewLog(record)}
            >
              {!isMobile && '日志'}
            </Button>
            {isRunning ? (
              <Button type="text" size="small" icon={<IconMore />} disabled />
            ) : (
              <Popconfirm
                title="确定删除此任务吗？"
                onOk={() => handleDelete(record.id)}
              >
                <Button
                  type="text"
                  size="small"
                  status="danger"
                  icon={<IconDelete />}
                >
                  {!isMobile && '删除'}
                </Button>
              </Popconfirm>
            )}
            {webhookToken && (
              <Dropdown droplist={droplist} position="bl">
                <Button type="text" size="small" icon={<IconMore />} className="tasks-action-more" />
              </Dropdown>
            )}
          </div>
        );
      },
    },
  ];

  const renderTabContent = () => {
    if (isMobile) {
      return (
        <div className="tasks-mobile-section">
          <div className="tasks-mobile-summary">共 {tasks.length} 个任务</div>
          <div className="tasks-mobile-list">
            {tasks.map((task) => {
              const isRunning = runningTasks.has(task.id);
              return (
                <Card key={task.id} size="small" bordered className="tasks-mobile-card">
                  <div style={{ marginBottom: 10 }}>
                    <Checkbox
                      checked={selectedTaskIds.includes(task.id)}
                      disabled={isRunning}
                      onChange={(checked) => toggleTaskSelection(task.id, checked)}
                    >
                      选中此任务
                    </Checkbox>
                  </div>
                  <div className="tasks-mobile-card-shell">
                    <div className="tasks-mobile-card-title-row">
                      <Typography.Text bold className="tasks-mobile-card-title">{task.name}</Typography.Text>
                    </div>

                    <Typography.Text type="secondary" className="tasks-mobile-card-command">
                      {task.command}
                    </Typography.Text>

                    <div className="tasks-mobile-card-meta">
                      <div className="tasks-mobile-card-meta-item">
                        <span className="tasks-mobile-card-meta-label">类型</span>
                        <span className="tasks-mobile-card-meta-value">{task.type === 'cron' ? '定时任务' : task.type === 'manual' ? '手动任务' : '开机任务'}</span>
                      </div>
                      <div className="tasks-mobile-card-meta-item">
                        <span className="tasks-mobile-card-meta-label">状态</span>
                        <span className="tasks-mobile-card-meta-value">{isRunning ? '运行中' : task.enabled ? '启用' : '禁用'}</span>
                      </div>
                      <div className="tasks-mobile-card-meta-item">
                        <span className="tasks-mobile-card-meta-label">定时</span>
                        <span className="tasks-mobile-card-meta-value">{formatTaskSchedule(task)}</span>
                      </div>
                      {task.last_run_at ? (
                        <div className="tasks-mobile-card-meta-item">
                          <span className="tasks-mobile-card-meta-label">最后执行</span>
                          <span className="tasks-mobile-card-meta-value">{new Date(task.last_run_at).toLocaleString('zh-CN')}</span>
                        </div>
                      ) : null}
                      {task.next_run_at ? (
                        <div className="tasks-mobile-card-meta-item">
                          <span className="tasks-mobile-card-meta-label">下次执行</span>
                          <span className="tasks-mobile-card-meta-value">{new Date(task.next_run_at).toLocaleString('zh-CN')}</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="tasks-mobile-card-actions-wrap">
                      <Space wrap>
                        <Button
                          type="outline"
                          size="small"
                          onClick={() => handleRun(task.id)}
                          disabled={isRunning}
                        >
                          执行
                        </Button>
                        {isRunning && (
                          <Popconfirm title="确定终止此任务吗？" onOk={() => handleKill(task.id)}>
                            <Button type="outline" size="small" status="warning">终止</Button>
                          </Popconfirm>
                        )}
                        <Button type="outline" size="small" onClick={() => handleViewLog(task)}>日志</Button>
                        <Button type="outline" size="small" onClick={() => handleEdit(task)} disabled={isRunning}>编辑</Button>
                      </Space>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div>
        <div className="tasks-toolbar">
          <span className="tasks-toolbar-meta">
            共 {tasks.length} 个任务，已选 {selectedTaskIds.length} 个
          </span>
          <Button type="primary" icon={<IconPlus />} onClick={handleAdd}>
            新建任务
          </Button>
        </div>
        <div className="tasks-batch-toolbar">
          <Checkbox checked={allSelectableChecked} indeterminate={selectedTaskIds.length > 0 && !allSelectableChecked} onChange={toggleSelectAll}>
            全选
          </Checkbox>
          <Space wrap>
            <Button size="small" onClick={() => handleBatchSetEnabled(true)} disabled={selectedTaskIds.length === 0}>启用</Button>
            <Button size="small" onClick={() => handleBatchSetEnabled(false)} disabled={selectedTaskIds.length === 0}>禁用</Button>
            <Button size="small" status="danger" onClick={() => {
              Modal.confirm({ title: `确定删除已选中的 ${selectedTaskIds.length} 个任务吗？`, onOk: handleBatchDelete });
            }} disabled={selectedTaskIds.length === 0}>删除</Button>
          </Space>
        </div>
        <div className="tasks-table-shell">
          <Table
            className="tasks-table"
            columns={columns}
            data={tasks}
            loading={loading}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 1200 }}
            rowKey="id"
            rowSelection={{
              type: 'checkbox',
              selectedRowKeys: selectedTaskIds,
              onChange: (rowKeys) => setSelectedTaskIds((rowKeys as number[]).filter((id) => selectableTaskIds.includes(id))),
              checkboxProps: (record: Task) => ({ disabled: runningTasks.has(record.id) }),
            }}
          />
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="tasks-page-hero">
        <div className="tasks-page-description">查看任务状态，配置调度方式与执行策略</div>
      </div>
      <Card className="tasks-page-card">
        <div className="tasks-page-actions tasks-page-actions-dual">
          <Button type="primary" size={isMobile ? 'small' : 'default'} icon={<IconPlus />} onClick={handleAdd} className="tasks-page-action-btn">
            新建任务
          </Button>
          <Button size={isMobile ? 'small' : 'small'} onClick={() => setGroupManageVisible(true)} className="tasks-page-action-btn tasks-group-manage-btn">
            管理分组
          </Button>
        </div>
        <div className="tasks-group-header">
          <div className="tasks-group-tabs tasks-group-tabs-primary">
            <span
              className={`tasks-group-title ${activeTab === 'default' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('default')}
            >
              默认分组
            </span>
          </div>
          {groups.length > 0 ? (
            <div className="tasks-group-tabs tasks-group-tabs-secondary">
              {groups.map(group => (
                <span
                  key={group.id}
                  className={`tasks-group-tab ${activeTab === group.id.toString() ? 'is-active' : ''}`}
                  onClick={() => setActiveTab(group.id.toString())}
                >
                  {group.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {renderTabContent()}

      <Modal
        className="tasks-editor-modal"
        title={editingTask ? '编辑任务' : '新建任务'}
        visible={visible}
        onOk={handleSubmit}
        onCancel={() => {
          setVisible(false);
          setTaskModalTab('basic');
          form.resetFields();
          setEditingTask(null);
        }}
        autoFocus={false}
        style={{ width: isMobile ? '96%' : '90%', maxWidth: 800, top: isMobile ? 12 : undefined }}
      >
        <Form form={form} layout="vertical">
          <Tabs activeTab={taskModalTab} onChange={setTaskModalTab}>
            <TabPane key="basic" title="基础配置">
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <FormItem label="任务名称" field="name" rules={[{ required: true, message: '请输入任务名称' }]}>
                    <Input placeholder="请输入任务名称" />
                  </FormItem>
                </Col>
                <Col xs={24} md={12}>
                  <FormItem
                    label="任务类型"
                    field="type"
                    rules={[{ required: true }]}
                    extra="定时任务：按规则自动运行；手动任务：仅手动执行；开机任务：服务启动时自动执行一次"
                  >
                    <Select placeholder="请选择任务类型">
                      <Option value="cron">定时任务</Option>
                      <Option value="manual">手动任务</Option>
                      <Option value="startup">开机任务</Option>
                    </Select>
                  </FormItem>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <FormItem label="任务分组" field="group_id">
                    <Select placeholder="请选择分组（可选）" allowClear>
                      {groups.map(group => (
                        <Option key={group.id} value={group.id}>{group.name}</Option>
                      ))}
                    </Select>
                  </FormItem>
                </Col>
              </Row>

              <Form.Item noStyle shouldUpdate>
                {(values) => {
                  const taskType = values.type;
                  const scheduleMode = values.schedule_mode || 'preset';
                  return taskType === 'cron' ? (
                    <>
                      <FormItem label="定时方式" field="schedule_mode" initialValue="preset">
                        <RadioGroup type="button">
                          <Radio value="preset">选项式</Radio>
                          <Radio value="random_interval">随机间隔</Radio>
                          <Radio value="cron">Cron</Radio>
                        </RadioGroup>
                      </FormItem>

                      {scheduleMode === 'preset' && (
                        <Space style={{ width: '100%', marginBottom: 16 }} wrap direction={isMobile ? 'vertical' : 'horizontal'}>
                          <FormItem
                            label="每"
                            field="schedule_config.interval_value"
                            rules={[{ required: true, message: '请输入数值' }]}
                            style={{ marginBottom: 0, minWidth: 140, width: isMobile ? '100%' : undefined }}
                          >
                            <InputNumber min={1} precision={0} placeholder="例如 5" style={{ width: '100%' }} />
                          </FormItem>
                          <FormItem
                            label="单位"
                            field="schedule_config.interval_unit"
                            rules={[{ required: true, message: '请选择单位' }]}
                            style={{ marginBottom: 0, minWidth: 160, width: isMobile ? '100%' : undefined }}
                          >
                            <Select placeholder="请选择单位">
                              {SCHEDULE_UNIT_OPTIONS.map(option => (
                                <Option key={option.value} value={option.value}>{option.label}</Option>
                              ))}
                            </Select>
                          </FormItem>
                        </Space>
                      )}

                      {scheduleMode === 'random_interval' && (
                        <Space style={{ width: '100%', marginBottom: 16 }} wrap align="start" direction={isMobile ? 'vertical' : 'horizontal'}>
                          <FormItem
                            label="最小值"
                            field="schedule_config.min_value"
                            rules={[{ required: true, message: '请输入最小值' }]}
                            style={{ marginBottom: 0, minWidth: 140, width: isMobile ? '100%' : undefined }}
                          >
                            <InputNumber min={1} precision={0} placeholder="例如 15" style={{ width: '100%' }} />
                          </FormItem>
                          <FormItem
                            label="最大值"
                            field="schedule_config.max_value"
                            rules={[{ required: true, message: '请输入最大值' }]}
                            style={{ marginBottom: 0, minWidth: 140, width: isMobile ? '100%' : undefined }}
                          >
                            <InputNumber min={1} precision={0} placeholder="例如 20" style={{ width: '100%' }} />
                          </FormItem>
                          <FormItem
                            label="单位"
                            field="schedule_config.unit"
                            rules={[{ required: true, message: '请选择单位' }]}
                            style={{ marginBottom: 0, minWidth: 160, width: isMobile ? '100%' : undefined }}
                          >
                            <Select placeholder="请选择单位">
                              {SCHEDULE_UNIT_OPTIONS.map(option => (
                                <Option key={option.value} value={option.value}>{option.label}</Option>
                              ))}
                            </Select>
                          </FormItem>
                          <div style={{ color: 'var(--color-text-3)', fontSize: 12, paddingTop: isMobile ? 0 : 32, width: isMobile ? '100%' : undefined }}>
                            例如 15-20 分钟随机运行
                          </div>
                        </Space>
                      )}

                      {scheduleMode === 'cron' && (
                        <FormItem
                          label="Cron 表达式"
                          field="cron"
                          rules={[
                            {
                              required: true,
                              type: 'array',
                              minLength: 1,
                              message: '请至少添加一个 Cron 表达式'
                            }
                          ]}
                          extra={
                            <Space size="mini" style={{ fontSize: 12, color: 'var(--color-text-3)' }}>
                              <IconInfoCircle />
                              <span>支持5字段（分 时 日 月 周）或6字段（秒 分 时 日 月 周），例如: */5 * * * * 或 0 */5 * * * *</span>
                            </Space>
                          }
                        >
                          <Form.List field="cron">
                            {(fields, { add, remove }) => (
                              <div>
                                {fields.map((field, index) => (
                                  <div key={field.key} style={{ marginBottom: 8 }}>
                                    <Space style={{ width: '100%', alignItems: 'flex-start' }}>
                                      <FormItem
                                        field={field.field}
                                        rules={[{ required: true, message: '请输入 Cron 表达式' }]}
                                        style={{ marginBottom: 0, flex: 1 }}
                                      >
                                        <Input
                                          placeholder="例如: */5 * * * * 或 0 */5 * * * *"
                                          style={{ width: '100%' }}
                                        />
                                      </FormItem>
                                      {fields.length > 1 && (
                                        <Button
                                          type="text"
                                          status="danger"
                                          icon={<IconDelete />}
                                          onClick={() => remove(index)}
                                        />
                                      )}
                                    </Space>
                                  </div>
                                ))}
                                <Button
                                  type="dashed"
                                  icon={<IconPlus />}
                                  onClick={() => add()}
                                  style={{ width: '100%' }}
                                >
                                  添加 Cron 表达式
                                </Button>
                              </div>
                            )}
                          </Form.List>
                        </FormItem>
                      )}
                    </>
                  ) : null;
                }}
              </Form.Item>

              <FormItem label="执行命令" field="command" rules={[{ required: true, message: '请输入执行命令' }]}>
                <Input.TextArea
                  placeholder="例如: python3 scripts/test.py&#10;或: node scripts/app.js&#10;或: bash scripts/backup.sh"
                  autoSize={{ minRows: 1, maxRows: 5 }}
                  style={{ fontFamily: 'monospace' }}
                />
              </FormItem>

              <Divider />

              <FormItem
                label="账号运行模式"
                field="account_run_mode"
                extra="单次运行=整条脚本按当前环境直接执行一次；顺序轮询=拆出多个账号后一个一个跑；并发运行=拆出多个账号后按并发数分批同时跑。"
              >
                <Select placeholder="请选择账号运行模式">
                  <Option value="single">单次运行</Option>
                  <Option value="sequential">顺序轮询</Option>
                  <Option value="concurrent">并发运行</Option>
                </Select>
              </FormItem>

              <Form.Item noStyle shouldUpdate>
                {(values) => values.account_run_mode && values.account_run_mode !== 'single' ? (
                  <>
                    <Row gutter={16}>
                      <Col xs={24} md={12}>
                        <FormItem
                          label="账号变量名"
                          field="account_env_key"
                          rules={[{ required: true, message: '请输入账号变量名' }]}
                          extra="从环境变量 JSON 里取这个变量作为多账号来源，例如 TOKENS / COOKIE。"
                        >
                          <Input placeholder="例如 TOKENS / COOKIE / AUTH_TOKENS" />
                        </FormItem>
                      </Col>
                      <Col xs={24} md={12}>
                        <FormItem
                          label="当前脚本拆分规则"
                          field="account_split_delimiter"
                          extra={
                            <div style={{ lineHeight: 1.7 }}>
                              <div>这个脚本可以单独写自己的拆分规则；留空时才使用系统默认规则（当前默认：{defaultAccountSplitDelimiter || '未设置'}）。</div>
                              <div>支持单个分隔符、多分隔符（如 @|#|&）、多字符分隔符（如 #&），也支持 regex: 正则表达式。</div>
                              <div style={{ marginTop: 6 }}>
                                示例：1）a@b@c → @；2）a#b&c → #|&；3）{'{1#2}&{2#3}'} → &；4）正则写法 → regex:[#&]
                              </div>
                            </div>
                          }
                        >
                          <Input placeholder="示例：@ / #|& / #& / regex:[#&] / 处理 {1#2}&{2#3} 时填 &" />
                        </FormItem>
                      </Col>
                    </Row>

                    <Form.Item noStyle shouldUpdate>
                      {(innerValues) => innerValues.account_run_mode === 'concurrent' ? (
                        <FormItem
                          label="并发数"
                          field="account_concurrency"
                          rules={[{ required: true, message: '请输入并发数' }]}
                          extra="每批同时运行多少个账号，并受系统最大并发数限制。"
                        >
                          <InputNumber min={1} max={100} precision={0} style={{ width: '100%' }} placeholder="例如 3" />
                        </FormItem>
                      ) : null}
                    </Form.Item>
                  </>
                ) : null}
              </Form.Item>

              <FormItem label="启用 MicroWARP" field="use_microwarp" triggerPropName="checked" extra="开启后当前任务会接入系统配置中的 MicroWARP 能力。">
                <Switch />
              </FormItem>

              <Form.Item noStyle shouldUpdate>
                {(values) => values.use_microwarp ? (
                  <FormItem label="运行前切换 IP" field="microwarp_switch_ip_on_run" triggerPropName="checked" extra={values.account_run_mode === 'sequential' ? '顺序轮询模式下会在每个账号执行前都切一次 IP；并发模式暂不支持。' : '开启后每次任务运行前都会先调用一次 MicroWARP 切换 IP；并发模式暂不支持按账号切换。'}>
                    <Switch />
                  </FormItem>
                ) : null}
              </Form.Item>

              <FormItem label="启用" field="enabled" triggerPropName="checked">
                <Switch />
              </FormItem>
            </TabPane>

            <TabPane key="notify" title="消息推送">
              <FormItem label="启用任务通知" field="notify_enabled" triggerPropName="checked">
                <Switch />
              </FormItem>

              <Form.Item noStyle shouldUpdate>
                {(values) => values.notify_enabled ? (
                  <>
                    <Card bordered={false} className="tasks-notify-info-card" style={{ marginBottom: 16 }}>
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Typography.Text style={{ fontWeight: 600 }}>通知规则</Typography.Text>
                        <Typography.Text type="secondary">
                          先配置这个任务要发到哪个渠道，再选择哪些执行结果需要推送，以及是否附带日志内容。
                        </Typography.Text>
                      </Space>
                    </Card>

                    <Row gutter={16}>
                      <Col xs={24} md={12}>
                        <FormItem
                          label="推送渠道"
                          field="notify_channel"
                          rules={[{ required: true, message: '请选择推送渠道' }]}
                        >
                          <Select placeholder="请选择推送渠道">
                            {taskNotifyChannelOptions.map((channel) => (
                              <Option key={channel.value} value={channel.value}>
                                {channel.label}
                              </Option>
                            ))}
                          </Select>
                        </FormItem>
                      </Col>
                      <Col xs={24} md={12}>
                        <FormItem
                          label="通知类型"
                          field="notify_events"
                          rules={[{ required: true, type: 'array', minLength: 1, message: '请至少选择一个通知类型' }]}
                        >
                          <Checkbox.Group>
                            <Space wrap>
                              <Checkbox value="success">成功时</Checkbox>
                              <Checkbox value="failed">失败时</Checkbox>
                              <Checkbox value="timeout">超时时</Checkbox>
                            </Space>
                          </Checkbox.Group>
                        </FormItem>
                      </Col>
                    </Row>

                    <Row gutter={16}>
                      <Col xs={24} md={12}>
                        <FormItem label="附带执行日志" field="notify_attach_log" triggerPropName="checked">
                          <Switch />
                        </FormItem>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item noStyle shouldUpdate>
                          {(innerValues) => innerValues.notify_attach_log ? (
                            <FormItem
                              label="日志推送模式"
                              field="notify_log_mode"
                              rules={[{ required: true, message: '请选择日志推送模式' }]}
                              extra="全量推送会按字数限制直接截取原始日志；精简摘要会优先提取错误、失败、成功、超时等关键信息。"
                            >
                              <Select placeholder="请选择日志推送模式">
                                <Option value="full">全量推送</Option>
                                <Option value="summary">精简摘要</Option>
                              </Select>
                            </FormItem>
                          ) : null}
                        </Form.Item>
                      </Col>
                    </Row>

                    <Row gutter={16}>
                      <Col xs={24} md={12}>
                        <Form.Item noStyle shouldUpdate>
                          {(innerValues) => innerValues.notify_attach_log ? (
                            <FormItem
                              label="日志字数限制"
                              field="notify_log_limit"
                              rules={[{ required: true, message: '请输入日志字数限制' }]}
                              extra="限制推送消息里附带的日志长度。全量模式按原始日志截断；摘要模式按提取后的关键信息截断。"
                            >
                              <InputNumber min={100} max={20000} precision={0} placeholder="例如 2000" style={{ width: '100%' }} />
                            </FormItem>
                          ) : null}
                        </Form.Item>
                      </Col>
                    </Row>
                  </>
                ) : (
                  <Card bordered={false} className="tasks-notify-info-card">
                    <Typography.Text type="secondary">
                      开启后可为当前任务单独指定推送渠道、通知类型，以及日志附带策略。
                    </Typography.Text>
                  </Card>
                )}
              </Form.Item>
            </TabPane>

            <TabPane key="advanced" title="高级配置">
              <FormItem
                label="工作目录"
                field="working_dir"
                extra="命令执行的工作目录。留空则自动根据脚本路径判断；相对路径以scripts目录为基准；支持绝对路径"
              >
                <Input
                  placeholder="例如: git/my-repo 或 /absolute/path"
                  style={{ fontFamily: 'monospace' }}
                />
              </FormItem>

              <FormItem
                label="前置命令"
                field="pre_command"
                extra="在主命令执行前运行，可用于环境准备"
              >
                <Input.TextArea
                  placeholder="例如: cd /path/to/dir"
                  autoSize={{ minRows: 1, maxRows: 5 }}
                  style={{ fontFamily: 'monospace' }}
                />
              </FormItem>

              <FormItem
                label="后置命令"
                field="post_command"
                extra="在主命令执行后运行，可用于清理工作"
              >
                <Input.TextArea
                  placeholder="例如: rm -f /tmp/*.tmp"
                  autoSize={{ minRows: 1, maxRows: 5 }}
                  style={{ fontFamily: 'monospace' }}
                />
              </FormItem>
            </TabPane>
          </Tabs>
        </Form>
      </Modal>

      {/* 日志查看弹窗 */}
      <Modal
        title={
          <Space>
            <span>执行日志</span>
            {isLiveLog && <Tag color="blue">实时</Tag>}
          </Space>
        }
        visible={logVisible}
        onCancel={handleCloseLog}
        footer={null}
        style={{ width: isMobile ? '96%' : '90%', maxWidth: 1000, top: isMobile ? 12 : undefined }}
      >
        <Spin loading={logLoading} style={{ width: '100%' }}>
          <div
            style={{
              background: 'var(--xingshu-code-bg)',
              color: 'var(--xingshu-code-text)',
              padding: '16px',
              borderRadius: '8px',
              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
              fontSize: '13px',
              lineHeight: '1.6',
              maxHeight: '500px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {logContent || '暂无日志'}
          </div>
          {currentViewTask && runningTasks.has(currentViewTask.id) && (
            <div
              style={{
                marginTop: '12px',
                padding: '8px 12px',
                background: 'color-mix(in srgb, rgb(var(--primary-6)) 10%, var(--color-bg-2))',
                border: '1px solid color-mix(in srgb, rgb(var(--primary-6)) 22%, var(--color-border))',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span style={{ color: 'rgb(var(--primary-6))', fontWeight: 500 }}>
                实时耗时: {elapsedTime}ms ({(elapsedTime / 1000).toFixed(2)}s)
              </span>
              <IconPlayArrow style={{ color: 'rgb(var(--primary-6))', fontSize: '16px', animation: 'spin 1s linear infinite' }} />
            </div>
          )}
        </Spin>
      </Modal>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <Modal
        title="分组管理"
        visible={groupManageVisible}
        onCancel={() => setGroupManageVisible(false)}
        footer={null}
        style={{ width: isMobile ? '96%' : '90%', maxWidth: 600, top: isMobile ? 12 : undefined }}
      >
        <div style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<IconPlus />} onClick={() => {
            setEditingGroup(null);
            groupForm.resetFields();
            setGroupModalVisible(true);
          }}>
            新建分组
          </Button>
        </div>
        {isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {groups.map((record, index) => (
              <Card key={record.id} size="small" bordered>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <div>
                    <Typography.Text bold>{record.name}</Typography.Text>
                    {record.description ? (
                      <div style={{ marginTop: 4, color: 'var(--color-text-3)', fontSize: 12 }}>{record.description}</div>
                    ) : null}
                    <div style={{ marginTop: 6, color: 'var(--color-text-3)', fontSize: 12 }}>
                      创建时间：{new Date(record.created_at).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <Space wrap>
                    <Button type="outline" size="small" disabled={index === 0} onClick={() => handleMoveGroup(index, 'up')}>上移</Button>
                    <Button type="outline" size="small" disabled={index === groups.length - 1} onClick={() => handleMoveGroup(index, 'down')}>下移</Button>
                    <Button type="outline" size="small" icon={<IconEdit />} onClick={() => handleEditGroup(record)}>编辑</Button>
                    <Popconfirm title="确定删除此分组吗？" onOk={() => handleDeleteGroup(record.id)}>
                      <Button type="outline" size="small" status="danger" icon={<IconDelete />}>删除</Button>
                    </Popconfirm>
                  </Space>
                </Space>
              </Card>
            ))}
          </div>
        ) : (
          <Table
            columns={[
              {
                title: '排序',
                width: 120,
                render: (_: any, __: TaskGroup, index: number) => (
                  <Space size="mini">
                    <Button type="text" size="mini" disabled={index === 0} onClick={() => handleMoveGroup(index, 'up')}>
                      上移
                    </Button>
                    <Button type="text" size="mini" disabled={index === groups.length - 1} onClick={() => handleMoveGroup(index, 'down')}>
                      下移
                    </Button>
                  </Space>
                ),
              },
              {
                title: '分组名称',
                dataIndex: 'name',
              },
              {
                title: '描述',
                dataIndex: 'description',
              },
              {
                title: '创建时间',
                dataIndex: 'created_at',
                render: (time: string) => new Date(time).toLocaleString('zh-CN'),
              },
              {
                title: '操作',
                width: 120,
                render: (_: any, record: TaskGroup) => (
                  <Space size="mini">
                    <Button
                      type="text"
                      size="mini"
                      icon={<IconEdit />}
                      onClick={() => handleEditGroup(record)}
                    />
                    <Popconfirm
                      title="确定删除此分组吗？"
                      onOk={() => handleDeleteGroup(record.id)}
                    >
                      <Button
                        type="text"
                        size="mini"
                        status="danger"
                        icon={<IconDelete />}
                      />
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
            data={groups}
            pagination={false}
            rowKey="id"
          />
        )}
      </Modal>

      <Modal
        title={editingGroup ? '编辑分组' : '新建分组'}
        visible={groupModalVisible}
        onOk={handleSubmitGroup}
        onCancel={() => {
          setGroupModalVisible(false);
          groupForm.resetFields();
          setEditingGroup(null);
        }}
        autoFocus={false}
        style={{ width: isMobile ? '96%' : '90%', maxWidth: 500, top: isMobile ? 12 : undefined }}
      >
        <Form form={groupForm} layout="vertical">
          <FormItem label="分组名称" field="name" rules={[{ required: true, message: '请输入分组名称' }]}>
            <Input placeholder="请输入分组名称" />
          </FormItem>
          <FormItem label="分组描述" field="description">
            <Input.TextArea placeholder="请输入分组描述" rows={3} />
          </FormItem>
        </Form>
      </Modal>

      <Modal
        title="Webhook 地址"
        visible={webhookVisible}
        onCancel={() => {
          setWebhookVisible(false);
          setCurrentWebhookTaskId(null);
        }}
        footer={
          <Space>
            <Button onClick={() => {
              setWebhookVisible(false);
              setCurrentWebhookTaskId(null);
            }}>关闭</Button>
            <Button type="primary" onClick={copyWebhookUrl}>复制地址</Button>
          </Space>
        }
        style={{ width: '90%', maxWidth: 600 }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div>
            <Typography.Text bold>Webhook 地址：</Typography.Text>
            <Input.TextArea
              value={currentWebhookTaskId ? `${window.location.origin}/api/webhook/tasks/${currentWebhookTaskId}/trigger` : ''}
              readOnly
              autoSize={{ minRows: 2, maxRows: 4 }}
              style={{ marginTop: 8 }}
            />
          </div>
          <div>
            <Typography.Text bold>使用方法:</Typography.Text>
            <Typography.Paragraph style={{ marginTop: 8 }}>
              使用POST请求调用此URL，需要在请求头中添加：
              <pre className="tasks-pre-block" style={{ padding: '8px', marginTop: 8 }}>
                Authorization: Bearer {webhookToken}
              </pre>
            </Typography.Paragraph>
          </div>
          <div>
            <Typography.Text bold>示例:</Typography.Text>
            <pre className="tasks-pre-block" style={{ padding: '12px', marginTop: 8, overflow: 'auto' }}>
{`curl -X POST \\
  ${currentWebhookTaskId ? `${window.location.origin}/api/webhook/tasks/${currentWebhookTaskId}/trigger` : ''} \\
  -H "Authorization: Bearer ${webhookToken}"`}
            </pre>
          </div>
        </Space>
      </Modal>
    </Card>
    </>
  );
};

export default Tasks;
