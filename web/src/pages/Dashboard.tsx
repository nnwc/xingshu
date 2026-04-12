import React, { useEffect, useState } from 'react';
import { Grid, Card, Table, Space, Tag, Button, Progress, Modal, Message, Popconfirm } from '@arco-design/web-react';
import { IconClockCircle, IconCheckCircle, IconCloseCircle, IconFile, IconGithub } from '@arco-design/web-react/icon';
import { taskApi } from '@/api/task';
import { logApi } from '@/api/log';
import axios from 'axios';
import type { Log } from '@/types';
import './Dashboard.css';

const { Row, Col } = Grid;

interface SystemInfo {
  cpu_usage: number;
  memory_total: number;
  memory_used: number;
  memory_available: number;
  memory_usage_percent: number;
}

const Dashboard: React.FC = () => {
  const [tasks, setTasks] = useState<Array<{ id: number; name: string; enabled: boolean }>>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [logVisible, setLogVisible] = useState(false);
  const [logContent, setLogContent] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const [selectedLogIds, setSelectedLogIds] = useState<number[]>([]);
  const [deletingLogs, setDeletingLogs] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    loadData();
    loadSystemInfo();
    const interval = setInterval(loadSystemInfo, 5000); // 每5秒更新一次
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tasksRes, logsRes]: any = await Promise.all([
        taskApi.listSimple(),
        logApi.list(undefined, 1, 10),
      ]);
      setTasks(tasksRes);
      setLogs(logsRes.data);
    } finally {
      setLoading(false);
    }
  };

  const loadSystemInfo = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('/api/system/info', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSystemInfo(res.data);
    } catch (error) {
      console.error('Failed to load system info:', error);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleViewLog = async (log: Log) => {
    setLogVisible(true);
    setLogContent('');
    setLogLoading(true);

    try {
      const logDetail = await logApi.get(log.id);
      const startTime = new Date(logDetail.created_at).toLocaleString('zh-CN');
      setLogContent(`[任务开始时间: ${startTime}]\n${logDetail.output || '无日志输出'}`);
    } catch (error) {
      console.error('Failed to load log detail:', error);
      setLogContent('加载日志失败');
    } finally {
      setLogLoading(false);
    }
  };

  const stats = {
    total: tasks.length,
    enabled: tasks.filter(t => t.enabled).length,
    disabled: tasks.filter(t => !t.enabled).length,
  };

  const statCards = [
    {
      key: 'total',
      title: '总任务数',
      value: stats.total,
      icon: <IconClockCircle />,
      tone: 'primary',
      hint: '当前已纳入调度的任务',
    },
    {
      key: 'enabled',
      title: '已启用',
      value: stats.enabled,
      icon: <IconCheckCircle />,
      tone: 'success',
      hint: '正在参与执行与调度',
    },
    {
      key: 'disabled',
      title: '已禁用',
      value: stats.disabled,
      icon: <IconCloseCircle />,
      tone: 'danger',
      hint: '暂不参与自动执行',
    },
  ];

  const handleDeleteSelectedLogs = async () => {
    if (!selectedLogIds.length) {
      Message.warning('请先选择日志');
      return;
    }
    try {
      setDeletingLogs(true);
      await logApi.deleteByIds(selectedLogIds);
      Message.success('删除成功');
      setSelectedLogIds([]);
      await loadData();
    } catch (error) {
      console.error('Failed to delete logs:', error);
      Message.error('删除失败');
    } finally {
      setDeletingLogs(false);
    }
  };

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'task_id',
      width: 150,
      ellipsis: true,
      render: (_: any, record: Log) => {
        const task = tasks.find((t) => t.id === record.task_id);
        return task?.name || '-';
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (status: string) => (
        <Tag color={status === 'success' ? 'green' : 'red'}>
          {status === 'success' ? '成功' : '失败'}
        </Tag>
      ),
    },
    {
      title: '执行时间',
      dataIndex: 'created_at',
      width: 160,
      render: (time: string) => new Date(time).toLocaleString('zh-CN'),
    },
    {
      title: '耗时',
      dataIndex: 'duration',
      width: 120,
      render: (duration: number | undefined) => {
        if (!duration) return '-';
        return `${duration}ms (${(duration / 1000).toFixed(2)}s)`;
      },
    },
    {
      title: '操作',
      width: 100,
      render: (_: any, record: Log) => (
        <Button
          type="text"
          size="small"
          icon={<IconFile />}
          onClick={() => handleViewLog(record)}
        >
          日志
        </Button>
      ),
    },
  ];

  return (
    <div className="dashboard">
      <div className="dashboard-hero">
        <div>
          <div className="dashboard-eyebrow">总览当前任务、日志与系统运行状态</div>
        </div>
      </div>

      <Row gutter={isMobile ? [12, 12] : [16, 16]} className="dashboard-stat-grid">
        {statCards.map((item) => (
          <Col xs={24} sm={12} md={12} lg={6} xl={6} key={item.key}>
            <Card className={`dashboard-stat-card tone-${item.tone}`} bordered={false}>
              <div className="dashboard-stat-top">
                <div className="dashboard-stat-icon">{item.icon}</div>
                <div className="dashboard-stat-title">{item.title}</div>
              </div>
              <div className="dashboard-stat-value">{item.value}</div>
              <div className="dashboard-stat-hint">{item.hint}</div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={isMobile ? [12, 12] : [16, 16]} className="dashboard-resource-grid">
        <Col xs={24} sm={24} md={24} lg={12} xl={12}>
          <Card className="dashboard-panel-card" title="内存使用情况" bordered={false}>
            {systemInfo && (
              <Space direction="vertical" style={{ width: '100%' }} size={16}>
                <div className="dashboard-metric-row">
                  <div>
                    <div className="dashboard-metric-label">已使用</div>
                    <div className="dashboard-metric-text">{formatBytes(systemInfo.memory_used)} / {formatBytes(systemInfo.memory_total)}</div>
                  </div>
                  <div className="dashboard-metric-value">{systemInfo.memory_usage_percent.toFixed(1)}%</div>
                </div>
                <Progress
                  percent={systemInfo.memory_usage_percent}
                  status={systemInfo.memory_usage_percent > 80 ? 'error' : 'normal'}
                  showText={false}
                />
                <div className="dashboard-metric-subtle">可用内存：{formatBytes(systemInfo.memory_available)}</div>
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} sm={24} md={24} lg={12} xl={12}>
          <Card className="dashboard-panel-card" title="CPU 使用情况" bordered={false}>
            {systemInfo && (
              <Space direction="vertical" style={{ width: '100%' }} size={16}>
                <div className="dashboard-metric-row">
                  <div>
                    <div className="dashboard-metric-label">当前负载</div>
                    <div className="dashboard-metric-text">系统实时 CPU 使用率</div>
                  </div>
                  <div className="dashboard-metric-value">{systemInfo.cpu_usage.toFixed(1)}%</div>
                </div>
                <Progress
                  percent={systemInfo.cpu_usage}
                  status={systemInfo.cpu_usage > 80 ? 'error' : 'normal'}
                  showText={false}
                />
                <div className="dashboard-metric-subtle">{systemInfo.cpu_usage > 80 ? '当前负载较高，建议关注任务峰值。' : '当前处于相对平稳的运行状态。'}</div>
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      <Card
        className="dashboard-log-card dashboard-log-section"
        title="最近执行日志"
        bordered={false}
        extra={
          <Space>
            <Button type="text" onClick={() => setSelectedLogIds(logs.map((item) => item.id))}>
              全选
            </Button>
            <Popconfirm title="确定删除选中的日志吗？" onOk={handleDeleteSelectedLogs}>
              <Button type="text" status="danger" loading={deletingLogs} disabled={!selectedLogIds.length}>
                删除
              </Button>
            </Popconfirm>
            <Button type="text" onClick={loadData}>
              刷新
            </Button>
          </Space>
        }
      >
        <Table
          rowSelection={{
            type: 'checkbox',
            selectedRowKeys: selectedLogIds,
            onChange: (keys) => setSelectedLogIds(keys as number[]),
          }}
          columns={columns}
          data={logs}
          loading={loading}
          pagination={false}
          scroll={{ x: true }}
          rowKey="id"
        />
      </Card>

      <Modal
        title="日志详情"
        visible={logVisible}
        onCancel={() => setLogVisible(false)}
        footer={null}
        style={{ width: '80%', maxWidth: 1000 }}
      >
        {logLoading ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>加载中...</div>
        ) : (
          <pre style={{
            background: 'var(--xingshu-code-bg)',
            color: 'var(--xingshu-code-text)',
            padding: '16px',
            borderRadius: '8px',
            maxHeight: '600px',
            overflow: 'auto',
            fontSize: '13px',
            lineHeight: '1.5',
            margin: 0,
          }}>
            {logContent}
          </pre>
        )}
      </Modal>

      <div className="dashboard-footer">
        <a
          href="https://github.com/nnwc/xingshu"
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconGithub style={{ marginRight: '8px' }} />
          GitHub
        </a>
      </div>
    </div>
  );
};

export default Dashboard;
