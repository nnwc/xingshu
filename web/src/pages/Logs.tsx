import React, { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Select,
  Tag,
  Button,
  Modal,
  Spin,
  Pagination,
} from '@arco-design/web-react';
import { IconFile, IconRefresh } from '@arco-design/web-react/icon';
import { logApi } from '@/api/log';
import { taskApi } from '@/api/task';
import type { Log } from '@/types';
import './Logs.css';

const { Option } = Select;

const Logs: React.FC = () => {
  const [logs, setLogs] = useState<Log[]>([]);
  const [tasks, setTasks] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [logVisible, setLogVisible] = useState(false);
  const [logContent, setLogContent] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0,
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    loadTasks();
  }, []);

  useEffect(() => {
    if (selectedTaskId) {
      loadLogs(selectedTaskId, 1);
    }
  }, [selectedTaskId]);

  const loadTasks = async () => {
    try {
      const res: any = await taskApi.listSimple();
      setTasks(res);
      if (res.length > 0) {
        setSelectedTaskId(res[0].id);
      }
    } catch (error) {
      console.error('Failed to load tasks:', error);
    }
  };

  const loadLogs = async (taskId: number, page = 1) => {
    setLoading(true);
    try {
      const res: any = await logApi.list(taskId, page, pagination.pageSize);
      setLogs(res.data || []);
      setPagination({
        current: res.page || 1,
        pageSize: res.page_size || 10,
        total: res.total || 0,
      });
    } catch (error) {
      console.error('Failed to load logs:', error);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    if (selectedTaskId) {
      loadLogs(selectedTaskId, page);
    }
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

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      success: { color: 'green', text: '成功' },
      failed: { color: 'red', text: '失败' },
      running: { color: 'blue', text: '运行中' },
    };
    const config = statusMap[status] || { color: 'gray', text: status };
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'task_id',
      width: 200,
      render: (taskId: number) => {
        const task = tasks.find(t => t.id === taskId);
        return task?.name || `任务 ${taskId}`;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: string) => getStatusTag(status),
    },
    {
      title: '执行时间',
      dataIndex: 'created_at',
      width: 180,
      render: (time: string) => new Date(time).toLocaleString('zh-CN'),
    },
    {
      title: '耗时',
      dataIndex: 'duration',
      width: 120,
      render: (duration: number | undefined) => {
        if (!duration) return '-';
        return (
          <span className="logs-duration-text">
            {duration}ms ({(duration / 1000).toFixed(2)}s)
          </span>
        );
      },
    },
    {
      title: '操作',
      width: isMobile ? 40 : 120,
      render: (_: any, record: Log) => (
        <Button
          type="text"
          size="small"
          icon={<IconFile />}
          onClick={() => handleViewLog(record)}
          className="log-action-btn"
        >
          {!isMobile && <span className="log-action-text">查看日志</span>}
        </Button>
      ),
    },
  ];

  return (
    <>
      <div className="logs-page-hero">
        <div className="logs-page-description">查看任务执行结果、耗时表现与详细日志输出</div>
      </div>
      <Card
        className="logs-page-card"
        extra={
          <div className="logs-toolbar">
          <Select
            placeholder="选择任务"
            className="logs-task-select"
            value={selectedTaskId ?? undefined}
            onChange={(value) => setSelectedTaskId(value as number)}
          >
            {tasks.map((task) => (
              <Option key={task.id} value={task.id}>
                {task.name}
              </Option>
            ))}
          </Select>
          <Button
            icon={<IconRefresh />}
            onClick={() => selectedTaskId && loadLogs(selectedTaskId, pagination.current)}
          >
            刷新
          </Button>
          </div>
      }
    >
      {isMobile ? (
        <div className="logs-mobile-list">
          {loading ? (
            <div className="logs-mobile-loading">
              <Spin />
            </div>
          ) : logs.length === 0 ? (
            <div className="logs-mobile-empty">暂无日志</div>
          ) : (
            logs.map((log) => {
              const task = tasks.find((t) => t.id === log.task_id);
              return (
                <Card key={log.id} size="small" className="logs-mobile-card">
                  <div className="logs-mobile-card-header">
                    <div className="logs-mobile-task-name">{task?.name || `任务 ${log.task_id}`}</div>
                    <div>{getStatusTag(log.status)}</div>
                  </div>
                  <div className="logs-mobile-card-body">
                    <div className="logs-mobile-meta-row">
                      <span className="logs-mobile-meta-label">执行时间</span>
                      <span className="logs-mobile-meta-value">{new Date(log.created_at).toLocaleString('zh-CN')}</span>
                    </div>
                    <div className="logs-mobile-meta-row">
                      <span className="logs-mobile-meta-label">耗时</span>
                      <span className="logs-duration-text">{log.duration ? `${log.duration}ms (${(log.duration / 1000).toFixed(2)}s)` : '-'}</span>
                    </div>
                  </div>
                  <div className="logs-mobile-card-actions">
                    <Button
                      type="outline"
                      size="small"
                      icon={<IconFile />}
                      onClick={() => handleViewLog(log)}
                    >
                      查看日志
                    </Button>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      ) : (
        <div className="logs-table-shell">
          <Table
            className="logs-table"
            columns={columns}
            data={logs}
            loading={loading}
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total: pagination.total,
              onChange: handlePageChange,
            }}
            scroll={{ x: 1000 }}
            rowKey="id"
          />
        </div>
      )}

      <div className="logs-pagination-shell">
        <Pagination
          current={pagination.current}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onChange={handlePageChange}
          showTotal={false}
          sizeCanChange={false}
          simple={isMobile}
        />
      </div>

      <Modal
        title="执行日志"
        visible={logVisible}
        onCancel={() => setLogVisible(false)}
        footer={null}
        style={{ width: '90%', maxWidth: isMobile ? 420 : 1000 }}
      >
        <Spin loading={logLoading} style={{ width: '100%' }}>
          <div className="logs-code-block">
            {logContent || '暂无日志'}
          </div>
        </Spin>
      </Modal>
    </Card>
    </>
  );
};

export default Logs;
