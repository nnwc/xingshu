import React, { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Space,
  Typography,
} from '@arco-design/web-react';
import { IconRefresh } from '@arco-design/web-react/icon';
import { loginLogApi, type LoginLog } from '@/api/loginLog';
import dayjs from 'dayjs';

const { Title } = Typography;

const LoginLogs: React.FC = () => {
  const [logs, setLogs] = useState<LoginLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
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
    loadLogs();
  }, [pagination.current, pagination.pageSize]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const response = await loginLogApi.list(pagination.current, pagination.pageSize);
      setLogs(response.data);
      setPagination({
        ...pagination,
        total: response.total,
      });
    } catch (error) {
      console.error('Failed to load login logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const columns = [
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
  ];

  return (
    <div style={{ padding: isMobile ? '12px' : '20px' }}>
      <Card
        title={
          <Space>
            <Title heading={6} style={{ margin: 0 }}>
              登录日志
            </Title>
          </Space>
        }
        extra={
          <Space>
            <IconRefresh
              style={{ fontSize: 18, cursor: 'pointer' }}
              onClick={loadLogs}
            />
          </Space>
        }
      >
        <Table
          loading={loading}
          columns={columns}
          data={logs}
          scroll={{ x: 600 }}
          pagination={{
            ...pagination,
            onChange: (current, pageSize) => {
              setPagination({ ...pagination, current, pageSize });
            },
            showTotal: true,
            sizeCanChange: !isMobile,
            pageSizeChangeResetCurrent: true,
            simple: isMobile,
          }}
          rowKey="id"
        />
      </Card>
    </div>
  );
};

export default LoginLogs;
